'use strict';

// Scan history — the record of what each system scored every time it was
// measured. Until this existed the database held one generation and nothing
// else: /ingest full-replaces, so a score that moved left no trace of where it
// moved from, and the board could say where a system stands but never whether
// anything was getting better.
//
// Every check here was verified against a deliberately planted violation before
// being committed — the guard was made to fail first, then the code fixed.
//
// NOTE: like the other files in this directory, these tests TRUNCATE the one
// shared database, and `node --test` runs files concurrently. That is the known
// race in tracker #68 and this file joins it rather than fixing it; run the db
// tests with --test-concurrency=1 locally.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  upsertAll, replaceSystem, fetchScanHistory, fetchHistoryRows, backfillScanHistory,
} = require('../../db/repo');
const { rowsToHistory } = require('../../db/model');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

const SYS = (over = {}) => ({
  system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
  score: 2.0, colour: 'red', hard_capped: true, coverage: '2 of 7 assessed',
  assessed_at: '2026-08-20', ...over,
});

async function fresh() {
  const pool = await isolatedPool('scan_history');
  return pool;
}

test('a publish appends one history row carrying the scores and the publisher', { skip }, async () => {
  const pool = await fresh();
  try {
    await replaceSystem(pool, {
      system: SYS(),
      publishedBy: 'some-org/watchtower',
      criteria: [
        { criterion_id: '2', payload: { score: 4, sub: { described: 10 } }, scanned_at: '2026-08-20' },
        { criterion_id: '8', payload: { score: 1.2 }, scanned_at: '2026-08-20' },
      ],
      findings: [{ criterion_id: '8', payload: { groups: ['x'] }, generated_at: '2026-08-20' }],
    });

    const hist = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(hist.length, 1);
    const h = hist[0];
    assert.strictEqual(h.scanned_at, '2026-08-20');
    assert.strictEqual(h.score, 2.0);
    assert.strictEqual(h.colour, 'red');
    assert.strictEqual(h.hard_capped, true);
    assert.strictEqual(h.coverage, '2 of 7 assessed');
    // From the verified claim, not the payload — an identity, not a label.
    assert.strictEqual(h.published_by, 'some-org/watchtower');

    // The whole criterion payload is kept, not just the number — that is what
    // makes a past scorecard reconstructable rather than merely plottable.
    assert.deepStrictEqual(Object.keys(h.criteria).sort(), ['2', '8']);
    assert.strictEqual(h.criteria['2'].score, 4);
    assert.deepStrictEqual(h.criteria['2'].sub, { described: 10 });
    assert.strictEqual(h.criteria['8'].score, 1.2);

    // Findings are deliberately not carried — a different question, and 3x the size.
    assert.ok(!('findings' in h), 'history must not carry findings payloads');
  } finally {
    await pool.end();
  }
});

test('history accumulates and survives the full replace that drops criteria', { skip }, async () => {
  const pool = await fresh();
  try {
    await replaceSystem(pool, {
      system: SYS({ score: 2.0, assessed_at: '2026-08-01' }),
      publishedBy: 'some-org/watchtower',
      criteria: [
        { criterion_id: '2', payload: { score: 2 }, scanned_at: '2026-08-01' },
        { criterion_id: '8', payload: { score: 2 }, scanned_at: '2026-08-01' },
      ],
      findings: [],
    });
    // Second publish drops criterion 8 entirely — replaceSystem DELETEs the
    // system's criteria before inserting. History must not be caught by that.
    await replaceSystem(pool, {
      system: SYS({ score: 4.5, colour: 'green', assessed_at: '2026-08-20' }),
      publishedBy: 'other-org/watchtower',
      criteria: [{ criterion_id: '2', payload: { score: 4.5 }, scanned_at: '2026-08-20' }],
      findings: [],
    });

    const hist = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(hist.length, 2, 'both publishes must be recorded');
    // Oldest first.
    assert.strictEqual(hist[0].scanned_at, '2026-08-01');
    assert.strictEqual(hist[1].scanned_at, '2026-08-20');
    assert.strictEqual(hist[0].score, 2.0);
    assert.strictEqual(hist[1].score, 4.5);
    // The dropped criterion is gone from the board and still in the record.
    assert.deepStrictEqual(Object.keys(hist[0].criteria).sort(), ['2', '8']);
    assert.deepStrictEqual(Object.keys(hist[1].criteria), ['2']);
    // Recorded per publish, so a system moving between watchtowers is visible.
    assert.strictEqual(hist[0].published_by, 'some-org/watchtower');
    assert.strictEqual(hist[1].published_by, 'other-org/watchtower');
  } finally {
    await pool.end();
  }
});

