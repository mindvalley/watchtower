'use strict';

// Column-wise arrays for UNNEST — one round-trip per table instead of one per row.
function columns(items, pick) {
  return items.reduce((cols, item) => {
    pick(item).forEach((value, i) => cols[i].push(value));
    return cols;
  }, Array.from({ length: pick(items[0] ?? {}).length }, () => []));
}

// Seeds/refreshes the whole dataset in a fixed number of round-trips.
//
// This used to issue one statement per row — 144 of them for the current fleet,
// sequentially, inside one transaction. It runs on every container boot, and
// server.js does not listen until it resolves, so the round-trip count was the
// dominant cold-start cost. Batching makes it 3 statements plus BEGIN/COMMIT
// regardless of fleet size.
//
// Child rows resolve their system_id by joining `systems` on the natural key
// rather than resolving ids in JS. A row whose system is neither in this batch
// nor already stored simply fails to join, which would DROP it silently — the
// previous row-at-a-time code threw `unknown system_key` instead. `written`
// restores that: it compares affected rows against rows supplied and throws on
// any shortfall, so a mismatch fails the boot rather than publishing a
// quietly-incomplete board.
async function written(client, expected, sql, params, label) {
  const { rowCount } = await client.query(sql, params);
  if (rowCount !== expected) {
    throw new Error(`${label}: expected to write ${expected} rows, wrote ${rowCount} — unknown system_key in the batch?`);
  }
}

