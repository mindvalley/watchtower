-- 003 — what the fleet's agents did, one row per run per system.
--
-- Agents (Oracle first) read a system and report what they found and what has
-- changed since their previous run: findings open, new, still open, and earlier
-- findings that were fixed, guarded or broke. That is the record of their
-- impact, so it is kept — like scan_history, rows are only ever added (or the
-- same run republished), never cleared by a score publish. replaceSystem must
-- never delete from here.
--
-- Counts only. What a finding says can describe a security weakness, and the
-- board is read more widely than the private repository that holds the run
-- folder, so the text stays there and this row carries a link to it. The ingest
-- validation refuses any field it does not know, which is what enforces this.

CREATE TABLE IF NOT EXISTS agent_runs (
  id            SERIAL PRIMARY KEY,
  system_id     INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  -- The run folder's own name (YYYY-MM-DD-HHMM), which orders a system's runs.
  run           TEXT NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  commit        TEXT,
  status        TEXT NOT NULL,
  model         TEXT NOT NULL,
  -- Whether this run was compared with an earlier one (step 5), and which.
  compared      BOOLEAN NOT NULL,
  previous_run  TEXT,
  counts        JSONB NOT NULL,
  cost_usd      DOUBLE PRECISION NOT NULL,
  run_url       TEXT NOT NULL,
  -- From the verified OIDC claim, never the body — as scan_history.published_by.
  published_by  TEXT,
  UNIQUE (system_id, agent, run)
);
