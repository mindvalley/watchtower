'use strict';

const OWNER_ID = /^[UWS][A-Z0-9]{8,11}$/;
const SEND_TIMEOUT_MS = 5000;

function isOwnerId(value) {
  return typeof value === 'string' && OWNER_ID.test(value);
}

function redTransition(beforeColour, afterColour) {
  if (afterColour === 'red' && beforeColour !== 'red') return 'dropped';
  if (beforeColour === 'red' && afterColour && afterColour !== 'red') return 'recovered';
  return null;
}

function mention(id) {
  return id.startsWith('S') ? `<!subteam^${id}>` : `<@${id}>`;
}

function scored(criteria) {
  return Object.entries(criteria || {}).filter(([, c]) => c && typeof c.score === 'number');
}

function redCause(beforeCriteria, afterCriteria, names = {}) {
  const now = scored(afterCriteria);
  if (!now.length) return null;
  const describe = ([id, c], rest) => ({
    name: names[id] || `criterion ${id}`, ...rest, action: (c.actions && c.actions[0]) || null,
  });

  const capped = now.find(([, c]) => c.critical);
  if (capped) return describe(capped, { reason: 'critical' });

  const earlier = Object.fromEntries(scored(beforeCriteria));
  const fallen = now
    .filter(([id, c]) => id in earlier && earlier[id].score > c.score)
    .sort(([ia, a], [ib, b]) => (earlier[ib].score - b.score) - (earlier[ia].score - a.score) || a.score - b.score);
  if (fallen.length) {
    const [id, c] = fallen[0];
    return describe(fallen[0], { reason: 'fell', from: earlier[id].score, to: c.score });
  }

  const weakest = now.slice().sort(([, a], [, b]) => a.score - b.score)[0];
  return describe(weakest, { reason: 'weakest', to: weakest[1].score });
}

function causeLine(cause) {
  if (cause.reason === 'critical') return `Cause: *${cause.name}* has a critical finding, which caps the score.`;
  if (cause.reason === 'fell') return `Cause: *${cause.name}* fell furthest (${cause.from} → ${cause.to} of 5).`;
  return `Cause: *${cause.name}* is the weakest criterion (${cause.to} of 5).`;
}

function alertText({
  kind, system, before, after, owners = [], boardUrl, cause,
}) {
  const scores = before && before.score != null ? `${before.score} → ${after.score}` : `${after.score}`;
  const headline = kind === 'dropped'
    ? `:red_circle: *${system}* dropped to red (${scores}).`
    : `:large_green_circle: *${system}* recovered from red (${scores}).`;
  const lines = [headline];
  if (kind === 'dropped' && cause) {
    lines.push(causeLine(cause));
    if (cause.action) lines.push(`Fix: ${cause.action}`);
  }
  if (owners.length) lines.push(owners.map(mention).join(' '));
  if (boardUrl) lines.push(`${boardUrl.replace(/\/+$/, '')}/system/${encodeURIComponent(system)}`);
  return lines.join('\n');
}

async function sendSlack(webhookUrl, text, { fetchImpl = fetch, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Slack refused the alert: HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  redTransition, redCause, mention, alertText, isOwnerId, sendSlack, OWNER_ID,
};
