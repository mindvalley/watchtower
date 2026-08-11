const { test } = require('node:test');
const assert = require('node:assert');
const {
  scoreComplexity, scoreDuplication, scoreSimplicity, scoreGate,
} = require('../../scripts/benchmark/score-simplicity');

test('scoreComplexity: 0 violations is an unambiguous green 5.0', () => {
  assert.deepStrictEqual(
    scoreComplexity({ violations: 0, loc: 208819 }),
    { score: 5.0, colour: 'green', critical: false },
  );
});

test('scoreComplexity: grades by violation density per KLOC, never critical', () => {
  // 1 violation over 10k LOC = 0.1/KLOC -> green 4.0
  assert.deepStrictEqual(scoreComplexity({ violations: 1, loc: 10000 }), { score: 4.0, colour: 'green', critical: false });
  // 8 over 10k = 0.8/KLOC -> amber 3.0
  assert.deepStrictEqual(scoreComplexity({ violations: 8, loc: 10000 }), { score: 3.0, colour: 'amber', critical: false });
  // 15 over 10k = 1.5/KLOC -> amber 2.5
  assert.deepStrictEqual(scoreComplexity({ violations: 15, loc: 10000 }), { score: 2.5, colour: 'amber', critical: false });
  // 30 over 10k = 3.0/KLOC -> red 1.5
  assert.deepStrictEqual(scoreComplexity({ violations: 30, loc: 10000 }), { score: 1.5, colour: 'red', critical: false });
});

test('scoreComplexity: tiny codebase with a violation does not divide-by-zero', () => {
  const s = scoreComplexity({ violations: 1, loc: 0 });
  assert.ok(s.score <= 2.0 && s.colour === 'red');
});

test('scoreDuplication: <1% green, 1-5% amber, >5% red', () => {
  assert.strictEqual(scoreDuplication({ percentage: 0 }).colour, 'green');
  assert.strictEqual(scoreDuplication({ percentage: 0.5 }).score, 5.0);
  assert.strictEqual(scoreDuplication({ percentage: 2 }).colour, 'amber');
  assert.strictEqual(scoreDuplication({ percentage: 4.9 }).colour, 'amber');
  assert.strictEqual(scoreDuplication({ percentage: 6 }).colour, 'red');
  assert.strictEqual(scoreDuplication({ percentage: 20 }).score, 1.0);
});

test('scoreSimplicity: clean system averages to green, no hard-cap', () => {
  const c8 = scoreSimplicity({
    complexity: { violations: 0, loc: 208819 },
    duplication: {
      percentage: 0, duplicated_lines: 0, total_lines: 5000, clones: 0,
    },
    tool: 'credo',
    assessedAt: '2026-07-08',
  });
  assert.strictEqual(c8.score, 5.0);
  assert.strictEqual(c8.colour, 'green');
  assert.strictEqual(c8.critical, false);
  assert.strictEqual(c8.assessed, true);
  assert.strictEqual(c8.assessed_at, '2026-07-08');
  assert.deepStrictEqual(c8.actions, []);
  assert.ok(c8.findings.some((f) => /No functions exceed cyclomatic complexity 10 \(credo\)/.test(f)));
  assert.ok(c8.findings.some((f) => /below the 5% threshold/.test(f)));
  assert.strictEqual(c8.audit.complexity.violations, 0);
});

test('scoreSimplicity: complexity + duplication both dirty -> amber/red mean, with actions', () => {
  const c8 = scoreSimplicity({
    complexity: { violations: 30, loc: 10000 }, // 1.5 red
    duplication: {
      percentage: 8, duplicated_lines: 800, total_lines: 10000, clones: 12,
    }, // 2.0 red
    tool: 'rubocop',
    assessedAt: '2026-07-08',
  });
  // mean(1.5, 2.0) = 1.75 -> 1.8
  assert.strictEqual(c8.score, 1.8);
  assert.strictEqual(c8.colour, 'red');
  assert.strictEqual(c8.critical, false); // C8 never hard-caps
  assert.ok(c8.findings.some((f) => /30 function\(s\) over cyclomatic complexity 10 \(rubocop\)/.test(f)));
  assert.ok(c8.findings.some((f) => /Duplication 8%/.test(f)));
  assert.ok(c8.actions.some((a) => /Refactor the functions/.test(a)));
  assert.ok(c8.actions.some((a) => /Extract the duplicated blocks/.test(a)));
  assert.strictEqual(c8.audit.duplication.percentage, 8);
});

test('scoreSimplicity: mid duplication (1-5%) emits the review action, not the extract action', () => {
  const c8 = scoreSimplicity({
    complexity: { violations: 0, loc: 5000 },
    duplication: {
      percentage: 2.5, duplicated_lines: 125, total_lines: 5000, clones: 3,
    },
    tool: 'credo',
    assessedAt: '2026-07-08',
  });
  assert.ok(c8.actions.some((a) => /Review the duplicated blocks/.test(a)));
  assert.ok(!c8.actions.some((a) => /Extract the duplicated blocks/.test(a)));
});

