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

function alertText({ kind, system, before, after, owners = [], boardUrl }) {
  const scores = before && before.score != null ? `${before.score} → ${after.score}` : `${after.score}`;
  const headline = kind === 'dropped'
    ? `:red_circle: *${system}* dropped to red (${scores}).`
    : `:large_green_circle: *${system}* recovered from red (${scores}).`;
  const lines = [headline];
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
  redTransition, mention, alertText, isOwnerId, sendSlack, OWNER_ID,
};
