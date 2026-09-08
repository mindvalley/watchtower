'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Holds a few CSS declarations in place that look decorative and are not.
// Node has no layout engine, so this cannot prove the menu is clickable —
// that is a real mouse click in a browser. It only stops the rules being
// tidied away.

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'theme.css'), 'utf8');

// Good enough for this stylesheet: hand-written, one selector per rule.
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

// If either stops being true the z-index above is cargo, and should be
// reconsidered rather than kept because a test demands it.
test('the reason the header needs raising still holds', () => {
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
  const body = ruleBody('.menu');
  assert.ok(body, '.menu rule not found');
  assert.match(body, /position:\s*relative/);
});

test('a closed menu is not merely marked closed', () => {
  // `display: flex` would otherwise override `hidden`.
  assert.match(CSS, /\.menu-list\[hidden\]\s*\{\s*display:\s*none/);
});
