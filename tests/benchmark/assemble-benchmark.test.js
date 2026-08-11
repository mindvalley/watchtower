const { test } = require('node:test');
const assert = require('node:assert');
const { buildSystemEntry, assembleBenchmark, TOTAL_CRITERIA } = require('../../scripts/benchmark/assemble-benchmark');

const green9 = { score: 5.0, colour: 'green', critical: false, assessed: true, assessed_at: '2026-06-30' };
const capped9 = { score: 1.5, colour: 'red', critical: true, assessed: true, assessed_at: '2026-06-30' };

test('TOTAL_CRITERIA is the 7-criterion namespace (former C3, C5 removed)', () => {
  assert.strictEqual(TOTAL_CRITERIA, 7);
});

test('buildSystemEntry composites scored criteria and labels coverage as N of 7', () => {
  const entry = buildSystemEntry({ criteria: { 9: green9 }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.score, 5.0);
  assert.strictEqual(entry.colour, 'green');
  assert.strictEqual(entry.hard_capped, false);
  assert.strictEqual(entry.coverage, '1 of 7 assessed');
  assert.strictEqual(entry.assessed_at, '2026-06-30');
});

test('buildSystemEntry forces red when any criterion is critical (hard-cap)', () => {
  const entry = buildSystemEntry({ criteria: { 9: capped9 }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.score, 1.5);
  assert.strictEqual(entry.colour, 'red');
  assert.strictEqual(entry.hard_capped, true);
});

test('buildSystemEntry averages only scored criteria (ignores entries with null score)', () => {
  const entry = buildSystemEntry({
    criteria: { 8: { score: 4.0, colour: 'green', critical: false, assessed_at: '2026-06-19' }, 9: green9 },
    assessedAt: '2026-06-30',
  });
  assert.strictEqual(entry.score, 4.5); // mean(4.0, 5.0)
  assert.strictEqual(entry.coverage, '2 of 7 assessed');
});

test('assembleBenchmark wraps systems with example:false and last_updated', () => {
  const out = assembleBenchmark({
    systems: { alpha: buildSystemEntry({ criteria: { 9: green9 }, assessedAt: '2026-06-30' }) },
    lastUpdated: '2026-06-30',
  });
  assert.strictEqual(out.example, false);
  assert.strictEqual(out.last_updated, '2026-06-30');
  assert.strictEqual(out.systems.alpha.score, 5.0);
});
