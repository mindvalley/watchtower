'use strict';

/*
 * report.md — the run, for a person. Rendered from the JSON by code, not written
 * by a model, so it can never say something the data does not.
 */

const STATUS_LINE = {
  complete: 'Complete.',
  incomplete: 'Incomplete — stopped at the spending cap. Everything below is what was done before it stopped.',
  failed: 'Failed in part — see "Run problems". Areas not audited are listed; they are not clean.',
};

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

function findingBlock(f, n) {
  const v = f.verification;
  return [
    `### ${n}. ${f.agreement}`,
    '',
    `**Likelihood** ${f.likelihood} · **Harm** ${f.harm} · **Verified** ${v.verdict}${v.note ? ` — ${v.note}` : ''} · \`${f.id || f.fingerprint}\``
      + `${f.change === 'new' || f.change === 'split' ? ' · **new**' : f.first_seen ? ` · open since ${f.first_seen.run}` : ''}`,
    '',
    '**Places**',
    ...f.places.map((p) => `- \`${p}\``),
    '',
    `**Why nothing catches it.** ${f.unguarded}`,
    '',
    `**What would break it.** ${f.trigger}`,
    '',
    `**What goes wrong.** ${f.effect}`,
    '',
    `**Fix.** ${f.fix}`,
    '',
  ].join('\n');
}

// Closed findings, worst news first: an agreement that broke is a bug now.
const CLOSED_HEADINGS = [
  ['broke', 'Broke', 'One side changed and the other did not — this is a bug now.'],
  ['fixed', 'Fixed', 'The agreement no longer exists.'],
  ['guarded', 'Guarded', 'Something now fails if only one side changes.'],
];

function changesSection(changes) {
  if (!changes) return [];
  const lines = ['## Since the previous run', ''];
  if (!changes.previous) return [...lines, 'First run — nothing to compare with. Every finding is new.', ''];
  const c = changes.counts;
  lines.push(`Compared with \`${changes.previous.run}\` (commit \`${changes.previous.commit || 'unknown'}\`).`, '');
  if (!changes.compared) {
    lines.push('**Not compared** — see "Run problems". Every earlier finding is kept open; none is marked fixed.', '');
  }
  lines.push(`**${c.new} new**, **${c.still_open} still open** (${changes.carried.length} of them not found this run but `
    + `carried forward), **${c.broke} broke**, **${c.fixed} fixed**, **${c.guarded} guarded**`
    + `${c.merged ? `, ${c.merged} merged as duplicates` : ''}. **${c.open} open in total.**`, '');
  for (const [status, heading, meaning] of CLOSED_HEADINGS) {
    const closed = changes.earlier.filter((e) => e.status === status);
    if (!closed.length) continue;
    lines.push(`### ${heading}`, '', meaning, '');
    for (const e of closed) lines.push(`- ${e.agreement} — ${e.note} \`${e.id}\``);
    lines.push('');
  }
  if (changes.carried.length) {
    lines.push('### Carried forward', '', 'Open last time and not reported this time. Each run misses some, so these stay open '
      + 'until a re-check of changed code closes them.', '');
    for (const f of changes.carried) lines.push(`- ${f.agreement} \`${f.id}\``);
    lines.push('');
  }
  return lines;
}

function renderReport({ run, findings, rejected, bugs, areas, changes = null }) {
  const c = run.counts;
  const lines = [
    `# Oracle — ${run.system}`,
    '',
    `${STATUS_LINE[run.status] || run.status}`,
    '',
    `Commit \`${run.commit || 'unknown'}\` · ${run.provider} / ${run.model} · prompts ${run.prompt_version} · `
      + `~$${run.cost.usd.toFixed(2)} at Anthropic list prices over ${run.cost.calls} calls · ${run.started_at.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `**${c.findings} hidden agreements** (${c.confirmed} confirmed on a second reading, ${c.rejected} rejected and left out), `
      + `**${c.current_bugs} current bugs** (${c.security_bugs} security).`,
    '',
  ];

  if (findings.length) {
    lines.push('## Hidden agreements', '', '| # | Agreement | Likelihood | Harm | Verified |', '|---|---|---|---|---|');
    findings.forEach((f, i) => lines.push(`| ${i + 1} | ${esc(f.agreement).slice(0, 140)} | ${f.likelihood} | ${f.harm} | ${f.verification.verdict} |`));
    lines.push('', ...findings.map((f, i) => findingBlock(f, i + 1)));
  } else {
    lines.push('## Hidden agreements', '', run.status === 'complete' ? 'None found.' : 'None reported before the run stopped.', '');
  }

  lines.push(...changesSection(changes));

  lines.push('## Current bugs', '');
  if (bugs.length) {
    lines.push('Wrong today, regardless of future changes. Security first.', '');
    for (const b of bugs) {
      lines.push(`- ${b.security ? '**Security.** ' : ''}${b.what} — ${b.places.map((p) => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
  } else lines.push('None reported.', '');

  if (rejected.length) {
    lines.push('## Rejected on verification', '', 'Reported by an auditor, not confirmed by a second reading. Left out above.', '');
    for (const f of rejected) lines.push(`- ${f.agreement} — ${f.verification.note}`);
    lines.push('');
  }

  lines.push('## How this run was made', '');
  lines.push(`Areas (one auditor each, free to follow agreements anywhere): ${areas.map((a) => a.name).join('; ')}.`);
  if (run.not_audited.length) lines.push('', `**Not audited:** ${run.not_audited.join('; ')}.`);
  if (run.problems.length) lines.push('', '### Run problems', '', ...run.problems.map((p) => `- ${p}`));
  lines.push('');
  return lines.join('\n');
}

module.exports = { renderReport };
