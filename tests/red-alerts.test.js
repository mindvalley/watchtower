'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  redTransition, mention, alertText, isOwnerId, sendSlack, redCause,
} = require('../db/red-alerts');

test('a system that turns red has dropped', () => {
  assert.strictEqual(redTransition('amber', 'red'), 'dropped');
  assert.strictEqual(redTransition('green', 'red'), 'dropped');
});

test('a first reading that is already red counts as dropped', () => {
  assert.strictEqual(redTransition(null, 'red'), 'dropped');
});

test('a red system that leaves red has recovered', () => {
  assert.strictEqual(redTransition('red', 'amber'), 'recovered');
  assert.strictEqual(redTransition('red', 'green'), 'recovered');
});

test('staying red, staying out of red, or losing a score says nothing', () => {
  assert.strictEqual(redTransition('red', 'red'), null);
  assert.strictEqual(redTransition('amber', 'green'), null);
  assert.strictEqual(redTransition(null, 'amber'), null);
  assert.strictEqual(redTransition('red', null), null);
});

test('owner ids are Slack member or user-group ids', () => {
  for (const ok of ['U0123ABCD', 'W0123ABCDE', 'S0123ABCD']) assert.ok(isOwnerId(ok), ok);
  for (const bad of ['u0123abcd', '@ana', 'U01', '<@U0123ABCD>', 'U0123ABCD extra', 42, null]) {
    assert.ok(!isOwnerId(bad), String(bad));
  }
});

test('members and user groups are tagged the way Slack links them', () => {
  assert.strictEqual(mention('U0123ABCD'), '<@U0123ABCD>');
  assert.strictEqual(mention('S0123ABCD'), '<!subteam^S0123ABCD>');
});

test('a drop names the system, both scores, the owners and the board', () => {
  const text = alertText({
    kind: 'dropped', system: 'alpha', before: { score: 63 }, after: { score: 38 },
    owners: ['U0123ABCD', 'S0123ABCD'], boardUrl: 'https://board.example.test',
  });
  assert.match(text, /alpha/);
  assert.match(text, /dropped to red/);
  assert.match(text, /63 → 38/);
  assert.match(text, /<@U0123ABCD> <!subteam\^S0123ABCD>/);
  assert.match(text, /https:\/\/board\.example\.test\/system\/alpha/);
});

test('a first reading has no earlier score to show', () => {
  const text = alertText({ kind: 'dropped', system: 'alpha', before: null, after: { score: 38 }, owners: [] });
  assert.match(text, /\(38\)/);
  assert.doesNotMatch(text, /→/);
});

test('a recovery says so', () => {
  const text = alertText({ kind: 'recovered', system: 'alpha', before: { score: 38 }, after: { score: 55 }, owners: [] });
  assert.match(text, /recovered from red/);
  assert.match(text, /38 → 55/);
});

test('with no board address the message still reads', () => {
  const text = alertText({ kind: 'dropped', system: 'alpha', before: null, after: { score: 10 }, owners: [] });
  assert.doesNotMatch(text, /undefined|null/);
});

test('sendSlack posts the text as JSON to the webhook', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  await sendSlack('https://hooks.example.test/x', 'hello', { fetchImpl });
  assert.strictEqual(calls[0].url, 'https://hooks.example.test/x');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { text: 'hello' });
});

test('sendSlack throws on a refused post, without echoing the webhook address', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    sendSlack('https://hooks.example.test/secret-path', 'hello', { fetchImpl }),
    (err) => /403/.test(err.message) && !/secret-path/.test(err.message),
  );
});

test('sendSlack gives up after its time limit', { timeout: 1000 }, async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    if (!init.signal) return;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    sendSlack('https://hooks.example.test/x', 'hello', { fetchImpl, timeoutMs: 20 }),
    { name: 'AbortError' },
  );
});

const NAMES = { 6: 'Test Coverage', 8: 'Codebase Simplicity', 9: 'Security Posture' };

test('a capped system names the criterion with the critical finding and its first action', () => {
  const cause = redCause(
    { 6: { score: 3 }, 9: { score: 4 } },
    { 6: { score: 3 }, 9: { score: 2, critical: true, actions: ['Remove the exposed secret.', 'Add a hook.'] } },
    NAMES,
  );
  assert.deepStrictEqual(cause, { name: 'Security Posture', reason: 'critical', action: 'Remove the exposed secret.' });
});

test('a slide with no cap names the criterion that fell furthest since the last reading', () => {
  const cause = redCause(
    { 6: { score: 3 }, 8: { score: 4 } },
    { 6: { score: 2.5 }, 8: { score: 1.5, actions: ['Split the complex functions.'] } },
    NAMES,
  );
  assert.deepStrictEqual(cause, {
    name: 'Codebase Simplicity', reason: 'fell', from: 4, to: 1.5, action: 'Split the complex functions.',
  });
});

test('with no earlier reading, the weakest criterion is named', () => {
  const cause = redCause(null, { 6: { score: 0.5, actions: ['Add tests.'] }, 8: { score: 2 } }, NAMES);
  assert.deepStrictEqual(cause, { name: 'Test Coverage', reason: 'weakest', to: 0.5, action: 'Add tests.' });
});

test('if nothing fell, the weakest criterion is named', () => {
  const cause = redCause({ 6: { score: 1 } }, { 6: { score: 1 }, 8: { score: 0.5 } }, NAMES);
  assert.strictEqual(cause.name, 'Codebase Simplicity');
  assert.strictEqual(cause.reason, 'weakest');
  assert.strictEqual(cause.action, null);
});

test('an unknown criterion id is shown by its id rather than dropped', () => {
  const cause = redCause(null, { 99: { score: 0 } }, NAMES);
  assert.strictEqual(cause.name, 'criterion 99');
});

test('the drop message carries the cause and the fix', () => {
  const text = alertText({
    kind: 'dropped', system: 'alpha', before: { score: 63 }, after: { score: 25 }, owners: [],
    cause: { name: 'Security Posture', reason: 'critical', action: 'Remove the exposed secret.' },
  });
  assert.match(text, /Cause: \*Security Posture\* has a critical finding, which caps the score\./);
  assert.match(text, /Fix: Remove the exposed secret\./);
});

test('a slide reads as the criterion that fell, with its scores', () => {
  const text = alertText({
    kind: 'dropped', system: 'alpha', before: { score: 45 }, after: { score: 38 }, owners: [],
    cause: { name: 'Codebase Simplicity', reason: 'fell', from: 4, to: 1.5, action: null },
  });
  assert.match(text, /Cause: \*Codebase Simplicity\* fell furthest \(4 → 1\.5 of 5\)\./);
  assert.doesNotMatch(text, /Fix:/);
});

test('a recovery carries no cause even if one is passed', () => {
  const text = alertText({
    kind: 'recovered', system: 'alpha', before: { score: 38 }, after: { score: 55 }, owners: [],
    cause: { name: 'Security Posture', reason: 'critical', action: 'x' },
  });
  assert.doesNotMatch(text, /Cause:|Fix:/);
});
