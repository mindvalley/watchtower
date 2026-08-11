// scripts/benchmark/scan-observability.js
'use strict';

/*
 * Observability readiness scan (C4) — I/O entrypoint (the black-box edge). The
 * pure per-repo logic lives in scanRepo(repoDir, stack) and is exported so the
 * parity gate can run the real pipeline on the five pilots. main() clones ONE
 * repo (shallow, by SYSTEM env) and writes reports/<system>/observability.json:
 * per pillar { declared[], configured[], exercised[] } (+ applicable for FE).
 *
 * declared   — signal lib appears in a manifest (mix.exs / Gemfile / package.json / pyproject)
 * configured — a config file matches the pillar's config regex
 * exercised  — a source file matches the pillar's usage regex
 *
 * Agnostic-first: backend pillars (logging/tracing/backend_errors) apply to every
 * stack (all systems in scope run servers); vendor recognition is a per-stack
 * superset in observability-signals.js. Absent instrumentation scores an honest
 * rung 0 in the scorer — never a false green. No stack guard: every system is
 * scanned and scored. Reads source only, no compile.
 *
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const SIGNALS = require('./observability-signals');

const { systemConfig, reportsDir } = require('./engine-config');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const SKIP_DIRS = new Set(['node_modules', 'deps', '_build', '.git', '.elixir_ls', 'priv', 'tmp']);
const MAX_HITS = 5; // cap evidence samples per pillar rung

// overrides stack -> backend signal key in observability-signals.js
const BACKEND_KEY = {
  elixir: 'elixir', ruby: 'ruby', ts: 'js', js: 'js', python: 'python',
};
// backend source extensions per signal key
const SOURCE_EXTS = {
  elixir: ['.ex', '.exs'],
  ruby: ['.rb'],
  js: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
};
// backend manifest filename predicate per signal key. elixir/ruby use the SAME
// union the pre-refactor scan collected (mix + Gemfile), so the pilot manifest
// blob is byte-identical; js/python add their own.
const MANIFEST_MATCH = {
  elixir: (n) => n === 'mix.exs' || n === 'mix.lock' || n === 'Gemfile' || n === 'Gemfile.lock',
  ruby: (n) => n === 'mix.exs' || n === 'mix.lock' || n === 'Gemfile' || n === 'Gemfile.lock',
  js: (n) => n === 'package.json',
  python: (n) => n === 'pyproject.toml' || /^requirements.*\.txt$/.test(n),
};

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Walk the tree collecting file paths (absolute) whose name/full-path matches.
function collect(rootDir, matchFn) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (matchFn(e.name, full)) {
        out.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return out;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const rel = (repoDir, f) => path.relative(repoDir, f);

// Does any file match any regex? Return matching rel paths (capped at MAX_HITS).
function hits(repoDir, files, patterns) {
  const found = [];
  for (const f of files) {
    const text = readText(f);
    if (patterns.some((re) => re.test(text))) {
      found.push(rel(repoDir, f));
      if (found.length >= MAX_HITS) break;
    }
  }
  return found;
}

// declared: which signal libs appear anywhere in the manifest blob.
function declaredLibs(manifestBlob, libs) {
  return libs.filter((lib) => manifestBlob.includes(lib));
}

function scanPillar({ manifestBlob, configFiles, sourceFiles, repoDir }, sig) {
  return {
    declared: declaredLibs(manifestBlob, sig.deps),
    configured: hits(repoDir, configFiles, sig.config),
    exercised: hits(repoDir, sourceFiles, sig.usage),
  };
}

// Build the full observability report for an ALREADY-CLONED repo. Pure w.r.t.
// the filesystem at repoDir (no network). Exported so the parity gate runs the
// real pipeline on the five.
function scanRepo(repoDir, stack) {
  // Fail loud on an unmapped stack rather than defaulting to elixir — a future
  // stack (go/php/…) must land as Pending ("not measured"), never be scored with
  // the wrong stack's signals and skip the honesty gate.
  const backendKey = BACKEND_KEY[stack];
  if (!backendKey) throw new Error(`C4: no observability signal set for stack '${stack}' — add it to BACKEND_KEY/SIGNALS or leave the system Pending`);
  const isPilot = backendKey === 'elixir' || backendKey === 'ruby';

  const manifestFiles = collect(repoDir, MANIFEST_MATCH[backendKey]);
  const manifestBlob = manifestFiles.map(readText).join('\n');

  // Config files. Pilots keep the EXACT original collection (/config/ + exs|rb|yml)
  // so the pilot config set is byte-identical. js/python additively include their
  // config conventions — the five carry none of these files.
  const configFiles = collect(repoDir, (n, full) => {
    const inConfigDir = /\/config\//.test(full) && /\.(exs?|rb|ya?ml)$/.test(n);
    if (isPilot) return inConfigDir;
    return inConfigDir
      || /\.config\.(ts|js|mjs|cjs)$/.test(n)
      || /^instrumentation\.(ts|js)$/.test(n)
      || /^sentry\..*\.config\./.test(n)
      || n === 'settings.py'
      || (/\/config\//.test(full) && /\.(ts|js|py|ya?ml)$/.test(n));
  });

  const exts = SOURCE_EXTS[backendKey];
  const sourceFiles = collect(repoDir, (n) => exts.some((x) => n.endsWith(x)));

  const be = SIGNALS[backendKey];
  const ctx = { manifestBlob, configFiles, sourceFiles, repoDir };
  const report = {
    logging: scanPillar(ctx, be.logging),
    tracing: scanPillar(ctx, be.tracing),
    backend_errors: scanPillar(ctx, be.errors),
  };

  // Recognition-based stacks (js/python) only credit `exercised` when the library
  // is actually declared or configured. Elixir/Ruby have an implicit blessed
  // logger (Logger / Rails.logger) so a usage hit alone is meaningful there; in
  // JS/Python a usage-regex hit with NO declaration is a string coincidence —
  // posthog's `captureException` (excluded by decision), a custom `createLogger`,
  // etc. — and would false-green a pillar the system doesn't really instrument.
  if (!isPilot) {
    for (const key of ['logging', 'tracing', 'backend_errors']) {
      const p = report[key];
      if (!p.declared.length && !p.configured.length) p.exercised = [];
    }
  }

  // --- Frontend errors pillar (unchanged logic) ---
  const pkgFiles = collect(repoDir, (n) => n === 'package.json');
  const pkgBlob = pkgFiles.map(readText).join('\n');
  const feFrameworks = SIGNALS.frontend.frameworks;
  const vueTsxCount = collect(repoDir, (n) => n.endsWith('.vue') || n.endsWith('.tsx')).length;
  const applicable = feFrameworks.some((fw) => pkgBlob.includes(`"${fw}"`)) || vueTsxCount >= 10;

  if (applicable) {
    const feEntry = collect(repoDir, (n, full) => (
      /\.(js|ts)$/.test(n) && /(assets|src)\//.test(full) && /(app|main|index|entry)\./.test(n)
    ));
    const feAll = collect(repoDir, (n, full) => /\.(js|ts|vue)$/.test(n) && /(assets|src)\//.test(full));
    const feDeclared = declaredLibs(pkgBlob, SIGNALS.frontend.errors.deps);
    let feExercised = hits(repoDir, feAll, SIGNALS.frontend.errors.usage);
    // A framework errorHandler forwarding to a DECLARED tracker is a real
    // integration; a bare errorHandler with no tracker library is just error
    // handling (false green). So errorHandler counts only when a tracker is declared.
    if (feDeclared.length && !feExercised.length) {
      feExercised = hits(repoDir, feAll, [/errorHandler/]);
    }
    // Same honesty gate as the backend pillars, for the recognition-based stacks:
    // a frontend `captureException` with no declared tracker is posthog/custom,
    // not real error tracking. Pilots (elixir/ruby) keep the original behavior.
    if (!isPilot && !feDeclared.length) feExercised = [];
    report.frontend_errors = {
      applicable: true,
      declared: feDeclared,
      configured: hits(repoDir, feEntry.length ? feEntry : feAll, SIGNALS.frontend.errors.config),
      exercised: feExercised,
    };
  } else {
    report.frontend_errors = {
      applicable: false, declared: [], configured: [], exercised: [],
    };
  }

  return report;
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `scan-c4-${SYSTEM}-`));
  const repoDir = path.join(work, 'repo');
  const outDir = reportsDir(SYSTEM);

  const url = `https://x-access-token:${GH_TOKEN}@github.com/${cfg.repo}.git`;
  sh('git', ['clone', '--depth', '1', url, repoDir]);

  const report = scanRepo(repoDir, cfg.stack);
  writeJson(outDir, 'observability', report);
  const fe = report.frontend_errors.applicable ? 'FE:on' : 'FE:N/A';
  console.log(`Scanned C4 ${SYSTEM} (${cfg.repo}, ${cfg.stack}->${BACKEND_KEY[cfg.stack]}, ${fe}) -> ${outDir}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main, scanRepo, collect };
