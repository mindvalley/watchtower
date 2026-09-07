'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  upsertAll, fetchAll, fetchBenchmarkRows, fetchFindingsRows,
} = require('../../db/repo');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

// The unit tests for these readers assert on SQL text against a fake pool, which
// cannot catch a query that is well-formed to a regex but wrong to Postgres.
// These run the same SQL against a real database.
const rows = {
  systems: [
    { system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
      score: 4.2, colour: 'green', hard_capped: false, coverage: '1 of 7 assessed', assessed_at: '2026-07-20' },
    { system_key: 'beta', repo: 'org/beta', stack: 'ruby', sast_tool: 'semgrep',
      score: 1.7, colour: 'red', hard_capped: true, coverage: '1 of 7 assessed', assessed_at: '2026-07-21' },
  ],
  criteria: [
    { system_key: 'alpha', criterion_id: '9', payload: { score: 4.2 }, scanned_at: '2026-07-20' },
    { system_key: 'beta', criterion_id: '9', payload: { score: 1.7 }, scanned_at: '2026-07-21' },
  ],
  findings: [
    { system_key: 'alpha', criterion_id: '9', payload: { label: 'Secrets', groups: [] }, generated_at: '2026-07-20' },
    { system_key: 'beta', criterion_id: '9', payload: { label: 'Secrets', groups: [] }, generated_at: '2026-07-21' },
  ],
};

async function seeded() {
  const pool = await isolatedPool('repo_scoped');
  await upsertAll(pool, rows);
  return pool;
}

test('fetchBenchmarkRows returns the same systems and criteria as fetchAll', { skip }, async () => {
  const pool = await seeded();
  try {
    const all = await fetchAll(pool);
    const scoped = await fetchBenchmarkRows(pool);
    // Identical data, strictly less of it — the read is narrower, not different.
    assert.deepStrictEqual(scoped.systems, all.systems);
    assert.deepStrictEqual(scoped.criteria, all.criteria);
    assert.strictEqual(scoped.findings, undefined);
  } finally {
    await pool.end();
  }
});

test('fetchFindingsRows returns exactly one system, matching the fetchAll subset', { skip }, async () => {
  const pool = await seeded();
  try {
    const all = await fetchAll(pool);
    const scoped = await fetchFindingsRows(pool, 'alpha');
    assert.deepStrictEqual(scoped.findings, all.findings.filter((f) => f.system_key === 'alpha'));
    assert.strictEqual(scoped.findings.length, 1);
    assert.strictEqual(scoped.findings[0].system_key, 'alpha');
  } finally {
    await pool.end();
  }
});

test('fetchFindingsRows on an unknown system returns empty, not everything', { skip }, async () => {
  const pool = await seeded();
  try {
    const scoped = await fetchFindingsRows(pool, 'no-such-system');
    assert.deepStrictEqual(scoped.findings, []);
  } finally {
    await pool.end();
  }
});

test('batched upsertAll throws rather than silently dropping an unknown system_key', { skip }, async () => {
  // Child rows join `systems` on the natural key, so an unmatched key would
  // vanish from the batch with no error. The row-count guard must catch it —
  // a quietly-incomplete board is the failure mode this engine must never have.
  const pool = await seeded();
  try {
    await assert.rejects(
      () => upsertAll(pool, {
        systems: [],
        criteria: [{ system_key: 'ghost', criterion_id: '9', payload: {}, scanned_at: '2026-07-20' }],
        findings: [],
      }),
      /expected to write 1 rows, wrote 0/,
    );
    // And the transaction rolled back — the good rows are still intact.
    const after = await fetchBenchmarkRows(pool);
    assert.strictEqual(after.criteria.length, 2);
  } finally {
    await pool.end();
  }
});

test('batched upsertAll is idempotent and updates in place', { skip }, async () => {
  const pool = await seeded();
  try {
    await upsertAll(pool, rows);
    const back = await fetchBenchmarkRows(pool);
    assert.strictEqual(back.systems.length, 2);
    assert.strictEqual(back.criteria.length, 2, 'a second seed must not duplicate rows');
  } finally {
    await pool.end();
  }
});
