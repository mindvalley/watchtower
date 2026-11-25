'use strict';

/*
 * Oracle's steps. Plain code orders them; models only judge inside them.
 *
 *   1 split    areas.json
 *   2 audit    raw/<area>.json        one auditor per area, in parallel
 *   3 merge    findings.json          duplicates grouped, ranked, fingerprinted
 *   4 verify   verdicts in findings   top findings re-read by a separate agent
 *   5 compare  changes.json           ids carried from the previous run; what changed
 *   7 report   report.md, bugs.json   (step 6, remedy, comes later)
 *
 * Each step writes what it produced before the next starts, so a run that stops
 * — cost cap, a failed agent — leaves everything done so far on disk, and the
 * report says exactly what is missing. A run never reads as cleaner than it was:
 * an area whose auditor failed is listed as not audited, never as "no findings".
 */

const fs = require('node:fs');
const path = require('node:path');
const { collectFiles, splitAreas, CONFIG_AREA } = require('./areas');
const { fingerprint } = require('./fingerprint');
const {
  SUBMIT_FINDINGS, SUBMIT_GROUPS, SUBMIT_VERDICTS, SUBMIT_MATCHES, SUBMIT_STATUSES,
} = require('./schemas');
const { applyMatches, splitUnmatched } = require('./compare');
const { renderReport } = require('./report');
const { treeTools } = require('../_shared/tools');
const { runAgent, mapLimit, AgentError } = require('../_shared/loop');
const { CostCapError } = require('../_shared/cost');
const { writeJson, writeText } = require('../_shared/runs');

const LEVEL = { high: 3, medium: 2, low: 1 };
const score = (f) => (LEVEL[f.likelihood] || 1) * (LEVEL[f.harm] || 1);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NO_TOOLS = { defs: [], has: () => false, run: () => ({ output: 'no tools in this step', isError: true }) };

// A 4xx the provider will give again on a second attempt. 408 (timeout), 409
// (conflict) and 429 (rate limit) are transient, so they may be retried.
const TRANSIENT_4XX = new Set([408, 409, 429]);
const rejectedRequest = (err) => Number.isInteger(err && err.status)
  && err.status >= 400 && err.status < 500 && !TRANSIENT_4XX.has(err.status);

function loadPrompts(agentDir, defaults) {
  const out = {};
  for (const [k, rel] of Object.entries(defaults.prompts)) out[k] = fs.readFileSync(path.join(agentDir, rel), 'utf8');
  return out;
}

function auditMessage(area) {
  return `Your starting area: ${area.name}\nPaths: ${area.paths.join(', ')}\n`
    + `(${area.files} files, ${area.source} of them source.) Follow agreements anywhere in the repository.`;
}

// Turns the merge agent's groups into merged findings. Defensive: every finding
// ends in exactly one group whatever the agent returned.
function mergeGroups(findings, groups) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const seen = new Set();
  const clean = [];
  for (const g of groups || []) {
    const ids = (Array.isArray(g) ? g : []).filter((id) => byId.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) clean.push(ids);
  }
  for (const f of findings) if (!seen.has(f.id)) clean.push([f.id]);

  return clean.map((ids) => {
    const members = ids.map((id) => byId.get(id))
      .sort((a, b) => score(b) - score(a) || b.places.length - a.places.length);
    const rep = members[0];
    const places = [...new Set(members.flatMap((m) => m.places))];
    const best = (field) => members.map((m) => m[field]).sort((a, b) => (LEVEL[b] || 0) - (LEVEL[a] || 0))[0];
    return {
      fingerprint: fingerprint(places),
      agreement: rep.agreement,
      places,
      unguarded: rep.unguarded,
      trigger: rep.trigger,
      effect: rep.effect,
      fix: rep.fix,
      likelihood: best('likelihood'),
      harm: best('harm'),
      found_by: ids,
      verification: { verdict: 'unverified', note: '' },
    };
  }).sort((a, b) => score(b) - score(a) || b.found_by.length - a.found_by.length);
}

function dedupeBugs(bugs) {
  const byFp = new Map();
  for (const b of bugs) {
    const fp = fingerprint(b.places);
    const prev = byFp.get(fp);
    if (!prev) byFp.set(fp, { fingerprint: fp, ...b, security: !!b.security, found_by: [b.id] });
    else { prev.found_by.push(b.id); prev.security = prev.security || !!b.security; }
  }
  return [...byFp.values()].sort((a, b) => Number(b.security) - Number(a.security));
}

const CLOSED = ['fixed', 'guarded', 'broke'];

function changeCounts(current, earlier, carried) {
  const n = (list, key, value) => list.filter((x) => x[key] === value).length;
  return {
    new: n(current, 'change', 'new') + n(current, 'change', 'split'),
    still_open: n(earlier, 'status', 'still_open'),
    merged: n(earlier, 'status', 'merged'),
    fixed: n(earlier, 'status', 'fixed'),
    guarded: n(earlier, 'status', 'guarded'),
    broke: n(earlier, 'status', 'broke'),
    open: current.length + carried.length,
  };
}

const summary = (f) => ({ id: f.id, agreement: f.agreement, places: f.places });

