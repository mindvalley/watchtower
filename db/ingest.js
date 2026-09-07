'use strict';

// Envelope-strict, contents-opaque payload validation + row transform.
// (handleIngest/audit are added in a later task.)

// The one exception to contents-opaque: the composite is checked against the
// criteria it arrives with. See validateCompositeAgreesWithCriteria for why an
// envelope check alone cannot tell the old /5 scale from the new /100 one.
const { compositeOf } = require('./composite');

// Per-criterion cap. Measured against the committed data rather than chosen:
// the largest single findings payload in a real fleet of eleven was 809KB, so
// the original 64KB would have refused 8 of those 11 the first time anything
// real was posted. 2MB leaves roughly 2.5x headroom on the worst case.
//
// This is a narrower bound than the body limit on purpose. It exists to stop
// one pathological criterion — a scanner that emits a location per line, say —
// from dominating a request, and it names the offending criterion when it
// trips, which the body limit cannot do.
const MAX_ITEM_BYTES = 2 * 1024 * 1024;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validateMap(map, label, knownCriteria) {
  if (!isPlainObject(map)) return `${label} must be an object`;
  for (const [id, payload] of Object.entries(map)) {
    if (!knownCriteria.has(id)) return `unknown ${label} criterion id: ${id}`;
    if (!isPlainObject(payload)) return `${label}.${id} must be an object`;
    if (JSON.stringify(payload).length > MAX_ITEM_BYTES) return `${label}.${id} exceeds ${MAX_ITEM_BYTES} bytes`;
  }
  return null;
}

// The composite the scan computed. Required, not optional: this endpoint full-
// replaces, so a payload that omits the composite would store nulls and blank
// the system's score on the board behind a 200 — the same failure shape as an
// empty criteria map, which is already refused. A caller running an engine too
// old to send it should fail loudly here rather than quietly erase a number.
function validateComposite(body) {
  const { score, colour, hard_capped: hardCapped, coverage } = body;

  if (score !== null && (typeof score !== 'number' || !Number.isFinite(score))) {
    return 'score must be a number or null';
  }
  // 0–100 and whole. The composite was a mean out of 5 until 2026-08-27; it is
  // now one score out of 100 with the Critical cap scaled into it, while
  // per-criterion scores stay on /5.
  if (score !== null && (score < 0 || score > 100)) return 'score must be between 0 and 100';
  if (score !== null && !Number.isInteger(score)) {
    return 'score must be a whole number out of 100 — a fractional score is the old /5 scale';
  }
  if (colour !== null && (typeof colour !== 'string' || !colour)) {
    return 'colour must be a non-empty string or null';
  }
  // A composite and its colour are derived from each other, so one present
  // without the other means the producer is broken rather than the system
  // unscored. Cheap to check and it cannot be true by accident.
  if ((score === null) !== (colour === null)) {
    return 'score and colour must both be null or both be set';
  }
  if (typeof hardCapped !== 'boolean') return 'hard_capped must be a boolean';
  if (typeof coverage !== 'string' || !coverage) return 'coverage must be a non-empty string';
  return null;
}

// The composite must agree with the criteria it arrived with.
//
// A range check cannot tell the two scales apart where it matters. An engine
// still on the old rule sends 3 for a system the new rule scores 60, and 3 is a
// perfectly valid /100 score — it would be stored, rendered as a catastrophic
// red ring, and nothing would have gone wrong as far as any check could see.
// Every scan in the fleet would land that way in the window between deploying
// this service and moving the engine's tag.
//
// So the number is checked against its own working. This never REPLACES the
// score: the engine is right that a score recomputed by the reader is a score
// no scan produced. It only decides whether to accept the one that was sent.
// The other half of that same argument — "if the two definitions ever drifted
// nothing would fail" — is what this closes.
function validateCompositeAgreesWithCriteria(body) {
  const { score } = body;
  const expected = compositeOf(body.criteria);
  if (score === null) {
    // Refusing to store null over a map that does score is the same class of
    // silent erasure as an empty criteria map, which is already refused.
    if (expected.score !== null) {
      return `score is null but the criteria sent score ${expected.score} — refusing to blank a scored system`;
    }
    return null;
  }
  if (expected.score === null) return 'score was sent but no criterion carries one';
  if (score !== expected.score) {
    return `score ${score} disagrees with its own criteria, which give ${expected.score}`
      + ' — the producer is on a different composite rule than this service';
  }
  if (body.colour !== expected.colour) {
    return `colour '${body.colour}' is not the band of score ${score}, which is '${expected.colour}'`;
  }
  return null;
}

