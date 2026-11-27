'use strict';

// What the fleet's agents have done, for the system page and the overview.
// Oracle first: it finds hidden agreements (places that must stay consistent
// with nothing to warn whoever changes one side) and, run to run, reports which
// earlier findings were fixed, guarded or broke.
//
// The words are chosen to claim no more than the data shows. A finding that
// closed may have closed because a team changed that code anyway, so it reads
// "fixed or guarded since Oracle found them", never "fixed by Oracle". "Broke"
// is kept apart: one side changed and the other did not, which is Oracle's
// prediction coming true. The board shows counts only; what a finding says is
// in the run folder, behind the link.
//
// Inside a function for the same reason as criteria.js: classic scripts share
// one global scope.
(function () {

const AGENT = 'oracle';
const TREND_RUNS = 12;

function oracleRunsFor(runs, systemKey) {
  return (runs || [])
    .filter((r) => r && r.agent === AGENT && r.system_key === systemKey)
    .sort((a, b) => String(a.run).localeCompare(String(b.run)));
}

function systemPanel(runs, systemKey) {
  const mine = oracleRunsFor(runs, systemKey);
  if (!mine.length) return null;
  return {
    latest: mine[mine.length - 1],
    trend: mine.slice(-TREND_RUNS).map((r) => ({ run: r.run, open: r.counts.open })),
  };
}

// Open: the latest run of each system. Changes: every run that finished within
// the last `days`, so a weekly board reads "this month".
function fleetSummary(runs, keys, { now = new Date().toISOString(), days = 28 } = {}) {
  const since = Date.parse(now) - days * 86400000;
  let systems = 0; let open = 0; let closed = 0; let broke = 0; let newFindings = 0; let securityBugs = 0;
  let latestFinished = null;
  for (const key of keys || []) {
    const mine = oracleRunsFor(runs, key);
    if (!mine.length) continue;
    systems += 1;
    const last = mine[mine.length - 1];
    open += last.counts.open;
    securityBugs += last.counts.security_bugs;
    if (!latestFinished || last.finished_at > latestFinished) latestFinished = last.finished_at;
    for (const r of mine) {
      if (Date.parse(r.finished_at) < since) continue;
      closed += r.counts.fixed + r.counts.guarded;
      broke += r.counts.broke;
      newFindings += r.counts.new;
    }
  }
  if (!systems) return null;
  return {
    systems, open, closed, broke, newFindings, securityBugs, days, latestFinished,
  };
}

const stat = (n, label, esc) => `<div style="min-width:120px">
    <div style="font-size:var(--fs-lg, 1.4rem);font-weight:700;color:var(--text)">${esc(n)}</div>
    <div style="font-size:var(--fs-xs);color:var(--text-muted);line-height:1.4">${esc(label)}</div>
  </div>`;

function sparkline(trend) {
  if (trend.length < 2) return '';
  const max = Math.max(...trend.map((t) => t.open), 1);
  const w = 120; const h = 28;
  const pts = trend.map((t, i) => `${((i / (trend.length - 1)) * w).toFixed(1)},${(h - (t.open / max) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Open hidden agreements over the last ${trend.length} runs">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}

function systemPanelHtml(panel, esc) {
  if (!panel) return '';
  const r = panel.latest;
  const c = r.counts;
  const when = String(r.finished_at).slice(0, 10);
  const changes = r.compared
    ? `<div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:14px">
        ${stat(c.new, 'new this run', esc)}
        ${stat(c.fixed + c.guarded, 'fixed or guarded since Oracle found them', esc)}
        ${stat(c.broke, 'broke as Oracle predicted', esc)}
      </div>`
    : '<div style="margin-top:14px;font-size:var(--fs-sm);color:var(--text-muted)">First run — nothing earlier to compare with yet. Changes appear from the next run.</div>';
  return `
    <div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap">
      <div><span style="font-size:2rem;font-weight:700;color:var(--text)">${esc(c.open)}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-muted)">hidden agreements open</span></div>
      ${sparkline(panel.trend)}
    </div>
    ${changes}
    <div style="margin-top:14px;font-size:var(--fs-xs);color:var(--text-muted)">
      ${esc(c.current_bugs)} current bugs (${esc(c.security_bugs)} security) · Oracle run ${esc(when)}${r.status === 'complete' ? '' : ` · ${esc(r.status)}`}
      · <a href="${esc(r.run_url)}" style="color:var(--accent)">Full report →</a>
    </div>`;
}

function fleetSummaryHtml(s, esc) {
  if (!s) return '';
  return `
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      ${stat(s.open, `hidden agreements open across ${s.systems} system${s.systems === 1 ? '' : 's'}`, esc)}
      ${stat(s.closed, `fixed or guarded since Oracle found them (last ${s.days} days)`, esc)}
      ${stat(s.broke, `broke as Oracle predicted (last ${s.days} days)`, esc)}
      ${stat(s.newFindings, `new findings (last ${s.days} days)`, esc)}
    </div>
    <div style="margin-top:10px;font-size:var(--fs-xs);color:var(--text-muted)">Latest Oracle run ${esc(String(s.latestFinished).slice(0, 10))}. Counts only — each system's page links to its full report.</div>`;
}

const api = {
  systemPanel, fleetSummary, systemPanelHtml, fleetSummaryHtml, oracleRunsFor,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.AgentImpact = api;

}());
