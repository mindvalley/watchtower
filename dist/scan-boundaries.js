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

/***/ 761:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure C1 (Clear Domain Boundaries) signals. A module is a unit the repo
// DECLARES. We read each workspace declaration for its member globs rather than
// walking for manifests -- a manifest walk promotes Phoenix's assets/package.json
// to a module, the trap the C6 parity gate caught.

const MANIFESTS = ['package.json', 'mix.exs', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile'];

// Directories organised by architectural LAYER rather than by domain. Layers
// legitimately depend on each other, so cycles among them are not defects --
// such a repo is indeterminate, not red.
const LAYER_VOCABULARY = new Set([
  'models', 'model', 'controllers', 'controller', 'views', 'view', 'helpers',
  'services', 'workers', 'jobs', 'serializers', 'mailers', 'validators',
  'presenters', 'policies', 'decorators', 'middleware', 'listeners', 'uploaders',
]);

// Top-level directory names that are infrastructure / asset containers, not
// domain modules. These are excluded from the sibling-projects check so that
// some Phoenix repos (which have assets/ and assets2/ at the root) fall through
// to source-namespace discovery rather than being misidentified as
// sibling-projects.
const SIBLING_EXCLUSIONS = new Set([
  'assets', 'static', 'public', 'priv', 'config', 'test', 'tests', 'spec',
  'scripts', 'docs', 'doc', 'vendor', 'tmp', 'log', 'logs', 'media',
]);

function isSiblingExcluded(name) {
  if (SIBLING_EXCLUSIONS.has(name)) return true;
  // Exclude numbered variants of common asset dirs: assets2, assets3, static2…
  if (/^assets\d+$/.test(name)) return true;
  if (/^static\d+$/.test(name)) return true;
  return false;
}

// Source files that indicate a directory is a module, not just a container.
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|ex|exs|rb|py|go|rs|java|kt|php|swift|scala|c|cc|cpp|h|hpp|cs)$/;

// ─── Path exclusions ─────────────────────────────────────────────────────────
//
// Two DISTINCT exclusion sets, applied to different things on purpose.
//
// NON_SOURCE_DIRS: directories that hold build output, vendored code, editor
// state or Phoenix runtime assets. Nothing in them is repo-authored source, so
// they are excluded from BOTH the dependency graph and the external-target
// detector. Mirrors SKIP_DIRS in test-coverage-signals.js (the same list the C6
// scanner already settled on) plus the walk excludes scan-boundaries.js had.
const NON_SOURCE_DIRS = new Set([
  '.git', 'node_modules', 'deps', '_build', '.elixir_ls', 'tmp', 'vendor',
  'priv', '.agents', 'cover', 'coverage', 'dist', 'build', 'target',
  '__pycache__', '.venv', 'graphify-out', 'out', '.next', '.turbo', '.nuxt',
]);

// Minified / bundled JavaScript. SOURCE_EXT matches `.min.js`, so a single
// committed Phoenix `priv/static/js/app.js`-style bundle would otherwise
// contribute hundreds of URL literals to the external-target count. Bundles are
// generated artifacts, never a call site anyone wrote.
const BUNDLE_FILE = /(\.min\.(js|mjs|cjs|css)|[.-]bundle\.(js|mjs|cjs)|\.pack\.js|\.chunk\.js)$/i;

// Test / fixture / mock / cassette paths. This is the shared path allowlist that
// scripts/benchmark/triage-config.json already applies to every file-scanning C9
// tool -- the same test/fixture/mock/cassette noise trips every scanner, so the
// list is read from that file rather than duplicated here (see
// _exclude_paths_note in triage-config.json). A few C1-specific shapes that the
// C9 globs do not name (Jest/Vitest `__tests__`, `*.test.ts`, `*_test.exs`,
// `*_spec.rb`, `test_*.py`, factories) are added on top.
//
// Applied ONLY to the external-target detector, NOT to the dependency graph:
// a test file that imports across a module boundary is still a real code
// dependency and dropping it would risk a false green on cycles, whereas a URL
// literal in a fixture is never an outbound call the system makes.
const TRIAGE_CONFIG = __nccwpck_require__(768);
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);
}
const SHARED_EXCLUDE_PATH_RES = (TRIAGE_CONFIG.exclude_paths || []).map(globToRegExp);
const C1_EXTRA_TEST_PATH_RE = /(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|spec|specs|fixtures?|mocks?|cassettes?|factories|testdata|e2e|examples?|sample_data)(\/|$)|(^|\/)(conftest|jest\.setup|test[_-]?config|setup-tests?)\.[a-z]+$|\.(test|spec|stories|cy|e2e)\.[a-z]+$|_(test|spec)\.(rb|ex|exs|py|go)$|(^|\/)test_[^/]*\.py$/i;

function isNonSourcePath(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  if (BUNDLE_FILE.test(p)) return true;
  return p.split('/').some((seg) => NON_SOURCE_DIRS.has(seg));
}

function isTestOrFixturePath(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  if (C1_EXTRA_TEST_PATH_RE.test(p)) return true;
  return SHARED_EXCLUDE_PATH_RES.some((re) => re.test(p));
}

function isLayerShaped(names) {
  if (!names.length) return false;
  const layerNames = names.filter((n) => LAYER_VOCABULARY.has(n.toLowerCase()));
  return layerNames.length > 0;
}

const SOURCE_ROOTS = ['lib/', 'src/', 'app/'];

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i + 1);
}

// Expand one glob like 'apps/*' against the file list, keeping dirs that hold a manifest.
function expandGlob(glob, base, files) {
  const g = glob.replace(/^\.\//, '').replace(/\/+$/, '');
  const star = g.indexOf('*');
  const out = new Set();
  for (const f of files) {
    if (base && !f.startsWith(base)) continue;
    const rel = base ? f.slice(base.length) : f;
    const relDir = dirOf(rel);
    if (!relDir) continue;
    const segs = relDir.split('/').filter(Boolean);
    if (star === -1) {
      // Important 1: Apply manifest check to no-star branch too
      if (relDir === `${g}/`) {
        const candidate = base + relDir;
        if (MANIFESTS.some((m) => files.includes(candidate + m))) out.add(candidate);
      }
      continue;
    }
    const prefixSegs = g.split('/').filter(Boolean);

    // Important 2: Handle ** globs matching one or more segments
    const hasDoublestar = prefixSegs.includes('**');
    if (hasDoublestar) {
      // ** pattern: match if all non-** segments match and segs.length >= prefixSegs.length - 1
      const nonStarCount = prefixSegs.filter(ps => ps !== '**').length;
      if (segs.length < nonStarCount + 1) continue;
      const matches = prefixSegs.every((ps, i) => {
        if (ps === '**') {
          // ** must be at the end and match one or more segments
          return i === prefixSegs.length - 1;
        }
        if (ps === '*') return true;
        return ps === segs[i];
      });
      if (!matches) continue;
    } else {
      // Single * pattern: exact segment count match required
      if (segs.length !== prefixSegs.length) continue;
      const matches = prefixSegs.every((ps, i) => ps === '*' || ps === segs[i]);
      if (!matches) continue;
    }
    const candidate = base + segs.join('/') + '/';
    if (MANIFESTS.some((m) => files.includes(candidate + m))) out.add(candidate);
  }
  return [...out];
}

function asModules(prefixes) {
  return prefixes.sort().map((prefix) => ({ name: prefix.replace(/\/$/, ''), prefix }));
}

// Read ONLY the `packages:` sequence out of pnpm-workspace.yaml, and split
// `!`-prefixed entries out as negations. The previous reader harvested every
// `- item` line in the file, which swept in unrelated top-level sequences
// (`onlyBuiltDependencies:`, `catalog:`, `ignoredBuiltDependencies:`) and
// silently ignored negations. Both change the module count, and the module
// count is the fan-out denominator.
//
// Hand-rolled rather than a YAML dependency: we need one key from a file whose
// shape is a flat block sequence, and the scanner set carries no YAML parser.
function parsePnpmPackages(text) {
  const includes = [];
  const excludes = [];
  const lines = String(text).split('\n');
  let inBlock = false;
  let blockIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const keyMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (keyMatch && !/^\s*-/.test(line)) {
      // A new mapping key. Enter the block on `packages:`, leave it on any
      // other key at or above the block's own indent.
      if (keyMatch[2] === 'packages' && !keyMatch[3].trim()) {
        inBlock = true;
        blockIndent = indent;
      } else if (inBlock && indent <= blockIndent) {
        inBlock = false;
      }
      continue;
    }
    if (!inBlock) continue;
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!item) continue;
    if (indent <= blockIndent) { inBlock = false; continue; }
    const value = item[1].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
    if (!value) continue;
    if (value.startsWith('!')) excludes.push(value.slice(1));
    else includes.push(value);
  }
  return { includes, excludes };
}

