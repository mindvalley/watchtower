// tests/report-render.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderGroup, esc, wantsPrint } = require('../public/system/report.js');

test('esc escapes HTML metacharacters', () => {
  assert.strictEqual(esc('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
  assert.strictEqual(esc(null), '');
});

test('renderGroup escapes dynamic finding values (no raw HTML injection)', () => {
  const html = renderGroup({
    sub: 'sast', label: 'SAST', disposition: 'triaged',
    items: [{ path: 'lib/<img src=x onerror=alert(1)>.ex', id: 'rule<>' }],
  });
  assert.ok(!html.includes('<img src=x'), 'raw malicious markup must not appear');
  assert.ok(html.includes('&lt;img src=x'), 'value must be escaped');
});

test('renderGroup says an allowed finding is not counted, rather than just tagging it', () => {
  const html = renderGroup({
    sub: 'secrets',
    label: 'Secrets',
    disposition: 'allowed',
    items: [{ file: 'config/dev.exs', rule: 'generic-api-key', allowed_reason: 'Public reCAPTCHA site key' }],
  });
  // "(allowed)" on its own reads as a kind of finding, not a statement about
  // the score.
  assert.match(html, /not counted toward the score/);
  assert.match(html, /Public reCAPTCHA site key/);
});

test('renderGroup leaves an ordinary group undimmed', () => {
  const html = renderGroup({
    sub: 'secrets', label: 'Secrets', disposition: 'confirmed', items: [{ file: 'a.exs', rule: 'private-key' }],
  });
  assert.ok(!/opacity/.test(html), 'only an allowed group should be dimmed');
  assert.ok(!/not counted/.test(html));
});

test('the print flag is read from the query string, and only when it says so', () => {
  // A system page opens this one with ?print=1. Anything else must render
  // normally: a page that prints itself when a reader did not ask is worse
  // than one that never prints.
  assert.strictEqual(wantsPrint('?print=1'), true);
  assert.strictEqual(wantsPrint('?a=b&print=1'), true);
  assert.strictEqual(wantsPrint('?print=0'), false);
  assert.strictEqual(wantsPrint('?print'), false);
  assert.strictEqual(wantsPrint('?printer=1'), false);
  assert.strictEqual(wantsPrint(''), false);
  assert.strictEqual(wantsPrint(undefined), false);
});
