'use strict';

/*
 * Codebase Simplicity scan (C8) — I/O entrypoint (the black-box edge). NOT
 * unit-tested; the testable logic is in scripts/benchmark/* (parseCredo /
 * parseRubocop / parseDuplication / scoreSimplicity). Clones ONE repo (shallow,
 * by SYSTEM env) and produces, under reports/<system>/:
 *
 *   complexity-<language>.json   raw complexity linter output (one per measured language)
 *   vue-offsets.json             line-offset map for Vue <script> extraction (vue repos only)
 *   jscpd.json                   raw jscpd duplication report
 *   simplicity-meta.json         new shape: { stack, tool, languages, unmeasured,
 *                                  skipped_immaterial, generated_files_skipped,
 *                                  vue_extraction_failures, loc }
 *
 * Complexity linters read SOURCE only (no target compile / deps.get), so this
 * runs headless on any clone — the same private-dep sidestep C9 relies on:
 *   Elixir -> Credo via a standalone runner project (its OWN mix deps, not the
 *             target's), pointed at the clone via files.included.
 *   Ruby   -> Rubocop with a minimal config, Metrics/CyclomaticComplexity only.
 *   JS/TS/Vue/Python -> lizard (language-agnostic CCN analyser, source-only).
 *     Vue single-file components need <script> extraction first (lizard cannot
 *     parse .vue directly). A failed extraction is counted; if ALL fail, throw.
 * Duplication -> jscpd. jscpd has no native Elixir tokenizer, so .ex/.exs are
 *   mapped to the ruby tokenizer (handles do/end block structure); approximate
 *   for Elixir, and stated as such in the C8 criterion documentation.
 *
 * Env:
 *   SYSTEM    system key (must exist in benchmark.overrides.json)
 *   GH_TOKEN  token with read on the target repo (clone auth)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { extractLinterJson } = require('./parse-reports');
const { discoverLanguages } = require('./simplicity-stacks');
const { extractScript } = require('./vue-sfc');
const { detectGate, mentionsEslintComplexityRule, ESLINT_CONFIG_CANDIDATES } = require('./complexity-gate');
const {
  NONCODE_EXTS, shouldSkipDir, shouldSkipFile, GENERATED_RE, TEST_FILE_RE,
  lizardExcludeArgs, rubocopExcludeGlobs, credoExcludedRegexes,
} = require('./simplicity-exclusions');

const { systemConfig, reportsDir, systemTarget } = require('./engine-config');
const { materialise } = require('./target-tree');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const COMPLEXITY_THRESHOLD = 10; // McCabe convention anchor (all adapters pinned)
const CREDO_VERSION = '~> 1.7';

function sh(cmd, args, opts = {}) {
  // 64MB — lizard emits one CSV row per function to stdout; a large TS/JS repo can
  // exceed execFileSync's 1MB default maxBuffer (child gets SIGTERM, no report).
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024, ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Capture stdout of a linter that exits non-zero WHEN IT FINDS violations (that
// is a successful scan, not an error). A finding-exit still yields stdout; a real
// failure (crash, no output) yields none — throw so the leg fails loudly rather
// than emitting an empty "clean" report that scores a false green (the C9 lesson).
function captureAllowFindings(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, opts).toString();
  } catch (e) {
    if (e.stdout && e.stdout.length) return e.stdout.toString();
    throw new Error(`${cmd} produced no output (real failure): ${e.message}`);
  }
}

// Line count per extension. What it skips comes from simplicity-exclusions.js,
// the SAME definition every linter runner below derives its excludes from, so the
// numerator and the denominator can no longer drift apart.

// Standard binary-detection heuristic: a NUL byte in the first 8 KB. Catches
// images, fonts, archives, certificates, and compiled artefacts without requiring
// an unbounded extension allowlist that would rot. Real source files are text and
// never contain NUL bytes.
function isBinaryFile(filePath) {
  try {
    const buf = Buffer.allocUnsafe(8192);
    const fd = fs.openSync(filePath, 'r');
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).includes(0);
  } catch {
    return false; // unreadable — countLocByExtension's readFileSync will also skip it
  }
}

function countLocByExtension(rootDir) {
  const loc = Object.create(null);
  let generatedSkipped = 0;
  let binarySkipped = 0;
  let testFilesSkipped = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name, path.relative(rootDir, path.join(dir, e.name)))) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        if (GENERATED_RE.test(e.name)) { generatedSkipped += 1; continue; }
        if (TEST_FILE_RE.test(e.name)) { testFilesSkipped += 1; continue; }
        const ext = path.extname(e.name);
        if (!ext) continue;
        if (NONCODE_EXTS.has(ext)) continue; // data/docs, not code — omit silently
        const full = path.join(dir, e.name);
        if (isBinaryFile(full)) { binarySkipped += 1; continue; }
        try {
          const n = fs.readFileSync(full, 'utf8').split('\n').length;
          loc[ext] = (loc[ext] || 0) + n;
        } catch { /* unreadable — skip */ }
      }
    }
  };
  walk(rootDir, 0);
  return {
    loc, generatedSkipped, binarySkipped, testFilesSkipped,
  };
}

