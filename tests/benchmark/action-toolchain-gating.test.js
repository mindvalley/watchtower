'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// The decision of what to install is a pure function with its own tests, and it
// is worth nothing if action.yml stops asking. This reads the action the way
// GitHub does and asserts the wiring, because the failure mode is silent in
// both directions: a lost `if:` goes back to installing everything and nobody
// notices except the bill, and a lost step output makes every `if` false and
// every Elixir scan dies on an ENOENT for `mix`.

const ACTION = yaml.load(
  fs.readFileSync(path.join(__dirname, '..', '..', 'action.yml'), 'utf8'),
);
const STEPS = ACTION.runs.steps;
const indexOf = (pred) => STEPS.findIndex(pred);
const byUses = (prefix) => (s) => typeof s.uses === 'string' && s.uses.startsWith(prefix);

const DECIDER = indexOf((s) => s.id === 'toolchains');

test('a step reads the configuration and publishes the decision as outputs', () => {
  assert.notEqual(DECIDER, -1, 'no step with id `toolchains`');
  assert.match(STEPS[DECIDER].run, /required-toolchains\.js/);
});

// After setup-node deliberately: reading the config with the same Node the scan
// runs under rather than whatever the runner image ships.
test('the decision is made after Node and before any toolchain install', () => {
  const node = indexOf(byUses('actions/setup-node'));
  assert.ok(node !== -1 && node < DECIDER, 'the decider runs before setup-node');
  for (const prefix of ['erlef/setup-beam', 'ruby/setup-ruby']) {
    const at = indexOf(byUses(prefix));
    assert.ok(at > DECIDER, `${prefix} runs before the decision is made`);
  }
});

test('setup-beam is gated on the elixir decision', () => {
  const step = STEPS[indexOf(byUses('erlef/setup-beam'))];
  assert.equal(step.if, "steps.toolchains.outputs.elixir == 'true'");
});

test('setup-ruby is gated on the ruby decision', () => {
  const step = STEPS[indexOf(byUses('ruby/setup-ruby'))];
  assert.equal(step.if, "steps.toolchains.outputs.ruby == 'true'");
});

// Rubocop used to be the last line of the pinned-scanners block. Left there it
// would fall back to the runner image's system Ruby whenever setup-ruby was
// skipped, and install a gem nothing in the run is going to call.
test('rubocop is installed in its own step, gated the same way as Ruby itself', () => {
  const installers = STEPS.filter((s) => typeof s.run === 'string' && /gem install rubocop/.test(s.run));
  assert.equal(installers.length, 1, 'expected exactly one step installing rubocop');
  assert.equal(installers[0].if, "steps.toolchains.outputs.ruby == 'true'");
});

// These run on every scan regardless of stack, so gating one would be a silent
// hole in a criterion rather than a saving.
test('the language-agnostic scanners are not gated on anything', () => {
  const pinned = STEPS.find((s) => typeof s.run === 'string' && /GITLEAKS_VERSION=/.test(s.run));
  assert.ok(pinned, 'no step installing the pinned scanners');
  assert.equal(pinned.if, undefined);
  for (const tool of ['gitleaks', 'trivy', 'semgrep', 'lizard', 'graphifyy']) {
    assert.match(pinned.run, new RegExp(tool), `${tool} is no longer installed unconditionally`);
  }
});

test('the config path and both overrides are declared inputs', () => {
  for (const name of ['config', 'install-elixir', 'install-ruby']) {
    assert.ok(ACTION.inputs[name], `missing input: ${name}`);
  }
  assert.equal(ACTION.inputs['install-elixir'].default, 'auto');
  assert.equal(ACTION.inputs['install-ruby'].default, 'auto');
});
