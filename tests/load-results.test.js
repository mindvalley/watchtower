'use strict';

// The loader must build exactly what /ingest would have received. If it did
// not, a system loaded from files and the same system published over HTTP would
// hold different numbers for a reason that had nothing to do with its code —
// and nothing would fail, because each path would be internally consistent.
//
// So these run the loader's output through the endpoint's own validator and
// compare its rows against the endpoint's own transform, rather than against a
// second description of what the rows should look like.

const { test } = require('node:test');
const assert = require('node:assert');
const { payloadFor, prepare } = require('../db/load-results');
const { validatePayload, payloadToRows } = require('../db/ingest');
const { criteriaIds } = require('../db/criteria');

const knownCriteria = criteriaIds();
const [C_A, C_B] = [...knownCriteria];

// A criterion payload scoring 4, which the composite rule turns into 80/green.
const scored = (score) => ({ score, colour: 'green', notes: [] });

function benchmarkWith(overrides = {}) {
  return {
    last_updated: '2026-09-01',
    systems: {
      billing: {
        assessed_at: '2026-09-01',
        score: 80,
        colour: 'green',
        hard_capped: false,
        coverage: '1 of 1 assessed',
        criteria: { [C_A]: scored(4) },
        ...overrides,
      },
    },
  };
}

const findingsFile = {
  generated_at: '2026-09-02',
  criteria: { [C_A]: { items: [{ id: 'x' }] } },
};

test('the payload is the one the endpoint accepts', () => {
  const payload = payloadFor({ benchmark: benchmarkWith(), findings: findingsFile, systemKey: 'billing' });
  assert.deepEqual(validatePayload(payload, { knownCriteria }), { ok: true });
  assert.equal(payload.scanned_at, '2026-09-01');
  assert.equal(payload.generated_at, '2026-09-02');
});

// Both are NOT NULL in the schema, and a scan can assemble without either.
test('missing dates fall back to the board date, as the engine builder does', () => {
  const benchmark = benchmarkWith({ assessed_at: undefined });
  const payload = payloadFor({ benchmark, findings: null, systemKey: 'billing' });
  assert.equal(payload.scanned_at, '2026-09-01');
  assert.equal(payload.generated_at, '2026-09-01');
  assert.deepEqual(payload.findings, {});
});

test('the rows are the endpoint transform, not a second description of it', () => {
  const benchmark = benchmarkWith();
  const registry = { repo: 'org/billing', stack: 'elixir', sast_tool: 'semgrep' };
  const [prepared] = prepare({
    benchmark,
    findingsFor: () => findingsFile,
    registryFor: () => registry,
    knownCriteria,
  });

  const payload = payloadFor({ benchmark, findings: findingsFile, systemKey: 'billing' });
  const expected = payloadToRows({ system_key: 'billing', ...registry }, payload);
  assert.deepEqual(prepared.rows, { ...expected, publishedBy: null });
});

// It is the verified identity of the repository that published. There is no
// such identity here, and writing "local" would put a value in a column whose
// entire meaning is that it was verified.
test('published_by is null rather than invented', () => {
  const [prepared] = prepare({
    benchmark: benchmarkWith(), findingsFor: () => null, knownCriteria,
  });
  assert.equal(prepared.rows.publishedBy, null);
});

// /ingest gets these from the allowlist. With no config given there is nothing
// to get them from, and null is what is actually known.
test('registry fields are null when no config is supplied', () => {
  const [prepared] = prepare({
    benchmark: benchmarkWith(), findingsFor: () => null, knownCriteria,
  });
  assert.equal(prepared.rows.system.repo, null);
  assert.equal(prepared.rows.system.stack, null);
  assert.equal(prepared.rows.system.sast_tool, null);
  assert.equal(prepared.rows.system.score, 80);
});

// A directory is one scan's output. Eleven systems with a malformed ninth would
// otherwise leave eight loaded and three not, with no way to tell which from
// the board.
test('one refused system stops the whole directory', () => {
  const benchmark = benchmarkWith();
  benchmark.systems.broken = { ...benchmark.systems.billing, criteria: {} };

  assert.throws(
    () => prepare({ benchmark, findingsFor: () => null, knownCriteria }),
    (err) => {
      assert.match(err.message, /nothing was loaded/);
      assert.match(err.message, /broken: criteria must not be empty/);
      // And it names how many of how many, so a single typo does not read as a
      // wholesale failure.
      assert.match(err.message, /1 of 2 systems/);
      return true;
    },
  );
});

// The engine may be on an older composite rule than this service. validatePayload
// already refuses that over HTTP; loading from files must not be the way round it.
test('a score that disagrees with its own criteria is refused here too', () => {
  const benchmark = benchmarkWith({ score: 42, colour: 'amber' });
  assert.throws(
    () => prepare({ benchmark, findingsFor: () => null, knownCriteria }),
    /disagrees with its own criteria/,
  );
});

test('an unknown criterion id is refused rather than stored', () => {
  const benchmark = benchmarkWith({ criteria: { 'c99-invented': scored(4) } });
  assert.throws(
    () => prepare({ benchmark, findingsFor: () => null, knownCriteria }),
    /unknown criteria criterion id: c99-invented/,
  );
});

test('--system loads a subset and leaves the rest alone', () => {
  const benchmark = benchmarkWith();
  benchmark.systems.web = { ...benchmark.systems.billing, criteria: { [C_B]: scored(4) } };

  const prepared = prepare({
    benchmark, findingsFor: () => null, only: ['web'], knownCriteria,
  });
  assert.deepEqual(prepared.map((p) => p.systemKey), ['web']);
});

// A typo in --system must not quietly load nothing and report success.
test('naming a system the board does not hold is an error, not a no-op', () => {
  assert.throws(
    () => prepare({
      benchmark: benchmarkWith(), findingsFor: () => null, only: ['ghost'], knownCriteria,
    }),
    /not in benchmark.json: ghost. It holds: billing/,
  );
});

test('a board with no systems is refused', () => {
  assert.throws(
    () => prepare({ benchmark: { systems: {} }, findingsFor: () => null, knownCriteria }),
    /holds no systems/,
  );
});

test('every system is loaded when none is named', () => {
  const benchmark = benchmarkWith();
  benchmark.systems.web = { ...benchmark.systems.billing, criteria: { [C_B]: scored(4) } };
  const prepared = prepare({ benchmark, findingsFor: () => null, knownCriteria });
  assert.deepEqual(prepared.map((p) => p.systemKey).sort(), ['billing', 'web']);
});
