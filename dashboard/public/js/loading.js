'use strict';

// Shared loading + failure indicator for every page that fetches its own data.
//
// Why it exists. Each page ships a static shell and then fetches its data
// client-side, so until that lands the reader sees empty grids and em-dashes
// with nothing saying why. The wait is real: the largest committed findings
// file is 1.2 MB and four systems are over half a megabyte, on top of a
// 296 KB board.
//
// The second half matters as much as the first. Not one of those fetches had
// a failure path — a rejected request left the shell empty permanently, with
// the reason visible only in the browser console. A spinner that never
// resolves is worse than no spinner, so every mount here has an error state.
//
// What this CANNOT do, stated so nobody expects it to: the server only starts
// listening after its boot seed finishes, so a cold start delays the HTML
// itself. There is no page yet to show a spinner on. This covers the fetch
// phase after the shell arrives, which is the part the browser is present for.

// Wrapped in a function because classic <script> tags all share one global
// lexical scope: every top-level name here — `getJson`, `withLoading`,
// `escapeText` — was reachable by, and collided with, any page script that
// happened to pick the same word. A `const` collision is a SyntaxError that
// stops the other file parsing entirely, with nothing logged. Nothing had
// collided yet; adding criteria.js beside it is what proved the hazard real.
(function attachLoading() {

// Below this, an indicator is a flash rather than information — it appears and
// vanishes before it can be read, which reads as a glitch.
const LOADING_DELAY_MS = 180;

const DEFAULT_LABEL = 'Loading data…';

function escapeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// role=status + aria-live so a screen reader is told the wait has started; the
// ring is decorative and hidden from the accessibility tree.
function loadingMarkup(label) {
  return `<div class="loading" role="status" aria-live="polite">`
    + `<span class="loading-ring" aria-hidden="true"></span>`
    + `<span class="loading-label">${escapeText(label || DEFAULT_LABEL)}</span>`
    + `</div>`;
}

// role=alert rather than status: a failure should interrupt, not queue.
function errorMarkup(detail) {
  const d = escapeText(detail);
  return `<div class="load-error" role="alert">`
    + `<span class="load-error-title">Could not load this data.</span>`
    + (d ? `<span class="load-error-detail">${d}</span>` : '')
    + `<button type="button" class="load-error-retry">Try again</button>`
    + `</div>`;
}

// Some containers are a <tbody> — the scorecard's criteria table is one. A
// <div> dropped in there is invalid and the browser hoists it out of the table,
// so it renders above the header instead of inside it. Wrapping in a real row
// keeps it where it was put.
function asRow(markup, colspan) {
  if (!colspan) return markup;
  return `<tr><td colspan="${Number(colspan)}">${markup}</td></tr>`;
}

// Page-level strip. Kept separate from the per-container indicator because
// pages like the agent detail views populate dozens of small fields rather
// than one region, so there is no single container to fill.
function stripElement(doc) {
  let el = doc.getElementById('load-strip');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'load-strip';
    el.className = 'load-strip';
    el.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(el);
  }
  return el;
}

function showStrip(doc) {
  stripElement(doc).classList.add('is-active');
}

function hideStrip(doc) {
  const el = doc.getElementById('load-strip');
  if (el) el.classList.remove('is-active');
}

// Runs `task`, showing an indicator while it is in flight and an error in its
// place if it rejects. Rethrows after rendering, so the caller stops rather
// than carrying on to render undefined into the page.
//
// `target` may be null for pages with no single container — the strip still
// runs, and a failure falls back to a banner at the top of the content.
async function withLoading(target, label, task, opts) {
  const options = opts || {};
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const delayMs = options.delayMs == null ? LOADING_DELAY_MS : options.delayMs;
  // Must be wrapped, not handed over as bare references. `setTimeout` is a
  // WebIDL method on window: calling it with any other `this` throws
  // "Illegal invocation" in a browser. Node and jsdom both allow it, so this
  // rejected on the very first line in every real browser — before the fetch —
  // while every test stayed green. Do not "simplify" this back.
  const timer = options.timers || {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id),
  };

  // A page can have more than one empty region waiting on the same fetch — the
  // home page has two. Missing ids resolve to null and are dropped rather than
  // throwing, so a page that loses a container degrades to the strip alone.
  const targets = (Array.isArray(target) ? target : [target]).filter(Boolean);

  targets.forEach((t) => t.setAttribute('aria-busy', 'true'));
  if (doc) showStrip(doc);

  // Two ways to mount. REPLACE fills an empty container — the board grids, the
  // criteria list, the scorecard table. BANNER prepends a node instead, for
  // pages that populate dozens of small fields and so have no empty container
  // to fill; replacing anything there would delete the page's own markup.
  const banner = options.mode === 'banner';
  const painted = new Map();

  const paint = (t) => {
    if (banner) {
      const node = doc.createElement('div');
      node.className = 'loading-banner';
      node.innerHTML = loadingMarkup(label);
      t.insertBefore(node, t.firstChild);
      painted.set(t, node);
    } else {
      const html = asRow(loadingMarkup(label), options.colspan);
      t.innerHTML = html;
      painted.set(t, html);
    }
  };

  const unpaint = (t) => {
    const mark = painted.get(t);
    if (mark == null) return;               // never shown — leave the shell alone
    if (banner) {
      if (mark.parentNode) mark.parentNode.removeChild(mark);
    } else if (t.innerHTML === mark) {
      // Only clear what we actually wrote. Comparing rather than blanking means
      // a container that turned out to hold something else keeps it.
      t.innerHTML = '';
    }
    painted.delete(t);
  };

  const handle = timer.set(() => targets.forEach(paint), delayMs);

  try {
    const value = await task();
    timer.clear(handle);
    if (doc) hideStrip(doc);
    targets.forEach((t) => {
      t.removeAttribute('aria-busy');
      unpaint(t);
    });
    return value;
  } catch (err) {
    timer.clear(handle);
    if (doc) hideStrip(doc);
    const detail = (err && err.message) ? err.message : String(err);
    const hosts = targets.length ? targets : (doc ? [fallbackHost(doc)] : []);
    hosts.forEach((host, i) => {
      host.removeAttribute('aria-busy');
      unpaint(host);                        // no spinner may outlive the failure
      if (i !== 0) return;                  // one explanation, not one per region
      if (banner) {
        const node = doc.createElement('div');
        node.innerHTML = errorMarkup(detail);
        host.insertBefore(node, host.firstChild);
        wireRetry(node, doc);
      } else {
        host.innerHTML = asRow(errorMarkup(detail), options.colspan);
        wireRetry(host, doc);
      }
    });
    throw err;
  }
}

