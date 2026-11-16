'use strict';

/*
 * One agent working until it hands in an answer.
 *
 * The agent gets the tree tools plus one "submit" tool whose schema is the shape
 * of the answer. The loop runs tools until the agent calls submit, and returns
 * what it submitted. Handing the answer in as a tool call, rather than as text
 * to be parsed, means the answer arrives as structured input on every provider.
 *
 * Fails loudly rather than returning something partial: an agent that runs out
 * of turns, hits its output limit, is refused, or never submits throws, and the
 * caller decides what that means for the run. Never falsely clean.
 */

class AgentError extends Error {
  constructor(message, { label } = {}) {
    super(label ? `${label}: ${message}` : message);
    this.name = 'AgentError';
  }
}

async function runAgent({
  provider, system, prompt, tools, submit, meter, maxTurns = 120, label, log = () => {},
}) {
  const allTools = [...tools.defs, submit];
  const convo = provider.conversation({ system, tools: allTools });
  let nudged = false;
  let next = prompt;

  for (let turnNo = 1; turnNo <= maxTurns; turnNo += 1) {
    meter.beforeCall();
    const turn = await convo.send(next);
    meter.add(turn.usage, turn.model);

    if (turn.stop === 'refusal') throw new AgentError('the model declined the request', { label });
    if (turn.stop === 'limit') throw new AgentError('the answer hit the output limit; raise max_tokens', { label });

    const submitted = turn.toolCalls.find((c) => c.name === submit.name);
    if (submitted) {
      log(`${label}: submitted after ${turnNo} turns`);
      return submitted.input;
    }

    if (turn.toolCalls.length === 0) {
      if (nudged) throw new AgentError('ended without submitting an answer', { label });
      nudged = true;
      next = `Call ${submit.name} now with your answer. Do not reply in text.`;
      continue;
    }

    next = turn.toolCalls.map((call) => {
      if (!tools.has(call.name)) return { id: call.id, output: `unknown tool: ${call.name}`, isError: true };
      const { output, isError } = tools.run(call.name, call.input);
      return { id: call.id, output, isError };
    });
  }
  throw new AgentError(`no answer after ${maxTurns} turns`, { label });
}

// Runs fn over items with at most `limit` in flight. Rejects on the first
// failure, after letting the ones already started finish.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  let failure = null;
  const worker = async () => {
    while (index < items.length && !failure) {
      const i = index;
      index += 1;
      try { results[i] = await fn(items[i], i); } catch (err) { failure = failure || err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure;
  return results;
}

module.exports = { runAgent, mapLimit, AgentError };
