// tests/benchmark/layout-discovery.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFile } = require('../../scripts/benchmark/layout-discovery');

test('classifyFile: elixir source vs test (single + umbrella, full-path)', () => {
  assert.deepStrictEqual(classifyFile('lib/x.ex'), { stack: 'elixir', role: 'source' });
  assert.deepStrictEqual(classifyFile('apps/api/lib/api/user.ex'), { stack: 'elixir', role: 'source' });
  assert.deepStrictEqual(classifyFile('apps/api/test/api/user_test.exs'), { stack: 'elixir', role: 'test' });
});

test('classifyFile: ruby source vs spec', () => {
  assert.deepStrictEqual(classifyFile('app/models/user.rb'), { stack: 'ruby', role: 'source' });
  assert.deepStrictEqual(classifyFile('lib/user.rb'), { stack: 'ruby', role: 'source' });
  assert.deepStrictEqual(classifyFile('spec/models/user_spec.rb'), { stack: 'ruby', role: 'test' });
  assert.deepStrictEqual(classifyFile('test/user_test.rb'), { stack: 'ruby', role: 'test' });
});

test('classifyFile: frontend under phoenix assets/ (the five) — assets/package.json must NOT hide it', () => {
  // Regression: manifest-root discovery made assets/ a root and stripped the
  // prefix, collapsing bravo frontend 124 -> 0. Full-path matching sees it.
  assert.deepStrictEqual(classifyFile('assets/js/app.js'), { stack: 'frontend', role: 'source' });
  assert.deepStrictEqual(classifyFile('assets/js/widget.spec.ts'), { stack: 'frontend', role: 'test' });
});

test('classifyFile: frontend under a monorepo package (src/ nested)', () => {
  assert.deepStrictEqual(classifyFile('apps/web/src/components/Card.tsx'), { stack: 'frontend', role: 'source' });
  assert.deepStrictEqual(classifyFile('packages/ui/src/Button.ts'), { stack: 'frontend', role: 'source' });
  assert.deepStrictEqual(classifyFile('apps/web/src/components/Card.test.tsx'), { stack: 'frontend', role: 'test' });
  assert.deepStrictEqual(classifyFile('apps/web/src/__tests__/setup.ts'), { stack: 'frontend', role: 'test' });
});

test('classifyFile: .d.ts declaration and config files are not source (denominator hygiene)', () => {
  assert.deepStrictEqual(classifyFile('src/types/api.d.ts'), { stack: null, role: null });
  assert.deepStrictEqual(classifyFile('assets/js/globals.d.ts'), { stack: null, role: null });
  assert.deepStrictEqual(classifyFile('apps/web/src/vite.config.ts'), { stack: null, role: null });
});

test('classifyFile: python src-layout package', () => {
  assert.deepStrictEqual(classifyFile('libraries/core/src/net/client.py'), { stack: 'python', role: 'source' });
  assert.deepStrictEqual(classifyFile('libraries/core/tests/test_client.py'), { stack: 'python', role: 'test' });
  assert.deepStrictEqual(classifyFile('apps/api/tests/routes_test.py'), { stack: 'python', role: 'test' });
  // conftest / fixtures under tests/ are neither source nor test
  assert.deepStrictEqual(classifyFile('libraries/core/tests/conftest.py'), { stack: null, role: null });
  // top-level scripts (not under src/lib) are not source
  assert.deepStrictEqual(classifyFile('scripts/migrate.py'), { stack: null, role: null });
});

test('classifyFile: ignores config/non-source', () => {
  assert.deepStrictEqual(classifyFile('vite.config.ts'), { stack: null, role: null });
  assert.deepStrictEqual(classifyFile('config/config.exs'), { stack: null, role: null });
  assert.deepStrictEqual(classifyFile('README.md'), { stack: null, role: null });
});

test('classifyFile: test detection precedes source (a .spec under src is a test)', () => {
  assert.deepStrictEqual(classifyFile('src/schemas/page.schema.spec.ts'), { stack: 'frontend', role: 'test' });
});

test('classifyFile: a .spec test is a test even outside src/ (no src prefix required)', () => {
  assert.deepStrictEqual(classifyFile('tests/e2e.spec.ts'), { stack: 'frontend', role: 'test' });
});

test('classifyFile: python test under __tests__/ goes to python, not frontend', () => {
  // __tests__/ is a JS/TS convention; a .py file under it must not be counted as
  // a frontend test — the python carve-out lets it reach the python branch.
  assert.deepStrictEqual(classifyFile('pkg/__tests__/test_helper.py'), { stack: 'python', role: 'test' });
  // Non-.py files under __tests__/ keep the original frontend-test behavior.
  assert.deepStrictEqual(classifyFile('pkg/__tests__/helper.ts'), { stack: 'frontend', role: 'test' });
});
