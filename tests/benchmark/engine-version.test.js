'use strict';

// The engine records which ruler produced a number. A tag moves — `v1` has meant
// three different commits — so the tag alone cannot identify a measurement, and
// the digest is the part that actually does.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { engineVersion, digest, sourceFiles } = require('../../scripts/benchmark/engine-version');

test('the version names the requested ref and the engine that actually ran', () => {
  const before = process.env.GITHUB_ACTION_REF;
  try {
    process.env.GITHUB_ACTION_REF = 'v1';
    const v = engineVersion();
    assert.match(v, /^v1@[0-9a-f]{12}$/);
  } finally {
    if (before === undefined) delete process.env.GITHUB_ACTION_REF;
    else process.env.GITHUB_ACTION_REF = before;
  }
});

test('a run outside the action says local rather than inventing a version', () => {
  const before = process.env.GITHUB_ACTION_REF;
  try {
    delete process.env.GITHUB_ACTION_REF;
    // `local` is the honest answer for a laptop run: there is no version anyone
    // else could look up. The digest still identifies the code exactly.
    assert.match(engineVersion(), /^local@[0-9a-f]{12}$/);
  } finally {
    if (before !== undefined) process.env.GITHUB_ACTION_REF = before;
  }
});

test('the digest is stable across calls', () => {
  assert.strictEqual(digest(), digest());
});

test('the digest covers every file that can change a score', () => {
  const names = sourceFiles().map((f) => path.basename(f));
  // The scoring and scan programs.
  for (const f of ['score-security.js', 'scan-security.js', 'assemble-benchmark.js', 'parse-reports.js']) {
    assert.ok(names.includes(f), `${f} must be part of the engine's identity`);
  }
  // The Elixir AST helpers are not .js and still produce measurements.
  assert.ok(names.some((f) => f.endsWith('.exs')), 'the AST helpers change C2 scores');
  // The scanner pins: changing one changes the numbers, which is the case the
  // whole thing exists for. They live in the engine directory rather than in
  // action.yml precisely so the digest can cover them without the engine
  // reading above itself.
  assert.ok(names.includes('scanner-pins.json'), 'the scanner pins are part of the ruler');
  // Tests are not: they change no measurement, and including them would report
  // a new ruler every time someone adds a test.
  assert.ok(!names.some((f) => f.endsWith('.test.js')), 'tests must not change the digest');
});

test('changing a scoring file changes the digest', () => {
  // Verified against a real edit rather than asserted: a digest that does not
  // move when the code moves is worse than no digest, because it certifies
  // sameness that is not there.
  const target = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'score-security.js');
  const original = fs.readFileSync(target);
  const before = digest();
  try {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n// scoring change\n')]));
    assert.notStrictEqual(digest(), before, 'the digest must follow the code');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.strictEqual(digest(), before, 'and must come back when the change is reverted');
});

test('changing a scanner pin changes the digest', () => {
  const target = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'scanner-pins.json');
  const original = fs.readFileSync(target, 'utf8');
  const before = digest();
  try {
    const bumped = JSON.parse(original);
    bumped.pinned.lizard = '1.24.0';
    fs.writeFileSync(target, JSON.stringify(bumped, null, 2));
    assert.notStrictEqual(digest(), before, 'a new scanner version is a new ruler');
  } finally {
    fs.writeFileSync(target, original);
  }
  assert.strictEqual(digest(), before);
});

test('the pins the action installs are the pins that exist', () => {
  // The install step reads each version by name out of `pinned`. A rename here
  // and no rename there would make the step exit with 'no pin for x' at scan
  // time, which is a bad place to find out.
  const pins = require('../../scripts/benchmark/scanner-pins.json');
  const action = fs.readFileSync(path.join(__dirname, '..', '..', 'action.yml'), 'utf8');
  for (const name of ['gitleaks', 'trivy', 'semgrep', 'lizard', 'graphifyy']) {
    assert.ok(pins.pinned[name], `${name} must have a pinned version`);
    assert.ok(action.includes(`pin ${name}`), `action.yml must install ${name} from the pins file`);
  }
  // And the versions must not have been left behind as literals too, because a
  // second copy is a second answer.
  assert.ok(!/semgrep==1\./.test(action), 'action.yml still hardcodes a semgrep version');
  assert.ok(!/lizard==1\./.test(action), 'action.yml still hardcodes a lizard version');
});

test('the tools that are NOT pinned are named as such', () => {
  // Found 2026-08-20: rubocop, jscpd and credo resolve at run time, so two runs
  // of the same engine can measure Ruby complexity, duplication and Elixir
  // complexity differently. Recorded rather than quietly left — an engine that
  // claims to carry its own ruler has to say which parts of it float.
  const pins = require('../../scripts/benchmark/scanner-pins.json');
  assert.deepStrictEqual(Object.keys(pins.floating).sort(), ['credo', 'jscpd', 'rubocop']);
  for (const [name, note] of Object.entries(pins.floating)) {
    assert.ok(note && note.length > 10, `${name} needs a reason, not just a name`);
  }
});

test('the digest does not depend on where the engine is checked out', () => {
  // Paths go into the hash relative to the engine root, not absolutely — two
  // organisations running the same tag from different runner directories must
  // agree, or every score would carry a different ruler for no reason.
  const root = path.join(__dirname, '..', '..');
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-digest-'));
  try {
    fs.mkdirSync(path.join(copy, 'scripts', 'benchmark'), { recursive: true });
    for (const f of sourceFiles()) {
      const rel = path.relative(root, f);
      fs.copyFileSync(f, path.join(copy, rel));
    }
    const there = require('child_process')
      .execFileSync(process.execPath, ['-p', "require('./scripts/benchmark/engine-version').digest()"],
        { cwd: copy, encoding: 'utf8' }).trim();
    assert.strictEqual(there, digest());
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
