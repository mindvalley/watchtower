/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 868:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Findings a watchtower has already judged acceptable.
//
// Without this, every scan re-reports the same false positives — a public
// reCAPTCHA site key read as a secret, a CVE in a package that is only ever
// loaded in development — with no way to say so. Re-reporting a judgement that
// has already been made erodes trust in the whole report.
//
// An allowance REMOVES the finding from the score and keeps it visible in the
// report, marked, with the reason it was allowed. Nothing disappears: a page can
// always say "3 findings, 1 allowed". That is deliberate — a mechanism that
// deleted findings would be indistinguishable from a scan that never ran, which
// is the failure this engine guards against everywhere else.
//
// WHERE THE LIST LIVES is the caller's business, exactly like the list of systems
// to scan (see engine-config.js). Two shapes, one file format:
//
//   local   the engine repo is also the runner, so the file sits beside the
//           config in that same repo
//   remote  a private watchtower repo holds the file; the engine is pulled in as
//           a pinned action and holds nobody's allowances
//
// FILE FORMAT
//
//   { "allowances": [
//       { "criterion": "security", "sub": "secrets",
//         "system": "billing-api",
//         "file": "config/dev.exs", "rule": "generic-api-key",
//         "reason": "Public reCAPTCHA site key, not a secret",
//         "allowed_by": "a.engineer@example.com", "allowed_on": "2026-01-31T09:32:00.000Z" }
//   ] }
//
// An entry matches a finding when EVERY field it names is equal. Leave a field
// out and it broadens: drop `file` and the rule is allowed anywhere. That is the
// intended way to write a general allowance, and it is also the danger, so the
// run reports how many findings each entry absorbed and which absorbed none.
//
// Deliberately NOT supported, each for a reason:
//
//   globs          an allowance is an audit record; listing the files you mean
//                  is tedious and honest, where a pattern quietly widens over
//                  time. Add on evidence, not in advance.
//   duplication    C8's percentage comes from jscpd's own totals, not from the
//                  list of duplicated blocks, so filtering that list would not
//                  move the score — and subtracting each pair's lines
//                  double-counts a block cloned three times. Out until it can be
//                  done correctly.
//   absences       "no rollback configured" is not a false positive. Allowing it
//                  would be accepting a risk, which is a different feature.

const { relativize } = __nccwpck_require__(754);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches the output of new Date().toISOString(): YYYY-MM-DDTHH:mm:ss.sssZ
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// What may be matched on, per criterion and sub-metric. Keyed to the item shapes
// the parsers in parse-reports.js actually emit.
//
// This table exists so a typo fails loudly. Without it, `{ "fle": "x.ex" }`
// would simply never match, and an allowance that does nothing looks identical
// to a feature that is broken. If a parser gains a field and this table goes
// stale, the failure is a refused allowance — a finding stays counted, which is
// the safe direction.
const MATCHABLE = {
  'security:secrets': ['file', 'rule', 'line'],
  'security:deps': ['package', 'id', 'severity', 'installed', 'bucket', 'target'],
  'security:sast': ['id', 'path', 'severity'],
  'simplicity:complexity': ['file', 'scope', 'language'],
};

// Fields that describe the allowance rather than the finding it matches.
const META = new Set(['criterion', 'sub', 'system', 'reason', 'allowed_by', 'allowed_on', 'note']);

// Fields holding a path, which arrives from a scanner prefixed with the throwaway
// clone directory and has to be shortened on both sides before comparing.
const PATH_FIELDS = new Set(['file', 'path', 'target']);

// A Vue single-file component's script block is extracted to `<name>.vue.ts`
// before the complexity linter can read it, so that is the path the linter
// reports. Nobody writing an allowance knows or should care about the extraction
// tree — and the two places this matters would otherwise disagree, because the
// findings report maps the location back to the .vue file while the scorer does
// not. Collapsing the extension on both sides makes one allowance cover both.
const VUE_EXTRACTED = /\.vue\.(ts|js)$/;

function subjectKey(criterion, sub) {
  return `${criterion}:${sub}`;
}

function normalisePath(value) {
  return relativize(String(value)).replace(VUE_EXTRACTED, '.vue');
}

function normaliseValue(field, value) {
  return PATH_FIELDS.has(field) ? normalisePath(value) : String(value);
}

function describe(entry, index) {
  const where = entry && entry.criterion && entry.sub
    ? `${entry.criterion}/${entry.sub}`
    : 'unknown subject';
  return `allowance ${index + 1} (${where})`;
}

