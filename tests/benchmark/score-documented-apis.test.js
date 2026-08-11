// tests/benchmark/score-documented-apis.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scoreDocumentedApis } = require('../../scripts/benchmark/score-documented-apis');

const rep = (over = {}) => ({
  applicable: true, files_parsed: 3, total: 100, described: 7,
  by_type: [{ type: 'user', total: 60, described: 4 }, { type: 'query', total: 40, described: 3 }],
  ...over,
});

test('linear map: 7% coverage -> 0.35 (red)', () => {
  const e = scoreDocumentedApis(rep(), { assessedAt: '2026-07-16' });
  assert.strictEqual(e.score, 0.4); // round1(5 * 0.07) = round1(0.35) = 0.4
  assert.strictEqual(e.colour, 'red');
  assert.strictEqual(e.critical, false);
  assert.strictEqual(e.assessed, true);
  assert.strictEqual(e.sub.field_description_coverage.described, 7);
  assert.strictEqual(e.sub.field_description_coverage.total, 100);
});

test('full coverage -> 5.0 green', () => {
  const e = scoreDocumentedApis(rep({ described: 100 }), {});
  assert.strictEqual(e.score, 5.0);
  assert.strictEqual(e.colour, 'green');
  assert.strictEqual(e.actions.length, 0); // nothing undescribed
});

test('green threshold ~72%', () => {
  const e = scoreDocumentedApis(rep({ total: 100, described: 72 }), {});
  assert.strictEqual(e.score, 3.6);
  assert.strictEqual(e.colour, 'green');
});

test('N/A report -> null (criterion absent)', () => {
  assert.strictEqual(scoreDocumentedApis({ applicable: false, rest_api_detected: false }, {}), null);
});

test('REST detected but no rest block -> Pending (detection failure, never false green)', () => {
  const e = scoreDocumentedApis(rep({ rest_api_detected: true }), { assessedAt: '2026-07-22' });
  assert.strictEqual(e, null);
});

test('pooled GraphQL + REST coverage', () => {
  // GraphQL 0/115 + REST 210/260 -> pooled 210/375 = 0.56 -> round1(2.8)
  const e = scoreDocumentedApis({
    applicable: true, rest_api_detected: true, files_parsed: 2, total: 115, described: 0, by_type: [],
    rest: { files_parsed: 22, total: 260, described: 210, by_kind: {
      operation: { total: 40, described: 38 }, parameter: { total: 120, described: 95 }, property: { total: 100, described: 77 },
    } },
  }, { assessedAt: '2026-07-22' });
  assert.strictEqual(e.score, 2.8);            // round1(5 * 210/375)
  assert.strictEqual(e.assessed, true);
  assert.strictEqual(e.sub.field_description_coverage.total, 115);
  assert.strictEqual(e.sub.rest_description_coverage.total, 260);
  assert.strictEqual(e.sub.rest_description_coverage.described, 210);
  assert.ok(e.findings.some((f) => /REST\/OpenAPI/.test(f)));
  assert.ok(e.findings.some((f) => /GraphQL/.test(f)));
  assert.ok(e.actions.length >= 1);
});

test('rest-only Elixir system (no GraphQL fields) scores on REST alone', () => {
  const e = scoreDocumentedApis({
    applicable: true, rest_api_detected: true, files_parsed: 0, total: 0, described: 0, by_type: [],
    rest: { files_parsed: 5, total: 10, described: 10, by_kind: {
      operation: { total: 5, described: 5 }, parameter: { total: 5, described: 5 }, property: { total: 0, described: 0 },
    } },
  }, {});
  assert.strictEqual(e.score, 5.0);
  assert.strictEqual(e.sub.field_description_coverage, undefined); // no GraphQL surface
  assert.strictEqual(e.sub.rest_description_coverage.total, 10);
});

test('applicable but zero fields -> null (Pending, never false green)', () => {
  assert.strictEqual(scoreDocumentedApis(rep({ total: 0, described: 0, by_type: [] }), {}), null);
});

test('audit surfaces top undescribed types', () => {
  const e = scoreDocumentedApis(rep(), {});
  assert.strictEqual(e.audit.top_undescribed_types[0].type, 'user');
  assert.strictEqual(e.audit.top_undescribed_types[0].undescribed, 56);
});
