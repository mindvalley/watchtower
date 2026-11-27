'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { upsertAll } = require('../../db/repo');
const { insertAgentRun, fetchAgentRuns, UnknownSystemError } = require('../../db/agent-runs');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;
const SYS = {
  system_key: 'alpha', repo: 'org/alpha', stack: 'ts', sast_tool: 'semgrep',
  score: 50, colour: 'amber', hard_capped: false, coverage: '7 of 7 assessed', assessed_at: '2026-11-23',
};
const RUN = (over = {}) => ({
  system_key: 'alpha', agent: 'oracle', run: '2026-11-27-0701', finished_at: '2026-11-27T07:24:10.000Z',
  commit: 'be8ce5ed57947809869c70d03d8e92992b14f95a', status: 'complete', model: 'claude-sonnet-5-5',
  compared: true, previous_run: '2026-11-17-0312',
  counts: { open: 97, new: 12, still_open: 85, fixed: 3, guarded: 1, broke: 2, merged: 4, current_bugs: 20, security_bugs: 3 },
  cost_usd: 19.84, run_url: 'https://github.com/org/watchtower/tree/oracle-runs/oracle/alpha/2026-11-27-0701',
  published_by: 'org/watchtower', ...over,
});

async function fresh() {
  const pool = await isolatedPool('agent_runs');
  await pool.query('TRUNCATE agent_runs, systems RESTART IDENTITY CASCADE');
  await upsertAll(pool, { systems: [SYS], criteria: [], findings: [] });
  return pool;
}

test('an agent run is stored and read back as published', { skip }, async () => {
  const pool = await fresh();
  try {
    await insertAgentRun(pool, RUN());
    const { runs } = await fetchAgentRuns(pool);
    assert.strictEqual(runs.length, 1);
    const [r] = runs;
    assert.strictEqual(r.system_key, 'alpha');
    assert.strictEqual(r.run, '2026-11-27-0701');
    assert.strictEqual(r.finished_at, '2026-11-27T07:24:10.000Z');
    assert.deepStrictEqual(r.counts, RUN().counts);
    assert.strictEqual(r.cost_usd, 19.84);
    assert.strictEqual(r.published_by, 'org/watchtower');
    assert.strictEqual(r.compared, true);
    assert.strictEqual(r.previous_run, '2026-11-17-0312');
  } finally { await pool.end(); }
});

test('publishing the same run again replaces it rather than counting it twice', { skip }, async () => {
  const pool = await fresh();
  try {
    await insertAgentRun(pool, RUN());
    await insertAgentRun(pool, RUN({ status: 'failed', counts: { ...RUN().counts, open: 90 } }));
    const { runs } = await fetchAgentRuns(pool);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].status, 'failed');
    assert.strictEqual(runs[0].counts.open, 90);
  } finally { await pool.end(); }
});

test('runs come back oldest first within each system, for trend lines', { skip }, async () => {
  const pool = await fresh();
  try {
    await insertAgentRun(pool, RUN({ run: '2026-12-04-0617', finished_at: '2026-12-04T06:40:00.000Z' }));
    await insertAgentRun(pool, RUN());
    const { runs } = await fetchAgentRuns(pool);
    assert.deepStrictEqual(runs.map((r) => r.run), ['2026-11-27-0701', '2026-12-04-0617']);
  } finally { await pool.end(); }
});

test('a run for a system that is not on the board is refused, not stored', { skip }, async () => {
  const pool = await fresh();
  try {
    await assert.rejects(insertAgentRun(pool, RUN({ system_key: 'nobody' })), UnknownSystemError);
    assert.strictEqual((await fetchAgentRuns(pool)).runs.length, 0);
  } finally { await pool.end(); }
});

test('a score publish (full replace of the system) never deletes its agent runs', { skip }, async () => {
  const pool = await fresh();
  try {
    await insertAgentRun(pool, RUN());
    const { replaceSystem } = require('../../db/repo');
    await replaceSystem(pool, { system: { ...SYS, generated_at: '2026-11-30', scanned_at: '2026-11-30' }, criteria: [], findings: [] });
    assert.strictEqual((await fetchAgentRuns(pool)).runs.length, 1);
  } finally { await pool.end(); }
});