function normaliseEntry(entry, index, source) {
  const at = `${source}: ${describe(entry, index)}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${at} is not an object.`);
  }

  const key = subjectKey(entry.criterion, entry.sub);
  const matchable = MATCHABLE[key];
  if (!matchable) {
    throw new Error(
      `${at} names a criterion and sub-metric that cannot carry allowances. ` +
      `Allowances apply to: ${Object.keys(MATCHABLE).sort().join(', ')}.`,
    );
  }

  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    throw new Error(`${at} has no reason. An allowance without a reason is not an audit record.`);
  }

  const match = {};
  for (const [field, value] of Object.entries(entry)) {
    if (META.has(field)) continue;
    if (!matchable.includes(field)) {
      throw new Error(
        `${at} matches on '${field}', which is not part of a ${key} finding. ` +
        `Available: ${matchable.join(', ')}.`,
      );
    }
    if (value == null || value === '') {
      throw new Error(`${at} leaves '${field}' empty. Remove the field to broaden the allowance deliberately.`);
    }
    if (typeof value === 'object') {
      throw new Error(`${at} gives '${field}' an object. Allowance fields are single values.`);
    }
    match[field] = normaliseValue(field, value);
  }

  // An entry naming nothing matches every finding in its sub-metric. That is
  // never what someone means to write, and it would zero a whole facet behind
  // one line of JSON.
  if (Object.keys(match).length === 0) {
    throw new Error(
      `${at} names no fields, so it would allow every ${key} finding. ` +
      `Name at least one of: ${matchable.join(', ')}.`,
    );
  }

  if (entry.system != null && (typeof entry.system !== 'string' || entry.system === '')) {
    throw new Error(`${at} has an empty system. Remove it to apply the allowance to every system.`);
  }

  if (entry.allowed_by != null && !EMAIL_RE.test(entry.allowed_by)) {
    throw new Error(`${at} has 'allowed_by' "${entry.allowed_by}" which is not an email address.`);
  }

  if (entry.allowed_on != null && !ISO_TIMESTAMP_RE.test(entry.allowed_on)) {
    throw new Error(`${at} has 'allowed_on' "${entry.allowed_on}" which is not a JavaScript timestamp (expected YYYY-MM-DDTHH:mm:ss.sssZ).`);
  }

  return {
    key,
    criterion: entry.criterion,
    sub: entry.sub,
    system: entry.system == null ? null : entry.system,
    match,
    reason: entry.reason,
    allowed_by: entry.allowed_by == null ? null : entry.allowed_by,
    allowed_on: entry.allowed_on == null ? null : entry.allowed_on,
  };
}

// Accepts either { allowances: [...] } or a bare list. Missing is normal — most
// watchtowers allow nothing, and an empty list must behave exactly as no file at
// all so that shipping this mechanism cannot move a single score.
function parseAllowances(raw, { source = 'allowances' } = {}) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : raw.allowances;
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw new Error(`${source}: "allowances" must be a list.`);
  }
  return list.map((entry, i) => normaliseEntry(entry, i, source));
}

function itemMatches(allowance, item) {
  for (const [field, want] of Object.entries(allowance.match)) {
    const got = item ? item[field] : undefined;
    if (got == null) return false;
    if (normaliseValue(field, got) !== want) return false;
  }
  return true;
}

// One of these per system, because the tallies are per system and because an
// allowance may be scoped to a single system.
//
// `matcherFor` returns null when nothing is allowed for that sub-metric. Callers
// treat null as "no allowances", which keeps the untouched path free of any
// wrapper — the reason an empty list is provably identical to today.
function createAllowanceSet(allowances, systemKey) {
  const scoped = allowances.filter((a) => a.system == null || a.system === systemKey);
  const matched = new Map(scoped.map((a) => [a, 0]));

  function matcherFor(criterion, sub) {
    const key = subjectKey(criterion, sub);
    const relevant = scoped.filter((a) => a.key === key);
    if (relevant.length === 0) return null;
    return (item) => {
      for (const a of relevant) {
        if (itemMatches(a, item)) {
          matched.set(a, matched.get(a) + 1);
          return a;
        }
      }
      return null;
    };
  }

  // Every allowance in scope with the number of findings it absorbed on this
  // run. Two readings matter and both need the whole list, not just the hits:
  // an entry whose count climbs is quietly swallowing new problems, and an entry
  // at zero is either fixed — delete it — or never matched anything and was
  // wrong when it was written.
  function summary() {
    return [...matched.entries()].map(([a, count]) => ({
      criterion: a.criterion,
      sub: a.sub,
      system: a.system,
      match: a.match,
      reason: a.reason,
      allowed_by: a.allowed_by,
      allowed_on: a.allowed_on,
      matched: count,
    }));
  }

  function unmatched() {
    return summary().filter((a) => a.matched === 0);
  }

  return { matcherFor, summary, unmatched };
}

module.exports = {
  MATCHABLE, parseAllowances, createAllowanceSet, subjectKey,
};


