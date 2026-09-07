const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { createApp } = require('../server');

test('GET / returns 200 with HTML', async () => {
  const res = await request(app).get('/');
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/html'));
});

test('every page in public/ is reachable without its extension', async () => {
  // /criteria for criteria.html, and so on. Walked from disk rather than listed,
  // because a listed route to a page that is not in the package is what a fresh
  // clone got until 2026-09-03: three routes serving 404.
  const fs = require('fs');
  const path = require('path');
  const PUBLIC = path.join(__dirname, '..', 'public');
  const pages = fs.readdirSync(PUBLIC)
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .map((f) => path.basename(f, '.html'));
  assert.ok(pages.length > 0, 'no pages found');

  for (const page of pages) {
    const res = await request(app).get(`/${page}`);
    assert.strictEqual(res.status, 200, `/${page} serves ${res.status}`);
  }
});

// One template now serves every system, and the database decides which names
// exist — so these use a fake provider rather than the real app. There used to
// be eleven of these tests, one per system, which is what a hardcoded fleet
// does to a test file: adding a system meant writing a page, a route entry and
// a test, and forgetting any of the three failed differently.
const boardOf = (keys) => ({
  quiet: true,
  provider: {
    hasSystem: async (k) => keys.includes(k),
    getBenchmark: async () => ({ last_updated: '2026-09-01', example: false, systems: {} }),
    getFindings: async () => ({}),
    getHistory: async () => ({ since: null, systems: {} }),
  },
});

test('a system the database holds gets the scorecard template', async () => {
  const fake = createApp(boardOf(['alpha', 'bravo-two', 'charlie-web']));
  for (const key of ['alpha', 'bravo-two', 'charlie-web']) {
    const res = await request(fake).get(`/system/${key}`);
    assert.strictEqual(res.status, 200, `/system/${key}`);
    assert.match(res.text, /\/system\/scorecard\.js/);
    // The page must not name the system: it reads its own key off the URL.
    assert.match(res.text, /initScorecard\(systemKeyFromPath\(\)\)/);
  }
});

test('a system the database does not hold is 404, not an empty scorecard', async () => {
  // The failure this prevents is quiet: serving the template for any name at
  // all renders a page that loads, finds nothing and shows a blank card, which
  // reads as "this system has no scores yet" rather than "no such system".
  const fake = createApp(boardOf(['alpha']));
  const res = await request(fake).get('/system/nonesuch');
  assert.strictEqual(res.status, 404);
});

test('a system added to the database needs no code change to get a page', async () => {
  // The whole point of the template. Same app shape, one more key.
  const before = await request(createApp(boardOf(['alpha']))).get('/system/delta');
  const after = await request(createApp(boardOf(['alpha', 'delta']))).get('/system/delta');
  assert.strictEqual(before.status, 404);
  assert.strictEqual(after.status, 200);
});

test('GET /criteria returns 200 (index)', async () => {
  const res = await request(app).get('/criteria');
  assert.strictEqual(res.status, 200);
});

test('GET /criteria/security-posture returns 200 (per-criterion page)', async () => {
  const res = await request(app).get('/criteria/security-posture');
  assert.strictEqual(res.status, 200);
});

test('GET /criteria/unknown-criterion returns 404 for an unknown criterion', async () => {
  const res = await request(app).get('/criteria/unknown-criterion');
  assert.strictEqual(res.status, 404);
});

test('GET /data/criteria-docs.json is valid and includes C9 with triage nuances', async () => {
  const res = await request(app).get('/data/criteria-docs.json');
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.text);
  const c9 = (data.criteria || []).find((c) => c.id === '9');
  assert.ok(c9, 'C9 entry missing');
  assert.strictEqual(c9.status, 'scored');
  assert.ok((c9.nuances || []).length >= 1, 'C9 should document its triage nuances');
});

test('GET /data/benchmark.json returns valid JSON with systems key', async () => {
  const fakeApp = createApp({ provider: { getBenchmark: async () => ({ last_updated: '2026-07-20', example: false, systems: { alpha: { score: 4 }, bravo: { score: 3 } } }), getFindings: async () => ({}) } });
  const res = await request(fakeApp).get('/data/benchmark.json');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.systems, 'missing systems key');
  assert.ok('alpha' in res.body.systems);
  assert.ok('bravo' in res.body.systems);
});

test('the scorecard template names no system anywhere in its markup', async () => {
  // What the eleven per-system pages made impossible. If a system key can be
  // found in here, the template has grown a fleet again.
  const res = await request(app).get('/system/scorecard.html');
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /\/system\/scorecard\.js/);
  assert.match(res.text, /initScorecard\(systemKeyFromPath\(\)\)/);
  assert.doesNotMatch(res.text, /initScorecard\(['"]/, 'the template hardcodes a system key');
});

test('the shared criterion list is served and includes the MVP criteria incl. C9', async () => {
  // The list moved out of scorecard.js so the overview could read it too. What
  // this has always checked is that the names reach the browser over HTTP, so
  // it follows them rather than being relaxed.
  const res = await request(app).get('/js/criteria.js');
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /Security Posture/);
  assert.match(res.text, /Documented APIs/);
});

test('every page using the criterion list loads it, and loads it first', async () => {
  // scorecard.js and index.html both read `window.Criteria` at parse time. A
  // page that ships one without the other throws on load and renders nothing —
  // the browser-only failure mode a Node test cannot otherwise see, so it is
  // checked as an ordering property of the served HTML instead.
  const pages = ['/index.html', '/system/scorecard.html'];

  for (const page of pages) {
    const res = await request(app).get(page);
    assert.strictEqual(res.status, 200, `${page} not served`);
    const criteria = res.text.indexOf('/js/criteria.js');
    assert.ok(criteria !== -1, `${page} does not load /js/criteria.js`);

    // Any use of the namespace, not one named function — the overview's first
    // caller changed once already and took this test down with it.
    const consumer = page === '/index.html'
      ? res.text.search(/\bCriteria\.\w/)
      : res.text.indexOf('/system/scorecard.js');
    assert.ok(consumer !== -1, `${page} does not use the criterion list`);
    assert.ok(criteria < consumer, `${page} loads /js/criteria.js after it is used`);
  }
});

test('GET /data/benchmark.json returns the provider payload', async () => {
  const payload = { last_updated: '2026-07-20', example: false, systems: { alpha: { score: 4 } } };
  const app = createApp({ provider: { getBenchmark: async () => payload, getFindings: async () => ({}) } });
  const res = await request(app).get('/data/benchmark.json');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, payload);
});

