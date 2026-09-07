'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  requiredToolchains, missingToolchains, missingToolchainMessage,
} = require('../../scripts/benchmark/required-toolchains');

const cfg = (systems) => ({ systems });

// The case this whole thing exists for: an organisation with no Elixir systems
// was installing Elixir, OTP and Ruby on every run and never invoking them,
// while the scanner they were installed for already read the same declaration
// to decide it would not.
test('a config declaring neither stack installs neither toolchain', () => {
  const { toolchains } = requiredToolchains(cfg({
    web: { repo: 'org/web', stack: 'typescript' },
    api: { repo: 'org/api', stack: 'python' },
  }));
  assert.deepEqual(toolchains, { elixir: false, ruby: false });
});

// Nothing changes for a fleet that does declare them, which is the other half
// of the claim and the one that would be noticed if it were wrong.
test('a declared stack installs exactly its toolchain', () => {
  assert.deepEqual(
    requiredToolchains(cfg({ a: { stack: 'elixir' }, b: { stack: 'typescript' } })).toolchains,
    { elixir: true, ruby: false },
  );
  assert.deepEqual(
    requiredToolchains(cfg({ a: { stack: 'ruby' } })).toolchains,
    { elixir: false, ruby: true },
  );
  assert.deepEqual(
    requiredToolchains(cfg({ a: { stack: 'elixir' }, b: { stack: 'ruby' } })).toolchains,
    { elixir: true, ruby: true },
  );
});

test('the reasoning names the systems that asked for each toolchain', () => {
  const { why } = requiredToolchains(cfg({
    zeta: { stack: 'elixir' }, alpha: { stack: 'elixir' }, web: { stack: 'typescript' },
  }));
  assert.ok(why.some((l) => l === 'elixir: declared by alpha, zeta'), why.join(' | '));
  assert.ok(why.some((l) => l.startsWith('ruby: no system declares it')), why.join(' | '));
});

// An unreadable config must not quietly become "no toolchains". The scan would
// then die inside C8 on an ENOENT for `mix`, which reads as a broken engine
// rather than as an input the action was never pointed at.
test('no readable config installs everything, as it did before this existed', () => {
  for (const bad of [null, undefined, {}, { systems: null }, { systems: [] }, { systems: {} }]) {
    const { toolchains } = requiredToolchains(bad);
    assert.deepEqual(toolchains, { elixir: true, ruby: true }, `for ${JSON.stringify(bad)}`);
  }
});

// Absent is not evidence of absence, and C8 itself reads an undeclared stack as
// Elixir — so guessing the other way would break exactly the configs that are
// least specific about themselves.
test('a system with no declared stack installs everything and says which system', () => {
  const { toolchains, why } = requiredToolchains(cfg({
    web: { stack: 'typescript' },
    mystery: { repo: 'org/mystery' },
  }));
  assert.deepEqual(toolchains, { elixir: true, ruby: true });
  assert.ok(why.some((l) => l.includes('no stack declared for mystery')), why.join(' | '));
});

test('a stack nobody has a toolchain for is not an error, it just installs nothing', () => {
  const { toolchains } = requiredToolchains(cfg({ a: { stack: 'go' } }));
  assert.deepEqual(toolchains, { elixir: false, ruby: false });
});

test('stack lookup is prototype-safe', () => {
  const { toolchains } = requiredToolchains(cfg({ a: { stack: 'constructor' } }));
  assert.deepEqual(toolchains, { elixir: false, ruby: false });
});

// The escape hatch for the case the config cannot express: a repository whose
// material languages are not the stack it is declared as.
test('an override forces a toolchain on or off and records that it did', () => {
  const on = requiredToolchains(cfg({ a: { stack: 'typescript' } }), { ruby: 'true' });
  assert.deepEqual(on.toolchains, { elixir: false, ruby: true });
  assert.ok(on.why.some((l) => l === 'ruby forced on by install-ruby'), on.why.join(' | '));

  const off = requiredToolchains(cfg({ a: { stack: 'elixir' } }), { elixir: 'false' });
  assert.deepEqual(off.toolchains, { elixir: false, ruby: false });
  assert.ok(off.why.some((l) => l === 'elixir forced off by install-elixir'), off.why.join(' | '));
});

