'use strict';

// Pure C8 (Codebase Simplicity) scoring. Consumes normalized complexity +
// duplication counts (from parse-reports.js) and applies the fixed convention
// anchors: McCabe cyclomatic complexity <= 10 per function; code duplication < 5%.
// Unlike C9, C8 has NO hard-cap — over-complex code is a maintainability signal,
// not a security emergency, so it never forces the overall badge red on its own.

const { round1, colourFor } = require('./score-security');

// Complexity sub-metric. The convention anchor is per-function (CC <= 10); the
// aggregate is the number of functions that VIOLATE it, normalized to a density
// per 1,000 lines of scanned source so systems of different sizes are comparable.
// 0 violations is the only unambiguous green (matches the original "0 violations
// = green" precedent). The density bands above 0 are a PROVISIONAL
// aggregation (no published anchor exists for "violations per KLOC") — flagged
// for review against the benchmark's scoring conventions.
function scoreComplexity({ violations = 0, loc = 0 } = {}) {
  if (violations === 0) return { score: 5.0, colour: 'green', critical: false };
  const density = violations / (Math.max(loc, 1) / 1000);
  let score;
  if (density <= 0.5) score = 4.0;
  else if (density <= 1.0) score = 3.0;
  else if (density <= 2.0) score = 2.5;
  else score = 1.5;
  return { score, colour: colourFor(score), critical: false };
}

// Duplication sub-metric. Anchor: jscpd duplication percentage < 5% (jscpd
// default). < 1% green, 1-5% amber (graded), > 5% red (graded). Scores land in
// the shared colour bands so colourFor stays consistent.
function scoreDuplication({ percentage = 0 } = {}) {
  let score;
  if (percentage < 1) score = 5.0;
  else if (percentage < 3) score = 3.5;
  else if (percentage <= 5) score = 2.8;
  else if (percentage <= 10) score = 2.0;
  else score = 1.0;
  return { score, colour: colourFor(score), critical: false };
}

// Name every tool that actually ran, and attribute the count to the tool that
// found it. The single top-level `tool` is the largest language's, so a
// per-language scan reported through it told one team that credo had found 57
// over-complex functions when credo found zero of them and lizard found all 57.
// `languages` is [{ language, tool, loc, violations }] when the builder supplies
// it; the flat form is retained for a consumer that has not been converted.
function toolAttribution(languages, fallbackTool) {
  const rows = (languages || []).filter((l) => l && l.tool);
  if (!rows.length) return { tools: fallbackTool ? [fallbackTool] : [], byTool: [] };
  const byTool = new Map();
  for (const l of rows) {
    const cur = byTool.get(l.tool) || { tool: l.tool, languages: [], violations: 0, loc: 0 };
    cur.languages.push(l.language);
    cur.violations += l.violations || 0;
    cur.loc += l.loc || 0;
    byTool.set(l.tool, cur);
  }
  const list = [...byTool.values()].sort((a, b) => b.loc - a.loc || a.tool.localeCompare(b.tool));
  return { tools: list.map((t) => t.tool), byTool: list };
}

function complexityFinding({
  violations, loc, tool, languages,
}) {
  const { tools, byTool } = toolAttribution(languages, tool);
  const toolList = tools.length ? tools.join(' + ') : tool;
  if (violations === 0) {
    return `No functions exceed cyclomatic complexity 10 (${toolList}) across ${loc.toLocaleString()} lines`;
  }
  const density = round1(violations / (Math.max(loc, 1) / 1000));
  // With more than one tool, say which one found what — otherwise the credit (or
  // the blame) lands on whichever language happened to be largest.
  const breakdown = byTool.length > 1
    ? ` — ${byTool.filter((t) => t.violations > 0).map((t) => `${t.violations} by ${t.tool} (${t.languages.join(', ')})`).join(', ')}`
    : ` (${toolList})`;
  return `${violations} function(s) over cyclomatic complexity 10${breakdown} — ${density} per 1k lines`;
}

