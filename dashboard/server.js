const express = require('express');
const path = require('path');
const fs = require('fs');
const { getPool } = require('./db/pool');
const {
  fetchBenchmarkRows, fetchFindingsRows, fetchHistoryRows, replaceSystem, systemExists, HISTORY_START,
} = require('./db/repo');
const { rowsToBenchmark, rowsToFindings, rowsToHistory } = require('./db/model');
const { makeVerifier } = require('./db/ingest-auth');
const { buildAllowlist } = require('./db/allowlist');
const { handleIngest } = require('./db/ingest');
const { ingestConfig, displayNames } = require('./db/config');
const { criteriaIds, criteriaSlugs } = require('./db/criteria');

const PUBLIC = path.join(__dirname, 'public');

// There is no list of systems here any more. It used to be eleven keys in an
// array — the fleet, compiled into the web server — which decided both which
// pages existed and which data endpoints answered. The database knows which
// systems it holds, and it is the only thing that knows it correctly: a system
// published five minutes ago was not in that array until somebody edited it.
// Sized off real data, not guessed. The largest real body measured was 851KB,
// so the original 512KB rejected 2 of 11 systems outright and the 64KB
// per-criterion cap rejected 8. Both were set when the endpoint was written and
// only ever exercised against payloads the tests invented.
//
// 8MB is ~10x the largest observed body. It is deliberately not unbounded: the
// point of the cap is to bound how much JSON one request can make the service
// parse. The surface is small — nothing reaches this parser without first
// clearing IAP — and the failure is a loud 413 naming the limit, so a tenant
// that outgrows it finds out immediately rather than publishing partial data.
const INGEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const INGEST_BODY_LIMIT = `${INGEST_BODY_LIMIT_BYTES}b`;

// express.json that maps its own parse/size errors to 413/400 locally.
function ingestBodyParser() {
  const parser = express.json({ limit: INGEST_BODY_LIMIT });
  return (req, res, next) => parser(req, res, (err) => {
    if (!err) return next();
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload too large', limit_bytes: INGEST_BODY_LIMIT_BYTES });
    }
    return res.status(400).json({ error: 'invalid JSON body' });
  });
}

const CRITERIA_IDS = criteriaIds();
const CRITERIA_SLUGS = criteriaSlugs();

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Default provider: read all rows from Postgres and re-assemble the contracts.
function pgProvider() {
  return {
    async getBenchmark() {
      const rows = await fetchBenchmarkRows(getPool());
      const dates = rows.criteria.map((c) => c.scanned_at).filter(Boolean).sort();
      return rowsToBenchmark(rows, { lastUpdated: dates[dates.length - 1] || today() });
    },
    async hasSystem(systemKey) {
      return systemExists(getPool(), systemKey);
    },
    async getFindings(systemKey) {
      const rows = await fetchFindingsRows(getPool(), systemKey);
      const dates = rows.findings.map((f) => f.generated_at).filter(Boolean).sort();
      return rowsToFindings(rows, systemKey, { generatedAt: dates[dates.length - 1] || today() });
    },
    async getHistory() {
      const rows = await fetchHistoryRows(getPool());
      // The window is echoed back so the page states its own start date rather
      // than hardcoding one that could disagree with the query that ran.
      return rowsToHistory(rows, { since: HISTORY_START || null });
    },
  };
}

