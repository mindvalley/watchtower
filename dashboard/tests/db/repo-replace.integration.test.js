'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { upsertAll, replaceSystem, fetchAll } = require('../../db/repo');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

test('replaceSystem overwrites one system and drops its stale criteria', { skip }, async () => {
  const pool = await isolatedPool('repo_replace');
  try {

    // Seed two systems via the existing upsert path.
    await upsertAll(pool, {
      systems: [
        { system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
          score: 2.0, colour: 'red', hard_capped: false, coverage: '2 of 7 assessed', assessed_at: '2026-07-20' },
        { system_key: 'beta', repo: 'org/beta', stack: 'ruby', sast_tool: 'semgrep',
          score: 2.0, colour: 'red', hard_capped: false, coverage: '1 of 7 assessed', assessed_at: '2026-07-20' },
      ],
      criteria: [
        { system_key: 'alpha', criterion_id: '2', payload: { score: 3 }, scanned_at: '2026-07-20' },
        { system_key: 'alpha', criterion_id: '6', payload: { score: 1 }, scanned_at: '2026-07-20' },
        { system_key: 'beta', criterion_id: '2', payload: { score: 2 }, scanned_at: '2026-07-20' },
      ],
      findings: [
        { system_key: 'alpha', criterion_id: '2', payload: { groups: [] }, generated_at: '2026-07-20' },
      ],
    });

    // Re-ingest alpha with ONLY criterion 2 (criterion 6 must disappear).
    await replaceSystem(pool, {
      system: {
        system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
        score: 4.0, colour: 'green', hard_capped: false, coverage: '1 of 7 assessed', assessed_at: '2026-07-22',
      },
      criteria: [{ criterion_id: '2', payload: { score: 4 }, scanned_at: '2026-07-22' }],
      findings: [{ criterion_id: '2', payload: { groups: ['x'] }, generated_at: '2026-07-22' }],
    });

    const back = await fetchAll(pool);
    const alphaCrit = back.criteria.filter((c) => c.system_key === 'alpha');
    const betaCrit = back.criteria.filter((c) => c.system_key === 'beta');

    // alpha now has exactly criterion 2 with the new payload; the stale 6 is gone.
    assert.deepStrictEqual(alphaCrit.map((c) => c.criterion_id), ['2']);
    assert.strictEqual(alphaCrit[0].payload.score, 4);
    assert.strictEqual(alphaCrit[0].scanned_at, '2026-07-22');
    // The composite moves with the criteria it was computed from — this is the
    // ingest write path, and a replace that updated the scores while leaving the
    // old composite behind would show a stale number over fresh measurements.
    const alphaSys = back.systems.find((x) => x.system_key === 'alpha');
    assert.strictEqual(alphaSys.score, 4.0);
    assert.strictEqual(alphaSys.colour, 'green');
    assert.strictEqual(alphaSys.assessed_at, '2026-07-22');

    // beta is untouched.
    assert.deepStrictEqual(betaCrit.map((c) => c.criterion_id), ['2']);
    assert.strictEqual(betaCrit[0].payload.score, 2);
    assert.strictEqual(back.systems.find((x) => x.system_key === 'beta').assessed_at, '2026-07-20');

    // findings replaced too.
    const alphaFind = back.findings.filter((f) => f.system_key === 'alpha');
    assert.deepStrictEqual(alphaFind.map((f) => f.criterion_id), ['2']);
    assert.deepStrictEqual(alphaFind[0].payload.groups, ['x']);

    // Idempotent: replaying the same replace yields the same single row.
    await replaceSystem(pool, {
      system: {
        system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
        score: 4.0, colour: 'green', hard_capped: false, coverage: '1 of 7 assessed', assessed_at: '2026-07-22',
      },
      criteria: [{ criterion_id: '2', payload: { score: 4 }, scanned_at: '2026-07-22' }],
      findings: [{ criterion_id: '2', payload: { groups: ['x'] }, generated_at: '2026-07-22' }],
    });
    const again = await fetchAll(pool);
    assert.strictEqual(again.criteria.filter((c) => c.system_key === 'alpha').length, 1);
  } finally {
    await pool.end();
  }
});
