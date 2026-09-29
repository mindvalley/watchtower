'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// scanner-pins.json is the single source of truth for versions.
// From here (.claude/skills/agent-compatibility/scripts) the repo root is four up.
const PINS_PATH = path.join(
  __dirname, '..', '..', '..', '..', 'scripts', 'benchmark', 'scanner-pins.json',
);

// pin key -> the CLI command and its version args. The package is `graphifyy`
// (double y) but the installed command is `graphify`; its --version prints
// `graphify 0.9.28`. Confirm each format against the real tool in Step 6.
const TOOLS = [
  { pin: 'gitleaks',  cmd: 'gitleaks', args: ['version'] },
  { pin: 'trivy',     cmd: 'trivy',    args: ['--version'] },
  { pin: 'semgrep',   cmd: 'semgrep',  args: ['--version'] },
  { pin: 'lizard',    cmd: 'lizard',   args: ['--version'] },
  { pin: 'graphifyy', cmd: 'graphify', args: ['--version'] },
];

function loadPins(pinsPath = PINS_PATH) {
  return JSON.parse(fs.readFileSync(pinsPath, 'utf8')).pinned;
}

// Every tool prints its version differently; the semver triple is the common part.
function parseVersion(raw) {
  const m = String(raw).match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

function statusFor(found, pinned) {
  if (found === null || found === undefined) return 'missing';
  return found === pinned ? 'ok' : 'mismatch';
}

// Pure: given a found-version map keyed by CLI command, build the report rows.
function report(pins, foundMap) {
  return TOOLS.map(({ pin, cmd }) => {
    const required = pins[pin];
    const found = foundMap[cmd] ?? null;
    return { tool: cmd, pin, required, found, status: statusFor(found, required) };
  });
}

function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return '';
  return `${r.stdout || ''}${r.stderr || ''}`;
}

// IO: run each tool's version command and parse it. `run` is injectable for tests.
function probe(run = defaultRun) {
  const found = {};
  for (const { cmd, args } of TOOLS) found[cmd] = parseVersion(run(cmd, args));
  return found;
}

function main() {
  const pins = loadPins();
  const rows = report(pins, probe());
  for (const r of rows) {
    const mark = r.status === 'ok' ? 'OK' : r.status.toUpperCase();
    console.log(`${mark.padEnd(9)} ${r.tool.padEnd(10)} want ${r.required}  found ${r.found || '(none)'}`);
  }
  const bad = rows.filter((r) => r.status !== 'ok');
  if (bad.length) {
    console.error(`\n${bad.length} scanner(s) missing or at the wrong version. A wrong version is a changed ruler.`);
    process.exit(1);
  }
  console.log('\nAll pinned scanners present at the pinned versions.');
}

if (require.main === module) main();
module.exports = {
  TOOLS, loadPins, parseVersion, statusFor, report, probe,
};
