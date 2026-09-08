'use strict';

// Every classic <script> on a page shares ONE global lexical scope. Two files
// that each declare a top-level `const CRITERIA` are therefore a SyntaxError in
// the browser — the second file never parses, nothing is thrown that the page
// can catch, and the reader gets an empty scorecard.
//
// Node cannot see this: `require` gives each file its own module scope, so the
// same two files import cleanly and every unit test passes. That is exactly how
// it got shipped once already — the scorecard rendered nothing in Chrome while
// the suite was green.
//
// This evaluates the scripts a page actually loads, in load order, inside ONE
// vm context, which is the browser's rule reproduced in Node.

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Script srcs from a page's HTML, in document order, restricted to local files.
function scriptsOf(pageRelPath) {
  const html = fs.readFileSync(path.join(PUBLIC, pageRelPath), 'utf8');
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => src.startsWith('/'));
}

// A context with just enough of a browser for these files to reach their
// bottom-of-file `window` assignment. Nothing here executes page logic — a
// parse failure is what is being detected, and that happens before any of it.
function browserish() {
  const win = {
    addEventListener() {},
    location: { reload() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
    addEventListener() {},
  };
  win.document = doc;
  return vm.createContext({
    window: win, document: doc, console, setTimeout, clearTimeout, fetch: () => {},
  });
}

function loadTogether(pageRelPath) {
  const ctx = browserish();
  const loaded = [];
  for (const src of scriptsOf(pageRelPath)) {
    const file = path.join(PUBLIC, src);
    assert.ok(fs.existsSync(file), `${pageRelPath} loads ${src}, which does not exist`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src });
    loaded.push(src);
  }
  return { ctx, loaded };
}

// Walked from disk, all of it. This used to name six pages and eleven system
// pages; three of the six do not travel with the package, so a fresh clone
// loaded scripts from files that were not there.
const PAGES = [
  ...fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort(),
  // One template for every system, so this used to be eleven near-identical
  // entries and is now one. Walked from disk rather than listed, so a page
  // added later is covered on the day it appears.
  ...fs.readdirSync(path.join(PUBLIC, 'system'))
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => `system/${f}`),
];

for (const page of PAGES) {
  test(`every script on ${page} parses alongside the others`, () => {
    const { loaded } = loadTogether(page);
    assert.ok(loaded.length > 0, `${page} loads no local scripts`);
  });
}

test('the pages that need the criterion list end up with it on window', () => {
  for (const page of ['index.html', 'system/scorecard.html']) {
    const { ctx } = loadTogether(page);
    assert.ok(ctx.window.Criteria, `${page}: window.Criteria is not defined after loading`);
    assert.ok(Array.isArray(ctx.window.Criteria.CRITERIA), `${page}: CRITERIA is not a list`);
  }
});

test('a shared script leaks nothing into global scope but its namespace', () => {
  // The property that keeps the collision from coming back: /js/*.js may define
  // window.<Name> and nothing else. A top-level binding in one of these is what
  // breaks whichever page-level script happens to pick the same word.
  // SampleTrends is temporary — it holds the invented numbers behind the trend
  // charts and goes when they are real. It obeys the same rule while it is here.
  const ALLOWED = new Set(['Loading', 'Criteria', 'SampleTrends', 'FindingsCsv']);
  for (const file of fs.readdirSync(path.join(PUBLIC, 'js'))) {
    if (!file.endsWith('.js')) continue;
    const ctx = browserish();
    const src = fs.readFileSync(path.join(PUBLIC, 'js', file), 'utf8');
    const before = new Set(Object.getOwnPropertyNames(ctx));
    vm.runInContext(src, ctx, { filename: file });

    const leaked = Object.getOwnPropertyNames(ctx).filter((k) => !before.has(k));
    assert.deepStrictEqual(leaked, [], `js/${file} leaks ${leaked.join(', ')} into global scope`);

    const added = Object.keys(ctx.window).filter((k) => ALLOWED.has(k));
    assert.ok(added.length > 0, `js/${file} defines no window namespace`);
  }
});

test('every element id a page script looks up exists in the pages that load it', () => {
  // A renamed id fails silently: getElementById returns null, the guarded
  // branch does nothing, and the page renders without the thing. This is the
  // rename of `example-banner` to `page-banner` kept honest across 11 files.
  const scriptIds = (file) => {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    return [...src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  };

  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

    // Ids the page's own inline script or its page script reaches for.
    const wanted = new Set(scriptIds(page));
    for (const src of scriptsOf(page)) {
      // Shared scripts under /js are generic and take their targets as
      // arguments; only the page-specific ones hardcode ids.
      if (src.startsWith('/js/')) continue;
      scriptIds(src.replace(/^\//, '')).forEach((id) => wanted.add(id));
    }

    for (const id of wanted) {
      assert.ok(ids.has(id), `${page}: a script looks up #${id}, which the page does not contain`);
    }
  }
});

test('no page still carries the retired example-data warning', () => {
  // It could not render — the only branch that showed the element replaced its
  // text, and the only other branch hid it — so it was markup promising a
  // safety notice that did not exist.
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    assert.ok(!html.includes('example-banner'), `${page} still uses the old example-banner id`);
  }
});