test('GET /data/findings-<system>.json returns the provider payload', async () => {
  const env = { generated_at: '2026-07-20', criteria: {} };
  const fake = createApp({
    provider: {
      hasSystem: async (k) => k === 'alpha',
      getBenchmark: async () => ({}),
      getFindings: async (k) => ({ ...env, system: k }),
    },
  });
  const res = await request(fake).get('/data/findings-alpha.json');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.system, 'alpha');
});

test('GET /data/findings-<unknown>.json is 404', async () => {
  const fake = createApp({
    provider: { hasSystem: async () => false, getBenchmark: async () => ({}), getFindings: async () => ({}) },
  });
  const res = await request(fake).get('/data/findings-unknown.json');
  assert.strictEqual(res.status, 404);
});

test('GET /data/history.json returns the provider payload', async () => {
  const payload = {
    since: '2026-08-03',
    systems: { alpha: { points: [{ date: '2026-08-03', score: 3.4 }], movement: null } },
  };
  const app = createApp({
    provider: { getBenchmark: async () => ({}), getFindings: async () => ({}), getHistory: async () => payload },
  });
  const res = await request(app).get('/data/history.json');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, payload);
});

test('GET /data/history.json is served by the app, not by a leftover file', async () => {
  // The DB-backed data routes are registered before express.static so they win
  // over anything sitting in public/data. History has no committed file today,
  // which is exactly when a route silently falling through to static is easiest
  // to miss — it would 404 rather than serve stale numbers, but the next person
  // to drop a history.json in there would get a fossil with nothing failing.
  const app = createApp({
    provider: {
      getBenchmark: async () => ({}),
      getFindings: async () => ({}),
      getHistory: async () => ({ since: null, systems: { fromProvider: { points: [], movement: null } } }),
    },
  });
  const res = await request(app).get('/data/history.json');
  assert.ok(res.body.systems.fromProvider, 'expected the provider payload, not a static file');
});

test('the loading helper is actually served at the path the pages ask for', async () => {
  // The failure this catches is total: a wrong path 404s, `Loading` is then
  // undefined, and every page throws on its first data call instead of just
  // losing its spinner.
  const res = await request(app).get('/js/loading.js');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.text, /function withLoading/);
});

test('every page loads the helper before it can call it', () => {
  // Walked from disk rather than listed here, so a page added later is covered
  // by this check on the day it appears rather than the day someone remembers.
  const fs = require('fs');
  const path = require('path');
  const pub = path.join(__dirname, '..', 'public');
  const pages = [
    ...fs.readdirSync(pub).filter((f) => f.endsWith('.html')).map((f) => path.join(pub, f)),
    ...fs.readdirSync(path.join(pub, 'system')).filter((f) => f.endsWith('.html')).map((f) => path.join(pub, 'system', f)),
  ];
  // Named, not counted. A count is a statement about how many pages this
  // particular installation happens to have — ours has three more than the
  // package does, and a floor of seven failed on a clean clone with five.
  for (const must of ['index.html', `system${path.sep}scorecard.html`]) {
    assert.ok(pages.some((p) => p.endsWith(must)), `${must} is missing from the page set`);
  }

  const missing = pages.filter((p) => !fs.readFileSync(p, 'utf8').includes('/js/loading.js'));
  assert.deepStrictEqual(missing, [], 'these pages do not load the loading helper');
});

test('every local asset a page references is actually served', async () => {
  // A broken href on an icon or stylesheet fails silently — the browser falls
  // back to a default and nothing is logged. Checked over HTTP rather than on
  // disk, so it also catches a file that exists but no route reaches.
  const fs = require('fs');
  const path = require('path');
  const PUBLIC = path.join(__dirname, '..', 'public');

  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(PUBLIC, 'system'))
      .filter((f) => f.endsWith('.html')).map((f) => `system/${f}`));

  const seen = new Map();
  for (const page of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (!/\.(css|js|png|svg|ico|woff2?)$/.test(ref)) continue; // pages, not assets
      if (!seen.has(ref)) seen.set(ref, page);
    }
  }
  assert.ok(seen.size >= 4, `expected several assets, found ${seen.size}`);

  for (const [ref, page] of seen) {
    const res = await request(app).get(ref);
    assert.strictEqual(res.status, 200, `${page} references ${ref}, which serves ${res.status}`);
    assert.ok(Number(res.headers['content-length'] || res.body.length) > 0, `${ref} is empty`);
  }
});
