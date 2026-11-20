'use strict';

/*
 * An agent's settings, from three places, later ones winning:
 *
 *   agents/<name>/agent.json          the agent's own defaults, shipped with it
 *   watchtower.config.json  agents.<name>        the fleet-wide choice for this
 *                                                organisation
 *   watchtower.config.json  systems.<s>.agents.<name>   one system's override
 *
 * There is one configuration file, the same one the scanners read. An agent does
 * not get a file of its own, because "which systems, and how" is one question
 * and two files would be two answers to it.
 *
 * CREDENTIALS NEVER COME FROM A FILE. With the anthropic provider the config
 * names the environment variable that holds the key (`key_env`); with vertex
 * there is no key at all — Google login supplies the credential. Each provider
 * checks what it needs before anything runs (providers/index.js).
 * The engine already refuses credentials in the committed config, and agents
 * follow the same rule: a setting called `key`, `token` or `secret`, or a value
 * that looks like an API key, stops the run.
 */

const fs = require('node:fs');
const path = require('node:path');
const engine = require('../../scripts/benchmark/engine-config');
const { checkProvider } = require('./providers');

const CREDENTIAL_LOOKING = /^(token|password|secret|key|api_key|private_key|credential)$/i;
const KEY_LOOKING_VALUE = /^(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]+)/;

function refuseCredentials(settings, where) {
  for (const [k, v] of Object.entries(settings)) {
    if (CREDENTIAL_LOOKING.test(k) || (typeof v === 'string' && KEY_LOOKING_VALUE.test(v))) {
      throw new Error(
        `${where} has a credential (${k}). Name the environment variable instead `
        + '("key_env": "ANTHROPIC_API_KEY") and keep the key itself out of committed files.',
      );
    }
  }
}

// A gitignored .env beside the config is the local way to supply the key. It is
// optional: in CI the variable comes from a repository secret instead.
function loadDotEnv(configFile = engine.configPath()) {
  const file = path.join(path.dirname(configFile), '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function readAgentDefaults(agentDir) {
  const file = path.join(agentDir, 'agent.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/*
 * Returns { settings, defaults, system } for one agent on one system.
 * Throws, with the fix in the message, rather than guessing.
 */
function agentSettings(agentName, systemKey, { agentDir, env = process.env } = {}) {
  const defaults = readAgentDefaults(agentDir);
  const cfg = engine.loadConfig();
  const fleet = cfg.agents && cfg.agents[agentName];
  if (!fleet) {
    throw new Error(
      `The watchtower config has no "agents.${agentName}" section. Add one naming the `
      + 'provider, model and key_env — see agents/README.md.',
    );
  }
  refuseCredentials(fleet, `agents.${agentName} in the watchtower config`);

  const system = engine.systemConfig(systemKey);
  if (Array.isArray(fleet.systems) && !fleet.systems.includes(systemKey)) {
    throw new Error(
      `System '${systemKey}' is not in agents.${agentName}.systems `
      + `(${fleet.systems.join(', ')}). Add it there to run ${agentName} on it.`,
    );
  }
  const override = (system.agents && system.agents[agentName]) || {};
  refuseCredentials(override, `systems.${systemKey}.agents.${agentName} in the watchtower config`);

  const { systems, ...fleetSettings } = fleet;
  const settings = { ...defaults.settings, ...fleetSettings, ...override };

  for (const field of ['provider', 'model']) {
    if (!settings[field]) {
      throw new Error(`agents.${agentName} needs "${field}" (in agent.json or the watchtower config).`);
    }
  }
  checkProvider(settings, env);

  return { settings, defaults, system };
}

module.exports = { agentSettings, loadDotEnv, refuseCredentials };
