// scripts/benchmark/deployment-signals.js
'use strict';

// Detection signals for C7 deployment-safety readiness, per capability.
// Ecosystem-agnostic by design — portable tools only, no in-house CD names.
// mature — strong capability (canary/blue-green, auto-rollback, gated staged pipeline)
// basic  — weaker but present (rolling update, health checks, plain automated deploy)
// Approximate; validated against real repos before publish and tuned there.
// Adding a tool = edit a list here, no logic change.

module.exports = {
  progressive_delivery: {
    mature: [
      /spinnaker/i,
      /kind:\s*Rollout/,
      /argoproj\.io/i,
      /argo[\s-]?rollouts/i,
      /flagger/i,
      /\bis_canary\b/i,
      /\bcanary\b/i,
      /blue[\s-]?green/i,
      /bluegreen/i,
      /codedeploy/i,
      /trafficRouting/i,
    ],
    basic: [
      /type:\s*RollingUpdate/,
      /rolling[\s-]?update/i,
      /\bmaxSurge\b/,
      /\bmaxUnavailable\b/,
    ],
  },
  automated_rollback: {
    // Specific automated-rollback markers only. A bare "rollback" word is NOT
    // matched — it catches ecto/DB migration rollbacks and commented-out jobs
    // (a real false positive found in validation), not automated deploy rollback.
    mature: [
      /--atomic/,
      /auto[\s_-]?rollback/i,
      /AutoRollbackConfiguration/,
      /rollback[\s_-]?on[\s_-]?failure/i,
      /progressDeadlineSeconds/,
      /kind:\s*AnalysisTemplate/,
    ],
    basic: [
      /readinessProbe/,
      /livenessProbe/,
      /startupProbe/,
      /HEALTHCHECK/,
      /healthcheck:/i,
    ],
  },
  pipeline_safety: {
    // Regex portion (gating + ephemeral envs). The edge ADDS a synthetic
    // "staging->prod" marker to mature when both a staging and a prod deploy
    // path exist, and a "deploy-automation" marker to basic when any deploy
    // workflow exists — those are structural, not single-file regex matches.
    mature: [
      /merge_group/,
      /\bpreview\b/i,
      /\bephemeral\b/i,
      /required[_-]?status[_-]?checks/i,
    ],
    basic: [
      /on:\s*[\s\S]{0,40}?push:/,
      /workflow_dispatch/,
    ],
  },
  // Independently-deployable units usually live under these dirs (umbrella /
  // monorepo layouts). Used with Dockerfile/chart counts by the edge.
  deployableDirs: ['apps', 'services', 'packages', 'cmd'],
  // Files that identify a deploy pipeline (used to count deploy paths).
  deployPathPatterns: [
    /(^|\/)deploy.*\.ya?ml$/i,
    /(^|\/).*-cd(-.*)?\.ya?ml$/i,
    /(^|\/).*deploy.*\.ya?ml$/i,
  ],
};