/***/ }),

/***/ 880:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/engine-config.js
//
// The engine's only link to whoever is running it.
//
// Before this file existed, every scan program worked out two locations by
// counting directories upwards from itself — the list of systems to scan, and
// the folder to write results into. That silently tied the engine to one repo's
// layout: move the directory and nothing starts. Two programs did the read at
// import time, so even loading them failed.
//
// Both locations are now passed in. Nothing is discovered by walking upwards.
//
//   WATCHTOWER_CONFIG   path to the file listing the systems to scan
//                       (default: ./watchtower.config.json, so a standalone
//                       copy works from a project root with no setup)
//   WATCHTOWER_REPORTS  folder to write raw scan output into
//                       (default: ./reports)
//   WATCHTOWER_DATA     folder holding the assembled scores, which the publish
//                       step reads back to send to a dashboard
//                       (default: ./data)
//   WATCHTOWER_ALLOWANCES
//                       path to the file listing findings already judged
//                       acceptable (default: ./watchtower.allowances.json).
//                       Unlike the others, ABSENCE IS NORMAL — most watchtowers
//                       allow nothing, and no file behaves exactly like an empty
//                       list. See allowances.js.
//
// The list itself stays private and is never part of the engine: it names real
// repositories, which is the caller's business, not the tool's. The same is true
// of the allowances: the engine carries the mechanism, never anyone's judgements.
//
// Everything here fails loudly. A scan that cannot find its list must stop, not
// carry on with nothing to scan — an empty run reports no problems, which reads
// exactly like a clean result.



const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const { parseAllowances } = __nccwpck_require__(868);

const DEFAULT_CONFIG = 'watchtower.config.json';
const DEFAULT_REPORTS = 'reports';
const DEFAULT_DATA = 'data';
const DEFAULT_ALLOWANCES = 'watchtower.allowances.json';

function configPath() {
  return path.resolve(process.env.WATCHTOWER_CONFIG || DEFAULT_CONFIG);
}

function allowancesPath() {
  return path.resolve(process.env.WATCHTOWER_ALLOWANCES || DEFAULT_ALLOWANCES);
}

function reportsRoot() {
  return path.resolve(process.env.WATCHTOWER_REPORTS || DEFAULT_REPORTS);
}

function dataDir() {
  return path.resolve(process.env.WATCHTOWER_DATA || DEFAULT_DATA);
}

