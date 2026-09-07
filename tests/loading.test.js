'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeText, loadingMarkup, errorMarkup, withLoading, getJson,
} = require('../public/js/loading');

// ── Stubs ────────────────────────────────────────────────────────────────
// Deliberately minimal: these assert the state machine, not a browser. The
// timer is controllable because the whole point of the delay is that it does
// NOT fire on a fast load, and a real timer would make that a race.

function el() {
  return {
    innerHTML: '',
    attrs: {},
    children: [],
    firstChild: null,
    parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return null; },
    insertBefore(node) { node.parentNode = this; this.children.unshift(node); this.firstChild = node; return node; },
    removeChild(node) { this.children = this.children.filter((c) => c !== node); this.firstChild = this.children[0] || null; node.parentNode = null; return node; },
  };
}

function doc() {
  const body = el();
  body.appendChild = function appendChild(c) { this.children.push(c); c.parentNode = this; return c; };
  const byId = {};
  return {
    body,
    getElementById(id) { return byId[id] || null; },
    createElement() { const e = el(); e.classList = { add(c) { e._cls = c; }, remove() { e._cls = null; } }; e.id = ''; e.className = ''; return e; },
    querySelector() { return null; },
    _register(id, node) { byId[id] = node; },
  };
}

function fakeTimers() {
  const jobs = new Map();
  let id = 0;
  return {
    set(fn) { const i = ++id; jobs.set(i, fn); return i; },
    clear(i) { jobs.delete(i); },
    runAll() { const fns = [...jobs.values()]; jobs.clear(); fns.forEach((f) => f()); },
    pending() { return jobs.size; },
  };
}

// A task whose settling this test controls.
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject, task: () => promise };
}

// ── The default timer, under browser rules ───────────────────────────────

test('the default timer survives browser invocation rules', async () => {
  // Every other test here injects a timer, which meant the DEFAULT path was
  // never exercised — and the default was `{ set: setTimeout }`, whose bare
  // reference throws "Illegal invocation" in a browser because setTimeout is a
  // WebIDL method that requires `this === window`. Node does not care, jsdom
  // does not care, so 15 green tests and a full DOM render all passed while
  // every real page loaded no data at all.
  //
  // This reproduces the browser's rule in Node: a setTimeout that refuses to
  // run detached. It is the only way this class of bug is visible from here.
  const real = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = function strictSetTimeout(fn, ms) {
    if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
    return real.call(globalThis, fn, ms);
  };
  globalThis.clearTimeout = function strictClearTimeout(id) {
    if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation');
    return realClear.call(globalThis, id);
  };
  try {
    const target = el();
    // No `timers` option — this is the path the browser takes.
    const value = await withLoading(target, 'x', async () => 'data', { document: doc(), delayMs: 0 });
    assert.strictEqual(value, 'data', 'the task must actually run');
  } finally {
    globalThis.setTimeout = real;
    globalThis.clearTimeout = realClear;
  }
});

// ── Markup ───────────────────────────────────────────────────────────────

test('escapeText neutralises HTML in anything rendered', () => {
  assert.strictEqual(escapeText('<b>x</b>&"\''), '&lt;b&gt;x&lt;/b&gt;&amp;&quot;&#39;');
  assert.strictEqual(escapeText(null), '');
});

test('loading indicator announces itself to assistive tech', () => {
  const html = loadingMarkup('Loading scores…');
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-hidden="true"/);        // the ring is decorative
  assert.match(html, /Loading scores…/);
});

test('a failure interrupts rather than queues, and offers a way out', () => {
  const html = errorMarkup('/data/benchmark.json — 500');
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load this data\./);
  assert.match(html, /load-error-retry/);
  assert.match(html, /500/);
});

test('an error detail cannot inject markup', () => {
  // The detail is built from a URL and a status, but it passes through the
  // same sink as everything else, so it gets the same treatment.
  assert.match(errorMarkup('<img src=x onerror=alert(1)>'), /&lt;img src=x/);
  assert.doesNotMatch(errorMarkup('<img src=x onerror=alert(1)>'), /<img/);
});

// ── getJson ──────────────────────────────────────────────────────────────

test('getJson turns a bad status into a readable message', async () => {
  // fetch resolves on a 500, and .json() would then throw about unexpected
  // characters in the HTML error page — describing the wrong problem.
  const fake = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    () => getJson('/data/benchmark.json', fake),
    /\/data\/benchmark\.json — 500/,
  );
});

test('getJson returns the parsed body on success', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ systems: {} }) });
  assert.deepStrictEqual(await getJson('/x.json', fake), { systems: {} });
});

// ── withLoading ──────────────────────────────────────────────────────────

test('a slow load shows the indicator, then hands the container back empty', async () => {
  const target = el();
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(target, 'Loading scores…', d.task, { document: doc(), timers, delayMs: 180 });
  assert.strictEqual(target.attrs['aria-busy'], 'true');

  timers.runAll();
  assert.match(target.innerHTML, /loading-ring/);

  d.resolve({ ok: true });
  assert.deepStrictEqual(await p, { ok: true });
  assert.strictEqual(target.innerHTML, '');
  assert.strictEqual(target.attrs['aria-busy'], undefined);
});