function createApp(deps = {}) {
  const provider = deps.provider || pgProvider();
  const app = express();

  // Ingest is off unless the operator has configured both halves of it. A
  // dashboard nobody has told who may write to it should not be accepting
  // authenticated writes, and a half-configured one should say so rather than
  // reject the whole fleet with a 401 that names no cause.
  // Injected verifier + allowlist means the caller has configured ingest by
  // hand, which is what every test does. Anything else asks the environment.
  const ingest = deps.ingest
    || ((deps.verifier && deps.allowlist) ? { enabled: true } : ingestConfig());
  const write = deps.write || ((rows) => replaceSystem(getPool(), rows));

  // Say which it is, at boot, once. A publish endpoint that is quietly off is
  // the failure mode this whole arrangement is most likely to produce, and the
  // fleet only finds out on the next scan.
  if (!deps.quiet) {
    console.log(ingest.enabled
      ? 'ingest: ENABLED'
      : `ingest: DISABLED — ${ingest.reason}. Publishes will be refused with 503.`);
  }

  if (ingest.enabled) {
    const verifier = deps.verifier || makeVerifier({ audience: ingest.audience });
    const allowlist = deps.allowlist || buildAllowlist(ingest.allowlist);
    app.post('/ingest', ingestBodyParser(), (req, res) =>
      handleIngest(req, res, { verifier, allowlist, knownCriteria: CRITERIA_IDS, write }));
  } else {
    app.post('/ingest', (req, res) => res.status(503).json({
      error: 'ingest is not configured on this installation',
      detail: ingest.reason,
    }));
  }

  // Display casing, when the operator supplies it. Served from configuration
  // rather than from a file in public/, because public/ is replaced wholesale
  // on every upstream release and this list names our fleet. A 404 is a normal
  // answer — the pages fall back to title-casing the keys.
  const names = deps.displayNames !== undefined ? deps.displayNames : displayNames();
  app.get('/data/display-names.json', (req, res) => (
    names ? res.json(names) : res.status(404).json({ error: 'no display names configured' })));

  // DB-backed data endpoints — registered BEFORE express.static so they win
  // over any leftover files in public/data.
  app.get('/data/benchmark.json', async (req, res, next) => {
    try { res.json(await provider.getBenchmark()); } catch (err) { next(err); }
  });
  app.get('/data/findings-:system.json', async (req, res, next) => {
    try {
      if (!await provider.hasSystem(req.params.system)) {
        return res.status(404).json({ error: 'unknown system' });
      }
      return res.json(await provider.getFindings(req.params.system));
    } catch (err) { return next(err); }
  });
  // Scan history for the whole fleet. Written since 2026-08-20 and, until now,
  // read by nothing but its own tests — the board could say where a system
  // stands and never whether it was moving.
  app.get('/data/history.json', async (req, res, next) => {
    try { res.json(await provider.getHistory()); } catch (err) { next(err); }
  });

  app.use(express.static(PUBLIC));

  app.get('/criteria/:slug', (req, res, next) => {
    if (!CRITERIA_SLUGS.has(req.params.slug)) return res.status(404).send('Not found');
    return res.sendFile('criteria-detail.html', { root: PUBLIC }, (err) => err && next());
  });
  // Extensionless URLs for whatever pages are actually present — /criteria for
  // criteria.html, and so on. This was one line per page, three of them naming
  // pages that do not travel with the package, so a fresh clone served routes
  // to files it did not have. Reading the directory instead keeps those three
  // working in our copy while upstream never learns they existed, with no
  // difference in the code. Registered after /criteria/:slug so the more
  // specific route still wins.
  for (const file of fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html') && f !== 'index.html')) {
    app.get(`/${path.basename(file, '.html')}`, (req, res, next) =>
      res.sendFile(file, { root: PUBLIC }, (err) => err && next()));
  }
  app.get('/system/:name/report', (req, res, next) => res.sendFile('system/report.html', { root: PUBLIC }, (err) => err && next()));

  // One template for every system, and the database decides which names exist.
  // The 404 is worth the lookup: without it a typo renders a page that loads,
  // finds nothing and shows an empty scorecard, which reads as "this system has
  // no scores" rather than "there is no such system".
  app.get('/system/:name', async (req, res, next) => {
    try {
      if (!await provider.hasSystem(req.params.name)) return res.status(404).send('Not found');
      return res.sendFile('system/scorecard.html', { root: PUBLIC }, (err) => err && next());
    } catch (err) { return next(err); }
  });

  app.use((req, res) => res.status(404).send('Not found'));
  return app;
}

const app = createApp();

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  // Apply pending migrations before listening. A managed database is often
  // reachable only from the running service, so there is nowhere else to run
  // them from; after the first boot this is one SELECT against the ledger.
  // Set WATCHTOWER_MIGRATE_ON_BOOT=false if your host gives you a release step.
  //
  // What used to be here as well was a data seed: every system's committed
  // scores loaded into the database on each of the dozens of boots an hour.
  // That was the publication path until 2026-08-13 and has been dead weight
  // since. It is gone. A fresh installation gets structure, not scores.
  const { runMigrations } = require('./db/migrate');
  const migrate = process.env.WATCHTOWER_MIGRATE_ON_BOOT === 'false'
    ? Promise.resolve({ applied: [] })
    : runMigrations(getPool());
  migrate
    .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Listening on ${PORT}`)))
    .catch((err) => { console.error('migrations failed', err); process.exit(1); });
}

module.exports = app;
module.exports.createApp = createApp;
// Exported so tests can assert the real committed payloads fit inside it.
module.exports.INGEST_BODY_LIMIT_BYTES = INGEST_BODY_LIMIT_BYTES;
