const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The scanning engine is distributed as its own repo that several organisations
// read from. That is only possible because nothing in scripts/benchmark/ reaches
// outside its own directory — it uses Node built-ins and js-yaml and nothing else.
//
// Today that is true by accident of how it was written. These tests make it true
// on purpose. Without them, an ordinary-looking `require('../../db/model')` added
// next month would not fail anything, and we would discover it while trying to
// move the directory — at which point the fix is untangling rather than a move.
//
// If one of these fails, the question is not "how do I satisfy the test" but
// "does this belong in a shared engine at all".

const ENGINE_DIR = path.join(__dirname, '..', '..', 'scripts', 'benchmark');

// Declared in scripts/benchmark/package.json. Anything outside this set and the
// Node built-ins would have to be installed by every org running the engine.
const ALLOWED_PACKAGES = new Set(['js-yaml']);

function engineFiles() {
  return fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'));
}

// Every file that travels with the engine, not just the JavaScript.
//
// Added 2026-08-11. The two checks above were extended once already, after they
// passed while the engine was unmovable — but both still only ever read `.js`.
// A shell script sat in this directory for weeks doing `cd ../..` and invoking a
// program that does not exist outside this repo, and nothing looked at it,
// because it was not JavaScript.
//
// Fifth time a check has covered one arm of a mechanism while its sibling went
// unwatched. The rule that keeps falling over is "guard the mechanism"; the rule
// that holds is "guard everything that moves".
function allEngineFiles() {
  return fs.readdirSync(ENGINE_DIR).filter((f) => !f.startsWith('.'));
}

function requiresIn(file) {
  const src = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
  // Deliberately a plain scan of require('...') rather than a parse. It reads
  // commented-out and string-literal cases too, which errs toward flagging
  // something harmless — the safe direction for a boundary check.
  return [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

test('no engine file requires anything outside its own directory', () => {
  const escapes = [];
  for (const file of engineFiles()) {
    for (const spec of requiresIn(file)) {
      if (!spec.startsWith('.')) continue; // package or built-in, checked below
      const resolved = path.resolve(ENGINE_DIR, spec);
      if (!resolved.startsWith(ENGINE_DIR + path.sep)) {
        escapes.push(`${file} → ${spec}`);
      }
    }
  }
  assert.deepStrictEqual(
    escapes,
    [],
    `these reach outside the engine and would break extraction:\n  ${escapes.join('\n  ')}`,
  );
});

test('the engine depends on no third-party package beyond what it declares', () => {
  const builtins = new Set(require('node:module').builtinModules);
  const undeclared = new Set();

  for (const file of engineFiles()) {
    for (const spec of requiresIn(file)) {
      if (spec.startsWith('.')) continue;
      const bare = spec.replace(/^node:/, '').split('/')[0];
      if (builtins.has(bare) || ALLOWED_PACKAGES.has(bare)) continue;
      undeclared.add(`${file} → ${spec}`);
    }
  }

  assert.deepStrictEqual(
    [...undeclared],
    [],
    `every org running the engine would have to install these:\n  ${[...undeclared].join('\n  ')}`,
  );
});

// Added 2026-08-07, after the two tests above passed while the engine was in
// fact unmovable.
//
// They only ever inspected `require()`. Nine files reached outside the engine a
// different way — computing a path upwards from __dirname and reading our list
// of systems, or writing results into a folder only this repo has. Two did it at
// import time, so the file could not even be loaded elsewhere. The guard was
// real and the hole was next to it: a boundary check that covers one mechanism
// and not its sibling reports a clean result for a directory that cannot move.
//
// Locations now arrive through engine-config.js, which reads them from the
// environment. Nothing else may compute its own way out.
test('no engine file computes a path outside its own directory', () => {
  const escapes = [];
  for (const file of engineFiles()) {
    const src = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    // Any __dirname joined with a parent segment. Deliberately textual, like
    // the require scan above: it over-flags rather than under-flags, which is
    // the safe direction for a boundary check.
    for (const m of src.matchAll(/__dirname[^)\n]*['"]\.\.['"]/g)) {
      escapes.push(`${file} → ${m[0].trim()}`);
    }
  }
  assert.deepStrictEqual(
    escapes,
    [],
    'these tie the engine to one repo\'s layout; take the location from '
    + `engine-config.js instead:\n  ${escapes.join('\n  ')}`,
  );
});

// Nested beside the engine here, at the repo root once extracted. Found by
// walking up rather than by hardcoding either, so this test is true in both
// layouts — and it throws rather than passing quietly if there is no manifest
// at all.
function engineManifest() {
  let dir = ENGINE_DIR;
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no package.json at or above ${ENGINE_DIR}`);
    dir = parent;
  }
}

test('the engine manifest declares exactly the packages the code uses', () => {
  // The manifest is what a consuming repo installs from. If it drifts from the
  // code, extraction produces a package that fails on first run in someone
  // else's org rather than here.
  assert.deepStrictEqual(
    Object.keys(engineManifest().dependencies || {}).sort(),
    [...ALLOWED_PACKAGES].sort(),
  );
});

test('nothing that travels with the engine climbs out of its directory', () => {
  // Any `../` at all, anywhere, in any file type. No delimiter requirement.
  //
  // The first version of this test required the `../` to follow whitespace, a
  // quote, a paren or an `=`, and it did NOT catch `cd "$(dirname "$0")/../.."`
  // — the very line that prompted writing it — because there a slash precedes
  // it. It passed, and it was blind, and the only reason that is not still true
  // is that it was run against a deliberate violation before being committed.
  const escapes = [];
  for (const file of allEngineFiles()) {
    const full = path.join(ENGINE_DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/\.\.\//g)) {
      const line = src.slice(0, m.index).split('\n').length;
      escapes.push(`${file}:${line}`);
    }
  }
  assert.deepStrictEqual(
    escapes,
    [],
    'these reach outside the engine and would not work in a standalone copy:\n  '
    + escapes.join('\n  '),
  );
});

test('the engine ships no program that calls something outside itself', () => {
  // The specific shape that got through: a driver script invoking a sibling of
  // the engine directory. A standalone copy has no such sibling, so the file is
  // broken by construction there while passing every test here.
  const offenders = [];
  for (const file of allEngineFiles()) {
    const full = path.join(ENGINE_DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/\bnode\s+(?!scripts\/benchmark\/)([A-Za-z0-9_.\/-]+\.js)/g)) {
      offenders.push(`${file} → node ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});