// Read lazily, never at import time. Importing a scan program should not
// require the caller's configuration to exist — that is what made three test
// files fail to load rather than fail an assertion.
function loadConfig() {
  const file = configPath();

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the watchtower config at ${file}. ` +
      `Set WATCHTOWER_CONFIG to the file listing the systems to scan. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The watchtower config at ${file} is not valid JSON: ${err.message}`);
  }

  const systems = parsed && parsed.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    throw new Error(`The watchtower config at ${file} has no "systems" object.`);
  }
  // An empty list is refused rather than treated as "nothing to do". A caller
  // who meant to scan nothing does not run a scanner.
  if (Object.keys(systems).length === 0) {
    throw new Error(`The watchtower config at ${file} lists no systems.`);
  }

  return parsed;
}

// The allowances file, parsed and validated. Read lazily for the same reason as
// the config.
//
// Absence is handled asymmetrically on purpose:
//
//   no WATCHTOWER_ALLOWANCES set, default file not there
//       -> [] . Allowing nothing is the ordinary state of a watchtower, and this
//          is the case that makes shipping the mechanism provably score-neutral.
//   WATCHTOWER_ALLOWANCES set, file not there
//       -> throw. The caller said where the list is; if it is not there, a typo
//          in the path would otherwise swallow every allowance in silence and
//          look exactly like a list that legitimately matches nothing.
function loadAllowances() {
  const file = allowancesPath();
  const explicit = Boolean(process.env.WATCHTOWER_ALLOWANCES);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && !explicit) return [];
    throw new Error(
      `Cannot read the allowances file at ${file}. ` +
      `WATCHTOWER_ALLOWANCES points here, so an unreadable file is an error, not an empty list. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The allowances file at ${file} is not valid JSON: ${err.message}`);
  }

  return parseAllowances(parsed, { source: file });
}

// Credentials are supplied through the environment, never through this file.
// The config is the one thing that gets committed to a repository.
const CREDENTIAL_LOOKING = /^(token|password|secret|key|private_key|credential)$/i;

function systemConfig(systemKey) {
  if (!systemKey) {
    throw new Error('No system named. Set SYSTEM to a key from the watchtower config.');
  }

  const { systems } = loadConfig();
  const cfg = systems[systemKey];
  if (!cfg) {
    const known = Object.keys(systems).sort().join(', ');
    throw new Error(`Unknown system '${systemKey}'. The config lists: ${known}`);
  }

  const leaked = Object.keys(cfg).filter((k) => CREDENTIAL_LOOKING.test(k));
  if (leaked.length > 0) {
    throw new Error(
      `System '${systemKey}' has ${leaked.join(', ')} in the watchtower config. ` +
      'Credentials belong in the environment, not in a committed file.',
    );
  }

  return cfg;
}

// Results for one system. Created on demand so a caller does not have to
// prepare the tree.
function reportsDir(systemKey) {
  const dir = path.join(reportsRoot(), systemKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// What one system's code IS: a GitHub repository, or a folder on this machine.
//
// Here rather than in each scan program because a relative path is resolved
// against the directory holding the config, and this is the only file that
// knows where that is. Every scan program asking the same question has to get
// the same answer — the alternative is seven of them each deciding for
// themselves what a relative path is relative to.
function systemTarget(systemKey) {
  const { targetOf } = __nccwpck_require__(639);
  return targetOf(systemConfig(systemKey), systemKey, path.dirname(configPath()));
}

module.exports = {
  configPath, reportsRoot, dataDir, allowancesPath,
  loadConfig, loadAllowances, systemConfig, reportsDir, systemTarget,
};


/***/ }),

/***/ 750:
/***/ ((module) => {



// layout-discovery.js — agnostic C6 file classification. Pure (no fs). Maps each
// repo-relative path to {stack, role} (source|test|null) using universal layout
// conventions on the FULL repo-relative path.
//
// Design note (why no manifest-root discovery): an earlier design discovered
// project roots from declared manifests (package.json/mix.exs/pyproject.toml/…)
// and classified root-relative. Investigation against the real repos proved that
// harmful: Phoenix apps ship an `assets/package.json`, which made `assets/` a
// root — stripping the `assets/` prefix so the `(src|assets)/` matcher missed
// every `assets/js/*.js` (one Phoenix frontend collapsed 124 → 0). The universal
// convention regexes already use `(^|/)…`, so they traverse monorepo nesting
// (`apps/web/src/x.ts`, `libraries/core/src/x.py`) natively — no root logic
// needed. Being the same regexes the pilot used, they reproduce the five
// byte-identical. The agnostic conventions ARE the discovery.

const norm = (p) => String(p).replace(/\\/g, '/');

// Classify a repo-relative path. Tests are checked before sources (a test file
// shares source extensions). Language is only a reporting bucket, never a
// scoring input. Buckets: elixir, ruby, frontend (all JS/TS), python.
function classifyFile(relPath) {
  const p = norm(relPath);

  // Tests first.
  if (/(^|\/)test\/.*_test\.exs$/.test(p)) return { stack: 'elixir', role: 'test' };
  if (/(^|\/)spec\/.*_spec\.rb$/.test(p) || /(^|\/)test\/.*_test\.rb$/.test(p)) return { stack: 'ruby', role: 'test' };
  // __tests__/ is a JS/TS convention; carve out .py so a python test under it
  // reaches the python branch instead of being counted as a frontend test.
  if (/\.(test|spec)\.(js|ts|jsx|tsx)$/.test(p) || (/(^|\/)__tests__\//.test(p) && !/\.py$/.test(p))) return { stack: 'frontend', role: 'test' };
  if (/(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(p)) return { stack: 'python', role: 'test' };

  // Sources.
  if (/(^|\/)lib\/.*\.ex$/.test(p)) return { stack: 'elixir', role: 'source' };
  if (/(^|\/)(app|lib)\/.*\.rb$/.test(p)) return { stack: 'ruby', role: 'source' };
  if (/\.(js|ts|jsx|tsx|vue)$/.test(p) && !/\.(test|spec|config|conf)\./.test(p) && !/\.d\.ts$/.test(p) && /(^|\/)(src|assets)\//.test(p)) {
    return { stack: 'frontend', role: 'source' };
  }
  if (/(^|\/)(src|lib)\/.*\.py$/.test(p)) return { stack: 'python', role: 'source' };

  return { stack: null, role: null };
}

module.exports = { classifyFile };


/***/ }),

