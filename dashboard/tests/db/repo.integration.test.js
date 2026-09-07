'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { upsertAll, fetchAll } = require('../../db/repo');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

test('upsertAll then fetchAll round-trips rows', { skip }, async () => {
  const pool = await isolatedPool('repo');
  try {

    const rows = {
      systems: [{
        system_key: 'demo', repo: 'org/demo', stack: 'elixir', sast_tool: 'semgrep',
        score: 3.5, colour: 'amber', hard_capped: false, coverage: '1 of 7 assessed', assessed_at: '2026-07-20',
      }],
      criteria: [{ system_key: 'demo', criterion_id: '9', payload: { score: 4.2, colour: 'green' }, scanned_at: '2026-07-20' }],
      findings: [{ system_key: 'demo', criterion_id: '9', payload: { label: 'Secrets', groups: [] }, generated_at: '2026-07-20' }],
    };
    await upsertAll(pool, rows);

    const back = await fetchAll(pool);
    // `example` is read back but never written by upsertAll — it is set only by
    // the optional mock-data migration, and false is what a real system is.
    assert.deepStrictEqual(back.systems, rows.systems.map((s) => ({ ...s, example: false })));
    assert.deepStrictEqual(back.criteria, rows.criteria);
    assert.deepStrictEqual(back.findings, rows.findings);

    // The composite is stored, not derived — a float8 column must come back as a
    // JavaScript number rather than the string NUMERIC would have given us, or
    // the byte-identical parity check would fail on 3.5 vs '3.5'.
    assert.strictEqual(typeof back.systems[0].score, 'number');

    // Upsert is idempotent / updates in place (no duplicate rows).
    await upsertAll(pool, rows);
    const again = await fetchAll(pool);
    assert.strictEqual(again.criteria.length, 1);
  } finally {
    await pool.end();
  }
});
