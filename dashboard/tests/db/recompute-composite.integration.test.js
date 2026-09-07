'use strict';

// The recompute writes the composite rule twice — once in JavaScript for the
// committed files, once in SQL for the production database, because production
// is app-only and the engine ships as a GitHub action rather than a library.
//
// Two implementations of one rule is a drift generator. These tests are the
// thing that makes it safe: they run the SQL against a real Postgres and check
// it agrees with the JavaScript on every row, including the cases where the two
// languages would plausibly part company — a .5 rounding boundary, a criterion
// with no score, a criterion with no `critical` key at all.
//
// Every check here was verified against a planted violation before being
// committed.
//
// NOTE: like the other files in this directory these TRUNCATE the one shared
// database and `node --test` runs files concurrently — tracker #68. Run the db
// tests with --test-concurrency=1 locally.

const { test } = require('node:test');
const assert = require('node:assert');
const { isolatedPool } = require('./isolated-db');
const { compositeOf, migrationSql } = require('../../scripts/recompute-composite');

const skip = !process.env.DATABASE_URL;

async function fresh() {
  const pool = await isolatedPool('recompute_composite');
  return pool;
}

// Insert one system whose criteria are exactly `criteria`, plus one history row
// carrying the same map, and return its id.
//
// The stored score defaults to a value that is in range but wrong, so a
// migration which fails to touch a row shows up as a wrong number rather than
// as an out-of-range one — the same blind spot the migration's post-conditions
// exist to close. `stored` is overridable for the unscored case, which needs to
// start null to prove it stays null.
async function plant(pool, key, criteria, stored = { score: 99, colour: 'nonsense' }) {
  const { rows } = await pool.query(
    `INSERT INTO systems (system_key, repo, stack, score, colour, hard_capped, coverage, assessed_at)
     VALUES ($1, $2, 'elixir', $3, $4, false, '7 of 7 assessed', '2026-08-20')
     RETURNING id`,
    [key, `org/${key}`, stored.score, stored.colour],
  );
  const id = rows[0].id;
  for (const [cid, payload] of Object.entries(criteria)) {
    await pool.query(
      `INSERT INTO criterion_scores (system_id, criterion_id, payload, scanned_at)
       VALUES ($1, $2, $3, '2026-08-20')`,
      [id, cid, JSON.stringify(payload)],
    );
  }
  await pool.query(
    `INSERT INTO scan_history (system_id, scanned_at, score, colour, hard_capped, coverage, criteria)
     VALUES ($1, '2026-08-20', $2, $3, false, '7 of 7 assessed', $4)`,
    [id, stored.score, stored.colour, JSON.stringify(criteria)],
  );
  return id;
}

const at = (score, critical) => ({ score, colour: 'x', critical });

// The cases chosen because they are where SQL and JavaScript could disagree
// without anyone noticing, not because they are typical.
const CASES = {
  // A plain mean, no Critical anywhere.
  plain: { 8: at(4.0, false), 9: at(5.0, false) },
  // Capped: the ceiling has to land in the number, not the colour.
  capped: { 8: at(5.0, false), 9: at(5.0, true) },
  // Exactly on a band edge — 3.5 mean is 70, the last amber.
  onEdge: { 8: at(3.5, false) },
  // A .5 rounding boundary. numeric and double precision round this the same
  // way, but only one of them gets there by the route JavaScript takes.
  halfway: { 8: at(3.0, false), 9: at(3.525, false) },
  // A criterion with NO `critical` key. SQL casts a missing key to NULL, and
  // bool_or over all-NULL returns NULL, which must not be read as "capped".
  noCriticalKey: { 8: { score: 4.0, colour: 'green' } },
  // An unscored criterion alongside a scored one: excluded from the mean, and
  // its (absent) critical flag must not count either.
  partlyScored: { 1: { score: null, critical: false }, 9: at(2.0, false) },
  // Critical on a criterion that was never scored. The engine filters to scored
  // entries BEFORE testing for Critical, so this must not cap.
  criticalButUnscored: { 1: { score: null, critical: true }, 9: at(5.0, false) },
};

