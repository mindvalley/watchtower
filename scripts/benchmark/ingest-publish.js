'use strict';

/*
 * Posts freshly-scanned systems to the Watchtower's /ingest endpoint.
 *
 * Runs in the build job, after refresh-benchmark-data.js has rebuilt
 * public/data from this run's reports — which is why it can reuse the payload
 * builder unchanged: by that point the committed-file shape and the fresh scan
 * output are the same thing.
 *
 * Publishing does NOT replace the data PR. The PR keeps a reviewable record and
 * a current bootstrap copy for a fresh database; ingest makes the scores land
 * without waiting for a merge, and makes this run exercise the same path the
 * tenant watchtowers use.
 *
 * Env:
 *   WATCHTOWER_URL  base URL of the deployed service
 *   IAP_ID_TOKEN    Google ID token for the IAP perimeter (Authorization)
 *   INGEST_TOKEN    GitHub Actions OIDC token (X-Benchmark-Ingest-Token)
 */

const fs = require('fs');
const path = require('path');
const { buildIngestPayload } = require('./build-ingest-payload');

// Two conditions, both required.
//
// The system must have declared publish:"ingest" — absent means it publishes by
// data PR, which is the default and stays the default.
//
// And this run must have actually scanned it. A scan_mode:"local" system is not
// in the CI matrix; the build job preserves its committed entry instead of
// rebuilding it. Posting that would republish an earlier scan's numbers stamped
// as this run's, which is worse than not publishing at all — the board would
// look freshly measured when nothing had measured it.
function systemsToPublish(overrides) {
  const systems = (overrides && overrides.systems) || {};
  return Object.entries(systems)
    .filter(([, cfg]) => cfg && cfg.publish === 'ingest' && cfg.scan_mode !== 'local')
    .map(([key]) => key)
    .sort();
}

module.exports = { systemsToPublish };

// --- I/O edge -------------------------------------------------------------
if (require.main === module) {
  const DATA_DIR = require('./engine-config').dataDir();
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));

  const { WATCHTOWER_URL, IAP_ID_TOKEN, INGEST_TOKEN } = process.env;

  async function main() {
    const overrides = read('benchmark.overrides.json');
    const keys = systemsToPublish(overrides);

    if (keys.length === 0) {
      console.log('No system publishes by ingest yet — nothing to post.');
      return;
    }

    // Checked only once there is something to send, so the step stays a clean
    // no-op before any system is flipped over.
    for (const [name, value] of Object.entries({ WATCHTOWER_URL, IAP_ID_TOKEN, INGEST_TOKEN })) {
      if (!value) throw new Error(`${name} is not set — refusing to attempt a publish`);
    }

    const benchmark = read('benchmark.json');
    const failures = [];

    // Every system is attempted even after one fails. Stopping at the first
    // would leave the rest unpublished for a reason unrelated to them, and the
    // run would report a single failure while hiding how many there were.
    for (const systemKey of keys) {
      const findingsPath = path.join(DATA_DIR, `findings-${systemKey}.json`);
      try {
        const payload = buildIngestPayload({
          benchmark,
          findings: fs.existsSync(findingsPath) ? read(`findings-${systemKey}.json`) : null,
          systemKey,
        });

        const res = await fetch(`${WATCHTOWER_URL}/ingest`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${IAP_ID_TOKEN}`,
            'X-Benchmark-Ingest-Token': INGEST_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        // Bodies here are small status objects, never findings content.
        const body = await res.text();
        if (res.status !== 200) {
          failures.push(`${systemKey}: HTTP ${res.status} ${body}`);
          console.error(`  ${systemKey}: FAILED — HTTP ${res.status} ${body}`);
          continue;
        }

        // A 200 with the wrong counts means part of the payload was dropped and
        // reported as success, which would show up as a system quietly losing
        // criteria rather than as an error.
        const got = JSON.parse(body);
        const expected = {
          system_key: systemKey,
          criteria: Object.keys(payload.criteria).length,
          findings: Object.keys(payload.findings).length,
        };
        if (got.criteria !== expected.criteria || got.findings !== expected.findings) {
          failures.push(`${systemKey}: wrote ${JSON.stringify(got)}, sent ${JSON.stringify(expected)}`);
          console.error(`  ${systemKey}: FAILED — counts disagree`);
          continue;
        }
        console.log(`  ${systemKey}: ok — ${expected.criteria} criteria, ${expected.findings} findings`);
      } catch (err) {
        failures.push(`${systemKey}: ${err.message}`);
        console.error(`  ${systemKey}: FAILED — ${err.message}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${keys.length} system(s) failed to publish:\n${failures.join('\n')}`);
    }
    console.log(`Published ${keys.length} system(s) through /ingest.`);
  }

  main().catch((e) => { console.error(e.message); process.exit(1); });
}
