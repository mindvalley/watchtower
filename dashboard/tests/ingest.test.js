'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../server');

const REPO = 'some-org/alpha-repo';
const okVerifier = { verify: async () => ({ repository: REPO }) };
const badVerifier = { verify: async () => { throw new Error('bad token'); } };
// One watchtower may write 'alpha' and nothing else — the set happens to
// have one member, which is exactly the case that must still behave.
const allowlist = {
  resolve: (r, s) => (r === REPO && s === 'alpha'
    ? { system_key: 'alpha', repo: REPO, stack: 'elixir', sast_tool: 'semgrep' }
    : null),
};
// The composite must agree with the criteria beside it — one scored criterion
// at 4.0 out of 5 is 80 out of 100, which is green. This fixture used to say
// 4.0/green, a payload no scan could produce, and it passed because nothing
// checked the two against each other.
const goodBody = {
  system_key: 'alpha',
  scanned_at: '2026-07-23', generated_at: '2026-07-23',
  score: 80, colour: 'green', hard_capped: false, coverage: '1 of 7 assessed',
  criteria: { '2': { score: 4 } }, findings: { '2': { groups: [] } },
};

function appWith(overrides = {}) {
  const writes = [];
  const app = createApp({
    provider: { getBenchmark: async () => ({}), getFindings: async () => ({}) },
    verifier: overrides.verifier || okVerifier,
    allowlist: overrides.allowlist || allowlist,
    write: overrides.write || (async (rows) => { writes.push(rows); }),
  });
  return { app, writes };
}

test('200 writes the system and returns counts', async () => {
  const { app, writes } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't').send(goodBody);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { system_key: 'alpha', criteria: 1, findings: 1 });
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].system.system_key, 'alpha');
});

test('401 when the token is missing', async () => {
  const { app } = appWith();
  const res = await request(app).post('/ingest').send(goodBody);
  assert.strictEqual(res.status, 401);
});

test('401 when the token fails verification', async () => {
  const { app } = appWith({ verifier: badVerifier });
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't').send(goodBody);
  assert.strictEqual(res.status, 401);
});

test('403 when the repository is not allowlisted', async () => {
  const { app } = appWith({ verifier: { verify: async () => ({ repository: 'evil/repo' }) } });
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't').send(goodBody);
  assert.strictEqual(res.status, 403);
});

test('400 with a reason on an invalid payload', async () => {
  const { app, writes } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, criteria: { '999': {} } });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.reason, /unknown/);
  assert.strictEqual(writes.length, 0);
});

test('413 when the body exceeds the size cap', async () => {
  // Derived from the limit rather than hardcoded. This test was written with a
  // literal 600KB against a 512KB cap; when the cap was raised to fit real
  // findings the literal silently became a passing 200, so the test stopped
  // testing anything. Anchor the fixture to the constant it is checking.
  const { INGEST_BODY_LIMIT_BYTES } = require('../server');
  const { app } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, criteria: { '2': { blob: 'x'.repeat(INGEST_BODY_LIMIT_BYTES + 1024) } } });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.body.limit_bytes, INGEST_BODY_LIMIT_BYTES, 'the 413 tells the caller the limit');
});

// The body now names the system, so it can no longer be ignored outright. The
// property that replaces "identity comes only from the claim" is stricter about
// what matters: naming a system outside the caller's set is refused, not
// silently rewritten to one it is allowed. Silently rewriting would let a
// mis-configured watchtower publish one system's scan under another's name.
test('a system outside the caller’s set is refused, not silently rewritten', async () => {
  const { app, writes } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, system_key: 'bravo' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(writes.length, 0);
});

test('identity written comes from the allowlist entry, not from other body fields', async () => {
  const { app, writes } = appWith();
  await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, system: 'bravo', repo: 'attacker/repo', stack: 'malware' });
  assert.strictEqual(writes[0].system.system_key, 'alpha');
  assert.strictEqual(writes[0].system.repo, REPO);
  assert.strictEqual(writes[0].system.stack, 'elixir');
});

test('400, not 403, when the body names no system at all', async () => {
  const { app, writes } = appWith();
  const { system_key, ...noKey } = goodBody;
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't').send(noKey);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.reason, /system_key/);
  assert.strictEqual(writes.length, 0);
});

test('500 when the write fails', async () => {
  const { app } = appWith({ write: async () => { throw new Error('db down'); } });
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't').send(goodBody);
  assert.strictEqual(res.status, 500);
});

// A full-replace endpoint has one degenerate input that looks like success:
// a well-formed payload carrying no criteria. It authenticates, validates,
// writes, and returns 200 — having deleted every score the system had. The
// opus review of the endpoint flagged this and it was never closed.
test('400 on an empty criteria map, and nothing is written', async () => {
  const { app, writes } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, criteria: {} });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.reason, /criteria/);
  assert.strictEqual(writes.length, 0, 'a blanking payload must not reach the database');
});

test('an empty findings map is still allowed — a clean system has no findings', async () => {
  const { app, writes } = appWith();
  const res = await request(app).post('/ingest')
    .set('X-Benchmark-Ingest-Token', 't')
    .send({ ...goodBody, findings: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(writes.length, 1);
});

test('the publisher recorded is the verified one, and the body cannot set it', () => {
  // This is what makes it an IDENTITY rather than a label. The value comes from
  // the same verified claim the allowlist just authorised against, so a
  // watchtower can no more misreport who it is than it can write another
  // organisation's system. A field in the body would be a claim; this is not.
  //
  // It replaced a hash of the engine's source, which answered "which build of
  // the tool ran" — a question nobody had, and not a version number in any
  // sense a reader expects.
  return (async () => {
    const { app, writes } = appWith();
    const res = await request(app).post('/ingest')
      .set('X-Benchmark-Ingest-Token', 't')
      // A caller trying to attribute its scan to someone else.
      .send({ ...goodBody, published_by: 'someone-else/watchtower' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(writes[0].publishedBy, REPO, 'must come from the claim');
    assert.notStrictEqual(writes[0].publishedBy, 'someone-else/watchtower');
  })();
});