/***/ 754:
/***/ ((module) => {



// Turning a scanner's path back into a repo-relative one.
//
// Third-party scanners (gitleaks/trivy/semgrep/credo/rubocop/jscpd) report paths
// absolute to the per-run clone dir — <tmp>/scan-<sys>-<rand>/repo/ or
// <tmp>/scan-c8-<sys>-<rand>/repo/. That random suffix would render as garbage in
// the UI and, worse, make findings-*.json churn on every scan (defeating the
// data-PR change gate). Our own walkers (C4/C6/C7) already emit relative paths,
// which don't match and pass through untouched.
//
// This lives in its own file because two callers need the SAME definition: the
// findings report, which shortens paths on the way out, and the allowances
// matcher, which has to shorten them on the way IN — a person writing an
// allowance knows `config/dev.exs`, never `/tmp/scan-billing-api-a1b2c3/repo/
// config/dev.exs`. Two copies of this rule drifting apart would make allowances
// silently match nothing, which reads exactly like a feature that was never
// wired up.

const CLONE_ROOT = /^.*?\/scan-[^/]*\/repo\//;

function relativize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(CLONE_ROOT, '');
}

function relativizePaths(node) {
  if (Array.isArray(node)) return node.map(relativizePaths);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = relativizePaths(v);
    return out;
  }
  return relativize(node);
}

module.exports = { relativize, relativizePaths };


/***/ }),

/***/ 782:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/* module decorator */ module = __nccwpck_require__.nmd(module);
// scripts/benchmark/scan-test-coverage.js


/*
 * Test-coverage scan (C6) — I/O entrypoint (the black-box edge). NOT unit-tested;
 * the testable logic is test-coverage-signals.js + score-test-coverage.js. Clones
 * ONE repo (shallow, by SYSTEM env) and writes reports/<system>/test-coverage.json
 * per the report contract: per-stack { source_files, tested_files, untested_samples,
 * tooling{tool,present,thresholds,enforced} }.
 *
 * Static/no-compile — walks the file tree + reads config/CI files only. Same
 * private-dep sidestep as C2/C4/C7/C8/C9.
 *
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const {
  SKIP_DIRS, aggregateStack, detectThresholds, detectTool,
} = __nccwpck_require__(922);
const { classifyFile } = __nccwpck_require__(750);

const { reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const SAMPLE_CAP = 20;
const FRONTEND_MIN_FILES = 5; // fewer than this => no meaningful FE surface => omit stack (N/A)

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// Walk the repo, returning every file's rel path (skipping SKIP_DIRS).
function walkFiles(repoDir) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else {
        out.push(path.relative(repoDir, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(repoDir, 0);
  return out;
}

// Collect config/CI text relevant to coverage tooling for a stack.
function toolingText(repoDir, relFiles, stack) {
  const wanted = relFiles.filter((p) => {
    if (/(^|\/)\.github\/workflows\/.*\.ya?ml$/.test(p)) return true;   // minimum_coverage in CI (all stacks)
    if (/(^|\/)coveralls\.json$/.test(p)) return true;                  // excoveralls
    if (stack === 'elixir' && /(^|\/)mix\.exs$/.test(p)) return true;
    if (stack === 'ruby' && /(^|\/)(Gemfile|spec\/(spec|rails)_helper\.rb|\.simplecov)$/.test(p)) return true;
    if (stack === 'frontend' && /(^|\/)(package\.json|vitest\.config\.[jt]s|jest\.config\.[jt]s)$/.test(p)) return true;
    if (stack === 'python' && /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc|codecov\.ya?ml)$/.test(p)) return true;
    return false;
  });
  // Include the matched filenames alongside their contents: some tools are
  // signalled by a file's existence (e.g. coveralls.json) rather than a string
  // inside it, so detectTool must see the paths too.
  return `${wanted.join('\n')}\n${wanted.map((p) => readText(path.join(repoDir, p))).join('\n')}`;
}

const STACK_ORDER = ['elixir', 'ruby', 'python', 'frontend']; // backend-first, frontend-last (report key order)

function collectStacks(relFiles) {
  const byStack = {};
  for (const p of relFiles) {
    const { stack, role } = classifyFile(p);
    if (!stack || !role) continue;
    (byStack[stack] ||= { source: [], test: [] })[role].push(p);
  }
  return byStack;
}

function buildStack(repoDir, relFiles, stackKey, files) {
  if (!files.source.length) return null;
  const agg = aggregateStack(files.source, files.test, SAMPLE_CAP);
  const text = toolingText(repoDir, relFiles, stackKey);
  const thresholds = detectThresholds(text);
  const tool = detectTool(stackKey, text);
  return {
    ...agg,
    tooling: { tool, present: !!tool, thresholds, enforced: thresholds.length > 0 },
  };
}

function main() {
  const tree = materialise(systemTarget(SYSTEM), { prefix: `c6-${SYSTEM}`, token: GH_TOKEN });
  try {
    scan(tree, reportsDir(SYSTEM));
  } finally {
    // Previously left on disk with the token in its .git/config.
    tree.cleanup();
  }
}

function scan(tree, outDir) {
  const repoDir = tree.dir;
  for (const note of tree.notes) console.log(`  ${note}`);

  const relFiles = walkFiles(repoDir);
  const byStack = collectStacks(relFiles);
  const stacks = {};
  for (const key of STACK_ORDER) {
    if (!byStack[key]) continue;
    const s = buildStack(repoDir, relFiles, key, byStack[key]);
    if (!s) continue;
    if (key === 'frontend' && s.source_files < FRONTEND_MIN_FILES) continue; // FE noise gate (N/A)
    stacks[key] = s;
  }

  const report = { system: SYSTEM, applicable: Object.keys(stacks).length > 0, stacks };
  writeJson(outDir, 'test-coverage', report);

  const summary = Object.entries(stacks)
    .map(([k, s]) => `${k}:${s.tested_files}/${s.source_files}${s.tooling.enforced ? `+enf(${s.tooling.thresholds.join('/')})` : s.tooling.present ? '+cfg' : ''}`)
    .join(' ');
  console.log(`Scanned C6 ${SYSTEM} (${tree.label}) -> ${summary || 'no stacks'} -> ${outDir}`);
}

if (__nccwpck_require__.c[__nccwpck_require__.s] === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main };


/***/ }),

