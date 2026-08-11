// tests/benchmark/score-test-coverage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scoreTestCoverage } = require('../../scripts/benchmark/score-test-coverage');

const stack = (source, tested, tool, thresholds = []) => ({
  source_files: source,
  tested_files: tested,
  untested_samples: [],
  tooling: { tool, present: !!tool, thresholds, enforced: thresholds.some((t) => t > 0) },
});

test('returns null when not applicable', () => {
  assert.strictEqual(scoreTestCoverage({ applicable: false, stacks: {} }), null);
});

test('enforced thresholds imply presence even if tooling.present is false (T7)', () => {
  // Real-repo validation: a scan can find enforced thresholds without matching a
  // tool-name string, leaving present:false. Enforced coverage must NOT score 0.
  const r = scoreTestCoverage({
    applicable: true,
    stacks: {
      elixir: {
        source_files: 10, tested_files: 10, untested_samples: [],
        tooling: { tool: null, present: false, thresholds: [78, 82], enforced: true },
      },
    },
  });
  assert.strictEqual(r.sub.coverage_discipline.score, 4.25); // mean 80 -> enforced tier, not 0
});

test('returns null when no stacks / zero source (no false green)', () => {
  assert.strictEqual(scoreTestCoverage({ applicable: true, stacks: {} }), null);
  assert.strictEqual(scoreTestCoverage({ applicable: true, stacks: { elixir: stack(0, 0, 'excoveralls', [80]) } }), null);
});

test('breadth is linear and pooled across stacks', () => {
  // elixir 2/4 + frontend 1/1 => pooled 3/5 = 0.6 => 3.0
  const r = scoreTestCoverage({
    applicable: true,
    stacks: { elixir: stack(4, 2, 'excoveralls', [90]), frontend: stack(1, 1, 'vitest/jest', [90]) },
  }, { assessedAt: '2026-07-17' });
  assert.strictEqual(r.sub.test_breadth.score, 3.0);
});

test('discipline rungs: none=0, configured-not-enforced=2.0, enforced graded on tiers', () => {
  const none = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, null, []) } });
  assert.strictEqual(none.sub.coverage_discipline.score, 0.0);

  const cfg = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', []) } });
  assert.strictEqual(cfg.sub.coverage_discipline.score, 2.0); // present, no threshold

  const cfg0 = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', [0]) } });
  assert.strictEqual(cfg0.sub.coverage_discipline.score, 2.0); // minimum_coverage 0 => not enforced

  const g90 = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', [90]) } });
  assert.strictEqual(g90.sub.coverage_discipline.score, 5.0);
  const g78 = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', [78, 82]) } });
  assert.strictEqual(g78.sub.coverage_discipline.score, 4.25); // mean 80 => 75-89 tier
  const g62 = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', [62]) } });
  assert.strictEqual(g62.sub.coverage_discipline.score, 3.5);
  const g50 = scoreTestCoverage({ applicable: true, stacks: { elixir: stack(10, 10, 'excoveralls', [50]) } });
  assert.strictEqual(g50.sub.coverage_discipline.score, 2.5);
});

test('discipline is mean of applicable stacks', () => {
  // elixir enforced 90 => 5.0, frontend configured-not-enforced => 2.0, mean => 3.5(=3.5)
  const r = scoreTestCoverage({
    applicable: true,
    stacks: { elixir: stack(10, 10, 'excoveralls', [90]), frontend: stack(10, 10, 'vitest/jest', []) },
  });
  assert.strictEqual(r.sub.coverage_discipline.score, 3.5);
});

test('composite = mean(breadth, discipline); entry shape complete', () => {
  const r = scoreTestCoverage({
    applicable: true,
    stacks: { elixir: stack(10, 8, 'excoveralls', [90]) }, // breadth 0.8=>4.0 ; discipline 5.0
  }, { assessedAt: '2026-07-17' });
  assert.strictEqual(r.score, 4.5); // mean(4.0, 5.0)
  assert.strictEqual(r.colour, 'green');
  assert.strictEqual(r.critical, false);
  assert.strictEqual(r.assessed, true);
  assert.strictEqual(r.assessed_at, '2026-07-17');
  assert.ok(typeof r.source === 'string' && r.source.length > 0);
  assert.ok(Array.isArray(r.findings) && r.findings.length > 0);
  assert.ok(Array.isArray(r.actions));
  assert.ok(r.audit && r.audit.breadth && r.audit.discipline);
});
