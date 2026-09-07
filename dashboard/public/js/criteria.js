'use strict';

// The benchmark's criterion namespace, plus the pure readings the overview
// needs to explain a system's colour.
//
// Why it exists. The names lived in `system/scorecard.js`, which only the
// system pages load, and a second copy of the same list lives in
// `public/data/criteria-docs.json`. The overview needed them too, and a third
// copy is how the three drift apart quietly — so the list moved here, both
// pages read it, and `tests/criteria.test.js` asserts it still agrees with
// criteria-docs.json.
//
// The removed criteria (former C3 Standardised Data Models, C5 Atomic
// Operations) are simply absent, so they never render anywhere.
//
// Everything below is inside a function on purpose. Classic <script> tags all
// share one global lexical scope, so a top-level `const CRITERIA` here collides
// with the one in scorecard.js and the browser refuses to parse the second file
// — no error the page can catch, just a scorecard that renders nothing. Node
// gives every file its own scope, so no ordinary unit test can see it; the
// guard is `tests/shared-scripts.test.js`, which evaluates the served scripts
// together in one context the way a browser does.
(function attachCriteria() {

const CRITERIA = [
  { key: '1', label: 'Clear Domain Boundaries', slug: 'clear-domain-boundaries' },
  { key: '2', label: 'Documented APIs', slug: 'documented-apis' },
  { key: '4', label: 'Observable State', slug: 'observable-state' },
  { key: '6', label: 'Test Coverage', slug: 'test-coverage' },
  { key: '7', label: 'Deployment Safety', slug: 'deployment-safety' },
  { key: '8', label: 'Codebase Simplicity', slug: 'codebase-simplicity' },
  { key: '9', label: 'Security Posture', slug: 'security-posture' },
];

// One row per criterion in the namespace, scored or not. Kept at full length
// on purpose: a system assessed on 5 of 7 should show two empty slots rather
// than a shorter strip, because missing coverage is itself worth seeing.
function criterionRows(sys) {
  const crit = (sys && sys.criteria) || {};
  return CRITERIA.map(({ key, label }) => {
    const c = crit[key] || {};
    return {
      key,
      label,
      score: c.score != null ? c.score : null,
      colour: c.score != null ? (c.colour || null) : null,
      critical: c.critical === true,
    };
  });
}

// The lowest-scoring scored criterion — where a reader should look first.
// Ties resolve to the earlier criterion in namespace order, which is stable
// across scans rather than dependent on key iteration.
function weakestScored(sys) {
  const scored = criterionRows(sys).filter((r) => r.score != null);
  if (!scored.length) return null;
  return scored.reduce((a, b) => (b.score < a.score ? b : a));
}

// Why this system wears the colour it does, and where to look — two separate
// questions that the overview answered with neither.
//
// The hard cap is the whole answer to the first when it fires: the engine sets
// a system red when ANY criterion reports `critical` (assemble-benchmark.js:
// `entries.some((c) => c.critical)`), regardless of the composite. That is why
// one system at 2.7 can be red while another at 2.7 is amber. Only Security
// sets the flag today, but the rule is general — so this names whichever
// criterion actually carries it rather than hardcoding the word, and keeps
// telling the truth if another one ever does.
//
// `weakest` is reported separately and only when it is a different criterion,
// because on the current board every capped system caps on Security at the
// same 1.7 — so the cap line alone is identical on seven of eleven cards and
// says nothing about the system in front of you.
function explainColour(sys) {
  if (!sys || sys.score == null) return null;
  const weak = weakestScored(sys);
  const weakest = weak ? { label: weak.label, score: weak.score } : null;

  if (sys.hard_capped) {
    const drivers = criterionRows(sys).filter((r) => r.critical);
    // `hard_capped` is carried on the system row while `critical` sits on the
    // criteria, and a payload can arrive with the flag and no flagged criterion
    // (an older row, a partial replace). Say the true thing rather than an
    // empty name.
    if (!drivers.length) return { kind: 'cap', label: null, score: null, weakest };
    const worst = drivers.reduce((a, b) => (b.score < a.score ? b : a));
    return {
      kind: 'cap',
      label: worst.label,
      score: worst.score,
      count: drivers.length,
      // Suppressed when the cap driver is also the weakest, so the card does
      // not print the same criterion twice.
      weakest: weakest && weakest.label !== worst.label ? weakest : null,
    };
  }

  if (!weakest) return null;
  return { kind: 'weakest', label: weakest.label, score: weakest.score, weakest: null };
}

// ── The one thing to do next ────────────────────────────────────────────────

// Severity of a criterion, on the per-criterion /5 scale. The boundaries are
// the same 2.0 and 3.5 the bands have always used; nothing new is anchored here.
function severityOf(row) {
  if (row.critical) return 'critical';
  if (row.score <= 2.0) return 'high';
  if (row.score <= 3.5) return 'medium';
  return 'low';
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// The engine writes remedial actions as prose, and prose is right for the
// detail page — it has room to say why. A card does not, and an action that
// needs explaining on a card has already failed. So the card takes the first
// clause and drops the rest.
//
// Parentheticals are deliberately KEPT. An earlier version stripped them on the
// grounds that "(semgrep)" and "(trivy)" name a tool the criterion already
// names — but no rule separates those from "(frontend)" and "(backend)", which
// are the entire difference between two otherwise identical actions, or from
// the "(s)" in "secret(s)", which stops the card saying "the secret" when there
// are fifteen. A couple of actions wrap to two lines instead. That is the
// cheaper mistake.
//
// The full string is kept alongside so the card can carry it as a title and the
// detail page can render it whole. Nothing is lost, only deferred.
function imperative(text) {
  return String(text == null ? '' : text)
    .split(/\s+—\s+|;\s+|\.\s+/)[0]
    .replace(/[.,]+$/, '')
    .trim();
}

// The single action a card should show: worst severity band first, then lowest
// score inside the band. Ranked by band rather than by predicted score movement
// — Lighthouse's own documentation says estimated savings overlap and cannot be
// summed, so a "+9 composite" per row would invite exactly the addition it does
// not support. OpenSSF Scorecard ranks by band for the same reason.
//
// Green criteria are excluded. A system with nothing above green gets no action
// line at all, which is the honest output: there is no next thing to do.
//
// CAVEAT worth knowing before trusting this. Within a criterion it takes the
// FIRST action, and nothing links an action string to the sub-metric that
// earned it. Today that is right by construction — every capped system on the
// board caps on secrets, and the secrets action is written first — but it is a
// property of the current data, not a guarantee. tests/criteria.test.js asserts
// it on the real board so the day it stops holding is a failing test rather
// than a card quietly recommending the wrong fix.
function topAction(sys) {
  const criteria = (sys && sys.criteria) || {};
  const candidates = criterionRows(sys)
    .filter((r) => r.score != null)
    .map((r) => ({ ...r, severity: severityOf(r), actions: (criteria[r.key] || {}).actions || [] }))
    .filter((r) => r.severity !== 'low' && r.actions.length);
  if (!candidates.length) return null;

  candidates.sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.score - b.score
  ));
  const top = candidates[0];
  return {
    key: top.key,
    label: top.label,
    severity: top.severity,
    action: imperative(top.actions[0]),
    full: top.actions[0],
  };
}

// Node (tests) imports the pure pieces; the browser loads this as a plain
// <script> and reads them off window. Guarded so each is a no-op in the other.
const api = {
  CRITERIA, criterionRows, weakestScored, explainColour, severityOf, imperative, topAction,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.Criteria = api;

}());
