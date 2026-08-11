'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreBoundaries } = require('../../scripts/benchmark/score-boundaries');

// Indeterminate is now an OBJECT with score: null (following score-observability),
// not a bare null. A bare null makes build-benchmark-data omit the criterion and
// the dashboard renders "pending — not yet assessed", which the spec forbids for
// C1 and which hides the actual reason.
function assertIndeterminate(r, reasonRe) {
  assert.ok(r && typeof r === 'object', 'expected an indeterminate object, not a bare null');
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.colour, null);
  assert.strictEqual(r.assessed, true);
  assert.ok(r.indeterminate, 'expected an indeterminate reason string');
  assert.ok(r.findings.length > 0, 'expected the reason to be rendered as a finding');
  if (reasonRe) assert.match(r.indeterminate, reasonRe);
  assert.strictEqual(r.sub.circular_dependencies.score, null);
  assert.strictEqual(r.sub.module_fan_out.score, null);
}

const base = (over = {}) => ({
  applicable: true,
  indeterminate: null,
  module_discovery: { kind: 'pnpm-workspace', modules: ['apps/web', 'packages/core'], reason: null },
  cycles: { count: 0, cycles: [], bounded: false, dropped: 0 },
  fan_out: { per_module: { 'apps/web': 2, 'packages/core': 2 }, mean: 2 },
  external_targets: {},
  graph: { nodes: 400, edges: 900 },
  ...over,
});

test('zero cycles and low fan-out is green', () => {
  const r = scoreBoundaries(base(), { assessedAt: '2026-07-28' });
  assert.strictEqual(r.sub.circular_dependencies.score, 5.0);
  assert.strictEqual(r.sub.module_fan_out.score, 5.0);
  assert.strictEqual(r.score, 5.0);
  assert.strictEqual(r.colour, 'green');
});

test('amber band grades inside the band', () => {
  assert.strictEqual(scoreBoundaries(base({ cycles: { count: 1, cycles: [], bounded: false, dropped: 0 } }), {}).sub.circular_dependencies.score, 3.5);
  assert.strictEqual(scoreBoundaries(base({ cycles: { count: 2, cycles: [], bounded: false, dropped: 0 } }), {}).sub.circular_dependencies.score, 3.0);
  assert.strictEqual(scoreBoundaries(base({ cycles: { count: 3, cycles: [], bounded: false, dropped: 0 } }), {}).sub.circular_dependencies.score, 2.5);
});

test('red band decays to a floor of 0.5', () => {
  assert.strictEqual(scoreBoundaries(base({ cycles: { count: 4, cycles: [], bounded: false, dropped: 0 } }), {}).sub.circular_dependencies.score, 2.0);
  assert.strictEqual(scoreBoundaries(base({ cycles: { count: 200, cycles: [], bounded: false, dropped: 0 } }), {}).sub.circular_dependencies.score, 0.5);
});

// A stack whose code graph is known to under-resolve must not be graded on
// graph-derived metrics. The numbers are still measured and still reported --
// withheld from scoring, not hidden from the reader.
test('a stack with an unreliable code graph is not graded on cycles or fan-out', () => {
  const r = scoreBoundaries(base(), { assessedAt: '2026-07-29', graphDisposition: 'unreliable' });
  assertIndeterminate(r, /code graph/i);
  assert.strictEqual(r.score, null);
});

test('an unreliable graph still reports the measured cycle count and fan-out as findings', () => {
  const r = scoreBoundaries(
    base({ cycles: { count: 0, cycles: [], bounded: false, dropped: 0 }, fan_out: { per_module: {}, mean: 2 } }),
    { graphDisposition: 'unreliable' }
  );
  const text = r.findings.join(' | ');
  assert.match(text, /0 circular dependenc/i, 'measured cycle count should still be surfaced');
  assert.match(text, /fan-out 2/i, 'measured fan-out should still be surfaced');
  assert.match(text, /not scored|withheld|not graded/i, 'must say the numbers are not scored');
});

test('the default disposition still grades the graph metrics', () => {
  const r = scoreBoundaries(base(), { assessedAt: '2026-07-29' });
  assert.strictEqual(r.score, 5.0);
});

