'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { validateAgentRun } = require('../../db/agent-runs');

// What Oracle publishes after a run: counts and a link, nothing a finding says.
const GOOD = {
  system_key: 'alpha',
  agent: 'oracle',
  run: '2026-11-27-0701',
  finished_at: '2026-11-27T07:24:10.000Z',
  commit: 'be8ce5ed57947809869c70d03d8e92992b14f95a',
  status: 'complete',
  model: 'claude-sonnet-5-5',
  compared: true,
  previous_run: '2026-11-17-0312',
  counts: {
    open: 97, new: 12, refined: 5, still_open: 85, fixed: 3, guarded: 1, broke: 2, merged: 4, current_bugs: 20, security_bugs: 3,
  },
  cost_usd: 19.84,
  run_url: 'https://github.com/some-org/watchtower/tree/oracle-runs/oracle/alpha/2026-11-27-0701',
};

test('a well-formed agent run is accepted', () => {
  assert.deepStrictEqual(validateAgentRun(GOOD), { ok: true });
  assert.deepStrictEqual(validateAgentRun({ ...GOOD, commit: null, previous_run: null, compared: false }), { ok: true });
});

test('only counts are accepted — any field it does not know, such as finding text, is refused', () => {
  const r = validateAgentRun({ ...GOOD, findings: [{ agreement: 'the port is copied' }] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown field: findings/);
  const c = validateAgentRun({ ...GOOD, counts: { ...GOOD.counts, top_finding: 'x' } });
  assert.match(c.reason, /unknown count: top_finding/);
});

test('every count is required and must be a whole number of zero or more', () => {
  const { broke, ...missing } = GOOD.counts;
  assert.match(validateAgentRun({ ...GOOD, counts: missing }).reason, /counts\.broke/);
  const { refined, ...noRefined } = GOOD.counts;
  assert.match(validateAgentRun({ ...GOOD, counts: noRefined }).reason, /counts\.refined/);
  assert.match(validateAgentRun({ ...GOOD, counts: { ...GOOD.counts, fixed: -1 } }).reason, /counts\.fixed/);
  assert.match(validateAgentRun({ ...GOOD, counts: { ...GOOD.counts, fixed: 1.5 } }).reason, /counts\.fixed/);
});

test('the envelope is checked: agent, run name, status, dates, cost and link', () => {
  const bad = (patch, re) => assert.match(validateAgentRun({ ...GOOD, ...patch }).reason, re);
  bad({ agent: 'cleaner' }, /agent/);
  bad({ run: 'yesterday' }, /run/);
  bad({ status: 'great' }, /status/);
  bad({ finished_at: 'soon' }, /finished_at/);
  bad({ commit: 'main' }, /commit/);
  bad({ cost_usd: -2 }, /cost_usd/);
  bad({ run_url: 'http://example.com/x' }, /run_url/);
  bad({ model: '' }, /model/);
  bad({ compared: 'yes' }, /compared/);
  bad({ system_key: '' }, /system_key/);
  assert.match(validateAgentRun([]).reason, /object/);
});
