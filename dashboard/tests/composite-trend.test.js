'use strict';

// The composite trend model, tested against a fixture built from a real
// production scan_history export (tests/fixtures/scan-history-real.json) — the
// system keys anonymised, every date, score, colour and cap left exactly as the
// database held them. The danger with a chart is not that the maths is wrong in
// the abstract; it is that it is wrong on the shapes the real fleet produces:
// same-day re-scans, a system that jumps 40 points (`gamma`, 23→63), another
// that crashes and recovers (`mu`, 51→20→56), ranges that reach before the data
// starts. So the fixture is real, run through the real reader.
//
// Every assertion here was checked against a planted violation before commit.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildTrendModel, resolveDomain, latestPerDay } = require('../public/js/composite-trend.js');
const { rowsToHistory } = require('../db/model.js');

const FLOOR = '2026-08-27';
const BOX = { left: 44, right: 616, top: 20, bottom: 168 };
const BANDS = [{ value: 40, colour: 'red' }, { value: 70, colour: 'amber' }];
// Two groups, standing in for two org tabs. GROUP_A holds the climber (gamma);
// GROUP_B holds the crash-and-recover (mu) and the faller (nu).
const GROUP_A = ['alpha', 'beta', 'delta', 'epsilon', 'gamma'];
const GROUP_B = ['iota', 'mu', 'nu'];

const rows = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'scan-history-real.json'), 'utf8',
));
// The real reader, floored where the served endpoint floors it.
const history = rowsToHistory(rows, { since: FLOOR });

const model = (opts) => buildTrendModel(history, {
  floor: FLOOR, box: BOX, bands: BANDS, ...opts,
});
const seriesFor = (m, key) => m.series.find((s) => s.key === key);

test('same-day re-scans collapse to one point per day', () => {
  // The fleet scanned twice on 2026-09-21 (04:43 and 05:48), so gamma has two
  // rows that day. Without dedupe the 90-day window shows six gamma points; the
  // distinct days since the floor are five.
  const m = model({ keys: GROUP_A, range: '90d' });
  const gamma = seriesFor(m, 'gamma');
  const days = new Set(gamma.points.map((p) => p.date));
  assert.strictEqual(gamma.points.length, days.size, 'a day appears more than once');
  assert.strictEqual(gamma.points.length, 5, 'expected five distinct days since the floor');
});

test('the climber shows its real 23 to 63 rise, left to right', () => {
  const m = model({ keys: GROUP_A, range: '90d' });
  const pts = seriesFor(m, 'gamma').points;
  assert.strictEqual(pts[0].score, 23);
  assert.strictEqual(pts[pts.length - 1].score, 63);
  // x strictly increases with time — the climb reads left to right.
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i].x > pts[i - 1].x);
  // and a higher score sits higher on the chart (smaller y).
  assert.ok(pts[pts.length - 1].y < pts[0].y);
});

test('the crash-and-recover shows as 51 to 20 to 56', () => {
  const m = model({ keys: GROUP_B, range: '90d' });
  const scores = seriesFor(m, 'mu').points.map((p) => p.score);
  assert.deepStrictEqual(scores, [51, 20, 56]);
});

test('the default 30-day window starts at the floor, not 30 days before latest', () => {
  // Latest reading is 2026-09-21; 30 days before is 2026-08-22, which is earlier
  // than the floor, so the window must clamp to the floor.
  const m = model({ keys: GROUP_A, range: '30d' });
  const first = seriesFor(m, 'gamma').points[0].date;
  assert.ok(first >= FLOOR, `first point ${first} is before the floor`);
  assert.strictEqual(first, '2026-08-31'); // the first scan on/after the floor
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
  // Latest is 09-21; the week before it includes 09-14 and 09-21 only.
  assert.deepStrictEqual(
    seriesFor(m, 'gamma').points.map((p) => p.date),
    ['2026-09-14', '2026-09-21'],
  );
});

test('axis ticks are regular — evenly spaced', () => {
  const m = model({ keys: GROUP_A, range: '90d' });
  assert.ok(m.ticks.length >= 2);
  const gaps = m.ticks.slice(1).map((t, i) => +(t.x - m.ticks[i].x).toFixed(3));
  const first = gaps[0];
  for (const g of gaps) assert.ok(Math.abs(g - first) < 0.01, `uneven tick gap ${g} vs ${first}`);
});

test('hiding a system keeps it in the legend but draws no line', () => {
  const m = model({ keys: GROUP_A, range: '90d', hidden: ['gamma'] });
  const gamma = seriesFor(m, 'gamma');
  assert.strictEqual(gamma.hidden, true);
  assert.strictEqual(gamma.points.length, 0, 'a hidden system must draw no points');
  assert.ok(m.series.some((s) => s.key === 'gamma'), 'hidden system dropped from legend');
});

test('colour is stable when a system is hidden — indexed by declared order', () => {
  const shown = model({ keys: GROUP_A, range: '90d' });
  const hiddenOne = model({ keys: GROUP_A, range: '90d', hidden: ['alpha'] });
  // alpha is first; hiding it must NOT shift the others onto new colours.
  for (const key of GROUP_A) {
    assert.strictEqual(
      seriesFor(hiddenOne, key).colour,
      seriesFor(shown, key).colour,
      `${key} changed colour when another system was hidden`,
    );
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
  const pts = [
    { date: '2026-09-21', score: 10 },
    { date: '2026-09-21', score: 63 },
    { date: '2026-09-14', score: 20 },
  ];
  const out = latestPerDay(pts);
  assert.deepStrictEqual(out.map((p) => [p.date, p.score]), [
    ['2026-09-14', 20], ['2026-09-21', 63],
  ]);
});
