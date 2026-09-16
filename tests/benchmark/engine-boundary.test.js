const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What anyone runs is dist/, one ncc bundle per program. ncc rewrites requires,
// so imports survive bundling. It does not rewrite what a program works out
// about its own location: in a bundle __dirname is dist/, not this directory.
// A file that climbs out of here builds clean and reads the wrong path at run
// time. These tests guard run-time reach.

const ENGINE_DIR = path.join(__dirname, '..', '..', 'scripts', 'benchmark');

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
      if (!spec.startsWith('.')) continue; // package or built-in, ncc resolves it
      const resolved = path.resolve(ENGINE_DIR, spec);
      if (!resolved.startsWith(ENGINE_DIR + path.sep)) {
        escapes.push(`${file} → ${spec}`);
      }
    }
  }
  assert.deepStrictEqual(
    escapes,
    [],
    `these pull code from outside the engine into every bundle:\n  ${escapes.join('\n  ')}`,
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

test('the engine ships no program that shells out to another script by path', () => {
  const offenders = [];
  for (const file of allEngineFiles()) {
    const full = path.join(ENGINE_DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n')
      .filter((line) => !/^\s*(\/\/|#|\*)/.test(line));
    for (const line of lines) {
      for (const m of line.matchAll(/\bnode\s+([A-Za-z0-9_.\/$'"{}-]*[A-Za-z0-9_-]\.js)/g)) {
        offenders.push(`${file} → node ${m[1]}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});
