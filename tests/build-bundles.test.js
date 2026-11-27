'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  isProgram, programs, bundleTargets,
} = require('../scripts/build-bundles');

test('a file is a program when running it with node does something', () => {
  assert.equal(isProgram('#!/usr/bin/env node\nconsole.log(1);\n'), true);
  assert.equal(isProgram('if (require.main === module) { main(); }\n'), true);
  assert.equal(isProgram('if (require.main===module) main();\n'), true);
});

test('a module that only exports is not a program', () => {
  assert.equal(isProgram("'use strict';\nmodule.exports = { bandFor };\n"), false);
});

test('the scan programs are bundled and the modules they require are not', () => {
  const found = programs();

  assert.ok(found.includes('scan-security.js'));
  assert.ok(found.includes('scan-boundaries.js'));
  assert.ok(found.includes('required-toolchains.js'));
  assert.ok(!found.includes('assemble-benchmark.js'));
  assert.ok(!found.includes('criterion-stacks.js'));
});

test('a program keeps its filename in dist', () => {
  const target = bundleTargets().find((t) => t.program === 'scan-security.js');

  assert.match(target.source, /scripts\/benchmark\/scan-security\.js$/);
  assert.match(target.bundle, /dist\/scan-security\.js$/);
});

// --- agents ----------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { agentAssets } = require('../scripts/build-bundles');
const { resolveAgentDir } = require('../agents/oracle/run');

const ROOT = path.join(__dirname, '..');

test('Oracle is bundled as dist/oracle.js, from the agent\'s run.js', () => {
  const target = bundleTargets().find((t) => t.program === 'oracle.js');
  assert.ok(target, 'no oracle.js bundle target');
  assert.match(target.source, /agents\/oracle\/run\.js$/);
  assert.match(target.bundle, /dist\/oracle\.js$/);
});

test('the files Oracle reads at run time are copied beside its bundle', () => {
  const assets = agentAssets().map((a) => path.relative(ROOT, a.to)).sort();
  assert.ok(assets.includes('dist/oracle/agent.json'), assets.join(', '));
  for (const prompt of ['audit', 'merge', 'verify', 'compare', 'recheck']) assert.ok(assets.includes(`dist/oracle/prompts/${prompt}.md`), prompt);
});

test('the committed copies of Oracle\'s prompts and defaults match their sources — a prompt change needs a rebuild', () => {
  for (const { from, to } of agentAssets()) {
    assert.ok(fs.existsSync(to), `${path.relative(ROOT, to)} is missing — run npm run build`);
    assert.equal(fs.readFileSync(to, 'utf8'), fs.readFileSync(from, 'utf8'), `${path.relative(ROOT, to)} is stale — run npm run build`);
  }
});

test('Oracle finds its defaults beside its source and beside its bundle', () => {
  assert.equal(resolveAgentDir(path.join(ROOT, 'agents/oracle')), path.join(ROOT, 'agents/oracle'));
  assert.equal(resolveAgentDir(path.join(ROOT, 'dist')), path.join(ROOT, 'dist/oracle'));
});

test('the Oracle bundle loads and runs on its own, without node_modules', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wt-oracle-bundle-'));
  fs.cpSync(path.join(ROOT, 'dist/oracle.js'), path.join(dir, 'oracle.js'));
  fs.cpSync(path.join(ROOT, 'dist/oracle'), path.join(dir, 'oracle'), { recursive: true });
  // Chunks ncc splits out of the bundle (loaded on demand) ship in dist/ too.
  for (const f of fs.readdirSync(path.join(ROOT, 'dist')).filter((n) => /^\d+\.index\.js$/.test(n))) fs.cpSync(path.join(ROOT, 'dist', f), path.join(dir, f));
  let err;
  try {
    execFileSync(process.execPath, [path.join(dir, 'oracle.js')], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  } catch (e) { err = e; }
  assert.ok(err, 'expected a non-zero exit without --system');
  assert.match(err.stderr, /Name a system/);
});
