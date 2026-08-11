'use strict';

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
const TRIAGE_CONFIG = require('./triage-config.json');
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
const NODE_BUILTINS = require('node:module').builtinModules
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
