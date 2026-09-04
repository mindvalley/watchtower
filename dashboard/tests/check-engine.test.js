'use strict';

// The engine checker must never report success without having checked
// something. That is not a hypothetical: the disclosure test it wraps skips
// silently when no engine is supplied, which is right for a laptop test run and
// exactly wrong for a gate — and a gate that skips is not a gate.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKER = path.join(__dirname, '..', 'scripts', 'check-engine.js');
const run = (...args) => spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });

test('refuses when given nothing to check', () => {
  const r = run();
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /nothing to check/);
});

test('refuses a directory that is not an engine', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'not-an-engine-'));
  try {
    const r = run(empty);
    assert.notStrictEqual(r.status, 0, 'an empty directory must not pass');
    assert.match(r.stderr, /no engine at/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('refuses a directory that only looks like an engine', () => {
  // The marker file exists but nothing else does. Catches a half-copied or
  // half-deleted tree, which would otherwise report a clean sweep of almost no
  // files — the shape of every bad sweep in this project's history.
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'half-engine-'));
  try {
    fs.mkdirSync(path.join(fake, 'scripts', 'benchmark'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'scripts', 'benchmark', 'scan-security.js'), '// nothing\n');
    const r = run(fake);
    // It may pass or fail the disclosure content check, but it must not claim
    // to have checked an engine while the checks were skipped.
    assert.ok(!/INCONCLUSIVE/.test(r.stdout + r.stderr) || r.status !== 0,
      'an inconclusive run must not exit zero');
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
});
