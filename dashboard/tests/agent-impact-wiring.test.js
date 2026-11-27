'use strict';
// The Oracle panel and fleet summary are rendered inside the pages, where no
// unit test reaches; these check the wiring. The logic is in agent-impact.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');

test('the system page loads the module, has a hidden Oracle section, and renders it from /data/agent-runs.json', () => {
  const html = read('system/scorecard.html');
  assert.match(html, /<script src="\/js\/agent-impact\.js"><\/script>/);
  assert.match(html, /id="oracle-section"[^>]*style="display:none"/);
  const js = read('system/scorecard.js');
  assert.match(js, /\/data\/agent-runs\.json/);
  assert.match(js, /const panel = AgentImpact\.systemPanel\(feed && feed\.runs, systemKey\)/);
  assert.match(js, /AgentImpact\.systemPanelHtml\(panel, escHtml\)/);
});

test('a missing or failing agent-runs feed never stops the scorecard', () => {
  const js = read('system/scorecard.js');
  assert.match(js, /agent-runs\.json'\)\.then\(\(r\) => \(r\.ok \? r\.json\(\) : null\)\)\.catch\(\(\) => null\)/);
});

test('the overview loads the module and renders each organisation\'s Oracle summary after its trends', () => {
  const html = read('index.html');
  assert.match(html, /<script src="\/js\/agent-impact\.js"><\/script>/);
  assert.match(html, /optionalJson\('\/data\/agent-runs\.json'\)/);
  assert.match(html, /\$\{trendSection\(org, keys, benchmark, history\)\}\s*\$\{agentSection\(keys\)\}/);
  assert.match(html, /const summary = AgentImpact\.fleetSummary\(AGENT_RUNS, keys\)/);
  assert.match(html, /AgentImpact\.fleetSummaryHtml\(summary, esc\)/);
});