function discoverModules({ files, readText }) {
  const has = (p) => files.includes(p);
  let lastFoundDeclaration = null;

  // Elixir umbrella, at any depth. Checked first because an apps_path declaration
  // is the authoritative structural statement for an Elixir project. Some repos
  // carry both a mix.exs umbrella AND a pnpm-workspace.yaml (for JS assets inside
  // each app); the umbrella must win.
  for (const f of files) {
    if (!f.endsWith('mix.exs')) continue;
    const txt = readText(f) || '';
    // Minor 4: Accept either single or double quotes
    const m = txt.match(/apps_path:\s*['"]([^'"]+)['"]/);
    if (!m) continue;
    const base = dirOf(f);
    const prefixes = expandGlob(`${m[1]}/*`, base, files);
    if (prefixes.length >= 2) return { kind: 'elixir-umbrella', modules: asModules(prefixes), reason: null };
    // Important 3: Track declarations that were found but under-threshold
    lastFoundDeclaration = { kind: 'elixir-umbrella', count: prefixes.length };
  }

  // pnpm workspace
  if (has('pnpm-workspace.yaml')) {
    const { includes, excludes } = parsePnpmPackages(readText('pnpm-workspace.yaml') || '');
    const excludeRes = excludes.map((g) => globToRegExp(g.replace(/\/+$/, '')));
    const prefixes = includes
      .flatMap((g) => expandGlob(g, '', files))
      .filter((p) => !excludeRes.some((re) => re.test(p.replace(/\/$/, ''))));
    if (prefixes.length >= 2) return { kind: 'pnpm-workspace', modules: asModules(prefixes), reason: null };
    // Important 3: Track declarations that were found but under-threshold
    if (includes.length > 0) lastFoundDeclaration = { kind: 'pnpm-workspace', count: prefixes.length };
  }

  // package.json workspaces
  if (has('package.json')) {
    let pkg = {};
    try { pkg = JSON.parse(readText('package.json') || '{}'); } catch { pkg = {}; }
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && pkg.workspaces.packages) || [];
    const prefixes = ws.flatMap((g) => expandGlob(g, '', files));
    if (prefixes.length >= 2) return { kind: 'npm-workspace', modules: asModules(prefixes), reason: null };
    // Important 3: Track declarations that were found but under-threshold
    if (ws.length > 0) lastFoundDeclaration = { kind: 'npm-workspace', count: prefixes.length };
  }

  // UV workspace (Python). Detects [tool.uv.workspace] in the root pyproject.toml.
  // uv is the modern Python package/workspace manager; its workspace declaration is
  // analogous to pnpm-workspace.yaml and should be discovered the same way.
  if (has('pyproject.toml')) {
    const txt = readText('pyproject.toml') || '';
    // Match the [tool.uv.workspace] section and extract members list
    const uvSection = txt.match(/\[tool\.uv\.workspace\]([\s\S]*?)(?=\n\[|$)/);
    if (uvSection) {
      const membersMatch = uvSection[1].match(/\bmembers\s*=\s*\[([^\]]+)\]/);
      if (membersMatch) {
        const globs = [...membersMatch[1].matchAll(/["']([^"']+)["']/g)].map((gm) => gm[1]);
        const prefixes = globs.flatMap((g) => expandGlob(g, '', files));
        if (prefixes.length >= 2) return { kind: 'uv-workspace', modules: asModules(prefixes), reason: null };
        if (globs.length > 0) lastFoundDeclaration = { kind: 'uv-workspace', count: prefixes.length };
      }
    }
  }

  // Sibling projects: top-level dirs each holding their own manifest.
  // Exclude well-known infrastructure/asset directories (assets, static, priv, etc.)
  // that are not domain modules. Without this, some Phoenix repos (which have
  // assets/ and assets2/ at the root for Phoenix JS compilation) are misidentified
  // as sibling-projects instead of falling through to source-namespace discovery.
  const siblings = new Set();
  for (const f of files) {
    const segs = f.split('/');
    if (segs.length === 2 && MANIFESTS.includes(segs[1])) siblings.add(`${segs[0]}/`);
  }
  const filteredSiblings = [...siblings].filter((p) => !isSiblingExcluded(p.replace(/\/$/, '')));
  if (filteredSiblings.length >= 2) return { kind: 'sibling-projects', modules: asModules(filteredSiblings), reason: null };
  // A single stray top-level manifest directory is NOT a declaration. Unlike a
  // workspace declaration (which is an authoritative statement by the repo about
  // its own structure and so short-circuits), sibling-projects is a heuristic
  // read of the directory layout. One match means the heuristic did not fire, so
  // it must fall through to the source-namespace fallback rather than returning
  // indeterminate before lib/* is ever tried.
  const underThresholdSiblings = filteredSiblings.length;

  // Important 3: a WORKSPACE DECLARATION that resolved fewer than two members is
  // authoritative and terminal -- the repo said what its modules are and there
  // are not two of them.
  if (lastFoundDeclaration) {
    return {
      kind: 'indeterminate',
      modules: [],
      reason: `${lastFoundDeclaration.kind} declared but only ${lastFoundDeclaration.count} member${lastFoundDeclaration.count === 1 ? '' : 's'} resolved; cross-module coupling is undefined below two modules`,
    };
  }

  // Fallback: top-level source-namespace directories under a known source root.
  for (const root of SOURCE_ROOTS) {
    const dirs = new Set();
    const dirSourceFiles = new Map();
    for (const f of files) {
      if (!f.startsWith(root)) continue;
      const rest = f.slice(root.length);
      const seg = rest.split('/')[0];
      if (seg && rest.includes('/')) {
        const dirKey = `${root}${seg}/`;
        dirs.add(dirKey);
        if (SOURCE_EXT.test(f)) {
          if (!dirSourceFiles.has(dirKey)) dirSourceFiles.set(dirKey, []);
          dirSourceFiles.get(dirKey).push(f);
        }
      }
    }
    // Only count directories with source files
    const dirsWithSource = [...dirs].filter((d) => dirSourceFiles.has(d));
    if (dirsWithSource.length < 2) continue;
    const names = dirsWithSource.map((d) => d.slice(root.length).replace(/\/$/, ''));
    if (isLayerShaped(names)) {
      const layerNames = names.filter((n) => LAYER_VOCABULARY.has(n.toLowerCase()));
      return {
        kind: 'indeterminate',
        modules: [],
        reason: `layer-organised: ${root} mixes architectural layers (${layerNames.join(', ')}) with domains; boundaries are not cleanly separated`,
      };
    }
    return { kind: 'source-namespace', modules: asModules(dirsWithSource), reason: null };
  }

  if (underThresholdSiblings > 0) {
    return {
      kind: 'indeterminate',
      modules: [],
      reason: `only ${underThresholdSiblings} top-level project director${underThresholdSiblings === 1 ? 'y' : 'ies'} with a manifest, and no multi-module source namespace under lib/, src/ or app/; cross-module coupling is undefined below two modules`,
    };
  }

  return {
    kind: 'indeterminate',
    modules: [],
    reason: 'No workspace declaration, sibling-project layout, or multi-module source-namespace recognised',
  };
}

// ─── Which graphify relations are dependencies ───────────────────────────────
//
// This is a DENYLIST, not an allowlist. An allowlist of three relations was the
// original defect: it silently dropped every relation the author had not thought
// of, and it would silently drop any relation a future graphify release adds.
// A denylist plus a per-relation audit block in the report means an unrecognised
// relation counts by default and is visible in the output either way.
//
// The rationale for each exclusion, and the decision to exclude `references`,
// come from running `graphify extract --code-only` (0.9.28) over one real repo
// per stack -- an Elixir umbrella, a Ruby monolith, a TypeScript monorepo and a
// Python monorepo -- and counting, per relation, how many EXTRACTED links exist
// and how many cross a declared module boundary.
//
// Measured relation universe across those four repos (nothing else was emitted;
// the relations `includes`, `instantiates`, `uses_component`, `uses_static_prop`,
// `references_constant`, `binds_method` and `crate_depends_on` do NOT occur in
// any of our four stacks at this graphify version):
//   calls, contains, method, imports, imports_from, references, re_exports,
//   inherits, implements, extends, mixes_in, defines, cites, rationale_for,
//   depends_on, dynamic_import, indirect_call, uses
const NON_DEPENDENCY_RELATIONS = new Map([
  // Structural, not dependency: file -> symbol containment.
  ['contains', 'file->symbol containment; structural, not a dependency'],
  // Structural: class/module -> its own method definition.
  ['method', 'declaring type -> its own method; structural, not a dependency'],
  ['defines', 'symbol definition site; structural, not a dependency'],
  // Documentation/provenance annotations graphify attaches to doc comments.
  ['rationale_for', 'doc-comment provenance annotation, not code'],
  ['cites', 'doc-comment citation annotation, not code'],
  // Confidence is INFERRED, never EXTRACTED, in every repo measured; listed so
  // the exclusion is explicit rather than an accident of the confidence filter.
  ['indirect_call', 'INFERRED confidence only; not a resolved dependency'],
  ['uses', 'INFERRED confidence only in every repo measured'],
  // `references` is graphify's UNRESOLVED bare-name relation: it links a symbol
  // to any same-named symbol anywhere in the repo, with no import backing.
  // Measured contribution: in the TypeScript monorepo it produced 7 cross-module
  // pairs, 5 of which were already carried by `imports`, and 2 of which are
  // demonstrably false -- one app "depends on" another only because a NestJS
  // `Module` decorator resolves to a symbol named `Module` in the other app's
  // jest setup file, and a second pair resolves `queryClient` to a same-named
  // module in a sibling app that has its own. In the Python monorepo it produced
  // 7 pairs, 6 already carried by `imports_from` and 1 false, resolving through
  // a same-named React component. In the Elixir repos it produced 0. Across four
  // repos it added zero true edges and three false ones, so it is excluded: a
  // false edge is a false-red risk on fan-out and a false cycle.
  ['references', 'unresolved bare-name matching; measured 0 true / 3 false cross-module pairs across four repos'],
]);

