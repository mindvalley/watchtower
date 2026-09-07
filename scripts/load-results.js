#!/usr/bin/env node
'use strict';

/*
 * Load the results of a scan into this database. Needs DATABASE_URL.
 *
 *   npm run load -- ../reports/data
 *   npm run load -- ./data --config ../watchtower.config.json
 *   npm run load -- ./data --system billing --dry-run
 *
 * The directory is the one a scan wrote: `benchmark.json`, and a
 * `findings-<system>.json` beside it for each system. That is what a watchtower
 * config with no publishing destination produces, which is the ordinary shape
 * of a run on your own machine.
 *
 * --config points at the watchtower config so the board can record each
 * system's repository and stack. Optional: /ingest gets those from its
 * allowlist, and with neither they are simply null.
 *
 * --system may be repeated to load a subset. --dry-run validates and prints
 * what would be written.
 *
 * It is safe to run twice. Each system is fully replaced, exactly as a publish
 * would replace it, and scan_history gains one entry per run — which is the
 * point: the board only shows movement if something records it.
 */

const fs = require('fs');
const path = require('path');
const { getPool } = require('../db/pool');
const { replaceSystem } = require('../db/repo');
const { criteriaIds } = require('../db/criteria');
const { prepare } = require('../db/load-results');

function usage(msg) {
  if (msg) console.error(`${msg}\n`);
  console.error('usage: load-results.js <data-dir> [--config <watchtower.config.json>] [--system <key>]... [--dry-run]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    dir: null, config: null, only: [], dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--config') { out.config = argv[i += 1]; if (!out.config) usage('--config needs a path'); } // eslint-disable-line no-plusplus
    else if (a === '--system') { const k = argv[i += 1]; if (!k) usage('--system needs a key'); out.only.push(k); }
    else if (a.startsWith('-')) usage(`unknown option: ${a}`);
    else if (out.dir) usage(`two directories given: ${out.dir} and ${a}`);
    else out.dir = a;
  }
  if (!out.dir) usage('no data directory given');
  return out;
}

function readJson(file, { optional = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (optional && err.code === 'ENOENT') return null;
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir);

  const benchmark = readJson(path.join(dir, 'benchmark.json'));

  // Absent findings are legitimate — a system genuinely can have nothing to
  // report — so this is optional rather than an error. An unreadable one is
  // not: it would silently blank that system's findings behind a success.
  const findingsFor = (key) => readJson(path.join(dir, `findings-${key}.json`), { optional: true });

  let registryFor = () => ({});
  if (args.config) {
    const cfg = readJson(path.resolve(args.config));
    const systems = (cfg && cfg.systems) || {};
    registryFor = (key) => {
      const s = systems[key] || {};
      return { repo: s.repo ?? null, stack: s.stack ?? null, sast_tool: s.sast_tool ?? null };
    };
  }

  const prepared = prepare({
    benchmark, findingsFor, registryFor, only: args.only, knownCriteria: criteriaIds(),
  });

  for (const p of prepared) {
    console.log(`${p.systemKey}: ${p.counts.criteria} criteria, ${p.counts.findings} findings`);
  }

  if (args.dryRun) {
    console.log(`\nDry run. ${prepared.length} system(s) would be written from ${dir}.`);
    return;
  }

  const pool = getPool();
  try {
    for (const p of prepared) await replaceSystem(pool, p.rows);
  } finally {
    await pool.end();
  }
  console.log(`\nwrote ${prepared.length} system(s) from ${dir}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