// Fetch that fails loudly. `fetch` only rejects on a network error, so a 500
// or a 404 arrives as a resolved response and `.json()` then throws a parser
// message about unexpected characters — which describes the HTML error page,
// not the problem. This turns the status into the message the reader sees.
async function getJson(url, fetchImpl) {
  const f = fetchImpl || fetch;
  const res = await f(url);
  if (!res.ok) throw new Error(`${url} — ${res.status}`);
  return res.json();
}

function fallbackHost(doc) {
  let el = doc.getElementById('load-error-banner');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'load-error-banner';
    const main = doc.querySelector('main') || doc.body;
    main.insertBefore(el, main.firstChild);
  }
  return el;
}

function wireRetry(host, doc) {
  const btn = host.querySelector ? host.querySelector('.load-error-retry') : null;
  if (btn && doc && doc.defaultView) {
    btn.addEventListener('click', () => doc.defaultView.location.reload());
  }
}

// Node (tests) imports the pure pieces; the browser loads this as a plain
// <script> and reads them off window. Guarded so each is a no-op in the other.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LOADING_DELAY_MS, DEFAULT_LABEL, escapeText, loadingMarkup, errorMarkup, withLoading, getJson,
  };
}
if (typeof window !== 'undefined') {
  window.Loading = { LOADING_DELAY_MS, loadingMarkup, errorMarkup, withLoading, getJson };
}

}());
