const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAgentRunPayload, postAgentRun } = require('../../agents/oracle/publish');

function runFolder({ run, changes, name = '2026-11-27-0701' }) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pub-')), name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  if (changes) fs.writeFileSync(path.join(dir, 'changes.json'), JSON.stringify(changes));
  return dir;
}
const RUN = {
  agent: 'oracle', system: 'alpha', status: 'complete', commit: 'be8ce5ed57947809869c70d03d8e92992b14f95a',
  finished_at: '2026-11-27T07:24:10.123Z', model: 'claude-sonnet-5-5',
  counts: { raw_findings: 120, findings: 97, confirmed: 39, rejected: 1, current_bugs: 20, security_bugs: 3 },
  changes: { new: 12, still_open: 85, merged: 4, fixed: 3, guarded: 1, broke: 2, open: 97 },
  cost: { usd: 19.8412, calls: 300 },
};
const CHANGES = { compared: true, previous: { run: '2026-11-17-0312', commit: 'aaa' }, counts: RUN.changes };
const BASE = 'https://github.com/org/watchtower/tree/oracle-runs/oracle';

test('the payload is the run\'s counts and a link, nothing a finding says', () => {
  const p = buildAgentRunPayload({ runDir: runFolder({ run: RUN, changes: CHANGES }), systemKey: 'alpha', runUrlBase: BASE });
  assert.deepStrictEqual(p, {
    system_key: 'alpha', agent: 'oracle', run: '2026-11-27-0701', finished_at: '2026-11-27T07:24:10.123Z',
    commit: RUN.commit, status: 'complete', model: 'claude-sonnet-5-5', compared: true, previous_run: '2026-11-17-0312',
    counts: { open: 97, new: 12, still_open: 85, fixed: 3, guarded: 1, broke: 2, merged: 4, current_bugs: 20, security_bugs: 3 },
    cost_usd: 19.84, run_url: `${BASE}/alpha/2026-11-27-0701`,
  });
});

test('the dashboard accepts what Oracle publishes — the two sides cannot drift apart', () => {
  const { validateAgentRun } = require('../../dashboard/db/agent-runs');
  const first = { ...CHANGES, compared: true, previous: null, counts: { ...RUN.changes, still_open: 0, new: 97 } };
  for (const changes of [CHANGES, first]) {
    const p = buildAgentRunPayload({ runDir: runFolder({ run: RUN, changes }), systemKey: 'alpha', runUrlBase: BASE });
    assert.deepStrictEqual(validateAgentRun(p), { ok: true });
  }
});

test('a first run (nothing to compare with) is published as not compared', () => {
  const p = buildAgentRunPayload({ runDir: runFolder({ run: RUN, changes: { ...CHANGES, previous: null } }), systemKey: 'alpha', runUrlBase: BASE });
  assert.equal(p.compared, false);
  assert.equal(p.previous_run, null);
});

test('a run that crashed before it had findings is not published', () => {
  const crashed = { agent: 'oracle', system: 'alpha', status: 'failed', error: 'boom', cost: { usd: 3 } };
  assert.equal(buildAgentRunPayload({ runDir: runFolder({ run: crashed }), systemKey: 'alpha', runUrlBase: BASE }), null);
});

test('posting sends both tokens to /ingest/agent-run and reports a refusal with its reason', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return { status: 200, text: async () => '{}' }; };
  await postAgentRun({ url: 'https://board', iapToken: 'iap', ingestToken: 'oidc', payload: { a: 1 }, fetchImpl });
  assert.equal(sent[0].url, 'https://board/ingest/agent-run');
  assert.equal(sent[0].init.headers.Authorization, 'Bearer iap');
  assert.equal(sent[0].init.headers['X-Benchmark-Ingest-Token'], 'oidc');
  const refuse = async () => ({ status: 400, text: async () => '{"reason":"unknown field"}' });
  await assert.rejects(postAgentRun({ url: 'https://board', iapToken: 'i', ingestToken: 'o', payload: {}, fetchImpl: refuse }), /HTTP 400.*unknown field/);
});
