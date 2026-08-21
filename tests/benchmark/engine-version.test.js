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

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const CLEAR = { WATCHTOWER_ENGINE_REF: undefined, GITHUB_ACTION_REF: undefined, GITHUB_ACTIONS: undefined };

test('takes the ref the action exported', () => {
  // The action's locate step exports this. It cannot be read from
  // GITHUB_ACTION_REF where the publisher runs — that variable exists only
  // inside the action's own steps, and reading it there made every CI run
  // record itself as `local`. Found by running a real scan.
  withEnv({ ...CLEAR, WATCHTOWER_ENGINE_REF: 'v1', GITHUB_ACTIONS: 'true' }, () => {
    assert.match(engineVersion(), /^v1@[0-9a-f]{12}$/);
  });
});

test('falls back to GITHUB_ACTION_REF for anything run inside the action', () => {
  withEnv({ ...CLEAR, GITHUB_ACTION_REF: 'v2', GITHUB_ACTIONS: 'true' }, () => {
    assert.match(engineVersion(), /^v2@[0-9a-f]{12}$/);
  });
});

test('says unknown in CI with no ref — never local', () => {
  // The defect this shape removes. `local` in CI is not a missing detail, it
  // is a false statement about where a measurement came from.
  withEnv({ ...CLEAR, GITHUB_ACTIONS: 'true' }, () => {
    const v = engineVersion();
    assert.match(v, /^unknown@[0-9a-f]{12}$/);
    assert.ok(!v.startsWith('local@'), 'a CI run must never claim to be local');
  });
});

test('says local only when genuinely not in CI', () => {
  withEnv(CLEAR, () => {
    assert.match(engineVersion(), /^local@[0-9a-f]{12}$/);
  });
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

test('the action derives the ref from its own checkout path, and runs', () => {
  // Not a text assertion. The last two attempts at this both LOOKED right and
  // both produced nothing at run time — GITHUB_ACTION_REF is unset where the
  // publisher reads it, and `github.action_ref` expands to an empty string in a
  // composite action, so the export line became `WATCHTOWER_ENGINE_REF=`.
  //
  // So this extracts the actual shell out of action.yml and runs it against a
  // path shaped like the runner's, which is the only way to tell a line that
  // works from one that merely reads well.
  const action = fs.readFileSync(path.join(__dirname, '..', '..', 'action.yml'), 'utf8');
  const m = action.match(/ENGINE_REF="\$\(basename[\s\S]*?\n        fi\n/);
  assert.ok(m, 'expected the ref-derivation block in action.yml');

  const script = m[0].replace(/^ {8}/gm, '');
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gh-env-')), 'env');
  fs.writeFileSync(envFile, '');

  const res = require('child_process').spawnSync('bash', ['-c', script], {
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: '/home/runner/work/_actions/mindvalley/watchtower-engine/v1',
      GITHUB_ENV: envFile,
    },
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(fs.readFileSync(envFile, 'utf8').trim(), 'WATCHTOWER_ENGINE_REF=v1');
});

test('it writes nothing rather than writing blank', () => {
  // An empty value is the failure that already shipped once: it looks like the
  // export happened, and the engine cannot tell it from a missing one. Better
  // to write nothing, so `unknown` is reached honestly.
  const action = fs.readFileSync(path.join(__dirname, '..', '..', 'action.yml'), 'utf8');
  const script = action.match(/ENGINE_REF="\$\(basename[\s\S]*?\n        fi\n/)[0].replace(/^ {8}/gm, '');
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gh-env-')), 'env');
  fs.writeFileSync(envFile, '');

  require('child_process').spawnSync('bash', ['-c', script], {
    env: { ...process.env, GITHUB_ACTION_PATH: '/', GITHUB_ENV: envFile },
    encoding: 'utf8',
  });
  assert.strictEqual(fs.readFileSync(envFile, 'utf8').trim(), '',
    'a blank ref must not be exported at all');
});

test('the engine reads the name the action sets', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'engine-version.js'), 'utf8',
  );
  assert.ok(source.includes('WATCHTOWER_ENGINE_REF'), 'the two halves must agree on the name');
});
