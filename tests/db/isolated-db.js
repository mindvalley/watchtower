'use strict';
const { Pool } = require('pg');
const { runMigrations } = require('../../db/migrate');

// A private schema per test file, so the integration tests stop fighting.
//
// THE BUG THIS FIXES WAS NOT NEW. Six test files each opened the same database,
// ran the schema, and then TRUNCATEd every table. The node test runner runs
// files in PARALLEL — one process per file, up to the core count — so file A
// would truncate the tables out from under file B mid-assertion. It has been
// like that since the integration tests were written.
//
// It passed anyway, and the reason is unnerving: a GitHub runner has two cores,
// so the runner's default concurrency is one or two files and the collisions
// mostly did not happen. Measured on 2026-09-03, on a laptop with more cores:
// the same suite on main fails 13, 14 and 16 tests on three consecutive runs.
// The suite was green by luck of hardware, and would have started failing the
// day the runners got bigger. It also means "clone it and run the tests" — the
// thing this package is supposed to offer — did not work.
//
// A schema rather than a database: no CREATE DATABASE privilege needed, no
// stray databases left behind, and search_path is set per connection so every
// unqualified name in the migrations and the queries lands in the right place.
async function isolatedPool(label) {
  const schema = `test_${String(label).replace(/\W+/g, '_')}`;

  // The schema has to exist before a pool can point search_path at it.
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await runMigrations(pool, { log: () => {} });
  // Still truncate: tests within one file share the schema and expect to start
  // from nothing. Across files it is now harmless.
  await pool.query('TRUNCATE systems, criterion_scores, findings, scan_history CASCADE');
  return pool;
}

module.exports = { isolatedPool };