// Everything NOT in the denylist counts. Kept as an exported name for callers
// and tests that want to assert the classification.
function isDependencyRelation(relation) {
  return !NON_DEPENDENCY_RELATIONS.has(relation);
}

// Retained for backwards compatibility with the original export. It now lists
// the relations measured to actually produce cross-module edges in our stacks
// (imports, imports_from, calls, re_exports, inherits, implements) rather than
// gating on them -- gating is done by isDependencyRelation.
const DEPENDENCY_RELATIONS = new Set([
  'calls', 'imports', 'imports_from', 're_exports', 'inherits', 'implements',
]);

// ─── Language families ───────────────────────────────────────────────────────
//
// graphify resolves a symbol reference by NAME across the whole repo, with no
// language check. In a polyglot monorepo that produces links between files that
// cannot possibly depend on each other -- measured in a polyglot Python and
// TypeScript monorepo, where a `get_alembic_config()` helper in a Python
// migration module "calls" a class named `Config` in a TypeScript utility file
// in a sibling app. No AST in either
// language can express that edge, so a link whose endpoints are in different
// language families is a name collision by construction.
const LANGUAGE_FAMILY_BY_EXT = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  ex: 'elixir', exs: 'elixir',
  rb: 'ruby',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'jvm', kt: 'jvm', scala: 'jvm',
  php: 'php', swift: 'swift', cs: 'dotnet',
  c: 'c', cc: 'c', cpp: 'c', h: 'c', hpp: 'c',
};

function languageFamily(filePath) {
  const p = String(filePath);
  const dot = p.lastIndexOf('.');
  if (dot === -1) return '';
  return LANGUAGE_FAMILY_BY_EXT[p.slice(dot + 1).toLowerCase()] || '';
}

// ─── Stdlib / builtin collision defence ──────────────────────────────────────
//
// graphify resolves a stdlib module reference to a same-named LOCAL file.
// Reproduced and hand-verified in two languages:
//   Elixir  -- `require Logger` in one umbrella app is resolved to a local
//              `logger.ex` defining a `Logger`-suffixed module in a DIFFERENT umbrella
//              app. In the two Elixir repos measured, all 9 cross-app links in
//              one and all 6 in the other are this bug, and both of the cycles
//              originally reported rest entirely on it.
//   Python  -- `import logging` / `import json` resolve to a local logging.py /
//              json.py the same way.
//   Ruby    -- `require 'set'` / `'logger'` / `'json'` has the identical shape.
//
// Defence: for IMPORT-SHAPED relations only (the relation kind that carries a
// module reference), drop the link when the target file's basename stem matches
// a stdlib or builtin module name for that file's language. Restricted to
// import-shaped relations because that is the mechanism of the bug, and because
// a wider rule would drop genuine call edges into locally-named helpers.
//
// Measured cost across the four investigation repos: ZERO true cross-module
// edges lost. The only cross-module edges removed are the Logger collisions
// above; in the TypeScript monorepo the guard fires 6 times and every hit is an
// intra-module import of a local `crypto.ts` helper, which never was an edge.
const IMPORT_SHAPED_RELATIONS = new Set([
  'imports', 'imports_from', 're_exports', 'requires', 'includes', 'dynamic_import',
]);

// Node's own builtin list, read from the runtime rather than transcribed.
const NODE_BUILTINS = (__nccwpck_require__(995).builtinModules)
  .filter((m) => !m.startsWith('_') && !m.includes('/'));

// Python 3 stdlib top-level module names (sys.stdlib_module_names, private and
// platform-only entries dropped).
const PYTHON_STDLIB = `abc argparse array ast asyncio atexit base64 binascii bisect builtins bz2
calendar cmath cmd code codecs collections colorsys concurrent configparser contextlib contextvars
copy copyreg csv ctypes dataclasses datetime dbm decimal difflib dis email enum errno faulthandler
filecmp fileinput fnmatch fractions functools gc getopt getpass gettext glob graphlib gzip hashlib
heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale
logging lzma mailbox marshal math mimetypes mmap modulefinder multiprocessing netrc numbers operator
optparse os pathlib pdb pickle pickletools pkgutil platform plistlib poplib pprint profile pstats
pty pwd queue quopri random re readline reprlib resource sched secrets select selectors shelve shlex
shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct
subprocess symtable sys sysconfig syslog tarfile tempfile textwrap threading time timeit token
tokenize traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv warnings wave
weakref webbrowser wsgiref xml xmlrpc zipapp zipfile zlib zoneinfo`.split(/\s+/).filter(Boolean);

// Elixir/OTP stdlib module names as they would appear as file basenames
// (Macro.underscore of the module name).
const ELIXIR_STDLIB = `logger kernel enum map list string integer float atom task agent gen_server
genserver supervisor dynamic_supervisor registry process node system file path io stream date time
date_time naive_date_time calendar regex uri base code module macro application exception protocol
port keyword map_set range tuple version access bitwise function inspect record behaviour ets dets
mnesia crypto erlang binary bitstring char_list collectable comparable enumerable string_io
system_time timer config`.split(/\s+/).filter(Boolean);

// Ruby stdlib / default-gem names.
const RUBY_STDLIB = `set logger json csv uri time date digest socket erb yaml ostruct pathname
fileutils securerandom base64 openssl stringio tempfile timeout benchmark forwardable singleton
observer delegate open3 optparse pp prime rational complex thread monitor weakref abbrev shellwords
resolv ipaddr etc fcntl zlib psych rexml English objspace ripper readline getoptlong`
  .split(/\s+/).filter(Boolean);

const STDLIB_BY_FAMILY = {
  js: new Set(NODE_BUILTINS),
  python: new Set(PYTHON_STDLIB),
  elixir: new Set(ELIXIR_STDLIB),
  ruby: new Set(RUBY_STDLIB),
};

function basenameStem(filePath) {
  const p = String(filePath);
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

// True when `filePath` has the basename of a stdlib/builtin module for its own
// language -- i.e. it is a candidate for graphify's name-based misresolution.
function isStdlibCollidingFile(filePath) {
  const fam = languageFamily(filePath);
  const names = STDLIB_BY_FAMILY[fam];
  return !!names && names.has(basenameStem(filePath));
}

function moduleForFile(filePath, modules) {
  let best = null;
  for (const m of modules) {
    if (filePath.startsWith(m.prefix) && (!best || m.prefix.length > best.prefix.length)) best = m;
  }
  return best ? best.name : null;
}

function isManifestPath(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  return MANIFESTS.includes(base);
}

function buildModuleGraph(graph, modules) {
  const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = [];
  const skippedManifestNodes = new Set();
  let skippedCrossLanguageEdges = 0;
  let skippedStdlibCollisionEdges = 0;
  let skippedNonSourcePathEdges = 0;

  // Per-relation audit: every relation graphify emitted, whether we counted it,
  // and how many of its links crossed a module boundary. Emitted into the report
  // so the classification above is inspectable rather than asserted.
  const relations = {};
  const bump = (rel, field) => {
    if (!relations[rel]) {
      relations[rel] = {
        total: 0,
        extracted: 0,
        considered: 0,
        cross_module_links: 0,
        counted: isDependencyRelation(rel),
        excluded_reason: NON_DEPENDENCY_RELATIONS.get(rel) || null,
      };
    }
    relations[rel][field] += 1;
  };

  // Direction evidence backs the corroboration rule in findModuleCycles: how
  // many links support each module->module direction, and how many of those
  // land on a stdlib-colliding filename.
  const directions = new Map();

  for (const l of graph.links || []) {
    const rel = l.relation;
    bump(rel, 'total');
    if (l.confidence !== 'EXTRACTED') continue;
    bump(rel, 'extracted');
    if (!isDependencyRelation(rel)) continue;
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t) continue;
    const sf = s.source_file || '';
    const tf = t.source_file || '';
    if (!sf || !tf) continue;
    if (isManifestPath(sf)) { skippedManifestNodes.add(l.source); continue; }
    if (isManifestPath(tf)) { skippedManifestNodes.add(l.target); continue; }
    // Require both ends to be source-code files. Config/asset files (e.g. .json,
    // .yaml, .oxlintrc.json, babel.config.json) appear as edge targets when
    // graphify's static analyser traces configuration imports; they are not runtime
    // module dependencies and create spurious cross-module cycles.
    if (!SOURCE_EXT.test(sf) || !SOURCE_EXT.test(tf)) continue;
    // Build output, vendored trees and minified bundles are not repo source.
    // Test paths are deliberately NOT excluded here: a test importing across a
    // module boundary is a real code dependency, and dropping it would risk a
    // false green on cycles.
    if (isNonSourcePath(sf) || isNonSourcePath(tf)) { skippedNonSourcePathEdges += 1; continue; }
    // Cross-language links are name collisions by construction (see above).
    const sFam = languageFamily(sf);
    const tFam = languageFamily(tf);
    if (!sFam || !tFam || sFam !== tFam) { skippedCrossLanguageEdges += 1; continue; }
    // Stdlib misresolution defence (see above).
    const targetCollides = isStdlibCollidingFile(tf);
    if (IMPORT_SHAPED_RELATIONS.has(rel) && targetCollides) {
      skippedStdlibCollisionEdges += 1;
      continue;
    }
    bump(rel, 'considered');
    const from = moduleForFile(sf, modules);
    const to = moduleForFile(tf, modules);
    if (!from || !to || from === to) continue;
    bump(rel, 'cross_module_links');
    const key = `${from}->${to}`;
    let dir = directions.get(key);
    if (!dir) {
      dir = { from, to, links: 0, stdlib_colliding_links: 0, relations: {} };
      directions.set(key, dir);
      edges.push([from, to]);
    }
    dir.links += 1;
    if (targetCollides) dir.stdlib_colliding_links += 1;
    dir.relations[rel] = (dir.relations[rel] || 0) + 1;
  }

  return {
    edges,
    directions: Object.fromEntries([...directions].map(([k, v]) => [k, v])),
    relations,
    skipped_manifest_nodes: skippedManifestNodes.size,
    skipped_cross_language_edges: skippedCrossLanguageEdges,
    skipped_stdlib_collision_edges: skippedStdlibCollisionEdges,
    skipped_non_source_path_edges: skippedNonSourcePathEdges,
  };
}

