'use strict';

/*
 * Claude on Google Cloud Vertex AI. Keyless: there is no API key anywhere.
 *
 * Credentials are Google's Application Default Credentials —
 *   in CI      google-github-actions/auth exchanges the workflow's OIDC token for
 *              a short-lived service-account credential (Workload Identity
 *              Federation), the same way the fleet's other agents run;
 *   locally    `gcloud auth application-default login`.
 *
 * The config names the variable holding the Vertex project ID (`project_env`)
 * and the region (default "global"). Requests, caching and the conversation
 * shape are the Anthropic adapter's; only the client differs.
 */

const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
const anthropic = require('./anthropic');

const DEFAULTS = { project_env: 'ANTHROPIC_VERTEX_PROJECT_ID', region: 'global' };

function check(settings, env) {
  const projectEnv = settings.project_env || DEFAULTS.project_env;
  if (!env[projectEnv]) {
    return `${projectEnv} is not set. It holds the Google Cloud project for Vertex AI; `
      + 'credentials come from Google login (gcloud locally, Workload Identity in CI), not a key.';
  }
  return null;
}

function create(settings, { client } = {}) {
  const projectEnv = settings.project_env || DEFAULTS.project_env;
  const api = client || new AnthropicVertex({
    projectId: process.env[projectEnv],
    region: settings.region || DEFAULTS.region,
    maxRetries: 4,
  });
  // Server-side refusal fallbacks do not exist on Vertex; never request them.
  return { ...anthropic.create({ ...settings, fallbacks: false }, { client: api }), name: 'vertex' };
}

module.exports = { create, check, DEFAULTS };
