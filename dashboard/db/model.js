'use strict';

// Pure transforms between the stored flat-row model and the dashboard's JSON
// contracts.
//
// This file used to require the engine's assembler and recompute each system's
// composite, colour and coverage on every request. It no longer computes
// anything: those values are produced once by the scan that measured them,
// stored, and read back verbatim.
//
// Two reasons that matters. Deriving a score at read time put scoring rules
// inside the web service, so the engine could not be extracted without the
// website following it into a public repo. And a number the page calculates is
// a number no scan ever produced — if the two definitions ever drifted, the
// board would be wrong with nothing failing.

// `filesToRows` used to live here: committed JSON in, storage rows out. It was
// the boot seed's transform, the boot seed was deleted on 2026-09-03, and
// nothing else ever called it.

// Flat rows -> benchmark.json. A projection: every value here was written by a
// scan. Nothing is computed.
function rowsToBenchmark({ systems, criteria }, { lastUpdated }) {
  const critBySystem = {};
  for (const c of criteria) {
    (critBySystem[c.system_key] ??= {})[c.criterion_id] = c.payload;
  }
  const out = {};
  for (const s of systems) {
    out[s.system_key] = {
      // The owning organisation, so the overview can group and tab by it
      // without a hardcoded list of who we measure. It was already stored and
      // dropped here; the page carried its own copy of the whole fleet instead.
      //
      // The org, NOT the repo. Org names are already on the page as group
      // headings; the repo path is the thing the public/private line actually
      // protects, and no view needs it.
      org: orgOf(s.repo),
      stack: s.stack ?? null,
      score: s.score ?? null,
      colour: s.colour ?? null,
      hard_capped: s.hard_capped ?? null,
      coverage: s.coverage ?? null,
      assessed_at: s.assessed_at ?? null,
      criteria: critBySystem[s.system_key] || {},
    };
  }
  // `example` says the whole board is invented. It was hardcoded false here,
  // which meant the overview's "example data" notice — markup, styling and all
  // — could never fire, so a demo board looked exactly like a real one. It now
  // comes from the rows: any system flagged invented makes the board invented,
  // because a board that mixes the two is the worst of the three states.
  return { last_updated: lastUpdated, example: systems.some((s) => s.example === true), systems: out };
}

// "some-org/some-repo" -> "some-org". Null when the repo is unset rather
// than guessing: a system with no owner should read as ungrouped, not get
// filed under an organisation nobody recorded.
function orgOf(repo) {
  if (typeof repo !== 'string') return null;
  const owner = repo.split('/')[0].trim();
  return owner || null;
}

// Flat rows -> a single system's findings envelope.
function rowsToFindings({ findings }, systemKey, { generatedAt }) {
  const criteria = {};
  for (const f of findings) {
    if (f.system_key === systemKey) criteria[f.criterion_id] = f.payload;
  }
  return { system: systemKey, generated_at: generatedAt, criteria };
}

const WEEK_MS = 7 * 86400000;

// How far a system has moved across the readings in the window.
//
// This is arithmetic over two published facts, not a score — no scan produces a
// delta, so there is no definition here that could drift away from the engine's.
// It lives in the pure model rather than in page JS so the three honest-answer
// cases below are pinned by tests instead of being re-derived in a template.
//
// Returns null rather than 0.0 when there is nothing to compare. A single
// reading is a position, not a movement, and rendering it as "+0.0" would tell
// a reader the system held steady when the truth is that we have measured it
// once. Same reasoning as an unscored criterion reading as absent rather than
// as zero.
//
// Baseline: the newest reading at least a week older than the latest. `days`
// is reported because it is rarely exactly seven, and the caller has to be able
// to say which it got rather than claim a week over a three-week gap. `from` is
// always a real reading, never the window's start.
function movementOf(points) {
  const scored = points.filter((p) => typeof p.score === 'number');
  if (scored.length < 2) return null;
  const last = scored[scored.length - 1];
  const cutoff = Date.parse(last.date) - WEEK_MS;

  // Falling back to the oldest covers a system whose readings are all inside
  // the week.
  const older = scored.filter((p) => Date.parse(p.date) <= cutoff);
  const first = older.length ? older[older.length - 1] : scored[0];
  if (first === last) return null;

  return {
    from: first.date,
    to: last.date,
    from_score: first.score,
    to_score: last.score,
    // Rounded because binary floating point makes 3.6 - 3.4 read as
    // 0.19999999999999996, and a board that prints that has lost the reader.
    // One decimal place is the precision scores are published and displayed at.
    delta: Math.round((last.score - first.score) * 10) / 10,
    days: Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400000),
    readings: scored.length,
  };
}

// Flat history rows -> the overview's trend contract.
//
// Rows arrive already grouped and ordered by the query (system_key, then time,
// then id); this preserves that order rather than re-sorting, so there is one
// place that decides what "oldest first" means.
//
// A system with no rows in the window is ABSENT from `systems`, not present
// with an empty list. Absent reads as "nothing recorded here"; an empty list
// invites a page to render a flat line at zero.
function rowsToHistory(rows, { since }) {
  const points = {};
  for (const r of rows) {
    (points[r.system_key] ??= []).push({
      date: r.scanned_at,
      score: r.score ?? null,
      colour: r.colour ?? null,
      capped: r.hard_capped ?? null,
    });
  }

  const systems = {};
  for (const [key, list] of Object.entries(points)) {
    systems[key] = { points: list, movement: movementOf(list) };
  }
  return { since: since ?? null, systems };
}

module.exports = { rowsToBenchmark, rowsToFindings, rowsToHistory };
