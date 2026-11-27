#!/usr/bin/env node
'use strict';

/*
 * Publish one Oracle run's summary to the dashboard (POST /ingest/agent-run).
 *
 *   node dist/oracle-publish.js --system <name> --run-dir <run folder>
 *
 *   WATCHTOWER_URL       the dashboard
 *   IAP_ID_TOKEN         Google ID token for the dashboard's perimeter
 *   INGEST_TOKEN         this workflow's GitHub OIDC token (who is publishing)
 *   ORACLE_RUN_URL_BASE  where run folders are browsable, e.g.
 *                        https://github.com/<org>/watchtower/tree/oracle-runs/oracle
 *
 * Counts and a link only — the dashboard refuses anything else. What a finding
 * says stays in the run folder in the private config repository.
 */

const fs = require('node:fs');
const path = require('node:path');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// The payload for one run folder, or null for a run that crashed before it had
// findings (no changes.json): there is nothing to report and nothing to compare.
function buildAgentRunPayload({ runDir, systemKey, runUrlBase }) {
  const run = readJson(path.join(runDir, 'run.json'));
  const changesFile = path.join(runDir, 'changes.json');
  if (!fs.existsSync(changesFile) || !run.counts) return null;
  const changes = readJson(changesFile);
  const c = changes.counts;
  const name = path.basename(runDir);
  // Folders written before splits were counted apart counted them in `new`;
  // recount both from the per-finding changes those folders also hold.
  const perFinding = (kind) => (changes.current || []).filter((f) => f.change === kind).length;
  const split = c.split ?? perFinding('split');
  const fresh = c.split === undefined ? perFinding('new') : c.new;
  return {
    system_key: systemKey,
    agent: 'oracle',
    run: name,
    finished_at: run.finished_at,
    commit: run.commit || null,
    status: run.status,
    model: run.model,
    compared: Boolean(changes.compared && changes.previous),
    previous_run: changes.previous ? changes.previous.run : null,
    counts: {
      open: c.open,
      new: fresh,
      refined: split,
      still_open: c.still_open,
      fixed: c.fixed,
      guarded: c.guarded,
      broke: c.broke,
      merged: c.merged,
      current_bugs: run.counts.current_bugs,
      security_bugs: run.counts.security_bugs,
    },
    cost_usd: Math.round((run.cost && run.cost.usd ? run.cost.usd : 0) * 100) / 100,
    run_url: `${String(runUrlBase).replace(/\/+$/, '')}/${systemKey}/${name}`,
  };
}

async function postAgentRun({
  url, iapToken, ingestToken, payload, fetchImpl = fetch,
}) {
  const res = await fetchImpl(`${String(url).replace(/\/+$/, '')}/ingest/agent-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${iapToken}`,
      'X-Benchmark-Ingest-Token': ingestToken,
    },
    body: JSON.stringify(payload),
  });
  // Response bodies are small status objects, never findings content.
  const body = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${body.slice(0, 300)}`);
  return body;
}

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const systemKey = argValue('system');
  const runDir = argValue('run-dir');
  if (!systemKey || !runDir) throw new Error('Usage: oracle-publish --system <name> --run-dir <run folder>');
  const {
    WATCHTOWER_URL, IAP_ID_TOKEN, INGEST_TOKEN, ORACLE_RUN_URL_BASE,
  } = process.env;
  for (const [k, v] of Object.entries({
    WATCHTOWER_URL, IAP_ID_TOKEN, INGEST_TOKEN, ORACLE_RUN_URL_BASE,
  })) {
    if (!v) throw new Error(`${k} is not set`);
  }
  const payload = buildAgentRunPayload({ runDir, systemKey, runUrlBase: ORACLE_RUN_URL_BASE });
  if (!payload) {
    process.stdout.write(`oracle-publish: ${systemKey} ${path.basename(runDir)} has no findings to report (the run crashed early); nothing published\n`);
    return;
  }
  await postAgentRun({
    url: WATCHTOWER_URL, iapToken: IAP_ID_TOKEN, ingestToken: INGEST_TOKEN, payload,
  });
  process.stdout.write(`oracle-publish: ${systemKey} ${payload.run} published (${payload.counts.open} open)\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`oracle-publish: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildAgentRunPayload, postAgentRun };
