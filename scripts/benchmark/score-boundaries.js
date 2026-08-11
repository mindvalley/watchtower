'use strict';

// Pure C1 (Clear Domain Boundaries) scoring, phase 1: circular dependencies and
// module fan-out. Anchors are the benchmark spec's own thresholds. Returns null
// whenever the criterion is indeterminate -- never a false green.

const { round1, colourFor } = require('./score-security');

// Band -> score. Green = 5.0; amber grades linearly 3.5 -> 2.5 across the band;
// red decays from 2.0 to a 0.5 floor so a catastrophic system stays
// distinguishable from an unmeasured one. Within-band gradation is PROVISIONAL.
// greenBelow is the first AMBER value: cycles 1 (so 0 is green), fan-out 5.
// amberMax is the last amber value: cycles 3, fan-out 10.
// discrete: true means red starts at amberMax + 1 (integer count); false/omitted
// means red starts at amberMax (continuous metric).
function bandScore(value, { greenBelow, amberMax, discrete }) {
  const redOrigin = discrete ? amberMax + 1 : amberMax;
  if (value < greenBelow) return 5.0;
  if (value <= amberMax) {
    const span = amberMax - greenBelow;
    const pos = span === 0 ? 0 : (value - greenBelow) / span;
    return round1(3.5 - pos * 1.0);
  }
  return round1(Math.max(0.5, 2.0 - 0.1 * (value - redOrigin)));
}

// Indeterminate result. Returned as an OBJECT with score: null rather than a
// bare null, following score-observability.js: a bare null makes
// build-benchmark-data omit the criterion entirely and the site renders
// "pending — not yet assessed", which is wrong twice over. The spec says C1 does
// not use Pending at launch, and the real reason (module_discovery.reason, or
// the degenerate-graph reason) is the whole point of an indeterminate state.
// `measuredSub` carries anything the scan did manage to measure before the
// criterion fell to indeterminate, plus the per-metric withholding reason. An
// indeterminate criterion is not an empty one: "0 cycles measured, not scored,
// because the extractor under-counts" is far more useful to a reader than a
// blank, and dropping it hid real numbers on the Elixir systems.
function indeterminate(r, reason, assessedAt, extraFindings = [], measuredSub = {}) {
  const discovery = r.module_discovery || {};
  const findings = [`Indeterminate — ${reason}`, ...extraFindings];
  const g = r.graph || {};
  if (g.modules_declared != null && g.module_graph_coverage != null) {
    findings.push(
      `Module-graph coverage ${(Number(g.module_graph_coverage) * 100).toFixed(1)}% `
      + `(${g.modules_connected}/${g.modules_declared} declared modules in the graph); `
      + `threshold ${(Number(g.module_graph_coverage_threshold) * 100).toFixed(0)}%`
    );
  }
  return {
    score: null,
    colour: null,
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    indeterminate: reason,
    source: BOUNDARY_SOURCE,
    sub: {
      circular_dependencies: {
        score: null,
        colour: null,
        count: measuredSub.cycleCount != null ? measuredSub.cycleCount : null,
        withheld: measuredSub.cycleWithheld || reason,
      },
      module_fan_out: {
        score: null,
        colour: null,
        mean: measuredSub.meanFanOut != null ? round1(measuredSub.meanFanOut) : null,
        withheld: measuredSub.fanWithheld || reason,
      },
    },
    findings,
    actions: [],
    audit: {
      discovery,
      modules: (discovery.modules || []).length,
      graph: g,
    },
  };
}

const BOUNDARY_SOURCE = 'Domain-boundary health — circular dependencies and module fan-out over a tree-sitter code graph. Modules are discovered from the repo\'s own workspace declaration. External coupling is counted only at recognised client-construction and connection call sites. Static/headless; change-coupling and violation trend follow in phase 2.';