test('a fast load never paints an indicator and never clears the shell', async () => {
  // The delay exists so a quick response does not flash. If the indicator was
  // never shown, whatever the page shipped in that container must survive —
  // clearing unconditionally would blank markup this function did not write.
  const target = el();
  target.innerHTML = '<p>server-rendered</p>';
  const timers = fakeTimers();

  const value = await withLoading(target, 'x', async () => 42, { document: doc(), timers, delayMs: 180 });

  assert.strictEqual(value, 42);
  assert.strictEqual(target.innerHTML, '<p>server-rendered</p>');
  assert.strictEqual(timers.pending(), 0, 'the pending timer must be cancelled');
});

test('a failure replaces the indicator with an explanation and rethrows', async () => {
  const target = el();
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(target, 'x', d.task, { document: doc(), timers, delayMs: 0 });
  timers.runAll();
  d.reject(new Error('/data/benchmark.json — 503'));

  await assert.rejects(() => p, /503/);
  assert.match(target.innerHTML, /Could not load this data/);
  assert.match(target.innerHTML, /503/);
  assert.doesNotMatch(target.innerHTML, /loading-ring/, 'no spinner may outlive the failure');
  assert.strictEqual(target.attrs['aria-busy'], undefined);
});

test('with several regions, one carries the explanation and the rest are cleared', async () => {
  // Two spinners plus one error reads as a half-working page.
  const a = el(); const b = el();
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading([a, b], 'x', d.task, { document: doc(), timers, delayMs: 0 });
  timers.runAll();
  assert.match(a.innerHTML, /loading-ring/);
  assert.match(b.innerHTML, /loading-ring/);

  d.reject(new Error('boom'));
  await assert.rejects(() => p);

  assert.match(a.innerHTML, /Could not load this data/);
  assert.strictEqual(b.innerHTML, '');
});

test('a missing container is dropped rather than throwing', async () => {
  // getElementById returns null for an id a page has renamed; the load should
  // still complete on the strip alone rather than taking the page down.
  const timers = fakeTimers();
  const value = await withLoading([null, undefined], 'x', async () => 'ok', { document: doc(), timers, delayMs: 0 });
  assert.strictEqual(value, 'ok');
});

test('banner mode adds a node above the content and takes it away again', async () => {
  // The agent pages fill dozens of small fields, so there is no empty container
  // to fill. Replacing anything on those pages would delete the page's markup.
  const main = el();
  main.innerHTML = '<section>shipped shell</section>';
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(main, 'Loading Deps data…', d.task, { document: doc(), timers, delayMs: 0, mode: 'banner' });
  timers.runAll();
  assert.strictEqual(main.children.length, 1, 'the indicator is added as a node');
  assert.match(main.children[0].innerHTML, /loading-ring/);
  assert.strictEqual(main.innerHTML, '<section>shipped shell</section>', 'the shell is untouched');

  d.resolve({});
  await p;
  assert.strictEqual(main.children.length, 0, 'the indicator is removed, not left behind');
  assert.strictEqual(main.innerHTML, '<section>shipped shell</section>');
});

test('banner mode swaps the indicator for the error, keeping the shell', async () => {
  const main = el();
  main.innerHTML = '<section>shipped shell</section>';
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(main, 'x', d.task, { document: doc(), timers, delayMs: 0, mode: 'banner' });
  timers.runAll();
  d.reject(new Error('offline'));
  await assert.rejects(() => p);

  assert.strictEqual(main.children.length, 1);
  assert.match(main.children[0].innerHTML, /Could not load this data/);
  assert.doesNotMatch(main.children[0].innerHTML, /loading-ring/);
  assert.strictEqual(main.innerHTML, '<section>shipped shell</section>');
});

test('replace mode will not blank a container that changed under it', async () => {
  // If something else wrote to the container while the fetch was in flight,
  // clearing would destroy that. Only the exact markup this put there is removed.
  const target = el();
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(target, 'x', d.task, { document: doc(), timers, delayMs: 0 });
  timers.runAll();
  target.innerHTML = '<p>someone else rendered here</p>';

  d.resolve('done');
  await p;
  assert.strictEqual(target.innerHTML, '<p>someone else rendered here</p>');
});

test('inside a table the indicator is a real row, not a hoisted div', async () => {
  // The scorecard mounts into <tbody>. A bare <div> there is invalid and the
  // browser lifts it out of the table, so it renders above the header.
  const target = el();
  const d = deferred();
  const timers = fakeTimers();

  const p = withLoading(target, 'Loading scorecard…', d.task, { document: doc(), timers, delayMs: 0, colspan: 4 });
  timers.runAll();
  assert.match(target.innerHTML, /^<tr><td colspan="4">/);

  d.reject(new Error('nope'));
  await assert.rejects(() => p);
  assert.match(target.innerHTML, /^<tr><td colspan="4">/, 'the error must be a row too');
});