// ─── Asymmetric withholding ────────────────────────────────────────────────
// An under-counting extractor does not destroy information symmetrically. Every
// edge it misses pushes both graph metrics DOWN, so a measured value is a floor:
// bad news is credible (the truth is at least this bad) and good news is not (the
// missing edges could be the whole story). Grade a measured value that already
// breaches the green threshold; withhold one that sits inside it.

test('an unreliable graph still grades cycles when the measured count already breaches green', () => {
  const r = scoreBoundaries(
    base({ cycles: { count: 2, cycles: [['a', 'b', 'a']], bounded: false, dropped: 0 } }),
    { assessedAt: '2026-07-30', graphDisposition: 'unreliable' }
  );
  assert.strictEqual(r.sub.circular_dependencies.score, 3.0, 'a non-zero cycle count is a credible floor');
  assert.strictEqual(r.sub.circular_dependencies.count, 2);
});

test('an unreliable graph withholds cycles when the measured count is zero', () => {
  const r = scoreBoundaries(base(), { assessedAt: '2026-07-30', graphDisposition: 'unreliable' });
  assert.strictEqual(r.sub.circular_dependencies.score, null);
  assert.ok(r.sub.circular_dependencies.withheld, 'a zero from an under-counting extractor proves nothing');
  assert.strictEqual(r.sub.circular_dependencies.count, 0, 'the measured value still travels with the reason');
});

test('an unreliable graph still grades fan-out once the measured mean reaches the amber band', () => {
  const r = scoreBoundaries(
    base({ fan_out: { per_module: {}, mean: 5.5 } }),
    { assessedAt: '2026-07-30', graphDisposition: 'unreliable' }
  );
  assert.ok(r.sub.module_fan_out.score !== null, 'a mean of 5.5 is already outside green and can only rise');
  assert.ok(r.sub.module_fan_out.score < 5.0);
  assert.strictEqual(r.sub.module_fan_out.mean, 5.5);
});

test('an unreliable graph withholds fan-out while the measured mean is inside green', () => {
  const r = scoreBoundaries(
    base({ fan_out: { per_module: {}, mean: 4.9 } }),
    { assessedAt: '2026-07-30', graphDisposition: 'unreliable' }
  );
  assert.strictEqual(r.sub.module_fan_out.score, null);
  assert.ok(r.sub.module_fan_out.withheld);
});

// The alpha case that prompted this rule: withholding the metric that read
// amber while scoring the one that read green published a green 5.0 and lifted
// the composite. A measured amber must not be able to hide behind a withholding.
test('a withheld-green cycle count cannot leave an amber fan-out unpublished', () => {
  const r = scoreBoundaries(
    base({
      cycles: { count: 0, cycles: [], bounded: false, dropped: 0 },
      fan_out: { per_module: {}, mean: 5.5 },
      change_coupling: {
        window_days: 90, declarable: true, qualifying_modules: 4, violations: [], pairs: [],
      },
    }),
    { assessedAt: '2026-07-30', graphDisposition: 'unreliable' }
  );
  assert.ok(r.score < 5.0, `criterion must not be a full green while a measured amber is in evidence (got ${r.score})`);
  assert.strictEqual(r.sub.circular_dependencies.score, null);
  assert.ok(r.sub.module_fan_out.score < 5.0);
  assert.strictEqual(r.sub.cross_boundary_access.score, 5.0);
});

test('a graded-despite-unreliable metric says the value is a floor', () => {
  const r = scoreBoundaries(
    base({ fan_out: { per_module: {}, mean: 6 } }),
    { assessedAt: '2026-07-30', graphDisposition: 'unreliable' }
  );
  assert.match(r.findings.join(' | '), /at least|floor|under-count/i);
});

test('indeterminate report scores nothing', () => {
  assertIndeterminate(scoreBoundaries(base({ indeterminate: 'layer-organised: app/ holds layers' }), {}), /layer-organised/);
});

test('a degenerate graph is indeterminate, not clean boundaries', () => {
  assertIndeterminate(scoreBoundaries(base({ graph: { nodes: 400, edges: 0 } }), {}), /no cross-module dependency edges/);
});