test('two scans on the same day are recorded separately', { skip }, async () => {
  const pool = await fresh();
  try {
    // The reason recorded_at is a timestamp and not the scan's own DATE.
    // Several scans in one day is routine — three on 5 August, several on the
    // 19th — and keyed on a date they would collapse into one, losing exactly
    // the runs that matter while work is in flight.
    for (const score of [2.0, 3.0, 4.0]) {
      await replaceSystem(pool, {
        system: SYS({ score, assessed_at: '2026-08-20' }),
        criteria: [{ criterion_id: '2', payload: { score }, scanned_at: '2026-08-20' }],
        findings: [],
      });
    }
    const hist = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(hist.length, 3, 'same-day scans must not overwrite each other');
    assert.deepStrictEqual(hist.map((h) => h.score), [2.0, 3.0, 4.0]);
    assert.strictEqual(new Set(hist.map((h) => h.recorded_at.getTime())).size, 3,
      'each scan needs a distinct recorded_at or they cannot be ordered');
  } finally {
    await pool.end();
  }
});


// The boot seed used to run on every container boot — measured at 29 in one
// hour — restoring committed files, and the load-bearing rule of this feature
// was that it must never write here. It was deleted on 2026-09-03, along with
// the two tests that pinned that rule, because a rule about a thing that does
// not exist is not a rule. The append-only property is still held from the
// other side: replaceSystem must not delete from scan_history, which
// scan-history-order.test.js and the publish tests below assert.

test('a failed publish records no history and leaves the board unchanged', { skip }, async () => {
  const pool = await fresh();
  try {
    await replaceSystem(pool, {
      system: SYS({ score: 3.0, assessed_at: '2026-08-01' }),
      criteria: [{ criterion_id: '2', payload: { score: 3 }, scanned_at: '2026-08-01' }],
      findings: [],
    });

    // A findings row with no payload violates NOT NULL, part-way through the
    // transaction. History is written last, so this proves the rollback rather
    // than the ordering: a publish that dies half way must not leave an entry
    // claiming it happened.
    await assert.rejects(() => replaceSystem(pool, {
      system: SYS({ score: 9.9, assessed_at: '2026-08-20' }),
      criteria: [{ criterion_id: '2', payload: { score: 1 }, scanned_at: '2026-08-20' }],
      findings: [{ criterion_id: '2', payload: undefined, generated_at: '2026-08-20' }],
    }));

    const hist = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(hist.length, 1, 'the failed publish must not appear in history');
    assert.strictEqual(hist[0].score, 3.0);

    const { rows } = await pool.query("SELECT score FROM systems WHERE system_key = 'alpha'");
    assert.strictEqual(rows[0].score, 3.0, 'the failed publish must not have moved the board');
  } finally {
    await pool.end();
  }
});

test('backfill carries its own recorded_at and refuses an unknown system', { skip }, async () => {
  const pool = await fresh();
  try {
    await upsertAll(pool, {
      systems: [SYS({ score: 4.0, colour: 'green', assessed_at: '2026-08-20' })],
      criteria: [], findings: [],
    });

    await backfillScanHistory(pool, [
      { system_key: 'alpha', recorded_at: '2026-06-08T10:00:00Z', scanned_at: '2026-06-08',
        score: 1.0, colour: 'red', hard_capped: false, coverage: '1 of 7 assessed',
        criteria: { 8: { score: 1 } }, published_by: null },
      { system_key: 'alpha', recorded_at: '2026-07-01T10:00:00Z', scanned_at: '2026-07-01',
        score: 3.0, colour: 'amber', hard_capped: false, coverage: '4 of 7 assessed',
        criteria: { 8: { score: 3 } }, published_by: null },
    ]);

    const hist = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(hist.length, 2);
    // Ordered by the backfilled time, not by insertion order or now().
    assert.deepStrictEqual(hist.map((h) => h.scanned_at), ['2026-06-08', '2026-07-01']);
    assert.ok(hist[0].recorded_at < hist[1].recorded_at);
    assert.ok(hist[0].recorded_at < new Date('2026-08-01T00:00:00Z'),
      'backfilled rows must keep their real time, not now()');
    // Null, and honestly so: nobody published these — they were assembled here
    // before the organisations scanned for themselves.
    assert.strictEqual(hist[0].published_by, null);

    // A key that matches no system would silently vanish from an INSERT..SELECT.
    await assert.rejects(
      () => backfillScanHistory(pool, [{
        system_key: 'does-not-exist', recorded_at: '2026-06-08T10:00:00Z', scanned_at: '2026-06-08',
        score: 1, colour: 'red', hard_capped: false, coverage: 'x', criteria: {},
      }]),
      /no system row/,
    );
  } finally {
    await pool.end();
  }
});

