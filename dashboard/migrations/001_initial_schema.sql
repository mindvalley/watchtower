-- 001 — the schema as it stood on 2026-09-03.
--
-- Every statement here is idempotent (IF NOT EXISTS / IF EXISTS) because this
-- file spent its life being re-executed on every container boot, and it is kept
-- that way on purpose: it is the baseline, and it has to be safe to apply to a
-- database that already has all of it. Applying 001 to the live board is a
-- no-op that only writes the ledger row.
--
-- Migrations from 002 onward are ordinary forward-only changes and need not be
-- idempotent — the ledger stops them running twice.

CREATE TABLE IF NOT EXISTS systems (
  id          SERIAL PRIMARY KEY,
  system_key  TEXT NOT NULL UNIQUE,
  repo        TEXT,
  stack       TEXT,
  sast_tool   TEXT,
  -- The composite and its presentation, stored rather than derived. The scan
  -- already computes these; the website used to throw them away at the door and
  -- rebuild them from criterion_scores on every request, which put the scoring
  -- rules inside the web service. They are measurements, so they are written by
  -- whoever publishes and read back verbatim.
  --
  -- All nullable: ALTER cannot add a NOT NULL column to a table with rows, and
  -- there is no window where a null is served — app.listen() waits on the boot
  -- seed, which fills every one of them.
  --
  -- DOUBLE PRECISION, not NUMERIC: node-postgres returns NUMERIC as a string,
  -- which would fail the byte-identical parity check. float8 maps exactly onto a
  -- JavaScript number.
  score       DOUBLE PRECISION,
  colour      TEXT,
  hard_capped BOOLEAN,
  coverage    TEXT,
  assessed_at DATE
);

-- For databases created before the composite was stored.
ALTER TABLE systems ADD COLUMN IF NOT EXISTS score       DOUBLE PRECISION;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS colour      TEXT;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS hard_capped BOOLEAN;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS coverage    TEXT;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS assessed_at DATE;

CREATE TABLE IF NOT EXISTS criterion_scores (
  id           SERIAL PRIMARY KEY,
  system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  payload      JSONB NOT NULL,
  scanned_at   DATE NOT NULL,
  UNIQUE (system_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS findings (
  id           SERIAL PRIMARY KEY,
  system_id    INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  payload      JSONB NOT NULL,
  generated_at DATE NOT NULL,
  UNIQUE (system_id, criterion_id)
);

-- One row per system per publish. The three tables above hold what is true NOW:
-- /ingest full-replaces them, so until this existed a score that moved left no
-- record of where it moved from, and the board could say where a system stands
-- but never whether anything was improving.
--
-- The history used to exist by accident. Every published board between 8 June
-- and 11 August was a commit, so git held 29 of them. The 13 August migration
-- moved publishing off git and straight into this database and nothing replaced
-- that half; the scans of 12, 13, 17 and 18 August exist nowhere but CI
-- artifacts that expire.
--
-- APPEND-ONLY. Two rules hold it up, both pinned by tests:
--   1. replaceSystem DELETEs this system's criteria and findings before
--      inserting. It must never delete from here.
--   2. The boot seed must never write here. It runs on every container boot —
--      dozens per hour — restoring committed files, so seeding history would
--      manufacture thousands of entries for scans that never happened.
CREATE TABLE IF NOT EXISTS scan_history (
  id             SERIAL PRIMARY KEY,
  system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  -- When this row was stored. `scanned_at` is a DATE and several scans in one
  -- day is routine — three on 5 August, several on the 19th — so the scan's own
  -- date can neither order nor separate them. Defaulted, but settable, because
  -- the git backfill has to carry each board's real commit time.
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- What the scan itself claims, carried through unchanged.
  scanned_at     DATE NOT NULL,
  score          DOUBLE PRECISION,
  colour         TEXT,
  hard_capped    BOOLEAN,
  coverage       TEXT,
  -- The whole criterion map as published, not just the seven numbers. Keeping
  -- the payloads makes a past scorecard reconstructable down to its sub-metrics
  -- and audit trail, which is what makes "did fixing that help" answerable
  -- rather than just "the number moved". Measured, not assumed: one generation
  -- across the whole fleet is 118 kB, so a weekly scan costs ~6 MB a year.
  -- Findings are deliberately NOT here — they are 393 kB a generation and
  -- answer a different question.
  criteria       JSONB NOT NULL,
  -- WHO published this reading — the watchtower repository that posted it, in
  -- "org/repo" form. One row per (organisation, scan), so a fleet spread across
  -- several organisations stays attributable.
  --
  -- Taken from the VERIFIED OIDC claim on the request, never from the body. It
  -- is the same value the allowlist authorises against, so a watchtower cannot
  -- misreport who it is any more than it can write another organisation's
  -- system. That is what makes this an identity rather than a label.
  --
  -- NULL for rows recovered from git: those boards were assembled here before
  -- the organisations published for themselves, and attributing them to anyone
  -- would be inventing a fact.
  published_by   TEXT
);

-- For databases created before the publisher was recorded.
ALTER TABLE scan_history ADD COLUMN IF NOT EXISTS published_by TEXT;

-- An earlier version of this column recorded a hash of the engine's source
-- instead. It answered "which build of the tool ran", which is not the question
-- anyone had: the useful fact is which organisation produced a reading, and a
-- content hash is not a version number in any sense a reader would expect.
ALTER TABLE scan_history DROP COLUMN IF EXISTS engine_version;

-- Trends read one system newest-first; the fleet overview reads the latest row
-- per system. Both are served by this.
CREATE INDEX IF NOT EXISTS scan_history_system_time
  ON scan_history (system_id, recorded_at DESC);
