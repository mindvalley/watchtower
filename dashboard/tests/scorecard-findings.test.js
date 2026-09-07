'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { topFindings, escHtml, fmtFindingLine } = require('../public/system/scorecard');

test('topFindings returns the first n items of a group', () => {
  const g = { items: [{ file: 'a' }, { file: 'b' }, { file: 'c' }] };
  assert.deepStrictEqual(topFindings(g, 2), [{ file: 'a' }, { file: 'b' }]);
});

test('topFindings tolerates missing/empty items', () => {
  assert.deepStrictEqual(topFindings({}, 5), []);
  assert.deepStrictEqual(topFindings(null, 5), []);
});

test('escHtml escapes finding values before inline render', () => {
  assert.strictEqual(escHtml('<b>x</b>&"\''), '&lt;b&gt;x&lt;/b&gt;&amp;&quot;&#39;');
  assert.strictEqual(escHtml(null), '');
});

test('fmtFindingLine handles location AND rung-shaped items (no blank lines for C4/C7)', () => {
  assert.strictEqual(fmtFindingLine({ file: 'lib/a.ex', rule: 'aws' }), 'lib/a.ex · aws');
  assert.strictEqual(fmtFindingLine({ pillar: 'Structured logging', rung: 'declared', evidence: [] }), 'Structured logging · declared');
  assert.strictEqual(fmtFindingLine({ sub: 'progressive_delivery', rung: 'none', evidence: [] }), 'progressive_delivery · none');
  assert.strictEqual(fmtFindingLine({ stack: 'frontend', status: 'no gate' }), 'frontend · no gate');
});

test('fmtFindingLine shows the line number where the finding carries one', () => {
  // These are the real shapes: the code scanner emits path+line, the complexity
  // scanner file+line. Both carried a position that the list was discarding, so a
  // reader got a filename and had to go hunting.
  assert.strictEqual(
    fmtFindingLine({ id: 'rules.some-check', path: '.github/dependabot.yml', line: 25, severity: null }),
    '.github/dependabot.yml:25 · rules.some-check',
  );
  assert.strictEqual(
    fmtFindingLine({ scope: 'render', file: 'assets/js/Index.vue', line: 366, cc: 11 }),
    'assets/js/Index.vue:366 · cc 11',
  );
  // Line 0 is a real line, so it must not be dropped by a falsy check.
  assert.strictEqual(fmtFindingLine({ file: 'a.ex', line: 0, rule: 'x' }), 'a.ex:0 · x');
  // Unchanged where there is no position to show.
  assert.strictEqual(fmtFindingLine({ file: 'lib/a.ex', rule: 'aws' }), 'lib/a.ex · aws');
});

test('fmtFindingLine names the package on a dependency CVE', () => {
  // Found by rendering the real findings file rather than a fixture: these items
  // carry no file, so the location came out empty and the line read as a bare CVE
  // id with nothing saying which dependency it was in.
  assert.strictEqual(
    fmtFindingLine({ package: 'earmark', id: 'CVE-2026-48591', severity: 'medium', installed: '1.4.49', target: 'mix.lock' }),
    'earmark 1.4.49 · CVE-2026-48591',
  );
  assert.strictEqual(
    fmtFindingLine({ package: 'lodash', id: 'CVE-1', severity: 'high' }),
    'lodash · CVE-1',
  );
});

test('fmtFindingLine reports duplication size as a count, never as a position', () => {
  // `lines` on a duplication finding is how many lines are duplicated, not where.
  // Formatting it as file:17 would point at an unrelated line — worse than silence.
  assert.strictEqual(
    fmtFindingLine({ fileA: 'lib/a.ex', fileB: 'lib/b.ex', lines: 17 }),
    'lib/a.ex ↔ lib/b.ex · 17 lines',
  );
});

test('topFindings skips an allowed group entirely', () => {
  // Allowed findings have been judged acceptable and removed from the score.
  // Listing them under "Where →" beside the ones that still count would put
  // settled work back in front of a reader as outstanding.
  const allowed = { disposition: 'allowed', items: [{ file: 'config/dev.exs', rule: 'generic-api-key' }] };
  assert.deepStrictEqual(topFindings(allowed, 5), []);

  // ...while every other disposition is untouched.
  const confirmed = { disposition: 'confirmed', items: [{ file: 'a' }] };
  assert.deepStrictEqual(topFindings(confirmed, 5), [{ file: 'a' }]);
  const review = { disposition: 'review', items: [{ file: 'b' }] };
  assert.deepStrictEqual(topFindings(review, 5), [{ file: 'b' }]);
});

// --- one template, so the page has to work out which system it is -----------

test('systemKeyFromPath reads the key out of the URL', () => {
  const { systemKeyFromPath } = require('../public/system/scorecard.js');
  assert.strictEqual(systemKeyFromPath('/system/alpha'), 'alpha');
  assert.strictEqual(systemKeyFromPath('/system/alpha/report'), 'alpha');
  assert.strictEqual(systemKeyFromPath('/system/delta-api'), 'delta-api');
  // Percent-encoding, because the key comes off the URL and a browser will have
  // encoded anything unusual in it.
  assert.strictEqual(systemKeyFromPath('/system/a%20b'), 'a b');
  // Trailing slash, which is the same page.
  assert.strictEqual(systemKeyFromPath('/system/alpha/'), 'alpha');
});

test('systemKeyFromPath returns nothing rather than guessing', () => {
  const { systemKeyFromPath } = require('../public/system/scorecard.js');
  // An empty key must not become a request for /data/findings-.json, and must
  // not silently render someone else's scorecard.
  for (const p of ['/', '/system', '/system/', '/criteria/security-posture', '']) {
    assert.strictEqual(systemKeyFromPath(p), '', `${p} should yield no key`);
  }
});

test('titleCase is only a fallback, and a readable one', () => {
  const { titleCase } = require('../public/system/scorecard.js');
  // What a stranger sees when they have supplied no display names.
  assert.strictEqual(titleCase('alpha'), 'Alpha');
  assert.strictEqual(titleCase('bravo-api'), 'Bravo Api');
  assert.strictEqual(titleCase('charlie_web'), 'Charlie Web');
  assert.strictEqual(titleCase(''), '');
});
