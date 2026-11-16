'use strict';

/*
 * Where an agent's runs are written.
 *
 *   $WATCHTOWER_RUNS/<agent>/<system>/<YYYY-MM-DD-HHMM>/
 *
 * Default ./runs, beside the reports and data folders the scanners use. Locally
 * that is the run history. In CI the folder is committed to the private config
 * repository, which makes it the history there too — and is why the previous
 * run can always be found for comparison.
 */

const fs = require('node:fs');
const path = require('node:path');

function runsRoot() {
  return path.resolve(process.env.WATCHTOWER_RUNS || 'runs');
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}

function createRunDir(agent, system, { date = new Date(), root = runsRoot() } = {}) {
  const base = path.join(root, agent, system, stamp(date));
  let dir = base;
  for (let n = 2; fs.existsSync(dir); n += 1) dir = `${base}-${n}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The most recent earlier run of this agent on this system, or null.
function previousRun(agent, system, currentDir, { root = runsRoot() } = {}) {
  const dir = path.join(root, agent, system);
  if (!fs.existsSync(dir)) return null;
  const earlier = fs.readdirSync(dir)
    .filter((name) => path.join(dir, name) !== currentDir)
    .filter((name) => fs.existsSync(path.join(dir, name, 'run.json')))
    .sort();
  return earlier.length ? path.join(dir, earlier[earlier.length - 1]) : null;
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function writeText(dir, name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

module.exports = { runsRoot, stamp, createRunDir, previousRun, writeJson, writeText };