/***/ 639:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Where a scan's working tree comes from.
 *
 * Every scan program used to do the same two lines: make a temp directory,
 * shallow-clone `cfg.repo` into `<tmp>/repo`. That is the only thing a target
 * could be, so running the scanner on a laptop scored whatever was on the
 * remote's default branch rather than the code in front of you — the check you
 * wanted to run before opening the pull request measured the branch you were
 * about to change.
 *
 * A system now declares `repo` OR `path`. Exactly one.
 *
 *   "billing": { "repo": "org/billing",   "stack": "elixir" }
 *   "billing": { "path": "code/billing",  "stack": "elixir" }
 *
 * A relative `path` is resolved against the DIRECTORY HOLDING THE CONFIG, not
 * the working directory. The config sits beside the projects it describes, and
 * resolving against the shell's cwd would make the same config mean different
 * things depending on where you happened to run it from. Nothing in this engine
 * is discovered by walking upwards, and this keeps it that way.
 *
 * A LOCAL TARGET IS COPIED, NOT SCANNED IN PLACE, and there are three separate
 * reasons — any one of them enough:
 *
 *   1. The scan writes into the tree it is reading. graphify drops a
 *      `graphify-out/` directory into the repo root. Scanning in place would
 *      leave build output inside somebody's working copy.
 *   2. Third-party scanners report absolute paths, and repo-paths.js turns them
 *      back into repo-relative ones by matching a `scan-<something>/repo/`
 *      prefix under the temp directory. That rule
 *      is shared with the allowances matcher, so a target outside that shape
 *      would make every allowance silently match nothing — which reads exactly
 *      like a feature nobody wired up. Materialising into the SAME shape means
 *      neither of those files has to learn about local targets at all.
 *   3. A working copy is not a clone. It holds `node_modules`, `_build`,
 *      coverage output and whatever else is gitignored, and gitleaks, jscpd and
 *      the LOC walk would all read them. The copy carries what git carries:
 *      tracked files plus untracked ones that are not ignored — which is to say
 *      the code you are about to push, uncommitted edits included. That is the
 *      thing you wanted measured.
 *
 * HISTORY IS READ FROM THE ORIGINAL. The copy has no `.git`, and C1's change
 * coupling needs a commit log. Rather than copy the object store, the scan is
 * handed a separate `historyDir` pointing at the source. It is only ever read
 * from — `git log`, nothing else. When the source is not a git repository at
 * all, `historyDir` is null and coupling reports itself unmeasured, which it
 * already knew how to do.
 *
 * NOTHING HERE EVER DELETES A DIRECTORY IT DID NOT CREATE. `cleanup()` removes
 * the temp directory and only the temp directory. The clone path relies on that
 * to shred a `.git/config` holding a plaintext token; the local path must never
 * be able to do the same thing to somebody's project.
 */

const fs = __nccwpck_require__(896);
const os = __nccwpck_require__(857);
const path = __nccwpck_require__(928);
const { execFileSync } = __nccwpck_require__(317);

// Only consulted when the source is not a git repository, and it is a guess by
// construction — without git there is no ignore file to obey. Kept deliberately
// short: these are directories that are build output or a package cache in
// every ecosystem that has them, and a wrong entry silently removes real source
// from a measurement. Anything doubtful is left in, because too much is a
// visible score and too little is an invisible one.
const NON_SOURCE_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', '.venv', 'venv',
  '__pycache__', '.tox', '.gradle', '.terraform', 'graphify-out',
  '.next', '.nuxt', '.turbo', 'coverage', '.elixir_ls',
]);

/*
 * What a system config says its target is. Pure; no filesystem.
 *
 * configDir is where a relative path is resolved from — see the note above.
 */