// Why a stack can be measured but not graded. Both C1 metrics shipped so far are
// derived from the code graph, so when the graph under-resolves a stack there is
// nothing left to grade and the criterion is indeterminate. This is deliberately
// NOT Pending: Pending promises the number is coming, and we are not committing
// to repair a third-party extractor. See criterion-stacks.boundaryGraphDisposition
// for the measurements behind the call.
const UNRELIABLE_GRAPH_REASON = 'the code graph under-resolves this stack — on the reference repository it '
  + 'recovered 4 of 8 real cross-module dependencies and reported one of them backwards, and a cycle needs only '
  + 'one missing edge to vanish; cycles and fan-out are still measured and reported below, but not scored';

// Withholding is ASYMMETRIC, because an under-counting extractor does not destroy
// information symmetrically. Every edge it misses pushes both graph metrics DOWN:
// a missed dependency lowers fan-out and can erase a cycle entirely. So a measured
// value is a FLOOR — the truth is at least this bad and possibly worse.
//
// That makes bad news credible and good news worthless. A measured 2 cycles means
// there really are at least 2; a measured 0 means nothing at all. A mean fan-out of
// 5.5 means the real figure is 5.5 or higher, so it is already outside the green
// band no matter what was missed; a mean of 2 could be anything.
//
// Grade the metric when the floor already breaches green. Withhold it when the
// floor sits inside green. Grading a floor yields the most generous score the
// evidence supports, which is the correct direction to err — it can never publish
// a system as worse than the measurement proves, and it can never publish a green
// the measurement cannot support. Without this, withholding the metric that read
// amber while scoring the one that read green published a full green and lifted
// the composite (observed on a real system, 2026-07-30).
const FLOOR_CREDIBLE_NOTE = 'the extractor under-counts dependencies on this stack, so the measured value is a '
  + 'floor — the real figure can only be higher, which means this grade is the most generous the evidence allows';
const FLOOR_INSIDE_GREEN_REASON = 'the code graph under-resolves this stack and every edge it misses pushes this '
  + 'metric down, so a reading inside the green band cannot be trusted — the missing dependencies could be the '
  + 'whole story. The value is measured and reported, but a clean result is not evidence of clean boundaries. '
  + 'Had the measurement already breached the threshold it would have been graded, since under-counting can '
  + 'only understate it';

// Everything that can stop the two graph-derived metrics from being graded, in
// one place. Returns a reason string when they cannot be graded, or null with the
// computed scores when they can. Separated out so a graph problem can no longer
// short-circuit the whole criterion -- change coupling does not use the graph and
// must survive its failure.
function evaluateGraphMetrics(r, graphDisposition) {
  const modules = (r.module_discovery && r.module_discovery.modules) || [];
  if (r.indeterminate) {
    return { blocked: (r.module_discovery && r.module_discovery.reason) || r.indeterminate };
  }
  if (modules.length < 2) {
    return { blocked: 'fewer than two modules discovered; cross-module coupling is undefined' };
  }
  // A graph with no dependency edges means the extractor missed the language.
  // That is not clean boundaries. Use positive-finite check.
  const edges = (r.graph && Number(r.graph.edges)) || 0;
  if (!Number.isFinite(edges) || edges <= 0) {
    return { blocked: 'no cross-module dependency edges resolved; the extractor did not understand this codebase' };
  }
  // Cycles block must be present and count must be a finite number, never omitted/null/non-number.
  const cycles = r.cycles || {};
  if (typeof cycles.count !== 'number' || !Number.isFinite(cycles.count)) {
    return { blocked: 'cycle count missing or not a number in the scan report' };
  }
  // Fan-out block must be present and mean must be a finite number, never omitted/null/non-number.
  const fanOut = r.fan_out || {};
  if (typeof fanOut.mean !== 'number' || !Number.isFinite(fanOut.mean)) {
    return { blocked: 'mean fan-out missing or not a number in the scan report' };
  }
  const CYCLE_BANDS = { greenBelow: 1, amberMax: 3, discrete: true };
  const FAN_BANDS = { greenBelow: 5, amberMax: 10, discrete: false };

  if (graphDisposition === 'unreliable') {
    // Per-metric, not per-criterion: grade whichever floor already breaches green.
    // See FLOOR_INSIDE_GREEN_REASON for why this asymmetry is the honest rule.
    const cycleBreaches = cycles.count >= CYCLE_BANDS.greenBelow;
    const fanBreaches = fanOut.mean >= FAN_BANDS.greenBelow;
    return {
      blocked: null,
      measured: true,
      floorGraded: cycleBreaches || fanBreaches,
      cycleCount: cycles.count,
      meanFanOut: fanOut.mean,
      cycleScore: cycleBreaches ? bandScore(cycles.count, CYCLE_BANDS) : null,
      cycleWithheld: cycleBreaches ? null : FLOOR_INSIDE_GREEN_REASON,
      fanScore: fanBreaches ? bandScore(fanOut.mean, FAN_BANDS) : null,
      fanWithheld: fanBreaches ? null : FLOOR_INSIDE_GREEN_REASON,
    };
  }
  return {
    blocked: null,
    measured: true,
    cycleCount: cycles.count,
    meanFanOut: fanOut.mean,
    cycleScore: bandScore(cycles.count, CYCLE_BANDS),
    cycleWithheld: null,
    fanScore: bandScore(fanOut.mean, FAN_BANDS),
    fanWithheld: null,
  };
}

