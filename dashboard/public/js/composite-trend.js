'use strict';

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ The composite trend chart's MODEL. Real data, no DOM.                      │
// │                                                                           │
// │ This is the pure half of the chart: it takes the fleet's real scan        │
// │ history and a view (range + which systems are hidden) and returns the      │
// │ geometry to draw — scaled points, regular axis ticks, band guide-lines.   │
// │ index.html owns the SVG and the wiring; everything here is unit-tested     │
// │ against a fixture built from production scan_history, because the render   │
// │ itself lives in an IIFE no test can reach.                                 │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Two properties are load-bearing and each has a test:
//   - Points sit at their TRUE time position; the axis ticks are REGULAR,
//     evenly-spaced dates. Real positions, standard labels.
//   - A system keeps its colour whether shown or hidden — the colour is indexed
//     by the system's declared position, never by visible order, so toggling one
//     line off does not recolour the rest.

(function attachCompositeTrend() {

const DAY = 86400000;

// The line palette. Owned here so the legend (in index.html) reads each series'
// colour off the model rather than keeping a second copy that could drift.
const SERIES_COLOURS = [
  '#58a6ff', '#bc8cff', '#39c5cf', '#f778ba', '#d9a05b',
  '#7ee787', '#ffa198', '#a5d6ff',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A date-only ISO string ("YYYY-MM-DD") as a UTC epoch. The whole chart works in
// whole days; scan timestamps carry a time but the series is one point per day.
function dayMs(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fmtTick(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// One reading per calendar day: the LATEST. The fleet re-scans within a day (two
// osiris rows on 2026-09-21, the 08-20/08-21 migration pair, the July onboarding
// bursts), and a day with two dots is noise, not signal. Points arrive oldest
// first, so the last write for a date is the latest; a final sort guarantees it.
function latestPerDay(points) {
  const byDay = new Map();
  for (const p of points) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Resolve a range selector to a clamped [t0, t1] window in epoch ms.
// `range` is '7d' | '30d' | '90d' | { from, to }. The presets end at the latest
// real reading rather than "today", so a fleet that stopped being scanned shows
// its last window instead of a flat tail. Everything is clamped to
// [floor, latest]; a custom window that ends before it starts is rejected.
function resolveDomain(range, floorIso, latestIso) {
  const floor = dayMs(floorIso);
  const latest = dayMs(latestIso);
  let t0;
  let t1;
  if (range && typeof range === 'object') {
    t0 = range.from ? dayMs(range.from) : floor;
    t1 = range.to ? dayMs(range.to) : latest;
  } else {
    const days = { '7d': 7, '30d': 30, '90d': 90 }[range] ?? 30;
    t1 = latest;
    t0 = latest - days * DAY;
  }
  t0 = Math.max(t0, floor);
  t1 = Math.min(t1, latest);
  if (t1 < t0) return null;
  return { t0, t1 };
}

// Regular ticks: `count` dates evenly dividing [t0, t1], as x positions with
// labels. These are COMPUTED dates, not data dates — that is the point, so the
// axis reads cleanly whatever the scan cadence was. A window narrower than the
// tick count produces repeated day labels, so identical consecutive labels are
// collapsed (keeping the first position).
function regularTicks(t0, t1, xOf, count) {
  const span = Math.max(1, t1 - t0);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = t0 + (span * i) / (count - 1);
    const label = fmtTick(t);
    if (out.length && out[out.length - 1].label === label) continue;
    out.push({ x: xOf(t), label });
  }
  return out;
}

// The whole model for one chart. `history` is the /data/history.json shape
// ({ systems: { key: { points: [{date, score, ...}] } } }); `keys` is the
// systems for this org tab, in declared order (which fixes the colours).
function buildTrendModel(history, {
  keys, range = '30d', hidden = [], floor, box, bands = [], tickCount = 5,
}) {
  const hiddenSet = new Set(hidden);
  const systems = (history && history.systems) || {};

  // Deduped, floored points per system, and the latest reading anywhere.
  const perKey = {};
  let latestIso = null;
  for (const key of keys) {
    const entry = systems[key];
    const pts = entry ? latestPerDay(entry.points || []).filter((p) => p.date >= floor) : [];
    perKey[key] = pts;
    for (const p of pts) if (!latestIso || p.date > latestIso) latestIso = p.date;
  }
  const emptyModel = { series: [], ticks: [], bands: [], domain: null, empty: true };
  if (!latestIso) return emptyModel;

  const domain = resolveDomain(range, floor, latestIso);
  if (!domain) return emptyModel;
  const { t0, t1 } = domain;
  const span = Math.max(1, t1 - t0);
  const plotW = box.right - box.left;
  const xOf = (ms) => box.left + ((ms - t0) / span) * plotW;
  const yOf = (v) => box.bottom - (v / 100) * (box.bottom - box.top);

  // Colour indexed by DECLARED position, so a hidden system keeps its slot and
  // the visible ones do not shuffle colour when one is toggled off.
  const series = keys.map((key, i) => {
    const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
    const isHidden = hiddenSet.has(key);
    const inRange = perKey[key].filter((p) => {
      const t = dayMs(p.date);
      return t >= t0 && t <= t1;
    });
    return {
      key,
      colour,
      hidden: isHidden,
      points: isHidden ? [] : inRange.map((p) => ({
        x: xOf(p.date === undefined ? t0 : dayMs(p.date)),
        y: yOf(p.score),
        date: p.date,
        score: p.score,
      })),
    };
  });

  const ticks = regularTicks(t0, t1, xOf, tickCount);
  const bandLines = bands.map((b) => ({ y: yOf(b.value), colour: b.colour }));
  const empty = !series.some((s) => !s.hidden && s.points.length);
  return { series, ticks, bands: bandLines, domain, empty };
}

const api = {
  buildTrendModel, latestPerDay, resolveDomain, regularTicks, SERIES_COLOURS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.CompositeTrend = api;

}());
