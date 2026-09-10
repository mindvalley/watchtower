'use strict';

// The fleet history contract: the projection the overview reads, and the shape
// of the query behind it. No database — both are deterministic.

const { test } = require('node:test');
const assert = require('node:assert');
const { rowsToHistory } = require('../../db/model');
const { fetchHistoryRows } = require('../../db/repo');

// Rows as the query returns them: grouped by system_key, oldest first.
function row(system_key, scanned_at, score, extra = {}) {
  return {
    system_key, scanned_at, score, colour: null, hard_capped: false, ...extra,
  };
}

test('readings are grouped per system and left in the order the query returned', () => {
  const out = rowsToHistory([
    row('alpha', '2026-08-03', 3.4),
    row('alpha', '2026-08-11', 3.5),
    row('alpha', '2026-08-21', 3.6),
    row('beta', '2026-08-03', 2.0),
    row('beta', '2026-08-21', 1.8),
  ], { since: '2026-08-03' });

  assert.deepStrictEqual(Object.keys(out.systems), ['alpha', 'beta']);
  assert.deepStrictEqual(
    out.systems.alpha.points.map((p) => p.date),
    ['2026-08-03', '2026-08-11', '2026-08-21'],
    'the query orders by recorded_at then id; the projection must not re-sort',
  );
  assert.strictEqual(out.since, '2026-08-03', 'the window is echoed back so the page need not hardcode it');
});

test('movement compares the latest against a week back, and survives floating point', () => {
  // Latest 21 Aug, a week back is 14 Aug, so the baseline is 11 Aug — not 3 Aug.
  const out = rowsToHistory([
    row('alpha', '2026-08-03', 3.4),
    row('alpha', '2026-08-11', 5.0),
    row('alpha', '2026-08-21', 5.2),
  ], { since: '2026-08-03' });

  const m = out.systems.alpha.movement;
  assert.strictEqual(m.from, '2026-08-11', 'the baseline is a week back, not the oldest reading');
  assert.strictEqual(m.from_score, 5.0);
  assert.strictEqual(m.to_score, 5.2, 'the last reading, not the highest');
  assert.strictEqual(m.days, 10);
  assert.strictEqual(m.readings, 3);
  // 3.6 - 3.4 is 0.19999999999999996 in binary floating point. A board that
  // prints that has lost the reader, so the delta is rounded to the precision
  // scores are published at.
  assert.strictEqual(m.delta, 0.2);
});

test('a single reading is a position, not a movement', () => {
  // The honest-answer case. Rendering one reading as "+0.0" tells a reader the
  // system held steady, when the truth is we have measured it once. Every
  // system looks like this on the day it is onboarded.
  const out = rowsToHistory([row('alpha', '2026-08-21', 3.4)], { since: '2026-08-03' });

  assert.strictEqual(out.systems.alpha.movement, null);
  assert.strictEqual(out.systems.alpha.points.length, 1, 'the reading itself is still carried');
});

test('a system with no readings in the window is absent, not empty', () => {
  // Absent reads as "nothing recorded here". An empty list invites a page to
  // draw a flat line at zero, which is a measurement nobody took.
  const out = rowsToHistory([row('alpha', '2026-08-21', 3.4)], { since: '2026-08-03' });

  assert.ok(!('beta' in out.systems));
});

test('movement ignores readings with no score rather than treating them as zero', () => {
  // A null score would arithmetically read as a collapse to 0.0 — the largest
  // possible fake movement, in the direction that looks like a catastrophe.
  const out = rowsToHistory([
    row('alpha', '2026-08-03', 3.4),
    row('alpha', '2026-08-11', null),
    row('alpha', '2026-08-21', 3.6),
  ], { since: '2026-08-03' });

  assert.strictEqual(out.systems.alpha.movement.delta, 0.2);
  assert.strictEqual(out.systems.alpha.movement.readings, 2, 'the unscored reading is not counted');
  assert.strictEqual(out.systems.alpha.points.length, 3, 'but it is still carried in the series');
});

