'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The integration tests here skip without DATABASE_URL, which is right on a
// laptop and useless in CI — no database, no failures, green.
//
// So: in CI a missing database fails. On a laptop it is announced, because the
// test runner reports a skip count and not one word about what was skipped.

const DIR = __dirname;

function integrationFiles() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => f !== path.basename(__filename))
    .filter((f) => /const skip = !process\.env\.DATABASE_URL/.test(fs.readFileSync(path.join(DIR, f), 'utf8')))
    .sort();
}

test('in CI there must be a database, or the integration tests silently do not run', () => {
  const files = integrationFiles();

  // Not a vacuous pass: a differently-spelled skip guard finds nothing here.
  assert.ok(files.length > 0, 'no integration test files found — this guard is looking for the wrong thing');

  if (process.env.DATABASE_URL) return;

  const list = files.join(', ');
  assert.ok(
    !process.env.CI,
    `CI has no DATABASE_URL, so these would report success without running: ${list}`,
  );

  console.log(`  note: no DATABASE_URL — the integration tests in ${files.length} file(s) will skip: ${list}`);
});
