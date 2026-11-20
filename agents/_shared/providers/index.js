'use strict';

/*
 * Which model provider an agent talks to is the user's choice. Agents never call
 * a provider SDK directly; they use this one interface, and each provider is an
 * adapter behind it.
 *
 *   const convo = provider.conversation({ system, tools });
 *   let turn = await convo.send('first message');            // a string, or
 *   turn = await convo.send([{ id, output, isError }]);      // tool results
 *   turn = await convo.send(results, { note });              // plus a short note
 *
 *   turn = {
 *     toolCalls: [{ id, name, input }],
 *     text,                                   // any plain text the model wrote
 *     stop: 'end' | 'tool' | 'limit' | 'refusal' | 'other',
 *     usage: { input, output, cacheRead, cacheWrite },
 *     model,                                  // the model that actually answered
 *   }
 *
 * `tools` are { name, description, input_schema } with a JSON Schema. The adapter
 * owns the conversation history in its own wire format; agents never see it.
 *
 * Providers:
 *   anthropic   Anthropic API, key from the variable named by `key_env`
 *   vertex      Claude on Google Vertex AI, keyless (Google login / Workload
 *               Identity); project from the variable named by `project_env`
 *
 * To add one: write providers/<name>.js exporting create(settings) and
 * check(settings, env) (a message saying what is missing, or null), and add it
 * below.
 */

const ADAPTERS = {
  anthropic: () => require('./anthropic'),
  vertex: () => require('./vertex'),
};

function adapter(name) {
  const load = ADAPTERS[name];
  if (!load) throw new Error(`Unknown provider '${name}'. Supported: ${Object.keys(ADAPTERS).join(', ')}.`);
  return load();
}

// What the provider needs from the environment, checked before anything runs.
function checkProvider(settings, env = process.env) {
  const problem = adapter(settings.provider).check(settings, env);
  if (problem) throw new Error(problem);
}

function createProvider(settings) {
  return adapter(settings.provider).create(settings);
}

module.exports = { createProvider, checkProvider, PROVIDERS: Object.keys(ADAPTERS) };