function validatePayload(body, { knownCriteria }) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be a JSON object' };
  // The caller names the system it is writing; the allowlist decides whether it
  // is allowed to. Identity is a choice bounded by the claim, not read from it.
  if (typeof body.system_key !== 'string' || !body.system_key) {
    return { ok: false, reason: 'system_key must be a non-empty string' };
  }
  if (!isYmd(body.scanned_at)) return { ok: false, reason: 'scanned_at must be YYYY-MM-DD' };
  if (!isYmd(body.generated_at)) return { ok: false, reason: 'generated_at must be YYYY-MM-DD' };
  const compErr = validateComposite(body);
  if (compErr) return { ok: false, reason: compErr };
  const cErr = validateMap(body.criteria, 'criteria', knownCriteria);
  if (cErr) return { ok: false, reason: cErr };
  // A write here is a full replace — replaceSystem DELETEs the system's rows
  // before inserting. So an empty criteria map does not mean "leave it alone",
  // it means "erase every score this system has", and it would do so behind a
  // 200. That is the one input shape where a successful-looking ingest destroys
  // data, which makes it worth rejecting even though the envelope is valid.
  // Empty findings stays legal: a system genuinely can have nothing to report.
  if (Object.keys(body.criteria).length === 0) {
    return { ok: false, reason: 'criteria must not be empty — that would erase the system’s scores' };
  }
  // After the empty check, deliberately. An empty map fails both, and the
  // emptiness is the more useful thing to be told: it names what accepting the
  // payload would have destroyed, where the agreement check only says the sums
  // do not work out.
  const agreeErr = validateCompositeAgreesWithCriteria(body);
  if (agreeErr) return { ok: false, reason: agreeErr };
  const fErr = validateMap(body.findings, 'findings', knownCriteria);
  if (fErr) return { ok: false, reason: fErr };
  return { ok: true };
}

function payloadToRows(entry, body) {
  const system = {
    // Registry fields come from the allowlist entry, never the body — the
    // caller says which system, not what that system is.
    system_key: entry.system_key,
    repo: entry.repo ?? null,
    stack: entry.stack ?? null,
    sast_tool: entry.sast_tool ?? null,
    // The composite is a measurement, so it does come from the body.
    score: body.score,
    colour: body.colour,
    hard_capped: body.hard_capped,
    coverage: body.coverage,
    assessed_at: body.scanned_at,
  };
  const criteria = Object.entries(body.criteria).map(([criterion_id, payload]) => ({
    criterion_id, payload, scanned_at: body.scanned_at,
  }));
  const findings = Object.entries(body.findings).map(([criterion_id, payload]) => ({
    criterion_id, payload, generated_at: body.generated_at,
  }));
  return { system, criteria, findings };
}

function audit(fields) {
  // One structured line to stdout; captured by Cloud Run logging.
  try { console.log(JSON.stringify({ event: 'ingest', ...fields })); } catch (_) { /* never throw from audit */ }
}

async function handleIngest(req, res, { verifier, allowlist, knownCriteria, write }) {
  let claims;
  try {
    const token = req.get('X-Benchmark-Ingest-Token');
    if (!token) throw new Error('missing token');
    claims = await verifier.verify(token);
  } catch (err) {
    audit({ result: 'unauthenticated', repository: null, system_key: null, reason: err.message });
    return res.status(401).json({ error: 'unauthenticated' });
  }

  // The system has to be read before the allowlist can be consulted, because a
  // repo is permitted a SET of systems and the body says which one. Anything
  // that is not a usable key is a 400 — a 403 here would imply the caller had
  // asked for something specific and been refused.
  const systemKey = isPlainObject(req.body) ? req.body.system_key : undefined;
  if (typeof systemKey !== 'string' || !systemKey) {
    audit({ result: 'invalid', repository: claims.repository, system_key: null, reason: 'system_key is required' });
    return res.status(400).json({ error: 'invalid payload', reason: 'system_key is required' });
  }

  // One 403 for both "repo unknown" and "repo known, system not theirs", so a
  // caller cannot map the allowlist by probing.
  const entry = allowlist.resolve(claims.repository, systemKey);
  if (!entry) {
    audit({
      result: 'forbidden', repository: claims.repository, system_key: systemKey,
      reason: 'repository may not write this system',
    });
    return res.status(403).json({ error: 'repository not allowed to write this system' });
  }

  const check = validatePayload(req.body, { knownCriteria });
  if (!check.ok) {
    audit({ result: 'invalid', repository: claims.repository, system_key: entry.system_key, reason: check.reason });
    return res.status(400).json({ error: 'invalid payload', reason: check.reason });
  }

  const rows = payloadToRows(entry, req.body);
  // WHO published this, from the verified claim rather than the body. It is the
  // same value the allowlist just authorised against, so a watchtower cannot
  // misreport itself any more than it can write another organisation's system.
  // That is what makes it an identity instead of a label.
  rows.publishedBy = claims.repository;
  try {
    await write(rows);
  } catch (err) {
    audit({ result: 'error', repository: claims.repository, system_key: entry.system_key, reason: err.message });
    return res.status(500).json({ error: 'write failed' });
  }

  const counts = { criteria: rows.criteria.length, findings: rows.findings.length };
  audit({
    result: 'ok', repository: claims.repository, system_key: entry.system_key, ...counts,
  });
  return res.status(200).json({ system_key: entry.system_key, ...counts });
}

module.exports = {
  validatePayload, validateComposite, payloadToRows,
  handleIngest, isYmd, isPlainObject, MAX_ITEM_BYTES,
};
