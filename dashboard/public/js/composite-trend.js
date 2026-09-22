'use strict';

// Pure model for the composite trend chart: real scan history + a view (range,
// hidden systems) in, chart geometry out. index.html owns the SVG and wiring.

(function attachCompositeTrend() {

const DAY = 86400000;

const SERIES_COLOURS = [
  '#58a6ff', '#bc8cff', '#39c5cf', '#f778ba', '#d9a05b',
  '#7ee787', '#ffa198', '#a5d6ff',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayMs(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fmtTick(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Latest reading per calendar day. Points arrive oldest first, so the last
// write per date wins; the sort restores order.
function latestPerDay(points) {
  const byDay = new Map();
  for (const p of points) byDay.set(p.date, p);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// range: '7d' | '30d' | '90d' | { from, to }. Presets end at the latest reading,
// not today. Clamped to [floor, latest]; an inverted window returns null.
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

// `count` evenly-spaced ticks across [t0, t1]. Repeated labels (narrow windows)
// are dropped.
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

function buildTrendModel(history, {
  keys, range = '30d', hidden = [], floor, box, bands = [], tickCount = 5,
}) {
  const hiddenSet = new Set(hidden);
  const systems = (history && history.systems) || {};

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

  // Colour is indexed by declared position, so hiding one system does not
  // recolour the rest.
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
        x: xOf(dayMs(p.date)),
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
