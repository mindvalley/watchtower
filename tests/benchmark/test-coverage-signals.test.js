// tests/benchmark/test-coverage-signals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  aggregateStack, aggregateStackByImports, detectThresholds, detectTool, SKIP_DIRS,
} = require('../../scripts/benchmark/test-coverage-signals');

test('detectTool: elixir excoveralls via coveralls.json filename or mix coveralls task', () => {
  // T7: Charlie signals coverage via a coveralls.json file (content is just
  // {"minimum_coverage":0}); Alpha via a `mix coveralls` CI task. Neither
  // literally contains "excoveralls".
  assert.strictEqual(detectTool('elixir', 'app/apps/orders_db/coveralls.json'), 'excoveralls');
  assert.strictEqual(detectTool('elixir', 'run: mix coveralls.github --minimum-coverage 78'), 'excoveralls');
});

test('detectTool: GitHub Actions cobertura-action is the enforcement mechanism (any stack)', () => {
  // From PR review: a real pilot enforces coverage via an org cobertura-action
  // in CI (both Elixir and frontend), not ExCoveralls. The GH Actions gate is the
  // primary discipline signal and takes precedence over library detection.
  assert.strictEqual(detectTool('elixir', 'uses: acme/cobertura-action@master'), 'cobertura-action');
  assert.strictEqual(detectTool('frontend', 'uses: acme/cobertura-action@master'), 'cobertura-action');
});

test('aggregateStack: pairs source to test by stem, caps samples', () => {
  const src = ['lib/a/user.ex', 'lib/a/order.ex', 'lib/a/cart.ex'];
  const tst = ['test/a/user_test.exs', 'test/a/order_test.exs'];
  const r = aggregateStack(src, tst, 20);
  assert.strictEqual(r.source_files, 3);
  assert.strictEqual(r.tested_files, 2);
  assert.deepStrictEqual(r.untested_samples, ['lib/a/cart.ex']);
});

test('detectThresholds: reads minimum_coverage from yaml/json/ruby, drops 0', () => {
  assert.deepStrictEqual(detectThresholds('minimum_coverage: 78\nminimum_coverage: 82'), [78, 82]);
  assert.deepStrictEqual(detectThresholds('"minimum_coverage": 0'), []);
  assert.deepStrictEqual(detectThresholds('SimpleCov.minimum_coverage 75'), [75]);
});

test('detectTool: per-stack coverage tool presence', () => {
  assert.strictEqual(detectTool('elixir', 'defp deps do [{:excoveralls, "~> 0.18"}] end'), 'excoveralls');
  assert.strictEqual(detectTool('ruby', "gem 'simplecov', require: false"), 'simplecov');
  assert.strictEqual(detectTool('frontend', '"@vitest/coverage-v8": "^1.0.0"'), 'vitest/jest');
  assert.strictEqual(detectTool('elixir', 'no coverage tool here'), null);
});

test('aggregateStack: pairs python source to test by stem (test_ prefix)', () => {
  const src = ['src/net/client.py', 'src/net/store.py'];
  const tst = ['tests/test_client.py'];
  const r = aggregateStack(src, tst, 20);
  assert.strictEqual(r.source_files, 2);
  assert.strictEqual(r.tested_files, 1);
  assert.deepStrictEqual(r.untested_samples, ['src/net/store.py']);
});

test('detectTool: python coverage tooling', () => {
  assert.strictEqual(detectTool('python', 'dependencies = ["pytest-cov>=4"]'), 'coverage.py');
  assert.strictEqual(detectTool('python', 'run: pytest --cov=src --cov-report=xml'), 'coverage.py');
  assert.strictEqual(detectTool('python', 'nothing here'), null);
});

test('detectThresholds: codecov target and pytest cov-fail-under', () => {
  assert.deepStrictEqual(detectThresholds('coverage:\n  status:\n    project:\n      target: 80%'), [80]);
  assert.deepStrictEqual(detectThresholds('pytest --cov=src --cov-fail-under=75'), [75]);
});

