'use strict';

// I/O edge for C1. Clones the target, runs graphify's deterministic offline AST
// pass, maps the graph onto declared modules, and writes boundaries.json.
// Not unit-tested -- validated by running it against real repos.
//
// Env: SYSTEM (a key in the caller's system list), GH_TOKEN (clone auth).
// The repo slug is resolved from that list like every sibling scanner,
// so an external driver can run this scanner without an env bridge.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  discoverModules, buildModuleGraph, findModuleCycles, computeFanOut,
  detectExternalTargets, moduleForFile, SOURCE_EXT,
  isNonSourcePath, isTestOrFixturePath,
  moduleGraphCoverage, MODULE_GRAPH_COVERAGE_THRESHOLD,
} = require('./boundary-signals');
const {
  parseGitLog, modulesPerRevision, couplingPairs, CODE_MAAT_DEFAULTS,
} = require('./change-coupling');
const { declaredDependencyPairs, pairKey } = require('./declared-deps');

const GRAPHIFY_VERSION = '0.9.28';
const MAX_CYCLES = 500;
const GRAPHIFY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// The benchmark spec's own window for boundary drift ("last 90 days").
const COUPLING_WINDOW_DAYS = 90;

const { systemConfig, reportsDir, configPath } = require('./engine-config');

// Directories excluded from the file walk. Covers Node, Elixir, Python,
// Go/Bundler/Composer vendoring, compiled output trees, build caches, editor
// state and Phoenix runtime assets. Kept in step with NON_SOURCE_DIRS in
// boundary-signals.js (itself mirroring SKIP_DIRS in test-coverage-signals.js);
// `priv`, `coverage`, `cover`, `tmp` and `.elixir_ls` are directories the walk
// should never have entered.
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', 'graphify-out', '.venv',
  'vendor', 'dist', 'build', 'target', '__pycache__',
  'priv', 'coverage', 'cover', 'tmp', '.elixir_ls', '.agents',
  'out', '.next', '.turbo', '.nuxt',
]);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function listFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else out.push(path.relative(root, full));
    }
  };
  walk(root, 0);
  return out;
}

// Indeterminate reports must not carry default-good values. `cycles: {count: 0}`
// and `fan_out: {mean: 0}` next to an indeterminate string read as "perfect
// boundaries" to anything that skips the string. Emit nulls; the scorer's guards
// already reject nulls and are tested.
function indeterminateReport(reason, discovery, extra = {}) {
  return {
    applicable: true,
    indeterminate: reason,
    module_discovery: {
      kind: discovery.kind,
      modules: (discovery.modules || []).map((m) => m.name),
      reason: discovery.reason || reason,
    },
    cycles: { count: null, cycles: [], bounded: false, dropped: 0, uncorroborated: [] },
    fan_out: { per_module: {}, mean: null },
    external_targets: {},
    graph: { nodes: 0, edges: null, ...extra },
  };
}

