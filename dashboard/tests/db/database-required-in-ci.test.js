'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A SUITE THAT SKIPS IS NOT A SUITE, and this folder is built to skip.
//
// Every integration test here opens with `const skip = !process.env.DATABASE_URL`.
// On a laptop that is right: cloning this package and running its tests should
// not require standing up a database first. In CI it is the difference between
// a check and the shape of one — no database, no failures, green.
//
// The two halves of the problem are separate and both are handled here:
//
//   In CI, a missing database is a FAILURE. If the service block is removed,
//   renamed, or fails to come up, this goes red rather than the run going green
//   over a suite that inspected nothing.
//
//   On a laptop, a missing database is announced. The node test runner's summary
//   line reports a skip count and not one word about what was skipped, so a
//   local `npm test` reading "0 failures" has been the exact way a change
//   reached a pull request with a check it had never run. This prints the file
//   names, which is the cheapest possible version of saying so.

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

  // Not a vacuous pass: if the skip guard is ever spelled differently this
  // finds nothing and says so, rather than quietly guarding an empty list.
  assert.ok(files.length > 0, 'no integration test files found — this guard is looking for the wrong thing');

  if (process.env.DATABASE_URL) return;

  const list = files.join(', ');
  assert.ok(
    !process.env.CI,
    `CI has no DATABASE_URL, so these would report success without running: ${list}`,
  );

  console.log(`  note: no DATABASE_URL — the integration tests in ${files.length} file(s) will skip: ${list}`);
});
