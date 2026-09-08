'use strict';

// Shared three-state scorecard rendering for every system page.
// State per criterion: SCORED (number+colour) · PLANNED (Pending) · ABSENT (not listed).
// Removed criteria (C3 Standardised Data Models, C5 Atomic Operations) are simply
// not in this list, so they never render. C9 Security is scored by the engine.

// The criterion namespace now lives in /js/criteria.js, shared with the
// overview. It used to be declared here, which meant the overview could not
// reach it without a third copy of the same seven names.
const CRITERIA = (typeof require === 'function'
  ? require('../js/criteria.js')
  : window.Criteria).CRITERIA;
// The two export builders. They live in their own files because each is worth
// testing on its own, and because the report page orders the same fields from
// the same list they both read.
const FINDINGS_CSV = (typeof require === 'function'
  ? require('../js/findings-csv.js')
  : window.FindingsCsv);
const FINDINGS_PDF = (typeof require === 'function'
  ? require('../js/findings-pdf.js')
  : window.FindingsPdf);
const FINDINGS_COLUMNS = (typeof require === 'function'
  ? require('../js/findings-columns.js')
  : window.FindingsColumns);
const COLOURS = { green: '#3fb950', amber: '#d29922', red: '#f85149' };

// /system/<key> and /system/<key>/report. One template serves every system, so
// the page has to be told which one it is by the only thing that differs: the
// URL. Anything else would be a list of systems living in the markup again.
function systemKeyFromPath(pathname) {
  const parts = String(pathname ?? (typeof location !== 'undefined' ? location.pathname : ''))
    .split('/')
    .filter(Boolean);
  return parts[0] === 'system' && parts[1] ? decodeURIComponent(parts[1]) : '';
}