test('the start date hides early noise without deleting it', { skip }, async () => {
  const pool = await fresh();
  try {
    await upsertAll(pool, { systems: [SYS()], criteria: [], findings: [] });
    // Spanning the default cutoff of 2026-08-03. The July entries are the ones
    // that mislead — a benchmark still growing its criteria and correcting its
    // scanner — and they are noise in a chart, not wrong data.
    await backfillScanHistory(pool, [
      ['2026-07-01', 5.0], ['2026-07-30', 2.7], ['2026-08-03', 2.6], ['2026-08-11', 2.6],
    ].map(([d, score]) => ({
      system_key: 'alpha', recorded_at: `${d}T10:00:00Z`, scanned_at: d,
      score, colour: 'red', hard_capped: false, coverage: '7 of 7 assessed', criteria: {},
    })));

    const shown = await fetchScanHistory(pool, 'alpha');
    assert.deepStrictEqual(shown.map((h) => h.scanned_at), ['2026-08-03', '2026-08-11'],
      'the default view starts where the measurements became comparable');

    // Nothing was thrown away — the same rows are still there to be asked for.
    const all = await fetchScanHistory(pool, 'alpha', { since: null });
    assert.strictEqual(all.length, 4, 'the cutoff must hide, not delete');
    assert.strictEqual(all[0].scanned_at, '2026-07-01');

    // And the boundary is inclusive, so the first comparable scan is not lost.
    const from = await fetchScanHistory(pool, 'alpha', { since: '2026-08-11' });
    assert.deepStrictEqual(from.map((h) => h.scanned_at), ['2026-08-11']);
  } finally {
    await pool.end();
  }
});

test('the fleet reader returns every system in one statement, oldest first', { skip }, async () => {
  // The unit tests for this query assert its TEXT — that it orders by a
  // tie-breaker and does not pull the criterion map. Text is not a database:
  // a wrong column name or a bad cast passes every one of them and fails on
  // the first real request. This runs it.
  const pool = await fresh();
  try {
    await upsertAll(pool, {
      systems: [
        { system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep' },
        { system_key: 'beta', repo: 'other/beta', stack: 'ts', sast_tool: 'semgrep' },
      ],
      criteria: [],
      findings: [],
    });

    await backfillScanHistory(pool, [
      ['alpha', '2026-08-03', 3.4], ['alpha', '2026-08-11', 3.5], ['alpha', '2026-08-21', 3.6],
      ['beta', '2026-08-03', 2.0], ['beta', '2026-08-21', 1.8],
      // Before the window — must be excluded by the default `since`.
      ['alpha', '2026-07-01', 5.0],
    ].map(([system_key, d, score]) => ({
      system_key, recorded_at: `${d}T10:00:00Z`, scanned_at: d,
      score, colour: 'red', hard_capped: false, coverage: '7 of 7 assessed', criteria: { 8: { score } },
    })));

    const rows = await fetchHistoryRows(pool);

    // The projection is exercised on real rows rather than on hand-built ones,
    // because the shape the database returns is the thing that has to line up:
    // `score` comes back through node-postgres, and a NUMERIC column would
    // arrive as a string and quietly make every delta NaN.
    const out = rowsToHistory(rows, { since: '2026-08-03' });

    assert.deepStrictEqual(Object.keys(out.systems).sort(), ['alpha', 'beta']);
    assert.deepStrictEqual(out.systems.alpha.points.map((p) => p.date),
      ['2026-08-03', '2026-08-11', '2026-08-21'], 'oldest first, and July excluded by the window');
    // 0.1, not 0.2: the baseline is the newest reading a week before the latest,
    // so alpha compares 21 Aug against 11 Aug and not against 3 Aug. Beta has
    // nothing inside that week, so it falls back to 3 Aug and spans 18 days.
    assert.strictEqual(out.systems.alpha.movement.delta, 0.1);
    assert.strictEqual(out.systems.alpha.movement.from, '2026-08-11');
    assert.strictEqual(out.systems.beta.movement.delta, -0.2, 'a decline reads as a decline');
    assert.strictEqual(out.systems.beta.movement.days, 18);
    assert.strictEqual(typeof out.systems.alpha.movement.to_score, 'number',
      'a score arriving as a string would make every delta NaN');

    // The whole point of the lean SELECT: the criterion map is stored and is
    // not carried here.
    assert.ok(!('criteria' in rows[0]), 'the trend must not drag the stored scorecard along');
  } finally {
    await pool.end();
  }
});