// Elixir complexity via a standalone Credo project (credo is its only dep, so
// mix deps.get pulls only public Hex — the target is never built). Credo's
// files.included must be the absolute clone path or external files are silently
// skipped (verified: default included is the runner's own lib/).
function runCredo(repoDir, outDir, reportName) {
  const runner = fs.mkdtempSync(path.join(os.tmpdir(), 'credo-runner-'));
  fs.writeFileSync(path.join(runner, 'mix.exs'), `defmodule CredoRunner.MixProject do
  use Mix.Project
  def project, do: [app: :credo_runner, version: "0.1.0", elixir: "~> 1.14", deps: [{:credo, "${CREDO_VERSION}"}]]
end
`);
  // Excludes derived from the shared definition, not hand-listed here: credo used
  // to exclude a different set from the one the LOC walk applied, so credo
  // violations and credo lines came from different populations.
  const excluded = credoExcludedRegexes().map((p) => `~r"${p}"`).join(', ');
  fs.writeFileSync(path.join(runner, '.credo.exs'), `%{configs: [%{name: "default", strict: false,
  files: %{included: ["${repoDir}/"], excluded: [${excluded}]},
  checks: %{enabled: [{Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: ${COMPLEXITY_THRESHOLD}]}], disabled: []}}]}
`);
  const opts = { cwd: runner };
  sh('mix', ['local.hex', '--force'], opts);
  sh('mix', ['local.rebar', '--force'], opts);
  sh('mix', ['deps.get'], opts);
  // Pre-compile so mix's dep-compile chatter ("==> file_system", "Compiling…")
  // lands in this discarded-output call, not mixed into the captured Credo JSON
  // below. Warm build first, then the credo run emits only its report.
  sh('mix', ['compile'], opts);
  const out = captureAllowFindings('mix', ['credo', '--config-file', '.credo.exs', '--format', 'json'], opts);
  const parsed = JSON.parse(extractLinterJson(out)); // slice payload; non-JSON -> throw, no false green
  writeJson(outDir, reportName, parsed);
}

// Ruby complexity via Rubocop, Metrics/CyclomaticComplexity only, Max pinned.
// Runs on source (no bundle). Writes a scoped config to avoid inheriting the
// target's .rubocop.yml (which could disable the cop or change Max).
function runRubocop(repoDir, outDir, reportName) {
  const cfg = path.join(os.tmpdir(), `rubocop-c8-${process.pid}.yml`);
  // Rubocop excluded NOTHING before this, so it counted offences in vendored and
  // test Ruby whose lines the LOC walk had already thrown away. Excludes now come
  // from the same shared definition as the walk's.
  const excludes = rubocopExcludeGlobs().map((g) => `    - '${g}'`).join('\n');
  fs.writeFileSync(cfg, `AllCops:
  DisabledByDefault: true
  Exclude:
${excludes}
Metrics/CyclomaticComplexity:
  Enabled: true
  Max: ${COMPLEXITY_THRESHOLD}
`);
  const json = captureAllowFindings('rubocop', [
    '--config', cfg, '--force-exclusion', '--only', 'Metrics/CyclomaticComplexity',
    '--format', 'json', repoDir,
  ]);
  const parsed = JSON.parse(json); // throws on non-JSON -> leg fails, no false green
  writeJson(outDir, reportName, parsed);
}