// "billing-api" -> "Billing Api". Only used when the operator has not
// supplied display names, which is the normal case for anyone but us.
function titleCase(key) {
  return String(key).split(/[-_]/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --- Triage audit trail -----------------------------------------
// Turn a criterion's `audit` block into a compact, inspectable chain per
// sub-metric: raw finding count → filters applied → triaged count → score.
// Pure (no DOM) so it's unit-tested; renderAuditTrail() below draws it.
// Only the C9 triage sub-metrics have a chain to explain; others are skipped.

// Format a severity band object as "1C·15H·34M·11L", omitting zeros ("0" if all).
function fmtBands(b) {
  if (!b) return '0';
  const parts = [];
  if (b.critical) parts.push(`${b.critical}C`);
  if (b.high) parts.push(`${b.high}H`);
  if (b.medium) parts.push(`${b.medium}M`);
  if (b.low) parts.push(`${b.low}L`);
  return parts.length ? parts.join('·') : '0';
}

// Band total with its breakdown appended when non-zero: "61 (1C·15H·34M·11L)".
function fmtTotal(b) {
  const total = (b && b.total) || 0;
  const bands = fmtBands(b);
  return bands === '0' ? String(total) : `${total} (${bands})`;
}

// One builder per known triage sub-metric. Each returns an ordered step list
// (raw → filters → triaged); zero-valued filter steps are dropped so clean
// systems show a short chain. Unknown sub-metrics have no builder → skipped.
const AUDIT_BUILDERS = {
  secrets: (a) => {
    const steps = [{ label: 'Raw', value: String(a.raw || 0) }];
    if (a.excluded_by_path) steps.push({ label: 'Excluded (test/fixture paths)', value: String(a.excluded_by_path) });
    steps.push({ label: 'Triaged', value: String(a.triaged || 0) });
    if (a.confirmed) steps.push({ label: 'Confirmed (hard-cap)', value: String(a.confirmed) });
    if (a.review) steps.push({ label: 'To review', value: String(a.review) });
    return steps;
  },
  deps: (a) => [
    { label: 'Raw CVEs', value: fmtTotal(a.raw) },
    { label: 'Direct prod (scored)', value: fmtTotal(a.prod) },
    { label: 'Direct dev (discounted)', value: fmtTotal(a.dev) },
    { label: 'Transitive (info)', value: fmtTotal(a.transitive) },
  ],
  sast: (a) => {
    const steps = [{ label: 'Raw', value: fmtTotal(a.raw) }];
    if (a.excluded_by_path) steps.push({ label: 'Excluded (test/fixture paths)', value: String(a.excluded_by_path) });
    if (a.remapped) steps.push({ label: 'Remapped to info', value: String(a.remapped) });
    steps.push({ label: 'Triaged', value: fmtTotal(a.triaged) });
    return steps;
  },
};

const AUDIT_LABELS = { secrets: 'Secrets', deps: 'Dependency CVEs', sast: 'SAST' };
const AUDIT_ORDER = ['secrets', 'deps', 'sast'];

function buildAuditTrail(criterion) {
  const audit = criterion && criterion.audit;
  if (!audit) return [];
  const sub = (criterion && criterion.sub) || {};
  const out = [];
  for (const key of AUDIT_ORDER) {
    if (!audit[key] || !AUDIT_BUILDERS[key]) continue;
    const s = sub[key] || {};
    out.push({
      key,
      label: AUDIT_LABELS[key],
      score: s.score != null ? s.score : null,
      colour: s.colour || null,
      steps: AUDIT_BUILDERS[key](audit[key]),
    });
  }
  return out;
}

// First n items of a findings group (pure; tested).
//
// An allowed group is skipped entirely. Those findings have been judged
// acceptable and removed from the score, so listing them under "Where →" beside
// the ones that still count would put settled work back in front of a reader as
// outstanding. They keep their place on the full report page, where the
// disposition is stated.
function topFindings(group, n) {
  if (group && group.disposition === 'allowed') return [];
  const items = (group && Array.isArray(group.items)) ? group.items : [];
  return items.slice(0, n);
}

// One-line label for an inline finding item — best-effort from common fields.
// Covers location-shaped items (file/path/clone pairs) AND rung-shaped items
// (C4 pillars, C7 capabilities, C6 discipline) so no criterion renders blank.
function fmtFindingLine(it) {
  const pair = it.fileA && it.fileB ? `${it.fileA} ↔ ${it.fileB}` : '';
  const file = it.file || it.path || '';

  // A finding without a position makes the reader search the file for it. The
  // complexity and code-scanning findings have carried `line` all along and this
  // never read it, so the list showed a path and stopped.
  //
  // `lines` is deliberately NOT treated as a position: on a duplication finding it
  // is a COUNT of duplicated lines. Rendering it as file:17 would point at a line
  // that has nothing to do with the finding, which is worse than omitting it.
  // A dependency CVE has no file — its subject is the package. Without this the
  // line rendered as a bare CVE id with nothing saying which dependency it was in,
  // which is the same "where is it" failure as a missing line number.
  const pkg = it.package ? `${it.package}${it.installed ? ` ${it.installed}` : ''}` : '';

  const loc = (file && it.line != null ? `${file}:${it.line}` : file)
    || pair || pkg || it.pillar || it.sub || it.type || it.stack || '';

  const ev = Array.isArray(it.evidence) && it.evidence.length ? it.evidence[0] : '';
  const size = it.lines != null ? `${it.lines} lines` : '';
  const extra = it.rule || it.id || (it.cc != null ? `cc ${it.cc}` : '')
    || it.rung || it.severity || it.status || size || ev || '';
  return `${loc}${extra ? ` · ${extra}` : ''}`;
}

// Escape a dynamic value before HTML interpolation. Finding locations come from
// scanned repos (incl. external/cross-org) and can contain HTML metacharacters.
function escHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function dot(colour) {
  if (!colour) return '<span class="dot dot-empty" style="width:12px;height:12px"></span>';
  return `<span class="dot" style="width:12px;height:12px;background:${COLOURS[colour]}"></span>`;
}

// A button that opens a short list of formats.
//
// `items` is `[{ label, onSelect }]`, so what the menu offers is data and this
// function is only the behaviour: open, close on Escape, close on a click
// anywhere else, close after choosing. Built rather than templated because the
// page has no build step and this is the only menu on the site.
//
// The parts that are not decoration: `aria-haspopup` and `aria-expanded` so a
// screen reader is told this is a menu and whether it is open; a real <button>
// per item so each is reachable by keyboard without inventing key handling; and
// the outside-click listener registered on open and removed on close, because
// one left on the document per page load is a leak that only shows up on a
// page nobody reloads.
function buildMenu(label, items) {
  const wrap = document.createElement('div');
  wrap.className = 'menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn menu-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = label;

  const caret = document.createElement('span');
  caret.className = 'menu-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  trigger.appendChild(caret);

  const list = document.createElement('div');
  list.className = 'menu-list';
  list.setAttribute('role', 'menu');
  list.hidden = true;

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onDocumentClick(e) {
    if (!wrap.contains(e.target)) close();
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    close();
    // Focus goes back to the thing that opened the menu, or the reader is left
    // nowhere after dismissing it.
    trigger.focus();
  }

  function open() {
    if (!list.hidden) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.addEventListener('click', () => {
      // Closed first. A format that opens a print dialog or takes a second to
      // build would otherwise leave the menu hanging open behind it.
      close();
      item.onSelect();
    });
    list.appendChild(button);
  }

  wrap.append(trigger, list);
  return wrap;
}

// Draw the audit trail (buildAuditTrail output) as one compact expandable block:
// each sub-metric on a line as `dot Label score  raw → filter → triaged`.
function renderAuditTrail(trail) {
  const rows = trail.map((t) => {
    const chain = t.steps.map((s) => (
      `<span style="white-space:nowrap"><span style="color:var(--text-muted)">${s.label}</span> `
      + `<strong style="color:var(--text);font-family:var(--font-mono)">${s.value}</strong></span>`
    )).join('<span style="color:var(--text-muted);margin:0 7px">→</span>');
    const sc = t.score != null
      ? `<span style="font-weight:600;font-family:var(--font-mono);color:${COLOURS[t.colour] || 'var(--text)'}">${Number(t.score).toFixed(1)}</span>`
      : '';
    return `
      <div style="margin:7px 0;font-size:var(--fs-micro);line-height:1.75">
        <span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px">${dot(t.colour)}<strong style="color:var(--text)">${t.label}</strong> ${sc}</span>
        ${chain}
      </div>`;
  }).join('');
  return `
    <details class="audit-trail" style="margin-top:8px">
      <summary style="cursor:pointer;font-size:var(--fs-micro);color:var(--accent);user-select:none">How this was triaged →</summary>
      <div style="margin-top:7px;padding:9px 11px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:var(--radius-sm)">${rows}</div>
    </details>`;
}

async function initScorecard(systemKey) {
  // The board plus one system's findings is the heaviest load on the site — the
  // largest committed findings file is 1.2 MB against a 296 KB board — and the
  // criteria table is empty until both land. A missing findings file stays
  // tolerated (some systems have none); a missing board stops the page.
  const body = document.getElementById('criteria-body');
  let data;
  let findings = null;
  try {
    [data, findings] = await Loading.withLoading(
      body,
      'Loading scorecard…',
      () => Promise.all([
        Loading.getJson('/data/benchmark.json'),
        fetch(`/data/findings-${systemKey}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]),
      { colspan: 4 },
    );
  } catch (e) {
    console.error('Failed to load scorecard:', e);
    return;
  }
  const sys = (data.systems || {})[systemKey] || {};
  const crit = sys.criteria || {};

  // Header badge: composite + hard-cap note.
  const badge = document.getElementById('score-badge');
  if (sys.score != null) {
    const c = sys.colour;
    // Out of 100. This said "/ 5" until 2026-09-03 — the overview card was
    // rebuilt for the hundred-point rule and the system page was not, so every
    // scorecard has been reading "85.0 / 5" since the rule changed.
    badge.textContent = `${Math.round(sys.score)} / 100`;
    badge.style.background = `${COLOURS[c]}22`;
    badge.style.color = COLOURS[c];
    badge.style.border = `1px solid ${COLOURS[c]}44`;
    badge.title = sys.hard_capped ? 'Security hard-cap: a Critical finding forces Red' : '';
  } else {
    badge.textContent = 'Not yet scored';
  }

  // Two controls, or neither. A system with no findings file has nothing to open
  // and nothing to download, and a button that hands back an empty file is worse
  // than an absent one. This is the same condition the single link used before.
  //
  // Neither needs a fetch or a route: the page already loaded the whole findings
  // file above, which is the same file the report page draws from.
  const actions = document.getElementById('report-actions');
  if (actions && findings && findings.criteria) {
    const view = document.createElement('a');
    view.className = 'btn';
    view.href = `/system/${encodeURIComponent(systemKey)}/report`;
    view.textContent = 'View report';

    // Criterion order comes from the namespace the page is already rendering,
    // so neither download can disagree with the table above it.
    const order = CRITERIA.map((c) => c.key);
    const meta = { system: systemKey, generatedAt: findings.generated_at };

    // A format that fails should say so where the reader is looking. The PDF
    // fetches two libraries the first time it is used, and a dead network there
    // is the likeliest failure on this page — silently doing nothing would read
    // exactly like the broken print dialog this replaced.
    const failed = (label, err) => {
      console.error(`${label} export failed:`, err);
      const banner = document.getElementById('page-banner');
      if (!banner) return;
      banner.style.display = 'flex';
      banner.classList.add('is-danger');
      document.getElementById('page-banner-text').textContent = `The ${label} download could not be produced. Check your connection and try again.`;
    };

    const download = buildMenu('Download report', [
      {
        label: 'CSV',
        onSelect: () => {
          try {
            FINDINGS_CSV.download(
              document,
              FINDINGS_CSV.toCsv(findings, order),
              FINDINGS_COLUMNS.fileName(systemKey, findings.generated_at, 'csv'),
            );
          } catch (err) { failed('CSV', err); }
        },
      },
      {
        // A real file rather than the browser's print dialog. Save as PDF was
        // built first and was the cheaper answer by far — no dependency, and
        // the PDF would have been the report itself — but its Save did nothing,
        // both from a tab opened here and from the print shortcut pressed on
        // the report page with no script involved. The document was fine;
        // rendering the same page headlessly produced a valid PDF. That leaves
        // the interactive print path, which this code cannot reach or repair.
        //
        // The print stylesheet stays: it is what makes that path good for
        // anyone whose browser does print.
        label: 'PDF',
        onSelect: () => FINDINGS_PDF
          .download(window, document, findings, order, meta)
          .catch((err) => failed('PDF', err)),
      },
    ]);

    actions.append(view, download);
  }

  // Name the page. Eleven HTML files used to carry this as literal text —
  // title, heading, sub-heading and footer — which is why adding a system meant
  // writing a page. Display names are optional: without them the key is
  // title-cased, which is what a stranger's fleet gets.
  const names = await fetch('/data/display-names.json')
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const label = (names && names.systems && names.systems[systemKey]) || titleCase(systemKey);
  const orgLabel = sys.org ? ((names && names.orgs && names.orgs[sys.org]) || sys.org) : '';
  const sub = [orgLabel, sys.stack].filter(Boolean).join(' · ');

  document.title = `${label} — Agentic Compatibility`;
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = label;
  const subEl = document.getElementById('header-sub');
  if (subEl) subEl.textContent = sub || '\u00a0';
  const footerName = document.getElementById('footer-name');
  if (footerName) footerName.textContent = `${label} · Agentic Compatibility Benchmark`;

  // Coverage label in the footer (e.g. "1 of 9 assessed").
  const footer = document.getElementById('footer-date');
  if (footer) footer.textContent = sys.coverage ? `${sys.coverage} · ${sys.assessed_at || ''}`.trim() : 'Not yet assessed';

  // Hard-cap banner. The element used to be called `example-banner` and to
  // carry an "example data" warning in its markup; that warning could not
  // render, because this branch overwrites the text and the else hides the
  // element. Nothing on a system page reads `example` at all.
  const banner = document.getElementById('page-banner');
  if (banner) {
    if (sys.hard_capped) {
      banner.style.display = 'flex';
      banner.classList.add('is-danger');
      document.getElementById('page-banner-text').innerHTML =
        '<strong>Security hard-cap</strong> — a Critical security finding forces the overall badge to Red regardless of the composite score.';
    } else {
      banner.style.display = 'none';
    }
  }

  // Criteria table: scored vs Pending. The # column is a contiguous display
  // position (removed criteria are not in CRITERIA), not the internal key.
  document.getElementById('criteria-body').innerHTML = CRITERIA.map(({ key, label, slug }, i) => {
    const c = crit[key] || {};
    const scored = c.score != null;
    const scoreHtml = scored
      ? `<div style="display:flex;align-items:center;gap:6px;justify-content:center">${dot(c.colour)}<span style="font-weight:600;color:${COLOURS[c.colour]}">${c.score.toFixed(1)}</span></div>`
      : '<div class="na-text" style="text-align:center">Pending</div>';
    const findingsHtml = (c.findings || []).length
      ? c.findings.map((f) => `<div class="criterion-findings">· ${f}</div>`).join('')
      : '<span class="na-text">pending — not yet assessed</span>';
    const trail = buildAuditTrail(c);
    const trailHtml = trail.length ? renderAuditTrail(trail) : '';
    const fcrit = (findings && findings.criteria && findings.criteria[key]) || null;
    const N = 5;
    let findingsExpander = '';
    // Same rule as topFindings, or a criterion whose only findings were allowed
    // would open a "Where →" onto an empty box.
    if (fcrit && (fcrit.groups || []).some((g) => topFindings(g, N).length)) {
      const lines = fcrit.groups.flatMap((g) => topFindings(g, N).map((it) => `<div style="font-size:var(--fs-micro);font-family:var(--font-mono);color:var(--text-muted)">· ${escHtml(fmtFindingLine(it))}</div>`)).slice(0, N).join('');
      findingsExpander = `
        <details style="margin-top:6px">
          <summary style="cursor:pointer;font-size:var(--fs-micro);color:var(--accent);user-select:none">Where →</summary>
          <div style="margin-top:6px;padding:8px 10px;background:var(--surface-2);border:1px solid var(--border-soft);border-radius:var(--radius-sm)">
            ${lines}
            <div style="margin-top:6px"><a href="/system/${systemKey}/report#c${key}" style="font-size:var(--fs-micro);color:var(--accent)">Full report →</a></div>
          </div>
        </details>`;
    }
    return `
      <tr>
        <td style="color:var(--text-muted);font-weight:600">${i + 1}</td>
        <td><div class="criterion-name"><a href="/criteria/${slug}" style="color:var(--text)">${label}</a>${scored ? ' <span style="font-size:var(--fs-micro);font-weight:700;color:#3fb950;background:#3fb95022;border:1px solid #3fb95044;border-radius:3px;padding:1px 5px;vertical-align:middle;letter-spacing:.04em">REAL</span>' : ''}</div></td>
        <td>${scoreHtml}</td>
        <td>${findingsHtml}${trailHtml}${findingsExpander}</td>
      </tr>`;
  }).join('');

  // Remediation actions for any scored criterion that has them.
  const withActions = CRITERIA.filter(({ key }) => ((crit[key] || {}).actions || []).length > 0);
  const section = document.getElementById('remediation-section');
  if (withActions.length && section) {
    section.style.display = '';
    document.getElementById('remediation-panel').innerHTML = withActions.map(({ key, label }) => {
      const c = crit[key];
      const pos = CRITERIA.findIndex((x) => x.key === key) + 1;
      const colour = c.colour ? COLOURS[c.colour] : 'var(--text-muted)';
      return `
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:var(--fs-micro);font-weight:700;color:${colour};background:${colour}22;border:1px solid ${colour}44;border-radius:4px;padding:2px 7px;text-transform:uppercase;letter-spacing:.04em">${c.colour || '?'}</span>
            <span style="font-size:var(--fs-sm);font-weight:600;color:var(--text)">${pos} — ${label}</span>
          </div>
          ${c.actions.map((a, i) => `
            <div style="display:flex;gap:12px;margin-bottom:8px;font-size:var(--fs-sm);padding-left:4px">
              <span style="color:var(--accent);font-weight:600;min-width:20px;flex-shrink:0">${i + 1}.</span>
              <span style="color:var(--text);line-height:1.5">${a}</span>
            </div>`).join('')}
        </div>`;
    }).join('');
  }
}

// Node (tests) can import the pure helpers; the browser loads this as a plain
// <script> and just calls initScorecard(). Guarded so it's a no-op in-browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildAuditTrail, fmtBands, fmtTotal, renderAuditTrail, initScorecard, topFindings, escHtml, fmtFindingLine,
    systemKeyFromPath, titleCase, buildMenu,
  };
}
