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

// When this many turns are left, the agent is told to wrap up and submit what it
// has. An agent that reaches the limit without submitting has cost the whole
// budget and returns nothing.
const WRAP_UP_TURNS = 10;

async function runAgent({
  provider, system, prompt, tools, submit, meter, maxTurns = 80, label, log = () => {},
}) {
  const allTools = [...tools.defs, submit];
  const convo = provider.conversation({ system, tools: allTools });
  let nudged = false;
  let next = prompt;

  for (let turnNo = 1; turnNo <= maxTurns; turnNo += 1) {
    meter.beforeCall();
    const left = maxTurns - turnNo;
    const note = Array.isArray(next) && left === WRAP_UP_TURNS
      ? `${left} turns left. Finish what you are checking and call ${submit.name} with what you have confirmed.`
      : undefined;
    const turn = await convo.send(next, note ? { note } : undefined);
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

module.exports = { runAgent, mapLimit, AgentError, WRAP_UP_TURNS };
