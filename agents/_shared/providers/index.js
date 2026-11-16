'use strict';

/*
 * Which model provider an agent talks to is the user's choice. Agents never call
 * a provider SDK directly; they use this one interface, and each provider is an
 * adapter behind it.
 *
 *   const convo = provider.conversation({ system, tools });
 *   let turn = await convo.send('first message');            // a string, or
 *   turn = await convo.send([{ id, output, isError }]);      // tool results
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
 * To add a provider: write providers/<name>.js exporting create(settings) that
 * returns { name, model, conversation }, and add it below.
 */

const ADAPTERS = {
  anthropic: () => require('./anthropic'),
};

function createProvider(settings) {
  const load = ADAPTERS[settings.provider];
  if (!load) {
    throw new Error(
      `Unknown provider '${settings.provider}'. Supported: ${Object.keys(ADAPTERS).join(', ')}.`,
    );
  }
  return load().create(settings);
}

module.exports = { createProvider, PROVIDERS: Object.keys(ADAPTERS) };
