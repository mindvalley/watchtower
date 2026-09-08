'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// WHAT THIS CAN AND CANNOT DO.
//
// It cannot prove the menu is clickable. Node has no layout engine, so nothing
// here knows what is painted over what; that is checked by dispatching a real
// mouse click in a browser and asking `elementFromPoint` who receives it.
//
// What it does is hold two lines in place that look decorative and are not.
//
// `.header` carries the `rise` entry animation, which animates `transform`.
// An animation with `fill-mode: both` leaves the computed transform as a matrix
// rather than `none` after it finishes, so the header is a stacking context
// FOREVER — and a `z-index` on anything inside it is scoped to that context and
// cannot escape. With the header itself at `auto`, every `.section` after it in
// the document painted on top, including over the lower half of an open
// dropdown. The menu was fully drawn and the bottom item silently belonged to
// the panel underneath it.
//
// Anyone tidying `position: relative; z-index: 2` off a flex container has no
// way to know that from looking at it, and the damage is invisible until
// somebody tries to click the second item.

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'theme.css'), 'utf8');

// The body of a top-level rule, by selector. Good enough for this stylesheet:
// it is hand-written, one selector per rule, no nesting.
function ruleBody(selector) {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const m = CSS.match(re);
  return m ? m[2] : null;
}

test('the header is raised above the sections that would otherwise cover it', () => {
  const body = ruleBody('.header');
  assert.ok(body, '.header rule not found — this guard is looking for the wrong thing');
  assert.match(body, /position:\s*relative/, '.header must be positioned, or its z-index does nothing');
  assert.match(body, /z-index:\s*[1-9]/, '.header must sit above the sections; see the comment on the rule');
});

test('the reason the header needs raising still holds', () => {
  // If either of these stops being true, the rule above is cargo and should be
  // reconsidered rather than kept because a test demands it. Asserted so the
  // reason is re-checked rather than remembered.
  assert.match(
    CSS,
    /\.header\s*\{\s*animation:\s*rise\b/,
    'the header no longer has the rise animation — re-check whether it is still a stacking context, and whether the z-index is still needed',
  );
  assert.match(
    CSS,
    /@keyframes rise\s*\{[^}]*transform:/,
    'rise no longer animates transform — re-check whether the header is still a stacking context',
  );
});

test('the dropdown is anchored to its own button', () => {
  // Without `position: relative` on the wrapper the list is positioned against
  // the page instead, and lands somewhere unrelated to the button that opened
  // it as soon as the header reflows.
  const body = ruleBody('.menu');
  assert.ok(body, '.menu rule not found');
  assert.match(body, /position:\s*relative/);
});

test('a closed menu is not merely marked closed', () => {
  // `hidden` is a presentation hint that `display: flex` overrides, so without
  // this the list stays on screen while telling assistive technology it is gone.
  assert.match(CSS, /\.menu-list\[hidden\]\s*\{\s*display:\s*none/);
});
