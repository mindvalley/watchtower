'use strict';

/*
 * Turning the files a scan wrote into rows this database can hold.
 *
 * A scan whose configuration names no destination writes its results out and
 * posts nowhere — `benchmark.json` plus a `findings-<system>.json` beside it.
 * That is the right behaviour on a laptop and it has worked since 12 August.
 * What was missing was the other end: nothing read those files back. So a local
 * scan produced a directory of JSON and the board stayed empty, and the only
 * way to see your own results was to stand up an OIDC-authenticated endpoint
 * and post to yourself.
 *
 * THIS IS NOT A SECOND WRITE PATH. It builds the same payload /ingest receives,
 * puts it through the same validatePayload and the same payloadToRows, and
 * calls the same replaceSystem. Everything except the authentication, which is
 * the one part that has no meaning when the operator is standing at the
 * machine. A loaded board and a published board are the same board — if they
 * were not, moving a system from one to the other would change its numbers for
 * a reason that had nothing to do with its code.
 *
 * WHERE THE REGISTRY FIELDS COME FROM, and why they are optional. /ingest takes
 * `repo`, `stack` and `sast_tool` from the allowlist entry rather than the body,
 * because the caller says WHICH system, not what that system is. There is no
 * allowlist here — the operator is not being authorised against anything — so
 * they come from the watchtower config if one is given, and are null if not.
 * Null is honest: the board shows a system with no repository recorded, which
 * is exactly what is known.
 *
 * `published_by` is always null. It is the verified identity of the repository
 * that published, and there is no such identity here. Writing "local" would put
 * a value in a column whose whole meaning is that it was verified.
 */

const { validatePayload, payloadToRows } = require('./ingest');

// The mapping build-ingest-payload.js performs in the engine, on this side of
// the wire. Kept deliberately identical, fallbacks included: `scanned_at` and
// `generated_at` are NOT NULL in the schema, and a scan that assembled without
// a per-system date still has the board's own.
function payloadFor({ benchmark, findings, systemKey }) {
  const entry = benchmark && benchmark.systems && benchmark.systems[systemKey];
  if (!entry) throw new Error(`'${systemKey}' is not in benchmark.json`);

  return {
    system_key: systemKey,
    scanned_at: entry.assessed_at ?? benchmark.last_updated,
    generated_at: (findings && findings.generated_at) ?? benchmark.last_updated,
    // The composite travels with the criteria it was computed from rather than
    // being rebuilt here. A score recomputed by the reader is a score no scan
    // produced — and validatePayload checks the two agree, so a stale file
    // assembled under a different composite rule is refused rather than stored.
    score: entry.score ?? null,
    colour: entry.colour ?? null,
    hard_capped: entry.hard_capped ?? false,
    coverage: entry.coverage,
    criteria: entry.criteria || {},
    findings: (findings && findings.criteria) || {},
  };
}

/*
 * Validate everything before writing anything.
 *
 * Eleven systems in a directory and a malformed findings file on the ninth
 * would otherwise leave eight loaded and three not, with a non-zero exit and no
 * way to tell from the board which is which. A directory is one scan's output;
 * it goes in whole or it does not go in.
 *
 * benchmark    the parsed benchmark.json
 * findingsFor  systemKey -> parsed findings file, or null when there is none
 * registryFor  systemKey -> { repo, stack, sast_tool }, all optional
 * only         restrict to these keys; empty or absent means every system
 * knownCriteria  the criterion namespace, same Set the endpoint validates with
 */
function prepare({
  benchmark, findingsFor, registryFor = () => ({}), only = [], knownCriteria,
}) {
  const all = Object.keys((benchmark && benchmark.systems) || {}).sort();
  if (all.length === 0) throw new Error('benchmark.json holds no systems');

  const wanted = only.length ? only : all;
  const unknown = wanted.filter((k) => !all.includes(k));
  if (unknown.length) {
    throw new Error(`not in benchmark.json: ${unknown.join(', ')}. It holds: ${all.join(', ')}`);
  }

  const prepared = [];
  const rejected = [];
  for (const systemKey of wanted) {
    const payload = payloadFor({ benchmark, findings: findingsFor(systemKey), systemKey });
    const check = validatePayload(payload, { knownCriteria });
    if (!check.ok) {
      rejected.push({ systemKey, reason: check.reason });
      continue;
    }
    const entry = { system_key: systemKey, ...registryFor(systemKey) };
    prepared.push({
      systemKey,
      rows: { ...payloadToRows(entry, payload), publishedBy: null },
      counts: {
        criteria: Object.keys(payload.criteria).length,
        findings: Object.keys(payload.findings).length,
      },
    });
  }

  if (rejected.length) {
    throw new Error(
      `nothing was loaded — ${rejected.length} of ${wanted.length} systems would be refused by /ingest:\n`
      + rejected.map((r) => `  ${r.systemKey}: ${r.reason}`).join('\n'),
    );
  }
  return prepared;
}

module.exports = { payloadFor, prepare };
