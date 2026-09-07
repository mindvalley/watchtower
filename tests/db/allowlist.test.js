'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildAllowlist } = require('../../db/allowlist');

// The allowlist is the only thing between a verified caller and someone else's
// scores, so its shape is worth pinning hard.
//
// It used to map a repo to the one system it could write, which fit the original
// design of each target repo publishing itself. The model settled on instead is
// a watchtower repo per org that scans every system in that org, so a repo now
// maps to a SET and the payload names which system it is writing.
//
// That moves where identity comes from. It used to be read entirely from the
// verified claim, with the body unable to influence it. Now the body chooses and
// the claim bounds the choice. The property that must survive is narrower but
// still the one that matters: a caller can never write outside its own set.
//
// 2026-09-03: these were run against our real committed allowlist, which made
// the whole file private. They now use invented fixtures, which is not a
// weakening — the real file exercised one shape, and a fixture can exercise the
// ones that matter. The checks that genuinely need our file (that it agrees with
// our registry, and that every entry in it resolves) moved to
// tests/watchtower-config.test.js, which is about our fleet and stays here.

const TWO_ORGS = {
  'some-org/watchtower': [
    { system_key: 'alpha', repo: 'some-org/alpha', stack: 'elixir', sast_tool: 'semgrep' },
    { system_key: 'bravo', repo: 'some-org/bravo', stack: 'elixir', sast_tool: 'semgrep' },
  ],
  'other-org/watchtower': [
    { system_key: 'charlie', repo: 'other-org/charlie', stack: 'ts', sast_tool: 'semgrep' },
  ],
};

test('resolves a permitted system to its identity + metadata', () => {
  assert.deepStrictEqual(buildAllowlist(TWO_ORGS).resolve('some-org/watchtower', 'alpha'), {
    system_key: 'alpha', repo: 'some-org/alpha', stack: 'elixir', sast_tool: 'semgrep',
  });
});

test('refuses a system belonging to another org’s watchtower', () => {
  const al = buildAllowlist(TWO_ORGS);
  // A fully verified, legitimate caller — and still not allowed this system.
  assert.strictEqual(al.resolve('some-org/watchtower', 'charlie'), null);
  assert.strictEqual(al.resolve('other-org/watchtower', 'alpha'), null);
});

test('returns null for an unknown repo', () => {
  assert.strictEqual(buildAllowlist(TWO_ORGS).resolve('evil/repo', 'alpha'), null);
});

test('refuses a missing or non-string system key rather than picking one', () => {
  const al = buildAllowlist(TWO_ORGS);
  for (const bad of [undefined, null, 42, {}, ['alpha']]) {
    assert.strictEqual(al.resolve('some-org/watchtower', bad), null);
  }
});

test('does not treat inherited Object properties as entries', () => {
  const al = buildAllowlist(TWO_ORGS);
  assert.strictEqual(al.resolve('toString', 'alpha'), null);
  assert.strictEqual(al.resolve('constructor', 'alpha'), null);
  assert.strictEqual(al.resolve('some-org/watchtower', 'constructor'), null);
  assert.strictEqual(al.resolve('some-org/watchtower', '__proto__'), null);
});

test('lists what a caller may write', () => {
  const al = buildAllowlist(TWO_ORGS);
  assert.deepStrictEqual(al.systemsFor('other-org/watchtower'), ['charlie']);
  assert.deepStrictEqual(al.systemsFor('nobody/nothing'), []);
});

test('every entry resolves back to itself', () => {
  const al = buildAllowlist(TWO_ORGS);
  for (const [repository, systems] of Object.entries(TWO_ORGS)) {
    for (const s of systems) {
      assert.strictEqual(al.resolve(repository, s.system_key).system_key, s.system_key);
    }
  }
});

test('a malformed allowlist fails at build instead of refusing everything at runtime', () => {
  // The previous one-object-per-repo shape resolves to nothing under this
  // reader. That fails safe in that no bad data is written, but it presents as
  // every publish 403-ing with no clue why. Refusing to start is more honest.
  assert.throws(() => buildAllowlist({ 'some-org/alpha': { system_key: 'alpha' } }), /must be an array/);
  assert.throws(() => buildAllowlist({ 'some-org/x': [{ repo: 'a/b' }] }), /system_key/);
  // And a document of entirely the wrong shape, which is what a mis-set
  // environment variable most often produces.
  for (const bad of [null, undefined, 'a string', 42, [{ system_key: 'alpha' }]]) {
    assert.throws(() => buildAllowlist(bad), /expected an object/);
  }
});
