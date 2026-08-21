'use strict';

/*
 * Posts scored systems to a Watchtower's /ingest endpoint.
 *
 * Runs after the assemble step, which is what makes it able to reuse the
 * payload builder unchanged: by that point the stored shape and this run's
 * fresh output are the same thing.
 *
 * Publishing need not replace a data PR where one exists. A PR keeps a
 * reviewable record and a bootstrap copy for an empty database; ingest makes
 * the scores land without waiting for a merge. A watchtower with no dashboard
 * repo of its own has only this path.
 *
 * Env:
 *   WATCHTOWER_URL  base URL of the receiving service
 *   IAP_ID_TOKEN    Google ID token for the perimeter (Authorization)
 *   INGEST_TOKEN    GitHub Actions OIDC token (X-Benchmark-Ingest-Token)
 *   plus WATCHTOWER_CONFIG / WATCHTOWER_REPORTS / WATCHTOWER_DATA
 */

const fs = require('fs');
const path = require('path');
const { buildIngestPayload } = require('./build-ingest-payload');

// Two conditions, both required.
//
// FIRST: this run must have assembled the system. That comes from the run
// manifest, never from the config — the config is the set a watchtower is
// responsible for, which can be wider than the set a given run measured.
// Posting the difference republishes older numbers under a fresh date, so the
// board reads as freshly measured when nothing measured it.
//
// SECOND: the system's results must be destined for a database rather than a
// file. A watchtower scanning on someone's behalf declares that once, at the
// top of its config; a board that publishes some systems one way and some
// another says so per system, and the per-system answer wins. Absent both, the
// scores are written out and go nowhere on their own, which is the right
// default for a run with no endpoint to talk to.
function systemsToPublish(config, manifest) {
  const systems = (config && config.systems) || {};
  const fallback = config && config.publish;
  const assembled = (manifest && manifest.systems) || [];

  return assembled
    .filter((key) => {
      const cfg = systems[key];
      if (!cfg) return false;
      return (cfg.publish || fallback) === 'ingest';
    })
    .slice()
    .sort();
}

module.exports = { systemsToPublish };

// --- I/O edge -------------------------------------------------------------
if (require.main === module) {
  const { dataDir, reportsRoot, loadConfig } = require('./engine-config');
  const { readManifest } = require('./run-manifest');
  const DATA_DIR = dataDir();
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));

  const { WATCHTOWER_URL, IAP_ID_TOKEN, INGEST_TOKEN } = process.env;

  async function main() {
    const keys = systemsToPublish(loadConfig(), readManifest(reportsRoot()));

    if (keys.length === 0) {
      console.log('Nothing this run assembled publishes to a database — nothing to post.');
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