function targetOf(cfg, systemKey, configDir) {
  const hasRepo = typeof cfg.repo === 'string' && cfg.repo !== '';
  const hasPath = typeof cfg.path === 'string' && cfg.path !== '';

  // Both is not a preference to resolve, it is two different answers to one
  // question. Silently choosing either would make a stale entry score the wrong
  // code, and the report would name the system, not the source.
  if (hasRepo && hasPath) {
    throw new Error(
      `System '${systemKey}' declares both repo and path. A target is one or the other — `
      + 'remove whichever is not the code you mean to measure.',
    );
  }
  if (!hasRepo && !hasPath) {
    throw new Error(
      `System '${systemKey}' declares neither repo nor path. `
      + 'Set repo to "owner/name" for a GitHub repository, or path to a folder on this machine.',
    );
  }

  if (hasRepo) return { kind: 'repo', repo: cfg.repo, label: cfg.repo };

  const resolved = path.resolve(configDir || process.cwd(), cfg.path);
  return { kind: 'path', path: resolved, label: resolved };
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
});

// The files git would carry: tracked, plus untracked ones no ignore rule
// covers. Returns null when the directory is not a git repository — the caller
// falls back to a walk and says that it did.
//
// `run` is injected so the listing can be tested without a git repository.
function gitFiles(srcDir, run = sh) {
  let out;
  try {
    out = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: srcDir });
  } catch {
    return null;
  }
  return out.split('\0').filter(Boolean);
}

function walkFiles(srcDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (NON_SOURCE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        found.push(path.relative(srcDir, path.join(dir, e.name)));
      }
    }
  };
  walk(srcDir, 0);
  return found;
}

/*
 * Copy a list of repo-relative paths from src into dest.
 *
 * Only regular files travel. A symlink is skipped and counted rather than
 * followed: following one would read a file outside the tree being measured and
 * attribute whatever it found to this system, and `git ls-files` lists symlinks
 * like anything else. The count is reported so a repository that leans on them
 * does not look like one that simply has fewer files.
 */
function copyFiles(src, dest, files) {
  let copied = 0;
  let symlinks = 0;
  let unreadable = 0;
  for (const rel of files) {
    // A path escaping the source is not something git or the walk produces, so
    // reaching this means the input is not what it claims to be.
    const from = path.resolve(src, rel);
    if (from !== src && !from.startsWith(src + path.sep)) continue;

    let st;
    try { st = fs.lstatSync(from); } catch { unreadable += 1; continue; }
    if (st.isSymbolicLink()) { symlinks += 1; continue; }
    if (!st.isFile()) continue;

    const to = path.join(dest, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    } catch { unreadable += 1; }
  }
  return { copied, symlinks, unreadable };
}

/*
 * Produce a working tree for one system and say where it is.
 *
 * Returns { dir, historyDir, label, kind, cleanup, notes }.
 *
 *   dir         the tree to scan, always <tmp>/scan-<prefix>-<rand>/repo
 *   historyDir  where to run `git log` for change coupling, or null
 *   cleanup()   removes the temp directory and nothing else
 *   notes       lines worth printing; how the tree was assembled
 */
