// tests/benchmark/score-observability.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { scoreObservability } = require('../../scripts/benchmark/score-observability');

const P = ({ d = [], c = [], e = [], applicable } = {}) => {
  const o = { declared: d, configured: c, exercised: e };
  if (applicable !== undefined) o.applicable = applicable;
  return o;
};

test('rung maps to score: none/declared/configured/exercised', () => {
  const r = scoreObservability({
    logging: P({ d: ['logger_json'], c: ['config/prod.exs'], e: ['lib/a.ex'] }), // exercised -> 5
    tracing: P({ d: ['spandex'], c: ['config/prod.exs'] }), // configured -> 3.5
    backend_errors: P({ d: ['sentry'] }), // declared -> 2.0
    frontend_errors: P({ applicable: false }),
  }, { assessedAt: '2026-07-10' });
  assert.strictEqual(r.sub.logging.score, 5.0);
  assert.strictEqual(r.sub.logging.rung, 'exercised');
  assert.strictEqual(r.sub.tracing.score, 3.5);
  assert.strictEqual(r.sub.backend_errors.score, 2.0);
  assert.strictEqual(r.sub.backend_errors.colour, 'red');
});

test('exercised wins even if a lower rung is empty', () => {
  const r = scoreObservability({
    logging: P({ e: ['lib/a.ex'] }), // exercised only
    tracing: P(), backend_errors: P(), frontend_errors: P({ applicable: false }),
  }, {});
  assert.strictEqual(r.sub.logging.rung, 'exercised');
  assert.strictEqual(r.sub.logging.score, 5.0);
});

test('frontend N/A is excluded from the mean and marked applicable:false', () => {
  const r = scoreObservability({
    logging: P({ e: ['x'] }), tracing: P({ e: ['x'] }), backend_errors: P({ e: ['x'] }),
    frontend_errors: P({ applicable: false }),
  }, {});
  assert.strictEqual(r.sub.frontend_errors.applicable, false);
  assert.strictEqual(r.sub.frontend_errors.score, null);
  assert.strictEqual(r.score, 5.0); // mean of the 3 backend 5.0s only
  assert.strictEqual(r.colour, 'green');
});

test('tracing finding is labeled LLM/app-level when only LLM tracers are declared', () => {
  const r = scoreObservability({
    logging: P(), tracing: P({ d: ['langfuse'], e: ['x'] }),
    backend_errors: P(), frontend_errors: P({ applicable: false }),
  }, {});
  const f = r.findings.find((x) => x.startsWith('Distributed tracing'));
  assert.ok(/LLM\/app-level/.test(f), f);
});

test('tracing finding is NOT labeled when a classic infra tracer is present', () => {
  const r = scoreObservability({
    logging: P(), tracing: P({ d: ['mv_opentelemetry', 'langfuse'], e: ['x'] }),
    backend_errors: P(), frontend_errors: P({ applicable: false }),
  }, {});
  const f = r.findings.find((x) => x.startsWith('Distributed tracing'));
  assert.ok(!/LLM\/app-level/.test(f), f);
});

test('full-stack mean includes the frontend pillar when applicable', () => {
  const r = scoreObservability({
    logging: P({ e: ['x'] }), // 5
    tracing: P({ d: ['spandex'] }), // 2.0
    backend_errors: P({ c: ['config/prod.exs'] }), // 3.5
    frontend_errors: P({ applicable: true, d: ['@sentry/vue'] }), // 2.0
  }, {});
  // mean(5.0, 2.0, 3.5, 2.0) = 3.125 -> round1 3.1
  assert.strictEqual(r.score, 3.1);
  assert.strictEqual(r.colour, 'amber');
});

test('findings and actions describe each pillars rung; audit carries evidence', () => {
  const r = scoreObservability({
    logging: P({ d: ['logger_json'], c: ['config/prod.exs'], e: ['lib/a.ex'] }),
    tracing: P({ d: ['spandex'] }),
    backend_errors: P({ e: ['lib/ep.ex'] }),
    frontend_errors: P({ applicable: false }),
  }, {});
  assert.ok(r.findings.some((f) => /Structured logging: active/.test(f)));
  assert.ok(r.actions.some((a) => /Configure and exercise distributed tracing/.test(a)));
  assert.strictEqual(r.audit.tracing.rung, 'declared');
  assert.deepStrictEqual(r.audit.logging.exercised, ['lib/a.ex']);
  assert.strictEqual(r.critical, false);
});

test('empty report degrades to all-zero backend pillars (red), frontend N/A', () => {
  const r = scoreObservability({}, {});
  assert.strictEqual(r.sub.logging.score, 0.0);
  assert.strictEqual(r.sub.frontend_errors.applicable, false);
  assert.strictEqual(r.score, 0.0);
  assert.strictEqual(r.colour, 'red');
});
