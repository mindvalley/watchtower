const { test } = require('node:test');
const assert = require('node:assert');
const {
  round1, colourFor, scoreSecrets, scoreSeverity, scoreSecurity,
} = require('../../scripts/benchmark/score-security');

test('colourFor uses the fixed bands (red <=2.0, amber <=3.5, green else)', () => {
  assert.strictEqual(colourFor(2.0), 'red');
  assert.strictEqual(colourFor(2.1), 'amber');
  assert.strictEqual(colourFor(3.5), 'amber');
  assert.strictEqual(colourFor(3.6), 'green');
  assert.strictEqual(colourFor(5.0), 'green');
});

test('scoreSecrets is binary: 0 -> green 5.0, any -> red 0.0 + critical', () => {
  assert.deepStrictEqual(scoreSecrets(0), { score: 5.0, colour: 'green', critical: false });
  assert.deepStrictEqual(scoreSecrets(3), { score: 0.0, colour: 'red', critical: true });
});

test('scoreSeverity: critical -> red+critical, high -> amber, medium -> amber, clean -> green', () => {
  assert.deepStrictEqual(scoreSeverity({ critical: 1, high: 0, medium: 0, low: 0 }), { score: 1.0, colour: 'red', critical: true });
  assert.deepStrictEqual(scoreSeverity({ critical: 0, high: 4, medium: 0, low: 0 }), { score: 2.5, colour: 'amber', critical: false });
  assert.deepStrictEqual(scoreSeverity({ critical: 0, high: 0, medium: 2, low: 9 }), { score: 3.5, colour: 'amber', critical: false });
  assert.deepStrictEqual(scoreSeverity({ critical: 0, high: 0, medium: 0, low: 7 }), { score: 5.0, colour: 'green', critical: false });
});

