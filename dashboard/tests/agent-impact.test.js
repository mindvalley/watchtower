'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const AI = require('../public/js/agent-impact');

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const C = (over = {}) => ({ open: 0, new: 0, still_open: 0, fixed: 0, guarded: 0, broke: 0, merged: 0, current_bugs: 0, security_bugs: 0, ...over });
const R = (system_key, run, counts, over = {}) => ({
  system_key, agent: 'oracle', run, finished_at: `${run.slice(0, 10)}T07:00:00.000Z`, status: 'complete', model: 'claude-sonnet-5-5',
  compared: true, previous_run: null, counts: C(counts), cost_usd: 20, run_url: `https://github.com/org/watchtower/tree/oracle-runs/oracle/${system_key}/${run}`,
  ...over,
});
const RUNS = [
  R('alpha', '2026-11-17-0312', { open: 91, new: 91 }, { compared: false }),
  R('alpha', '2026-11-24-0617', { open: 97, new: 12, still_open: 85, fixed: 3, guarded: 1, broke: 2 }, { previous_run: '2026-11-17-0312' }),
  R('beta', '2026-11-24-0640', { open: 40, new: 40, security_bugs: 2 }, { compared: false }),
  { ...R('gamma', '2026-11-24-0700', { open: 5 }), agent: 'cleaner' },
];

test('a system\'s panel is its latest Oracle run, with the open count over time', () => {
  const p = AI.systemPanel(RUNS, 'alpha');
  assert.equal(p.latest.run, '2026-11-24-0617');
  assert.deepEqual(p.trend.map((t) => t.open), [91, 97]);
  assert.equal(AI.systemPanel(RUNS, 'nobody'), null, 'no runs: no panel');
});

test('the fleet summary adds up the latest run of each system, and what changed within the window', () => {
  const s = AI.fleetSummary(RUNS, ['alpha', 'beta', 'gamma'], { now: '2026-11-27T00:00:00Z', days: 28 });
  assert.equal(s.systems, 2, 'gamma has no Oracle run');
  assert.equal(s.open, 97 + 40);
  assert.equal(s.closed, 3 + 1);
  assert.equal(s.broke, 2);
  assert.equal(s.newFindings, 91 + 12 + 40);
  const later = AI.fleetSummary(RUNS, ['alpha', 'beta'], { now: '2027-02-01T00:00:00Z', days: 28 });
  assert.equal(later.closed, 0, 'outside the window, nothing closed');
  assert.equal(later.open, 137, 'open is always the latest');
  assert.equal(AI.fleetSummary(RUNS, ['gamma'], { now: '2026-11-27T00:00:00Z' }), null);
});

test('the system panel claims no more than the data shows: closed since found, broke as predicted, and a link', () => {
  const html = AI.systemPanelHtml(AI.systemPanel(RUNS, 'alpha'), esc);
  assert.match(html, /97<\/[a-z]+>[^<]*<[^>]*>[^<]*hidden agreements open/);
  assert.match(html, /fixed or guarded since Oracle found them/);
  assert.match(html, /broke as Oracle predicted/);
  assert.match(html, /href="https:\/\/github\.com\/org\/watchtower\/tree\/oracle-runs\/oracle\/alpha\/2026-11-24-0617"/);
  assert.doesNotMatch(html, /fixed by Oracle/i);
});

test('a first run says so instead of showing changes it could not measure', () => {
  const html = AI.systemPanelHtml(AI.systemPanel(RUNS, 'beta'), esc);
  assert.match(html, /First run/);
  assert.doesNotMatch(html, /since Oracle found them/);
});

test('the fleet summary renders the totals in the approved words', () => {
  const html = AI.fleetSummaryHtml(AI.fleetSummary(RUNS, ['alpha', 'beta'], { now: '2026-11-27T00:00:00Z', days: 28 }), esc);
  assert.match(html, /137/);
  assert.match(html, /fixed or guarded since Oracle found them/);
  assert.match(html, /broke as Oracle predicted/);
  assert.match(html, /last 28 days/);
});

test('text from the data is escaped', () => {
  const p = AI.systemPanel([R('alpha', '2026-11-24-0617', { open: 1 }, { run_url: 'https://github.com/x/"><script>' })], 'alpha');
  assert.doesNotMatch(AI.systemPanelHtml(p, esc), /<script>/);
});