// Bulk write, in a fixed number of round-trips whatever the fleet size.
//
// This was the boot seed's writer and outlived it. It stays because it is the
// seam a local scan needs: stage 5's loader reads the files a laptop scan wrote
// and puts them here, through the same validation as /ingest and without a web
// request. Until then its only callers are tests, which is worth knowing.
async function upsertAll(pool, { systems = [], criteria = [], findings = [] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (systems.length) {
      const [keys, repos, stacks, tools, scores, colours, caps, coverages, assessed] = columns(systems,
        (s) => [s.system_key, s.repo ?? null, s.stack ?? null, s.sast_tool ?? null,
          s.score ?? null, s.colour ?? null, s.hard_capped ?? null, s.coverage ?? null, s.assessed_at ?? null]);
      await written(client, systems.length,
        `INSERT INTO systems (system_key, repo, stack, sast_tool, score, colour, hard_capped, coverage, assessed_at)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[],
                              $5::float8[], $6::text[], $7::bool[], $8::text[], $9::date[])
         ON CONFLICT (system_key) DO UPDATE
           SET repo = EXCLUDED.repo, stack = EXCLUDED.stack, sast_tool = EXCLUDED.sast_tool,
               score = EXCLUDED.score, colour = EXCLUDED.colour, hard_capped = EXCLUDED.hard_capped,
               coverage = EXCLUDED.coverage, assessed_at = EXCLUDED.assessed_at`,
        [keys, repos, stacks, tools, scores, colours, caps, coverages, assessed], 'systems');
    }

    if (criteria.length) {
      const [keys, ids, payloads, dates] = columns(criteria, (c) => [c.system_key, c.criterion_id, JSON.stringify(c.payload), c.scanned_at]);
      await written(client, criteria.length,
        `INSERT INTO criterion_scores (system_id, criterion_id, payload, scanned_at)
         SELECT s.id, d.criterion_id, d.payload, d.scanned_at
         FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::date[])
              AS d(system_key, criterion_id, payload, scanned_at)
         JOIN systems s ON s.system_key = d.system_key
         ON CONFLICT (system_id, criterion_id) DO UPDATE
           SET payload = EXCLUDED.payload, scanned_at = EXCLUDED.scanned_at`,
        [keys, ids, payloads, dates], 'criterion_scores');
    }

    if (findings.length) {
      const [keys, ids, payloads, dates] = columns(findings, (f) => [f.system_key, f.criterion_id, JSON.stringify(f.payload), f.generated_at]);
      await written(client, findings.length,
        `INSERT INTO findings (system_id, criterion_id, payload, generated_at)
         SELECT s.id, d.criterion_id, d.payload, d.generated_at
         FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::date[])
              AS d(system_key, criterion_id, payload, generated_at)
         JOIN systems s ON s.system_key = d.system_key
         ON CONFLICT (system_id, criterion_id) DO UPDATE
           SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at`,
        [keys, ids, payloads, dates], 'findings');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function fetchAll(pool) {
  // JOIN children back to systems so callers keep working in natural-key terms
  // (system_key) — the surrogate ids never leak past the repository boundary.
  const [systems, criteria, findings] = await Promise.all([
    pool.query(
      `SELECT system_key, repo, stack, sast_tool,
              score, colour, hard_capped, coverage, example,
              to_char(assessed_at, 'YYYY-MM-DD') AS assessed_at
       FROM systems ORDER BY system_key`,
    ),
    pool.query(
      `SELECT s.system_key, cs.criterion_id, cs.payload,
              to_char(cs.scanned_at, 'YYYY-MM-DD') AS scanned_at
       FROM criterion_scores cs JOIN systems s ON s.id = cs.system_id
       ORDER BY s.system_key, cs.criterion_id`,
    ),
    pool.query(
      `SELECT s.system_key, f.criterion_id, f.payload,
              to_char(f.generated_at, 'YYYY-MM-DD') AS generated_at
       FROM findings f JOIN systems s ON s.id = f.system_id
       ORDER BY s.system_key, f.criterion_id`,
    ),
  ]);
  return { systems: systems.rows, criteria: criteria.rows, findings: findings.rows };
}

// Scoped readers. fetchAll() pulls all three tables, which means serving
// benchmark.json dragged every findings payload out of the database and
// discarded it (rowsToBenchmark destructures only systems + criteria), and
// serving one system's findings pulled all eleven and filtered in JS. Each
// contract now reads only what it assembles from.
async function fetchBenchmarkRows(pool) {
  const [systems, criteria] = await Promise.all([
    pool.query(
      `SELECT system_key, repo, stack, sast_tool,
              score, colour, hard_capped, coverage, example,
              to_char(assessed_at, 'YYYY-MM-DD') AS assessed_at
       FROM systems ORDER BY system_key`,
    ),
    pool.query(
      `SELECT s.system_key, cs.criterion_id, cs.payload,
              to_char(cs.scanned_at, 'YYYY-MM-DD') AS scanned_at
       FROM criterion_scores cs JOIN systems s ON s.id = cs.system_id
       ORDER BY s.system_key, cs.criterion_id`,
    ),
  ]);
  return { systems: systems.rows, criteria: criteria.rows };
}

// Rows still carry system_key so rowsToFindings needs no change — its own
// filter becomes a no-op rather than a second, redundant source of truth.
async function fetchFindingsRows(pool, systemKey) {
  const { rows } = await pool.query(
    `SELECT s.system_key, f.criterion_id, f.payload,
            to_char(f.generated_at, 'YYYY-MM-DD') AS generated_at
     FROM findings f JOIN systems s ON s.id = f.system_id
     WHERE s.system_key = $1
     ORDER BY f.criterion_id`,
    [systemKey],
  );
  return { findings: rows };
}

async function replaceSystem(pool, { system, criteria = [], findings = [], publishedBy = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO systems (system_key, repo, stack, sast_tool, score, colour, hard_capped, coverage, assessed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (system_key) DO UPDATE
         SET repo = EXCLUDED.repo, stack = EXCLUDED.stack, sast_tool = EXCLUDED.sast_tool,
             score = EXCLUDED.score, colour = EXCLUDED.colour, hard_capped = EXCLUDED.hard_capped,
             coverage = EXCLUDED.coverage, assessed_at = EXCLUDED.assessed_at
       RETURNING id`,
      [system.system_key, system.repo ?? null, system.stack ?? null, system.sast_tool ?? null,
        system.score ?? null, system.colour ?? null, system.hard_capped ?? null,
        system.coverage ?? null, system.assessed_at ?? null],
    );
    const systemId = rows[0].id;

    // Full-replace this system's children — drops any stale criteria/findings.
    // NOTE: scan_history is deliberately absent from these DELETEs and must stay
    // absent. It is the only record that this system was ever anything other
    // than what it is right now.
    await client.query('DELETE FROM criterion_scores WHERE system_id = $1', [systemId]);
    await client.query('DELETE FROM findings WHERE system_id = $1', [systemId]);

    for (const c of criteria) {
      await client.query(
        `INSERT INTO criterion_scores (system_id, criterion_id, payload, scanned_at)
         VALUES ($1, $2, $3, $4)`,
        [systemId, c.criterion_id, c.payload, c.scanned_at],
      );
    }
    for (const f of findings) {
      await client.query(
        `INSERT INTO findings (system_id, criterion_id, payload, generated_at)
         VALUES ($1, $2, $3, $4)`,
        [systemId, f.criterion_id, f.payload, f.generated_at],
      );
    }

    // Append this publish to the history, in the SAME transaction as the write
    // it records. Two reasons it belongs here rather than in a step of its own:
    // a publish that fails half way leaves no history entry claiming it
    // happened, and history cannot drift out of step with the board because
    // there is no window in which one exists without the other. A guard that
    // ships separately from the thing it guards protects nothing — 13 August.
    //
    // Built from the rows being written, not from the request body, for the
    // same reason: the history says what was stored, not what was asked for.
    await client.query(
      `INSERT INTO scan_history
         (system_id, scanned_at, score, colour, hard_capped, coverage, criteria, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        systemId,
        system.assessed_at,
        system.score ?? null,
        system.colour ?? null,
        system.hard_capped ?? null,
        system.coverage ?? null,
        JSON.stringify(Object.fromEntries(criteria.map((c) => [c.criterion_id, c.payload]))),
        // From the verified claim on the request, handed down by handleIngest.
        // Never from the body — the point of it is that it cannot be claimed.
        publishedBy,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Where the history becomes comparable with itself, and therefore where a chart
// should start. Everything earlier is still stored — this hides noise, it does
// not delete evidence, the same shape as an allowance.
//
// 2026-08-03 is the first date on which every system was measured by ONE
// generation of the scanner with the full criterion set. Two things had to
// settle for that:
//
//   - the criteria stopped being added. C1 went live on all eleven on 30 July;
//     before that a rising score often just meant another criterion arriving.
//   - the rulers converged. The corrected complexity scanner reached the last
//     six systems on 3 August and moved them by around a point — for two days
//     the board carried five systems measured one way beside six measured
//     another.
//
// So a line drawn from 1 July mixes three separate things — coverage growing, a
// triage layer landing, and the scanner being corrected — in with real movement.
// One system reading 5.0 in July and 2.6 in August was almost entirely the
// first two.
//
// Coverage was the obvious alternative cutoff and does not work: in the fleet
// this was measured on, only four of eleven ever reached "7 of 7" — some
// systems have no boundary score at all and sit at 6 of 7 by an accepted
// decision. Checked before choosing.
//
// Override with WATCHTOWER_HISTORY_START; set it empty to show everything.
const HISTORY_START = process.env.WATCHTOWER_HISTORY_START ?? '2026-08-03';

// One system's scan history, oldest first — the shape a trend line reads.
// `criteria` comes back as the stored map so a past scorecard can be rebuilt,
// not just plotted.
//
// Ordered by time AND id. Measured rather than assumed: three consecutive
// publishes land 2–4ms apart, so the timestamp alone almost always separates
// them — but "almost always" is not an ordering. `id` is a SERIAL, so insertion
// order is recoverable even when two rows share a timestamp, which is also the
// case for backfilled boards that happen to share a commit time.
// `since` defaults to HISTORY_START; pass null explicitly for everything stored.
// Filtered on scanned_at rather than recorded_at because a reader asking for
// history "since August" means when the measurement was taken, not when the row
// happened to be written — and those differ for every backfilled board.
async function fetchScanHistory(pool, systemKey, { since = HISTORY_START } = {}) {
  const { rows } = await pool.query(
    `SELECT h.recorded_at,
            to_char(h.scanned_at, 'YYYY-MM-DD') AS scanned_at,
            h.score, h.colour, h.hard_capped, h.coverage, h.criteria, h.published_by
     FROM scan_history h JOIN systems s ON s.id = h.system_id
     WHERE s.system_key = $1
       AND ($2::date IS NULL OR h.scanned_at >= $2::date)
     ORDER BY h.recorded_at ASC, h.id ASC`,
    [systemKey, since || null],
  );
  return rows;
}

// The whole fleet's history in one statement — the shape the overview reads.
//
// Deliberately NOT `fetchScanHistory` in a loop. Eleven systems is eleven
// round-trips, and round-trips are what actually cost this service: the boot
// seed's 144 sequential statements were the cold-start problem, not the query
// planning. One statement, ordered once.
//
// It also selects far less. `criteria` is the whole stored criterion map —
// ~118kB per generation across the fleet — and a trend line needs none of it.
// Reading a column to throw it away is the `fetchAll` mistake: the overview
// used to pull 2.7MB of findings JSONB and discard 100% of it. A caller that
// wants to rebuild a past scorecard uses fetchScanHistory, which keeps the map
// for exactly that reason.
//
// Ordering and `since` follow the single-system reader, sharing HISTORY_START
// so the two cannot drift into disagreeing about where the trend begins.
async function fetchHistoryRows(pool, { since = HISTORY_START } = {}) {
  const { rows } = await pool.query(
    `SELECT s.system_key,
            to_char(h.scanned_at, 'YYYY-MM-DD') AS scanned_at,
            h.score, h.colour, h.hard_capped
     FROM scan_history h JOIN systems s ON s.id = h.system_id
     WHERE ($1::date IS NULL OR h.scanned_at >= $1::date)
     ORDER BY s.system_key ASC, h.recorded_at ASC, h.id ASC`,
    [since || null],
  );
  return rows;
}

// Insert history rows directly, with their own recorded_at. The ONLY caller is
// the one-off git backfill: ordinary publishes append through replaceSystem, in
// the transaction that writes the scores, and must keep doing so. Kept separate
// and named for its purpose so it cannot be mistaken for the normal path.
//
// Rows land against systems already in the table; a key that does not match
// fails to join and would vanish, so the row count is checked rather than
// trusted — same reasoning as `written` above.
async function backfillScanHistory(pool, entries) {
  if (!entries.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    for (const e of entries) {
      const { rowCount } = await client.query(
        `INSERT INTO scan_history
           (system_id, recorded_at, scanned_at, score, colour, hard_capped, coverage, criteria, published_by)
         SELECT s.id, $2, $3, $4, $5, $6, $7, $8, $9
         FROM systems s WHERE s.system_key = $1`,
        [e.system_key, e.recorded_at, e.scanned_at, e.score ?? null, e.colour ?? null,
          e.hard_capped ?? null, e.coverage ?? null, JSON.stringify(e.criteria), e.published_by ?? null],
      );
      if (rowCount !== 1) {
        throw new Error(`backfill: no system row for '${e.system_key}' — refusing to drop the entry silently`);
      }
      inserted += rowCount;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Does this installation hold this system? Used by the page and data routes to
// answer 404 for a name nobody has published, which is the question a compiled
// -in list of eleven keys used to answer — wrongly, from the moment a twelfth
// system published and nobody edited the array.
async function systemExists(pool, systemKey) {
  if (typeof systemKey !== 'string' || !systemKey) return false;
  const { rows } = await pool.query('SELECT 1 FROM systems WHERE system_key = $1', [systemKey]);
  return rows.length > 0;
}

module.exports = {
  upsertAll,
  replaceSystem,
  fetchAll,
  fetchBenchmarkRows,
  fetchFindingsRows,
  systemExists,
  fetchScanHistory,
  fetchHistoryRows,
  backfillScanHistory,
  HISTORY_START,
};
