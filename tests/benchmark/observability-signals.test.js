// tests/benchmark/observability-signals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const signals = require('../../scripts/benchmark/observability-signals');

test('every backend stack defines the three pillars with non-empty signals', () => {
  for (const stack of ['elixir', 'ruby']) {
    for (const pillar of ['logging', 'tracing', 'errors']) {
      const p = signals[stack][pillar];
      assert.ok(p.deps.length > 0, `${stack}.${pillar}.deps`);
      assert.ok(p.config.every((r) => r instanceof RegExp), `${stack}.${pillar}.config regex`);
      assert.ok(p.usage.every((r) => r instanceof RegExp), `${stack}.${pillar}.usage regex`);
    }
  }
});

test('frontend defines an error pillar and framework markers', () => {
  assert.ok(signals.frontend.errors.deps.includes('@sentry/vue'));
  assert.ok(signals.frontend.frameworks.includes('vue'));
});

const anyMatch = (patterns, s) => patterns.some((re) => re.test(s));

test('ruby error usage detects AppSignal (auto-instrumenting; no explicit-call assumption)', () => {
  const u = signals.ruby.errors.usage;
  assert.ok(anyMatch(u, 'Appsignal.set_error(e)'), 'Appsignal.set_error');
  assert.ok(anyMatch(u, 'Appsignal::Transaction.current'), 'Appsignal::Transaction');
  // and the classic trackers still match
  assert.ok(anyMatch(u, 'Sentry.capture_exception(e)'), 'Sentry.capture_exception');
});

test('ruby error config recognises a realistic AppSignal config (lowercase YAML keys)', () => {
  const c = signals.ruby.errors.config;
  // Real config/appsignal.yml has lowercase keys, no "Appsignal" string — match push_api_key.
  assert.ok(anyMatch(c, 'default: &defaults\n  name: "ruby-app"\n  push_api_key: "<%= ENV[\'X\'] %>"'), 'appsignal.yml push_api_key');
});

test('frontend error usage does NOT match a bare Vue errorHandler (error handling != error tracking)', () => {
  const u = signals.frontend.errors.usage;
  assert.ok(!anyMatch(u, 'app.config.errorHandler = (err) => console.log(err)'), 'bare errorHandler must not count');
  // real tracker call sites still count
  assert.ok(anyMatch(u, 'Sentry.captureException(err)'), 'captureException');
  assert.ok(anyMatch(u, 'Bugsnag.notify(err)'), 'Bugsnag.notify');
});

test('js and python backend stacks define the three pillars with non-empty signals', () => {
  for (const stack of ['js', 'python']) {
    for (const pillar of ['logging', 'tracing', 'errors']) {
      const p = signals[stack][pillar];
      assert.ok(p.deps.length > 0, `${stack}.${pillar}.deps`);
      assert.ok(p.config.length > 0 && p.config.every((r) => r instanceof RegExp), `${stack}.${pillar}.config`);
      assert.ok(p.usage.length > 0 && p.usage.every((r) => r instanceof RegExp), `${stack}.${pillar}.usage`);
    }
  }
});

test('js tracing recognizes LLM + OTel tracers; js logging anchors to lib fingerprints', () => {
  assert.ok(signals.js.tracing.deps.includes('langfuse'));
  assert.ok(signals.js.tracing.deps.includes('@vercel/otel'));
  const u = signals.js.logging.usage;
  assert.ok(u.some((re) => re.test('const logger = pino()')), 'pino() fingerprint counts');
  assert.ok(!u.some((re) => re.test("logger.info('hi')")), 'bare logger.info must NOT count');
});

test('python tracing recognizes langfuse/langsmith/openinference; errors recognizes sentry-sdk', () => {
  assert.ok(signals.python.tracing.deps.includes('langfuse'));
  assert.ok(signals.python.tracing.deps.includes('openinference-instrumentation'));
  assert.ok(signals.python.errors.deps.includes('sentry-sdk'));
  const u = signals.python.tracing.usage;
  assert.ok(u.some((re) => re.test('handler = CallbackHandler()')), 'langfuse CallbackHandler counts');
});

test('python logging usage counts structlog/loguru but not bare stdlib logging', () => {
  const u = signals.python.logging.usage;
  assert.ok(!u.some((re) => re.test('import logging\nlog = logging.getLogger(__name__)')), 'stdlib logging not structured');
  assert.ok(u.some((re) => re.test('import structlog\nlog = structlog.get_logger()')), 'structlog counts');
});
