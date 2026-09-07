'use strict';

/*
 * Security scan — I/O entrypoint (the black-box edge). NOT unit-tested; the
 * testable logic is in scripts/benchmark/*. Clones ONE repo (shallow) and runs
 * the three scanners to reports/<system>/{gitleaks,trivy,<sast_tool>}.json.
 *
 * None of these scanners compile the target app — they read the working tree and
 * lockfiles only, so this runs headless on any clone (sidesteps the Credo/Sobelow
 * private-dep compile barrier; see reference-credo-runner).
 *
 * Env:
 *   SYSTEM    system key (must exist in the watchtower config)
 *   GH_TOKEN  token with read on the target repo (clone auth). Not needed when
 *             the system declares a local path instead of a repo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractDeps } = require('./parse-reports');

const { reportsDir, systemTarget } = require('./engine-config');
const { materialise } = require('./target-tree');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Collect dependency manifests from the clone so CVEs can be split prod/dev.
// Bounded walk that skips vendored/build trees (never contain first-party deps).
const SKIP_DIRS = new Set(['node_modules', 'deps', '_build', '.git', '.elixir_ls', 'priv']);

function collectManifests(rootDir) {
  const mixParts = [];
  const packageJsons = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.name === 'mix.exs') {
        try { mixParts.push(fs.readFileSync(path.join(dir, e.name), 'utf8')); } catch { /* skip */ }
      } else if (e.name === 'package.json') {
        try { packageJsons.push(JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'))); } catch { /* skip */ }
      }
    }
  };
  walk(rootDir, 0);
  return { mixExs: mixParts.join('\n'), packageJsons };
}

// Run a scanner that writes its own JSON file; tolerate non-zero exit (these
// tools exit non-zero when they FIND issues — that is a successful scan).
// All three C9 scanners write their own report file. A scanner that exits
// non-zero BECAUSE IT FOUND SOMETHING still writes it — that is the case this
// swallows, and it must keep swallowing it.
//
// A scanner that failed to RUN writes nothing, and the previous version then
// fabricated `{}` — which every downstream parser reads as "no findings", i.e. a
// clean security score for a scan that never happened. Reachable in CI without
// anyone touching the code: semgrep's `--config auto` and trivy's DB download
// both need the network. This exact vector was caught once already, as a
// fabricated trivy report on the local-scan path (2026-07-27); the data was
// corrected then but this helper, the actual cause, was not.
//
// A missing report now throws. Failing the scan is always better than scoring a
// system green for secrets and CVEs it was never checked for.
function runToFile(cmd, args, outFile) {
  let runError;
  try { sh(cmd, args); } catch (e) { runError = e; }
  if (!fs.existsSync(outFile)) {
    throw new Error(
      `${cmd} produced no report at ${outFile} — refusing to write an empty one. `
      + `A scanner that fails must fail the scan, not score the system clean.`
      + (runError ? ` Underlying error: ${runError.message}` : ''),
    );
  }
}

function main() {
  const tree = materialise(systemTarget(SYSTEM), { prefix: SYSTEM, token: GH_TOKEN });
  const outDir = reportsDir(SYSTEM);

  // The tree was previously left behind on every run of this program — and it
  // holds a .git/config with the token in plaintext. Harmless on a runner that
  // is destroyed afterwards; not harmless on the laptop this now also serves.
  try {
    for (const note of tree.notes) console.log(`  ${note}`);
    const repoDir = tree.dir;

    // Dependency manifests → direct prod/dev dep lists, so trivy CVEs can be scored
    // by attributable environment at parse time (prod scored, dev discounted,
    // transitive shown for info).
    const directDeps = extractDeps(collectManifests(repoDir));
    writeJson(outDir, 'direct-deps', directDeps);

    // Secrets — gitleaks over the working tree (no git history needed with --no-git).
    runToFile('gitleaks', ['detect', '--source', repoDir, '--no-git', '--report-format', 'json', '--report-path', path.join(outDir, 'gitleaks.json'), '--exit-code', '0'], path.join(outDir, 'gitleaks.json'));

    // Dependency CVEs — trivy fs, vuln scanner only (reads mix.lock/Gemfile.lock/package-lock.json).
    runToFile('trivy', ['fs', '--scanners', 'vuln', '--format', 'json', '--output', path.join(outDir, 'trivy.json'), repoDir], path.join(outDir, 'trivy.json'));

    // SAST — semgrep --config auto over source (no compile; multi-language incl. Elixir/Ruby/JS/Vue).
    runToFile('semgrep', ['--config', 'auto', '--json', '--output', path.join(outDir, 'semgrep.json'), repoDir], path.join(outDir, 'semgrep.json'));

    console.log(`Scanned ${SYSTEM} (${tree.label}) -> ${outDir}`);
  } finally {
    tree.cleanup();
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

// runToFile is exported for its no-false-green guard, which is worth a test even
// though the rest of this edge is validated by running it.
module.exports = { main, runToFile };