test('no gate anywhere scores zero, not null', () => {
  const r = scoreGate([{ language: 'typescript', rung: 'none', threshold: null }]);
  assert.strictEqual(r.score, 0);
});

test('configured but unenforced scores the middle rung', () => {
  assert.strictEqual(scoreGate([{ language: 'ruby', rung: 'configured', threshold: 10 }]).score, 2.0);
});

test('enforced at or below the anchor is full marks', () => {
  assert.strictEqual(scoreGate([{ language: 'elixir', rung: 'enforced', threshold: 9 }]).score, 5.0);
  assert.strictEqual(scoreGate([{ language: 'ruby', rung: 'enforced', threshold: 10 }]).score, 5.0);
});

test('enforced above the anchor scores below full marks', () => {
  assert.strictEqual(scoreGate([{ language: 'javascript', rung: 'enforced', threshold: 20 }]).score, 3.5);
});

test('the gate averages across languages so an ungated large language cannot be hidden', () => {
  const r = scoreGate([
    { language: 'elixir', rung: 'enforced', threshold: 9 },
    { language: 'typescript', rung: 'none', threshold: null },
  ]);
  assert.strictEqual(r.score, 2.5, 'mean of 5.0 and 0');
});

test('an empty gate list is null, never a default score', () => {
  assert.strictEqual(scoreGate([]).score, null);
});

test('complexity is the mean of measured density and the gate', () => {
  const r = scoreSimplicity({
    complexity: { violations: 0, loc: 100000 },
    duplication: { percentage: 0 },
    gates: [{ language: 'elixir', rung: 'enforced', threshold: 9 }],
    assessedAt: '2026-07-30',
  });
  // density 5.0, gate 5.0 -> complexity 5.0
  assert.strictEqual(r.sub.complexity.score, 5.0);
});

test('a clean violation count no longer buys a full complexity score without a gate', () => {
  const r = scoreSimplicity({
    complexity: { violations: 0, loc: 100000 },
    duplication: { percentage: 0 },
    gates: [{ language: 'typescript', rung: 'none', threshold: null }],
    assessedAt: '2026-07-30',
  });
  assert.strictEqual(r.sub.complexity.score, 2.5, 'density 5.0 and gate 0 average to 2.5');
});

test('the findings name the unmeasured languages', () => {
  const r = scoreSimplicity({
    complexity: { violations: 0, loc: 100000 },
    duplication: { percentage: 0 },
    gates: [{ language: 'elixir', rung: 'enforced', threshold: 9 }],
    unmeasured: [{ extension: '.sql', loc: 8800, reason: 'no mapped tool' }],
    assessedAt: '2026-07-30',
  });
  assert.match(r.findings.join(' | '), /\.sql/, 'no-silent-caps: unmeasured code must be visible');
});

// ---------------------------------------------------------------------------
// The gate facet is LOC-weighted (I6)
//
// A gate is protective in proportion to how much code it stands in front of.
// Alpha enforces credo at 9 over 220k of its 321k measured lines and gates
// nothing else; a flat mean of [5, 0, 0, 0] reads 1.3, which describes a repo with
// essentially no complexity discipline. The same arithmetic run the other way is
// the more important half: unweighted averaging lets a repo buy a high gate score
// by gating one tiny language.
// ---------------------------------------------------------------------------

test('scoreGate weights each language rung by its share of measured LOC', () => {
  const g = scoreGate([
    { language: 'elixir', loc: 100000, rung: 'enforced', threshold: 9 },
    { language: 'typescript', loc: 50000, rung: 'none', threshold: null },
  ]);
  assert.strictEqual(g.score, 3.3, '(5.0*100000 + 0*50000)/150000 = 3.33 -> 3.3');
  assert.strictEqual(g.weighted_by, 'loc');
});

test('gating only a tiny language cannot buy a high gate score', () => {
  const flatMeanWouldBe = 2.5;
  const g = scoreGate([
    { language: 'python', loc: 600, rung: 'enforced', threshold: 5 },
    { language: 'typescript', loc: 120000, rung: 'none', threshold: null },
  ]);
  assert.ok(g.score < 0.1, `gate over 0.5% of the code must be near zero, got ${g.score}`);
  assert.notStrictEqual(g.score, flatMeanWouldBe);
});

test('gating the largest language is worth more than gating the smallest', () => {
  const gatesBig = scoreGate([
    { language: 'elixir', loc: 200000, rung: 'enforced', threshold: 9 },
    { language: 'typescript', loc: 20000, rung: 'none', threshold: null },
  ]);
  const gatesSmall = scoreGate([
    { language: 'elixir', loc: 200000, rung: 'none', threshold: null },
    { language: 'typescript', loc: 20000, rung: 'enforced', threshold: 9 },
  ]);
  assert.ok(gatesBig.score > gatesSmall.score);
});

test('scoreGate falls back to an equal mean when no LOC is supplied', () => {
  // A caller not yet passing loc must degrade to the previous behaviour, never
  // divide by zero.
  const g = scoreGate([
    { language: 'elixir', rung: 'enforced', threshold: 9 },
    { language: 'typescript', rung: 'none', threshold: null },
  ]);
  assert.strictEqual(g.score, 2.5);
  assert.strictEqual(g.weighted_by, 'equal');
});

