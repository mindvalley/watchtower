'use strict';

/*
 * Agent runs: what the fleet's agents (Oracle first) report after each run, for
 * the board's record of their impact. Separate from the score path on purpose:
 * an agent does not change a system's benchmark score, and its rows are added,
 * never full-replaced.
 *
 * Counts only, enforced here: a payload with any field this module does not know
 * is refused, so finding text — which can describe a security weakness — cannot
 * reach the board even by mistake. The run folder, linked from each row, holds it.
 */

const AGENTS = new Set(['oracle']);
const STATUSES = new Set(['complete', 'incomplete', 'failed']);
const COUNTS = ['open', 'new', 'refined', 'still_open', 'fixed', 'guarded', 'broke', 'merged', 'current_bugs', 'security_bugs'];
const FIELDS = new Set(['system_key', 'agent', 'run', 'finished_at', 'commit', 'status', 'model',
  'compared', 'previous_run', 'counts', 'cost_usd', 'run_url']);
const RUN_NAME = /^\d{4}-\d\d-\d\d-\d{4}(-\d+)?$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

class UnknownSystemError extends Error {
  constructor(systemKey) {
    super(`system '${systemKey}' is not on the board`);
    this.name = 'UnknownSystemError';
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (reason) => ({ ok: false, reason });

function validateAgentRun(body) {
  if (!isPlainObject(body)) return fail('body must be a JSON object');
  for (const key of Object.keys(body)) if (!FIELDS.has(key)) return fail(`unknown field: ${key} (agent runs carry counts only)`);
  if (typeof body.system_key !== 'string' || !body.system_key) return fail('system_key must be a non-empty string');
  if (!AGENTS.has(body.agent)) return fail(`agent must be one of ${[...AGENTS].join(', ')}`);
  if (typeof body.run !== 'string' || !RUN_NAME.test(body.run)) return fail('run must be a run folder name, YYYY-MM-DD-HHMM');
  if (typeof body.finished_at !== 'string' || Number.isNaN(Date.parse(body.finished_at))) return fail('finished_at must be an ISO date-time');
  if (body.commit !== null && (typeof body.commit !== 'string' || !COMMIT.test(body.commit))) return fail('commit must be a commit hash or null');
  if (!STATUSES.has(body.status)) return fail(`status must be one of ${[...STATUSES].join(', ')}`);
  if (typeof body.model !== 'string' || !body.model || body.model.length > 100) return fail('model must be a non-empty string');
  if (typeof body.compared !== 'boolean') return fail('compared must be true or false');
  if (body.previous_run !== null && (typeof body.previous_run !== 'string' || !RUN_NAME.test(body.previous_run))) {
    return fail('previous_run must be a run folder name or null');
  }
  if (!isPlainObject(body.counts)) return fail('counts must be an object');
  for (const key of Object.keys(body.counts)) if (!COUNTS.includes(key)) return fail(`unknown count: ${key}`);
  for (const key of COUNTS) {
    if (!Number.isInteger(body.counts[key]) || body.counts[key] < 0) return fail(`counts.${key} must be a whole number of zero or more`);
  }
  if (typeof body.cost_usd !== 'number' || !Number.isFinite(body.cost_usd) || body.cost_usd < 0) return fail('cost_usd must be a number of zero or more');
  if (typeof body.run_url !== 'string' || !body.run_url.startsWith('https://github.com/') || body.run_url.length > 500) {
    return fail('run_url must be an https://github.com/ link to the run folder');
  }
  return { ok: true };
}

function audit(fields) {
  try { console.log(JSON.stringify({ event: 'ingest-agent-run', ...fields })); } catch (_) { /* never throw from audit */ }
}

// Same authentication and allowlist as POST /ingest: identity from the verified
// GitHub OIDC claim, and a repository may write only its own systems.
async function handleAgentRunIngest(req, res, { verifier, allowlist, writeAgentRun }) {
  let claims;
  try {
    const token = req.get('X-Benchmark-Ingest-Token');
    if (!token) throw new Error('missing token');
    claims = await verifier.verify(token);
  } catch (err) {
    audit({ result: 'unauthenticated', repository: null, reason: err.message });
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const systemKey = isPlainObject(req.body) ? req.body.system_key : undefined;
  if (typeof systemKey !== 'string' || !systemKey) {
    return res.status(400).json({ error: 'invalid payload', reason: 'system_key is required' });
  }
  const entry = allowlist.resolve(claims.repository, systemKey);
  if (!entry) {
    audit({ result: 'forbidden', repository: claims.repository, system_key: systemKey });
    return res.status(403).json({ error: 'repository not allowed to write this system' });
  }
  const check = validateAgentRun(req.body);
  if (!check.ok) {
    audit({ result: 'invalid', repository: claims.repository, system_key: entry.system_key, reason: check.reason });
    return res.status(400).json({ error: 'invalid payload', reason: check.reason });
  }
  const row = { ...req.body, system_key: entry.system_key, published_by: claims.repository };
  try {
    await writeAgentRun(row);
  } catch (err) {
    if (err instanceof UnknownSystemError) {
      audit({ result: 'unknown-system', repository: claims.repository, system_key: entry.system_key });
      return res.status(409).json({ error: err.message });
    }
    audit({ result: 'error', repository: claims.repository, system_key: entry.system_key, reason: err.message });
    return res.status(500).json({ error: 'write failed' });
  }
  audit({ result: 'ok', repository: claims.repository, system_key: entry.system_key, agent: row.agent, run: row.run });
  return res.status(200).json({ system_key: entry.system_key, agent: row.agent, run: row.run });
}

// Republishing the same run (same system, agent and folder name) replaces it.
async function insertAgentRun(pool, r) {
  const { rowCount } = await pool.query(
    `INSERT INTO agent_runs (system_id, agent, run, finished_at, commit, status, model, compared, previous_run,
                             counts, cost_usd, run_url, published_by)
     SELECT s.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 FROM systems s WHERE s.system_key = $1
     ON CONFLICT (system_id, agent, run) DO UPDATE
       SET finished_at = EXCLUDED.finished_at, commit = EXCLUDED.commit, status = EXCLUDED.status,
           model = EXCLUDED.model, compared = EXCLUDED.compared, previous_run = EXCLUDED.previous_run,
           counts = EXCLUDED.counts, cost_usd = EXCLUDED.cost_usd, run_url = EXCLUDED.run_url,
           published_by = EXCLUDED.published_by, recorded_at = now()`,
    [r.system_key, r.agent, r.run, r.finished_at, r.commit ?? null, r.status, r.model, r.compared,
      r.previous_run ?? null, r.counts, r.cost_usd, r.run_url, r.published_by ?? null],
  );
  if (rowCount === 0) throw new UnknownSystemError(r.system_key);
}

// Every run, oldest first within each system: the pages take the latest for the
// panel and the series for the trend. Small — a few systems, one run a week each.
async function fetchAgentRuns(pool) {
  const { rows } = await pool.query(
    `SELECT s.system_key, a.agent, a.run,
            to_char(a.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS finished_at,
            a.commit, a.status, a.model, a.compared, a.previous_run, a.counts, a.cost_usd, a.run_url, a.published_by
     FROM agent_runs a JOIN systems s ON s.id = a.system_id
     ORDER BY s.system_key, a.agent, a.run`,
  );
  return { runs: rows };
}

module.exports = {
  validateAgentRun, handleAgentRunIngest, insertAgentRun, fetchAgentRuns, UnknownSystemError, COUNTS,
};
