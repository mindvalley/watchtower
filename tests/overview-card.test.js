'use strict';

// Guards on the overview's card, which changed shape on 2026-08-27.
//
// These read the source rather than the rendered page, because the render lives
// inside an IIFE in an HTML file and no ordinary unit test can reach it. That
// makes them brittle to renaming — deliberately, on the same reasoning as
// overview-no-fleet-list.test.js: the alternative is a check that cannot fail.
// The pure logic behind the card is tested properly in criteria.test.js; what
// is left here is the wiring, and the wiring is exactly where the /5 scale
// would survive unnoticed.
//
// Every check was verified against a planted violation before being committed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const OVERVIEW = path.join(__dirname, '..', 'public', 'index.html');
const src = () => fs.readFileSync(OVERVIEW, 'utf8');

test('the composite renders out of 100, with no trace of the /5 scale', () => {
  const s = src();
  // The specific regression: the card used to print `score.toFixed(1)` beside a
  // literal "/ 5". A stored value that had not been re-ruled would render as
  // "2.6" in a ring that fills to 100 — a fifth of the arc, and no sign that
  // anything is wrong.
  assert.ok(!/score-denom|\/\s*5</.test(s), 'the overview still shows a /5 denominator');
  assert.ok(!/s\.score\.toFixed/.test(s),
    'the composite is a whole number out of 100 and must not be formatted to one decimal');
});

test('the ring colour is derived from the score, never read off the payload', () => {
  // This is the whole point of the change. Before it, colour and score were
  // independent fields and 59 of 115 published readings disagreed with
  // themselves. Deriving it here too means a stale row cannot put the
  // disagreement back on the page.
  const s = src();
  assert.match(s, /function bandOf\s*\(/, 'the page must derive the band itself');
  assert.match(s, /const colour = bandOf\(s\.score\)/,
    'the card must colour itself from the score, not from s.colour');
  // And the derivation must use the published boundaries rather than inventing
  // its own — 40 and 70 are the old 2.0 and 3.5 rescaled.
  assert.match(s, /RED_MAX\s*=\s*40/);
  assert.match(s, /AMBER_MAX\s*=\s*70/);
});

test('the band legend is present, so colour is not the only encoding', () => {
  // The band word used to sit on every card. One legend under the grid says it
  // once — but it has to actually be there, because this palette's green and
  // amber sit 5.1 ΔE apart under protanopia and the ring is otherwise the only
  // signal.
  const s = src();
  assert.match(s, /function bandLegend\s*\(/);
  assert.match(s, /\$\{bandLegend\(\)\}/, 'the legend must be rendered, not merely defined');
});

test('the card offers the one thing to do next, ranked rather than listed', () => {
  const s = src();
  assert.match(s, /Criteria\.topAction\(/, 'the action must come from the shared ranked reading');
  // The invented "highest-value actions" panel must be gone, not hidden. Named
  // by its identifiers rather than by its prose: an earlier version of this
  // matched the word "illustrative", which also appears in the unrelated
  // example-data notice, so it failed on a page that was already correct.
  for (const dead of ['actionSketch', 'sketch-caveat', 'sketch-row', 'action-sketch']) {
    assert.ok(!s.includes(dead), `${dead} survived the card redesign`);
  }
});

test('the movement table is gone — the card carries the delta now', () => {
  const s = src();
  // Matched as calls and definitions, not as substrings. Three of this file's
  // guards have now failed on prose rather than on code — a comment recording
  // why something was removed necessarily contains its name. A substring check
  // for a deleted identifier forbids explaining the deletion.
  assert.ok(!s.includes('movement-table'), 'the movement table markup survived');
  for (const dead of ['movementRow', 'movementSummary', 'sparkline']) {
    assert.ok(!new RegExp(`\\b${dead}\\s*\\(`).test(s), `${dead}() survived the card redesign`);
  }
  // ...but movement itself did not go away. It moved onto the card.
  assert.match(s, /function deltaLine\s*\(/);
  assert.match(s, /entry\.movement/, 'the delta must still read the history payload');
});

test('the delta is a percentage over a window, not a raw difference', () => {
  const s = src();
  assert.match(s, /from_score\) \/ m\.from_score\) \* 100/,
    'the delta must be expressed relative to where the system started');
  assert.match(s, /function daysBetween\s*\(/, 'the delta must say over what period');
  // A single reading is a position, not a movement.
  assert.match(s, /one reading/);
});

test('the header states a date rather than animating a claim about freshness', () => {
  const s = src();
  // By markup, not by prose — the comment that records why the badge went still
  // quotes the words it used to show, and an earlier version of this failed on
  // its own explanation.
  assert.ok(!/class="pulse"/.test(s), 'the live pulse must be gone');
  assert.ok(!/class="header-badge"/.test(s), 'the header badge must be gone');
  assert.match(s, /Last updated \$\{fmtDate\(benchmark\.last_updated\)\}/);
});

test('the tabs carry no system counts', () => {
  const s = src();
  assert.ok(!/org-tab-count/.test(s), 'the count beside each organisation must be gone');
});

test('the mockup is not served', () => {
  // It was untracked for a reason and had no loading helper, so it also broke a
  // page-wide guard every time the suite ran against a working copy that still
  // had it.
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', '_mockup.html')),
    'public/_mockup.html must not be committed');
});
