'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { upsertAll, fetchCurrentReading } = require('../../db/repo');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

test('fetchCurrentReading returns the stored score, colour and criteria, or null for an unknown system', { skip }, async () => {
  const pool = await isolatedPool('current_reading');
  try {
    await upsertAll(pool, {
      systems: [{
        system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
        score: 63, colour: 'amber', hard_capped: false, coverage: '7 of 7 assessed', assessed_at: '2026-10-21',
      }],
      criteria: [
        { system_key: 'alpha', criterion_id: '6', payload: { score: 3.5 }, scanned_at: '2026-10-21' },
        { system_key: 'alpha', criterion_id: '9', payload: { score: 2, critical: true }, scanned_at: '2026-10-21' },
      ],
    });
    assert.deepStrictEqual(await fetchCurrentReading(pool, 'alpha'), {
      score: 63, colour: 'amber', criteria: { 6: { score: 3.5 }, 9: { score: 2, critical: true } },
    });
    assert.strictEqual(await fetchCurrentReading(pool, 'nobody'), null);
  } finally {
    await pool.end();
  }
});