// A module->module direction is UNCORROBORATED when the only thing holding it up
// is a single link into a file whose basename collides with a stdlib module for
// its language. That is exactly the shape of the graphify misresolution above,
// and one link is not enough evidence to publish a cycle -- which is a red mark
// on somebody else's system -- against it.
function isUncorroboratedDirection(dir) {
  return !!dir && dir.links <= 1 && dir.stdlib_colliding_links >= 1;
}

// Johnson-style elementary cycle enumeration via DFS with an explicit bound.
// The bound is reported, never applied silently.
function findModuleCycles(edges, { maxCycles = 500, directions = {} } = {}) {
  const adj = new Map();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  }
  const nodes = [...new Set(edges.flat())].sort();
  const found = [];
  const seen = new Set();
  let dropped = 0;

  // normalise canonicalises a cycle to its lexicographically minimal rotation.
  // Retained even though next > start ensures `start` is always the minimum, because
  // this function is defensive: it remains correct if the ordering constraint is ever relaxed,
  // and its presence documents the cycle shape clearly for readers.
  const normalise = (cycle) => {
    const i = cycle.indexOf(cycle.reduce((m, c) => (c < m ? c : m), cycle[0]));
    return cycle.slice(i).concat(cycle.slice(0, i)).join('|');
  };

  for (const start of nodes) {
    const stack = [];
    const onStack = new Set();
    const dfs = (node) => {
      stack.push(node);
      onStack.add(node);
      for (const next of adj.get(node) || []) {
        if (next === start) {
          const key = normalise([...stack]);
          if (!seen.has(key)) {
            if (found.length >= maxCycles) dropped += 1;
            else { seen.add(key); found.push([...stack]); }
          }
        } else if (!onStack.has(next) && next > start) {
          // Critical invariant: next > start ensures each cycle is reached from exactly one
          // starting node, exactly once. Removing this condition causes the same cycle to be
          // visited from multiple start nodes, inflating dropped if bounded. This ordering
          // makes the dropped count safe: when cap is hit, a cycle's key is never added to
          // seen, so the same cycle is never double-counted across different starting nodes.
          dfs(next);
        }
      }
      stack.pop();
      onStack.delete(node);
    };
    dfs(start);
  }

  found.sort((a, b) => a.length - b.length);

  // Corroboration filter. A cycle is only scoreable if every direction in it is
  // corroborated (see isUncorroboratedDirection). An uncorroborated cycle is
  // still surfaced as a finding, with the weak direction named, but it does not
  // count -- publishing it would be a false red on another team's system.
  const uncorroborated = [];
  const scoreable = [];
  for (const cycle of found) {
    const weak = [];
    for (let i = 0; i < cycle.length; i += 1) {
      const key = `${cycle[i]}->${cycle[(i + 1) % cycle.length]}`;
      if (isUncorroboratedDirection(directions[key])) weak.push(key);
    }
    if (weak.length) uncorroborated.push({ cycle, weak_directions: weak });
    else scoreable.push(cycle);
  }

  return {
    count: scoreable.length + dropped,
    cycles: scoreable,
    bounded: dropped > 0,
    dropped,
    uncorroborated,
  };
}

// External call targets can be connection strings carrying credentials. Emit the
// HOST only — never userinfo, path, or query. Redaction is load-bearing: a malformed
// URI or any parse failure returns empty, never a guessed value. Under-reporting an
// external target is acceptable; leaking one character of a credential is not.
function redactTarget(raw) {
  let candidate = String(raw).trim();

  // Strip leading jdbc: if present, since URL() expects scheme://
  if (candidate.startsWith('jdbc:')) {
    candidate = candidate.slice(5);
  }

  try {
    const url = new URL(candidate);
    // Trust url.hostname alone. It handles userinfo, multiple @, ports, IPv6
    // brackets, and query strings correctly. Return empty on any parse failure.
    return url.hostname || '';
  } catch {
    // Malformed URI, missing scheme, or other parse error: return empty.
    // Under-reporting is safer than leaking a credential.
    return '';
  }
}