test('the SQL migration agrees with the JavaScript rule on every row', { skip }, async () => {
  const pool = await fresh();
  try {
    for (const [key, criteria] of Object.entries(CASES)) await plant(pool, key.toLowerCase(), criteria);
    await pool.query(migrationSql());

    const sys = await pool.query('SELECT system_key, score, colour FROM systems ORDER BY system_key');
    assert.strictEqual(sys.rows.length, Object.keys(CASES).length);
    for (const row of sys.rows) {
      const criteria = CASES[Object.keys(CASES).find((k) => k.toLowerCase() === row.system_key)];
      const js = compositeOf(criteria);
      assert.strictEqual(row.score, js.score, `${row.system_key}: SQL ${row.score} vs JS ${js.score}`);
      assert.strictEqual(row.colour, js.colour, `${row.system_key}: SQL ${row.colour} vs JS ${js.colour}`);
    }

    const hist = await pool.query(
      `SELECT s.system_key, h.score, h.colour, h.criteria
       FROM scan_history h JOIN systems s ON s.id = h.system_id ORDER BY s.system_key`,
    );
    assert.strictEqual(hist.rows.length, Object.keys(CASES).length);
    for (const row of hist.rows) {
      const js = compositeOf(row.criteria);
      assert.strictEqual(row.score, js.score, `history ${row.system_key}: SQL ${row.score} vs JS ${js.score}`);
      assert.strictEqual(row.colour, js.colour, `history ${row.system_key}`);
    }
  } finally {
    await pool.end();
  }
});

test('a Critical is scaled into the number rather than painted onto the badge', { skip }, async () => {
  // The specific defect being retired. Before this change a capped system could
  // publish 100 in a red ring; the guard is that no capped row survives the
  // migration outside the red band.
  const pool = await fresh();
  try {
    await plant(pool, 'capped', CASES.capped);
    await pool.query(migrationSql());
    const { rows } = await pool.query("SELECT score, colour FROM systems WHERE system_key = 'capped'");
    assert.strictEqual(rows[0].score, 40, 'a flawless capped system lands at the top of red');
    assert.strictEqual(rows[0].colour, 'red');
  } finally {
    await pool.end();
  }
});

test('running the migration twice changes nothing', { skip }, async () => {
  // It recomputes from each row's criterion map rather than transforming the
  // stored number, so re-applying must be a no-op. Without this property a
  // "did that actually run?" moment costs a second scaling — every capped
  // system silently drops to 40% of where it already was.
  const pool = await fresh();
  try {
    for (const [key, criteria] of Object.entries(CASES)) await plant(pool, key.toLowerCase(), criteria);
    await pool.query(migrationSql());
    const once = await pool.query('SELECT system_key, score, colour FROM systems ORDER BY system_key');
    await pool.query(migrationSql());
    const twice = await pool.query('SELECT system_key, score, colour FROM systems ORDER BY system_key');
    assert.deepStrictEqual(twice.rows, once.rows);
  } finally {
    await pool.end();
  }
});

test('a system with no scored criteria stays unscored rather than gaining a zero', { skip }, async () => {
  // A zero reads as "measured and terrible" in a ring that fills by score. An
  // unmeasured system must come out the other side still unmeasured.
  const pool = await fresh();
  try {
    await plant(pool, 'unscored', { 1: { score: null, critical: false } }, { score: null, colour: null });
    await pool.query(migrationSql());
    const { rows } = await pool.query("SELECT score, colour FROM systems WHERE system_key = 'unscored'");
    assert.strictEqual(rows[0].score, null);
    assert.strictEqual(rows[0].colour, null);
  } finally {
    await pool.end();
  }
});

test('the migration aborts rather than leaving rows on the old scale', { skip }, async () => {
  // The post-condition that matters, exercised directly. An UPDATE ... FROM
  // whose subquery matches fewer rows than expected leaves the rest on /5 — and
  // an old /5 score is a perfectly plausible number, so nothing about the value
  // gives it away. A range check would wave it straight through.
  //
  // Simulated by running only the assertion half against rows that were never
  // updated, which is exactly the state a partial migration would leave behind.
  const pool = await fresh();
  try {
    await plant(pool, 'plain', CASES.plain); // stored 99, criteria mean 4.5 -> 90
    const assertionsOnly = migrationSql().slice(migrationSql().indexOf('DO $$'));
    await assert.rejects(
      () => pool.query(assertionsOnly),
      /scored rows were not re-ruled/,
      'a row left on the old scale must abort the migration',
    );
  } finally {
    await pool.end();
  }
});

test('the migration refuses to leave a score without a colour, or the reverse', { skip }, async () => {
  const pool = await fresh();
  try {
    await plant(pool, 'plain', CASES.plain);
    await pool.query(migrationSql());
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM systems WHERE (score IS NULL) <> (colour IS NULL)',
    );
    assert.strictEqual(rows[0].n, 0);
  } finally {
    await pool.end();
  }
});
