'use strict';

// The C8 complexity numerator and denominator must be computed over the SAME
// population. They were not: the LOC walk skipped vendor/, test/ and minified
// bundles while lizard excluded only node_modules/dist/build/coverage and rubocop
// excluded nothing, so violations were counted from files whose lines had already
// been thrown away. These tests hold the single shared definition in place.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  SKIP_DIR_NAMES,
  SKIP_DIR_PATH_GLOBS,
  GENERATED_RE,
  TEST_FILE_RE,
  NONCODE_EXTS,
  shouldSkipDir,
  shouldSkipFile,
  lizardExcludePatterns,
  rubocopExcludeGlobs,
  credoExcludedRegexes,
} = require('../../scripts/benchmark/simplicity-exclusions');

test('every skipped directory reaches lizard, rubocop and credo alike', () => {
  const lizard = lizardExcludePatterns();
  const rubocop = rubocopExcludeGlobs();
  const credo = credoExcludedRegexes();
  for (const d of [...SKIP_DIR_NAMES, ...SKIP_DIR_PATH_GLOBS]) {
    assert.ok(lizard.some((p) => p.includes(`/${d}/`)), `lizard is missing ${d}`);
    assert.ok(rubocop.some((p) => p.includes(`/${d}/`)), `rubocop is missing ${d}`);
    const credoForm = d.split('*').join('[^/]+');
    assert.ok(credo.some((p) => p.includes(`/${credoForm}/`)), `credo is missing ${d}`);
  }
});

test('the vendored files that produced 22 of alpha\'s violations are excluded', () => {
  // apps/catalog/assets/vendor/js/calendar.js (CC 199, 66, 63),
  // s3.fine-uploader.js and jquery.minicolors.js.
  assert.strictEqual(shouldSkipDir('vendor', 'apps/catalog/assets/vendor'), true);
});

test('charlie\'s calendar.min.js is excluded as generated', () => {
  assert.strictEqual(shouldSkipFile('calendar.min.js'), true);
  assert.strictEqual(GENERATED_RE.test('calendar.min.js'), true);
});

test('the playwright test tree is excluded', () => {
  assert.strictEqual(shouldSkipDir('tests', 'playwright/tests'), true);
});

test('test-named files are excluded from the LOC walk as well as the runners', () => {
  // lizard already dropped *.test.* / *.spec.* violations while the LOC walk
  // still counted those files' lines — the inconsistency ran both ways.
  assert.strictEqual(shouldSkipFile('use-cart.test.ts'), true);
  assert.strictEqual(shouldSkipFile('Button.spec.js'), true);
  assert.strictEqual(TEST_FILE_RE.test('latest.js'), false, 'a file merely ending in -test must not match');
  assert.strictEqual(shouldSkipFile('protest.js'), false);
});

test('priv is not skipped wholesale, so Ecto PL/pgSQL can be counted', () => {
  // criteria-docs promises Charlie's PL/pgSQL is reported as unmeasured with a
  // line count. Ecto SQL lives in priv/repo/, so skipping all of priv/ made that
  // claim false: no .sql entry could ever appear.
  assert.strictEqual(shouldSkipDir('priv', 'priv'), false);
  assert.strictEqual(shouldSkipDir('repo', 'priv/repo'), false);
  assert.strictEqual(shouldSkipDir('repo', 'apps/charlie/priv/repo'), false);
});

test('the generated and fixture subtrees of priv are still skipped', () => {
  assert.strictEqual(shouldSkipDir('static', 'priv/static'), true);
  assert.strictEqual(shouldSkipDir('gettext', 'apps/catalog/priv/gettext'), true);
  assert.strictEqual(shouldSkipDir('seeds', 'apps/catalog/priv/repo/seeds'), true);
  assert.strictEqual(shouldSkipDir('seed', 'priv/data/seed'), true);
});

test('a directory merely starting with priv is not skipped', () => {
  assert.strictEqual(shouldSkipDir('private', 'lib/private'), false);
  assert.strictEqual(shouldSkipDir('privileges', 'lib/privileges'), false);
});

test('shouldSkipDir accepts native path separators', () => {
  const nativeish = ['apps', 'catalog', 'priv', 'static'].join(require('node:path').sep);
  assert.strictEqual(shouldSkipDir('static', nativeish), true);
});

test('gettext templates are non-code alongside .po', () => {
  assert.strictEqual(NONCODE_EXTS.has('.pot'), true);
  assert.strictEqual(NONCODE_EXTS.has('.po'), true);
});

test('the credo regex form translates the glob star into a path segment', () => {
  // `/priv/*/seeds/` as an Elixir Regex would mean "zero or more slashes".
  const credo = credoExcludedRegexes();
  assert.ok(credo.includes('/priv/[^/]+/seeds/'));
  assert.strictEqual(credo.some((p) => p.includes('*')), false, 'no raw glob star may reach credo');
});
