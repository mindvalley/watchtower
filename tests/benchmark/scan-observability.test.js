// tests/benchmark/scan-observability.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanRepo } = require('../../scripts/benchmark/scan-observability');

// Build a throwaway repo fixture: { 'package.json': '...', 'src/a.ts': '...' }.
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-fixture-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('js: exercised is credited only when the library is declared', () => {
  const dir = fixture({
    'package.json': '{ "dependencies": { "pino": "^9", "react": "^18" } }',
    'src/logger.ts': 'import pino from "pino";\nexport const logger = pino();',
  });
  const r = scanRepo(dir, 'ts');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(r.logging.declared.includes('pino'), 'pino declared');
  assert.ok(r.logging.exercised.length > 0, 'pino usage credited when declared');
});

test('js: a usage hit with NO declaration is dropped (no false-green from posthog/custom)', () => {
  const dir = fixture({
    // posthog only — NOT an error tracker per decision; no pino/sentry declared.
    'package.json': '{ "dependencies": { "posthog-node": "^4", "react": "^18" } }',
    'src/err.ts': 'export function boom(e){ posthog.captureException(e); }',
    'src/log.ts': 'export const logger = createLogger();',
  });
  const r = scanRepo(dir, 'ts');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(r.backend_errors.declared, [], 'no tracker declared');
  assert.deepStrictEqual(r.backend_errors.exercised, [], 'captureException with no tracker is not credited');
  assert.deepStrictEqual(r.logging.exercised, [], 'createLogger with no logger lib is not credited');
  assert.deepStrictEqual(r.frontend_errors.exercised, [], 'frontend captureException with no tracker is not credited');
});

test('python: langfuse tracing is credited when declared; stdlib logging is not', () => {
  const dir = fixture({
    'pyproject.toml': 'dependencies = ["langfuse >=4", "fastapi ~=0.1"]',
    'src/obs.py': 'from langfuse import Langfuse\nhandler = CallbackHandler()',
    'src/log.py': 'import logging\nlog = logging.getLogger(__name__)',
  });
  const r = scanRepo(dir, 'python');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(r.tracing.declared.includes('langfuse'), 'langfuse declared');
  assert.ok(r.tracing.exercised.length > 0, 'langfuse usage credited');
  assert.deepStrictEqual(r.logging.exercised, [], 'bare stdlib logging is not structured -> not credited');
});

test('elixir pilot: implicit Logger usage is still credited without a declared lib (parity)', () => {
  const dir = fixture({
    'mix.exs': 'defp deps do [] end',
    'lib/app.ex': 'defmodule App do\n  require Logger\n  def go, do: Logger.info("hi")\nend',
  });
  const r = scanRepo(dir, 'elixir');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(r.logging.declared, [], 'no logging lib declared');
  assert.ok(r.logging.exercised.length > 0, 'Elixir Logger usage credited without declaration (pilot behavior preserved)');
});
