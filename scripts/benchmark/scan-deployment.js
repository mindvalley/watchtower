// scripts/benchmark/scan-deployment.js
'use strict';

/*
 * Deployment-safety scan (C7) — I/O entrypoint (the black-box edge). NOT
 * unit-tested; the testable logic is score-deployment.js. Clones ONE repo
 * (shallow, by SYSTEM env) and writes reports/<system>/deployment.json:
 * per capability { mature[], basic[] } + independent_deployability counts.
 *
 * Ecosystem-agnostic: scans CI config (any platform) + IaC/manifests (k8s /
 * Helm / Kustomize / Argo / Terraform / appspec) + Dockerfiles. Reads files
 * only, no compile — same private-dep sidestep as C4/C8/C9.
 *
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const SIGNALS = require('./deployment-signals');

const { systemConfig, reportsDir } = require('./engine-config');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const SKIP_DIRS = new Set(['node_modules', 'deps', '_build', '.git', '.elixir_ls', 'tmp', 'vendor']);
const MAX_HITS = 5;
// Files that carry deploy/CI/IaC config worth scanning for signals.
const CONFIG_EXT = /\.(ya?ml|tf|json|toml)$/i;
const CONFIG_HINT = /(\.github\/workflows|\.gitlab-ci|Jenkinsfile|\.circleci|azure-pipelines|k8s|kube|helm|chart|kustomiz|deploy|argo|appspec|Procfile|fly\.toml|render\.yaml|compose)/i;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

function collect(rootDir, matchFn) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (matchFn(e.name, full)) {
        out.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return out;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const rel = (repoDir, f) => path.relative(repoDir, f);

// Return matching rel paths (capped) for files whose content matches any regex.
function hits(repoDir, files, texts, patterns) {
  const found = [];
  for (let i = 0; i < files.length; i += 1) {
    if (patterns.some((re) => re.test(texts[i]))) {
      found.push(rel(repoDir, files[i]));
      if (found.length >= MAX_HITS) break;
    }
  }
  return found;
}

// Count deployable units via the precise Elixir-umbrella signature: a mix.exs
// declaring `apps_path:` is an umbrella root, and the subdirs of its apps_path
// dir are the deployable apps. This is exact — a stray dir merely named `apps`
// (frontend monorepo, vendored code) is NOT counted, and non-Elixir repos
// (no umbrella mix.exs) stay single-unit. Works at any depth (an umbrella can be
// nested, e.g. at app/mix.exs + app/apps). SKIP_DIRS keeps deps/_build out.
function umbrellaDeployables(repoDir) {
  let count = 0;
  const mixFiles = collect(repoDir, (n) => n === 'mix.exs');
  for (const mf of mixFiles) {
    const m = readText(mf).match(/apps_path:\s*["']([^"']+)["']/);
    if (!m) continue;
    const appsDir = path.join(path.dirname(mf), m[1]);
    try {
      const subs = fs.readdirSync(appsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
      count = Math.max(count, subs.length);
    } catch { /* apps_path dir unreadable */ }
  }
  return count;
}

// Independent unless multiple deployable units share a single deploy path.
// deployables: umbrella app count (>=2 only for real Elixir umbrellas), else 1.
// deploy_paths: files whose name matches a deploy-pipeline pattern. Independent
// when there is at most one deployable, or at least as many deploy paths as units.
function assessIndependence(repoDir) {
  const deployables = Math.max(umbrellaDeployables(repoDir), 1);

  const deployFiles = collect(repoDir, (n, full) => SIGNALS.deployPathPatterns.some((re) => re.test(rel(repoDir, full))));
  const deploy_paths = deployFiles.length;

  const independent = deployables <= 1 || (deploy_paths >= deployables);
  return { deployables, deploy_paths, independent };
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `scan-c7-${SYSTEM}-`));
  const repoDir = path.join(work, 'repo');
  const outDir = reportsDir(SYSTEM);

  const url = `https://x-access-token:${GH_TOKEN}@github.com/${cfg.repo}.git`;
  sh('git', ['clone', '--depth', '1', url, repoDir]);

  // Candidate config files: Dockerfiles + CI/IaC config by ext or path hint.
  const files = collect(repoDir, (n, full) => (
    /^Dockerfile(\..+)?$/.test(n)
    || (CONFIG_EXT.test(n) && CONFIG_HINT.test(full))
  ));
  const texts = files.map(readText);

  const ladder = (sig) => ({
    mature: hits(repoDir, files, texts, sig.mature),
    basic: hits(repoDir, files, texts, sig.basic),
  });

  const report = {
    progressive_delivery: ladder(SIGNALS.progressive_delivery),
    automated_rollback: ladder(SIGNALS.automated_rollback),
    pipeline_safety: ladder(SIGNALS.pipeline_safety),
  };

  // Structural additions to pipeline_safety: staging AND prod deploy paths present
  // => a real staged progression (mature), even without a merge_group/preview hit.
  const relFiles = files.map((f) => rel(repoDir, f).toLowerCase());
  const hasStaging = relFiles.some((f) => /stag/.test(f)) || texts.some((t) => /\bstaging\b/i.test(t));
  const hasProd = relFiles.some((f) => /prod/.test(f)) || texts.some((t) => /\bproduction\b/i.test(t));
  if (hasStaging && hasProd && !report.pipeline_safety.mature.includes('staging->prod')) {
    report.pipeline_safety.mature.push('staging->prod');
  }
  // Any deploy pipeline at all => at least basic pipeline automation.
  const anyDeploy = collect(repoDir, (n, full) => SIGNALS.deployPathPatterns.some((re) => re.test(rel(repoDir, full))));
  if (anyDeploy.length && !report.pipeline_safety.basic.length && !report.pipeline_safety.mature.length) {
    report.pipeline_safety.basic.push(rel(repoDir, anyDeploy[0]));
  }

  report.independent_deployability = assessIndependence(repoDir);

  writeJson(outDir, 'deployment', report);
  const pd = report.progressive_delivery.mature.length ? 'PD:mature'
    : report.progressive_delivery.basic.length ? 'PD:basic' : 'PD:none';
  const ind = report.independent_deployability.independent ? 'indep' : 'coupled';
  console.log(`Scanned C7 ${SYSTEM} (${cfg.repo}, ${pd}, ${ind}) -> ${outDir}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main };
