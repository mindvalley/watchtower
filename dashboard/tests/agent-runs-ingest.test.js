'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../server');
const { UnknownSystemError } = require('../db/agent-runs');

const REPO = 'some-org/watchtower';
const okVerifier = { verify: async () => ({ repository: REPO }) };
const badVerifier = { verify: async () => { throw new Error('bad token'); } };
const allowlist = { resolve: (r, s) => (r === REPO && s === 'alpha' ? { system_key: 'alpha', repo: REPO } : null) };
const BODY = {
  system_key: 'alpha', agent: 'oracle', run: '2026-11-27-0701', finished_at: '2026-11-27T07:24:10.000Z',
  commit: null, status: 'complete', model: 'claude-sonnet-5-5', compared: false, previous_run: null,
  counts: { open: 5, new: 5, still_open: 0, fixed: 0, guarded: 0, broke: 0, merged: 0, current_bugs: 1, security_bugs: 0 },
  cost_usd: 18.5, run_url: 'https://github.com/some-org/watchtower/tree/oracle-runs/oracle/alpha/2026-11-27-0701',
};

function appWith(overrides = {}) {
  const runs = [];
  const app = createApp({
    quiet: true,
    provider: {
      getBenchmark: async () => ({}), getFindings: async () => ({}),
      getAgentRuns: async () => ({ runs: [{ system_key: 'alpha', agent: 'oracle', run: '2026-11-27-0701' }] }),
    },
    verifier: overrides.verifier || okVerifier,
    allowlist,
    write: async () => {},
    writeAgentRun: overrides.writeAgentRun || (async (row) => { runs.push(row); }),
  });
  return { app, runs };
}

const post = (app, body = BODY, token = 't') => {
  const r = request(app).post('/ingest/agent-run');
  return (token ? r.set('X-Benchmark-Ingest-Token', token) : r).send(body);
};

test('an agent run from an allowed repository is stored, with who published it from the verified claim', async () => {
  const { app, runs } = appWith();
  const res = await post(app);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body, { system_key: 'alpha', agent: 'oracle', run: '2026-11-27-0701' });
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].published_by, REPO);
  assert.strictEqual(runs[0].counts.open, 5);
});

test('401 without a valid token', async () => {
  assert.strictEqual((await post(appWith().app, BODY, null)).status, 401);
  assert.strictEqual((await post(appWith({ verifier: badVerifier }).app)).status, 401);
});

test('403 for a system the repository may not write', async () => {
  const res = await post(appWith().app, { ...BODY, system_key: 'beta' });
  assert.strictEqual(res.status, 403);
});

test('400 with the reason for a malformed run, and nothing stored', async () => {
  const { app, runs } = appWith();
  const res = await post(app, { ...BODY, findings: [] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.reason, /unknown field: findings/);
  assert.strictEqual(runs.length, 0);
});

test('409 for a system that is not on the board yet', async () => {
  const { app } = appWith({ writeAgentRun: async () => { throw new UnknownSystemError('alpha'); } });
  assert.strictEqual((await post(app)).status, 409);
});

test('the pages read every agent run from /data/agent-runs.json', async () => {
  const res = await request(appWith().app).get('/data/agent-runs.json');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.runs[0].run, '2026-11-27-0701');
});
