'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { rowsToBenchmark, rowsToFindings } = require('../../db/model');

// These used to load our eleven committed boards and assert the transforms
// reproduced them byte for byte. That was a strong check and an unshippable one:
// a fresh clone has no such files, so on 2026-09-03 the whole file failed on
// first run. Fixtures instead, built to exercise the same shapes — a system with
// every field set, one with nulls, a criterion with a nested payload.
//
// It also took `filesToRows` with it. That transform existed to turn committed
// JSON into rows for the boot seed, the boot seed is gone, and these tests were
// its only remaining caller.

const ROWS = {
  systems: [
    {
      system_key: 'alpha',
      repo: 'example-org/alpha',
      stack: 'elixir',
      sast_tool: 'semgrep',
      score: 85,
      colour: 'green',
      hard_capped: false,
      coverage: '7 of 7 assessed',
      assessed_at: '2026-09-01',
    },
    {
      // Everything optional missing: a system that is registered and never
      // scanned. It must read as ungrouped and unscored rather than as zero.
      system_key: 'bravo',
      repo: null,
      stack: null,
      sast_tool: null,
      score: null,
      colour: null,
      hard_capped: null,
      coverage: null,
      assessed_at: null,
    },
  ],
  criteria: [
    { system_key: 'alpha', criterion_id: '2', payload: { score: 4.2, colour: 'green', sub: { docs: { score: 4 } } }, scanned_at: '2026-09-01' },
    { system_key: 'alpha', criterion_id: '9', payload: { score: 1.5, colour: 'red', critical: true }, scanned_at: '2026-09-01' },
  ],
  findings: [
    { system_key: 'alpha', criterion_id: '9', payload: { label: 'Security Posture', groups: [{ sub: 'secrets', items: [{ file: 'config/x.yml' }] }] }, generated_at: '2026-09-01' },
    { system_key: 'bravo', criterion_id: '2', payload: { label: 'Documented APIs', groups: [] }, generated_at: '2026-09-01' },
  ],
};

test('rowsToBenchmark projects every stored field, and derives only the org', () => {
  const board = rowsToBenchmark(ROWS, { lastUpdated: '2026-09-01' });
  assert.strictEqual(board.last_updated, '2026-09-01');
  assert.strictEqual(board.example, false);

  assert.deepStrictEqual(board.systems.alpha, {
    org: 'example-org',
    stack: 'elixir',
    score: 85,
    colour: 'green',
    hard_capped: false,
    coverage: '7 of 7 assessed',
    assessed_at: '2026-09-01',
    criteria: {
      2: { score: 4.2, colour: 'green', sub: { docs: { score: 4 } } },
      9: { score: 1.5, colour: 'red', critical: true },
    },
  });

  // The repo path itself is never projected — the org is on the page already,
  // the repo is the part the public/private line protects.
  assert.ok(!('repo' in board.systems.alpha));
});

test('a registered but unscanned system reads as ungrouped and unscored', () => {
  const board = rowsToBenchmark(ROWS, { lastUpdated: '2026-09-01' });
  assert.deepStrictEqual(board.systems.bravo, {
    org: null, stack: null, score: null, colour: null,
    hard_capped: null, coverage: null, assessed_at: null, criteria: {},
  });
});

test('rowsToFindings returns one system envelope, keyed by criterion', () => {
  assert.deepStrictEqual(rowsToFindings(ROWS, 'alpha', { generatedAt: '2026-09-01' }), {
    system: 'alpha',
    generated_at: '2026-09-01',
    criteria: {
      9: { label: 'Security Posture', groups: [{ sub: 'secrets', items: [{ file: 'config/x.yml' }] }] },
    },
  });
});

test('rowsToFindings on a system with no findings is an empty envelope, not everything', () => {
  const out = rowsToFindings(ROWS, 'charlie', { generatedAt: '2026-09-01' });
  assert.deepStrictEqual(out.criteria, {});
  assert.strictEqual(out.system, 'charlie');
});

// --- the website reads, it does not compute --------------------------------

test('rowsToBenchmark serves the stored composite verbatim, even when it disagrees with the criteria', () => {
  // The point of the change. A stored score of 5.0 beside a single criterion
  // scoring 1.0 is arithmetically impossible, and the reader must still return
  // 5.0 — because if it recalculates, the number on the page is one no scan ever
  // produced, and a drift between the two definitions would show up as a wrong
  // board with nothing failing.
  //
  // If this test ever fails, something has started scoring at read time again.
  const rows = {
    systems: [{
      system_key: 'alpha',
      score: 5.0,
      colour: 'green',
      hard_capped: true,
      coverage: '7 of 7 assessed',
      assessed_at: '2026-08-11',
    }],
    criteria: [{ system_key: 'alpha', criterion_id: '8', payload: { score: 1.0 }, scanned_at: '2019-01-01' }],
  };
  const out = rowsToBenchmark(rows, { lastUpdated: '2026-08-11' }).systems.alpha;

  assert.strictEqual(out.score, 5.0);
  assert.strictEqual(out.colour, 'green');
  assert.strictEqual(out.hard_capped, true);
  assert.strictEqual(out.coverage, '7 of 7 assessed');
  // and assessed_at comes from the system row, not from the criterion's date
  assert.strictEqual(out.assessed_at, '2026-08-11');
});

test('db/model.js imports nothing from the scanning engine', () => {
  // This is what lets the engine be extracted into a public repo. The website
  // used to require the engine's assembler to rebuild each composite, which
  // would have dragged the engine into serving as well as scanning.
  //
  // A plain text scan on purpose: it reads commented-out and string cases too,
  // which over-flags rather than under-flags — the safe direction for a
  // boundary check. Same approach as the engine's own boundary guard.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'model.js'), 'utf8');
  const engineRequires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => m[1])
    .filter((spec) => spec.includes('scripts/benchmark') || spec.includes('/benchmark/'));
  assert.deepStrictEqual(engineRequires, []);
});
