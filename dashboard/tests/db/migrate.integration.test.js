'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const {
  runMigrations, runMockData, readDir, pending, MIGRATIONS_DIR,
} = require('../../db/migrate');
const { compositeOf } = require('../../db/composite');
const { isolatedPool } = require('./isolated-db');

const skip = !process.env.DATABASE_URL;

// A schema of its own for the migrator's own tests, created empty so the first
// run has something real to do.
async function emptySchema(label) {
  const schema = `test_${label}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
}

test('pending() is what has not been applied, in file order', () => {
  const all = [{ version: '001_a' }, { version: '002_b' }, { version: '003_c' }];
  assert.deepStrictEqual(pending(all, new Set()).map((m) => m.version), ['001_a', '002_b', '003_c']);
  assert.deepStrictEqual(pending(all, new Set(['001_a'])).map((m) => m.version), ['002_b', '003_c']);
  assert.deepStrictEqual(pending(all, new Set(['001_a', '002_b', '003_c'])), []);
});

test('the migrations are numbered, so their order is the file order', () => {
  const versions = readDir(MIGRATIONS_DIR).map((m) => m.version);
  assert.ok(versions.length > 0, 'no migrations found');
  for (const v of versions) {
    assert.match(v, /^\d{3}_/, `${v} is not numbered, so its position depends on how it sorts`);
  }
  assert.deepStrictEqual(versions, [...versions].sort(), 'readDir must return them in order');
});

test('the optional directory is not swept up by the ordinary run', () => {
  // If it were, `npm run migrate` would silently invent a board.
  const versions = readDir(MIGRATIONS_DIR).map((m) => m.version);
  assert.ok(!versions.some((v) => /mock/i.test(v)), 'mock data is in the default migration set');
});

test('a fresh database gets every migration, and a second run does nothing', { skip }, async () => {
  const pool = await emptySchema('migrate_fresh');
  try {
    const first = await runMigrations(pool, { log: () => {} });
    assert.deepStrictEqual(first.applied, readDir(MIGRATIONS_DIR).map((m) => m.version));

    const second = await runMigrations(pool, { log: () => {} });
    assert.deepStrictEqual(second.applied, [], 'a migration ran twice');

    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepStrictEqual(rows.map((r) => r.version), first.applied, 'the ledger disagrees with what ran');
  } finally {
    await pool.end();
  }
});

test('the baseline is safe to apply to a database that already has the schema', { skip }, async () => {
  // The live board's tables were created by the old re-run-on-boot file, so 001
  // will meet a database that already has all of it and must do nothing but
  // write its ledger row. Simulated by applying 001 by hand first.
  const pool = await emptySchema('migrate_baseline');
  try {
    const [first] = readDir(MIGRATIONS_DIR);
    await pool.query(fs.readFileSync(first.file, 'utf8'));
    await pool.query("INSERT INTO systems (system_key, score) VALUES ('already-here', 42)");

    const { applied } = await runMigrations(pool, { log: () => {} });
    assert.ok(applied.includes(first.version), 'the baseline was skipped, so the ledger is wrong');

    const { rows } = await pool.query('SELECT system_key, score FROM systems');
    assert.deepStrictEqual(rows, [{ system_key: 'already-here', score: 42 }], 'existing data was disturbed');
  } finally {
    await pool.end();
  }
});

test('a failing migration rolls back and names itself', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-migrations-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE landed (id int)');
  fs.writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE half (id int); NOT SQL AT ALL;');
  const pool = await emptySchema('migrate_failure');
  try {
    await assert.rejects(
      () => runMigrations(pool, { dir, log: () => {} }),
      /migration 002_broken failed/,
      'the error must name the file, or the message is a syntax error with no address',
    );
    // 001 stands, 002 left nothing behind, and the ledger says exactly that.
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1",
    );
    const names = tables.rows.map((r) => r.table_name);
    assert.ok(names.includes('landed'), 'the migration before the failure was rolled back too');
    assert.ok(!names.includes('half'), 'the failing migration left a table behind');
    const { rows } = await pool.query('SELECT version FROM schema_migrations');
    assert.deepStrictEqual(rows.map((r) => r.version), ['001_ok']);
  } finally {
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mock data refuses a database that already holds systems', { skip }, async () => {
  const pool = await isolatedPool('migrate_mock_guard');
  try {
    await pool.query("INSERT INTO systems (system_key, score) VALUES ('a-real-one', 71)");
    await assert.rejects(() => runMockData(pool, { log: () => {} }), /refusing to load mock data/);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM systems');
    assert.strictEqual(rows[0].n, 1, 'it wrote something before refusing');
  } finally {
    await pool.end();
  }
});

test('every mock composite is what the rule produces from its own criteria', { skip }, async () => {
  // The failure this prevents: a demo board whose headline disagrees with the
  // criteria beneath it, teaching everyone who clones this something false
  // about how the score works. This codebase has shipped exactly that fixture
  // before, and it passed because nothing compared the two.
  const pool = await isolatedPool('migrate_mock_data');
  try {
    await runMockData(pool, { log: () => {} });

    const systems = await pool.query('SELECT id, system_key, score, colour, hard_capped, example FROM systems');
    assert.strictEqual(systems.rows.length, 3, 'expected the three invented systems');

    for (const s of systems.rows) {
      assert.strictEqual(s.example, true, `${s.system_key} is not flagged as invented`);

      const { rows } = await pool.query(
        'SELECT criterion_id, payload FROM criterion_scores WHERE system_id = $1', [s.id],
      );
      const map = Object.fromEntries(rows.map((r) => [r.criterion_id, r.payload]));
      const expected = compositeOf(map);
      assert.strictEqual(s.score, expected.score, `${s.system_key}: card says ${s.score}, its criteria say ${expected.score}`);
      assert.strictEqual(s.colour, expected.colour, `${s.system_key}: colour disagrees with the score`);
      assert.strictEqual(
        s.hard_capped, Object.values(map).some((c) => c.critical),
        `${s.system_key}: hard_capped disagrees with whether any criterion is Critical`,
      );
    }

    // And the same for every point on the trend lines, because a history row
    // that disagrees with its own criteria is the same lie drawn as a chart.
    const history = await pool.query(
      'SELECT s.system_key, h.score, h.colour, h.hard_capped, h.criteria FROM scan_history h JOIN systems s ON s.id = h.system_id',
    );
    assert.ok(history.rows.length >= 12, `expected a trend per system, got ${history.rows.length} rows`);
    for (const h of history.rows) {
      const expected = compositeOf(h.criteria);
      assert.strictEqual(h.score, expected.score, `${h.system_key} history point: ${h.score} vs ${expected.score}`);
      assert.strictEqual(h.colour, expected.colour, `${h.system_key} history point colour`);
    }

    // A demo board must say it is one. The notice is driven by this flag and
    // was unreachable until 2026-09-03, because the assembler hardcoded false.
    const { rowsToBenchmark } = require('../../db/model');
    const { fetchBenchmarkRows } = require('../../db/repo');
    const board = rowsToBenchmark(await fetchBenchmarkRows(pool), { lastUpdated: '2026-09-03' });
    assert.strictEqual(board.example, true, 'the mock board does not declare itself an example');
  } finally {
    await pool.end();
  }
});
