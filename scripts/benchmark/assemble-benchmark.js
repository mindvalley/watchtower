'use strict';

// Pure scorecard assembly: per-system criteria -> composite + coverage + hard-cap,
// then the full benchmark.json contract. Composite is the mean of SCORED criteria
// only (Planned/absent excluded); the coverage denominator is the fixed namespace.

const { round1, colourFor } = require('./score-security');

// The benchmark namespace after removing the two dropped criteria (former C3, C5).
// Coverage is "N of TOTAL_CRITERIA assessed".
const TOTAL_CRITERIA = 7;

function buildSystemEntry({ criteria, assessedAt }) {
  const entries = Object.values(criteria).filter((c) => c && c.score != null);
  const scoredCount = entries.length;
  const composite = scoredCount
    ? round1(entries.reduce((s, c) => s + c.score, 0) / scoredCount)
    : null;
  const hardCapped = entries.some((c) => c.critical);
  const colour = composite == null ? null : (hardCapped ? 'red' : colourFor(composite));
  return {
    score: composite,
    colour,
    hard_capped: hardCapped,
    coverage: `${scoredCount} of ${TOTAL_CRITERIA} assessed`,
    assessed_at: assessedAt,
    criteria,
  };
}

function assembleBenchmark({ systems, lastUpdated }) {
  return { last_updated: lastUpdated, example: false, systems };
}

module.exports = { buildSystemEntry, assembleBenchmark, TOTAL_CRITERIA };
