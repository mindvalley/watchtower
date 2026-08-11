// tests/benchmark/test-coverage-signals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  aggregateStack, detectThresholds, detectTool, SKIP_DIRS,
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