test('one scored reading among unscored ones is still not a movement', () => {
  const out = rowsToHistory([
    row('alpha', '2026-08-03', null),
    row('alpha', '2026-08-21', 3.6),
  ], { since: '2026-08-03' });

  assert.strictEqual(out.systems.alpha.movement, null);
});

test('the fleet query does not read the stored criterion map', async () => {
  // `criteria` is the whole scorecard per reading — ~118kB a generation across
  // the fleet — and a trend line needs none of it. Reading a column to throw it
  // away is the mistake the overview already made once, pulling 2.7MB of
  // findings JSONB and discarding all of it.
  //
  // This asserts the SQL because the cost is invisible to behaviour: selecting
  // the column changes nothing a caller can observe except the bytes moved.
  const sql = [];
  await fetchHistoryRows({ query: async (t) => { sql.push(t); return { rows: [] }; } });
  const q = sql.join('\n');

  assert.ok(/FROM scan_history/i.test(q), 'expected the history table');
  assert.ok(!/\bh\.criteria\b/i.test(q), 'the trend must not pull the stored criterion map');
});

test('the fleet query orders by system and by a tie-broken time', async () => {
  // Same reasoning as the single-system reader: consecutive publishes land
  // 2–4ms apart so a timestamp almost always separates them, and "almost
  // always" is not an ordering. Backfilled boards can share a commit second.
  const sql = [];
  await fetchHistoryRows({ query: async (t) => { sql.push(t); return { rows: [] }; } });
  const q = sql.join('\n');

  assert.ok(/ORDER BY[^;]*system_key/i.test(q), 'expected grouping to be done by the query');
  assert.ok(/ORDER BY[^;]*recorded_at[^;]*h\.id/i.test(q),
    'expected a tie-breaker after recorded_at — a tied ordering is otherwise undefined');
});

test('the fleet reader is one statement, not one per system', async () => {
  // Eleven systems read in a loop is eleven round-trips, and round-trips are
  // what this service actually pays for — the boot seed's 144 sequential
  // statements were the cold-start cost.
  const sql = [];
  await fetchHistoryRows({ query: async (t) => { sql.push(t); return { rows: [] }; } });

  assert.strictEqual(sql.length, 1);
});

test('a baseline far older than a week is still reported, with its real span', () => {
  // No reading a week back, so `days` carries the real span and the card names
  // the date instead of claiming a week.
  const out = rowsToHistory([
    row('alpha', '2026-08-19', 40),
    row('alpha', '2026-09-08', 44),
  ], { since: '2026-08-03' });

  const m = out.systems.alpha.movement;
  assert.strictEqual(m.from, '2026-08-19');
  assert.strictEqual(m.days, 20, 'the real span, not a claim of seven days');
  assert.strictEqual(m.delta, 4);
});

test('when every reading is inside the week, the oldest of them is the baseline', () => {
  // Nothing is a week old, but two readings still compare.
  const out = rowsToHistory([
    row('alpha', '2026-09-08', 40),
    row('alpha', '2026-09-10', 44),
  ], { since: '2026-08-03' });

  const m = out.systems.alpha.movement;
  assert.strictEqual(m.from, '2026-09-08');
  assert.strictEqual(m.days, 2);
});

test('the baseline is the newest reading a week back, not the oldest one', () => {
  // Against the oldest this would report a month of movement as a week.
  const out = rowsToHistory([
    row('alpha', '2026-08-10', 10),
    row('alpha', '2026-08-17', 20),
    row('alpha', '2026-08-24', 30),
    row('alpha', '2026-08-31', 40),
  ], { since: '2026-08-03' });

  const m = out.systems.alpha.movement;
  assert.strictEqual(m.from, '2026-08-24', 'one week back, not three');
  assert.strictEqual(m.delta, 10);
  assert.strictEqual(m.days, 7);
});

test('two readings on the same day are a position, not a movement', () => {
  // The fallback must not compare a reading with itself.
  const out = rowsToHistory([
    row('alpha', '2026-09-10', 44),
    row('alpha', '2026-09-10', 44),
  ], { since: '2026-08-03' });

  assert.ok(out.systems.alpha.movement, 'two distinct readings still compare');
  assert.strictEqual(out.systems.alpha.movement.days, 0);
});
