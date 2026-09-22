'use strict';

// Sample data behind the Issues chart (the composite chart is live — see
// composite-trend.test.js). Holds that it is deterministic, internally
// consistent, derived from the real fleet, and marked/deletable.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  sampleFor, WINDOWS, datesEndingAt, issuesSeries,
} = require('../public/js/sample-trends.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const overview = () => fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const sampleSrc = () => fs.readFileSync(path.join(PUBLIC, 'js', 'sample-trends.js'), 'utf8');

const FLEET = [
  { key: 'alpha', score: 28 },
  { key: 'bravo', score: 66 },
  { key: 'charlie', score: null },
];

test('the same inputs always produce the same chart', () => {
  // A mock that reshuffles on reload cannot be reviewed, and two people looking
  // at it are looking at different pictures.
  const a = sampleFor(FLEET, 'month', '2026-08-11');
  const b = sampleFor(FLEET, 'month', '2026-08-11');
  assert.deepStrictEqual(a, b);
});

test('nothing in the sample is random', () => {
  // Determinism has to hold across processes, not just within one, so the
  // absence of a random source is asserted directly rather than inferred from
  // two calls agreeing.
  assert.ok(!/Math\.random|Date\.now|new Date\(\)/.test(sampleSrc()),
    'the sample must not draw on anything that varies between loads');
});

test('the sample no longer produces a composite series — that chart is live', () => {
  const s = sampleFor(FLEET, 'month', '2026-08-11');
  assert.strictEqual(s.composite, undefined, 'the sample must not carry a composite series');
});

test('the issues series reconciles: every total is the last one plus new minus resolved', () => {
  // The failure this prevents was found on a real chart: a scan showing more
  // issues introduced than were open. Totals are ACCUMULATED from the parts
  // here, never invented separately, so the arithmetic cannot come apart.
  const rows = issuesSeries('seed', 5, datesEndingAt('2026-08-11', WINDOWS.quarter));
  for (let i = 1; i < rows.length; i += 1) {
    assert.strictEqual(
      rows[i].total, rows[i - 1].total + rows[i].introduced - rows[i].resolved,
      `row ${i} (${rows[i].date}) does not reconcile`,
    );
  }
});

test('introductions never exceed the open total, which is not a thing that can happen', () => {
  for (const count of [1, 3, 5, 11]) {
    for (const rows of [issuesSeries(`s${count}`, count, datesEndingAt('2026-08-11', WINDOWS.quarter))]) {
      for (const r of rows) {
        assert.ok(r.introduced <= r.total, `${r.date}: ${r.introduced} introduced against ${r.total} open`);
        assert.ok(r.total > 0 && r.introduced >= 0 && r.resolved >= 0);
      }
    }
  }
});

test('new issues are a large enough share of the total to be visible', () => {
  // Not a cosmetic check. The first version used flat counts against totals
  // near 900 — about 3% — and at that ratio the red band is a two-pixel sliver
  // and the New line draws directly on top of the Total line. A mock whose only
  // job is to show whether the chart works has to be legible.
  const rows = issuesSeries('seed', 5, datesEndingAt('2026-08-11', WINDOWS.month));
  for (const r of rows) {
    const share = r.introduced / r.total;
    assert.ok(share >= 0.04, `${r.date}: new is ${(share * 100).toFixed(1)}% of total — invisible on the chart`);
  }
});

test('windows differ in length and all end on the given date', () => {
  const end = '2026-08-11';
  const lengths = {};
  for (const w of Object.keys(WINDOWS)) {
    const s = sampleFor(FLEET, w, end);
    assert.strictEqual(s.dates[s.dates.length - 1], end, `${w} does not end on the latest reading`);
    assert.ok(s.dates.every((d, i) => i === 0 || d > s.dates[i - 1]), `${w} dates are not ascending`);
    lengths[w] = Date.parse(end) - Date.parse(s.dates[0]);
  }
  assert.ok(lengths.week < lengths.month && lengths.month < lengths.quarter,
    'the three windows must actually cover different spans');
});

test('an unknown window falls back rather than rendering nothing', () => {
  const s = sampleFor(FLEET, 'decade', '2026-08-11');
  assert.ok(s.dates.length > 0);
});

// --- how the page uses it ----------------------------------------------------

test('the Issues chart is marked as sample data', () => {
  const s = overview();
  assert.match(s, /class="wt-sample"/, 'the sample badge must be rendered');
  assert.match(s, /Sample data/, 'the badge must say so in words, not by colour alone');
  assert.match(s, /wt-sample-note/);
  // The live composite chart must not wear the sample marker.
  const compTitle = s.slice(s.indexOf('Composite score'), s.indexOf('Composite score') + 60);
  assert.ok(!compTitle.includes('wt-sample'), 'the live composite chart must not be marked sample');
});

test('the invented numbers reach the Issues chart and nothing else', () => {
  const s = overview();
  const uses = (s.match(/SampleTrends\.\w+/g) || []);
  assert.deepStrictEqual([...new Set(uses)].sort(), ['SampleTrends.sampleFor'],
    'SampleTrends must only be read for the Issues series');
  assert.strictEqual((s.match(/SampleTrends\.sampleFor\(/g) || []).length, 1,
    'the sample must be built in exactly one place — the trends section');
  // Neither the card path nor the composite chart may read it.
  const cardBlock = s.slice(s.indexOf('function systemCard'), s.indexOf('function fmtDate'));
  assert.ok(!cardBlock.includes('SampleTrends'), 'the card must never render invented numbers');
  const compBlock = s.slice(s.indexOf('function compositeChart'), s.indexOf('function issuesChart'));
  assert.ok(!compBlock.includes('SampleTrends'), 'the composite chart must draw real data, not the sample');
});

test('removing the sample is one script tag and one file', () => {
  // Stated as a test because it is the promise that makes shipping a mock
  // acceptable at all.
  const s = overview();
  assert.strictEqual((s.match(/js\/sample-trends\.js/g) || []).length, 1);
});

test('the composite range is offered as real controls, not decoration', () => {
  // Reads source, so chip values live in RANGE_CHIPS, not a rendered attribute.
  const s = overview();
  assert.match(s, /data-range="/, 'chips must carry the range they select');
  for (const r of ['7d', '30d', '90d', 'custom']) {
    assert.ok(s.includes(`'${r}'`), `the ${r} range must be defined as a chip`);
  }
  assert.match(s, /chip\.dataset\.range/, 'clicking a chip must change the range');
  assert.match(s, /class="wt-legend-btn/, 'the legend must be clickable buttons');
  assert.match(s, /wt-date/, 'the custom range must offer date inputs');
  assert.match(s, /aria-pressed=/, 'the selected range must be exposed, not just styled');
});