test("'auto', empty and absent all mean derive from the config", () => {
  for (const value of ['auto', '', undefined, null]) {
    assert.deepEqual(
      requiredToolchains(cfg({ a: { stack: 'elixir' } }), { elixir: value }).toolchains,
      { elixir: true, ruby: false },
      `for ${JSON.stringify(value)}`,
    );
  }
});

// A typo in a workflow must not be read as `false`. Silently skipping an
// install because someone wrote `yes` is the same failure this step was written
// to prevent, arriving through the fix for it.
test('an override that is not auto/true/false is refused rather than guessed', () => {
  assert.throws(
    () => requiredToolchains(cfg({ a: { stack: 'elixir' } }), { elixir: 'yes' }),
    /install-elixir must be 'auto', 'true' or 'false' — got 'yes'/,
  );
});

// --- the other end: what the config cannot see ----------------------------

const installed = (...present) => (binary) => present.includes(binary);

test('a material language whose tool is absent is named, with its line count', () => {
  const missing = missingToolchains(
    [{ language: 'typescript', tool: 'lizard', loc: 9000 },
      { language: 'ruby', tool: 'rubocop', loc: 2000 }],
    installed('lizard'),
  );
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0], {
    language: 'ruby', tool: 'rubocop', binary: 'rubocop', stack: 'ruby', loc: 2000,
  });
});

test('nothing is reported when every tool is present', () => {
  assert.deepEqual(
    missingToolchains(
      [{ language: 'elixir', tool: 'credo', loc: 100 }, { language: 'python', tool: 'lizard', loc: 100 }],
      installed('mix', 'lizard'),
    ),
    [],
  );
});

// Two languages sharing a binary should not ask about it twice — the check runs
// a process per binary and the message should read as one problem, not two.
test('one binary is only reported once however many languages need it', () => {
  const missing = missingToolchains(
    [{ language: 'javascript', tool: 'lizard', loc: 100 },
      { language: 'typescript', tool: 'lizard', loc: 200 },
      { language: 'python', tool: 'lizard', loc: 300 }],
    installed(),
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].binary, 'lizard');
});

// The message is the whole point of the check. A bare ENOENT on `mix` sends a
// reader looking at the engine; this has to send them to the declaration.
test('the message names both ways out when the tool is one the action gates', () => {
  const msg = missingToolchainMessage(
    missingToolchains([{ language: 'ruby', tool: 'rubocop', loc: 2000 }], installed()),
    { systemKey: 'billing', declaredStack: 'typescript' },
  );
  assert.match(msg, /C8 billing/);
  assert.match(msg, /ruby \(2000 lines\) needs rubocop, and rubocop is not installed/);
  assert.match(msg, /this system declares 'typescript'/);
  assert.match(msg, /install-ruby: true/);
  assert.match(msg, /Refusing to score this language as clean/);
});

// lizard is installed unconditionally, so its absence is a broken install and
// telling someone to declare a stack would send them the wrong way entirely.
test('an ungated tool is reported as a broken install, not a missing declaration', () => {
  const msg = missingToolchainMessage(
    missingToolchains([{ language: 'python', tool: 'lizard', loc: 700 }], installed()),
    { systemKey: 'api', declaredStack: 'python' },
  );
  assert.match(msg, /broken install rather than a missing declaration/);
  assert.doesNotMatch(msg, /install-/);
});

test('two missing toolchains are reported together', () => {
  const msg = missingToolchainMessage(
    missingToolchains(
      [{ language: 'elixir', tool: 'credo', loc: 5000 }, { language: 'ruby', tool: 'rubocop', loc: 900 }],
      installed(),
    ),
    { systemKey: 'monolith', declaredStack: 'typescript' },
  );
  assert.match(msg, /elixir \(5000 lines\)/);
  assert.match(msg, /ruby \(900 lines\)/);
  assert.match(msg, /install-elixir: true and install-ruby: true/);
  assert.match(msg, /Refusing to score these languages as clean/);
});
