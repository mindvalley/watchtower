// tests/benchmark/scan-documented-apis.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanArtifacts } = require('../../scripts/benchmark/scan-documented-apis');
const { scoreDocumentedApis } = require('../../scripts/benchmark/score-documented-apis');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-fixture-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('scanArtifacts: no artifact -> null', () => {
  const dir = fixture({ 'README.md': '# nothing here' });
  const r = scanArtifacts(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r, null);
});

test('a repo with no API artifact still gets a report, and it scores Pending', () => {
  // The edge used to write nothing here, so "the scan looked and there is no
  // API to describe" and "the scan died before writing" were the same absence
  // to everything downstream. Anything trying to tell a dead leg from a clean
  // one had no way to.
  //
  // The two conditions that make writing one safe, both pinned here: an empty
  // report scores Pending, and Pending is what an absent report scored, so no
  // system's number moves. The failure this guards against is the opposite —
  // zero described out of zero total arriving as full marks.
  const { buildReport } = require('../../scripts/benchmark/documented-apis-signals');
  const report = buildReport({ applicable: true, records: [], filesParsed: 0 });

  assert.strictEqual(report.total, 0);
  assert.strictEqual(scoreDocumentedApis(report, { assessedAt: '2026-01-01' }), null);
});

test('scanArtifacts: committed OpenAPI -> rest records; scores', () => {
  const dir = fixture({
    'docs/openapi.json': JSON.stringify({ openapi: '3.0.0', paths: { '/a': { get: { summary: 'gets a' } } } }),
  });
  const r = scanArtifacts(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.rest_api_detected, true);
  assert.strictEqual(r.rest.total, 1);
  assert.ok(scoreDocumentedApis(r, {}).score > 0);
});

test('scanArtifacts: empty OpenAPI does NOT suppress a co-present GraphQL score', () => {
  const dir = fixture({
    // valid header, no operations -> zero REST records
    'api/openapi.json': JSON.stringify({ openapi: '3.0.0', paths: {} }),
    'schema.graphql': 'type User {\n  "the id"\n  id: ID!\n  name: String\n}',
  });
  const r = scanArtifacts(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  // rest gated off (no REST records) so the scorer's rest-detection guard can't null it
  assert.strictEqual(r.rest_api_detected, false);
  assert.strictEqual(r.total, 2); // GraphQL fields id + name
  const sc = scoreDocumentedApis(r, {});
  assert.ok(sc && sc.score > 0, 'GraphQL score must survive the empty OpenAPI');
});