const URI_RE = /['"`]((?:jdbc:)?[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^'"`\s]+)['"`]/g;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

// ─── Call-site anchoring ─────────────────────────────────────────────────────
//
// The spec defines this metric as external coupling detected from "HTTP client
// construction with a base URL, service hostnames resolved at call sites,
// queue/topic publishes, and DB connections". The previous implementation
// matched ANY quoted scheme:// literal in any source file, which measured
// something else entirely: in one large repo it returned 245 distinct "external
// systems" including www.w3.org (an SVG xmlns), json-schema.org ($schema in a
// generated analytics file), example.com, avatar.url, cdn, home-123 and
// fonts.gstatic.com, and produced a mean fan-out of 57.5 against 1.17 on real
// module edges. In that repo 2377 of 3754 URI literals are in test paths.
//
// A URI literal now counts only when it can be anchored to a recognised
// client-construction or connection context. If it cannot be anchored, it does
// not count -- under-counting is the safe direction for a published grade.
//
// The recognition table below was built by grepping real repositories for which
// client libraries actually appear, not from memory. Counts are files, from one
// representative repo per stack:
//   Elixir:     HTTPoison 90, GoogleApi 48, Req 42, Finch 30, Neuron 19,
//               Broadway 19, Tesla 10, hackney 7, Mint 6, Ecto.Repo 5
//   TypeScript: fetch 97, PrismaClient 58, connectionString 38, axios 28,
//               baseURL 13, ky 4, createClient 2, node-fetch 1
//   Python:     psycopg 26, requests 20, base_url 17, httpx 11, AsyncClient 8,
//               redis 6, urllib 3, create_engine 2
//   Ruby:       Sidekiq 22, HTTParty 1, RestClient 1
//
// Anchors are matched against a small window: the two lines preceding the
// literal plus the part of its own line before it. That covers both
// `HTTPoison.get("https://…")` and a client options map whose base URL sits on
// its own line.
// Option keys that NAME an endpoint. These must sit immediately before the
// literal ($-terminated), because a key only anchors the value it introduces.
// Deliberately does NOT include bare `url` / `uri` / `href` / `src` -- in one
// large Elixir repo those are overwhelmingly content links and seed data (626
// `url:` hits, almost all asset and marketing URLs), which is the noise this
// rebuild exists to remove.
const ENDPOINT_KEY_ANCHORS = [
  /\b(base_?url|base_?uri|base_?address|api_?url|api_?base(_?url)?|api_?host|service_?url|server_?url|graphql_?endpoint|endpoint(s|_?url)?|jwks_?url|token_?url|issuer|authorization_?endpoint|discovery_?url|webhook_?url|upstream|proxy_?url)\b\s*[:=>]*\s*[[{(]?\s*$/i,
  /\b(connection_?string|database_?url|db_?url|datasource|dsn|conn_?str|brokers?|bootstrap_?servers|queue_?url|topic_?arn|redis_?url|amqp_?url|mongo_?url|mongodb_?uri)\b\s*[:=>]*\s*[[{(]?\s*$/i,
];

// Client libraries and connection/publish constructors. These may appear
// anywhere in the window: an option key can sit between the constructor and the
// literal (`Faraday.new(url: "…")`), and the call can be opened on an earlier
// line. Naming one of these libraries at a call site IS the anchor.
//
// Built from grepping the real repos, not from memory -- see the counts above.
const CLIENT_ANCHORS = [
  // -- JS/TS HTTP clients and URL construction
  /\baxios\s*(\.\s*[A-Za-z]+\s*)?\(/,
  /\b(fetch|ofetch|\$fetch|nodeFetch)\s*\(/,
  /\b(got|ky|superagent|needle|undici)\s*(\.\s*[A-Za-z]+\s*)?\(/,
  /\bnew\s+(URL|Request|WebSocket|EventSource)\s*\(/,
  // -- JS/TS datastore and transport clients
  /\bnew\s+(Pool|Client|MongoClient|Redis|Kafka|IORedis|PrismaClient)\s*\(/,
  /\b(createClient|createPool|createConnection|createTransport|createServer)\s*\(/,
  /\bmongoose\s*\.\s*connect\s*\(/,
  // -- Elixir HTTP clients (HTTPoison 90 files, GoogleApi 48, Req 42, Finch 30,
  //    Neuron 19, Tesla 10, hackney 7, Mint 6 across the Elixir repos measured)
  /\b(HTTPoison|Tesla|Finch|Neuron|OAuth2\.Client|GoogleApi)\b[A-Za-z0-9_.]*\s*\(/,
  /\bReq\s*\.\s*(get|post|put|patch|delete|head|request|new)\s*[(!]/,
  /\bMint\.HTTP\s*\.\s*connect\s*\(/,
  /:(hackney|httpc|gun)\b/,
  /\b(with_base_url|put_base_url|build_url)\s*\(/,
  // -- Ruby HTTP clients (Sidekiq 22, HTTParty 1, RestClient 1 in the Ruby repo)
  /\b(Faraday|HTTParty|RestClient|Excon|Typhoeus|OpenURI)\b[A-Za-z0-9_.]*\s*[(.]/,
  /\bNet::HTTP\b/,
  // -- Python HTTP clients (requests 20 files, httpx 11, AsyncClient 8,
  //    urllib 3 in the Python repo)
  /\b(httpx|requests|aiohttp|urllib3|niquests)\s*(\.\s*[A-Za-z_]+)*\s*\(/,
  /\b(ClientSession|AsyncClient|urlopen)\s*\(/,
  // -- Python / SQLAlchemy / driver connections (psycopg 26, redis 6,
  //    create_engine 2)
  /\b(create_engine|create_async_engine|from_url|AsyncConnectionPool|ConnectionPool)\s*\(/,
  /\b(psycopg2?|asyncpg|redis|pymongo|MongoClient|clickhouse_connect)\s*(\.\s*[A-Za-z_]+)*\s*\(/,
  // -- Queue / topic publishes
  /\b(publish|publish_to|produce|send_message|sendMessage|enqueue|emit_event)\s*\(/,
];

// A URI whose SCHEME is a datastore or broker protocol anchors itself: nobody
// writes a `postgres://` or `amqp://` literal as display content. This is the
// "DB connections" and "queue/topic publishes" half of the spec's definition.
const CONNECTION_SCHEMES = new Set([
  'postgres', 'postgresql', 'mysql', 'mysql2', 'mariadb', 'cockroachdb',
  'mongodb', 'mongodb+srv', 'redis', 'rediss', 'valkey', 'memcached',
  'amqp', 'amqps', 'kafka', 'pulsar', 'nats', 'mqtt', 'mqtts', 'stomp',
  'clickhouse', 'mssql', 'sqlserver', 'oracle', 'cassandra', 'scylla',
  'elasticsearch', 'opensearch', 'influxdb', 'neo4j', 'bolt', 'ldap', 'ldaps',
  'grpc', 'grpcs', 'ecto', 'sqs', 'sns', 'nsq',
]);

// Hosts that are never a real external system.
//
// - No dot at all (`cdn`, `home-123`, `resource`): not a resolvable hostname;
//   these come from placeholder strings and templated fragments.
// - Documentation and placeholder domains reserved by RFC 2606 / RFC 6761, plus
//   the standards namespaces that turn up in XML/JSON boilerplate. `w3.org` is
//   the SVG `xmlns`; `json-schema.org` is a generated `$schema` key.
// - Literal placeholder words used in templates and doc examples.
const PLACEHOLDER_HOST_RE = /(^|\.)(example\.(com|org|net|edu)|example|test|invalid|localhost|local|w3\.org|json-schema\.org|schema\.org|placeholder|via\.placeholder\.com|your-[a-z0-9-]*|my-[a-z0-9-]*|some[_-]?url\.com|foo\.com|bar\.com|domain\.com|site\.com|host\.com|yourdomain\.com)$/i;

function isCountableHost(host) {
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return false;
  // Any unresolved interpolation marker: `${}` (JS), `{{}}` (templates), `#{}`
  // (Ruby/Elixir), and bare `{}` (Python f-strings, e.g. the literal host
  // `{settings.POSTGRES_USER}` seen in a Python repo).
  if (/[{}]/.test(host)) return false;
  // Bracketed IPv6 loopback already covered; bare hostnames with no dot are not
  // resolvable external systems.
  if (!host.includes('.') && !host.startsWith('[')) return false;
  if (PLACEHOLDER_HOST_RE.test(host)) return false;
  return true;
}

function schemeOf(raw) {
  const m = String(raw).match(/^(?:jdbc:)?([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  return m ? m[1].toLowerCase() : '';
}

// Detect external call targets in one file's text. `text` only -- path-level
// exclusion (tests, fixtures, bundles, non-source dirs) is the caller's job via
// isTestOrFixturePath / isNonSourcePath, so that this stays pure and testable.
//
// Returns { targets, anchored, unanchored } so the report can show how much was
// rejected for want of an anchor -- the bound is visible, never silent.
function detectExternalTargets(text) {
  const lines = String(text).split('\n');
  const targets = new Set();
  let anchored = 0;
  let unanchored = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('://')) continue;
    for (const m of line.matchAll(URI_RE)) {
      const host = redactTarget(m[1]);
      if (!isCountableHost(host)) continue;
      const scheme = schemeOf(m[1]);
      let ok = CONNECTION_SCHEMES.has(scheme) || String(m[1]).startsWith('jdbc:');
      if (!ok) {
        // Anchor window: the two lines preceding the literal plus this line up
        // to the literal. Endpoint-naming keys must be the last thing before the
        // value (tested per line, $-terminated); client libraries may appear
        // anywhere in the window, since an option key can sit between the
        // constructor and its value.
        const before = line.slice(0, m.index);
        const window = [
          i >= 2 ? lines[i - 2] : '',
          i >= 1 ? lines[i - 1] : '',
          before,
        ].map((w) => w.slice(-300));
        ok = ENDPOINT_KEY_ANCHORS.some((re) => window.some((w) => re.test(w)))
          || CLIENT_ANCHORS.some((re) => re.test(window.join('\n')));
      }
      if (ok) { anchored += 1; targets.add(host); } else { unanchored += 1; }
    }
  }
  return { targets: [...targets].sort(), anchored, unanchored };
}

// ─── Degenerate-graph test ───────────────────────────────────────────────────
//
// Replaces a cliff at exactly zero cross-module edges, which caught one repo
// (41,616 raw links, 0 edges) but let a comparable one through (70,047 raw
// links, 10 edges) even though there is no extractor-health difference between
// them.
//
// The measure is COVERAGE: the share of declared modules that appear in the
// dependency graph at all, as either end of at least one cross-module edge. A
// declared workspace member that the extractor connected to nothing is either
// genuinely standalone or unresolved, and we cannot tell which; when most of the
// declared modules are in that state, the graph is not a description of the
// system and must not be scored.
//
// Coverage is used rather than "edges / raw links" because module edges are
// DEDUPLICATED module pairs while raw links are per-symbol: for that second repo
// the ratio 10/70047 compares two different units and reads as 0.014% for a graph
// that actually resolves 4,800 cross-module links into 10 pairs among 13
// modules. Coverage compares like with like.
//
// Threshold chosen from the measured distribution across all 11 systems in the
// original study, which is strongly bimodal. Measured coverages, 2026-07-28:
//   0.000  x3   (extraction resolved nothing)
//   0.615  x1
//   0.667  x1
//   0.700  x1
//   0.800  x1
//   0.833  x1
//   0.900  x1
//   1.000  x1
// There is not one observation between 0% and 61.5%. 0.5 sits inside that empty
// gap and has an independent reading that does not depend on the sample: a
// majority of the modules a repo declares must be present in the graph before a
// grade is published about it.
const MODULE_GRAPH_COVERAGE_THRESHOLD = 0.5;

function moduleGraphCoverage(edges, modules) {
  const total = modules.length;
  if (!total) return { connected: 0, total: 0, coverage: 0 };
  const connected = new Set();
  for (const [from, to] of edges) { connected.add(from); connected.add(to); }
  const present = modules.filter((m) => connected.has(m.name)).length;
  return { connected: present, total, coverage: present / total };
}

function computeFanOut(edges, modules, externalByModule = {}) {
  const perModule = {};
  for (const m of modules) perModule[m.name] = new Set();
  for (const [from, to] of edges) {
    if (!perModule[from]) perModule[from] = new Set();
    // mod: and ext: namespacing is deliberate: an internal module and an external
    // host that happen to share a name are genuinely distinct dependencies.
    perModule[from].add(`mod:${to}`);
  }
  for (const [mod, targets] of Object.entries(externalByModule)) {
    if (!perModule[mod]) perModule[mod] = new Set();
    for (const t of targets) perModule[mod].add(`ext:${t}`);
  }
  const counts = {};
  for (const [k, v] of Object.entries(perModule)) counts[k] = v.size;
  const vals = Object.values(counts);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return { per_module: counts, mean };
}

module.exports = {
  discoverModules, isLayerShaped, LAYER_VOCABULARY, MANIFESTS, SOURCE_EXT,
  DEPENDENCY_RELATIONS, NON_DEPENDENCY_RELATIONS, isDependencyRelation,
  IMPORT_SHAPED_RELATIONS, languageFamily, isStdlibCollidingFile,
  isUncorroboratedDirection, moduleForFile, buildModuleGraph, findModuleCycles,
  redactTarget, detectExternalTargets, computeFanOut, parsePnpmPackages,
  isNonSourcePath, isTestOrFixturePath, NON_SOURCE_DIRS, BUNDLE_FILE,
  moduleGraphCoverage, MODULE_GRAPH_COVERAGE_THRESHOLD,
};


/***/ }),

