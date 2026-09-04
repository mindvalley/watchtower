'use strict';
const { Pool } = require('pg');

let pool;

// Lazy singleton — never connects at import time so tests that don't touch
// the DB (and the app's non-data routes) don't require DATABASE_URL.
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString });
  }
  return pool;
}

module.exports = { getPool };
