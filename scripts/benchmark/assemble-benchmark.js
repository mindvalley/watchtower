'use strict';

// Pure scorecard assembly: per-system criteria -> composite + coverage + hard-cap,
// then the full benchmark.json contract. Composite is the mean of SCORED criteria
// only (Planned/absent excluded); the coverage denominator is the fixed namespace.

// The benchmark namespace after removing the two dropped criteria (former C3, C5).
// Coverage is "N of TOTAL_CRITERIA assessed".
const TOTAL_CRITERIA = 7;

// The composite is out of 100. Per-criterion scores stay out of 5 — they answer a
// different question and are read next to their own anchors, so mixing the scales
// is deliberate rather than an oversight.
//
// Until 2026-08-27 the composite was a /5 mean and a Critical finding forced the
// colour red without touching the number, so a system could publish 4.3 in a red
// badge and the page had to explain the disagreement. Across the 115 published
// readings, 59 showed a colour their own number contradicted. There is now ONE
// rule: a Critical scales the mean into the red band, and the colour is read off
// the resulting number and nothing else.
//
// Scaling rather than clamping, so ordering survives among capped systems — a
// capped system that is otherwise sound still ranks above a capped one that is
// not, which is what tells you where to send someone next.
const CRITICAL_CEILING = 0.4; // lands a perfect-but-critical system at exactly 40

// The former 2.0 / 3.5 boundaries rescaled. No new anchor is being introduced.
const RED_MAX = 40;
const AMBER_MAX = 70;

function bandFor(score) {
  if (score <= RED_MAX) return 'red';
  if (score <= AMBER_MAX) return 'amber';
  return 'green';
}

function buildSystemEntry({ criteria, assessedAt }) {
  const entries = Object.values(criteria).filter((c) => c && c.score != null);
  const scoredCount = entries.length;
  // Binary: five Criticals score the same as one. No anchor exists for
  // compounding them, and inventing one would be gradation we cannot defend.
  const hardCapped = entries.some((c) => c.critical);
  const mean = scoredCount
    ? entries.reduce((s, c) => s + c.score, 0) / scoredCount
    : null;
  const composite = mean == null
    ? null
    : Math.round(mean * 20 * (hardCapped ? CRITICAL_CEILING : 1));
  return {
    score: composite,
    colour: composite == null ? null : bandFor(composite),
    // Still published: the expander names why a system is where it is, and the
    // audit trail needs to distinguish "scored 28" from "scored 70, then capped".
    // It is never rendered as a badge of its own.
    hard_capped: hardCapped,
    coverage: `${scoredCount} of ${TOTAL_CRITERIA} assessed`,
    assessed_at: assessedAt,
    criteria,
  };
}

function assembleBenchmark({ systems, lastUpdated }) {
  return { last_updated: lastUpdated, example: false, systems };
}

module.exports = {
  buildSystemEntry, assembleBenchmark, bandFor, TOTAL_CRITERIA, CRITICAL_CEILING, RED_MAX, AMBER_MAX,
};
