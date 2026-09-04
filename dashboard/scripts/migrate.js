#!/usr/bin/env node
'use strict';
// Apply the schema migrations. Needs DATABASE_URL.
//
//   npm run migrate         create or update the tables
//   npm run migrate:mock    additionally load the invented demo board
//
// The two are separate commands because they are separate decisions: one gives
// you an empty board, the other gives you a board full of numbers that are not
// measurements of anything.
const { getPool } = require('../db/pool');
const { runMigrations, runMockData } = require('../db/migrate');

async function main() {
  const mock = process.argv.includes('--mock');
  const pool = getPool();
  try {
    const { applied } = await runMigrations(pool);
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'schema already up to date');
    if (mock) {
      const { loaded } = await runMockData(pool);
      console.log(`loaded mock data: ${loaded.join(', ')}`);
      console.log('The board will show an "example data" notice. That is deliberate.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