test('a bounded cycle enumeration is surfaced in findings', () => {
  const r = scoreBoundaries(base({ cycles: { count: 600, cycles: [], bounded: true, dropped: 100 } }), {});
  assert.ok(r.findings.some((f) => /not fully enumerated|bounded/i.test(f)));
});

test('missing applicable guard prevents false green', () => {
  assert.strictEqual(scoreBoundaries(base({ applicable: false }), {}), null);
});

test('missing modules guard prevents false green on single module', () => {
  assertIndeterminate(scoreBoundaries(base({ module_discovery: { kind: 'pnpm-workspace', modules: ['apps/web'], reason: null } }), {}), /fewer than two modules/);
});

test('missing cycles block is indeterminate, not zero cycles', () => {
  assertIndeterminate(scoreBoundaries(base({ cycles: null }), {}), /cycle count/);
});

test('missing fan-out block is indeterminate, not zero fan-out', () => {
  assertIndeterminate(scoreBoundaries(base({ fan_out: null }), {}), /fan-out/);
});

test('negative edge count is indeterminate', () => {
  assertIndeterminate(scoreBoundaries(base({ graph: { nodes: 400, edges: -1 } }), {}), /no cross-module dependency edges/);
});

test('fan-out red band boundary at 10 is amber', () => {
  const r = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 10, 'packages/core': 10 }, mean: 10 } }), {});
  assert.strictEqual(r.sub.module_fan_out.score, 2.5);
  assert.strictEqual(r.sub.module_fan_out.colour, 'amber');
});

test('fan-out red band at 10.01 is red', () => {
  const r = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 10.01, 'packages/core': 10.01 }, mean: 10.01 } }), {});
  assert.strictEqual(r.sub.module_fan_out.score, 2.0);
  assert.strictEqual(r.sub.module_fan_out.colour, 'red');
});

test('fan-out red band at 15 is red', () => {
  const r = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 15, 'packages/core': 15 }, mean: 15 } }), {});
  assert.strictEqual(r.sub.module_fan_out.score, 1.5);
  assert.strictEqual(r.sub.module_fan_out.colour, 'red');
});

test('fan-out red band at 40 floors at 0.5', () => {
  const r = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 40, 'packages/core': 40 }, mean: 40 } }), {});
  assert.strictEqual(r.sub.module_fan_out.score, 0.5);
  assert.strictEqual(r.sub.module_fan_out.colour, 'red');
});

test('cycles red band at 4 is red', () => {
  const r = scoreBoundaries(base({ cycles: { count: 4, cycles: [], bounded: false, dropped: 0 } }), {});
  assert.strictEqual(r.sub.circular_dependencies.score, 2.0);
  assert.strictEqual(r.sub.circular_dependencies.colour, 'red');
});

test('cycles red band at 200 floors at 0.5', () => {
  const r = scoreBoundaries(base({ cycles: { count: 200, cycles: [], bounded: false, dropped: 0 } }), {});
  assert.strictEqual(r.sub.circular_dependencies.score, 0.5);
  assert.strictEqual(r.sub.circular_dependencies.colour, 'red');
});

test('cycle listing truncation is signaled in findings', () => {
  const manyC = Array.from({ length: 25 }, (_, i) => [`m${i}`, `m${i + 1}`]);
  const r = scoreBoundaries(base({ cycles: { count: 25, cycles: manyC, bounded: false, dropped: 0 } }), {});
  assert.ok(r.findings.some((f) => /truncated|not shown/i.test(f)));
});

test('null cycles.count is indeterminate, not zero cycles', () => {
  assertIndeterminate(scoreBoundaries(base({ cycles: { count: null, cycles: [], bounded: false, dropped: 0 } }), {}), /cycle count/);
});

test('non-number cycles.count is indeterminate', () => {
  assertIndeterminate(scoreBoundaries(base({ cycles: { count: 'five', cycles: [], bounded: false, dropped: 0 } }), {}), /cycle count/);
});

test('null fan_out.mean is indeterminate, not zero fan-out', () => {
  assertIndeterminate(scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 2, 'packages/core': 2 }, mean: null } }), {}), /fan-out/);
});

test('non-number fan_out.mean is indeterminate', () => {
  assertIndeterminate(scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 2, 'packages/core': 2 }, mean: 'low' } }), {}), /fan-out/);
});

