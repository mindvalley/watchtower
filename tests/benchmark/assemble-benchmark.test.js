const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildSystemEntry, assembleBenchmark, bandFor, TOTAL_CRITERIA, RED_MAX, AMBER_MAX,
} = require('../../scripts/benchmark/assemble-benchmark');

const green9 = { score: 5.0, colour: 'green', critical: false, assessed: true, assessed_at: '2026-06-30' };
const capped9 = { score: 1.5, colour: 'red', critical: true, assessed: true, assessed_at: '2026-06-30' };

// A criterion at an arbitrary /5 score, for building means without ceremony.
const at = (score, critical = false) => ({ score, colour: 'x', critical, assessed_at: '2026-06-30' });
const scoreOf = (...criteria) => buildSystemEntry({
  criteria: Object.fromEntries(criteria.map((c, i) => [i, c])), assessedAt: '2026-06-30',
}).score;

test('TOTAL_CRITERIA is the 7-criterion namespace (former C3, C5 removed)', () => {
  assert.strictEqual(TOTAL_CRITERIA, 7);
});

test('buildSystemEntry composites scored criteria out of 100 and labels coverage as N of 7', () => {
  const entry = buildSystemEntry({ criteria: { 9: green9 }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.score, 100);
  assert.strictEqual(entry.colour, 'green');
  assert.strictEqual(entry.hard_capped, false);
  assert.strictEqual(entry.coverage, '1 of 7 assessed');
  assert.strictEqual(entry.assessed_at, '2026-06-30');
});

test('the composite is a whole number out of 100, never the /5 mean', () => {
  // The scale change is the reason every consumer had to be revisited. A /5 value
  // silently surviving here would render as a near-zero score in a ring that goes
  // to 100 — wrong, and wrong in the direction that looks like a real finding.
  for (const mean of [0, 0.7, 1.5, 2.0, 3.33, 3.5, 4.25, 5.0]) {
    const score = scoreOf(at(mean));
    assert.ok(Number.isInteger(score), `mean ${mean} produced ${score}, which is not an integer`);
    assert.ok(score >= 0 && score <= 100, `mean ${mean} produced ${score}, outside 0-100`);
    assert.strictEqual(score, Math.round(mean * 20));
  }
});

test('per-criterion scores are left on their own /5 scale', () => {
  // Mixed scales are the deliberate choice, not an accident: rescaling the
  // criteria too would divorce them from the anchors they are judged against.
  const entry = buildSystemEntry({ criteria: { 9: green9 }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.criteria[9].score, 5.0);
});

test('a Critical finding puts the SCORE in the red band, not just the colour', () => {
  // This is the whole change. Before, the number said 100 and a separate flag
  // painted the badge red, so the two disagreed and the page had to apologise.
  const entry = buildSystemEntry({
    criteria: { 8: at(5.0), 9: { ...green9, critical: true } }, assessedAt: '2026-06-30',
  });
  assert.strictEqual(entry.score, 40, 'a flawless system with a Critical lands at the top of red');
  assert.strictEqual(entry.colour, 'red');
  assert.ok(entry.score <= RED_MAX, 'no capped system may score outside the red band');
});

test('the cap scales rather than clamps, so capped systems still rank against each other', () => {
  // A flat clamp would flatten every capped system to one number and destroy the
  // only signal that says which of them is closest to being fixable.
  const sound = scoreOf(at(4.5), at(4.5, true));
  const rotten = scoreOf(at(1.0), at(1.0, true));
  assert.ok(sound > rotten, `expected the sounder capped system to rank higher (${sound} vs ${rotten})`);
  assert.ok(sound <= RED_MAX && rotten <= RED_MAX);
});

test('the Critical trigger is binary — five Criticals score the same as one', () => {
  // Nothing in the benchmark anchors a "twice as critical". Compounding would be
  // gradation we invented, which is the thing this project keeps refusing to do.
  const one = scoreOf(at(3.0, true), at(3.0), at(3.0), at(3.0), at(3.0));
  const five = scoreOf(at(3.0, true), at(3.0, true), at(3.0, true), at(3.0, true), at(3.0, true));
  assert.strictEqual(one, five);
});

test('hard_capped is still published as data, for the expander and the audit trail', () => {
  const entry = buildSystemEntry({ criteria: { 9: capped9 }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.score, 12); // 1.5 -> 30, scaled by the ceiling
  assert.strictEqual(entry.hard_capped, true);
  // Two systems can now reach the same number by different routes: one capped
  // from a middling mean, one simply that bad. The score alone cannot tell them
  // apart, which is exactly why the flag is still published — the expander needs
  // to say "there is a Critical here" rather than leaving it to be inferred.
  const plain = buildSystemEntry({ criteria: { 9: at(0.6) }, assessedAt: '2026-06-30' });
  assert.strictEqual(plain.score, entry.score);
  assert.strictEqual(plain.hard_capped, false);
});

test('bands are the old 2.0 / 3.5 boundaries rescaled, with nothing new introduced', () => {
  assert.strictEqual(RED_MAX, 40);   // was 2.0 / 5
  assert.strictEqual(AMBER_MAX, 70); // was 3.5 / 5
  assert.strictEqual(bandFor(0), 'red');
  assert.strictEqual(bandFor(40), 'red');
  assert.strictEqual(bandFor(41), 'amber');
  assert.strictEqual(bandFor(70), 'amber');
  assert.strictEqual(bandFor(71), 'green');
  assert.strictEqual(bandFor(100), 'green');
});

test('the colour can never contradict the number it is published beside', () => {
  // The defect this replaces, stated as a property rather than an example: 59 of
  // 115 published readings carried a colour their own score disagreed with. Sweep
  // every reachable mean, capped and not, and insist the two always agree.
  for (let fifths = 0; fifths <= 50; fifths += 1) {
    const mean = fifths / 10;
    for (const critical of [false, true]) {
      const entry = buildSystemEntry({ criteria: { 9: at(mean, critical) }, assessedAt: '2026-06-30' });
      assert.strictEqual(entry.colour, bandFor(entry.score),
        `mean ${mean}${critical ? ' (critical)' : ''} published ${entry.score} as ${entry.colour}`);
    }
  }
});

test('buildSystemEntry averages only scored criteria (ignores entries with null score)', () => {
  const entry = buildSystemEntry({
    criteria: { 8: { score: 4.0, colour: 'green', critical: false, assessed_at: '2026-06-19' }, 9: green9 },
    assessedAt: '2026-06-30',
  });
  assert.strictEqual(entry.score, 90); // mean(4.0, 5.0) = 4.5 -> 90
  assert.strictEqual(entry.coverage, '2 of 7 assessed');
});

test('an unscored system publishes no score and no colour, rather than a zero', () => {
  // A zero would read as "measured and terrible" in a ring that fills by score.
  const entry = buildSystemEntry({ criteria: { 9: { score: null, critical: false } }, assessedAt: '2026-06-30' });
  assert.strictEqual(entry.score, null);
  assert.strictEqual(entry.colour, null);
  assert.strictEqual(entry.coverage, '0 of 7 assessed');
});

test('assembleBenchmark wraps systems with example:false and last_updated', () => {
  const out = assembleBenchmark({
    systems: { alpha: buildSystemEntry({ criteria: { 9: green9 }, assessedAt: '2026-06-30' }) },
    lastUpdated: '2026-06-30',
  });
  assert.strictEqual(out.example, false);
  assert.strictEqual(out.last_updated, '2026-06-30');
  assert.strictEqual(out.systems.alpha.score, 100);
});
