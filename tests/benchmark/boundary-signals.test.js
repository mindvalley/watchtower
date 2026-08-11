'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { discoverModules, isLayerShaped } = require('../../scripts/benchmark/boundary-signals');

const reader = (map) => (p) => (p in map ? map[p] : null);

test('pnpm workspace: modules come from declared globs, not a manifest walk', () => {
  const files = [
    'pnpm-workspace.yaml',
    'apps/web/package.json', 'apps/web/src/index.ts',
    'packages/core/package.json',
    'apps/web/assets/package.json',   // must NOT become a module
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n" }),
  });
  assert.strictEqual(res.kind, 'pnpm-workspace');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['apps/web/', 'packages/core/']);
});

test('elixir umbrella: modules come from apps_path', () => {
  const files = ['mix.exs', 'apps/api/mix.exs', 'apps/web/mix.exs', 'apps/web/assets/package.json'];
  const res = discoverModules({
    files,
    readText: reader({ 'mix.exs': 'defmodule X do\n  def project, do: [apps_path: "apps"]\nend' }),
  });
  assert.strictEqual(res.kind, 'elixir-umbrella');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['apps/api/', 'apps/web/']);
});

test('nested umbrella is found at any depth', () => {
  const files = ['app/mix.exs', 'app/apps/a/mix.exs', 'app/apps/b/mix.exs'];
  const res = discoverModules({
    files,
    readText: reader({ 'app/mix.exs': '[apps_path: "apps"]' }),
  });
  assert.strictEqual(res.kind, 'elixir-umbrella');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['app/apps/a/', 'app/apps/b/']);
});

test('sibling projects: each top-level dir with its own manifest, no workspace root', () => {
  const files = ['package.json', 'web/package.json', 'admin/package.json', 'mobile/package.json'];
  const res = discoverModules({ files, readText: reader({ 'package.json': '{"name":"root"}' }) });
  assert.strictEqual(res.kind, 'sibling-projects');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['admin/', 'mobile/', 'web/']);
});

test('single root manifest and nothing else recognised -> indeterminate with a reason', () => {
  const res = discoverModules({ files: ['Gemfile'], readText: reader({ 'Gemfile': 'source "x"' }) });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason.length > 0);
});

// Regression test for Important 1: no-star branch must check for manifest
test('Important 1: literal paths without manifests -> indeterminate, not false-green', () => {
  const files = [
    'pnpm-workspace.yaml',
    'packages/core/README.md',
    'packages/utils/CHANGELOG.md',
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/core'\n  - 'packages/utils'\n" }),
  });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason.includes('pnpm-workspace'));
  assert.ok(res.reason.includes('0 members'));
});

