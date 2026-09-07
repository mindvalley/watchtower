-- OPTIONAL. An invented board, so a fresh clone shows a working dashboard
-- instead of an empty one.
--
-- Never runs by default. `npm run migrate` will not touch this directory;
-- `npm run migrate:mock` does, and refuses a database that already holds any
-- system. Invented scores sitting on a real board are indistinguishable from
-- measurements, and that is the failure this arrangement exists to prevent.
--
-- Everything here is deliberately fake and says so: the systems are named
-- alpha/bravo/charlie, the organisations are example-org and other-example,
-- and every row carries example = true, which lights the "example data" notice
-- across the top of the overview.
--
-- The composites are NOT invented independently of the criteria beneath them.
-- They are what the engine's rule produces from these criterion scores —
-- round(mean x 20), scaled by 0.4 when any criterion is Critical:
--
--   alpha-service  mean 4.2286 of [4.5 4.2 4.0 3.9 4.6 4.3 4.1]  -> 85 green
--   bravo-api      mean 3.0200 of [3.2 2.8 3.5 3.0 2.6]          -> 60 amber
--   charlie-web    mean 2.8167 of [3.8 3.1 2.9 3.4 2.2 1.5*]     -> 23 red
--                  * Critical, so x0.4 and hard-capped
--
-- A fixture whose headline disagrees with its own parts is a fixture that
-- teaches the reader something false about the product, and this codebase has
-- shipped one before. An integration test recomputes all three from the rows
-- this file inserts, so they cannot drift apart later.
--
-- Dates are relative to when you load it, so the demo does not age into a board
-- that was last scanned years ago.

INSERT INTO systems (system_key, repo, stack, sast_tool, score, colour, hard_capped, coverage, assessed_at, example) VALUES
  ('alpha-service', 'example-org/alpha-service',   'elixir',     'semgrep', 85, 'green', false, '7 of 7 assessed', (now() - interval '2 days')::date,  true),
  ('bravo-api',     'example-org/bravo-api',       'typescript', 'semgrep', 60, 'amber', false, '5 of 7 assessed', (now() - interval '2 days')::date,  true),
  ('charlie-web',   'other-example/charlie-web',   'ruby',       'semgrep', 23, 'red',   true,  '6 of 7 assessed', (now() - interval '9 days')::date,  true);

