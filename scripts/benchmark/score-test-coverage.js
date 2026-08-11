'use strict';

// Pure C6 (Test Coverage) scoring. Static readiness/discipline only — no suite
// execution (actual coverage % is deferred to the Monitor layer). C6 = mean of
// two facets: Breadth (linear test<->source file-presence proxy, pooled across
// stacks) and Discipline (CI-enforced coverage rung ladder graded on Google
// 60/75/90 tiers, mean of applicable stacks). No hard-cap. Returns null when
// N/A or when there is nothing to score — never a false green.

const { round1, colourFor } = require('./score-security');

const STACK_LABEL = {
  elixir: 'Elixir', ruby: 'Ruby', frontend: 'Frontend', python: 'Python',
};

// Enforced-threshold value -> Google tier score.
function tierScore(meanThreshold) {
  if (meanThreshold >= 90) return 5.0;
  if (meanThreshold >= 75) return 4.25;
  if (meanThreshold >= 60) return 3.5;
  return 2.5;
}

// One stack's discipline rung + score from its tooling block.
function disciplineForStack(tooling) {
  const t = tooling || {};
  const thresholds = (Array.isArray(t.thresholds) ? t.thresholds : []).filter((n) => Number(n) > 0);
  if (thresholds.length) {
    // Enforced thresholds imply the tool is present, regardless of the present flag
    // (a scan may detect a threshold without matching a tool-name string).
    const mean = thresholds.reduce((a, b) => a + b, 0) / thresholds.length;
    return { rung: 'enforced', score: tierScore(mean), thresholds };
  }
  if (t.present) return { rung: 'configured', score: 2.0, thresholds: [] };
  return { rung: 'none', score: 0.0, thresholds: [] };
}

function scoreTestCoverage(report, { assessedAt } = {}) {
  const r = report || {};
  if (!r.applicable) return null;
  const stacks = r.stacks || {};
  const keys = Object.keys(stacks);
  if (!keys.length) return null;

  // Breadth: pooled across all stacks.
  let totalSource = 0;
  let totalTested = 0;
  const byStackBreadth = {};
  for (const k of keys) {
    const s = stacks[k] || {};
    totalSource += Number(s.source_files) || 0;
    totalTested += Number(s.tested_files) || 0;
    byStackBreadth[k] = { source: Number(s.source_files) || 0, tested: Number(s.tested_files) || 0 };
  }
  if (totalSource === 0) return null;
  const breadthCoverage = totalTested / totalSource;
  const breadthScore = round1(5 * breadthCoverage);

  // Discipline: mean of applicable stacks.
  const byStackDiscipline = {};
  const disciplineScores = [];
  for (const k of keys) {
    const d = disciplineForStack((stacks[k] || {}).tooling);
    byStackDiscipline[k] = {
      tool: (stacks[k].tooling || {}).tool || null,
      present: !!(stacks[k].tooling || {}).present,
      rung: d.rung,
      score: d.score,
      thresholds: d.thresholds,
    };
    disciplineScores.push(d.score);
  }
  const disciplineScore = disciplineScores.reduce((a, b) => a + b, 0) / disciplineScores.length;

  const score = round1((breadthScore + disciplineScore) / 2);
  const pct = Math.round(breadthCoverage * 100);
  const untestedTotal = totalSource - totalTested;

  const findings = [
    `Test breadth: ${pct}% (${totalTested} of ${totalSource} source files have a paired test) — file-presence proxy, not line coverage`,
  ];

  // Discipline finding: summarise the enforcement picture across stacks.
  const enforcedBits = keys
    .filter((k) => byStackDiscipline[k].rung === 'enforced')
    .map((k) => `${STACK_LABEL[k] || k} ${byStackDiscipline[k].thresholds.join('/')}`);
  const configuredBits = keys.filter((k) => byStackDiscipline[k].rung === 'configured').map((k) => STACK_LABEL[k] || k);
  const noneBits = keys.filter((k) => byStackDiscipline[k].rung === 'none').map((k) => STACK_LABEL[k] || k);
  if (enforcedBits.length) findings.push(`Coverage enforced in CI: ${enforcedBits.join(', ')}`);
  if (configuredBits.length) findings.push(`Coverage tool configured but no threshold enforced: ${configuredBits.join(', ')}`);
  if (noneBits.length) findings.push(`No coverage tooling detected: ${noneBits.join(', ')}`);

  const actions = [];
  if (untestedTotal > 0) {
    actions.push(`Add tests for untested source files — ${untestedTotal} source file${untestedTotal === 1 ? ' has' : 's have'} no paired test file (file-presence proxy; a paired test does not guarantee line coverage).`);
  }
  if (noneBits.length) {
    actions.push(`Adopt a coverage tool and enforce a minimum threshold in CI for: ${noneBits.join(', ')} (Google acceptable floor is 60%).`);
  }
  if (configuredBits.length) {
    actions.push(`Enforce a minimum coverage threshold in CI for: ${configuredBits.join(', ')} — a tool is configured but no threshold gates the build (minimum_coverage 0 does not count).`);
  }

  return {
    score,
    colour: colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'Test-coverage readiness — breadth (test↔source file-presence proxy, pooled full-stack) + discipline (CI-enforced coverage, Google 60/75/90 tiers). Static/headless; actual coverage % deferred to Monitor.',
    sub: {
      test_breadth: {
        score: breadthScore, colour: colourFor(breadthScore), pct, tested: totalTested, total: totalSource,
      },
      coverage_discipline: {
        score: disciplineScore, colour: colourFor(disciplineScore),
      },
    },
    findings,
    actions,
    audit: {
      breadth: { total_source: totalSource, total_tested: totalTested, by_stack: byStackBreadth },
      discipline: { by_stack: byStackDiscipline },
    },
  };
}

module.exports = { scoreTestCoverage };
