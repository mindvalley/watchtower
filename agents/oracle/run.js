#!/usr/bin/env node
'use strict';

/*
 * Run Oracle on one system.
 *
 *   node agents/oracle/run.js --system <name>      (or SYSTEM=<name>)
 *
 * Reads the same watchtower.config.json as the scanners (WATCHTOWER_CONFIG),
 * the key from the environment or a gitignored .env beside the config, and
 * writes one run folder under WATCHTOWER_RUNS (default ./runs).
 *
 * The target is copied (a folder) or shallow-cloned (a repo, GH_TOKEN if private)
 * and only read. Nothing is published and no pull request is opened.
 *
 * Exit codes: 0 complete · 1 failed (in part) · 2 stopped at the spending cap.
 */

const { execFileSync } = require('node:child_process');
const engine = require('../../scripts/benchmark/engine-config');
const { materialise } = require('../../scripts/benchmark/target-tree');
const { agentSettings, loadDotEnv } = require('../_shared/config');
const { createProvider } = require('../_shared/providers');
const { CostMeter } = require('../_shared/cost');
const { createRunDir, writeJson } = require('../_shared/runs');
const { runOracle } = require('./pipeline');

const EXIT = { complete: 0, failed: 1, incomplete: 2 };

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function headCommit(dir) {
  if (!dir) return null;
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const systemKey = argValue('system') || process.env.SYSTEM;
  if (!systemKey) throw new Error('Name a system: --system <name> (a key from the watchtower config).');

  loadDotEnv();
  const { settings, defaults } = agentSettings('oracle', systemKey, { agentDir: __dirname });
  const meter = new CostMeter({ prices: settings.prices, capUsd: settings.max_cost_usd, model: settings.model });
  meter.requirePrice(settings.model);
  const provider = createProvider(settings);

  const tree = materialise(engine.systemTarget(systemKey), { prefix: `oracle-${systemKey}`, token: process.env.GH_TOKEN });
  tree.notes.forEach((n) => process.stdout.write(`${n}\n`));
  const runDir = createRunDir('oracle', systemKey);
  process.stdout.write(`oracle: ${systemKey} -> ${runDir}\n`);

  try {
    const run = await runOracle({
      systemKey,
      settings,
      defaults,
      agentDir: __dirname,
      provider,
      treeDir: tree.dir,
      runDir,
      meter,
      commit: headCommit(tree.historyDir),
      log: (line) => process.stdout.write(`  ${line}\n`),
    });
    process.stdout.write(`oracle: ${run.status} — ${run.counts.findings} findings, ${run.counts.current_bugs} bugs, $${run.cost.usd.toFixed(2)}\n`);
    process.exitCode = EXIT[run.status] ?? 1;
  } catch (err) {
    // Unexpected failure outside the steps: still leave a record in the history.
    writeJson(runDir, 'run.json', { agent: 'oracle', system: systemKey, status: 'failed', error: err.message, cost: meter.summary() });
    throw err;
  } finally {
    tree.cleanup();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`oracle: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
