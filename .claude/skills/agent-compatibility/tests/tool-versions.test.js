'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseVersion, statusFor, report, TOOLS,
} = require('../scripts/tool-versions');

test('parseVersion pulls the semver triple out of each tool format', () => {
  assert.equal(parseVersion('8.18.4'), '8.18.4');            // gitleaks
  assert.equal(parseVersion('Version: 0.72.0\nDB: ...'), '0.72.0'); // trivy
  assert.equal(parseVersion('1.78.0'), '1.78.0');            // semgrep
  assert.equal(parseVersion('1.23.0'), '1.23.0');            // lizard
  assert.equal(parseVersion('graphify 0.9.28'), '0.9.28');   // graphify
  assert.equal(parseVersion('v8.18.4'), '8.18.4');           // tolerates a v prefix
  assert.equal(parseVersion('not a version'), null);
});

test('statusFor distinguishes ok, mismatch and missing', () => {
  assert.equal(statusFor('1.2.3', '1.2.3'), 'ok');
  assert.equal(statusFor('1.2.2', '1.2.3'), 'mismatch');
  assert.equal(statusFor(null, '1.2.3'), 'missing');
});

test('report maps every pinned tool, using the CLI name and pin status', () => {
  const pins = {
    gitleaks: '8.18.4', trivy: '0.72.0', semgrep: '1.78.0',
    lizard: '1.23.0', graphifyy: '0.9.28',
  };
  const found = { gitleaks: '8.18.4', trivy: '0.71.0' }; // trivy behind, three missing
  const rows = report(pins, found);
  assert.equal(rows.length, TOOLS.length);
  const byTool = Object.fromEntries(rows.map((r) => [r.tool, r]));
  assert.equal(byTool.gitleaks.status, 'ok');
  assert.equal(byTool.trivy.status, 'mismatch');
  assert.equal(byTool.graphify.status, 'missing'); // pin key graphifyy, command graphify
  assert.equal(byTool.graphify.required, '0.9.28');
});