test('bounded enumeration with partial listing shows both bounded and listing messages', () => {
  const r = scoreBoundaries(base({ cycles: { count: 25, cycles: Array.from({ length: 15 }, (_, i) => [`m${i}`, `m${i + 1}`]), bounded: true, dropped: 10 } }), {});
  assert.ok(r.findings.some((f) => /not fully enumerated|bounded/i.test(f)), 'bounded message present');
  assert.ok(!r.findings.some((f) => /listing truncated|not shown/i.test(f)), 'truncation message absent when source array not truncated');
});

test('discrete (cycles) red origin is amberMax + 1', () => {
  // cycles at 3 is amber (last amber value)
  const r3 = scoreBoundaries(base({ cycles: { count: 3, cycles: [], bounded: false, dropped: 0 } }), {});
  assert.strictEqual(r3.sub.circular_dependencies.score, 2.5);
  assert.strictEqual(r3.sub.circular_dependencies.colour, 'amber');
  // cycles at 4 is red (first red value), computed as redOrigin = amberMax + 1
  const r4 = scoreBoundaries(base({ cycles: { count: 4, cycles: [], bounded: false, dropped: 0 } }), {});
  assert.strictEqual(r4.sub.circular_dependencies.score, 2.0);
  assert.strictEqual(r4.sub.circular_dependencies.colour, 'red');
});

test('continuous (fan-out) red origin equals amberMax', () => {
  // fan-out at 10 is amber (last amber value)
  const r10 = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 10, 'packages/core': 10 }, mean: 10 } }), {});
  assert.strictEqual(r10.sub.module_fan_out.score, 2.5);
  assert.strictEqual(r10.sub.module_fan_out.colour, 'amber');
  // fan-out at 10.01 is red (first red value), computed as redOrigin = amberMax
  const r10dot01 = scoreBoundaries(base({ fan_out: { per_module: { 'apps/web': 10.01, 'packages/core': 10.01 }, mean: 10.01 } }), {});
  assert.strictEqual(r10dot01.sub.module_fan_out.score, 2.0);
  assert.strictEqual(r10dot01.sub.module_fan_out.colour, 'red');
});

// ─── Change coupling (cross-boundary direct access) ──────────────────────────

const coupled = (over = {}) => ({
  window_days: 90,
  declarable: true,
  total_revisions: 120,
  qualifying_modules: 4,
  excluded_oversized_changesets: 2,
  unreadable_manifests: [],
  pairs: [],
  violations: [],
  ...over,
});

test('no hidden couplings is green on the cross-boundary metric', () => {
  const r = scoreBoundaries(base({ change_coupling: coupled() }), {});
  assert.strictEqual(r.sub.cross_boundary_access.score, 5.0);
  assert.strictEqual(r.sub.cross_boundary_access.count, 0);
});

test('hidden couplings band on the spec thresholds 0 / 1-5 / 6+', () => {
  const v = (n) => Array.from({ length: n }, (_, i) => ({ a: `a${i}`, b: `b${i}`, degree: 50, shared_revs: 6 }));
  assert.strictEqual(scoreBoundaries(base({ change_coupling: coupled({ violations: v(1) }) }), {}).sub.cross_boundary_access.score, 3.5);
  assert.strictEqual(scoreBoundaries(base({ change_coupling: coupled({ violations: v(5) }) }), {}).sub.cross_boundary_access.score, 2.5);
  assert.strictEqual(scoreBoundaries(base({ change_coupling: coupled({ violations: v(6) }) }), {}).sub.cross_boundary_access.score, 2.0);
});

test('the criterion score is the mean of whichever sub-metrics are scoreable', () => {
  // cycles 5.0, fan-out 5.0, one hidden coupling 3.5 -> mean 4.5
  const v = [{ a: 'x', b: 'y', degree: 60, shared_revs: 7 }];
  const r = scoreBoundaries(base({ change_coupling: coupled({ violations: v }) }), {});
  assert.strictEqual(r.score, 4.5);
});

