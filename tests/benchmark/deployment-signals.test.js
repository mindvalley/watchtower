// tests/benchmark/deployment-signals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const signals = require('../../scripts/benchmark/deployment-signals');

const anyMatch = (patterns, s) => patterns.some((re) => re.test(s));

test('each ladder capability defines non-empty mature and basic regex lists', () => {
  for (const cap of ['progressive_delivery', 'automated_rollback', 'pipeline_safety']) {
    const c = signals[cap];
    assert.ok(c.mature.length > 0, `${cap}.mature`);
    assert.ok(c.basic.length > 0, `${cap}.basic`);
    assert.ok([...c.mature, ...c.basic].every((r) => r instanceof RegExp), `${cap} regex`);
  }
});

test('progressive delivery: canary/Spinnaker/Argo -> mature; rolling -> basic', () => {
  const m = signals.progressive_delivery.mature;
  assert.ok(anyMatch(m, 'uses: acme/spinnaker-deployment@main'), 'spinnaker');
  assert.ok(anyMatch(m, 'kind: Rollout'), 'argo rollout');
  assert.ok(anyMatch(m, '  is_canary: true'), 'is_canary');
  assert.ok(anyMatch(m, 'strategy:\n    blueGreen:'), 'blue-green');
  assert.ok(anyMatch(signals.progressive_delivery.basic, 'type: RollingUpdate'), 'rolling');
});

test('automated rollback: --atomic/auto-rollback -> mature; probes/HEALTHCHECK -> basic', () => {
  const m = signals.automated_rollback.mature;
  assert.ok(anyMatch(m, 'helm upgrade --install --atomic'), '--atomic');
  assert.ok(anyMatch(m, '  progressDeadlineSeconds: 600'), 'progressDeadlineSeconds');
  assert.ok(anyMatch(m, '  autoRollback: true'), 'auto-rollback');
  const b = signals.automated_rollback.basic;
  assert.ok(anyMatch(b, '  readinessProbe:'), 'readinessProbe');
  assert.ok(anyMatch(b, 'HEALTHCHECK --interval=30s'), 'HEALTHCHECK');
});

test('automated rollback does NOT match a bare or commented "rollback" (deploy rollback != ecto/commented)', () => {
  const m = signals.automated_rollback.mature;
  assert.ok(!anyMatch(m, '  # - name: Trigger Spinnaker webhook to rollback staging deploy'), 'commented rollback must not count');
  assert.ok(!anyMatch(m, '    mix ecto.rollback'), 'ecto.rollback must not count');
});

test('pipeline safety: merge queue / preview -> mature', () => {
  const m = signals.pipeline_safety.mature;
  assert.ok(anyMatch(m, 'on:\n  merge_group:'), 'merge_group');
  assert.ok(anyMatch(m, 'name: staging-preview-env-cd'), 'preview');
});

test('deployable dirs and deploy-path patterns are defined', () => {
  assert.ok(signals.deployableDirs.includes('apps'));
  assert.ok(signals.deployPathPatterns.some((r) => r instanceof RegExp && r.test('gh-action-prod-cd.yaml')));
});
