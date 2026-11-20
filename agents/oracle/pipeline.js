'use strict';

/*
 * Oracle's steps. Plain code orders them; models only judge inside them.
 *
 *   1 split    areas.json
 *   2 audit    raw/<area>.json        one auditor per area, in parallel
 *   3 merge    findings.json          duplicates grouped, ranked, fingerprinted
 *   4 verify   verdicts in findings   top findings re-read by a separate agent
 *   7 report   report.md, bugs.json   (steps 5-6, compare and remedy, come later)
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
const { SUBMIT_FINDINGS, SUBMIT_GROUPS, SUBMIT_VERDICTS } = require('./schemas');
const { renderReport } = require('./report');
const { treeTools } = require('../_shared/tools');
const { runAgent, mapLimit, AgentError } = require('../_shared/loop');
const { CostCapError } = require('../_shared/cost');
const { writeJson, writeText } = require('../_shared/runs');

const LEVEL = { high: 3, medium: 2, low: 1 };
const score = (f) => (LEVEL[f.likelihood] || 1) * (LEVEL[f.harm] || 1);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NO_TOOLS = { defs: [], has: () => false, run: () => ({ output: 'no tools in this step', isError: true }) };

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

async function runOracle({
  systemKey, settings, defaults, agentDir, provider, treeDir, runDir, meter, commit = null, log = () => {},
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
  // connection) that survived the SDK's own retries. Never after the spending cap
  // or an agent failure (refusal, no answer): those would fail the same way.
  const agent = async (opts) => {
    const run = () => runAgent({ provider, meter, maxTurns: settings.max_turns_per_agent, log, ...opts });
    try {
      return await run();
    } catch (err) {
      if (err instanceof CostCapError || err instanceof AgentError) throw err;
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
        const listing = batch.map((f) => ({ id: f.fingerprint, places: f.places, agreement: f.agreement, unguarded: f.unguarded }));
        const { verdicts } = await agent({
          system: prompts.verify, prompt: JSON.stringify(listing), tools, submit: SUBMIT_VERDICTS, label: `verify batch ${i + 1}`,
        });
        const byId = new Map((verdicts || []).map((v) => [v.id, v]));
        for (const f of batch) {
          const v = byId.get(f.fingerprint);
          f.verification = v ? { verdict: v.verdict, note: v.note } : { verdict: 'unsure', note: 'no verdict returned' };
        }
      } catch (err) {
        stopOn(err, `verify batch ${i + 1}`);
      }
    });
  }

  // 7 report
  const reported = merged.filter((f) => f.verification.verdict !== 'rejected');
  const rejected = merged.filter((f) => f.verification.verdict === 'rejected');
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
    cost: meter.summary(),
    problems,
  };

  writeJson(runDir, 'findings.json', { findings: reported, rejected });
  writeJson(runDir, 'bugs.json', { bugs: bugList });
  writeJson(runDir, 'run.json', run);
  writeText(runDir, 'report.md', renderReport({ run, findings: reported, rejected, bugs: bugList, areas }));
  return run;
}

module.exports = { runOracle, mergeGroups, dedupeBugs, score };