/***/ 187:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Change coupling (Tornhill's "logical coupling") aggregated at module level.
//
// Two modules are change-coupled when they keep being edited in the same commit.
// That is behavioural evidence of a dependency, and unlike a code graph it does
// not depend on resolving a single symbol correctly -- which is why C1 uses it on
// stacks where the extractor under-resolves.
//
// The metric, its formula and its thresholds are code-maat's, the reference
// implementation. We reimplement it over `git log` rather than shipping the JVM
// jar, so we can aggregate at module level directly instead
// of file-level-then-roll-up. Only the implementation is ours; the definition and
// the anchor are established.
//
//   degree of coupling = shared revisions / AVERAGE revisions of the two modules
//
// The average denominator is code-maat's, verified in
// src/code_maat/analysis/logical_coupling.clj: "the number of shared revisions
// divided by the average number of revisions for the two coupled modules". An
// earlier draft of our spec said "the less-active member", which inflates the
// degree on asymmetric pairs and would have broken the anchor.

const { moduleForFile, isNonSourcePath } = __nccwpck_require__(761);

// code-maat's published command-line defaults, read from cmd_line.clj. These are
// the anchor: a published tool default, the same class of basis as McCabe <= 10.
// Not tuned, not chosen by us -- changing one is a methodology change.
const CODE_MAAT_DEFAULTS = Object.freeze({
  minRevs: 5, // -n: a module needs this many revisions to be considered at all
  minSharedRevs: 5, // -m: a pair needs this many co-changes
  minCoupling: 30, // -i: degree percentage below which a pair is coincidence
  maxChangesetSize: 30, // -s: commits touching more modules than this are swept, not coupled
});

// Dependency lockfiles move for reasons that have nothing to do with the module
// owning them -- a single `pnpm up` rewrites every lockfile in the workspace and
// would couple every module to every other. Excluded from the coupling signal.
const LOCKFILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json',
  'mix.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'Cargo.lock',
  'composer.lock', 'go.sum', 'Pipfile.lock',
]);

function isLockfile(p) {
  return LOCKFILES.has(String(p).slice(String(p).lastIndexOf('/') + 1));
}

// Parse `git log --no-merges --format=commit%x09%H --name-only`. Each record is a
// header line carrying the sha followed by the touched paths, one per line.
function parseGitLog(text) {
  const revisions = [];
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('commit\t')) {
      if (current && current.files.length) revisions.push(current);
      current = { sha: line.slice('commit\t'.length).trim(), files: [] };
      continue;
    }
    if (!line.trim()) continue;
    if (current) current.files.push(line.trim());
  }
  if (current && current.files.length) revisions.push(current);
  return revisions;
}

// Reduce each revision to the DISTINCT declared modules it touched. Revisions
// that touch more modules than the changeset cap are dropped, and the number
// dropped is returned so the bound is visible rather than silent.
function modulesPerRevision(revisions, modules, { maxChangesetSize } = CODE_MAAT_DEFAULTS) {
  const cap = maxChangesetSize == null ? CODE_MAAT_DEFAULTS.maxChangesetSize : maxChangesetSize;
  const out = [];
  let excluded = 0;
  for (const rev of revisions) {
    const touched = new Set();
    for (const f of rev.files) {
      if (isNonSourcePath(f) || isLockfile(f)) continue;
      const m = moduleForFile(f, modules);
      if (m) touched.add(m);
    }
    if (touched.size > cap) { excluded += 1; continue; }
    out.push({ sha: rev.sha, modules: [...touched].sort() });
  }
  return { revisions: out, excluded_oversized_changesets: excluded };
}

// Count revisions per module and co-changes per pair, then apply code-maat's
// three filters. Returns the coupled pairs plus the counts a reader needs to
// judge whether the repo had enough history to say anything at all.
function couplingPairs(revisions, options = {}) {
  const {
    minRevs = CODE_MAAT_DEFAULTS.minRevs,
    minSharedRevs = CODE_MAAT_DEFAULTS.minSharedRevs,
    minCoupling = CODE_MAAT_DEFAULTS.minCoupling,
  } = options;

  const revsByModule = new Map();
  const sharedByPair = new Map();

  for (const rev of revisions) {
    const mods = [...new Set(rev.modules)].sort();
    for (const m of mods) revsByModule.set(m, (revsByModule.get(m) || 0) + 1);
    for (let i = 0; i < mods.length; i += 1) {
      for (let j = i + 1; j < mods.length; j += 1) {
        const key = `${mods[i]}\u0000${mods[j]}`;
        sharedByPair.set(key, (sharedByPair.get(key) || 0) + 1);
      }
    }
  }

  const qualifying = [...revsByModule.entries()].filter(([, n]) => n >= minRevs);
  const qualifyingNames = new Set(qualifying.map(([m]) => m));

  const pairs = [];
  for (const [key, shared] of sharedByPair) {
    const [a, b] = key.split('\u0000');
    if (!qualifyingNames.has(a) || !qualifyingNames.has(b)) continue;
    if (shared < minSharedRevs) continue;
    const revsA = revsByModule.get(a);
    const revsB = revsByModule.get(b);
    // code-maat truncates the percentage rather than rounding it.
    const degree = Math.trunc((shared / ((revsA + revsB) / 2)) * 100);
    if (degree < minCoupling) continue;
    pairs.push({ a, b, revs_a: revsA, revs_b: revsB, shared_revs: shared, degree });
  }

  pairs.sort((x, y) => y.degree - x.degree || (x.a < y.a ? -1 : 1));

  return {
    pairs,
    qualifying_modules: qualifying.length,
    total_revisions: revisions.length,
  };
}

module.exports = {
  parseGitLog, modulesPerRevision, couplingPairs, CODE_MAAT_DEFAULTS, isLockfile,
};


/***/ }),

/***/ 884:
/***/ ((module) => {



// What each module DECLARES it depends on, read from the repo's own manifests.
//
// This is the breadcrumb half of C1's cross-boundary metric. Change coupling says
// which modules actually move together; this says which of those movements the
// repo has admitted to. A pair that co-changes with no declared dependency in
// either direction is a hidden coupling -- the criterion's own words.
//
// Deliberately NOT read from the code graph. The graph under-resolves Elixir
// badly enough that a missing edge would manufacture a violation, which is the
// trap this whole metric exists to avoid. A manifest is a statement the repo
// makes about itself, in the same spirit as declaration-driven module discovery.

// Discovery kinds where the ecosystem HAS a per-module dependency declaration.
// Namespaces inside one application (source-namespace) have no such mechanism,
// so "undeclared" would be true of every pair by construction and would carry no
// information. Those repos are reported, never graded, on this metric.
const DECLARABLE_KINDS = ['elixir-umbrella', 'pnpm-workspace', 'npm-workspace', 'uv-workspace', 'sibling-projects'];

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function basename(prefix) {
  return prefix.replace(/\/$/, '').split('/').pop();
}

// ─── Per-ecosystem manifest readers ──────────────────────────────────────────
//
// Each returns { name, deps } -- the module's own package name and the names it
// declares a dependency on -- or null when the manifest could not be read. A
// null is surfaced to the caller, never silently treated as "declares nothing":
// that would turn an unreadable manifest into a violation for every pair.

function readPackageJson(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return null; }
  if (!pkg || typeof pkg !== 'object') return null;
  const deps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ];
  return { name: pkg.name || null, deps };
}

// `{:dep, in_umbrella: true}` is the only inter-app form; a hex dep is a version
// string and is not an edge between modules.
function readMixExs(text) {
  const deps = [];
  for (const m of String(text).matchAll(/\{\s*:([a-z_][a-zA-Z0-9_]*)\s*,[^}]*in_umbrella:\s*true/g)) {
    deps.push(m[1]);
  }
  return { name: null, deps };
}

