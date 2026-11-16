'use strict';

/*
 * The Anthropic adapter. Uses the official SDK; nothing else in the agents
 * knows it exists.
 *
 * - Streams every request and takes the final message, so long answers do not
 *   hit request timeouts.
 * - Caches the conversation prefix automatically (top-level cache_control), so
 *   each turn of a long audit pays full price only for what is new.
 * - Passes the assistant's content back unchanged, thinking blocks included, as
 *   the API requires.
 * - On models that support it, asks the API to retry a refused request on a
 *   fallback model (`fallbacks: "default"`). Auditing code for security bugs can
 *   trip a safety classifier; a refused auditor would otherwise fail the run.
 *   Turn off with "fallbacks": false.
 */

const AnthropicModule = require('@anthropic-ai/sdk');

const Anthropic = AnthropicModule.default || AnthropicModule;

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const STOPS = {
  end_turn: 'end', tool_use: 'tool', max_tokens: 'limit', refusal: 'refusal',
};

function toWire(content) {
  if (typeof content === 'string') return content;
  return content.map((r) => ({
    type: 'tool_result',
    tool_use_id: r.id,
    content: r.output,
    ...(r.isError ? { is_error: true } : {}),
  }));
}

function create(settings, { client } = {}) {
  const api = client || new Anthropic({ apiKey: process.env[settings.key_env], maxRetries: 4 });
  const useFallbacks = settings.fallbacks !== false && FALLBACK_MODELS.has(settings.model);

  return {
    name: 'anthropic',
    model: settings.model,
    conversation({ system, tools }) {
      const messages = [];
      const toolDefs = tools.map(({ name, description, input_schema: inputSchema }) => ({
        name, description, input_schema: inputSchema,
      }));

      return {
        async send(content) {
          messages.push({ role: 'user', content: toWire(content) });
          const params = {
            model: settings.model,
            max_tokens: settings.max_tokens || 32000,
            system: [{ type: 'text', text: system }],
            tools: toolDefs,
            messages,
            cache_control: { type: 'ephemeral' },
            output_config: { effort: settings.effort || 'high' },
          };
          if (useFallbacks) {
            params.betas = [FALLBACK_BETA];
            params.fallbacks = 'default';
          }

          const message = await api.beta.messages.stream(params).finalMessage();
          messages.push({ role: 'assistant', content: message.content });

          const toolCalls = message.content
            .filter((b) => b.type === 'tool_use')
            .map((b) => ({ id: b.id, name: b.name, input: b.input }));
          const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
          const u = message.usage || {};

          return {
            toolCalls,
            text,
            stop: STOPS[message.stop_reason] || 'other',
            usage: {
              input: u.input_tokens || 0,
              output: u.output_tokens || 0,
              cacheRead: u.cache_read_input_tokens || 0,
              cacheWrite: u.cache_creation_input_tokens || 0,
            },
            model: message.model || settings.model,
          };
        },
      };
    },
  };
}

module.exports = { create };
