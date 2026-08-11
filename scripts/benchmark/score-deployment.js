// scripts/benchmark/score-deployment.js
'use strict';

// Pure C7 (Deployment Safety) scoring. Consumes the raw deployment report
// (per-capability evidence from scan-deployment.js) and applies a
// none->basic->mature rung ladder for the three tool capabilities plus a
// binary independent/coupled score for deployability. No hard-cap — an
// under-hardened deploy path is an operability risk, not a security emergency.

const { round1, colourFor } = require('./score-security');

const CAPABILITIES = [
  { key: 'progressive_delivery', label: 'Progressive delivery', kind: 'ladder' },
  { key: 'automated_rollback', label: 'Automated rollback', kind: 'ladder' },
  { key: 'pipeline_safety', label: 'Pipeline safety', kind: 'ladder' },
  { key: 'independent_deployability', label: 'Independent deployability', kind: 'binary' },
];

const LADDER_SCORE = { none: 0.0, basic: 3.5, mature: 5.0 };
const arr = (x) => (Array.isArray(x) ? x : []);

function ladderRung(cap) {
  if (arr(cap.mature).length) return 'mature';
  if (arr(cap.basic).length) return 'basic';
  return 'none';
}

function ladderFinding(label, rung) {
  if (rung === 'mature') return `${label}: mature`;
  if (rung === 'basic') return `${label}: basic (present but not hardened)`;
  return `${label}: not detected in-repo`;
}

function ladderAction(label, rung) {
  const lower = label.toLowerCase();
  if (rung === 'mature') return null;
  if (rung === 'basic') return `Harden ${lower} — a basic mechanism exists; add the mature capability (see the criterion reference).`;
  return `Adopt ${lower} — no supported mechanism is declared in-repo. If it is handled by an external CD platform, surface it in-repo for agent visibility.`;
}

function scoreLadder(cap, capData, sub, audit, findings, actions, scored) {
  const c = capData || {};
  const rung = ladderRung(c);
  const score = LADDER_SCORE[rung];
  audit[cap.key] = { rung, mature: arr(c.mature), basic: arr(c.basic) };
  sub[cap.key] = { score, colour: colourFor(score), critical: false, rung };
  scored.push(score);
  findings.push(ladderFinding(cap.label, rung));
  const action = ladderAction(cap.label, rung);
  if (action) actions.push(action);
}

function scoreBinary(cap, capData, sub, audit, findings, actions, scored) {
  const c = capData || {};
  const independent = !!c.independent;
  const score = independent ? 5.0 : 2.0;
  const rung = independent ? 'independent' : 'coupled';
  audit[cap.key] = {
    rung,
    deployables: Number(c.deployables) || 0,
    deploy_paths: Number(c.deploy_paths) || 0,
  };
  sub[cap.key] = { score, colour: colourFor(score), critical: false, rung };
  scored.push(score);
  if (independent) {
    findings.push(`${cap.label}: independent`);
  } else {
    const n = audit[cap.key].deployables;
    findings.push(`${cap.label}: coupled${n ? ` (${n} deployables share a single deploy path)` : ''}`);
    actions.push('Make deployables independently releasable — give each unit its own deploy path so a change to one need not redeploy all.');
  }
}

function scoreDeployment(report, { assessedAt } = {}) {
  const r = report || {};
  const sub = {};
  const audit = {};
  const findings = [];
  const actions = [];
  const scored = [];

  for (const cap of CAPABILITIES) {
    if (cap.kind === 'binary') {
      scoreBinary(cap, r[cap.key], sub, audit, findings, actions, scored);
    } else {
      scoreLadder(cap, r[cap.key], sub, audit, findings, actions, scored);
    }
  }

  const score = scored.length ? round1(scored.reduce((a, s) => a + s, 0) / scored.length) : null;
  return {
    score,
    colour: score == null ? null : colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'deployment-safety readiness — progressive delivery / automated rollback / pipeline safety / independent deployability, from in-repo CI+IaC+Docker config (DORA capabilities)',
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = { scoreDeployment, CAPABILITIES };