// The whole point of change coupling: it reads git history, not the code graph,
// so a stack whose graph is withheld can still be graded on this metric.
test('change coupling still scores when the code graph is withheld', () => {
  const r = scoreBoundaries(base({ change_coupling: coupled() }), { graphDisposition: 'unreliable' });
  assert.strictEqual(r.score, 5.0);
  assert.strictEqual(r.sub.circular_dependencies.score, null);
  assert.strictEqual(r.sub.module_fan_out.score, null);
  assert.strictEqual(r.sub.cross_boundary_access.score, 5.0);
});

test('a repo shape with no way to declare dependencies is not graded on hidden coupling', () => {
  const r = scoreBoundaries(base({ change_coupling: coupled({ declarable: false }) }), {});
  assert.strictEqual(r.sub.cross_boundary_access.score, null);
  // cycles and fan-out remain scoreable, so the criterion still has a score
  assert.strictEqual(r.score, 5.0);
});

// Too little history is not the same as clean boundaries.
test('a repo with too few qualifying modules is not graded on hidden coupling', () => {
  const r = scoreBoundaries(base({ change_coupling: coupled({ qualifying_modules: 1 }) }), {});
  assert.strictEqual(r.sub.cross_boundary_access.score, null);
});

test('withholding every sub-metric leaves the criterion indeterminate, never a default green', () => {
  const r = scoreBoundaries(
    base({ change_coupling: coupled({ declarable: false }) }),
    { graphDisposition: 'unreliable' }
  );
  assert.strictEqual(r.score, null);
  assert.ok(r.indeterminate);
});

test('hidden couplings are named in the findings with their evidence', () => {
  const v = [{ a: 'apps/api', b: 'apps/billing', degree: 62, shared_revs: 8 }];
  const r = scoreBoundaries(base({ change_coupling: coupled({ violations: v }) }), {});
  const text = r.findings.join(' | ');
  assert.match(text, /apps\/api/);
  assert.match(text, /apps\/billing/);
  assert.match(text, /62/);
});

test('excluded sweeping commits are reported, never silently dropped', () => {
  const r = scoreBoundaries(base({ change_coupling: coupled({ excluded_oversized_changesets: 7 }) }), {});
  assert.match(r.findings.join(' | '), /7 .*(sweep|changeset|commit)/i);
});

// Change coupling does not use the code graph, so a graph failure must not take
// it down with it. delta, hotel and juliett-web all have usable module
// discovery and usable history but a degenerate graph -- withholding their whole
// criterion loses a signal we actually have.
test('a degenerate graph still scores change coupling', () => {
  const r = scoreBoundaries(base({
    indeterminate: 'degenerate graph: only 0 of 3 declared modules appear in the dependency graph',
    cycles: { count: null, cycles: [], bounded: false, dropped: 0 },
    fan_out: { per_module: {}, mean: null },
    graph: { nodes: 400, edges: 0 },
    change_coupling: coupled(),
  }), {});
  assert.strictEqual(r.score, 5.0);
  assert.strictEqual(r.sub.circular_dependencies.score, null);
  assert.strictEqual(r.sub.module_fan_out.score, null);
  assert.strictEqual(r.sub.cross_boundary_access.score, 5.0);
});

test('a graph failure is still named in the findings when coupling carries the score', () => {
  const r = scoreBoundaries(base({
    indeterminate: 'degenerate graph: only 0 of 3 declared modules appear in the dependency graph',
    cycles: { count: null, cycles: [], bounded: false, dropped: 0 },
    fan_out: { per_module: {}, mean: null },
    graph: { nodes: 400, edges: 0 },
    change_coupling: coupled(),
  }), {});
  assert.match(r.findings.join(' | '), /degenerate graph/i);
});

test('a discovery failure with no usable coupling stays indeterminate', () => {
  const r = scoreBoundaries(base({
    indeterminate: 'layer-organised: app/ holds layers',
    cycles: { count: null, cycles: [], bounded: false, dropped: 0 },
    fan_out: { per_module: {}, mean: null },
    change_coupling: coupled({ declarable: false }),
  }), {});
  assert.strictEqual(r.score, null);
  assert.match(r.indeterminate, /layer-organised/);
});

test('an unparseable cycles block does not stop change coupling from scoring', () => {
  const r = scoreBoundaries(base({ cycles: null, change_coupling: coupled() }), {});
  assert.strictEqual(r.score, 5.0);
  assert.strictEqual(r.sub.circular_dependencies.score, null);
});