/*
 * Step 5. Never closes a finding without a re-check saying so: if matching or a
 * re-check cannot be done, the earlier findings concerned stay open.
 */
async function compareWithPrevious({
  previous, current, runStamp, commit, changedSince, agent, prompts, tools, settings, capped, stopOn, log,
}) {
  const base = { previous: previous ? { run: previous.run, commit: previous.commit } : null, commit };
  const open = previous ? previous.open : [];
  let matches = [];
  let compared = true;

  if (open.length && current.length) {
    if (capped()) compared = false;
    else {
      try {
        const listing = {
          previous: open.map((f, i) => ({ id: `P${i + 1}`, agreement: f.agreement, places: f.places })),
          current: current.map((f, i) => ({ id: `C${i + 1}`, agreement: f.agreement, places: f.places })),
        };
        ({ matches } = await agent({
          system: prompts.compare, prompt: JSON.stringify(listing), tools: NO_TOOLS, submit: SUBMIT_MATCHES, label: 'compare',
        }));
      } catch (err) {
        compared = false;
        stopOn(err, 'compare');
      }
    }
  }

  const { outcomes, unmatched } = applyMatches({
    previousOpen: open, current, matches: compared ? matches : [], run: runStamp, commit,
  });
  const earlier = [...outcomes];
  const carried = [];
  const keepOpen = (f, note) => {
    carried.push(f);
    earlier.push({ id: f.id, status: 'still_open', refound: false, note });
  };

  if (!compared) {
    unmatched.forEach((f) => keepOpen(f, 'not compared this run'));
    const counts = changeCounts(current, earlier, carried);
    return { ...base, compared, current: current.map((f) => ({ id: f.id, change: f.change })), earlier, carried, counts };
  }

  const split = splitUnmatched(unmatched, previous ? changedSince(previous.commit) : null);
  split.carried.forEach((f) => keepOpen(f, 'not found this run; none of its files changed'));

  const batches = [];
  for (let i = 0; i < split.recheck.length; i += settings.verify_batch) batches.push(split.recheck.slice(i, i + settings.verify_batch));
  await mapLimit(batches, settings.concurrency, async (batch, i) => {
    let byId = new Map();
    if (!capped()) {
      try {
        const listing = batch.map((f, j) => ({
          id: `${j + 1}`, agreement: f.agreement, places: f.places, unguarded: f.unguarded, changed_files: f.changed_files,
        }));
        const { statuses } = await agent({
          system: prompts.recheck, prompt: JSON.stringify(listing), tools, submit: SUBMIT_STATUSES, label: `recheck batch ${i + 1}`,
        });
        byId = new Map((statuses || []).map((s) => [String(s.id), s]));
      } catch (err) {
        stopOn(err, `recheck batch ${i + 1}`);
      }
    }
    for (const [j, f] of batch.entries()) {
      const { changed_files: changedFiles, ...finding } = f;
      const s = byId.get(`${j + 1}`);
      if (s && CLOSED.includes(s.status)) {
        earlier.push({ id: f.id, agreement: f.agreement, status: s.status, refound: false, note: s.note, changed_files: changedFiles });
      } else {
        keepOpen(finding, s ? `re-checked (${s.status}): ${s.note}` : 'files changed; not re-checked');
      }
    }
  });
  log(`compare: ${outcomes.length} found again, ${carried.length} carried, ${earlier.length - outcomes.length - carried.length} closed`);

  const counts = changeCounts(current, earlier, carried);
  return {
    ...base,
    compared,
    current: current.map((f) => ({ id: f.id, change: f.change, ...(f.split_from ? { split_from: f.split_from } : {}) })),
    earlier,
    carried,
    counts,
  };
}

