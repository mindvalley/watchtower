'use strict';

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ SAMPLE DATA. Every number this file produces is invented.                 │
// │                                                                           │
// │ It exists so the trend charts can be judged before the data behind them   │
// │ is real, and it is deleted the moment it is. Removing it is one script    │
// │ tag and one file — nothing else imports it, and a test asserts the page   │
// │ marks every chart drawn from it.                                          │
// └───────────────────────────────────────────────────────────────────────────┘
//
// WHY EACH CHART IS MOCKED, WHICH IS NOT THE SAME REASON:
//
//   Composite — the real series exists and is plotted-able today. It is also
//   flat for ten of eleven systems since 3 August, because nothing has been
//   done about the scores yet. A flat chart cannot show whether the chart
//   works. The LAST point of each line is the system's real current score; the
//   path leading to it is invented, so the right-hand edge agrees with the card
//   above it instead of looking like a bug.
//
//   Issues — the real series does not exist at all. scan_history keeps scores
//   and audit counts, never the per-finding list, and /ingest full-replaces the
//   findings table. Resolved and introduced cannot be computed for any date.
//   Everything in that chart is invented, including the totals.
//
// WHAT IS NOT INVENTED: the shape. The fleet, the organisations, the systems in
// each tab and the dates all come from the real payload. The page must not
// carry a list of who we measure — that is what makes it separable from our
// data — so this cannot name a system even if it wanted to, and deriving the
// structure keeps the mock honest about how many lines a real chart will have.
//
// Determinism is a requirement, not a nicety: a chart that reshuffles on every
// reload cannot be reviewed, and two people looking at it would be looking at
// different pictures. Values are seeded off the system key.

(function attachSampleTrends() {

// FNV-1a. Any stable string hash would do; this one is short and has no deps.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A deterministic value in [0,1) from a seed and an index.
function noise(seed, i) {
  const x = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const WINDOWS = {
  week: { points: 7, stepDays: 1, label: 'Week' },
  month: { points: 8, stepDays: 4, label: 'Month' },
  quarter: { points: 12, stepDays: 7, label: 'Quarter' },
};

// Evenly spaced dates ending on `endIso`, oldest first. A regular series
// because the mock is about the chart, not about our scanning cadence — the
// real one is irregular and the renderer treats points as ordinal either way.
function datesEndingAt(endIso, { points, stepDays }) {
  const end = Date.parse(`${endIso}T00:00:00Z`);
  const out = [];
  for (let i = points - 1; i >= 0; i -= 1) {
    out.push(new Date(end - i * stepDays * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// Walk BACKWARDS from the real current score, so the series ends where the card
// says it does. Movement is small and mostly downward-in-the-past, i.e. the
// invented history shows systems improving — which is the case the chart has to
// render legibly and the real data cannot currently produce.
function compositeSeries(key, currentScore, dates) {
  const seed = hash(key);
  const values = new Array(dates.length);
  values[dates.length - 1] = currentScore;
  for (let i = dates.length - 2; i >= 0; i -= 1) {
    const drift = Math.round((noise(seed, i) * 5) - 1.2);
    values[i] = Math.max(2, Math.min(100, values[i + 1] - drift));
  }
  return dates.map((date, i) => ({ date, score: values[i] }));
}

// Resolved and introduced first, total by accumulation — never the other way
// round. Deriving the parts from an invented total is how the first version of
// this produced a scan where more issues were introduced than were open, which
// is not a thing that can happen and was spotted immediately.
// Magnitudes are proportional to the total rather than fixed. The first version
// used flat counts of 4–44 against totals near 900, which is about 3% — at that
// ratio the red band is a two-pixel sliver and the New line draws on top of the
// Total line. Our largest organisation runs around 90 introduced against 1,000
// open, so the proportions here are set near that: 5–11% introduced, 6–14%
// resolved. A mock whose only job is to show whether the chart works has to be
// legible, and it has to be legible at ratios the real data will actually hit.
function issuesSeries(seedKey, systemCount, dates) {
  const seed = hash(`issues:${seedKey}`);
  const out = [];
  let total = 200 * Math.max(1, systemCount);
  for (let i = 0; i < dates.length; i += 1) {
    const introduced = Math.round(total * (0.05 + noise(seed, i) * 0.06));
    // Weighted to exceed introductions, so the invented fleet is getting
    // better — again, the case the chart must render well.
    const resolved = Math.round(total * (0.06 + noise(seed, i + 500) * 0.08));
    total = Math.max(40, total + introduced - resolved);
    out.push({
      date: dates[i], total, introduced, resolved,
    });
  }
  return out;
}

// Everything a trends section needs for one organisation, at one window.
// `systems` is [{ key, score }] taken straight off the real payload.
function sampleFor(systems, windowKey, endIso) {
  const win = WINDOWS[windowKey] || WINDOWS.month;
  const dates = datesEndingAt(endIso, win);
  const scored = systems.filter((s) => typeof s.score === 'number');
  return {
    dates,
    composite: scored.map((s) => ({ key: s.key, points: compositeSeries(s.key, s.score, dates) })),
    issues: issuesSeries(scored.map((s) => s.key).join('|'), scored.length, dates),
  };
}

const api = { sampleFor, WINDOWS, hash, noise, datesEndingAt, compositeSeries, issuesSeries };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SampleTrends = api;

}());