// `[project] name` plus the `dependencies` array. Requirement strings carry
// version specifiers and extras; the package name is the leading token.
function readPyProject(text) {
  const t = String(text);
  const nameMatch = t.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const depsMatch = t.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  const deps = depsMatch
    ? [...depsMatch[1].matchAll(/["']([^"']+)["']/g)]
      .map((m) => m[1].split(/[\s<>=!~;[]/)[0].trim())
      .filter(Boolean)
    : [];
  return { name: nameMatch ? nameMatch[1] : null, deps };
}

const READER_BY_FILE = {
  'package.json': readPackageJson,
  'mix.exs': readMixExs,
  'pyproject.toml': readPyProject,
};

// Which manifest actually governs a module is decided by the DISCOVERY KIND, not
// by whichever file is found first. An Elixir app routinely carries its own
// package.json for asset building -- apps/<app>/package.json in an umbrella -- and
// first-match would read that instead of mix.exs, lose every umbrella dependency,
// and report declared pairs as hidden couplings. Same family as the C6 trap where
// Phoenix's assets/package.json was promoted to a module.
//
// sibling-projects is the one shape that is genuinely mixed: each top-level
// directory may be its own ecosystem, so there we union whatever is present.
const MANIFESTS_BY_KIND = {
  'elixir-umbrella': ['mix.exs'],
  'pnpm-workspace': ['package.json'],
  'npm-workspace': ['package.json'],
  'uv-workspace': ['pyproject.toml'],
  'sibling-projects': ['package.json', 'mix.exs', 'pyproject.toml'],
};

function declaredDependencyPairs({ files, readText, modules, kind }) {
  const declared = new Set();
  const unreadable = [];
  if (!DECLARABLE_KINDS.includes(kind)) {
    return { declared, declarable: false, unreadable, resolved_modules: 0 };
  }

  const fileSet = new Set(files || []);
  const parsed = new Map(); // module name -> { name, deps }

  const manifestNames = MANIFESTS_BY_KIND[kind] || [];
  for (const mod of modules || []) {
    let got = null;
    let sawManifest = false;
    for (const file of manifestNames) {
      const path = `${mod.prefix}${file}`;
      if (!fileSet.has(path)) continue;
      sawManifest = true;
      const text = readText(path);
      if (text == null) continue;
      const parsedOne = READER_BY_FILE[file](text);
      if (!parsedOne) continue;
      // Union across manifests for the mixed sibling-projects shape; for every
      // other kind there is exactly one governing manifest.
      got = got
        ? { name: got.name || parsedOne.name, deps: [...got.deps, ...parsedOne.deps] }
        : parsedOne;
    }
    // A module with no manifest at all is simply not a declaring unit; a module
    // whose manifest exists but could not be parsed is reported, because
    // treating it as "declares nothing" would make every one of its pairs a
    // violation.
    if (!got) { if (sawManifest) unreadable.push(mod.name); continue; }
    // An Elixir app's identity is its directory name -- mix.exs states the app
    // atom, but the umbrella resolves `in_umbrella` deps by directory.
    const identity = got.name || basename(mod.prefix);
    parsed.set(mod.name, { identity, deps: got.deps });
  }

  // Index every module by the name other modules would use to depend on it.
  const moduleByIdentity = new Map();
  for (const [modName, { identity }] of parsed) moduleByIdentity.set(identity, modName);
  // Elixir deps are referenced by directory name even when a package name exists.
  for (const mod of modules || []) {
    const base = basename(mod.prefix);
    if (!moduleByIdentity.has(base)) moduleByIdentity.set(base, mod.name);
  }

  for (const [modName, { deps }] of parsed) {
    for (const dep of deps) {
      const target = moduleByIdentity.get(dep);
      if (!target || target === modName) continue;
      declared.add(pairKey(modName, target));
    }
  }

  return { declared, declarable: true, unreadable, resolved_modules: parsed.size };
}

module.exports = { declaredDependencyPairs, pairKey, DECLARABLE_KINDS };


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

/***/ 809:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// I/O edge for C1. Clones the target, runs graphify's deterministic offline AST
// pass, maps the graph onto declared modules, and writes boundaries.json.
// Not unit-tested -- validated by running it against real repos.
//
// Env: SYSTEM (a key in the caller's system list), GH_TOKEN (clone auth).
// The repo slug is resolved from that list like every sibling scanner,
// so an external driver can run this scanner without an env bridge.

const fs = __nccwpck_require__(24);
const path = __nccwpck_require__(760);
const os = __nccwpck_require__(161);
const { execFileSync } = __nccwpck_require__(421);
const {
  discoverModules, buildModuleGraph, findModuleCycles, computeFanOut,
  detectExternalTargets, moduleForFile, SOURCE_EXT,
  isNonSourcePath, isTestOrFixturePath,
  moduleGraphCoverage, MODULE_GRAPH_COVERAGE_THRESHOLD,
} = __nccwpck_require__(761);
const {
  parseGitLog, modulesPerRevision, couplingPairs, CODE_MAAT_DEFAULTS,
} = __nccwpck_require__(187);
const { declaredDependencyPairs, pairKey } = __nccwpck_require__(884);

const GRAPHIFY_VERSION = '0.9.28';
const MAX_CYCLES = 500;
const GRAPHIFY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// The benchmark spec's own window for boundary drift ("last 90 days").
const COUPLING_WINDOW_DAYS = 90;

const { reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);

// Directories excluded from the file walk. Covers Node, Elixir, Python,
// Go/Bundler/Composer vendoring, compiled output trees, build caches, editor
// state and Phoenix runtime assets. Kept in step with NON_SOURCE_DIRS in
// boundary-signals.js (itself mirroring SKIP_DIRS in test-coverage-signals.js);
// `priv`, `coverage`, `cover`, `tmp` and `.elixir_ls` are directories the walk
// should never have entered.
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', 'graphify-out', '.venv',
  'vendor', 'dist', 'build', 'target', '__pycache__',
  'priv', 'coverage', 'cover', 'tmp', '.elixir_ls', '.agents',
  'out', '.next', '.turbo', '.nuxt',
]);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function listFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else out.push(path.relative(root, full));
    }
  };
  walk(root, 0);
  return out;
}

// Indeterminate reports must not carry default-good values. `cycles: {count: 0}`
// and `fan_out: {mean: 0}` next to an indeterminate string read as "perfect
// boundaries" to anything that skips the string. Emit nulls; the scorer's guards
// already reject nulls and are tested.
function indeterminateReport(reason, discovery, extra = {}) {
  return {
    applicable: true,
    indeterminate: reason,
    module_discovery: {
      kind: discovery.kind,
      modules: (discovery.modules || []).map((m) => m.name),
      reason: discovery.reason || reason,
    },
    cycles: { count: null, cycles: [], bounded: false, dropped: 0, uncorroborated: [] },
    fan_out: { per_module: {}, mean: null },
    external_targets: {},
    graph: { nodes: 0, edges: null, ...extra },
  };
}