-- Criterion scores. Ids match criteria-docs.json: 1 boundaries, 2 documented
-- APIs, 4 observable state, 6 test coverage, 7 deployment safety, 8 simplicity,
-- 9 security. A criterion that is simply absent reads as unassessed, which is
-- why bravo has five and charlie six — that is the shape of a real fleet.
INSERT INTO criterion_scores (system_id, criterion_id, payload, scanned_at)
SELECT s.id, v.criterion_id, v.payload::jsonb, s.assessed_at
FROM systems s
JOIN (VALUES
  ('alpha-service', '1', '{"score":4.5,"colour":"green","critical":false,"assessed":true,"source":"Example data — module graph and cross-domain dependency analysis.","findings":["No dependency cycles between domains","Mean fan-out 3.1, inside the green band"]}'),
  ('alpha-service', '2', '{"score":4.2,"colour":"green","critical":false,"assessed":true,"source":"Example data — machine-readable API description and code currency.","findings":["OpenAPI description present and current"]}'),
  ('alpha-service', '4', '{"score":4.0,"colour":"green","critical":false,"assessed":true,"source":"Example data — four observability pillars.","findings":["Structured logging exercised","Tracing configured but not exercised in request paths"]}'),
  ('alpha-service', '6', '{"score":3.9,"colour":"green","critical":false,"assessed":true,"source":"Example data — test-to-source pairing and CI coverage enforcement.","findings":["Test breadth 78% (94 of 120 source files paired)"]}'),
  ('alpha-service', '7', '{"score":4.6,"colour":"green","critical":false,"assessed":true,"source":"Example data — progressive delivery, rollback and independent deployability.","findings":["Canary deploys configured","Automated rollback declared"]}'),
  ('alpha-service', '8', '{"score":4.3,"colour":"green","critical":false,"assessed":true,"source":"Example data — cyclomatic complexity density and duplication.","findings":["0 functions above the complexity threshold","Duplication 2.1% code-only"]}'),
  ('alpha-service', '9', '{"score":4.1,"colour":"green","critical":false,"assessed":true,"source":"Example data — SAST, secrets and dependency posture, triaged.","findings":["No confirmed secrets after triage"]}'),

  ('bravo-api', '1', '{"score":3.2,"colour":"amber","critical":false,"assessed":true,"source":"Example data — module graph and cross-domain dependency analysis.","findings":["2 dependency cycles between domains"]}'),
  ('bravo-api', '2', '{"score":2.8,"colour":"amber","critical":false,"assessed":true,"source":"Example data — machine-readable API description and code currency.","findings":["API description present but two endpoints undocumented"]}'),
  ('bravo-api', '6', '{"score":3.5,"colour":"amber","critical":false,"assessed":true,"source":"Example data — test-to-source pairing and CI coverage enforcement.","findings":["Test breadth 61% (52 of 85 source files paired)","Coverage tool configured, no threshold enforced"]}'),
  ('bravo-api', '8', '{"score":3.0,"colour":"amber","critical":false,"assessed":true,"source":"Example data — cyclomatic complexity density and duplication.","findings":["7 functions above the complexity threshold"]}'),
  ('bravo-api', '9', '{"score":2.6,"colour":"amber","critical":false,"assessed":true,"source":"Example data — SAST, secrets and dependency posture, triaged.","findings":["4 medium SAST findings awaiting triage"]}'),

  ('charlie-web', '1', '{"score":3.8,"colour":"green","critical":false,"assessed":true,"source":"Example data — module graph and cross-domain dependency analysis.","findings":["1 dependency cycle between domains"]}'),
  ('charlie-web', '2', '{"score":3.1,"colour":"amber","critical":false,"assessed":true,"source":"Example data — machine-readable API description and code currency.","findings":["API description is six months behind the routes"]}'),
  ('charlie-web', '4', '{"score":2.9,"colour":"amber","critical":false,"assessed":true,"source":"Example data — four observability pillars.","findings":["No distributed tracing","Frontend error tracking absent"]}'),
  ('charlie-web', '6', '{"score":3.4,"colour":"amber","critical":false,"assessed":true,"source":"Example data — test-to-source pairing and CI coverage enforcement.","findings":["Test breadth 58% (41 of 71 source files paired)"]}'),
  ('charlie-web', '8', '{"score":2.2,"colour":"amber","critical":false,"assessed":true,"source":"Example data — cyclomatic complexity density and duplication.","findings":["Duplication 11.4% code-only","19 functions above the complexity threshold"]}'),
  -- The Critical one. It is what scales the composite to 23 and hard-caps the
  -- card red, which is the behaviour a demo board most needs to show.
  ('charlie-web', '9', '{"score":1.5,"colour":"red","critical":true,"assessed":true,"source":"Example data — SAST, secrets and dependency posture, triaged.","findings":["2 confirmed secrets in the repository history","1 high-severity SAST finding confirmed"]}')
) AS v(system_key, criterion_id, payload) ON v.system_key = s.system_key;

-- Findings, so the report page has something to render. Items are flat objects;
-- the table columns are derived from their keys.
INSERT INTO findings (system_id, criterion_id, payload, generated_at)
SELECT s.id, v.criterion_id, v.payload::jsonb, s.assessed_at
FROM systems s
JOIN (VALUES
  ('bravo-api', '9', '{"label":"Security Posture","groups":[{"sub":"sast","label":"SAST findings","items":[{"rule":"example.hardcoded-config","file":"src/config/defaults.ts","line":"14","severity":"medium"},{"rule":"example.weak-random","file":"src/lib/token.ts","line":"31","severity":"medium"}]}]}'),
  ('charlie-web', '9', '{"label":"Security Posture","groups":[{"sub":"secrets","label":"Confirmed secrets","items":[{"kind":"api-key","file":"config/legacy.yml","line":"7","status":"confirmed"},{"kind":"password","file":"db/seeds.rb","line":"22","status":"confirmed"}]},{"sub":"sast","label":"SAST findings","disposition":"allowed","items":[{"rule":"example.sql-string-build","file":"app/reports/query.rb","line":"88","severity":"high"}]}]}'),
  ('charlie-web', '8', '{"label":"Codebase Simplicity","groups":[{"sub":"complexity","label":"Functions above the threshold","items":[{"function":"ReportBuilder#assemble","file":"app/reports/builder.rb","complexity":"31"},{"function":"WidgetSync#run","file":"app/jobs/widget_sync.rb","complexity":"24"}]}]}')
) AS v(system_key, criterion_id, payload) ON v.system_key = s.system_key;

