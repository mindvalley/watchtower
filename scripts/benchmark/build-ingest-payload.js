'use strict';

/*
 * Builds the POST /ingest body for one system from the committed data files.
 *
 * There are two write paths into Postgres and they must agree. The boot seed
 * reads public/data and calls upsertAll; /ingest takes this payload and calls
 * replaceSystem. If they disagree, cutting a system over to /ingest would move
 * its numbers for a reason that has nothing to do with its code.
 *
 * db/model.js filesToRows is the reference implementation for the mapping, and
 * this mirrors it deliberately — including the fallbacks, because scanned_at and
 * generated_at are NOT NULL in the schema.
 *
 * The pure builder is here; the CLI edge at the bottom only does file I/O.
 */

// `engineVersion` is handed in rather than read here, so this stays a pure
// function of its arguments. It is the reference mapping the boot seed has to
// agree with, and a hidden read of the environment would make the same inputs
// produce different output depending on where they ran.
function buildIngestPayload({ benchmark, findings, systemKey, engineVersion = null }) {
  const entry = benchmark && benchmark.systems && benchmark.systems[systemKey];
  if (!entry) throw new Error(`unknown system '${systemKey}' — not in benchmark.json`);

  const criteria = entry.criteria || {};
  // /ingest full-replaces: it DELETEs the system's rows before inserting. So an
  // empty criteria map is not a no-op, it is "erase this system's scores". A
  // scan that half-failed would otherwise blank a system on the board with a
  // perfectly successful-looking 200.
  if (Object.keys(criteria).length === 0) {
    throw new Error(`'${systemKey}' has no criteria — refusing to publish a payload that would blank it`);
  }

  return {
    // Names the system being written. The allowlist decides whether the calling
    // repo is permitted to write it — a watchtower repo may write its own org's
    // systems and no others.
    system_key: systemKey,
    scanned_at: entry.assessed_at ?? benchmark.last_updated,
    generated_at: (findings && findings.generated_at) ?? benchmark.last_updated,
    // The composite the assembler already produced for this entry. It travels
    // with the criteria it was computed from rather than being rebuilt at the
    // far end: a score recomputed by the reader is a score no scan produced, and
    // if the two definitions ever drifted nothing would fail.
    score: entry.score ?? null,
    colour: entry.colour ?? null,
    hard_capped: entry.hard_capped ?? false,
    coverage: entry.coverage,
    // Which engine produced these numbers, so a movement can be told apart from
    // a change of ruler. Optional at the receiving end for now — the three
    // watchtowers upgrade when their tag moves, not when this ships.
    engine_version: engineVersion,
    criteria,
    findings: (findings && findings.criteria) || {},
  };
}

module.exports = { buildIngestPayload };

// --- I/O edge -------------------------------------------------------------
// Usage: node scripts/benchmark/build-ingest-payload.js <system> [outFile]
// Writes the payload to outFile (or stdout). Never prints it to stderr, so a
// CI log cannot accidentally capture findings content.
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const [systemKey, outFile] = process.argv.slice(2);
  if (!systemKey) {
    console.error('usage: build-ingest-payload.js <system> [outFile]');
    process.exit(1);
  }
  const dataDir = require('./engine-config').dataDir();
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  const findingsPath = path.join(dataDir, `findings-${systemKey}.json`);

  try {
    const payload = buildIngestPayload({
      benchmark: read('benchmark.json'),
      findings: fs.existsSync(findingsPath) ? read(`findings-${systemKey}.json`) : null,
      systemKey,
      engineVersion: require('./engine-version').engineVersion(),
    });
    const json = JSON.stringify(payload);
    if (outFile) {
      fs.writeFileSync(outFile, json);
      // Sizes only — the endpoint caps per-criterion payloads, and knowing which
      // criterion is oversized is the difference between a useful 400 and a
      // mystery. Contents stay out of the log.
      const biggest = Object.entries(payload.findings)
        .map(([id, p]) => [id, JSON.stringify(p).length])
        .sort((a, b) => b[1] - a[1])[0];
      console.error(
        `${systemKey}: ${Object.keys(payload.criteria).length} criteria, `
        + `${Object.keys(payload.findings).length} findings, body ${json.length} bytes`
        + (biggest ? `, largest finding ${biggest[0]} at ${biggest[1]} bytes` : ''),
      );
    } else {
      process.stdout.write(json);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
