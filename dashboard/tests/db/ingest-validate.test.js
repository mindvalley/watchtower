'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { validatePayload, payloadToRows, MAX_ITEM_BYTES } = require('../../db/ingest');

const known = new Set(['2', '6', '8']);
const good = {
  system_key: 'alpha',
  scanned_at: '2026-07-23',
  generated_at: '2026-07-23',
  // 50, not 2.5: the composite is out of 100 and must agree with the criteria
  // beside it. mean(4, 1) = 2.5 out of 5, which is 50 out of 100, which is amber.
  score: 50,
  colour: 'amber',
  hard_capped: false,
  coverage: '2 of 7 assessed',
  criteria: { '2': { score: 4 }, '6': { score: 1 } },
  findings: { '2': { groups: [] } },
};

test('accepts a well-formed payload', () => {
  assert.deepStrictEqual(validatePayload(good, { knownCriteria: known }), { ok: true });
});

test('rejects a non-object body', () => {
  assert.strictEqual(validatePayload(null, { knownCriteria: known }).ok, false);
  assert.strictEqual(validatePayload([], { knownCriteria: known }).ok, false);
});

test('rejects bad dates', () => {
  assert.strictEqual(validatePayload({ ...good, scanned_at: '2026-13-45' }, { knownCriteria: known }).ok, false);
  assert.strictEqual(validatePayload({ ...good, generated_at: 'yesterday' }, { knownCriteria: known }).ok, false);
});

test('rejects unknown criterion ids in criteria or findings', () => {
  assert.strictEqual(validatePayload({ ...good, criteria: { '99': {} } }, { knownCriteria: known }).ok, false);
  assert.strictEqual(validatePayload({ ...good, findings: { '99': {} } }, { knownCriteria: known }).ok, false);
});

test('rejects non-object criteria/findings containers and items', () => {
  assert.strictEqual(validatePayload({ ...good, criteria: [] }, { knownCriteria: known }).ok, false);
  assert.strictEqual(validatePayload({ ...good, criteria: { '2': 5 } }, { knownCriteria: known }).ok, false);
});

test('rejects an oversized criterion item', () => {
  const big = { blob: 'x'.repeat(MAX_ITEM_BYTES + 1) };
  assert.strictEqual(validatePayload({ ...good, criteria: { '2': big } }, { knownCriteria: known }).ok, false);
});

test('payloadToRows maps to replaceSystem shape with system identity + dates', () => {
  const entry = { system_key: 'bravo', repo: 'org/bravo', stack: 'typescript', sast_tool: 'semgrep' };
  const rows = payloadToRows(entry, good);
  assert.deepStrictEqual(rows.system, {
    ...entry,
    score: 50,
    colour: 'amber',
    hard_capped: false,
    coverage: '2 of 7 assessed',
    assessed_at: '2026-07-23',
  });
  assert.deepStrictEqual(rows.criteria.map((c) => c.criterion_id).sort(), ['2', '6']);
  assert.strictEqual(rows.criteria[0].scanned_at, '2026-07-23');
  assert.deepStrictEqual(rows.findings.map((f) => f.criterion_id), ['2']);
  assert.strictEqual(rows.findings[0].generated_at, '2026-07-23');
});

test('rejects a body that names no system', () => {
  // The allowlist needs a system name to decide anything; without one there is
  // no question to answer, so this is a malformed request rather than a refusal.
  const { system_key, ...noKey } = good;
  const r = validatePayload(noKey, { knownCriteria: known });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /system_key/);
  for (const bad of ['', 42, null, {}]) {
    assert.strictEqual(validatePayload({ ...good, system_key: bad }, { knownCriteria: known }).ok, false);
  }
});

// --- the composite ---------------------------------------------------------

test('rejects a payload with no composite at all', () => {
  // The shape an older engine would send. /ingest full-replaces, so accepting it
  // would store nulls and blank the system's score on the board behind a 200 —
  // the same failure as an empty criteria map, which is already refused.
  const { score, colour, hard_capped, coverage, ...noComposite } = good;
  const r = validatePayload(noComposite, { knownCriteria: known });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /score|hard_capped|coverage/);
});