// ---------------------------------------------------------------------------
// Tool attribution (I7)
//
// Findings, `source` and `audit` all used the single top-level `tool`, which is
// the largest language's. Alpha published "57 functions over cyclomatic
// complexity 10 (credo)" when credo found zero of them and lizard found all 57.
// ---------------------------------------------------------------------------

const LANGS = [
  {
    language: 'elixir', tool: 'credo', loc: 220028, violations: 0,
  },
  {
    language: 'vue', tool: 'lizard', loc: 41446, violations: 17,
  },
  {
    language: 'typescript', tool: 'lizard', loc: 36996, violations: 18,
  },
];

test('the headline finding attributes violations to the tool that found them', () => {
  const r = scoreSimplicity({
    complexity: { violations: 35, loc: 298470 },
    duplication: { percentage: 0 },
    tool: 'credo',
    languages: LANGS,
    gates: [],
    assessedAt: '2026-07-30',
  });
  assert.match(r.findings[0], /35 by lizard/, 'lizard found them, not credo');
  assert.doesNotMatch(r.findings[0], /35 function\(s\) over cyclomatic complexity 10 \(credo\)/);
});

test('source names every tool that ran, not just the largest language\'s', () => {
  const r = scoreSimplicity({
    complexity: { violations: 35, loc: 298470 },
    duplication: { percentage: 0 },
    tool: 'credo',
    languages: LANGS,
    gates: [],
    assessedAt: '2026-07-30',
  });
  assert.match(r.source, /credo \+ lizard/);
});

test('the audit block records the per-language tool, loc and violation count', () => {
  const r = scoreSimplicity({
    complexity: { violations: 35, loc: 298470 },
    duplication: { percentage: 0 },
    tool: 'credo',
    languages: LANGS,
    gates: [],
    assessedAt: '2026-07-30',
  });
  assert.deepStrictEqual(r.audit.complexity.tools, ['credo', 'lizard']);
  assert.deepStrictEqual(r.audit.complexity.by_language, LANGS);
  assert.strictEqual(r.audit.complexity.tool, 'credo', 'the scalar is retained for unconverted consumers');
});

test('a single-tool system still reads naturally', () => {
  const r = scoreSimplicity({
    complexity: { violations: 12, loc: 50000 },
    duplication: { percentage: 0 },
    tool: 'lizard',
    languages: [{
      language: 'typescript', tool: 'lizard', loc: 50000, violations: 12,
    }],
    gates: [],
    assessedAt: '2026-07-30',
  });
  assert.match(r.findings[0], /12 function\(s\) over cyclomatic complexity 10 \(lizard\)/);
  assert.match(r.source, /^lizard \(cyclomatic/);
});

// ---------------------------------------------------------------------------
// Remediation text must match the detected gate state (I10)
//
// The advice asserted "the complexity linter is already in CI to hold the line"
// whenever violations > 0, regardless of gate state — a false factual claim about
// another team's pipeline, and self-contradictory next to the "make the linter
// step fail the build" line appended in the same list.
// ---------------------------------------------------------------------------

test('with no gate detected, the advice does not claim a CI linter exists', () => {
  const r = scoreSimplicity({
    complexity: { violations: 40, loc: 100000 },
    duplication: { percentage: 0 },
    tool: 'lizard',
    gates: [{ language: 'typescript', loc: 100000, rung: 'none', threshold: null }],
    assessedAt: '2026-07-30',
  });
  const joined = r.actions.join(' | ');
  assert.doesNotMatch(joined, /already in CI to hold the line/);
  assert.match(joined, /no CI step currently enforces a complexity limit/);
});

test('with every language gated, the advice says CI holds the line and asks for nothing more', () => {
  const r = scoreSimplicity({
    complexity: { violations: 3, loc: 100000 },
    duplication: { percentage: 0 },
    tool: 'credo',
    gates: [{ language: 'elixir', loc: 100000, rung: 'enforced', threshold: 9 }],
    assessedAt: '2026-07-30',
  });
  const joined = r.actions.join(' | ');
  assert.match(joined, /already in CI to hold the line/);
  assert.doesNotMatch(joined, /make the linter step fail the build/);
});

test('with a mixed gate the advice names which languages are covered and which are not', () => {
  const r = scoreSimplicity({
    complexity: { violations: 40, loc: 300000 },
    duplication: { percentage: 0 },
    tool: 'credo',
    gates: [
      { language: 'elixir', loc: 220000, rung: 'enforced', threshold: 9 },
      { language: 'vue', loc: 41000, rung: 'none', threshold: null },
      { language: 'typescript', loc: 37000, rung: 'none', threshold: null },
    ],
    assessedAt: '2026-07-30',
  });
  const joined = r.actions.join(' | ');
  assert.match(joined, /CI already holds the line for elixir, but not for vue, typescript/);
  assert.match(joined, /Add a cyclomatic-complexity limit of 10 to the linter config for vue, typescript/);
  // The two clauses must no longer contradict each other.
  assert.doesNotMatch(joined, /the complexity linter is already in CI to hold the line\./);
});