// Change coupling reads git history, never the graph. Evaluated independently so
// a graph failure cannot take it down.
function evaluateCoupling(cc) {
  if (!cc) return { score: null, count: null, withheld: null };
  if (!cc.declarable) {
    return {
      score: null,
      count: null,
      withheld: 'this repo shape has no per-module dependency declaration to compare against, so '
        + '"co-changes with nothing declared" would be true of every pair and would mean nothing',
    };
  }
  if ((cc.qualifying_modules || 0) < 2) {
    return {
      score: null,
      count: null,
      withheld: `only ${cc.qualifying_modules || 0} module(s) reached the minimum revision count in the `
        + `last ${cc.window_days} days — too little history to tell coupling from coincidence`,
    };
  }
  const count = (cc.violations || []).length;
  return { score: bandScore(count, { greenBelow: 1, amberMax: 5, discrete: true }), count, withheld: null };
}

function scoreBoundaries(report, { assessedAt, graphDisposition = 'ok' } = {}) {
  const r = report || {};
  if (!r.applicable) return null;

  const modules = (r.module_discovery && r.module_discovery.modules) || [];
  const cycles = r.cycles || {};
  const cc = r.change_coupling || null;

  const graph = evaluateGraphMetrics(r, graphDisposition);
  // Each graph metric stands or falls on its own now. A hard block (no usable
  // graph at all) withholds both; an under-resolving extractor withholds only the
  // readings that landed inside green.
  const graphProduced = !!graph.measured;
  const cycleScore = graph.cycleScore != null ? graph.cycleScore : null;
  const fanScore = graph.fanScore != null ? graph.fanScore : null;
  const cycleWithheld = cycleScore === null ? (graph.cycleWithheld || graph.blocked) : null;
  const fanWithheld = fanScore === null ? (graph.fanWithheld || graph.blocked) : null;
  const cycleCount = graph.cycleCount;
  const meanFanOut = graph.meanFanOut;

  const coupling = evaluateCoupling(cc);
  const couplingScore = coupling.score;
  const couplingCount = coupling.count;
  const couplingWithheld = coupling.withheld;

  const findings = [];
  const actions = [];

  // Everything withheld is still surfaced, with the reason. Silence would read
  // as "nothing to see here", which is the opposite of the truth.
  // Only report a number when the graph actually produced it. A blocked graph
  // that produced nothing must not print "0 cycles".
  if (graphProduced) {
    if (cycleScore === null) {
      findings.push(
        `${cycleCount} circular dependenc${cycleCount === 1 ? 'y' : 'ies'} measured between the `
        + `${modules.length} declared modules (measured, not scored)`
      );
    }
    if (fanScore === null) {
      findings.push(`Mean module fan-out ${round1(meanFanOut)} measured across ${modules.length} modules (measured, not scored)`);
    }
    // The withholding reason is identical for both metrics, so say it once.
    const withheldReason = cycleWithheld || fanWithheld;
    if (withheldReason) findings.push(`Not scored on the code graph — ${withheldReason}`);
    if (graph.floorGraded) findings.push(`Graded on a lower bound — ${FLOOR_CREDIBLE_NOTE}`);
  } else {
    findings.push(`Not scored on the code graph — ${graph.blocked}`);
  }
  if (couplingWithheld) findings.push(`Hidden coupling not scored — ${couplingWithheld}`);

  const scoreable = [];
  if (cycleScore !== null) scoreable.push(cycleScore);
  if (fanScore !== null) scoreable.push(fanScore);
  if (couplingScore !== null) scoreable.push(couplingScore);

  // Nothing scoreable is indeterminate, never a default high mark.
  if (!scoreable.length) {
    return indeterminate(
      r,
      graph.blocked || cycleWithheld || fanWithheld || couplingWithheld || 'no sub-metric could be scored',
      assessedAt,
      findings,
      graphProduced ? { cycleCount, meanFanOut, cycleWithheld, fanWithheld } : {}
    );
  }

  const score = round1(scoreable.reduce((a, b) => a + b, 0) / scoreable.length);

  const ext = r.external_targets || {};
  const g = r.graph || {};
  const detect = r.external_target_detection;
  const weak = cycles.uncorroborated || [];

  if (cycleScore !== null) {
    if (cycleCount === 0) {
      findings.push(`No circular dependencies between the ${modules.length} declared modules`);
    } else {
      findings.push(`${cycleCount} circular dependenc${cycleCount === 1 ? 'y' : 'ies'} between modules`);
      const sourceArray = cycles.cycles || [];
      const cyclesToList = sourceArray.slice(0, 20);
      for (const c of cyclesToList) findings.push(`Cycle: ${c.join(' -> ')}`);
      // Fire truncation message only when the 20-item cap was hit, not when bounded enumeration cut cycles.
      if (sourceArray.length > 20) {
        findings.push(`(Listing truncated: ${sourceArray.length - 20} more cycles not shown)`);
      }
      actions.push('Break each module cycle by extracting the shared concern or inverting one dependency');
    }
    if (cycles.bounded) {
      findings.push(`Cycle enumeration was bounded: ${cycles.dropped} additional cycles not fully enumerated`);
    }

    // Cycles rejected by the corroboration rule are surfaced, never hidden: the
    // reader needs to know a cycle-shaped thing was seen and why it did not count.
    for (const u of weak.slice(0, 5)) {
      findings.push(
        `Uncorroborated cycle (not counted): ${u.cycle.join(' -> ')} — `
        + `${u.weak_directions.join(', ')} rests on a single link into a file whose name collides with a standard-library module, `
        + 'which is a known graphify misresolution'
      );
    }
    if (weak.length > 5) findings.push(`(${weak.length - 5} further uncorroborated cycles not listed)`);
  }

  if (fanScore !== null) {
    findings.push(`Mean module fan-out ${round1(meanFanOut)} across ${modules.length} modules`);
    if (meanFanOut > 5) actions.push('Reduce fan-out on the highest-degree modules — they are the widest blast radius for a change');
  }

  // Graph-quality evidence belongs to the reader whenever the graph produced
  // numbers, whether or not either metric was graded from them.
  if (graphProduced) {
    const extCount = new Set(Object.values(ext).flat()).size;
    if (extCount) findings.push(`${extCount} distinct external target(s) called from module code`);

    // No silent caps: the measured coverage and the threshold it passed are shown
    // even when the repo is scored, and so is the anchoring rejection count.
    if (g.module_graph_coverage != null) {
      findings.push(
        `Module-graph coverage ${(Number(g.module_graph_coverage) * 100).toFixed(1)}% `
        + `(${g.modules_connected}/${g.modules_declared} declared modules in the graph, `
        + `threshold ${(Number(g.module_graph_coverage_threshold) * 100).toFixed(0)}%)`
      );
    }
    if (g.skipped_stdlib_collision_edges) {
      findings.push(`${g.skipped_stdlib_collision_edges} import link(s) dropped as standard-library filename collisions`);
    }
    if (g.skipped_cross_language_edges) {
      findings.push(`${g.skipped_cross_language_edges} link(s) dropped as cross-language name collisions`);
    }
    if (detect && detect.unanchored_uri_literals_rejected != null) {
      findings.push(
        `External targets counted from ${detect.anchored_uri_literals} anchored call-site URI literal(s); `
        + `${detect.unanchored_uri_literals_rejected} unanchored literal(s) rejected`
      );
    }
  }

  // ─── Change coupling findings ──────────────────────────────────────────────
  if (couplingScore !== null) {
    if (couplingCount === 0) {
      findings.push(
        `No hidden couplings: every module pair that changes together in the last ${cc.window_days} days `
        + 'also declares a dependency'
      );
    } else {
      findings.push(
        `${couplingCount} module pair${couplingCount === 1 ? '' : 's'} change together without declaring a dependency`
      );
      for (const v of (cc.violations || []).slice(0, 10)) {
        findings.push(
          `Hidden coupling: ${v.a} and ${v.b} changed together in ${v.shared_revs} commits `
          + `(${v.degree}% coupling) with no declared dependency either way`
        );
      }
      if ((cc.violations || []).length > 10) {
        findings.push(`(Listing truncated: ${cc.violations.length - 10} more hidden couplings not shown)`);
      }
      actions.push('For each hidden coupling either declare the dependency or decouple the two modules');
    }
    // Bounds are always visible, per the no-silent-caps rule.
    if (cc.excluded_oversized_changesets) {
      findings.push(
        `${cc.excluded_oversized_changesets} sweeping changeset(s) excluded from the coupling signal `
        + '(more modules touched than the analysis cap)'
      );
    }
    if ((cc.unreadable_manifests || []).length) {
      findings.push(
        `${cc.unreadable_manifests.length} module manifest(s) could not be read, so their declared `
        + `dependencies are unknown: ${cc.unreadable_manifests.slice(0, 5).join(', ')}`
      );
    }
  }

  return {
    score,
    colour: colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: BOUNDARY_SOURCE,
    sub: {
      circular_dependencies: cycleScore !== null
        ? { score: cycleScore, colour: colourFor(cycleScore), count: cycleCount }
        : { score: null, colour: null, count: graphProduced ? cycleCount : null, withheld: cycleWithheld },
      module_fan_out: fanScore !== null
        ? { score: fanScore, colour: colourFor(fanScore), mean: round1(meanFanOut) }
        : { score: null, colour: null, mean: graphProduced ? round1(meanFanOut) : null, withheld: fanWithheld },
      cross_boundary_access: couplingScore !== null
        ? { score: couplingScore, colour: colourFor(couplingScore), count: couplingCount }
        : { score: null, colour: null, count: couplingCount, withheld: couplingWithheld },
    },
    findings,
    actions,
    audit: {
      discovery: r.module_discovery,
      modules: modules.length,
      cycles: {
        count: cycleCount,
        bounded: !!(r.cycles && r.cycles.bounded),
        dropped: (r.cycles && r.cycles.dropped) || 0,
        uncorroborated: weak,
      },
      fan_out: (r.fan_out && r.fan_out.per_module) || {},
      change_coupling: cc || null,
      external_targets: ext,
      external_target_detection: detect || null,
      graph: g,
    },
  };
}

module.exports = { scoreBoundaries, bandScore };
