'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchBenchmarkRows, fetchFindingsRows } = require('../../db/repo');

// Fake pool that records every SQL string it is asked to run, so a test can
// assert on WHICH tables a reader touches — the property that matters here.
// A timing test would be flaky; this one is deterministic.
function recordingPool(resultFor = () => ({ rows: [] })) {
  const sql = [];
  const params = [];
  return {
    sql,
    params,
    query: async (text, values) => {
      sql.push(text);
      if (values) params.push(values);
      return resultFor(text);
    },
  };
}

test('fetchBenchmarkRows never reads the findings table', async () => {
  const pool = recordingPool();
  await fetchBenchmarkRows(pool);

  const all = pool.sql.join('\n');
  assert.ok(/FROM systems/i.test(all), 'expected the systems table to be read');
  assert.ok(/FROM criterion_scores/i.test(all), 'expected criterion_scores to be read');
  assert.ok(
    !/\bfindings\b/i.test(all),
    `benchmark assembly does not use findings, so it must not query them. SQL was:\n${all}`,
  );
});

test('fetchBenchmarkRows returns the shape rowsToBenchmark destructures', async () => {
  const pool = recordingPool((text) =>
    /FROM systems/i.test(text)
      ? { rows: [{ system_key: 'alpha', repo: 'org/alpha', stack: 'elixir', sast_tool: 'semgrep' }] }
      : { rows: [{ system_key: 'alpha', criterion_id: '9', payload: {}, scanned_at: '2026-07-30' }] });

  const rows = await fetchBenchmarkRows(pool);
  assert.deepStrictEqual(Object.keys(rows).sort(), ['criteria', 'systems']);
  assert.strictEqual(rows.systems.length, 1);
  assert.strictEqual(rows.criteria.length, 1);
});

test('fetchFindingsRows filters to one system in SQL, not in JS', async () => {
  const pool = recordingPool();
  await fetchFindingsRows(pool, 'alpha');

  const all = pool.sql.join('\n');
  assert.ok(/WHERE\s+s\.system_key\s*=\s*\$1/i.test(all), `expected a parameterised system filter. SQL was:\n${all}`);
  assert.deepStrictEqual(pool.params[0], ['alpha'], 'system key must be bound as a parameter, never interpolated');
  assert.ok(!/FROM criterion_scores/i.test(all), 'a findings read has no use for criterion_scores');
});

test('fetchFindingsRows returns rows carrying system_key so rowsToFindings is unchanged', async () => {
  const pool = recordingPool(() => ({
    rows: [{ system_key: 'alpha', criterion_id: '9', payload: { label: 'Secrets' }, generated_at: '2026-07-30' }],
  }));

  const rows = await fetchFindingsRows(pool, 'alpha');
  assert.deepStrictEqual(Object.keys(rows), ['findings']);
  assert.strictEqual(rows.findings[0].system_key, 'alpha');
});
