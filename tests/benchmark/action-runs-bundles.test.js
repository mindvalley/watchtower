'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { bundleTargets } = require('../../scripts/build-bundles');

const ROOT = path.join(__dirname, '..', '..');
const ACTION = yaml.load(fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8'));
const STEPS = ACTION.runs.steps;
const RUN_STEPS = STEPS.filter((s) => typeof s.run === 'string');

test('every program the action runs is a committed bundle', () => {
  for (const { bundle } of bundleTargets()) {
    assert.ok(
      fs.existsSync(bundle),
      `${path.relative(ROOT, bundle)} is missing — run npm run build`,
    );
  }
});

test('the action runs bundles rather than the sources they are built from', () => {
  for (const step of RUN_STEPS) {
    assert.doesNotMatch(
      step.run,
      /node\s+"?\$\{?\{?[^"]*scripts\/benchmark\/[a-z0-9-]+\.js/,
      `step "${step.name}" still runs an unbundled source file`,
    );
  }
});

test('the engine no longer installs dependencies at run time', () => {
  const installs = RUN_STEPS.filter((s) => /npm (install|ci)/.test(s.run));
  assert.deepEqual(installs, []);
});

test('the handover check looks for a bundle', () => {
  const locate = STEPS.find((s) => s.id === 'locate');
  assert.match(locate.run, /dist\/scan-security\.js/);
});

test('CI rebuilds the bundles and fails on a difference', () => {
  const ci = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yaml'), 'utf8'));
  const steps = Object.values(ci.jobs).flatMap((job) => job.steps);
  const check = steps.find((s) => typeof s.run === 'string' && /npm run build/.test(s.run));

  assert.ok(check, 'no CI step rebuilds the bundles');
  assert.match(check.run, /git status --porcelain -- dist/);
  assert.match(check.run, /exit 1/);
});
