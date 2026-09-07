// scripts/benchmark/scan-test-coverage.js
'use strict';

/*
 * Test-coverage scan (C6) — I/O entrypoint (the black-box edge). NOT unit-tested;
 * the testable logic is test-coverage-signals.js + score-test-coverage.js. Clones
 * ONE repo (shallow, by SYSTEM env) and writes reports/<system>/test-coverage.json
 * per the report contract: per-stack { source_files, tested_files, untested_samples,
 * tooling{tool,present,thresholds,enforced} }.
 *
 * Static/no-compile — walks the file tree + reads config/CI files only. Same
 * private-dep sidestep as C2/C4/C7/C8/C9.
 *
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = require('fs');
const path = require('path');
const {
  SKIP_DIRS, aggregateStack, detectThresholds, detectTool,
} = require('./test-coverage-signals');
const { classifyFile } = require('./layout-discovery');

const { reportsDir, systemTarget } = require('./engine-config');
const { materialise } = require('./target-tree');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const SAMPLE_CAP = 20;
const FRONTEND_MIN_FILES = 5; // fewer than this => no meaningful FE surface => omit stack (N/A)

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// Walk the repo, returning every file's rel path (skipping SKIP_DIRS).
function walkFiles(repoDir) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else {
        out.push(path.relative(repoDir, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(repoDir, 0);
  return out;
}

// Collect config/CI text relevant to coverage tooling for a stack.
function toolingText(repoDir, relFiles, stack) {
  const wanted = relFiles.filter((p) => {
    if (/(^|\/)\.github\/workflows\/.*\.ya?ml$/.test(p)) return true;   // minimum_coverage in CI (all stacks)
    if (/(^|\/)coveralls\.json$/.test(p)) return true;                  // excoveralls
    if (stack === 'elixir' && /(^|\/)mix\.exs$/.test(p)) return true;
    if (stack === 'ruby' && /(^|\/)(Gemfile|spec\/(spec|rails)_helper\.rb|\.simplecov)$/.test(p)) return true;
    if (stack === 'frontend' && /(^|\/)(package\.json|vitest\.config\.[jt]s|jest\.config\.[jt]s)$/.test(p)) return true;
    if (stack === 'python' && /(^|\/)(pyproject\.toml|setup\.cfg|pytest\.ini|tox\.ini|\.coveragerc|codecov\.ya?ml)$/.test(p)) return true;
    return false;
  });
  // Include the matched filenames alongside their contents: some tools are
  // signalled by a file's existence (e.g. coveralls.json) rather than a string
  // inside it, so detectTool must see the paths too.
  return `${wanted.join('\n')}\n${wanted.map((p) => readText(path.join(repoDir, p))).join('\n')}`;
}

const STACK_ORDER = ['elixir', 'ruby', 'python', 'frontend']; // backend-first, frontend-last (report key order)

function collectStacks(relFiles) {
  const byStack = {};
  for (const p of relFiles) {
    const { stack, role } = classifyFile(p);
    if (!stack || !role) continue;
    (byStack[stack] ||= { source: [], test: [] })[role].push(p);
  }
  return byStack;
}

function buildStack(repoDir, relFiles, stackKey, files) {
  if (!files.source.length) return null;
  const agg = aggregateStack(files.source, files.test, SAMPLE_CAP);
  const text = toolingText(repoDir, relFiles, stackKey);
  const thresholds = detectThresholds(text);
  const tool = detectTool(stackKey, text);
  return {
    ...agg,
    tooling: { tool, present: !!tool, thresholds, enforced: thresholds.length > 0 },
  };
}

function main() {
  const tree = materialise(systemTarget(SYSTEM), { prefix: `c6-${SYSTEM}`, token: GH_TOKEN });
  try {
    scan(tree, reportsDir(SYSTEM));
  } finally {
    // Previously left on disk with the token in its .git/config.
    tree.cleanup();
  }
}

function scan(tree, outDir) {
  const repoDir = tree.dir;
  for (const note of tree.notes) console.log(`  ${note}`);

  const relFiles = walkFiles(repoDir);
  const byStack = collectStacks(relFiles);
  const stacks = {};
  for (const key of STACK_ORDER) {
    if (!byStack[key]) continue;
    const s = buildStack(repoDir, relFiles, key, byStack[key]);
    if (!s) continue;
    if (key === 'frontend' && s.source_files < FRONTEND_MIN_FILES) continue; // FE noise gate (N/A)
    stacks[key] = s;
  }

  const report = { system: SYSTEM, applicable: Object.keys(stacks).length > 0, stacks };
  writeJson(outDir, 'test-coverage', report);

  const summary = Object.entries(stacks)
    .map(([k, s]) => `${k}:${s.tested_files}/${s.source_files}${s.tooling.enforced ? `+enf(${s.tooling.thresholds.join('/')})` : s.tooling.present ? '+cfg' : ''}`)
    .join(' ');
  console.log(`Scanned C6 ${SYSTEM} (${tree.label}) -> ${summary || 'no stacks'} -> ${outDir}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main };
