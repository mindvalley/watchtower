'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildIngestPayload } = require('../../scripts/benchmark/build-ingest-payload');

// The payload this builds must be indistinguishable from what the boot seed
// writes for the same system, or cutting a system over to /ingest would silently
// change its numbers. db/model.js filesToRows is the reference: scanned_at comes
// from the system's assessed_at, generated_at from the findings envelope, and
// both fall back to benchmark.last_updated when absent (the columns are NOT NULL).

const BENCHMARK = {
  last_updated: '2026-08-01',
  systems: {
    delta: {
      score: 4.4,
      colour: 'green',
      hard_capped: false,
      coverage: '2 of 7 assessed',
      assessed_at: '2026-08-03',
      criteria: { c8: { score: 5.0 }, c9: { score: 3.7 } },
    },
    charlie: {
      score: 3.0,
      colour: 'amber',
      hard_capped: false,
      coverage: '1 of 7 assessed',
      assessed_at: '2026-08-03',
      criteria: { c8: { score: 3.0 } },
    },
  },
};

const FINDINGS = {
  system: 'delta',
  generated_at: '2026-08-03',
  criteria: { c9: { locations: ['lib/a.ex'] } },
};

test('extracts one system and mirrors the seed’s field mapping', () => {
  const p = buildIngestPayload({ benchmark: BENCHMARK, findings: FINDINGS, systemKey: 'delta' });
  assert.deepStrictEqual(p, {
    system_key: 'delta',
    scanned_at: '2026-08-03',
    generated_at: '2026-08-03',
    score: 4.4,
    colour: 'green',
    hard_capped: false,
    coverage: '2 of 7 assessed',
    criteria: { c8: { score: 5.0 }, c9: { score: 3.7 } },
    findings: { c9: { locations: ['lib/a.ex'] } },
  });
});

test('carries no other system’s data', () => {
  const p = buildIngestPayload({ benchmark: BENCHMARK, findings: FINDINGS, systemKey: 'delta' });
  assert.deepStrictEqual(Object.keys(p.criteria).sort(), ['c8', 'c9']);
  assert.ok(!JSON.stringify(p).includes('1 of 7'), 'charlie’s composite must not leak into delta’s payload');
});

test('falls back to last_updated for both dates, exactly as filesToRows does', () => {
  const benchmark = { last_updated: '2026-08-01', systems: { delta: { criteria: { c8: {} } } } };
  const p = buildIngestPayload({ benchmark, findings: null, systemKey: 'delta' });
  assert.strictEqual(p.scanned_at, '2026-08-01');
  assert.strictEqual(p.generated_at, '2026-08-01');
});

test('a system with no findings file publishes an empty findings map, not a crash', () => {
  const p = buildIngestPayload({ benchmark: BENCHMARK, findings: null, systemKey: 'charlie' });
  assert.deepStrictEqual(p.findings, {});
  assert.deepStrictEqual(p.criteria, { c8: { score: 3.0 } });
});

test('refuses to build a payload with no criteria', () => {
  // /ingest full-replaces a system, so an empty criteria map does not mean
  // "change nothing" — it means "delete every score this system has". Refusing
  // here keeps a half-failed scan from blanking a system on the board.
  const benchmark = { last_updated: '2026-08-01', systems: { delta: { criteria: {} } } };
  assert.throws(
    () => buildIngestPayload({ benchmark, findings: null, systemKey: 'delta' }),
    /no criteria/,
  );
});

test('refuses an unknown system rather than publishing an empty one', () => {
  assert.throws(
    () => buildIngestPayload({ benchmark: BENCHMARK, findings: null, systemKey: 'nope' }),
    /unknown system/,
  );
});