const ZERO = () => ({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
const depsIn = (o = {}) => ({
  raw: ZERO(), prod: ZERO(), dev: ZERO(), transitive: ZERO(), ...o,
});
const sastIn = (triaged = ZERO()) => ({
  raw: { ...triaged }, triaged, remapped: 0, excluded_by_path: 0,
});

test('scoreSecurity averages the three sub-metrics and is green when clean', () => {
  const c9 = scoreSecurity({
    secrets: { secrets: 0, raw_secrets: 5, triaged_secrets: 0, excluded_by_path: 5 },
    deps: depsIn(),
    sast: sastIn(),
    assessedAt: '2026-06-30',
  });
  assert.strictEqual(c9.score, 5.0);
  assert.strictEqual(c9.colour, 'green');
  assert.strictEqual(c9.critical, false);
  assert.strictEqual(c9.assessed, true);
  assert.strictEqual(c9.assessed_at, '2026-06-30');
  assert.deepStrictEqual(c9.actions, []);
  assert.strictEqual(c9.sub.secrets.score, 5.0);
  // audit trail carries raw counts through
  assert.strictEqual(c9.audit.secrets.raw, 5);
  assert.strictEqual(c9.audit.secrets.excluded_by_path, 5);
});

test('scoreSecurity hard-caps a prod critical and emits findings + actions', () => {
  const c9 = scoreSecurity({
    secrets: { secrets: 1, raw_secrets: 1, triaged_secrets: 1, excluded_by_path: 0 },
    deps: depsIn({ prod: { critical: 2, high: 1, medium: 0, low: 0, total: 3 } }),
    sast: sastIn({ critical: 0, high: 0, medium: 1, low: 0, total: 1 }),
    assessedAt: '2026-06-30',
  });
  // mean of secrets 0.0, deps 1.0 (prod critical), sast 3.5 -> 1.5
  assert.strictEqual(c9.score, 1.5);
  assert.strictEqual(c9.critical, true);
  assert.strictEqual(c9.colour, 'red');
  assert.ok(c9.findings.some((f) => /1 confirmed exposed secret/.test(f)));
  assert.ok(c9.findings.some((f) => /2 Critical, 1 High direct production dependency/.test(f)));
  assert.ok(c9.actions.some((a) => /rotate/i.test(a)));
  assert.ok(c9.actions.some((a) => /Upgrade or patch/i.test(a)));
});

test('scoreSecurity discounts dev-only CVEs: no hard-cap, folded to medium', () => {
  const c9 = scoreSecurity({
    secrets: { secrets: 0, raw_secrets: 3, triaged_secrets: 0, excluded_by_path: 3 },
    deps: depsIn({ dev: { critical: 2, high: 0, medium: 0, low: 0, total: 2 } }),
    sast: { raw: { critical: 0, high: 3, medium: 0, low: 0, total: 3 }, triaged: { critical: 0, high: 1, medium: 0, low: 0, total: 1 }, remapped: 2 },
    assessedAt: '2026-06-30',
  });
  // secrets 5.0; deps: 2 dev criticals folded to medium -> 3.5 amber, NOT critical; sast triaged 1 High -> 2.5
  // mean(5.0, 3.5, 2.5) = 3.7
  assert.strictEqual(c9.score, 3.7);
  assert.strictEqual(c9.critical, false);
  assert.strictEqual(c9.colour, 'green');
  assert.ok(c9.findings.some((f) => /No confirmed exposed secrets/.test(f)));
  assert.ok(c9.findings.some((f) => /2 dev-only/.test(f)));
  assert.ok(c9.findings.some((f) => /remapped to info/i.test(f)));
  assert.strictEqual(c9.audit.deps.dev.critical, 2);
  assert.strictEqual(c9.audit.sast.remapped, 2);
});

test('scoreSecurity: review-bucket secrets do not hard-cap but are surfaced', () => {
  const c9 = scoreSecurity({
    secrets: {
      secrets: 0, raw_secrets: 40, triaged_secrets: 8, confirmed_secrets: 0,
      review_secrets: 8, excluded_by_path: 32,
    },
    deps: depsIn(),
    sast: sastIn(),
    assessedAt: '2026-07-07',
  });
  // 0 confirmed -> secrets sub is clean (5.0), no hard-cap; review shown as info
  assert.strictEqual(c9.sub.secrets.score, 5.0);
  assert.strictEqual(c9.critical, false);
  assert.strictEqual(c9.score, 5.0);
  assert.ok(c9.findings.some((f) => /8 key-like string\(s\) to review/.test(f)));
  assert.strictEqual(c9.audit.secrets.confirmed, 0);
  assert.strictEqual(c9.audit.secrets.review, 8);
});

test('scoreSecurity: a confirmed secret still hard-caps', () => {
  const c9 = scoreSecurity({
    secrets: {
      secrets: 1, raw_secrets: 3, triaged_secrets: 3, confirmed_secrets: 1,
      review_secrets: 2, excluded_by_path: 0,
    },
    deps: depsIn(),
    sast: sastIn(),
    assessedAt: '2026-07-07',
  });
  assert.strictEqual(c9.sub.secrets.critical, true);
  assert.strictEqual(c9.critical, true);
  assert.strictEqual(c9.colour, 'red');
});

test('scoreSecurity treats transitive CVEs as informational, not scored', () => {
  const c9 = scoreSecurity({
    secrets: { secrets: 0, raw_secrets: 0, triaged_secrets: 0, excluded_by_path: 0 },
    deps: depsIn({ transitive: { critical: 5, high: 10, medium: 0, low: 0, total: 15 } }),
    sast: sastIn(),
    assessedAt: '2026-07-07',
  });
  // transitive excluded from scoring -> deps clean -> all green, un-capped
  assert.strictEqual(c9.score, 5.0);
  assert.strictEqual(c9.critical, false);
  assert.strictEqual(c9.colour, 'green');
  assert.ok(c9.findings.some((f) => /15 transitive/.test(f)));
  assert.strictEqual(c9.audit.deps.transitive.total, 15);
});
