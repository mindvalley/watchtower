-- 002 — mark a system as invented, so a demo board says so.
--
-- The overview has always had an "example data" notice, driven by an `example`
-- flag at the top of the board payload. It has been dead since the move to
-- Postgres: the assembler hardcoded `example: false`, so nothing could ever
-- switch it on. A fresh clone loading the optional mock data is exactly the
-- case it was written for, and the flag has to come from the data rather than
-- from a constant or the notice is decoration.
--
-- Defaults to false, so every real publish is unaffected and says nothing.

ALTER TABLE systems ADD COLUMN IF NOT EXISTS example BOOLEAN NOT NULL DEFAULT false;