test('detectThresholds: `target:` is anchored — compound *_target keys never forge a threshold', () => {
  // A non-coverage key like bundle_size_target must NOT register as an enforced
  // coverage threshold (would be a false-green into the "enforced" tier).
  assert.deepStrictEqual(detectThresholds('bundle_size_target: 90'), []);
  assert.deepStrictEqual(detectThresholds('cache_target: 50\ncpu.target: 70'), []);
  // A real coverage target (line-start / after whitespace) still matches.
  assert.deepStrictEqual(detectThresholds('    target: 85'), [85]);
});

test('aggregateStackByImports: a same-named test that does not import the file does not count', () => {
  const src = ['apps/web/src/app/home/page.tsx', 'apps/web/src/app/settings/page.tsx'];
  const tst = ['apps/web/src/app/settings/__tests__/page.test.tsx'];
  const imports = new Map([[tst[0], new Set(['apps/web/src/app/settings/page.tsx'])]]);
  const r = aggregateStackByImports(src, tst, imports, 20);
  assert.strictEqual(r.source_files, 2);
  assert.strictEqual(r.tested_files, 1);
  assert.strictEqual(r.credited_by_name_only, 1);
  assert.deepStrictEqual(r.untested_samples, ['apps/web/src/app/home/page.tsx']);
});

test('aggregateStackByImports: an import from a differently-named test does not count', () => {
  const src = ['src/types/user.ts'];
  const tst = ['src/api/client.test.ts'];
  const imports = new Map([[tst[0], new Set(['src/types/user.ts'])]]);
  const r = aggregateStackByImports(src, tst, imports, 20);
  assert.strictEqual(r.tested_files, 0);
  assert.strictEqual(r.credited_by_name_only, 0);
});

test('aggregateStackByImports: name and import together count, python naming included', () => {
  const src = ['src/net/client.py', 'src/ui/button.tsx'];
  const tst = ['tests/test_client.py', 'src/ui/button.spec.tsx'];
  const imports = new Map([
    ['tests/test_client.py', new Set(['src/net/client.py'])],
    ['src/ui/button.spec.tsx', new Set(['src/ui/button.tsx'])],
  ]);
  const r = aggregateStackByImports(src, tst, imports, 20);
  assert.strictEqual(r.tested_files, 2);
  assert.deepStrictEqual(r.untested_samples, []);
});

test('aggregateStackByImports: a test with no recorded imports credits nothing', () => {
  const r = aggregateStackByImports(['src/a.ts'], ['src/a.test.ts'], new Map(), 20);
  assert.strictEqual(r.tested_files, 0);
  assert.strictEqual(r.credited_by_name_only, 1);
});

const { choosePairing, IMPORT_RESOLUTION_THRESHOLD } = require('../../scripts/benchmark/test-coverage-signals');

test('choosePairing: keeps import pairing when the graph sees most name-matched pairs', () => {
  const byImports = { source_files: 10, tested_files: 9, untested_samples: [], credited_by_name_only: 1 };
  const byName = { source_files: 10, tested_files: 10, untested_samples: [] };
  const r = choosePairing(byImports, byName);
  assert.strictEqual(r.pairing, 'imports');
  assert.strictEqual(r.tested_files, 9);
  assert.deepStrictEqual(r.import_resolution, { named_pairs: 10, imported: 9, rate: 0.9, threshold: IMPORT_RESOLUTION_THRESHOLD });
});

test('choosePairing: falls back to filename pairing when the graph misses most of them', () => {
  const byImports = { source_files: 525, tested_files: 6, untested_samples: ['a.vue'], credited_by_name_only: 136 };
  const byName = { source_files: 525, tested_files: 142, untested_samples: ['b.vue'] };
  const r = choosePairing(byImports, byName);
  assert.strictEqual(r.pairing, 'filename');
  assert.strictEqual(r.tested_files, 142);
  assert.deepStrictEqual(r.untested_samples, ['b.vue']);
  assert.strictEqual(r.import_resolution.rate, 0.0423);
  assert.match(r.pairing_fallback, /6 of 142/);
});

test('choosePairing: no name-matched pairs gives no evidence, so filename pairing stays', () => {
  const byImports = { source_files: 3, tested_files: 0, untested_samples: [], credited_by_name_only: 0 };
  const byName = { source_files: 3, tested_files: 0, untested_samples: [] };
  const r = choosePairing(byImports, byName);
  assert.strictEqual(r.pairing, 'filename');
  assert.strictEqual(r.import_resolution.named_pairs, 0);
});