// Regression test for Important 2: ** globs must match at any depth
test('Important 2: double-star glob matches packages at any depth', () => {
  const files = [
    'pnpm-workspace.yaml',
    'packages/core/package.json',
    'packages/utils/package.json',
    'packages/sub/deep/nested/package.json',
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/**'\n" }),
  });
  assert.strictEqual(res.kind, 'pnpm-workspace');
  const prefixes = res.modules.map((m) => m.prefix).sort();
  assert(prefixes.includes('packages/core/'));
  assert(prefixes.includes('packages/utils/'));
  assert(prefixes.includes('packages/sub/deep/nested/'));
});

// Regression test for Important 3: under-threshold declarations should report reason
test('Important 3: pnpm with only one member -> indeterminate with specific reason', () => {
  const files = [
    'pnpm-workspace.yaml',
    'apps/web/package.json',
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n" }),
  });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason.includes('pnpm-workspace'));
  assert.ok(res.reason.includes('1 member'));
});

// Regression test for Important 3: under-threshold elixir
test('Important 3: elixir umbrella with only one member -> indeterminate with specific reason', () => {
  const files = [
    'mix.exs',
    'apps/api/mix.exs',
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'mix.exs': '[apps_path: "apps"]' }),
  });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason.includes('elixir-umbrella'));
  assert.ok(res.reason.includes('1 member'));
});

// Regression test for Minor 4: single-quote apps_path
test('Minor 4: elixir apps_path with single quotes', () => {
  const files = ['mix.exs', 'apps/api/mix.exs', 'apps/web/mix.exs'];
  const res = discoverModules({
    files,
    readText: reader({ 'mix.exs': "defmodule X do\n  def project, do: [apps_path: 'apps']\nend" }),
  });
  assert.strictEqual(res.kind, 'elixir-umbrella');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['apps/api/', 'apps/web/']);
});

test('rails layer names are layer-shaped', () => {
  assert.strictEqual(isLayerShaped(['models', 'controllers', 'views', 'workers', 'services']), true);
});

test('bounded contexts are not layer-shaped', () => {
  assert.strictEqual(isLayerShaped(['bravo', 'bravo_web', 'shop_web', 'signup_web']), false);
});

test('fallback to lib/* when only a root manifest exists', () => {
  const files = ['mix.exs', 'lib/bravo/a.ex', 'lib/bravo_web/b.ex', 'lib/shop_web/c.ex'];
  const res = discoverModules({ files, readText: () => 'defmodule X do end' });
  assert.strictEqual(res.kind, 'source-namespace');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(),
    ['lib/bravo/', 'lib/bravo_web/', 'lib/shop_web/']);
});

test('layer-organised repo is indeterminate, never red', () => {
  const files = ['Gemfile', 'app/models/a.rb', 'app/controllers/b.rb', 'app/views/c.rb', 'app/workers/d.rb'];
  const res = discoverModules({ files, readText: () => 'source "x"' });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.match(res.reason, /^layer-organised/);
});

test('a single discovered module is indeterminate -- cross-module coupling is undefined', () => {
  const files = ['mix.exs', 'lib/only/a.ex'];
  const res = discoverModules({ files, readText: () => 'defmodule X do end' });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason);
});

test('Regression: mixed layers and domains read as indeterminate, not source-namespace', () => {
  const files = ['mix.exs', 'lib/models/a.ex', 'lib/billing/b.ex', 'lib/catalog/c.ex'];
  const res = discoverModules({ files, readText: () => 'defmodule X do end' });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.match(res.reason, /layer-organised.*models/);
});

test('Non-domain-names without layer vocabulary remain source-namespace', () => {
  const files = [
    'mix.exs',
    'lib/bravo/a.ex', 'lib/bravo_web/b.ex', 'lib/delta_web/c.ex',
    'lib/shop_web/d.ex', 'lib/signup_web/e.ex'
  ];
  const res = discoverModules({ files, readText: () => 'defmodule X do end' });
  assert.strictEqual(res.kind, 'source-namespace');
  assert.strictEqual(res.modules.length, 5);
});

test('Alternative domain names also avoid false-green', () => {
  const files = [
    'src/delta_engine/a.js', 'src/charlie_engine_web/b.js', 'src/alpha/c.js',
    'src/notification_gateway/d.js'
  ];
  const res = discoverModules({ files, readText: () => '' });
  assert.strictEqual(res.kind, 'source-namespace');
  assert.strictEqual(res.modules.length, 4);
});

test('Assets and fixtures without source code do not become modules', () => {
  const files = ['mix.exs', 'lib/vendor/jquery.min.js', 'lib/test-fixtures/data.json'];
  const res = discoverModules({ files, readText: () => 'defmodule X do end' });
  assert.strictEqual(res.kind, 'indeterminate');
});

test('Rails-style layered app is recognised as layer-organised', () => {
  const files = ['Gemfile', 'app/admin/a.rb', 'app/assets/b.js', 'app/controllers/c.rb',
    'app/helpers/d.rb', 'app/models/e.rb', 'app/services/f.rb', 'app/views/g.rb', 'app/workers/h.rb'];
  const res = discoverModules({ files, readText: () => 'source "x"' });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.match(res.reason, /layer-organised/);
});

const {
  moduleForFile, buildModuleGraph, findModuleCycles, DEPENDENCY_RELATIONS,
} = require('../../scripts/benchmark/boundary-signals');

const MODS = [
  { name: 'apps/web', prefix: 'apps/web/' },
  { name: 'apps/web/inner', prefix: 'apps/web/inner/' },
  { name: 'packages/core', prefix: 'packages/core/' },
];

test('longest matching prefix wins', () => {
  assert.strictEqual(moduleForFile('apps/web/inner/x.ts', MODS), 'apps/web/inner');
  assert.strictEqual(moduleForFile('apps/web/x.ts', MODS), 'apps/web');
  assert.strictEqual(moduleForFile('scripts/x.ts', MODS), null);
});

test('only EXTRACTED dependency relations become module edges', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'b', source_file: 'packages/core/y.ts' },
    ],
    links: [
      { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'a', target: 'b', relation: 'indirect_call', confidence: 'INFERRED' },
      { source: 'a', target: 'b', relation: 'contains', confidence: 'EXTRACTED' },
    ],
  };
  const { edges } = buildModuleGraph(graph, MODS);
  assert.deepStrictEqual(edges, [['apps/web', 'packages/core']]);
});

test('manifest-sourced nodes are excluded -- declared library deps are out of scope', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'dep', source_file: 'apps/web/package.json' },
    ],
    links: [{ source: 'a', target: 'dep', relation: 'imports', confidence: 'EXTRACTED' }],
  };
  const res = buildModuleGraph(graph, MODS);
  assert.deepStrictEqual(res.edges, []);
  assert.strictEqual(res.skipped_manifest_nodes, 1);
});

test('intra-module edges are dropped', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'b', source_file: 'apps/web/y.ts' },
    ],
    links: [{ source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' }],
  };
  assert.deepStrictEqual(buildModuleGraph(graph, MODS).edges, []);
});

test('counts every cycle and reports it was not bounded', () => {
  const edges = [['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'b']];
  const res = findModuleCycles(edges, { maxCycles: 100 });
  assert.strictEqual(res.count, 2);
  assert.strictEqual(res.bounded, false);
  assert.strictEqual(res.dropped, 0);
});

test('an acyclic graph scores zero cycles', () => {
  assert.strictEqual(findModuleCycles([['a', 'b'], ['b', 'c']], { maxCycles: 100 }).count, 0);
});

test('bounding is reported, never silent', () => {
  const edges = [['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'b'], ['a', 'c'], ['c', 'a']];
  const res = findModuleCycles(edges, { maxCycles: 1 });
  assert.strictEqual(res.count, 5);
  assert.strictEqual(res.dropped, 4);
  assert.strictEqual(res.bounded, true);
  assert.strictEqual(res.cycles.length, 1);
});

const { redactTarget, detectExternalTargets, computeFanOut } = require('../../scripts/benchmark/boundary-signals');

test('credentials are stripped -- host only, never userinfo', () => {
  assert.strictEqual(redactTarget('postgres://user:hunter2@db.internal:5432/app'), 'db.internal');
  assert.strictEqual(redactTarget('https://api.example.com/v1/things?k=secret'), 'api.example.com');
});

test('detects outbound targets and never emits a raw credential', () => {
  const src = `
    const c = axios.create({ baseURL: 'https://payments.internal/v2' });
    const pool = new Pool({ connectionString: 'postgres://u:p@db.internal:5432/x' });
  `;
  const { targets } = detectExternalTargets(src);
  assert.deepStrictEqual(targets, ['db.internal', 'payments.internal']);
  assert.ok(!targets.join(' ').includes('hunter2'));
  assert.ok(!targets.join(' ').includes(':p@'));
});

test('fan-out counts internal modules plus distinct external targets', () => {
  const modules = [
    { name: 'a', prefix: 'a/' }, { name: 'b', prefix: 'b/' }, { name: 'c', prefix: 'c/' },
  ];
  const edges = [['a', 'b'], ['a', 'c'], ['b', 'c']];
  const res = computeFanOut(edges, modules, { a: ['api.example.com'] });
  assert.strictEqual(res.per_module.a, 3);   // b, c, api.example.com
  assert.strictEqual(res.per_module.b, 1);
  assert.strictEqual(res.per_module.c, 0);
  assert.strictEqual(res.mean, 4 / 3);
});

// Adversarial tests: redaction must never leak userinfo
test('password containing / causes parse failure, returns empty (safe under-report)', () => {
  const uri = 'postgres://user:sec/ret@db.prod.internal/mydb';
  const result = redactTarget(uri);
  // Malformed URI (unencoded / in password) fails to parse; return empty.
  // Under-reporting is safer than guessing or leaking.
  assert.strictEqual(result, '');
  assert.ok(!result.includes('sec'));
  assert.ok(!result.includes('ret'));
});

test('username as email address does not leak @ or domain fragment', () => {
  const uri = 'mysql://user@company.com:pass@db.host/db';
  const result = redactTarget(uri);
  assert.strictEqual(result, 'db.host');
  // Verify no part of userinfo appears in output
  assert.ok(!result.includes('company.com'));
  assert.ok(!result.includes('user@'));
  assert.ok(!result.includes('pass'));
});

test('IPv6 host in brackets is returned with brackets intact', () => {
  const uri = 'http://user:pass@[::1]/path';
  const result = redactTarget(uri);
  assert.strictEqual(result, '[::1]');
  // Verify no userinfo leaks (brackets are part of IPv6 literal syntax)
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('pass'));
});

test('jdbc: prefixed URI is stripped and parsed', () => {
  const uri = 'jdbc:postgresql://user:pass@db.internal:5432/app';
  const result = redactTarget(uri);
  assert.strictEqual(result, 'db.internal');
  // Verify no credential appears
  assert.ok(!result.includes('user'));
  assert.ok(!result.includes('pass'));
});

test('string with no scheme returns empty, never guesses', () => {
  const uri = 'db.example.com/path';
  const result = redactTarget(uri);
  assert.strictEqual(result, '');
});

test('scheme-relative URI without scheme returns empty', () => {
  const uri = '//user:pass@db.example.com/path';
  const result = redactTarget(uri);
  assert.strictEqual(result, '');
});

test('percent-encoded character in password does not leak', () => {
  const uri = 'postgres://user:pass%2Fword@db.example.com/db';
  const result = redactTarget(uri);
  assert.strictEqual(result, 'db.example.com');
  // Verify no part of password appears, encoded or not
  assert.ok(!result.includes('pass'));
  assert.ok(!result.includes('%2F'));
  assert.ok(!result.includes('word'));
});

test('end-to-end: jdbc: connection string in source text is detected and redacted', () => {
  const src = `
    const connectionString = 'jdbc:postgresql://user:secret@db.internal:5432/appdb';
    const pool = new Pool({ url: 'jdbc:mysql://admin:password@mysql.prod:3306/data' });
  `;
  const { targets } = detectExternalTargets(src);
  // Must extract both JDBC hosts
  assert.ok(targets.includes('db.internal'));
  assert.ok(targets.includes('mysql.prod'));
  // Must never leak credentials
  assert.ok(!targets.join(' ').includes('user'));
  assert.ok(!targets.join(' ').includes('secret'));
  assert.ok(!targets.join(' ').includes('admin'));
  assert.ok(!targets.join(' ').includes('password'));
});

// ── Regression tests for real-repo validation findings ────────────────────────

// Fix: elixir-umbrella must take priority over pnpm-workspace so that a repo
// like some umbrellas (which have BOTH a pnpm-workspace.yaml for JS assets AND an
// Elixir umbrella) is discovered as elixir-umbrella, not as pnpm-workspace.
test('Regression: elixir umbrella wins over pnpm workspace when both are present', () => {
  const files = [
    'mix.exs',
    'pnpm-workspace.yaml',
    // Elixir umbrella apps
    'apps/api/mix.exs', 'apps/api/lib/api.ex',
    'apps/web/mix.exs', 'apps/web/lib/web.ex',
    // pnpm workspace entries (JS assets nested inside umbrella apps)
    'apps/web/assets/package.json', 'apps/web/assets/js/app.js',
    'playwright/package.json',
  ];
  const res = discoverModules({
    files,
    readText: reader({
      'mix.exs': 'defmodule X do\n  def project, do: [apps_path: "apps"]\nend',
      'pnpm-workspace.yaml': "packages:\n  - 'apps/web/assets'\n  - 'playwright'\n",
    }),
  });
  assert.strictEqual(res.kind, 'elixir-umbrella');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['apps/api/', 'apps/web/']);
});

// Fix: well-known asset directories (assets, assets2, static, priv …) must be
// excluded from sibling-projects detection. Bravo has assets/ and assets2/ at
// the root (Phoenix JS compilation dirs), each with a package.json, which
// previously captured the sibling-projects slot before source-namespace could
// discover the real Elixir modules in lib/.
test('Regression: asset directories are excluded from sibling-projects', () => {
  const files = [
    // asset dirs at root – must NOT become sibling-project modules
    'assets/package.json', 'assets/js/app.js',
    'assets2/package.json', 'assets2/js/app2.js',
    // real Elixir modules under lib/
    'lib/bravo/core.ex', 'lib/bravo_web/router.ex', 'lib/shop_web/ctrl.ex',
    'mix.exs',
  ];
  const res = discoverModules({ files, readText: reader({ 'mix.exs': 'defmodule X do end' }) });
  // assets / assets2 must not capture sibling-projects; fall through to source-namespace
  assert.strictEqual(res.kind, 'source-namespace');
  const prefixes = res.modules.map((m) => m.prefix).sort();
  assert.ok(prefixes.includes('lib/shop_web/'));
  assert.ok(prefixes.includes('lib/bravo/'));
  assert.ok(prefixes.includes('lib/bravo_web/'));
  assert.ok(!prefixes.some((p) => p.startsWith('assets')));
});

// Fix: UV (Python) workspace declared in [tool.uv.workspace] must be discovered.
// juliett-api uses uv as its workspace manager with members = ["libraries/*", "apps/*"].
test('Regression: uv workspace in pyproject.toml is discovered', () => {
  const files = [
    'pyproject.toml',
    'apps/api-ai/pyproject.toml', 'apps/api-ai/src/main.py',
    'apps/api-auth/pyproject.toml', 'apps/api-auth/src/main.py',
    'libraries/core/pyproject.toml', 'libraries/core/src/core.py',
    'libraries/cache/pyproject.toml', 'libraries/cache/src/mem.py',
  ];
  const uvToml = `
[project]
name = "my-workspace"

[tool.uv]
managed = true

[tool.uv.workspace]
members = ["libraries/*", "apps/*"]
`;
  const res = discoverModules({ files, readText: reader({ 'pyproject.toml': uvToml }) });
  assert.strictEqual(res.kind, 'uv-workspace');
  const prefixes = res.modules.map((m) => m.prefix).sort();
  assert.ok(prefixes.includes('apps/api-ai/'));
  assert.ok(prefixes.includes('apps/api-auth/'));
  assert.ok(prefixes.includes('libraries/core/'));
  assert.ok(prefixes.includes('libraries/cache/'));
  assert.strictEqual(prefixes.length, 4);
});

// Fix: uv workspace under-threshold (< 2 members resolved) must be indeterminate.
test('Regression: uv workspace with only one member -> indeterminate', () => {
  const files = [
    'pyproject.toml',
    'apps/api/pyproject.toml', 'apps/api/src/main.py',
  ];
  const uvToml = `[tool.uv.workspace]\nmembers = ["apps/*"]\n`;
  const res = discoverModules({ files, readText: reader({ 'pyproject.toml': uvToml }) });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.ok(res.reason.includes('uv-workspace'));
  assert.ok(res.reason.includes('1 member'));
});

// Verify the existing elixir-umbrella test still passes after priority reorder.
test('Regression: elixir-umbrella still discovered when no pnpm workspace present', () => {
  const files = ['mix.exs', 'apps/api/mix.exs', 'apps/web/mix.exs'];
  const res = discoverModules({
    files,
    readText: reader({ 'mix.exs': 'defmodule X do\n  def project, do: [apps_path: "apps"]\nend' }),
  });
  assert.strictEqual(res.kind, 'elixir-umbrella');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix).sort(), ['apps/api/', 'apps/web/']);
});

// ── Regression tests for the whole-branch review fixes ────────────────────────

const {
  isDependencyRelation, NON_DEPENDENCY_RELATIONS, languageFamily,
  isStdlibCollidingFile, isUncorroboratedDirection, parsePnpmPackages,
  isNonSourcePath, isTestOrFixturePath, moduleGraphCoverage,
  MODULE_GRAPH_COVERAGE_THRESHOLD,
} = require('../../scripts/benchmark/boundary-signals');

// --- Previously-untested fixes that validation landed --------------------------

// The SOURCE_EXT-on-both-ends guard. graphify emits imports_from edges from JS
// source to .json config (.oxlintrc.json, babel.config.json); those are not
// runtime module dependencies and previously produced false cross-module cycles
// in a real repo. Landed in validation, never covered by a test until now.
test('Regression: config/asset endpoints never become module edges', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'cfg', source_file: 'packages/core/.oxlintrc.json' },
      { id: 'yml', source_file: 'packages/core/babel.config.yaml' },
      { id: 'ok', source_file: 'packages/core/y.ts' },
    ],
    links: [
      { source: 'a', target: 'cfg', relation: 'imports_from', confidence: 'EXTRACTED' },
      { source: 'a', target: 'yml', relation: 'imports_from', confidence: 'EXTRACTED' },
      { source: 'a', target: 'ok', relation: 'imports_from', confidence: 'EXTRACTED' },
    ],
  };
  assert.deepStrictEqual(buildModuleGraph(graph, MODS).edges, [['apps/web', 'packages/core']]);
});

// The assets\d+ sibling exclusion. Bravo carries assets/ AND assets2/ at the
// root, each with a package.json.
test('Regression: numbered asset dirs (assets2, static3) never become sibling modules', () => {
  const files = [
    'assets/package.json', 'assets2/package.json', 'assets3/package.json',
    'static2/package.json',
    'mix.exs', 'lib/billing/a.ex', 'lib/catalog/b.ex',
  ];
  const res = discoverModules({ files, readText: reader({ 'mix.exs': 'defmodule X do end' }) });
  assert.strictEqual(res.kind, 'source-namespace');
  assert.ok(!res.modules.some((m) => /^(assets|static)/.test(m.name)));
});

// --- Critical 3: degenerate graph is a density test, not a cliff at zero -------

test('Critical 3: coverage is measured, and the zero-edge case is a special case of it', () => {
  const modules = [
    { name: 'a', prefix: 'a/' }, { name: 'b', prefix: 'b/' },
    { name: 'c', prefix: 'c/' }, { name: 'd', prefix: 'd/' },
  ];
  assert.deepStrictEqual(moduleGraphCoverage([], modules), { connected: 0, total: 4, coverage: 0 });
  // 2 of 4 modules connected -> exactly at the threshold, not below it.
  const half = moduleGraphCoverage([['a', 'b']], modules);
  assert.strictEqual(half.connected, 2);
  assert.strictEqual(half.coverage, 0.5);
  assert.ok(!(half.coverage < MODULE_GRAPH_COVERAGE_THRESHOLD));
  // 1 of 4 -> below threshold. Previously this scored, because edges > 0.
  const sparse = moduleGraphCoverage([['a', 'a']], [...modules]);
  assert.ok(sparse.coverage < MODULE_GRAPH_COVERAGE_THRESHOLD);
});

test('Critical 3: the threshold is a named constant, not an inline literal', () => {
  assert.strictEqual(typeof MODULE_GRAPH_COVERAGE_THRESHOLD, 'number');
  assert.ok(MODULE_GRAPH_COVERAGE_THRESHOLD > 0 && MODULE_GRAPH_COVERAGE_THRESHOLD < 1);
});

// --- Critical 2: relations are a denylist with an audit, not a 3-item allowlist -

test('Critical 2: relations graphify emits are counted unless explicitly excluded', () => {
  assert.strictEqual(isDependencyRelation('imports'), true);
  assert.strictEqual(isDependencyRelation('imports_from'), true);
  assert.strictEqual(isDependencyRelation('calls'), true);
  assert.strictEqual(isDependencyRelation('re_exports'), true);
  assert.strictEqual(isDependencyRelation('inherits'), true);
  assert.strictEqual(isDependencyRelation('implements'), true);
  // A relation nobody has seen yet counts by default rather than vanishing.
  assert.strictEqual(isDependencyRelation('some_future_relation'), true);
  // Structural / annotation / inferred relations are excluded, each with a reason.
  for (const rel of ['contains', 'method', 'defines', 'rationale_for', 'cites', 'indirect_call', 'uses', 'references']) {
    assert.strictEqual(isDependencyRelation(rel), false, rel);
    assert.ok(NON_DEPENDENCY_RELATIONS.get(rel).length > 0, `${rel} needs a recorded reason`);
  }
});

test('Critical 2: re_exports (TS barrel files) becomes a module edge', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'b', source_file: 'packages/core/index.ts' },
    ],
    links: [{ source: 'a', target: 'b', relation: 're_exports', confidence: 'EXTRACTED' }],
  };
  assert.deepStrictEqual(buildModuleGraph(graph, MODS).edges, [['apps/web', 'packages/core']]);
});

test('Critical 2: per-relation counts are emitted so the choice is inspectable', () => {
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/web/x.ts' },
      { id: 'b', source_file: 'packages/core/y.ts' },
    ],
    links: [
      { source: 'a', target: 'b', relation: 'imports', confidence: 'EXTRACTED' },
      { source: 'a', target: 'b', relation: 'references', confidence: 'EXTRACTED' },
      { source: 'a', target: 'b', relation: 'contains', confidence: 'EXTRACTED' },
    ],
  };
  const { relations } = buildModuleGraph(graph, MODS);
  assert.strictEqual(relations.imports.counted, true);
  assert.strictEqual(relations.imports.cross_module_links, 1);
  assert.strictEqual(relations.references.counted, false);
  assert.ok(relations.references.excluded_reason.length > 0);
  assert.strictEqual(relations.contains.counted, false);
});

// --- Critical 4: stdlib and cross-language misresolution -----------------------

test('Critical 4: language families are read from the file extension', () => {
  assert.strictEqual(languageFamily('a/b.ex'), 'elixir');
  assert.strictEqual(languageFamily('a/b.tsx'), 'js');
  assert.strictEqual(languageFamily('a/b.py'), 'python');
  assert.strictEqual(languageFamily('a/b.rb'), 'ruby');
  assert.strictEqual(languageFamily('a/b.md'), '');
});

test('Critical 4: cross-language links are dropped and counted', () => {
  const mods = [{ name: 'py', prefix: 'py/' }, { name: 'ts', prefix: 'ts/' }];
  const graph = {
    nodes: [
      { id: 'a', source_file: 'py/migrator.py' },
      { id: 'b', source_file: 'ts/utils/config.ts' },
    ],
    // Reproduces env-juliett: get_alembic_config() in a .py "calls" a class
    // named Config in a .ts. No AST can express that edge.
    links: [{ source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' }],
  };
  const res = buildModuleGraph(graph, mods);
  assert.deepStrictEqual(res.edges, []);
  assert.strictEqual(res.skipped_cross_language_edges, 1);
});

test('Critical 4: stdlib basenames are recognised per language', () => {
  assert.strictEqual(isStdlibCollidingFile('lib/bravo_web/plug/logger.ex'), true);
  assert.strictEqual(isStdlibCollidingFile('src/logging.py'), true);
  assert.strictEqual(isStdlibCollidingFile('src/json.py'), true);
  assert.strictEqual(isStdlibCollidingFile('app/models/set.rb'), true);
  assert.strictEqual(isStdlibCollidingFile('src/crypto.ts'), true);
  assert.strictEqual(isStdlibCollidingFile('lib/catalog/brands.ex'), false);
  assert.strictEqual(isStdlibCollidingFile('src/billing.py'), false);
});

test('Critical 4: Elixir `require Logger` resolved to a local logger.ex is dropped', () => {
  const mods = [{ name: 'apps/billing', prefix: 'apps/billing/' }, { name: 'apps/catalog', prefix: 'apps/catalog/' }];
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/billing/lib/billing/analytics.ex' },
      { id: 'log', source_file: 'apps/catalog/lib/catalog/logger.ex' },
    ],
    links: [{ source: 'a', target: 'log', relation: 'imports', confidence: 'EXTRACTED' }],
  };
  const res = buildModuleGraph(graph, mods);
  assert.deepStrictEqual(res.edges, []);
  assert.strictEqual(res.skipped_stdlib_collision_edges, 1);
});

test('Critical 4: Python `import logging` resolved to a local logging.py is dropped', () => {
  const mods = [{ name: 'apps/api', prefix: 'apps/api/' }, { name: 'libs/core', prefix: 'libs/core/' }];
  const graph = {
    nodes: [
      { id: 'a', source_file: 'apps/api/src/service.py' },
      { id: 'log', source_file: 'libs/core/src/logging.py' },
      { id: 'ok', source_file: 'libs/core/src/errors.py' },
    ],
    links: [
      { source: 'a', target: 'log', relation: 'imports_from', confidence: 'EXTRACTED' },
      { source: 'a', target: 'ok', relation: 'imports_from', confidence: 'EXTRACTED' },
    ],
  };
  const res = buildModuleGraph(graph, mods);
  assert.deepStrictEqual(res.edges, [['apps/api', 'libs/core']]);
  assert.strictEqual(res.skipped_stdlib_collision_edges, 1);
});

test('Critical 4: a non-import relation into a stdlib-named file is kept but marked', () => {
  const mods = [{ name: 'a', prefix: 'a/' }, { name: 'b', prefix: 'b/' }];
  const graph = {
    nodes: [
      { id: 's', source_file: 'a/x.ex' },
      { id: 't', source_file: 'b/logger.ex' },
    ],
    links: [{ source: 's', target: 't', relation: 'calls', confidence: 'EXTRACTED' }],
  };
  const res = buildModuleGraph(graph, mods);
  assert.deepStrictEqual(res.edges, [['a', 'b']]);
  assert.strictEqual(res.directions['a->b'].stdlib_colliding_links, 1);
  assert.strictEqual(isUncorroboratedDirection(res.directions['a->b']), true);
});

test('Critical 4: a cycle resting on an uncorroborated direction does not count', () => {
  const edges = [['a', 'b'], ['b', 'a']];
  const directions = {
    'a->b': { links: 40, stdlib_colliding_links: 0 },
    'b->a': { links: 1, stdlib_colliding_links: 1 },
  };
  const res = findModuleCycles(edges, { maxCycles: 100, directions });
  assert.strictEqual(res.count, 0);
  assert.strictEqual(res.cycles.length, 0);
  assert.strictEqual(res.uncorroborated.length, 1);
  assert.deepStrictEqual(res.uncorroborated[0].weak_directions, ['b->a']);
});

test('Critical 4: a well-corroborated cycle still counts', () => {
  const edges = [['a', 'b'], ['b', 'a']];
  const directions = {
    'a->b': { links: 40, stdlib_colliding_links: 0 },
    'b->a': { links: 12, stdlib_colliding_links: 0 },
  };
  const res = findModuleCycles(edges, { maxCycles: 100, directions });
  assert.strictEqual(res.count, 1);
  assert.strictEqual(res.uncorroborated.length, 0);
});

// --- Critical 1: fan-out counts call sites, not string literals ----------------

test('Critical 1: an SVG xmlns is not an external system', () => {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" />`;
  const { targets, unanchored } = detectExternalTargets(src);
  assert.deepStrictEqual(targets, []);
  assert.strictEqual(unanchored, 0); // rejected as a placeholder host before anchoring
});

test('Critical 1: content URLs and seed data are not external systems', () => {
  const src = [
    `    cover_url: "https://assets.acme-cdn.net/media/cover.jpg"`,
    `    thumbnailUrl: "https://cdn.example-host.net/t.png"`,
    `    href="https://www.facebook.com/acme"`,
    `    const schema = { "$schema": "http://json-schema.org/draft-07/schema#" };`,
  ].join('\n');
  const { targets, unanchored } = detectExternalTargets(src);
  assert.deepStrictEqual(targets, []);
  assert.ok(unanchored >= 3, 'rejected literals must be counted, not silently dropped');
});

test('Critical 1: placeholder, documentation and dotless hosts never count', () => {
  const src = [
    `  base_url: "https://example.com/api"`,
    `  base_url: "https://cdn/assets"`,
    `  base_url: "https://home-123/x"`,
    `  base_url: "https://api.example.com/v1"`,
    `  base_url: "https://your-api-host/api"`,
  ].join('\n');
  assert.deepStrictEqual(detectExternalTargets(src).targets, []);
});

test('Critical 1: recognised HTTP client construction counts, per stack', () => {
  const elixir = `    HTTPoison.get("https://api.lokalise.com/api2/projects")`;
  assert.deepStrictEqual(detectExternalTargets(elixir).targets, ['api.lokalise.com']);

  const elixirMultiline = ['    Neuron.Config.set(', '      url: "https://core-api.example.internal/graph"', '    )'].join('\n');
  assert.deepStrictEqual(detectExternalTargets(elixirMultiline).targets, ['core-api.example.internal']);

  const ts = `    const response = await fetch('https://api.linear.app/graphql', {});`;
  assert.deepStrictEqual(detectExternalTargets(ts).targets, ['api.linear.app']);

  const py = `    client = httpx.AsyncClient(base_url="https://api.acme.internal")`;
  assert.deepStrictEqual(detectExternalTargets(py).targets, ['api.acme.internal']);

  const rb = `    Faraday.new(url: "https://api.stripe.internal")`;
  assert.deepStrictEqual(detectExternalTargets(rb).targets, ['api.stripe.internal']);
});

test('Critical 1: datastore and broker schemes anchor themselves', () => {
  const src = [
    `  DATABASE = "postgres://db.internal:5432/app"`,
    `  CACHE = "redis://cache.internal:6379/0"`,
    `  BUS = "amqp://broker.internal:5672"`,
  ].join('\n');
  assert.deepStrictEqual(
    detectExternalTargets(src).targets,
    ['broker.internal', 'cache.internal', 'db.internal'],
  );
});

test('Critical 1: an unanchored https literal in real code is rejected, not counted', () => {
  const src = `    Logger.info("https://runbook.internal/oncall")`;
  const { targets, unanchored } = detectExternalTargets(src);
  assert.deepStrictEqual(targets, []);
  assert.strictEqual(unanchored, 1);
});

// --- Path exclusions -----------------------------------------------------------

test('bundles and non-source directories are excluded from both graph and detector', () => {
  assert.strictEqual(isNonSourcePath('priv/static/js/app.min.js'), true);
  assert.strictEqual(isNonSourcePath('priv/static/js/app.js'), true);
  assert.strictEqual(isNonSourcePath('apps/web/dist/main.js'), true);
  assert.strictEqual(isNonSourcePath('cover/x.ex'), true);
  assert.strictEqual(isNonSourcePath('.elixir_ls/build/x.ex'), true);
  assert.strictEqual(isNonSourcePath('tmp/x.rb'), true);
  assert.strictEqual(isNonSourcePath('assets/js/vendor.bundle.js'), true);
  assert.strictEqual(isNonSourcePath('lib/bravo/account.ex'), false);
});

test('test, spec, fixture, mock and cassette paths are recognised (shared C9 allowlist)', () => {
  for (const p of [
    'apps/web/tests/config/test-config.ts',
    'apps/api/src/domains/x/__tests__/y.spec.ts',
    'apps/mobile/__mocks__/react-native-marked.js',
    'apps/mobile/jest.setup.ts',
    'test/support/conn_case.ex',
    'spec/models/user_spec.rb',
    'lib/x/fixtures/data.py',
    'cassette_library/x.yml',
    'apps/api/src/x.test.ts',
    'tests/test_client.py',
    'test/bravo/account_test.exs',
  ]) assert.strictEqual(isTestOrFixturePath(p), true, p);
  assert.strictEqual(isTestOrFixturePath('lib/bravo/account.ex'), false);
  assert.strictEqual(isTestOrFixturePath('apps/api/src/domains/billing/billing.service.ts'), false);
});

// --- pnpm-workspace.yaml reader ------------------------------------------------

test('pnpm reader takes only the packages: sequence, and honours ! negations', () => {
  const yaml = [
    'packages:',
    "  - 'apps/*'",
    "  - 'packages/*'",
    "  - '!packages/legacy'",
    'onlyBuiltDependencies:',
    '  - esbuild',
    '  - sharp',
    'catalog:',
    '  react: ^19.0.0',
  ].join('\n');
  const { includes, excludes } = parsePnpmPackages(yaml);
  assert.deepStrictEqual(includes, ['apps/*', 'packages/*']);
  assert.deepStrictEqual(excludes, ['packages/legacy']);
});

test('pnpm negations remove members, changing the fan-out denominator', () => {
  const files = [
    'pnpm-workspace.yaml',
    'packages/core/package.json', 'packages/core/src/a.ts',
    'packages/utils/package.json', 'packages/utils/src/b.ts',
    'packages/legacy/package.json', 'packages/legacy/src/c.ts',
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n" }),
  });
  assert.strictEqual(res.kind, 'pnpm-workspace');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix), ['packages/core/', 'packages/utils/']);
});

test('pnpm reader ignores - items that belong to other top-level keys', () => {
  const files = [
    'pnpm-workspace.yaml',
    'apps/web/package.json', 'apps/web/src/a.ts',
    'apps/admin/package.json', 'apps/admin/src/b.ts',
    'esbuild/package.json',
  ];
  const yaml = "onlyBuiltDependencies:\n  - esbuild\npackages:\n  - 'apps/*'\n";
  const res = discoverModules({ files, readText: reader({ 'pnpm-workspace.yaml': yaml }) });
  assert.deepStrictEqual(res.modules.map((m) => m.prefix), ['apps/admin/', 'apps/web/']);
});

// --- Sibling-projects must not short-circuit the source-namespace fallback -----

test('one stray top-level manifest dir falls through to lib/* instead of indeterminate', () => {
  const files = [
    'mix.exs',
    'ops/package.json',                    // one stray sibling — a heuristic, not a declaration
    'lib/billing/a.ex', 'lib/catalog/b.ex', 'lib/shipping/c.ex',
  ];
  const res = discoverModules({ files, readText: reader({ 'mix.exs': 'defmodule X do end' }) });
  assert.strictEqual(res.kind, 'source-namespace');
  assert.deepStrictEqual(res.modules.map((m) => m.prefix), ['lib/billing/', 'lib/catalog/', 'lib/shipping/']);
});

test('a workspace declaration that resolved one member is still authoritative and terminal', () => {
  const files = [
    'pnpm-workspace.yaml',
    'apps/web/package.json', 'apps/web/src/a.ts',
    'lib/billing/a.ts', 'lib/catalog/b.ts',   // would be a source-namespace, but must not be used
  ];
  const res = discoverModules({
    files,
    readText: reader({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n" }),
  });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.match(res.reason, /pnpm-workspace declared but only 1 member/);
});

test('one stray sibling and no source namespace reports the sibling reason', () => {
  const files = ['package.json', 'ops/package.json', 'ops/index.js'];
  const res = discoverModules({ files, readText: reader({ 'package.json': '{"name":"root"}' }) });
  assert.strictEqual(res.kind, 'indeterminate');
  assert.match(res.reason, /top-level project director/);
});
