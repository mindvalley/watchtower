'use strict';

// The history row must be written INSIDE the transaction that writes the
// scores, not after it commits.
//
// This needs its own check because the integration test cannot see the
// difference. That test forces a failure part-way through the publish, which
// throws before either version would have written history — so it passes just
// as happily when the INSERT sits after COMMIT. It proves "a failed publish
// records nothing", which is worth having, and not "history and scores are
// atomic", which is the property this one pins.
//
// A recording client asserts the statement order instead. Deterministic, and it
// does not need a database.

const { test } = require('node:test');
const assert = require('node:assert');
const { replaceSystem, fetchScanHistory } = require('../../db/repo');

function recordingPool() {
  const sql = [];
  const client = {
    sql,
    query: async (text) => {
      sql.push(String(text).trim());
      // replaceSystem reads the id back from the systems upsert.
      return /RETURNING id/i.test(text) ? { rows: [{ id: 1 }] } : { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { client, connect: async () => client };
}

const CALL = {
  system: {
    system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
    score: 3.4, colour: 'red', hard_capped: true, coverage: '7 of 7 assessed',
    assessed_at: '2026-08-20',
  },
  criteria: [{ criterion_id: '2', payload: { score: 4 }, scanned_at: '2026-08-20' }],
  findings: [{ criterion_id: '2', payload: { groups: [] }, generated_at: '2026-08-20' }],
  publishedBy: 'some-org/watchtower',
};

test('the history row is written before COMMIT', async () => {
  const pool = recordingPool();
  await replaceSystem(pool, CALL);

  const at = (re) => pool.client.sql.findIndex((s) => re.test(s));
  const begin = at(/^BEGIN$/i);
  const history = at(/INSERT INTO scan_history/i);
  const commit = at(/^COMMIT$/i);

  assert.ok(begin >= 0, 'expected a BEGIN');
  assert.ok(history >= 0, 'expected the history row to be written at all');
  assert.ok(commit >= 0, 'expected a COMMIT');
  assert.ok(history > begin && history < commit,
    `history must be written inside the transaction (BEGIN@${begin} history@${history} COMMIT@${commit})`);
});

test('history is read back in a defined order, not an incidental one', async () => {
  // Tied timestamps are possible: consecutive publishes measure 2–4ms apart so
  // they rarely tie, but the backfill sets its own times and two boards can
  // share a commit second. ORDER BY on a tie is unspecified.
  //
  // This asserts the SQL rather than the behaviour, deliberately and after
  // trying the other way. An integration test that inserted three rows on one
  // timestamp could NOT be made to fail: dropping the tie-breaker still
  // returned insertion order, even with the heap deliberately shuffled by an
  // UPDATE first. Postgres happens to agree with us, which makes the ordering
  // correct by luck rather than by instruction, and makes a behavioural test
  // vacuous. This one fails if the tie-break is removed, which is the property
  // actually worth holding.
  const sql = [];
  await fetchScanHistory({ query: async (t) => { sql.push(t); return { rows: [] }; } }, 'alpha');
  const q = sql.join('\n');
  assert.ok(/ORDER BY[^;]*recorded_at/i.test(q), 'expected an explicit time ordering');
  assert.ok(/ORDER BY[^;]*recorded_at[^;]*h\.id/i.test(q),
    'expected a tie-breaker after recorded_at — a tied ordering is otherwise undefined');
});

test('the publish never deletes from scan_history', async () => {
  const pool = recordingPool();
  await replaceSystem(pool, CALL);

  const deletes = pool.client.sql.filter((s) => /^DELETE/i.test(s));
  // It does delete the system's criteria and findings — that is the full
  // replace. History is the one thing it must leave alone.
  assert.ok(deletes.some((s) => /criterion_scores/i.test(s)), 'expected criteria to be replaced');
  assert.ok(deletes.some((s) => /findings/i.test(s)), 'expected findings to be replaced');
  assert.ok(!deletes.some((s) => /scan_history/i.test(s)), 'scan_history must be append-only');
});