async function runOracle({
  systemKey, settings, defaults, agentDir, provider, treeDir, runDir, meter, commit = null, log = () => {},
  previous = null, changedSince = () => null,
}) {
  const startedAt = new Date();
  const prompts = loadPrompts(agentDir, defaults);
  const tools = treeTools(treeDir);
  const problems = [];
  let status = 'complete';
  // Whether the spending cap has been reached, kept apart from the status: a run
  // that has already failed stays failed when the cap then stops it, and a
  // failure after the cap still marks it failed. Failed outranks incomplete.
  let capped = false;
  const stopOn = (err, step) => {
    problems.push(`${step}: ${err.message}`);
    if (err instanceof CostCapError) {
      capped = true;
      if (status === 'complete') status = 'incomplete';
      return true;
    }
    status = 'failed';
    return false;
  };
  // One more attempt after a provider failure (a 5xx, "try again", a dropped
  // connection) that survived the SDK's own retries. Never after the spending cap,
  // an agent failure (refusal, no answer), or a request the provider rejected as
  // invalid (a 4xx such as "prompt is too long"): those would fail the same way.
  const agent = async (opts) => {
    const run = () => runAgent({ provider, meter, maxTurns: settings.max_turns_per_agent, log, ...opts });
    try {
      return await run();
    } catch (err) {
      if (err instanceof CostCapError || err instanceof AgentError || rejectedRequest(err)) throw err;
      log(`${opts.label}: provider error, retrying once (${String(err.message).slice(0, 120)})`);
      return run();
    }
  };

  // 1 split
  // Config and operations first, then the largest areas: if the spending cap
  // stops the run, it stops before the least productive areas, not the most.
  const areas = splitAreas(collectFiles(treeDir), { maxAreas: settings.max_areas })
    .sort((a, b) => Number(b.name === CONFIG_AREA) - Number(a.name === CONFIG_AREA) || b.source - a.source);
  writeJson(runDir, 'areas.json', areas);
  log(`split into ${areas.length} areas`);

  // 2 audit — one failed area does not stop the others, but it is recorded.
  const audited = [];
  const notAudited = [];
  await mapLimit(areas, settings.concurrency, async (area) => {
    if (capped) { notAudited.push(area.name); return; }
    try {
      const out = await agent({
        system: prompts.audit, prompt: auditMessage(area), tools, submit: SUBMIT_FINDINGS, label: `audit ${area.name}`,
      });
      writeJson(runDir, `raw/${slug(area.name)}.json`, { area: area.name, ...out });
      audited.push({ area, out });
    } catch (err) {
      notAudited.push(area.name);
      stopOn(err, `audit ${area.name}`);
    }
  });

  const findings = [];
  const bugs = [];
  for (const { area, out } of audited) {
    (out.findings || []).forEach((f, i) => findings.push({ id: `${slug(area.name)}#${i + 1}`, ...f, places: f.places || [] }));
    (out.current_bugs || []).forEach((b, i) => bugs.push({ id: `${slug(area.name)}!${i + 1}`, ...b, places: b.places || [] }));
  }

  // 3 merge
  let merged = mergeGroups(findings, findings.map((f) => [f.id]));
  if (findings.length > 1 && !capped) {
    try {
      const listing = findings.map(({ id, places, agreement }) => ({ id, places, agreement }));
      const { groups } = await agent({
        system: prompts.merge, prompt: JSON.stringify(listing), tools: NO_TOOLS, submit: SUBMIT_GROUPS, label: 'merge',
      });
      merged = mergeGroups(findings, groups);
    } catch (err) {
      if (!stopOn(err, 'merge')) problems.push('merge: findings reported without de-duplication');
    }
  }

  // 4 verify — top findings, in batches.
  const toVerify = merged.slice(0, settings.verify_top);
  const batches = [];
  for (let i = 0; i < toVerify.length; i += settings.verify_batch) batches.push(toVerify.slice(i, i + settings.verify_batch));
  if (!capped) {
    await mapLimit(batches, settings.concurrency, async (batch, i) => {
      if (capped) return;
      try {
        // Ids by position, not fingerprint: two agreements between the same files
        // share a fingerprint, and each needs its own verdict.
        const idOf = (j) => `${i * settings.verify_batch + j + 1}`;
        const listing = batch.map((f, j) => ({ id: idOf(j), places: f.places, agreement: f.agreement, unguarded: f.unguarded }));
        const { verdicts } = await agent({
          system: prompts.verify, prompt: JSON.stringify(listing), tools, submit: SUBMIT_VERDICTS, label: `verify batch ${i + 1}`,
        });
        const byId = new Map((verdicts || []).map((v) => [String(v.id), v]));
        for (const [j, f] of batch.entries()) {
          const v = byId.get(idOf(j));
          f.verification = v ? { verdict: v.verdict, note: v.note } : { verdict: 'unsure', note: 'no verdict returned' };
        }
      } catch (err) {
        stopOn(err, `verify batch ${i + 1}`);
      }
    });
  }

  const reported = merged.filter((f) => f.verification.verdict !== 'rejected');
  const rejected = merged.filter((f) => f.verification.verdict === 'rejected');

  // 5 compare — follow the previous run's open findings into this one.
  const changes = await compareWithPrevious({
    previous, current: reported, runStamp: path.basename(runDir), commit, changedSince, agent, prompts, tools, settings,
    capped: () => capped, stopOn, log,
  });
  writeJson(runDir, 'changes.json', changes);

  // 7 report
  const bugList = dedupeBugs(bugs);
  const run = {
    agent: 'oracle',
    system: systemKey,
    status,
    commit,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    provider: settings.provider,
    model: settings.model,
    prompt_version: defaults.prompt_version,
    areas: areas.map((a) => a.name),
    not_audited: notAudited,
    counts: {
      raw_findings: findings.length,
      findings: reported.length,
      confirmed: reported.filter((f) => f.verification.verdict === 'confirmed').length,
      rejected: rejected.length,
      current_bugs: bugList.length,
      security_bugs: bugList.filter((b) => b.security).length,
    },
    changes: changes.counts,
    cost: meter.summary(),
    problems,
  };

  writeJson(runDir, 'findings.json', { findings: reported, rejected });
  writeJson(runDir, 'bugs.json', { bugs: bugList });
  writeJson(runDir, 'run.json', run);
  writeText(runDir, 'report.md', renderReport({ run, findings: reported, rejected, bugs: bugList, areas, changes }));
  return run;
}

module.exports = { runOracle, mergeGroups, dedupeBugs, score };