function materialise(target, {
  prefix, token, tmpRoot = os.tmpdir(), run = sh,
} = {}) {
  const work = fs.mkdtempSync(path.join(tmpRoot, `scan-${prefix}-`));
  const dir = path.join(work, 'repo');
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  const notes = [];

  try {
    if (target.kind === 'repo') {
      const url = token
        ? `https://x-access-token:${token}@github.com/${target.repo}.git`
        : `https://github.com/${target.repo}.git`;
      // Caught, because the URL carries the token and git writes it to its own
      // stderr on failure. Only the repo name is safe to put in the message.
      try {
        run('git', ['clone', '--depth', '1', url, dir]);
      } catch (err) {
        throw new Error(`git clone failed for ${target.repo} — check network and credentials (exit ${err.status})`);
      }
      return {
        dir, historyDir: dir, label: target.repo, kind: 'repo', cleanup, notes,
      };
    }

    let stat;
    try { stat = fs.statSync(target.path); } catch (err) {
      throw new Error(`target path for this system does not exist: ${target.path} (${err.code})`);
    }
    if (!stat.isDirectory()) throw new Error(`target path is not a directory: ${target.path}`);

    fs.mkdirSync(dir, { recursive: true });

    const tracked = gitFiles(target.path, run);
    const files = tracked || walkFiles(target.path);
    const historyDir = tracked ? target.path : null;
    if (!tracked) {
      notes.push(
        `${target.path} is not a git repository: copying everything outside a fixed list of `
        + 'build directories, and change coupling will be unmeasured',
      );
    }

    const { copied, symlinks, unreadable } = copyFiles(target.path, dir, files);

    // An empty tree measures clean on every criterion. That is the one outcome
    // a scanner must never produce quietly.
    if (copied === 0) {
      throw new Error(
        `no files to scan under ${target.path} — refusing to run, because an empty tree `
        + 'scores clean on every criterion',
      );
    }

    notes.push(
      `${copied} files copied from ${target.path}`
      + (tracked ? ' (tracked and untracked, ignore rules applied)' : '')
      + (symlinks ? `; ${symlinks} symlinks skipped` : '')
      + (unreadable ? `; ${unreadable} unreadable` : ''),
    );

    return {
      dir, historyDir, label: target.path, kind: 'path', cleanup, notes,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = {
  targetOf, materialise, gitFiles, walkFiles, copyFiles, NON_SOURCE_DIRS,
};


/***/ }),

/***/ 922:
/***/ ((module) => {



// Pure helpers for C6 Test Coverage: file classification (source vs test per
// stack), test<->source pairing, and coverage-tooling + threshold detection.
// No I/O — the scan edge (scan-test-coverage.js) reads files and calls these.
// Pairing is basename-stem based (a file-presence proxy, NOT line coverage);
// the precise per-unit map is a post-MVP C1 code-graph enhancement.

const SKIP_DIRS = new Set([
  'node_modules', 'deps', '_build', '.git', '.elixir_ls', 'tmp', 'vendor',
  'priv', '.agents', 'cover', 'coverage', 'dist', 'build',
]);

const norm = (p) => String(p).replace(/\\/g, '/');

function sourceStem(relPath) {
  return norm(relPath).split('/').pop().replace(/\.(ex|rb|js|ts|jsx|tsx|vue|py)$/, '');
}

function testStem(relPath) {
  let s = norm(relPath).split('/').pop()
    .replace(/_test\.exs$/, '')
    .replace(/_(test|spec)\.rb$/, '')
    .replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
  if (/\.py$/.test(s)) s = s.replace(/\.py$/, '').replace(/^test_/, '').replace(/_test$/, '');
  return s;
}

function aggregateStack(sourcePaths, testPaths, sampleCap = 20) {
  const testStems = new Set(testPaths.map(testStem));
  const untested = [];
  let tested = 0;
  for (const s of sourcePaths) {
    if (testStems.has(sourceStem(s))) tested += 1;
    else if (untested.length < sampleCap) untested.push(norm(s));
  }
  return { source_files: sourcePaths.length, tested_files: tested, untested_samples: untested };
}

function detectThresholds(text) {
  const out = [];
  // `target:` is anchored (not preceded by a word char/./-) so a coverage
  // `target: 80%` matches but a compound key like `bundle_size_target: 90`
  // does not — otherwise any *_target key would forge an enforced threshold.
  const re = /(?:minimum[_-]?coverage["']?\s*[:=]?\s*|SimpleCov\.minimum_coverage\s+|(?<![\w.-])target:\s*|--cov-fail-under[=\s]+)(\d{1,3})\b/gi;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(String(text)))) {
    const v = Number(m[1]);
    if (v > 0 && v <= 100) out.push(v);
  }
  return out;
}

function detectTool(stack, text) {
  const t = String(text);
  // Primary discipline signal is coverage ENFORCEMENT via GitHub Actions (gates every
  // PR), independent of stack or coverage library. cobertura-action is one such
  // gate; in the repos measured it covers both Elixir and frontend in place of
  // a language-specific coverage tool.
  if (/cobertura-action/i.test(t)) return 'cobertura-action';
  if (stack === 'elixir') {
    // "coveralls" catches excoveralls (dep), a coveralls.json file, and a `mix coveralls` CI task.
    if (/coveralls/i.test(t) || /test_coverage:\s*\[tool:\s*ExCoveralls/i.test(t)) return 'excoveralls';
  } else if (stack === 'ruby') {
    if (/simplecov/i.test(t)) return 'simplecov';
  } else if (stack === 'frontend') {
    if (/vitest|jest|nyc\b|\bc8\b|@vitest\/coverage/i.test(t)) return 'vitest/jest';
  } else if (stack === 'python') {
    if (/pytest-cov|coverage\.py|--cov\b|\bcov=|codecov/i.test(t)) return 'coverage.py';
  }
  return null;
}

module.exports = {
  SKIP_DIRS, aggregateStack, detectThresholds, detectTool,
};


/***/ }),

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the module cache
/******/ 	__nccwpck_require__.c = __webpack_module_cache__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/******/ 	/* webpack/runtime/node module decorator */
/******/ 	(() => {
/******/ 		__nccwpck_require__.nmd = (module) => {
/******/ 			module.paths = [];
/******/ 			if (!module.children) module.children = [];
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// module cache are used so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	var __webpack_exports__ = __nccwpck_require__(__nccwpck_require__.s = 782);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;