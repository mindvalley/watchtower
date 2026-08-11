// scripts/benchmark/engine-config.js
//
// The engine's only link to whoever is running it.
//
// Before this file existed, every scan program worked out two locations by
// counting directories upwards from itself — the list of systems to scan, and
// the folder to write results into. That silently tied the engine to one repo's
// layout: move the directory and nothing starts. Two programs did the read at
// import time, so even loading them failed.
//
// Both locations are now passed in. Nothing is discovered by walking upwards.
//
//   WATCHTOWER_CONFIG   path to the file listing the systems to scan
//                       (default: ./watchtower.config.json, so a standalone
//                       copy works from a project root with no setup)
//   WATCHTOWER_REPORTS  folder to write raw scan output into
//                       (default: ./reports)
//   WATCHTOWER_DATA     folder holding the assembled scores, which the publish
//                       step reads back to send to a dashboard
//                       (default: ./data)
//
// The list itself stays private and is never part of the engine: it names real
// repositories, which is the caller's business, not the tool's.
//
// Everything here fails loudly. A scan that cannot find its list must stop, not
// carry on with nothing to scan — an empty run reports no problems, which reads
// exactly like a clean result.

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = 'watchtower.config.json';
const DEFAULT_REPORTS = 'reports';
const DEFAULT_DATA = 'data';

function configPath() {
  return path.resolve(process.env.WATCHTOWER_CONFIG || DEFAULT_CONFIG);
}

function reportsRoot() {
  return path.resolve(process.env.WATCHTOWER_REPORTS || DEFAULT_REPORTS);
}

function dataDir() {
  return path.resolve(process.env.WATCHTOWER_DATA || DEFAULT_DATA);
}

// Read lazily, never at import time. Importing a scan program should not
// require the caller's configuration to exist — that is what made three test
// files fail to load rather than fail an assertion.
function loadConfig() {
  const file = configPath();

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the watchtower config at ${file}. ` +
      `Set WATCHTOWER_CONFIG to the file listing the systems to scan. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The watchtower config at ${file} is not valid JSON: ${err.message}`);
  }

  const systems = parsed && parsed.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    throw new Error(`The watchtower config at ${file} has no "systems" object.`);
  }
  // An empty list is refused rather than treated as "nothing to do". A caller
  // who meant to scan nothing does not run a scanner.
  if (Object.keys(systems).length === 0) {
    throw new Error(`The watchtower config at ${file} lists no systems.`);
  }

  return parsed;
}

// Credentials are supplied through the environment, never through this file.
// The config is the one thing that gets committed to a repository.
const CREDENTIAL_LOOKING = /^(token|password|secret|key|private_key|credential)$/i;

function systemConfig(systemKey) {
  if (!systemKey) {
    throw new Error('No system named. Set SYSTEM to a key from the watchtower config.');
  }

  const { systems } = loadConfig();
  const cfg = systems[systemKey];
  if (!cfg) {
    const known = Object.keys(systems).sort().join(', ');
    throw new Error(`Unknown system '${systemKey}'. The config lists: ${known}`);
  }

  const leaked = Object.keys(cfg).filter((k) => CREDENTIAL_LOOKING.test(k));
  if (leaked.length > 0) {
    throw new Error(
      `System '${systemKey}' has ${leaked.join(', ')} in the watchtower config. ` +
      'Credentials belong in the environment, not in a committed file.',
    );
  }

  return cfg;
}

// Results for one system. Created on demand so a caller does not have to
// prepare the tree.
function reportsDir(systemKey) {
  const dir = path.join(reportsRoot(), systemKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { configPath, reportsRoot, dataDir, loadConfig, systemConfig, reportsDir };
