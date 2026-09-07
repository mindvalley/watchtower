'use strict';
const fs = require('fs');
const path = require('path');

// Numbered, forward-only migrations with a ledger.
//
// WHAT THIS REPLACES. The schema used to be one file re-executed on every
// container boot, written entirely in CREATE IF NOT EXISTS and ALTER ... IF NOT
// EXISTS. That works until the day you need to rename a column, change a type
// or backfill a value — none of which can be expressed as "make sure this
// exists" — and nothing anywhere recorded what had been applied, so the only
// way to know the shape of a database was to read it.
//
// WHY BOOT STILL RUNS THEM. A managed database is often reachable only from the
// running service: the host injects a connection and there is no path in from
// outside, which is the property you want and also means there is nowhere to
// run a release step from. So the server applies pending migrations before it
// listens, exactly as it applied the schema before. The ledger makes every boot
// after the first a single SELECT. Set WATCHTOWER_MIGRATE_ON_BOOT=false if your
// host gives you somewhere better to run them.
//
// The advisory lock is not decoration: on a host that starts several
// containers from one deploy, they all reach this within the same second.

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const OPTIONAL_DIR = path.join(MIGRATIONS_DIR, 'optional');

// Any 64-bit constant will do; it only has to be the same in every instance.
const LOCK_KEY = 8148_2026;

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ''), file: path.join(dir, f) }));
}

function pending(all, applied) {
  return all.filter((m) => !applied.has(m.version));
}

// Applies each pending migration in its own transaction, recording it in the
// same transaction. A migration that throws leaves the ones before it applied
// and itself not — which is the only failure mode that can be reasoned about
// afterwards.
async function runMigrations(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(LEDGER);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const todo = pending(readDir(dir), applied);
    if (todo.length === 0) return { applied: [] };

    const done = [];
    for (const m of todo) {
      const sql = fs.readFileSync(m.file, 'utf8');
      const started = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        // Name the migration. "syntax error at or near" with no file attached
        // is the difference between a two-minute fix and an afternoon.
        err.message = `migration ${m.version} failed: ${err.message}`;
        throw err;
      }
      log(`migrated ${m.version} (${Date.now() - started}ms)`);
      done.push(m.version);
    }
    return { applied: done };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// The optional mock data, and the reason it has its own door.
//
// Structure and scores are different kinds of thing. A migration that invents
// numbers must never run by accident, so this is a separate command AND it
// refuses a database that already holds systems. The failure it exists to
// prevent is invented scores landing on a real board and being read as real —
// which is the same reason the history backfill skips boards flagged
// `example: true`.
async function runMockData(pool, { dir = OPTIONAL_DIR, log = console.log } = {}) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM systems');
  if (rows[0].n > 0) {
    throw new Error(
      `refusing to load mock data: this database already holds ${rows[0].n} system(s). `
      + 'Mock scores on a real board are indistinguishable from measurements. '
      + 'Empty the systems table first if you really meant it.',
    );
  }
  const files = readDir(dir);
  if (files.length === 0) throw new Error(`no mock data found in ${dir}`);
  for (const m of files) {
    await pool.query(fs.readFileSync(m.file, 'utf8'));
    log(`loaded ${m.version}`);
  }
  return { loaded: files.map((m) => m.version) };
}

module.exports = {
  runMigrations, runMockData, readDir, pending, MIGRATIONS_DIR, OPTIONAL_DIR,
};
