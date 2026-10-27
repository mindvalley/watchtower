'use strict';

const OWNER_ID = /^[UWS][A-Z0-9]{8,11}$/;
const SEND_TIMEOUT_MS = 5000;
// A Slack workflow's webhook takes a fixed set of variables, so owners go in
// numbered slots. Slack's user-ID variable can't hold a user group.
const WORKFLOW_OWNER_SLOTS = 3;

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

function causeLine(cause, bold = true) {
  const name = bold ? `*${cause.name}*` : cause.name;
  if (cause.reason === 'critical') return `Cause: ${name} has a critical finding, which caps the score.`;
  if (cause.reason === 'fell') return `Cause: ${name} fell furthest (${cause.from} → ${cause.to} of 5).`;
  return `Cause: ${name} is the weakest criterion (${cause.to} of 5).`;
}

function summary(kind, before, after) {
  const scores = before && before.score != null ? `${before.score} → ${after.score}` : `${after.score}`;
  return kind === 'dropped' ? `dropped to red (${scores}).` : `recovered from red (${scores}).`;
}

function boardLink(boardUrl, system) {
  return boardUrl ? `${boardUrl.replace(/\/+$/, '')}/system/${encodeURIComponent(system)}` : '';
}

function alertText({
  kind, system, before, after, owners = [], boardUrl, cause,
}) {
  const icon = kind === 'dropped' ? ':red_circle:' : ':large_green_circle:';
  const lines = [`${icon} *${system}* ${summary(kind, before, after)}`];
  if (kind === 'dropped' && cause) {
    lines.push(causeLine(cause));
    if (cause.action) lines.push(`Fix: ${cause.action}`);
  }
  if (owners.length) lines.push(owners.map(mention).join(' '));
  if (boardUrl) lines.push(boardLink(boardUrl, system));
  return lines.join('\n');
}

// A workflow posts its variables as plain text, so the formatting lives in the
// workflow's message and only values are sent. Unused owner slots are left out.
function workflowFields({
  kind, system, before, after, owners = [], boardUrl, cause,
}) {
  const dropCause = kind === 'dropped' ? cause : null;
  const fields = {
    icon: kind === 'dropped' ? '🔴' : '🟢',
    system,
    summary: summary(kind, before, after),
    cause: dropCause ? causeLine(dropCause, false) : '',
    fix: dropCause && dropCause.action ? `Fix: ${dropCause.action}` : '',
    link: boardLink(boardUrl, system),
  };
  owners.filter((id) => !id.startsWith('S')).slice(0, WORKFLOW_OWNER_SLOTS)
    .forEach((id, i) => { fields[`owner_${i + 1}`] = id; });
  return fields;
}

function isWorkflowHook(webhookUrl) {
  try {
    return new URL(webhookUrl).pathname.startsWith('/triggers/');
  } catch {
    return false;
  }
}

function slackPayload(webhookUrl, alert) {
  return isWorkflowHook(webhookUrl) ? workflowFields(alert) : { text: alertText(alert) };
}

async function sendSlack(webhookUrl, payload, { fetchImpl = fetch, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Slack refused the alert: HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  redTransition, redCause, mention, alertText, workflowFields, isWorkflowHook, slackPayload,
  isOwnerId, sendSlack, OWNER_ID,
};