// JS/TS/Python/Vue complexity via lizard (a language-agnostic CCN analyzer;
// source-only, no compile, no per-project config).
//
// `readers` is the LIST of lizard reader names to enable, resolved by
// simplicity-stacks.lizardInvocation from the extensions actually present. It is a
// list and not a single string because lizard's `-l` selects a reader, not a family:
// `-l javascript` reads .js/.cjs/.mjs and nothing else, `-l typescript` reads .ts
// and nothing else, and .tsx/.jsx belong to a third reader. Passing one name per
// language left those files unread while their lines stayed in the denominator.
//
// `excludeExts` closes the other half of that: the tsx reader answers to both .tsx
// and .jsx, so enabling it for typescript would also pull in javascript's .jsx and
// double-count it. Each pass excludes the extensions it does not own.
//
// `targetDir` defaults to repoDir but is the extraction dir for Vue.
function runLizard(repoDir, outDir, reportName, readers, targetDir, excludeExts = []) {
  if (!Array.isArray(readers) || readers.length === 0) {
    throw new Error(`lizard invoked for ${reportName} with no reader — a mapped extension would go unread`);
  }
  const args = ['--csv'];
  for (const r of readers) args.push('-l', r);
  args.push(...lizardExcludeArgs());
  for (const ext of excludeExts) args.push('-x', `*${ext}`);
  args.push(targetDir || repoDir);
  const csv = sh('lizard', args).toString();
  // A scan that finds zero functions is a misconfiguration (wrong stack /
  // empty clone), not a legitimately clean scan — throw rather than emit a report
  // that would score a false green (the C9/C8 never-false-green rule).
  const rows = csv.split('\n').map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) {
    throw new Error(`lizard produced no functions for ${repoDir} (misconfigured ${readers.join('+')} scan?)`);
  }
  writeJson(outDir, reportName, { format: 'csv', text: csv });
}

