'use strict';

// Tests the composite trend model against a fixture built from a real
// scan_history export, with the system keys anonymised: gamma climbs 23->63,
// mu crashes and recovers 51->20->56, nu falls 54->21->20.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildTrendModel, resolveDomain, latestPerDay } = require('../public/js/composite-trend.js');
const { rowsToHistory } = require('../db/model.js');

const FLOOR = '2026-08-27';
const BOX = { left: 44, right: 616, top: 20, bottom: 168 };
const BANDS = [{ value: 40, colour: 'red' }, { value: 70, colour: 'amber' }];
const GROUP_A = ['alpha', 'beta', 'delta', 'epsilon', 'gamma'];
const GROUP_B = ['iota', 'mu', 'nu'];

const rows = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'scan-history-real.json'), 'utf8',
));
const history = rowsToHistory(rows, { since: FLOOR });

const model = (opts) => buildTrendModel(history, {
  floor: FLOOR, box: BOX, bands: BANDS, ...opts,
});
const seriesFor = (m, key) => m.series.find((s) => s.key === key);

test('same-day re-scans collapse to one point per day', () => {
  // gamma has two rows on 2026-09-21; the window shows five distinct days.
  const m = model({ keys: GROUP_A, range: '90d' });
  const gamma = seriesFor(m, 'gamma');
  const days = new Set(gamma.points.map((p) => p.date));
  assert.strictEqual(gamma.points.length, days.size);
  assert.strictEqual(gamma.points.length, 5);
});

test('the climber shows its real 23 to 63 rise, left to right', () => {
  const m = model({ keys: GROUP_A, range: '90d' });
  const pts = seriesFor(m, 'gamma').points;
  assert.strictEqual(pts[0].score, 23);
  assert.strictEqual(pts[pts.length - 1].score, 63);
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i].x > pts[i - 1].x);
  assert.ok(pts[pts.length - 1].y < pts[0].y);
});

test('the crash-and-recover shows as 51 to 20 to 56', () => {
  const m = model({ keys: GROUP_B, range: '90d' });
  const scores = seriesFor(m, 'mu').points.map((p) => p.score);
  assert.deepStrictEqual(scores, [51, 20, 56]);
});

test('the default 30-day window clamps to the floor', () => {
  const m = model({ keys: GROUP_A, range: '30d' });
  const first = seriesFor(m, 'gamma').points[0].date;
  assert.ok(first >= FLOOR);
  assert.strictEqual(first, '2026-08-31');
});

test('a custom range reaching before the floor is clamped to it', () => {
  const m = model({ keys: GROUP_A, range: { from: '2026-01-01', to: '2026-09-21' } });
  assert.ok(seriesFor(m, 'gamma').points.every((p) => p.date >= FLOOR));
});

test('a custom range wholly before the floor is empty, not a crash', () => {
  const m = model({ keys: GROUP_A, range: { from: '2026-07-01', to: '2026-08-01' } });
  assert.strictEqual(m.empty, true);
  assert.strictEqual(m.series.reduce((n, s) => n + s.points.length, 0), 0);
});

test('a 7-day window shows only the last week', () => {
  const m = model({ keys: GROUP_A, range: '7d' });
  assert.deepStrictEqual(
    seriesFor(m, 'gamma').points.map((p) => p.date),
    ['2026-09-14', '2026-09-21'],
  );
});

test('axis ticks are evenly spaced', () => {
  const m = model({ keys: GROUP_A, range: '90d' });
  assert.ok(m.ticks.length >= 2);
  const gaps = m.ticks.slice(1).map((t, i) => +(t.x - m.ticks[i].x).toFixed(3));
  for (const g of gaps) assert.ok(Math.abs(g - gaps[0]) < 0.01);
});

test('hiding a system keeps it in the legend but draws no line', () => {
  const m = model({ keys: GROUP_A, range: '90d', hidden: ['gamma'] });
  const gamma = seriesFor(m, 'gamma');
  assert.strictEqual(gamma.hidden, true);
  assert.strictEqual(gamma.points.length, 0);
  assert.ok(m.series.some((s) => s.key === 'gamma'));
});

test('colour is stable when a system is hidden', () => {
  const shown = model({ keys: GROUP_A, range: '90d' });
  const hiddenOne = model({ keys: GROUP_A, range: '90d', hidden: ['alpha'] });
  for (const key of GROUP_A) {
    assert.strictEqual(seriesFor(hiddenOne, key).colour, seriesFor(shown, key).colour);
  }
});

test('all systems hidden reads as empty', () => {
  const m = model({ keys: GROUP_A, range: '90d', hidden: GROUP_A });
  assert.strictEqual(m.empty, true);
});

test('resolveDomain clamps and rejects an inverted window', () => {
  assert.strictEqual(resolveDomain({ from: '2026-09-10', to: '2026-09-01' }, FLOOR, '2026-09-21'), null);
  const d = resolveDomain('90d', FLOOR, '2026-09-21');
  assert.strictEqual(new Date(d.t0).toISOString().slice(0, 10), FLOOR);
});

test('latestPerDay keeps the last reading of a repeated day', () => {
  const out = latestPerDay([
    { date: '2026-09-21', score: 10 },
    { date: '2026-09-21', score: 63 },
    { date: '2026-09-14', score: 20 },
  ]);
  assert.deepStrictEqual(out.map((p) => [p.date, p.score]), [
    ['2026-09-14', 20], ['2026-09-21', 63],
  ]);
});