// ─── Change coupling ─────────────────────────────────────────────────────────
//
// Reads git history, never the code graph. That independence is the point: it is
// the only C1 metric that still works on a stack whose extractor under-resolves.
// A failure here degrades to "not measured", never to a clean bill of health.
function collectChangeCoupling(repoDir, discovery, files, readText) {
  const base = {
    window_days: COUPLING_WINDOW_DAYS,
    thresholds: CODE_MAAT_DEFAULTS,
    declarable: false,
    total_revisions: 0,
    qualifying_modules: 0,
    excluded_oversized_changesets: 0,
    unreadable_manifests: [],
    pairs: [],
    violations: [],
  };

  let log;
  try {
    log = sh('git', [
      'log', '--no-merges', `--since=${COUPLING_WINDOW_DAYS} days ago`,
      '--format=commit%x09%H', '--name-only',
    ], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // No history available (a bare depth-1 clone that could not be deepened).
    return { ...base, unavailable: 'git history for the window could not be read' };
  }

  const revisions = parseGitLog(log);
  const mapped = modulesPerRevision(revisions, discovery.modules);
  const { pairs, qualifying_modules: qualifying, total_revisions: total } = couplingPairs(mapped.revisions);

  const { declared, declarable, unreadable } = declaredDependencyPairs({
    files, readText, modules: discovery.modules, kind: discovery.kind,
  });

  const annotated = pairs.map((p) => ({ ...p, declared: declared.has(pairKey(p.a, p.b)) }));

  return {
    ...base,
    declarable,
    total_revisions: total,
    qualifying_modules: qualifying,
    excluded_oversized_changesets: mapped.excluded_oversized_changesets,
    unreadable_manifests: unreadable,
    pairs: annotated,
    // A pair whose modules keep changing together while neither declares a
    // dependency on the other is the criterion's own "hidden cross-boundary
    // dependency". Only meaningful where the ecosystem can express a declaration.
    violations: declarable ? annotated.filter((p) => !p.declared) : [],
  };
}

function scanRepo(repoDir) {
  const files = listFiles(repoDir);
  const readText = (p) => {
    try { return fs.readFileSync(path.join(repoDir, p), 'utf8'); } catch { return null; }
  };

  const discovery = discoverModules({ files, readText });
  if (discovery.kind === 'indeterminate') {
    return indeterminateReport(discovery.reason, discovery);
  }

  sh('graphify', ['extract', repoDir, '--code-only'], {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GRAPHIFY_TIMEOUT_MS,
    killSignal: 'SIGTERM',
  });
  const graphPath = path.join(repoDir, 'graphify-out', 'graph.json');
  if (!fs.existsSync(graphPath)) throw new Error(`graphify produced no graph.json for ${repoDir}`);
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  if (!Array.isArray(graph.links)) throw new Error('graph.json has no links array');

  // Guard: zero links with 2+ modules means the extractor understood nothing.
  // Do not produce a report that reads as clean boundaries when it is actually
  // a failed or empty extraction.
  if (graph.links.length === 0 && discovery.modules.length >= 2) {
    throw new Error(
      `graphify produced zero links for ${discovery.modules.length} modules — ` +
      'extraction likely failed; refusing to score as clean boundaries'
    );
  }

  const built = buildModuleGraph(graph, discovery.modules);
  const { edges, directions, relations } = built;
  const rawLinks = graph.links.length;

  // Degenerate-graph test: coverage, not a cliff at zero. Both the threshold and
  // the measured value are emitted below whatever the outcome, per the
  // no-silent-caps rule.
  const cov = moduleGraphCoverage(edges, discovery.modules);
  const graphAudit = {
    nodes: (graph.nodes || []).length,
    edges: edges.length,
    raw_links: rawLinks,
    skipped_manifest_nodes: built.skipped_manifest_nodes,
    skipped_cross_language_edges: built.skipped_cross_language_edges,
    skipped_stdlib_collision_edges: built.skipped_stdlib_collision_edges,
    skipped_non_source_path_edges: built.skipped_non_source_path_edges,
    module_graph_coverage: Number(cov.coverage.toFixed(4)),
    module_graph_coverage_threshold: MODULE_GRAPH_COVERAGE_THRESHOLD,
    modules_connected: cov.connected,
    modules_declared: cov.total,
    relations,
    directions,
  };

  if (discovery.modules.length >= 2 && cov.coverage < MODULE_GRAPH_COVERAGE_THRESHOLD) {
    const report = indeterminateReport(
      `degenerate graph: only ${cov.connected} of ${cov.total} declared modules appear in the dependency graph `
      + `(coverage ${(cov.coverage * 100).toFixed(1)}%, threshold ${(MODULE_GRAPH_COVERAGE_THRESHOLD * 100).toFixed(0)}%) `
      + `over ${rawLinks} raw links — module mapping may be misaligned, or the extractor does not resolve `
      + 'cross-module references for this language',
      discovery,
    );
    report.graph = graphAudit;
    // Module discovery succeeded here -- only the graph failed. Change coupling
    // needs history and manifests, not the graph, so it is still measurable and
    // the scorer can grade the criterion on it alone. Without this, a repo whose
    // graph is degenerate loses a signal we actually have.
    report.change_coupling = collectChangeCoupling(repoDir, discovery, files, readText);
    return report;
  }

  const cycles = findModuleCycles(edges, { maxCycles: MAX_CYCLES, directions });

  // External targets, attributed to the module that contains the call site.
  // Path exclusions applied here rather than inside the detector so the detector
  // stays pure: build output and bundles are not source at all, and test /
  // fixture / mock / cassette URLs are data, not calls the system makes. This is
  // the same cross-scanner path allowlist the C9 triage config already carries.
  const externalByModule = {};
  let anchoredTotal = 0;
  let unanchoredTotal = 0;
  let filesScannedForTargets = 0;
  for (const f of files) {
    if (!SOURCE_EXT.test(f)) continue;
    if (isNonSourcePath(f) || isTestOrFixturePath(f)) continue;
    const mod = moduleForFile(f, discovery.modules);
    if (!mod) continue;
    filesScannedForTargets += 1;
    const { targets, anchored, unanchored } = detectExternalTargets(readText(f) || '');
    anchoredTotal += anchored;
    unanchoredTotal += unanchored;
    if (!targets.length) continue;
    externalByModule[mod] = [...new Set([...(externalByModule[mod] || []), ...targets])].sort();
  }

  const fanOut = computeFanOut(edges, discovery.modules, externalByModule);

  return {
    applicable: true,
    indeterminate: null,
    module_discovery: {
      kind: discovery.kind,
      modules: discovery.modules.map((m) => m.name),
      reason: null,
    },
    cycles,
    fan_out: fanOut,
    change_coupling: collectChangeCoupling(repoDir, discovery, files, readText),
    external_targets: externalByModule,
    external_target_detection: {
      files_scanned: filesScannedForTargets,
      anchored_uri_literals: anchoredTotal,
      unanchored_uri_literals_rejected: unanchoredTotal,
      basis: 'URI literals count only at a recognised HTTP-client, base-URL, DB-connection or queue-publish call site; test/fixture/mock/bundle paths excluded',
    },
    graph: graphAudit,
  };
}

function resolveRepo(system) {
  const entry = systemConfig(system);
  if (!entry.repo) {
    throw new Error(`no repo for SYSTEM=${system} in ${configPath()}`);
  }
  return entry.repo;
}

function main() {
  // Verify the installed graphify matches the pinned version before running anything.
  const installedVersion = sh('graphify', ['--version']).trim().replace(/^graphify\s+/, '');
  if (installedVersion !== GRAPHIFY_VERSION) {
    throw new Error(
      `graphify version mismatch: want ${GRAPHIFY_VERSION}, got ${installedVersion}. ` +
      'Update GRAPHIFY_VERSION or install the correct version.'
    );
  }

  const system = process.env.SYSTEM;
  if (!system) throw new Error('SYSTEM env var is required');
  const repo = resolveRepo(system);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `scan-${system}-`));
  try {
    const repoDir = path.join(tmp, 'repo');
    const token = process.env.GH_TOKEN;
    const url = token
      ? `https://x-access-token:${token}@github.com/${repo}.git`
      : `https://github.com/${repo}.git`;

    // Clone with a caught error so the URL (which may carry a token) never
    // propagates to callers. Only the repo path is safe to log.
    try {
      sh('git', ['clone', '--depth', '1', url, repoDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      throw new Error(`git clone failed for ${repo} — check network and credentials`);
    }

    // Change coupling needs commit history, which a depth-1 clone does not have.
    // Backfill the window with commits and trees but NOT file contents:
    // --filter=blob:none keeps this cheap (218 commits of metadata on a real
    // monorepo) and the depth-1 working tree already holds the files graphify
    // reads, so nothing triggers a lazy blob fetch. A failure here is tolerated:
    // the coupling collector degrades to "not measured", never to a clean score.
    try {
      sh('git', ['fetch', '--quiet', '--filter=blob:none', `--shallow-since=${COUPLING_WINDOW_DAYS} days ago`, 'origin'],
        { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      process.stderr.write(`boundaries: ${system} — history backfill failed; change coupling will be unmeasured\n`);
    }

    const report = scanRepo(repoDir);
    const outDir = reportsDir(system);
    fs.writeFileSync(path.join(outDir, 'boundaries.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `boundaries: ${system} modules=${report.module_discovery.modules.length} `
      + `edges=${report.graph.edges} cycles=${report.cycles.count}`
      + `${report.indeterminate ? ' (indeterminate)' : ''}\n`
    );
  } finally {
    // Always remove the temp directory — success or failure — so the clone
    // (which may contain a plaintext token in .git/config) is never left on disk.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { scanRepo, resolveRepo, GRAPHIFY_VERSION, MAX_CYCLES };
