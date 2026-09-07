'use strict';

// The sample data behind the trend charts is invented, and the danger with
// invented data is not that it is wrong — it is that it stops being obviously
// invented. These tests hold the three properties that keep it honest and
// useful: it is deterministic, it is internally consistent, and it is derived
// from the real fleet rather than from a list of our systems.
//
// They also hold the property that makes it deletable: the page marks every
// chart drawn from it, and nothing else consumes it.
//
// Every check was verified against a planted violation before being committed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  sampleFor, WINDOWS, noise, datesEndingAt, compositeSeries, issuesSeries,
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

test('each composite line ENDS on the real score, so the chart agrees with the card', () => {
  // The one point that is not invented. Without it the right-hand edge of every
  // line disagrees with the ring above it, which reads as a bug rather than as
  // a placeholder.
  const s = sampleFor(FLEET, 'quarter', '2026-08-11');
  for (const line of s.composite) {
    const real = FLEET.find((f) => f.key === line.key).score;
    assert.strictEqual(line.points[line.points.length - 1].score, real,
      `${line.key}: series ends at ${line.points[line.points.length - 1].score}, card says ${real}`);
  }
});

test('unscored systems get no line rather than a line at zero', () => {
  const s = sampleFor(FLEET, 'month', '2026-08-11');
  assert.deepStrictEqual(s.composite.map((l) => l.key), ['alpha', 'bravo']);
});

test('composite values stay inside the axis', () => {
  // The invented walk is clamped. An unclamped one drifts off the top of the
  // chart on a long window and draws a line through the title.
  for (const w of Object.keys(WINDOWS)) {
    for (const line of sampleFor(FLEET, w, '2026-08-11').composite) {
      for (const p of line.points) {
        assert.ok(p.score >= 0 && p.score <= 100, `${line.key} ${p.date}: ${p.score} is off the axis`);
      }
    }
  }
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

test('every chart drawn from invented numbers is marked as such', () => {
  const s = overview();
  assert.match(s, /class="wt-sample"/, 'the sample badge must be rendered');
  assert.match(s, /Sample data/, 'the badge must say so in words, not by colour alone');
  // And say WHICH numbers are invented, because the two charts are mocked for
  // different reasons and one of them is mostly real.
  assert.match(s, /wt-sample-note/);
});

test('the invented numbers reach the charts and nothing else', () => {
  // The guard that matters. If this data ever fed a ring or an action, the board
  // would be publishing fiction with no marker anywhere near it.
  const s = overview();
  const uses = (s.match(/SampleTrends\.\w+/g) || []);
  assert.deepStrictEqual([...new Set(uses)].sort(), ['SampleTrends.WINDOWS', 'SampleTrends.sampleFor'],
    'SampleTrends must only be read for the window list and the chart series');
  assert.strictEqual((s.match(/SampleTrends\.sampleFor\(/g) || []).length, 1,
    'the sample must be built in exactly one place — the trends section');
  // The card path must not see it.
  const cardBlock = s.slice(s.indexOf('function systemCard'), s.indexOf('function fmtDate'));
  assert.ok(!cardBlock.includes('SampleTrends'), 'the card must never render invented numbers');
});

test('removing the sample is one script tag and one file', () => {
  // Stated as a test because it is the promise that makes shipping a mock
  // acceptable at all.
  const s = overview();
  assert.strictEqual((s.match(/js\/sample-trends\.js/g) || []).length, 1);
});

test('the trend windows are offered as real controls, not decoration', () => {
  const s = overview();
  for (const w of ['week', 'month', 'quarter']) {
    assert.ok(s.includes(`data-window="`), 'chips must carry the window they select');
  }
  assert.match(s, /activeWindow = chip\.dataset\.window/, 'clicking a chip must change the window');
  assert.match(s, /aria-pressed=/, 'the selected window must be exposed, not just styled');
});