-- Four weekly readings each, so the trend charts have a line to draw rather
-- than a single point. The last reading is the score on the card above, because
-- a trend that disagrees with the headline is worse than no trend.
INSERT INTO scan_history (system_id, recorded_at, scanned_at, score, colour, hard_capped, coverage, criteria, published_by)
SELECT s.id,
       now() - (v.weeks_ago || ' weeks')::interval,
       (now() - (v.weeks_ago || ' weeks')::interval)::date,
       v.score, v.colour, v.hard_capped, v.coverage, v.criteria::jsonb, 'example-org/watchtower'
FROM systems s
JOIN (VALUES
  ('alpha-service', 3, 78, 'green', false, '7 of 7 assessed', '{"1":{"score":4.1},"2":{"score":3.8},"4":{"score":3.6},"6":{"score":3.5},"7":{"score":4.4},"8":{"score":4.0},"9":{"score":3.9}}'),
  ('alpha-service', 2, 81, 'green', false, '7 of 7 assessed', '{"1":{"score":4.3},"2":{"score":4.0},"4":{"score":3.8},"6":{"score":3.7},"7":{"score":4.5},"8":{"score":4.1},"9":{"score":4.0}}'),
  ('alpha-service', 1, 83, 'green', false, '7 of 7 assessed', '{"1":{"score":4.4},"2":{"score":4.1},"4":{"score":3.9},"6":{"score":3.8},"7":{"score":4.6},"8":{"score":4.2},"9":{"score":4.0}}'),
  ('alpha-service', 0, 85, 'green', false, '7 of 7 assessed', '{"1":{"score":4.5},"2":{"score":4.2},"4":{"score":4.0},"6":{"score":3.9},"7":{"score":4.6},"8":{"score":4.3},"9":{"score":4.1}}'),

  ('bravo-api', 3, 52, 'amber', false, '4 of 7 assessed', '{"1":{"score":2.9},"2":{"score":2.4},"6":{"score":3.0},"8":{"score":2.1}}'),
  ('bravo-api', 2, 55, 'amber', false, '5 of 7 assessed', '{"1":{"score":3.0},"2":{"score":2.5},"6":{"score":3.1},"8":{"score":2.6},"9":{"score":2.5}}'),
  ('bravo-api', 1, 58, 'amber', false, '5 of 7 assessed', '{"1":{"score":3.1},"2":{"score":2.7},"6":{"score":3.3},"8":{"score":2.8},"9":{"score":2.6}}'),
  ('bravo-api', 0, 60, 'amber', false, '5 of 7 assessed', '{"1":{"score":3.2},"2":{"score":2.8},"6":{"score":3.5},"8":{"score":3.0},"9":{"score":2.6}}'),

  ('charlie-web', 3, 57, 'amber', false, '5 of 7 assessed', '{"1":{"score":3.5},"2":{"score":2.9},"4":{"score":2.7},"6":{"score":3.2},"8":{"score":2.0}}'),
  ('charlie-web', 2, 26, 'red',   true,  '6 of 7 assessed', '{"1":{"score":3.6},"2":{"score":3.4},"4":{"score":3.2},"6":{"score":3.5},"8":{"score":2.6},"9":{"score":3.2,"critical":true}}'),
  ('charlie-web', 1, 24, 'red',   true,  '6 of 7 assessed', '{"1":{"score":3.7},"2":{"score":3.2},"4":{"score":3.0},"6":{"score":3.4},"8":{"score":2.4},"9":{"score":2.4,"critical":true}}'),
  ('charlie-web', 0, 23, 'red',   true,  '6 of 7 assessed', '{"1":{"score":3.8},"2":{"score":3.1},"4":{"score":2.9},"6":{"score":3.4},"8":{"score":2.2},"9":{"score":1.5,"critical":true}}')
) AS v(system_key, weeks_ago, score, colour, hard_capped, coverage, criteria) ON v.system_key = s.system_key;
