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

// How many malformed submissions an agent may correct before it fails.
const MAX_MALFORMED = 1;

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/*
 * The first way `value` breaks the submit tool's JSON Schema, or null. Covers
 * what the submit schemas use: type, required, properties, items, enum,
 * minItems. A model's answer is not guaranteed to match the schema it was
 * given — a list sent as one JSON string has been seen — and an unchecked
 * answer fails far downstream, after the whole run's work is spent.
 */
function checkInput(schema, value, at = '') {
  const name = at || 'the answer';
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type) {
    const want = schema.type === 'integer' ? 'number' : schema.type;
    if (typeOf(value) !== want) return `${name} must be ${want === 'array' || want === 'object' ? 'an' : 'a'} ${want}, not ${typeOf(value)}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${name} must be one of ${schema.enum.join(', ')}`;
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) return `${at ? `${at}.` : ''}${key} is required`;
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) {
        const err = checkInput(sub, value[key], at ? `${at}.${key}` : key);
        if (err) return err;
      }
    }
  }
  if (typeOf(value) === 'array') {
    if (schema.minItems && value.length < schema.minItems) return `${name} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`;
    for (const [i, item] of value.entries()) {
      const err = checkInput(schema.items, item, `${at}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

async function runAgent({
  provider, system, prompt, tools, submit, meter, maxTurns = 80, label, log = () => {},
}) {
  const allTools = [...tools.defs, submit];
  const convo = provider.conversation({ system, tools: allTools });
  let nudged = false;
  let malformed = 0;
  let next = prompt;

  for (let turnNo = 1; turnNo <= maxTurns; turnNo += 1) {
    const left = maxTurns - turnNo;
    // Sent whatever the turn carries — tool results, or the nudge after a text
    // reply — so a reply in text on the wrong turn cannot skip the warning.
    const note = left === WRAP_UP_TURNS
      ? `${left} turns left. Finish what you are checking and call ${submit.name} with what you have confirmed.`
      : undefined;
    const release = await meter.beforeCall();
    let turn;
    try {
      turn = await convo.send(next, note ? { note } : undefined);
      meter.add(turn.usage, turn.model);
    } finally {
      release();
    }

    if (turn.stop === 'refusal') throw new AgentError('the model declined the request', { label });
    if (turn.stop === 'limit') throw new AgentError('the answer hit the output limit; raise max_tokens', { label });

    const submitted = turn.toolCalls.find((c) => c.name === submit.name);
    const problem = submitted ? checkInput(submit.input_schema, submitted.input) : null;
    if (submitted && !problem) {
      log(`${label}: submitted after ${turnNo} turns`);
      return submitted.input;
    }
    if (submitted) {
      malformed += 1;
      log(`${label}: malformed ${submit.name} (${problem})${malformed > MAX_MALFORMED ? '' : ', asked to resubmit'}`);
      if (malformed > MAX_MALFORMED) throw new AgentError(`submitted a malformed answer twice: ${problem}`, { label });
    }

    if (turn.toolCalls.length === 0) {
      if (nudged) throw new AgentError('ended without submitting an answer', { label });
      nudged = true;
      next = `Call ${submit.name} now with your answer. Do not reply in text.`;
      continue;
    }

    next = turn.toolCalls.map((call) => {
      if (call === submitted) {
        return { id: call.id, output: `Not accepted: ${problem}. Call ${submit.name} again with your whole answer, matching its schema.`, isError: true };
      }
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

module.exports = {
  runAgent, mapLimit, checkInput, AgentError, WRAP_UP_TURNS,
};