function duplicationFinding({ percentage, duplicated_lines, total_lines }) {
  if (percentage < 1) {
    return `Duplication ${percentage}% — below the 5% threshold (jscpd)`;
  }
  return `Duplication ${percentage}% (${duplicated_lines}/${total_lines} lines, jscpd)`;
}

// The enforcement facet. C8's direct measurement is censored on a gated repo — no
// function above the gate's threshold can merge — so a clean violation count there
// describes the gate, not the code. Scoring the gate makes that honest: an enforcing
// repo earns credit for enforcing, and an ungated repo is judged on its distribution.
//
// Rung -> score. The anchor of 10 is published (McCabe 1976); the LADDER is not.
// 0 / 2.0 / 3.5 / 5.0 is a convention this benchmark chose, and the 3.5
// above-anchor rung in particular is a judgement call marked as such on the
// criterion page rather than presented as fact beside the McCabe anchor. It takes
// the same shape as C6's configured-but-not-enforced rung. Grading the threshold
// rather than treating enforcement as binary follows from the anchor: we override
// ESLint's default of 20 down to 10 in our own measurement, so accepting a repo's
// 20 as full marks would contradict the standard we hold ourselves to.
const COMPLEXITY_ANCHOR = 10;

function gateRungScore({ rung, threshold }) {
  if (rung === 'enforced') return threshold != null && threshold <= COMPLEXITY_ANCHOR ? 5.0 : 3.5;
  if (rung === 'configured') return 2.0;
  return 0;
}

