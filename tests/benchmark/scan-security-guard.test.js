'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runToFile } = require('../../scripts/benchmark/scan-security');

// The C9 scanners exit non-zero for two very different reasons: they found
// something (normal — the report is still written) and they failed to run (the
// report is absent). Conflating those two is how a scan that never happened
// scores a system clean for secrets and CVEs.

function tmpOut() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'c9-guard-')), 'report.json');
}

test('a scanner that writes its report is accepted even when it exits non-zero', () => {
  // gitleaks/semgrep/trivy all exit non-zero when they have findings.
  const out = tmpOut();
  fs.writeFileSync(out, JSON.stringify([{ RuleID: 'private-key' }]));
  assert.doesNotThrow(() => runToFile('false', [], out), 'findings-exit must not fail the scan');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [{ RuleID: 'private-key' }]);
});

test('a scanner that fails to run throws instead of fabricating an empty report', () => {
  // The previous behaviour wrote `{}` here, which every downstream parser reads
  // as "no findings" — a clean security score for an unscanned system.
  const out = tmpOut();
  assert.throws(
    () => runToFile('definitely-not-a-real-binary-xyz', ['--json'], out),
    /produced no report/,
  );
  assert.strictEqual(fs.existsSync(out), false, 'must not leave a fabricated report behind');
});

test('the thrown error names the scanner and carries the underlying cause', () => {
  const out = tmpOut();
  try {
    runToFile('definitely-not-a-real-binary-xyz', [], out);
    assert.fail('expected a throw');
  } catch (err) {
    assert.match(err.message, /definitely-not-a-real-binary-xyz/, 'names which scanner failed');
    assert.match(err.message, /Underlying error:/, 'keeps the cause for debugging');
  }
});
