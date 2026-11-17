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
 * last one run the bill past the cap.
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
  }

  requirePrice(model) {
    if (this.capUsd != null && !priceFor(this.prices, model)) {
      throw new Error(
        `No price for model '${model}', so the spending cap cannot be enforced. `
        + 'Add it under "prices" in the agent settings, or remove max_cost_usd.',
      );
    }
  }

  beforeCall() {
    if (this.capUsd != null && this.usd + this.reserveUsd > this.capUsd) {
      throw new CostCapError(this.usd, this.capUsd);
    }
  }

  add(usage, model) {
    this.calls += 1;
    for (const k of Object.keys(this.tokens)) this.tokens[k] += usage[k] || 0;
    const p = priceFor(this.prices, model) || priceFor(this.prices, this.model);
    if (!p) return;
    this.usd += ((usage.input || 0) * p.input
      + (usage.output || 0) * p.output
      + (usage.cacheRead || 0) * (p.cache_read ?? p.input)
      + (usage.cacheWrite || 0) * (p.cache_write ?? p.input)) / 1e6;
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
