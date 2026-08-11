// scripts/benchmark/score-observability.js
'use strict';

// Pure C4 (Observable State) scoring. Consumes the raw observability report
// (per-pillar declared/configured/exercised evidence from scan-observability.js)
// and applies the "active not just present" rung ladder. No hard-cap — an
// under-instrumented system is an operability risk, not a security emergency.

const { round1, colourFor } = require('./score-security');

const PILLARS = [
  { key: 'logging', label: 'Structured logging', tier: 'backend' },
  { key: 'tracing', label: 'Distributed tracing', tier: 'backend' },
  { key: 'backend_errors', label: 'Error tracking (backend)', tier: 'backend' },
  { key: 'frontend_errors', label: 'Error tracking (frontend)', tier: 'frontend' },
];

const RUNG_SCORE = { 0: 0.0, 1: 2.0, 2: 3.5, 3: 5.0 };
const RUNG_NAME = { 0: 'none', 1: 'declared', 2: 'configured', 3: 'exercised' };

const arr = (x) => (Array.isArray(x) ? x : []);

// Tracers that trace the app/LLM pipeline rather than cross-service infra
// requests. When a tracing pillar's declared set is ENTIRELY these, the finding
// is labeled so a green is not misread as APM-grade distributed tracing.
const LLM_TRACERS = ['langfuse', 'langsmith', 'openinference', '@arizeai/openinference', '@vercel/otel'];
const isLlmTracer = (lib) => LLM_TRACERS.some((t) => String(lib).includes(t));

// Highest evidence wins: exercised implies active regardless of the config heuristic.
function rungOf(p) {
  if (arr(p.exercised).length) return 3;
  if (arr(p.configured).length) return 2;
  if (arr(p.declared).length) return 1;
  return 0;
}

function pillarFinding(label, rung, libs) {
  const suffix = libs ? ` (${libs})` : '';
  if (rung === 3) return `${label}: active${suffix}`;
  if (rung === 2) return `${label}: configured but no usage detected${suffix}`;
  if (rung === 1) return `${label}: declared but not configured${suffix}`;
  return `${label}: not instrumented`;
}

function pillarAction(label, rung, libs) {
  const lower = label.toLowerCase();
  if (rung === 3) return null;
  if (rung === 2) return `Exercise ${lower} (${libs || 'the library'}) — add real call sites so it is active, not just configured.`;
  if (rung === 1) return `Configure and exercise ${lower} (${libs}) — it is declared but not wired up.`;
  return `Adopt ${lower} — no supported library is present.`;
}

function scoreObservability(report, { assessedAt } = {}) {
  const r = report || {};
  const sub = {};
  const audit = {};
  const findings = [];
  const actions = [];
  const scored = [];

  for (const pillar of PILLARS) {
    const p = r[pillar.key] || {};
    const applicable = pillar.tier === 'backend' ? true : !!p.applicable;
    audit[pillar.key] = {
      applicable,
      declared: arr(p.declared),
      configured: arr(p.configured),
      exercised: arr(p.exercised),
    };
    if (!applicable) {
      sub[pillar.key] = { applicable: false, score: null, colour: null };
      findings.push(`${pillar.label}: N/A (no frontend surface)`);
      continue;
    }
    const rung = rungOf(p);
    const score = RUNG_SCORE[rung];
    const libs = arr(p.declared).join(', ');
    audit[pillar.key].rung = RUNG_NAME[rung];
    sub[pillar.key] = {
      score, colour: colourFor(score), critical: false, applicable: true, rung: RUNG_NAME[rung],
    };
    scored.push(score);
    let finding = pillarFinding(pillar.label, rung, libs);
    if (pillar.key === 'tracing' && arr(p.declared).length && arr(p.declared).every(isLlmTracer)) {
      finding += ' — LLM/app-level tracing, not infra request tracing';
    }
    findings.push(finding);
    const action = pillarAction(pillar.label, rung, libs);
    if (action) actions.push(action);
  }

  const score = scored.length ? round1(scored.reduce((a, s) => a + s, 0) / scored.length) : null;
  return {
    score,
    colour: score == null ? null : colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'observability readiness — logs/traces/errors, declared→configured→exercised (deps + config + usage)',
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = { scoreObservability, PILLARS };