test('rejects each composite field being the wrong type', () => {
  const bad = (patch) => validatePayload({ ...good, ...patch }, { knownCriteria: known }).ok;
  assert.strictEqual(bad({ score: '2.5' }), false, 'a numeric string is not a score');
  assert.strictEqual(bad({ score: NaN }), false);
  assert.strictEqual(bad({ score: 700 }), false, 'outside the 0–100 scale');
  assert.strictEqual(bad({ score: 50.5 }), false, 'a fractional score is the old /5 scale');
  assert.strictEqual(bad({ colour: '' }), false);
  assert.strictEqual(bad({ hard_capped: 'false' }), false, 'the string "false" is truthy');
  assert.strictEqual(bad({ coverage: '' }), false);
});

test('accepts an unscored system — null score with null colour', () => {
  // A system whose criteria are all pending has no composite, and that is a real
  // state rather than a broken payload. Its CRITERIA have to be unscored too:
  // this fixture used to send a null composite alongside criteria that scored,
  // which is the silent-erasure shape rather than an unscored system.
  const unscored = {
    ...good, score: null, colour: null, criteria: { 2: { score: null }, 6: { score: null } },
  };
  assert.deepStrictEqual(validatePayload(unscored, { knownCriteria: known }), { ok: true });
});

// --- the composite must agree with the criteria it arrives with -------------

test('rejects a composite that disagrees with its own criteria', () => {
  // A range check cannot tell the scales apart where it matters: an engine on
  // the old rule sends 3 for a system the new rule scores 60, and 3 is a
  // perfectly valid /100 score. It would be stored and rendered as a
  // catastrophic red ring with nothing to show anything had gone wrong.
  const r = validatePayload({ ...good, score: 3, colour: 'red' }, { knownCriteria: known });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /disagrees with its own criteria/);
  assert.match(r.reason, /50/, 'the reason must say what the criteria actually give');
});

test('rejects a colour that is not the band of its score', () => {
  const r = validatePayload({ ...good, colour: 'green' }, { knownCriteria: known });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not the band of score/);
});

test('rejects a null composite sent alongside criteria that score', () => {
  // Silent erasure, the same class as an empty criteria map: /ingest
  // full-replaces, so this blanks a scored system behind a 200.
  const r = validatePayload(
    { ...good, score: null, colour: null }, { knownCriteria: known },
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /refusing to blank a scored system/);
});

test('the Critical cap has to be inside the number the payload sends', () => {
  // A capped system whose composite was not scaled is the old rule exactly:
  // 4.0 and 1.0 average to 2.5, which is 50 — but with a Critical the answer is
  // 20, and the badge cannot be red at 50.
  const capped = {
    ...good,
    criteria: { 2: { score: 4 }, 6: { score: 1, critical: true } },
    hard_capped: true,
  };
  assert.strictEqual(validatePayload({ ...capped, score: 50, colour: 'red' }, { knownCriteria: known }).ok, false);
  assert.deepStrictEqual(
    validatePayload({ ...capped, score: 20, colour: 'red' }, { knownCriteria: known }), { ok: true },
  );
});

test('a Critical on an unscored criterion does not cap, here or in the engine', () => {
  // The engine filters to scored entries BEFORE testing for Critical. If this
  // did not, it would reject valid payloads from a correct scan.
  const body = {
    ...good,
    criteria: { 2: { score: 4 }, 6: { score: 1 }, 8: { score: null, critical: true } },
  };
  assert.deepStrictEqual(validatePayload(body, { knownCriteria: known }), { ok: true });
});

test('rejects a score without a colour, or a colour without a score', () => {
  // They are derived from each other, so one without the other means the
  // producer is broken rather than the system unscored.
  assert.strictEqual(validatePayload({ ...good, colour: null }, { knownCriteria: known }).ok, false);
  assert.strictEqual(validatePayload({ ...good, score: null }, { knownCriteria: known }).ok, false);
});