// ─── Change coupling ─────────────────────────────────────────────────────────
//
// Reads git history, never the code graph. That independence is the point: it is
// the only C1 metric that still works on a stack whose extractor under-resolves.
// A failure here degrades to "not measured", never to a clean bill of health.
//
// historyDir is separate from repoDir because a local target is COPIED into a
// temp tree that has no .git — see target-tree.js. The log is then read from the
// folder the copy came from, which is only ever read from. The paths git prints
// are repo-relative, and the copy preserves them, so the two line up. A target
// that is not a git repository at all passes null and lands in the catch below,
// which is the honest answer: not measured.
function collectChangeCoupling(repoDir, discovery, files, readText, historyDir = repoDir) {
  const base = {
    window_days: COUPLING_WINDOW_DAYS,
    thresholds: CODE_MAAT_DEFAULTS,
    declarable: false,
    total_revisions: 0,
    qualifying_modules: 0,
    excluded_oversized_changesets: 0,
    unreadable_manifests: [],
    pairs: [],
    violations: [],
  };

  let log;
  try {
    if (!historyDir) throw new Error('no history location');
    log = sh('git', [
      'log', '--no-merges', `--since=${COUPLING_WINDOW_DAYS} days ago`,
      '--format=commit%x09%H', '--name-only',
    ], { cwd: historyDir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // No history available: a bare depth-1 clone that could not be deepened, or
    // a local folder that is not a git repository.
    return { ...base, unavailable: 'git history for the window could not be read' };
  }

  const revisions = parseGitLog(log);
  const mapped = modulesPerRevision(revisions, discovery.modules);
  const { pairs, qualifying_modules: qualifying, total_revisions: total } = couplingPairs(mapped.revisions);

  const { declared, declarable, unreadable } = declaredDependencyPairs({
    files, readText, modules: discovery.modules, kind: discovery.kind,
  });

  const annotated = pairs.map((p) => ({ ...p, declared: declared.has(pairKey(p.a, p.b)) }));

  return {
    ...base,
    declarable,
    total_revisions: total,
    qualifying_modules: qualifying,
    excluded_oversized_changesets: mapped.excluded_oversized_changesets,
    unreadable_manifests: unreadable,
    pairs: annotated,
    // A pair whose modules keep changing together while neither declares a
    // dependency on the other is the criterion's own "hidden cross-boundary
    // dependency". Only meaningful where the ecosystem can express a declaration.
    violations: declarable ? annotated.filter((p) => !p.declared) : [],
  };
}

function scanRepo(repoDir, { historyDir = repoDir } = {}) {
  const files = listFiles(repoDir);
  const readText = (p) => {
    try { return fs.readFileSync(path.join(repoDir, p), 'utf8'); } catch { return null; }
  };

  const discovery = discoverModules({ files, readText });
  if (discovery.kind === 'indeterminate') {
    return indeterminateReport(discovery.reason, discovery);
  }

  sh('graphify', ['extract', repoDir, '--code-only'], {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GRAPHIFY_TIMEOUT_MS,
    killSignal: 'SIGTERM',
  });
  const graphPath = path.join(repoDir, 'graphify-out', 'graph.json');
  if (!fs.existsSync(graphPath)) throw new Error(`graphify produced no graph.json for ${repoDir}`);
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  if (!Array.isArray(graph.links)) throw new Error('graph.json has no links array');

  // Guard: zero links with 2+ modules means the extractor understood nothing.
  // Do not produce a report that reads as clean boundaries when it is actually
  // a failed or empty extraction.
  if (graph.links.length === 0 && discovery.modules.length >= 2) {
    throw new Error(
      `graphify produced zero links for ${discovery.modules.length} modules — ` +
      'extraction likely failed; refusing to score as clean boundaries'
    );
  }

  const built = buildModuleGraph(graph, discovery.modules);
  const { edges, directions, relations } = built;
  const rawLinks = graph.links.length;

  // Degenerate-graph test: coverage, not a cliff at zero. Both the threshold and
  // the measured value are emitted below whatever the outcome, per the
  // no-silent-caps rule.
  const cov = moduleGraphCoverage(edges, discovery.modules);
  const graphAudit = {
    nodes: (graph.nodes || []).length,
    edges: edges.length,
    raw_links: rawLinks,
    skipped_manifest_nodes: built.skipped_manifest_nodes,
    skipped_cross_language_edges: built.skipped_cross_language_edges,
    skipped_stdlib_collision_edges: built.skipped_stdlib_collision_edges,
    skipped_non_source_path_edges: built.skipped_non_source_path_edges,
    module_graph_coverage: Number(cov.coverage.toFixed(4)),
    module_graph_coverage_threshold: MODULE_GRAPH_COVERAGE_THRESHOLD,
    modules_connected: cov.connected,
    modules_declared: cov.total,
    relations,
    directions,
  };

  if (discovery.modules.length >= 2 && cov.coverage < MODULE_GRAPH_COVERAGE_THRESHOLD) {
    const report = indeterminateReport(
      `degenerate graph: only ${cov.connected} of ${cov.total} declared modules appear in the dependency graph `
      + `(coverage ${(cov.coverage * 100).toFixed(1)}%, threshold ${(MODULE_GRAPH_COVERAGE_THRESHOLD * 100).toFixed(0)}%) `
      + `over ${rawLinks} raw links — module mapping may be misaligned, or the extractor does not resolve `
      + 'cross-module references for this language',
      discovery,
    );
    report.graph = graphAudit;
    // Module discovery succeeded here -- only the graph failed. Change coupling
    // needs history and manifests, not the graph, so it is still measurable and
    // the scorer can grade the criterion on it alone. Without this, a repo whose
    // graph is degenerate loses a signal we actually have.
    report.change_coupling = collectChangeCoupling(repoDir, discovery, files, readText, historyDir);
    return report;
  }

  const cycles = findModuleCycles(edges, { maxCycles: MAX_CYCLES, directions });

  // External targets, attributed to the module that contains the call site.
  // Path exclusions applied here rather than inside the detector so the detector
  // stays pure: build output and bundles are not source at all, and test /
  // fixture / mock / cassette URLs are data, not calls the system makes. This is
  // the same cross-scanner path allowlist the C9 triage config already carries.
  const externalByModule = {};
  let anchoredTotal = 0;
  let unanchoredTotal = 0;
  let filesScannedForTargets = 0;
  for (const f of files) {
    if (!SOURCE_EXT.test(f)) continue;
    if (isNonSourcePath(f) || isTestOrFixturePath(f)) continue;
    const mod = moduleForFile(f, discovery.modules);
    if (!mod) continue;
    filesScannedForTargets += 1;
    const { targets, anchored, unanchored } = detectExternalTargets(readText(f) || '');
    anchoredTotal += anchored;
    unanchoredTotal += unanchored;
    if (!targets.length) continue;
    externalByModule[mod] = [...new Set([...(externalByModule[mod] || []), ...targets])].sort();
  }

  const fanOut = computeFanOut(edges, discovery.modules, externalByModule);

  return {
    applicable: true,
    indeterminate: null,
    module_discovery: {
      kind: discovery.kind,
      modules: discovery.modules.map((m) => m.name),
      reason: null,
    },
    cycles,
    fan_out: fanOut,
    change_coupling: collectChangeCoupling(repoDir, discovery, files, readText, historyDir),
    external_targets: externalByModule,
    external_target_detection: {
      files_scanned: filesScannedForTargets,
      anchored_uri_literals: anchoredTotal,
      unanchored_uri_literals_rejected: unanchoredTotal,
      basis: 'URI literals count only at a recognised HTTP-client, base-URL, DB-connection or queue-publish call site; test/fixture/mock/bundle paths excluded',
    },
    graph: graphAudit,
  };
}

function main() {
  // Verify the installed graphify matches the pinned version before running anything.
  const installedVersion = sh('graphify', ['--version']).trim().replace(/^graphify\s+/, '');
  if (installedVersion !== GRAPHIFY_VERSION) {
    throw new Error(
      `graphify version mismatch: want ${GRAPHIFY_VERSION}, got ${installedVersion}. ` +
      'Update GRAPHIFY_VERSION or install the correct version.'
    );
  }

  const system = process.env.SYSTEM;
  if (!system) throw new Error('SYSTEM env var is required');

  const tree = materialise(systemTarget(system), { prefix: system, token: process.env.GH_TOKEN });
  try {
    for (const note of tree.notes) process.stdout.write(`  ${note}\n`);

    // Change coupling needs commit history, which a depth-1 clone does not have.
    // Backfill the window with commits and trees but NOT file contents:
    // --filter=blob:none keeps this cheap (218 commits of metadata on a real
    // monorepo) and the depth-1 working tree already holds the files graphify
    // reads, so nothing triggers a lazy blob fetch. A failure here is tolerated:
    // the coupling collector degrades to "not measured", never to a clean score.
    //
    // Only for a clone. A local target's history is the source folder's own and
    // is already complete — and this would be a `git fetch` inside somebody's
    // working copy, which is not something a scanner gets to do.
    if (tree.kind === 'repo') {
      try {
        sh('git', ['fetch', '--quiet', '--filter=blob:none', `--shallow-since=${COUPLING_WINDOW_DAYS} days ago`, 'origin'],
          { cwd: tree.dir, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        process.stderr.write(`boundaries: ${system} — history backfill failed; change coupling will be unmeasured\n`);
      }
    }

    const report = scanRepo(tree.dir, { historyDir: tree.historyDir });
    const outDir = reportsDir(system);
    fs.writeFileSync(path.join(outDir, 'boundaries.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `boundaries: ${system} modules=${report.module_discovery.modules.length} `
      + `edges=${report.graph.edges} cycles=${report.cycles.count}`
      + `${report.indeterminate ? ' (indeterminate)' : ''}\n`
    );
  } finally {
    // Always remove the temp directory — success or failure — so a clone (which
    // may hold a plaintext token in .git/config) is never left on disk. It
    // removes only what it created; a local target's source folder is untouched.
    tree.cleanup();
  }
}

if (require.main === require.cache[eval('__filename')]) main();

module.exports = { scanRepo, GRAPHIFY_VERSION, MAX_CYCLES };


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

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 421:
/***/ ((module) => {

module.exports = require("node:child_process");

/***/ }),

/***/ 24:
/***/ ((module) => {

module.exports = require("node:fs");

/***/ }),

/***/ 995:
/***/ ((module) => {

module.exports = require("node:module");

/***/ }),

/***/ 161:
/***/ ((module) => {

module.exports = require("node:os");

/***/ }),

/***/ 760:
/***/ ((module) => {

module.exports = require("node:path");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ }),

/***/ 768:
/***/ ((module) => {

module.exports = /*#__PURE__*/JSON.parse('{"_comment":"C9 scanner triage config. Signal-to-noise filters applied to raw scanner output before scoring. Raw + triaged counts are both preserved for the dashboard audit trail. GOVERNANCE: any change to these filters/tools MUST be reflected in the C9 entry of the criteria documentation in the same change.","_exclude_paths_note":"Shared path allowlist applied to every file-scanning tool (gitleaks + semgrep) — test/fixture/mock/seed/cassette noise trips both. priv/static is intentionally NOT excluded (real committed keys surface there).","exclude_paths":["**/test/**","**/tests/**","**/spec/**","**/__mocks__/**","**/fixtures/**","**/priv/data/seed/**","**/cassette_library/**","**/config/test.exs"],"_gitleaks_review_rules_note":"Low-precision gitleaks rules whose hits go to a REVIEW bucket (surfaced, but do NOT hard-cap): they match public IDs / GA tags / UUIDs as often as real secrets. High-precision rules (private keys, provider tokens) still hard-cap.","gitleaks_review_rules":["generic-api-key"],"_semgrep_remap_note":"Keyed by check_id leaf (--config auto emits <path>.<leaf>.<leaf>). Demotes CI/workflow hardening recommendations that are not code vulnerabilities.","semgrep_severity_remap":{"github-actions-mutable-action-tag":"INFO","secrets-inherit":"INFO"}}');

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
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
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
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(809);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;