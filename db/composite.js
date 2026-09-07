'use strict';

// The composite rule, as this service understands it.
//
// It lives in the ENGINE — `scripts/benchmark/assemble-benchmark.js`,
// `buildSystemEntry`. This is not a second definition competing with it and
// must never be used to produce a score. It exists to VERIFY one, in exactly
// two places:
//
//   1. /ingest, which checks that the composite a scan sends agrees with the
//      criteria it sent alongside it.
//   2. scripts/recompute-composite.js, the one-off that re-ruled stored rows.
//
// The distinction matters, and the engine states the other half of it at the
// point where the payload is built: "a score recomputed by the reader is a
// score no scan produced, and if the two definitions ever drifted nothing would
// fail." Rebuilding the number would break the first clause. Refusing a number
// that disagrees with its own criteria satisfies the second. So the scan's
// value is always what gets stored — this only decides whether to store it at
// all.
//
// WHEN THE ENGINE'S RULE CHANGES, THIS MUST CHANGE IN THE SAME RELEASE, and
// this service must be deployed before the engine's tag moves. Otherwise every
// publish in the fleet is rejected at once. That is the intended failure — loud
// and total rather than quiet and wrong — but it is only survivable if the
// order is known, so it is written here.

// Scaling, not clamping, so ordering survives among capped systems.
const CRITICAL_CEILING = 0.4;
const RED_MAX = 40;
const AMBER_MAX = 70;

function bandFor(score) {
  if (score <= RED_MAX) return 'red';
  if (score <= AMBER_MAX) return 'amber';
  return 'green';
}

// `criteria` is the stored/published map: criterion id -> { score, critical }.
// Unscored criteria are excluded from the mean AND from the Critical test,
// because that is what the engine does — a criterion with no score carries no
// finding. Getting that wrong here would reject perfectly good payloads.
function compositeOf(criteria) {
  const scored = Object.values(criteria || {}).filter((c) => c && c.score != null);
  if (!scored.length) return { score: null, colour: null };
  const mean = scored.reduce((s, c) => s + c.score, 0) / scored.length;
  const critical = scored.some((c) => c.critical);
  const score = Math.round(mean * 20 * (critical ? CRITICAL_CEILING : 1));
  return { score, colour: bandFor(score) };
}

module.exports = {
  compositeOf, bandFor, CRITICAL_CEILING, RED_MAX, AMBER_MAX,
};
