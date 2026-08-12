'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  selectSystems, assertReportsPresent, REQUIRED_REPORTS,
} = require('../../scripts/benchmark/assemble-scores');
const { writeManifest, readManifest } = require('../../scripts/benchmark/run-manifest');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-test-'));
}

function writeReports(root, systemKey, names) {
  fs.mkdirSync(path.join(root, systemKey), { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(root, systemKey, `${n}.json`), '{}');
}

// --- scope ----------------------------------------------------------------

test('assembles everything the config lists when nothing narrower is asked for', () => {
  const config = { systems: { charlie: {}, alpha: {}, bravo: {} } };
  assert.deepStrictEqual(selectSystems(config, undefined), ['alpha', 'bravo', 'charlie']);
});

test('a named subset is honoured, separated by spaces or commas', () => {
  const config = { systems: { alpha: {}, bravo: {}, charlie: {} } };
  assert.deepStrictEqual(selectSystems(config, 'charlie alpha'), ['alpha', 'charlie']);
  assert.deepStrictEqual(selectSystems(config, 'charlie,alpha'), ['alpha', 'charlie']);
});

test('naming a system the config does not list is an error, not a silent omission', () => {
  // Assembling three of four because one key was mistyped produces a board that
  // is quietly short a system, which nothing downstream would flag.
  const config = { systems: { alpha: {} } };
  assert.throws(() => selectSystems(config, 'alpha bravo'), /bravo/);
});

// --- the missing-report guard ---------------------------------------------

test('refuses to assemble when a required report is missing', () => {
  // The whole point. A missing report reads downstream as no findings, which is
  // indistinguishable from a clean result — so a scan leg that died would score
  // its system green. The guard has to be here, in the engine, rather than in
  // one caller's pipeline where only that caller benefits from it.
  const root = tmpdir();
  writeReports(root, 'alpha', REQUIRED_REPORTS.filter((n) => n !== 'boundaries'));

  assert.throws(
    () => assertReportsPresent(['alpha'], root),
    (err) => /alpha\/boundaries\.json/.test(err.message) && /Refusing to assemble/.test(err.message),
  );
});

test('a system with no reports at all is caught, not treated as nothing to do', () => {
  const root = tmpdir();
  writeReports(root, 'alpha', REQUIRED_REPORTS);

  assert.throws(() => assertReportsPresent(['alpha', 'bravo'], root), /bravo/);
});

test('names every missing report, not just the first', () => {
  // A guard that stops at the first failure turns one broken run into several
  // rounds of fix-and-rerun.
  const root = tmpdir();
  writeReports(root, 'alpha', ['gitleaks']);

  try {
    assertReportsPresent(['alpha'], root);
    assert.fail('expected a throw');
  } catch (err) {
    for (const name of REQUIRED_REPORTS.filter((n) => n !== 'gitleaks')) {
      assert.match(err.message, new RegExp(`alpha/${name}\\.json`));
    }
  }
});

test('passes when every required report is present', () => {
  const root = tmpdir();
  writeReports(root, 'alpha', REQUIRED_REPORTS);
  writeReports(root, 'bravo', REQUIRED_REPORTS);
  assert.doesNotThrow(() => assertReportsPresent(['alpha', 'bravo'], root));
});

// --- the run manifest -----------------------------------------------------

test('the manifest round-trips, sorted', () => {
  const root = tmpdir();
  writeManifest(root, ['charlie', 'alpha', 'bravo']);
  assert.deepStrictEqual(readManifest(root).systems, ['alpha', 'bravo', 'charlie']);
});

test('a missing manifest is an error rather than an empty list', () => {
  // "Nothing was assembled" and "the assemble step never ran" are different
  // facts. Reading the second as the first is a broken pipeline reporting
  // success, which is the same shape as a scanner that could not run scoring a
  // subject clean.
  assert.throws(() => readManifest(tmpdir()), /No run manifest/);
});

test('a malformed manifest is an error rather than an empty list', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'assembled.json'), '{ not json');
  assert.throws(() => readManifest(root), /not valid JSON/);

  fs.writeFileSync(path.join(root, 'assembled.json'), '{"nope":[]}');
  assert.throws(() => readManifest(root), /no "systems" array/);
});
