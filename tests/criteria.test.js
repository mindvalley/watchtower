'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  CRITERIA, criterionRows, weakestScored, explainColour, severityOf, imperative, topAction,
} = require('../public/js/criteria.js');

const DATA = path.join(__dirname, '..', 'public', 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

// A system entry shaped like benchmark.json's, with only the fields these
// readings touch.
function sys(criteria, extra = {}) {
  return { score: 3.0, colour: 'amber', hard_capped: false, criteria, ...extra };
}

// --- the namespace itself ---------------------------------------------------

// The names were duplicated between scorecard.js and criteria-docs.json and
// agreed by luck. They are now declared once; this is what keeps them agreeing
// with the docs the /criteria pages render from.
test('the criterion list matches criteria-docs.json exactly', () => {
  const docs = readJson('criteria-docs.json').criteria || [];
  const expected = docs.map((c) => ({ key: c.id, label: c.name, slug: c.slug }));
  assert.deepStrictEqual(CRITERIA, expected);
});

test('scorecard.js reads the shared list rather than its own copy', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'system', 'scorecard.js'), 'utf8',
  );
  assert.match(src, /require\('\.\.\/js\/criteria\.js'\)/);
  assert.ok(
    !/\{\s*key:\s*'1',\s*label:\s*'Clear Domain Boundaries'\s*\}/.test(src),
    'scorecard.js still declares its own criterion list',
  );
});

// --- criterionRows ----------------------------------------------------------

test('every criterion gets a row, scored or not', () => {
  const rows = criterionRows(sys({ 9: { score: 1.0, colour: 'red', critical: true } }));
  assert.strictEqual(rows.length, CRITERIA.length);
  const c9 = rows.find((r) => r.key === '9');
  assert.deepStrictEqual(
    { score: c9.score, colour: c9.colour, critical: c9.critical },
    { score: 1.0, colour: 'red', critical: true },
  );
  // Unscored criteria keep their slot with no colour, so the strip shows the
  // coverage gap instead of silently shortening.
  const c1 = rows.find((r) => r.key === '1');
  assert.deepStrictEqual({ score: c1.score, colour: c1.colour }, { score: null, colour: null });
});

test('a criterion with a colour but no score does not count as scored', () => {
  // The engine emits withheld metrics as score:null with the colour dropped;
  // treating a stray colour as a score would grade something deliberately
  // withheld.
  const rows = criterionRows(sys({ 1: { score: null, colour: 'green' } }));
  const c1 = rows.find((r) => r.key === '1');
  assert.strictEqual(c1.score, null);
  assert.strictEqual(c1.colour, null);
});

// --- explainColour ----------------------------------------------------------

test('an uncapped system is explained by its weakest scored criterion', () => {
  const why = explainColour(sys({
    1: { score: 4.2, colour: 'green' },
    8: { score: 2.2, colour: 'amber' },
    9: { score: 3.0, colour: 'amber' },
  }));
  assert.deepStrictEqual(why, {
    kind: 'weakest', label: 'Codebase Simplicity', score: 2.2, weakest: null,
  });
});

test('a capped system names the criterion that actually carries the flag', () => {
  const why = explainColour(sys({
    1: { score: 0.5, colour: 'red' },
    9: { score: 1.0, colour: 'red', critical: true },
  }, { hard_capped: true, colour: 'red' }));
  // C1 scores lower, but it is not what capped the system — the cap is the
  // whole explanation for the colour, so it must not be reported as C1.
  assert.strictEqual(why.kind, 'cap');
  assert.strictEqual(why.label, 'Security Posture');
  assert.strictEqual(why.score, 1.0);
});

test('the cap is not hardcoded to Security — any critical criterion drives it', () => {
  // assemble-benchmark.js caps on `entries.some((c) => c.critical)`, not on the
  // criterion's identity. Only Security sets it today; this is what stops the
  // card lying if another one ever does.
  const why = explainColour(sys({
    6: { score: 0.8, colour: 'red', critical: true },
  }, { hard_capped: true, colour: 'red' }));
  assert.strictEqual(why.label, 'Test Coverage');
});

test('two critical criteria report the worse one and say there are more', () => {
  const why = explainColour(sys({
    6: { score: 2.0, colour: 'red', critical: true },
    9: { score: 0.0, colour: 'red', critical: true },
  }, { hard_capped: true, colour: 'red' }));
  assert.strictEqual(why.label, 'Security Posture');
  assert.strictEqual(why.count, 2);
});

test('a capped system with no flagged criterion says so rather than naming nothing', () => {
  // The flag rides on the system row and `critical` on the criteria, so a
  // partial or older payload can carry one without the other.
  const why = explainColour(sys({ 1: { score: 4.0, colour: 'green' } },
    { hard_capped: true, colour: 'red' }));
  // The weakest still reports, so the card is not left blank by the gap.
  assert.deepStrictEqual(why, {
    kind: 'cap',
    label: null,
    score: null,
    weakest: { label: 'Clear Domain Boundaries', score: 4.0 },
  });
});

test('an unscored system has nothing to explain', () => {
  assert.strictEqual(explainColour(sys({}, { score: null, colour: null })), null);
  assert.strictEqual(explainColour(null), null);
});

// --- against the real board -------------------------------------------------

// The readings above run on hand-built entries. This one runs on every system
// actually on the board, because the committed data is the only place the real
// shapes appear together.
test('a capped system also reports its weakest criterion when it is a different one', () => {
  const why = explainColour(sys({
    4: { score: 0.0, colour: 'red' },
    9: { score: 1.7, colour: 'red', critical: true },
  }, { hard_capped: true, colour: 'red' }));
  assert.strictEqual(why.label, 'Security Posture');
  assert.deepStrictEqual(why.weakest, { label: 'Observable State', score: 0.0 });
});

