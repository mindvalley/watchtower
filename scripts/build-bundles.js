'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NCC_CLI = require.resolve('@vercel/ncc/dist/ncc/cli.js');
const PROGRAM_DIR = path.join(__dirname, 'benchmark');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const AGENTS_DIR = path.join(__dirname, '..', 'agents');

// Fleet agents bundled as dist/<name>.js. Each reads its defaults and prompts at
// run time, so those are copied to dist/<name>/ (see agentAssets). An agent may
// ship further programs beside its run.js, bundled as dist/<name>-<program>.js.
const AGENTS = ['oracle'];
const AGENT_PROGRAMS = { oracle: ['publish'] };

function isProgram(source) {
  return source.startsWith('#!') || /require\.main\s*===\s*module/.test(source);
}

function programs() {
  return fs.readdirSync(PROGRAM_DIR)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => isProgram(fs.readFileSync(path.join(PROGRAM_DIR, name), 'utf8')))
    .sort();
}

function bundleTargets() {
  return [
    ...programs().map((program) => ({
      program,
      source: path.join(PROGRAM_DIR, program),
      bundle: path.join(DIST_DIR, program),
    })),
    ...AGENTS.flatMap((name) => [
      {
        program: `${name}.js`,
        source: path.join(AGENTS_DIR, name, 'run.js'),
        bundle: path.join(DIST_DIR, `${name}.js`),
      },
      ...(AGENT_PROGRAMS[name] || []).map((extra) => ({
        program: `${name}-${extra}.js`,
        source: path.join(AGENTS_DIR, name, `${extra}.js`),
        bundle: path.join(DIST_DIR, `${name}-${extra}.js`),
      })),
    ]),
  ];
}

// An agent's agent.json and prompts/*.md, copied verbatim beside its bundle.
// Prompts are part of the measurement, so the copies are committed and checked.
function agentAssets() {
  return AGENTS.flatMap((name) => {
    const src = path.join(AGENTS_DIR, name);
    const prompts = fs.readdirSync(path.join(src, 'prompts')).filter((f) => f.endsWith('.md')).sort();
    return ['agent.json', ...prompts.map((f) => path.join('prompts', f))].map((rel) => ({
      from: path.join(src, rel),
      to: path.join(DIST_DIR, name, rel),
    }));
  });
}

// ncc always names its output index.js, so every program is built into dist/
// and then renamed. Assets a program reads at run time — the two .exs helpers —
// are emitted alongside it and keep resolving, because they end up in the same
// directory the bundle is read from.
function buildAll() {
  const targets = bundleTargets();
  fs.rmSync(DIST_DIR, { recursive: true, force: true });

  for (const { program, source, bundle } of targets) {
    process.stdout.write(`${program} -> ${path.relative(process.cwd(), bundle)}\n`);
    execFileSync(
      process.execPath,
      [NCC_CLI, 'build', source, '--out', DIST_DIR, '--target', 'es2024', '--no-source-map-register'],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    fs.renameSync(path.join(DIST_DIR, 'index.js'), bundle);
  }

  for (const { from, to } of agentAssets()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  process.stdout.write(`bundled ${targets.length} programs\n`);
}

if (require.main === module) {
  buildAll();
}

module.exports = {
  isProgram, programs, bundleTargets, agentAssets, buildAll,
};
