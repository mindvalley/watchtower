// tests/benchmark/score-deployment.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scoreDeployment } = require('../../scripts/benchmark/score-deployment');

const L = ({ m = [], b = [] } = {}) => ({ mature: m, basic: b });
const IND = (independent, deployables = 1, deploy_paths = 1) => ({ deployables, deploy_paths, independent });

test('ladder rungs map to scores: none/basic/mature', () => {
  const r = scoreDeployment({
    progressive_delivery: L({ m: ['deploy.yaml'] }), // mature -> 5.0
    automated_rollback: L({ b: ['Dockerfile'] }),    // basic -> 3.5
    pipeline_safety: L(),                            // none -> 0.0
    independent_deployability: IND(true),            // independent -> 5.0
  }, { assessedAt: '2026-07-15' });
  assert.strictEqual(r.sub.progressive_delivery.score, 5.0);
  assert.strictEqual(r.sub.progressive_delivery.rung, 'mature');
  assert.strictEqual(r.sub.automated_rollback.score, 3.5);
  assert.strictEqual(r.sub.automated_rollback.rung, 'basic');
  assert.strictEqual(r.sub.pipeline_safety.score, 0.0);
  assert.strictEqual(r.sub.pipeline_safety.colour, 'red');
});

test('mature wins even when basic is also present', () => {
  const r = scoreDeployment({
    progressive_delivery: L({ m: ['a'], b: ['b'] }),
    automated_rollback: L(), pipeline_safety: L(), independent_deployability: IND(false),
  }, {});
  assert.strictEqual(r.sub.progressive_delivery.rung, 'mature');
  assert.strictEqual(r.sub.progressive_delivery.score, 5.0);
});

test('independent deployability is binary: independent 5.0 / coupled 2.0', () => {
  const indep = scoreDeployment({
    progressive_delivery: L(), automated_rollback: L(), pipeline_safety: L(),
    independent_deployability: IND(true, 1, 1),
  }, {});
  assert.strictEqual(indep.sub.independent_deployability.score, 5.0);
  assert.strictEqual(indep.sub.independent_deployability.rung, 'independent');
  const coupled = scoreDeployment({
    progressive_delivery: L(), automated_rollback: L(), pipeline_safety: L(),
    independent_deployability: IND(false, 6, 1),
  }, {});
  assert.strictEqual(coupled.sub.independent_deployability.score, 2.0);
  assert.strictEqual(coupled.sub.independent_deployability.rung, 'coupled');
});

test('criterion is the mean of the four capabilities', () => {
  const r = scoreDeployment({
    progressive_delivery: L({ m: ['x'] }), // 5.0
    automated_rollback: L({ b: ['x'] }),   // 3.5
    pipeline_safety: L({ m: ['x'] }),      // 5.0
    independent_deployability: IND(false, 6, 1), // 2.0
  }, {});
  // mean(5.0, 3.5, 5.0, 2.0) = 3.875 -> 3.9
  assert.strictEqual(r.score, 3.9);
  assert.strictEqual(r.colour, 'green');
  assert.strictEqual(r.critical, false);
});

test('findings/actions describe rungs; audit carries evidence', () => {
  const r = scoreDeployment({
    progressive_delivery: L({ m: ['deploy.yaml'] }),
    automated_rollback: L(), // none
    pipeline_safety: L({ m: ['ci.yaml'] }),
    independent_deployability: IND(false, 6, 1),
  }, {});
  assert.ok(r.findings.some((f) => /Progressive delivery: mature/.test(f)));
  assert.ok(r.actions.some((a) => /automated rollback/i.test(a)));
  assert.ok(r.findings.some((f) => /Independent deployability: coupled/.test(f)));
  assert.deepStrictEqual(r.audit.progressive_delivery.mature, ['deploy.yaml']);
  assert.strictEqual(r.audit.independent_deployability.deployables, 6);
});

test('empty report degrades to all-zero ladders + coupled floor', () => {
  const r = scoreDeployment({}, {});
  assert.strictEqual(r.sub.progressive_delivery.score, 0.0);
  assert.strictEqual(r.sub.independent_deployability.score, 2.0); // binary floor, not 0
  // mean(0,0,0,2.0) = 0.5
  assert.strictEqual(r.score, 0.5);
  assert.strictEqual(r.colour, 'red');
});