test('the weakest is suppressed when it IS the cap driver, so the card says it once', () => {
  const why = explainColour(sys({
    1: { score: 4.2, colour: 'green' },
    9: { score: 1.7, colour: 'red', critical: true },
  }, { hard_capped: true, colour: 'red' }));
  assert.strictEqual(why.label, 'Security Posture');
  assert.strictEqual(why.weakest, null);
});

test('an uncapped system carries no second reading — the weakest IS the reading', () => {
  const why = explainColour(sys({ 8: { score: 2.2, colour: 'amber' } }));
  assert.strictEqual(why.kind, 'weakest');
  assert.strictEqual(why.weakest, null);
});

test('weakestScored breaks ties on namespace order, not key iteration order', () => {
  const why = weakestScored(sys({
    9: { score: 1.0, colour: 'red' },
    2: { score: 1.0, colour: 'red' },
  }));
  // Both score 1.0; C2 comes first in CRITERIA, so it wins regardless of the
  // order the keys happen to arrive in.
  assert.strictEqual(why.label, 'Documented APIs');
});

test('severity uses the same 2.0 / 3.5 boundaries the bands always have', () => {
  assert.strictEqual(severityOf({ score: 5.0, critical: true }), 'critical');
  assert.strictEqual(severityOf({ score: 0.0, critical: false }), 'high');
  assert.strictEqual(severityOf({ score: 2.0, critical: false }), 'high');
  assert.strictEqual(severityOf({ score: 2.1, critical: false }), 'medium');
  assert.strictEqual(severityOf({ score: 3.5, critical: false }), 'medium');
  assert.strictEqual(severityOf({ score: 3.6, critical: false }), 'low');
});

test('imperative keeps the instruction and drops everything that explains it', () => {
  // The engine writes prose because the detail page has room for it. A card
  // does not, and an action that needs explaining on a card has already failed.
  assert.strictEqual(
    imperative('Remove the exposed secret(s) and rotate the credentials; add a pre-commit gitleaks hook.'),
    'Remove the exposed secret(s) and rotate the credentials',
  );
  assert.strictEqual(
    imperative('Add descriptions to public GraphQL fields — an agent reads names and types via introspection but relies on descriptions to use the API correctly. 395 fields undescribed.'),
    'Add descriptions to public GraphQL fields',
  );
  assert.strictEqual(
    imperative('Triage and fix the high-severity SAST findings (semgrep); add the rules to CI.'),
    'Triage and fix the high-severity SAST findings (semgrep)',
  );
  // Parentheticals stay. Stripping them read well until it turned "secret(s)"
  // into "secret" on a system with fifteen of them, and collapsed "Adopt error
  // tracking (frontend)" and "(backend)" into the same sentence.
  assert.strictEqual(
    imperative('Adopt error tracking (frontend)'), 'Adopt error tracking (frontend)',
  );
  assert.notStrictEqual(
    imperative('Adopt error tracking (frontend)'), imperative('Adopt error tracking (backend)'),
  );
  // A decimal inside a sentence must not be read as a sentence end.
  assert.strictEqual(imperative('Raise coverage above 60.5% before the next release'),
    'Raise coverage above 60.5% before the next release');
  assert.strictEqual(imperative(null), '');
});

test('the action is chosen by severity band, then by score inside the band', () => {
  const s = sys({
    2: { score: 1.0, colour: 'red', actions: ['Describe the API'] },
    8: { score: 0.5, colour: 'red', actions: ['Cut the duplication'] },
    9: { score: 3.0, colour: 'amber', critical: true, actions: ['Remove the key'] },
  });
  const a = topAction(s);
  // Critical outranks a lower score in a lower band — a 3.0 with a Critical
  // beats a 0.5 without one, because the cap is the disqualifier.
  assert.strictEqual(a.label, 'Security Posture');
  assert.strictEqual(a.severity, 'critical');
  assert.strictEqual(a.action, 'Remove the key');

  // With no Critical, the worst band wins and ties inside it break by score.
  const b = topAction(sys({
    2: { score: 1.0, colour: 'red', actions: ['Describe the API'] },
    8: { score: 0.5, colour: 'red', actions: ['Cut the duplication'] },
  }));
  assert.strictEqual(b.label, 'Codebase Simplicity');
});

test('a system with nothing above green offers no action at all', () => {
  // The honest output when there is no next thing to do. Rendering an empty
  // bordered strip instead would read as a card that failed to load.
  assert.strictEqual(topAction(sys({
    2: { score: 4.0, colour: 'green', actions: ['Describe the API'] },
    9: { score: 5.0, colour: 'green', actions: [] },
  })), null);
});

test('a criterion that scores badly but carries no action is skipped, not shown empty', () => {
  const a = topAction(sys({
    2: { score: 0.5, colour: 'red' },
    8: { score: 3.0, colour: 'amber', actions: ['Cut the duplication'] },
  }));
  assert.strictEqual(a.label, 'Codebase Simplicity');
});

test('the full action is carried alongside the trimmed one, so nothing is lost', () => {
  const full = 'Remove the exposed secret(s) and rotate the credentials; add a pre-commit gitleaks hook.';
  const a = topAction(sys({ 9: { score: 1.7, colour: 'red', critical: true, actions: [full] } }));
  assert.strictEqual(a.full, full);
  assert.notStrictEqual(a.action, full);
});