// lizard cannot parse .vue. Extract each <script> block into a mirror tree, run
// lizard over that, and record the offsets so reported lines can be mapped back to
// the .vue file. A finding pointing at a temp file is worse than no finding.
function extractVueTree(repoDir, workDir) {
  const outRoot = path.join(workDir, 'vue-extract');
  const offsets = {}; // extracted relative path -> { source: '<repo-relative>.vue', lineOffset }
  let failed = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name, path.relative(repoDir, full))) continue;
        walk(full, depth + 1);
      } else if (e.name.endsWith('.vue') && !shouldSkipFile(e.name)) {
        let block = null;
        try { block = extractScript(fs.readFileSync(full, 'utf8')); } catch { block = null; }
        if (!block) { failed += 1; continue; }
        const rel = path.relative(repoDir, full);
        const target = path.join(outRoot, `${rel}.${block.lang}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, block.code);
        offsets[path.relative(outRoot, target)] = { source: rel, lineOffset: block.lineOffset };
      }
    }
  };
  walk(repoDir, 0);
  return { outRoot, offsets, failed };
}

// Config text for each linter that could gate complexity, plus every GitHub
// Actions workflow concatenated. Detection itself is pure (complexity-gate.js).
function readGateInputs(repoDir) {
  const read = (p) => { try { return fs.readFileSync(path.join(repoDir, p), 'utf8'); } catch { return null; } };
  // The candidate list and the "does this file mention the rule" test both come
  // from complexity-gate.js. They used to be a private, quoted-keys-only regex
  // here, which meant the unquoted flat-config branch in readConfig could only
  // ever be reached from unit tests: a repo with `complexity: ["error", 10]` read
  // as ungated. One spelling of the question, used by the detector and the edge.
  let eslint = null;
  for (const c of ESLINT_CONFIG_CANDIDATES) {
    const t = read(c);
    if (t && mentionsEslintComplexityRule(t)) { eslint = t; break; }
  }

  let workflowText = '';
  const wfDir = path.join(repoDir, '.github', 'workflows');
  try {
    for (const f of fs.readdirSync(wfDir)) {
      if (/\.ya?ml$/.test(f)) workflowText += `${fs.readFileSync(path.join(wfDir, f), 'utf8')}\n`;
    }
  } catch { /* no workflows */ }

  return {
    configs: { credo: read('.credo.exs'), rubocop: read('.rubocop.yml'), eslint, lizard: workflowText },
    workflowText,
  };
}

// Duplication via jscpd. Map ex/exs to the ruby tokenizer (jscpd has no Elixir
// support); keep rb explicit so ruby repos still tokenize .rb. Native tokenizers
// cover js/ts/vue/etc. Output file is jscpd-report.json in the given dir.
function runJscpd(repoDir, outDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-'));
  try {
    // Ignore non-code so duplication measures CODE, not data/i18n/docs. Without
    // this, translation (.po) and locale/data (.json) files dominate — one repo
    // reads 14.99% raw but 5.89% code-only. See criteria-docs.json (C8).
    sh('npx', ['--yes', 'jscpd', repoDir,
      '--reporters', 'json', '--output', tmp, '--silent',
      '--formats-exts', 'ruby:rb,ex,exs',
      '--ignore', [
        '**/deps/**', '**/_build/**', '**/node_modules/**', '**/priv/static/**',
        '**/test/**', '**/spec/**',
        '**/*.po', '**/*.json', '**/*.csv', '**/*.svg', '**/*.md', '**/*.mdx', '**/*.lock',
        '**/priv/gettext/**', '**/locales/**', '**/locale/**',
      ].join(',')]);
  } catch (e) { console.error(`  jscpd exit: ${e.message}`); }
  // A missing report is a real failure — throw rather than write a 0% "clean"
  // duplication result that would score a false green.
  const report = JSON.parse(fs.readFileSync(path.join(tmp, 'jscpd-report.json'), 'utf8'));
  writeJson(outDir, 'jscpd', report);
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const stack = cfg.stack || 'elixir';
  const outDir = reportsDir(SYSTEM);

  // The tree must be removed in a finally: a clone's .git/config holds the token
  // in plaintext. target-tree also keeps the clone's stderr out of the log for
  // the same reason — the URL carrying the token reaches it before any catch
  // here would run — and removes only what it created, so a local target's
  // source folder is never touched.
  const tree = materialise(systemTarget(SYSTEM), { prefix: `c8-${SYSTEM}`, token: GH_TOKEN });
  const work = path.dirname(tree.dir);
  const repoDir = tree.dir;

  try {
    for (const note of tree.notes) console.log(`  ${note}`);

    const {
      loc: locByExt, generatedSkipped, binarySkipped, testFilesSkipped,
    } = countLocByExtension(repoDir);
    const { measured, unmeasured, skippedImmaterial } = discoverLanguages(locByExt);
    if (measured.length === 0) {
      throw new Error(`no material language found in ${tree.label} — refusing to write a meta that would score 0/0`);
    }

    const gateInputs = readGateInputs(repoDir);
    let vue = null;

    const languages = [];
    for (const lang of measured) {
      const reportName = `complexity-${lang.language}`;
      if (lang.requiresSfcExtraction) {
        vue = extractVueTree(repoDir, work);
        // If Vue is material but every extraction failed, the extractor is broken —
        // do not silently write a meta claiming Vue was measured when nothing was.
        if (Object.keys(vue.offsets).length === 0) {
          throw new Error(`Vue was discovered as material in ${tree.label} but zero <script> blocks could be extracted — extractor broken, refusing to write a false meta`);
        }
        writeJson(outDir, 'vue-offsets', vue.offsets);
        // The extraction tree is MIXED: a `lang="ts"` block is written as
        // `<name>.vue.ts` and a plain one as `<name>.vue.js`. Running it under the
        // javascript reader alone read only the `.vue.js` half — in one repo that
        // silently dropped 135 of 222 extracted SFCs while all 41,446 Vue lines
        // stayed in the denominator. Both readers are enabled; they partition the
        // tree by extension with no overlap.
        runLizard(repoDir, outDir, reportName, lang.lizardReaders, vue.outRoot, lang.lizardExcludeExts);
      } else if (lang.tool === 'credo') {
        runCredo(repoDir, outDir, reportName);
      } else if (lang.tool === 'rubocop') {
        runRubocop(repoDir, outDir, reportName);
      } else {
        runLizard(repoDir, outDir, reportName, lang.lizardReaders, repoDir, lang.lizardExcludeExts);
      }
      const gate = detectGate({ language: lang.language, ...gateInputs });
      languages.push({
        language: lang.language,
        tool: lang.tool,
        loc: lang.loc,
        exts: lang.exts,
        report: reportName,
        gate,
      });
    }

    runJscpd(repoDir, outDir);

    writeJson(outDir, 'simplicity-meta', {
      stack,
      // Retained for consumers not yet iterating `languages`: the tool for the
      // largest measured language. Degrades to a partial reading, never an exception.
      tool: languages[0].tool,
      languages,
      unmeasured,
      skipped_immaterial: skippedImmaterial,
      generated_files_skipped: generatedSkipped,
      binary_files_skipped: binarySkipped,
      test_files_skipped: testFilesSkipped,
      vue_extraction_failures: vue ? vue.failed : 0,
      loc: languages.reduce((a, l) => a + l.loc, 0),
    });
    console.log(`Scanned C8 ${SYSTEM} (${tree.label}) — ${languages.map((l) => `${l.language}:${l.tool}`).join(' ')} + jscpd`);
  } finally {
    tree.cleanup();
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main };
