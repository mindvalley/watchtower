'use strict';

/*
 * What a run has spent, and whether the next call may start.
 *
 * Prices are dollars per million tokens, per model, from agent.json (or the
 * config, to override): Anthropic API list prices. The cap is off unless
 * max_cost_usd is set. It always counts at those prices, whichever provider
 * serves the requests — on Vertex, which bills at Google's rates, the figure is
 * an estimate. A model with no price and a cap set is refused: a cap that cannot
 * count is not a cap.
 *
 * The check is made BEFORE each call, against what has been spent so far plus
 * a reserve for the call about to start. Checking only after a call lets the
 * last one run the bill past the cap. Calls still running in other agents are
 * held against the cap too (see beforeCall).
 */

class CostCapError extends Error {
  constructor(spent, cap) {
    super(`Spending cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}. The run stops here.`);
    this.name = 'CostCapError';
  }
}

function priceFor(prices, model) {
  return prices && prices[model];
}

class CostMeter {
  // `model` is the configured model. A turn answered by a fallback model with no
  // price of its own is counted at the configured model's price rather than as
  // free, so a refusal fallback cannot slip spend past the cap.
  constructor({ prices, capUsd = null, reserveUsd = 0.5, model = null } = {}) {
    this.prices = prices || {};
    this.model = model;
    this.capUsd = capUsd;
    this.reserveUsd = reserveUsd;
    this.usd = 0;
    this.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.calls = 0;
    this.maxCallUsd = 0; // the most expensive single call so far
    this.inFlight = 0; // calls started and not yet released
    this.waiting = []; // callers waiting for a running call to finish
  }

  requirePrice(model) {
    if (this.capUsd != null && !priceFor(this.prices, model)) {
      throw new Error(
        `No price for model '${model}', so the spending cap cannot be enforced. `
        + 'Add it under "prices" in the agent settings, or remove max_cost_usd.',
      );
    }
  }

  // Waits until the next call may start, then holds room for it under the cap.
  // Resolves to a release function: call it once the send has finished, whether
  // it succeeded or threw (after add() when it succeeded).
  //
  // Agents running at once share one meter, so a call must also leave room for
  // the calls still running, which have not been counted yet:
  //   - until a call has finished, nobody knows what one costs, so calls run
  //     one at a time;
  //   - after that, each running call, and a new call that would run beside
  //     them, is held at the larger of the reserve and the most expensive call
  //     seen so far.
  // A call that does not fit waits while others are running (they may cost
  // less than held), and is refused once none are. One agent alone always
  // checks spent + reserve, as before.
  //
  // Waiters are not served in order: every release wakes them all, and an agent
  // that has just released may take the room again before them. And the cap
  // bounds the estimate, not the bill: a call can cost more than the largest
  // seen so far, or than the reserve, and take the total past the cap.
  async beforeCall() {
    while (this.capUsd != null) {
      if (this.calls === 0 && this.inFlight > 0) { await this.nextRelease(); continue; }
      const perCall = Math.max(this.reserveUsd, this.maxCallUsd);
      const held = this.inFlight * perCall;
      const own = this.inFlight > 0 ? perCall : this.reserveUsd;
      if (this.usd + held + own <= this.capUsd) break;
      if (this.inFlight === 0) throw new CostCapError(this.usd, this.capUsd);
      await this.nextRelease();
    }
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
      const waiting = this.waiting;
      this.waiting = [];
      waiting.forEach((wake) => wake());
    };
  }

  nextRelease() {
    return new Promise((resolve) => { this.waiting.push(resolve); });
  }

  add(usage, model) {
    this.calls += 1;
    for (const k of Object.keys(this.tokens)) this.tokens[k] += usage[k] || 0;
    const p = priceFor(this.prices, model) || priceFor(this.prices, this.model);
    if (!p) return;
    const usd = ((usage.input || 0) * p.input
      + (usage.output || 0) * p.output
      + (usage.cacheRead || 0) * (p.cache_read ?? p.input)
      + (usage.cacheWrite || 0) * (p.cache_write ?? p.input)) / 1e6;
    this.usd += usd;
    this.maxCallUsd = Math.max(this.maxCallUsd, usd);
  }

  summary() {
    return {
      usd: Math.round(this.usd * 100) / 100,
      basis: 'Anthropic API list prices',
      calls: this.calls,
      tokens: { ...this.tokens },
      cap_usd: this.capUsd,
    };
  }
}

module.exports = { CostMeter, CostCapError };