// Pooled over the same material languages the violations pool over, and weighted
// by each language's share of the measured LOC — the same weighting the density
// facet already gets for free by pooling violations and lines before dividing.
//
// Why weighted rather than a flat mean: a gate is protective in proportion to how
// much code it stands in front of. One umbrella enforces credo at 9 over 197k of
// its 298k measured lines and gates nothing else; an unweighted mean of
// [5.0, 0, 0, 0] reads 1.3, which describes a repo with essentially no complexity
// discipline. That is not that repo. Weighted, it reads 3.3. The same arithmetic
// runs the other way and is the more important half: a repo that gates only a
// twentieth of its code cannot buy a high gate score by having many tiny gated
// languages. Unweighted averaging flatters exactly the repo it should not.
//
// A gate entry with no loc falls back to equal weight, so a caller that has not
// been converted degrades to the previous behaviour rather than dividing by zero.
function scoreGate(gates = []) {
  if (!Array.isArray(gates) || gates.length === 0) return { score: null, colour: null, critical: false };
  const weights = gates.map((g) => (typeof g.loc === 'number' && g.loc > 0 ? g.loc : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const score = totalWeight > 0
    ? round1(gates.reduce((acc, g, i) => acc + gateRungScore(g) * weights[i], 0) / totalWeight)
    : round1(gates.reduce((acc, g) => acc + gateRungScore(g), 0) / gates.length);
  return {
    score, colour: colourFor(score), critical: false, weighted_by: totalWeight > 0 ? 'loc' : 'equal',
  };
}

function scoreSimplicity({
  complexity, duplication, tool, gates, languages, unmeasured, skippedImmaterial, assessedAt,
}) {
  const density = scoreComplexity(complexity);
  const gate = scoreGate(gates);
  // complexity = mean(measured density, enforcement) — mirrors C6's
  // mean(breadth, discipline). Where no gate could be determined the facet falls
  // back to the density alone rather than inventing a gate score.
  const cxParts = [density.score, gate.score].filter((s) => s != null);
  const cxScore = round1(cxParts.reduce((a, b) => a + b, 0) / cxParts.length);
  const cx = { score: cxScore, colour: colourFor(cxScore), critical: false, density, gate };
  const dup = scoreDuplication(duplication);
  const sub = { complexity: cx, duplication: dup };

  const scored = [cx, dup].filter((s) => s && s.score != null);
  const score = round1(scored.reduce((a, s) => a + s.score, 0) / scored.length);
  const colour = colourFor(score);

  const attribution = toolAttribution(languages, tool);
  const findings = [
    complexityFinding({ ...complexity, tool, languages }),
    duplicationFinding(duplication),
  ];
  for (const g of (gates || [])) {
    findings.push(g.rung === 'enforced'
      ? `${g.language}: complexity enforced in CI at ${g.threshold}`
      : g.rung === 'configured'
        ? `${g.language}: complexity rule configured but not enforced in CI`
        : `${g.language}: no complexity limit enforced`);
  }
  for (const u of (unmeasured || [])) {
    findings.push(`${u.loc.toLocaleString()} lines of ${u.extension} not measured for complexity — ${u.reason}`);
  }
  for (const s of (skippedImmaterial || [])) {
    findings.push(`${s.language} skipped for complexity: ${s.loc} lines is below the materiality floor`);
  }

  const gateList = gates || [];
  const enforcedLangs = gateList.filter((g) => g.rung === 'enforced').map((g) => g.language);
  const ungatedLangs = gateList.filter((g) => g.rung !== 'enforced').map((g) => g.language);

  const actions = [];
  if (complexity.violations > 0) {
    // The trailing clause used to assert "the complexity linter is already in CI to
    // hold the line" unconditionally — a false factual claim about another team's
    // pipeline whenever no gate was detected, and self-contradictory next to the
    // "make the linter step fail the build" advice appended below. Say only what
    // was actually detected.
    const base = 'Refactor the functions above cyclomatic complexity 10 (extract helpers, flatten branching)';
    if (enforcedLangs.length && !ungatedLangs.length) {
      actions.push(`${base}; the complexity linter is already in CI to hold the line.`);
    } else if (enforcedLangs.length) {
      actions.push(`${base}; CI already holds the line for ${enforcedLangs.join(', ')}, but not for ${ungatedLangs.join(', ')}.`);
    } else {
      actions.push(`${base}; no CI step currently enforces a complexity limit, so the count can grow unchecked.`);
    }
  }
  if (duplication.percentage >= 5) {
    actions.push('Extract the duplicated blocks (jscpd report lists locations) into shared modules; duplication above 5% makes the canonical pattern ambiguous for agents.');
  } else if (duplication.percentage >= 1) {
    actions.push('Review the duplicated blocks flagged by jscpd — consolidate where a single canonical implementation is clearer.');
  }
  if (ungatedLangs.length) {
    actions.push(`Add a cyclomatic-complexity limit of 10 to the linter config for ${ungatedLangs.join(', ')} and make the linter step fail the build.`);
  }

  const audit = {
    complexity: {
      // `tool` remains the largest language's, for consumers reading the scalar.
      // `tools` and `by_language` are the honest record: which tool measured what,
      // over how many lines, and how many violations it is responsible for.
      tool,
      tools: attribution.tools,
      by_language: (languages || []).filter((l) => l && l.tool).map((l) => ({
        language: l.language, tool: l.tool, loc: l.loc || 0, violations: l.violations || 0,
      })),
      threshold: 10,
      violations: complexity.violations || 0,
      loc: complexity.loc || 0,
    },
    duplication: {
      tool: 'jscpd',
      threshold_pct: 5,
      percentage: duplication.percentage || 0,
      duplicated_lines: duplication.duplicated_lines || 0,
      total_lines: duplication.total_lines || 0,
      clones: duplication.clones || 0,
    },
  };

  return {
    score,
    colour,
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: `${(attribution.tools.length ? attribution.tools : [tool]).join(' + ')} (cyclomatic complexity, max 10) + jscpd (duplication, <5%)`,
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = {
  scoreComplexity, scoreDuplication, scoreGate, scoreSimplicity, toolAttribution,
};
