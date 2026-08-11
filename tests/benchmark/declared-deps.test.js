'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  declaredDependencyPairs, pairKey, DECLARABLE_KINDS,
} = require('../../scripts/benchmark/declared-deps');

const reader = (map) => (p) => (Object.prototype.hasOwnProperty.call(map, p) ? map[p] : null);

// ─── Elixir umbrella ─────────────────────────────────────────────────────────

test('an elixir umbrella declares its inter-app dependencies in each app mix.exs', () => {
  const files = ['apps/api/mix.exs', 'apps/catalog/mix.exs', 'apps/billing/mix.exs'];
  const readText = reader({
    'apps/api/mix.exs': 'defp deps do [{:catalog, in_umbrella: true}, {:jason, "~> 1.4"}] end',
    'apps/catalog/mix.exs': 'defp deps do [{:billing, in_umbrella: true}] end',
    'apps/billing/mix.exs': 'defp deps do [] end',
  });
  const modules = [
    { name: 'apps/api', prefix: 'apps/api/' },
    { name: 'apps/catalog', prefix: 'apps/catalog/' },
    { name: 'apps/billing', prefix: 'apps/billing/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'elixir-umbrella' });
  assert.ok(declared.has(pairKey('apps/api', 'apps/catalog')));
  assert.ok(declared.has(pairKey('apps/catalog', 'apps/billing')));
  // A third-party hex dep is not an inter-module edge.
  assert.strictEqual(declared.size, 2);
});

test('an umbrella nested below the repo root still resolves its app names', () => {
  const files = ['app/apps/orders_api/mix.exs', 'app/apps/orders_db/mix.exs'];
  const readText = reader({
    'app/apps/orders_api/mix.exs': 'deps: [{:orders_db, in_umbrella: true}]',
    'app/apps/orders_db/mix.exs': 'deps: []',
  });
  const modules = [
    { name: 'app/apps/orders_api', prefix: 'app/apps/orders_api/' },
    { name: 'app/apps/orders_db', prefix: 'app/apps/orders_db/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'elixir-umbrella' });
  assert.ok(declared.has(pairKey('app/apps/orders_api', 'app/apps/orders_db')));
});

// ─── JS workspaces ───────────────────────────────────────────────────────────

test('a JS workspace resolves declared dependencies through package names', () => {
  const files = ['apps/web/package.json', 'packages/ui/package.json', 'packages/shared/package.json'];
  const readText = reader({
    'apps/web/package.json': JSON.stringify({ name: '@acme/web', dependencies: { '@acme/ui': 'workspace:*', react: '^18' } }),
    'packages/ui/package.json': JSON.stringify({ name: '@acme/ui', devDependencies: { '@acme/shared': 'workspace:*' } }),
    'packages/shared/package.json': JSON.stringify({ name: '@acme/shared' }),
  });
  const modules = [
    { name: 'apps/web', prefix: 'apps/web/' },
    { name: 'packages/ui', prefix: 'packages/ui/' },
    { name: 'packages/shared', prefix: 'packages/shared/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'pnpm-workspace' });
  assert.ok(declared.has(pairKey('apps/web', 'packages/ui')));
  assert.ok(declared.has(pairKey('packages/ui', 'packages/shared')));
  assert.strictEqual(declared.size, 2);
});

test('a dependency naming a package outside the workspace is not an inter-module edge', () => {
  const files = ['apps/web/package.json'];
  const readText = reader({
    'apps/web/package.json': JSON.stringify({ name: '@acme/web', dependencies: { lodash: '^4' } }),
  });
  const modules = [{ name: 'apps/web', prefix: 'apps/web/' }];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'pnpm-workspace' });
  assert.strictEqual(declared.size, 0);
});

// ─── Python ──────────────────────────────────────────────────────────────────

test('a uv workspace resolves declared dependencies through project names', () => {
  const files = ['apps/api/pyproject.toml', 'libraries/core/pyproject.toml'];
  const readText = reader({
    'apps/api/pyproject.toml': '[project]\nname = "api"\ndependencies = ["core", "httpx>=0.27"]\n',
    'libraries/core/pyproject.toml': '[project]\nname = "core"\ndependencies = []\n',
  });
  const modules = [
    { name: 'apps/api', prefix: 'apps/api/' },
    { name: 'libraries/core', prefix: 'libraries/core/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'uv-workspace' });
  assert.ok(declared.has(pairKey('apps/api', 'libraries/core')));
  assert.strictEqual(declared.size, 1);
});

// ─── Undeclarable shapes ─────────────────────────────────────────────────────

// Namespaces inside a single application have no declaration mechanism at all,
// so "undeclared" is true of every pair by construction and means nothing. The
// metric must refuse to grade rather than flag everything.
test('a source-namespace repo cannot express declared dependencies and is not gradeable', () => {
  const { declarable } = declaredDependencyPairs({
    files: [], readText: () => null, modules: [], kind: 'source-namespace',
  });
  assert.strictEqual(declarable, false);
});

test('workspace and umbrella shapes are gradeable', () => {
  for (const kind of DECLARABLE_KINDS) {
    const { declarable } = declaredDependencyPairs({
      files: [], readText: () => null, modules: [], kind,
    });
    assert.strictEqual(declarable, true, `${kind} should be declarable`);
  }
  assert.ok(DECLARABLE_KINDS.includes('elixir-umbrella'));
  assert.ok(DECLARABLE_KINDS.includes('pnpm-workspace'));
  assert.ok(!DECLARABLE_KINDS.includes('source-namespace'));
});

test('pairKey is order-independent', () => {
  assert.strictEqual(pairKey('b', 'a'), pairKey('a', 'b'));
});

// A manifest we cannot read must not silently become "no dependency declared",
// which would turn every coupled pair into a violation.
test('a module whose manifest is unreadable is reported, not treated as declaring nothing', () => {
  const files = ['apps/web/package.json', 'packages/ui/package.json'];
  const readText = reader({
    'apps/web/package.json': '{ this is not json',
    'packages/ui/package.json': JSON.stringify({ name: '@acme/ui' }),
  });
  const modules = [
    { name: 'apps/web', prefix: 'apps/web/' },
    { name: 'packages/ui', prefix: 'packages/ui/' },
  ];
  const { unreadable } = declaredDependencyPairs({ files, readText, modules, kind: 'pnpm-workspace' });
  assert.deepStrictEqual(unreadable, ['apps/web']);
});

// Regression: a Phoenix app can carry its own package.json for asset building.
// Choosing the manifest by first-match reads that instead of mix.exs, loses every
// umbrella dependency, and turns declared pairs into "hidden couplings". Found on
// a real umbrella repo, where an app's package.json shadowed its mix.exs.
test('an elixir app carrying a package.json still resolves its umbrella deps', () => {
  const files = ['apps/api/mix.exs', 'apps/api/package.json', 'apps/catalog/mix.exs'];
  const readText = reader({
    'apps/api/mix.exs': 'defp deps do [{:catalog, in_umbrella: true}] end',
    'apps/api/package.json': JSON.stringify({ name: 'api-assets', dependencies: {} }),
    'apps/catalog/mix.exs': 'defp deps do [] end',
  });
  const modules = [
    { name: 'apps/api', prefix: 'apps/api/' },
    { name: 'apps/catalog', prefix: 'apps/catalog/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'elixir-umbrella' });
  assert.ok(declared.has(pairKey('apps/api', 'apps/catalog')), 'mix.exs must win for an elixir umbrella');
});

// sibling-projects is the one genuinely mixed shape -- each top-level directory
// may be a different ecosystem -- so there the union of what is present is right.
test('a mixed sibling-projects repo unions the manifests it finds', () => {
  const files = ['svc-a/package.json', 'svc-b/pyproject.toml'];
  const readText = reader({
    'svc-a/package.json': JSON.stringify({ name: 'svc-a', dependencies: { 'svc-b': '*' } }),
    'svc-b/pyproject.toml': '[project]\nname = "svc-b"\ndependencies = []\n',
  });
  const modules = [
    { name: 'svc-a', prefix: 'svc-a/' },
    { name: 'svc-b', prefix: 'svc-b/' },
  ];
  const { declared } = declaredDependencyPairs({ files, readText, modules, kind: 'sibling-projects' });
  assert.ok(declared.has(pairKey('svc-a', 'svc-b')));
});
