'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { upsertAll, fetchCurrentReading } = require('../../db/repo');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

test('fetchCurrentReading returns the stored score and colour, or null for an unknown system', { skip }, async () => {
  const pool = await isolatedPool('current_reading');
  try {
    await upsertAll(pool, {
      systems: [{
        system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep',
        score: 63, colour: 'amber', hard_capped: false, coverage: '7 of 7 assessed', assessed_at: '2026-10-21',
      }],
    });
    assert.deepStrictEqual(await fetchCurrentReading(pool, 'alpha'), { score: 63, colour: 'amber' });
    assert.strictEqual(await fetchCurrentReading(pool, 'nobody'), null);
  } finally {
    await pool.end();
  }
});
