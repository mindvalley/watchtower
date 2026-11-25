# Oracle — design

**Status.** Built: steps 1–5 and 7, local mode (`node agents/oracle/run.js --system <name>`). Next: the remote
workflow, then the dashboard summary, then step 6 and pull requests — see *Build order*.

## What Oracle is

> **Oracle** finds places in a codebase that will break when someone changes one side of an unwritten agreement, and
> proposes the guard that prevents it.

A hidden agreement is two or more places that must stay consistent with nothing to warn a developer who changes only
one of them — no shared definition, no type error, no failing test. A guard is the fix: a test that fails on a
one-sided change, or a single source of truth that removes the agreement.

Back-tested on two unrelated codebases by auditing an old snapshot and checking against what later broke: about 1 in 5
findings broke within 5–6 months, about half of those it rated high, and essentially none were invented. It does not
foresee breaks a future refactor creates; that belongs to change-time review.

## The fleet

```
agents/
  README.md            one table: each agent, what it looks for, what it changes
  _shared/             config, provider layer, target tree, run folders, PRs, ingest — written once
  oracle/
    agent.json         defaults: steps, limits, prompt files
    prompts/           audit.md, verify.md, remedy.md — versioned like scanner pins
    run.js             the pipeline
  cleaner/  deps/  …   later
```

Agents are defined by what they look for, not by being proactive — every fleet agent is proactive. A future agent that
predicts breaks from another signal extends Oracle; one that prevents problems another way gets its own row.

**Prompts are part of the measurement.** As with `scanner-pins.json`: change a prompt and you have changed what the agent
finds. Treat a prompt change as a measurement change and re-run before comparing.

## Configuration

One universal file, `watchtower.config.json`, gains an `agents` section. Each agent's defaults live in its
`agent.json`; the universal file overrides them.

```jsonc
{
  "publish": "ingest",
  "agents": {
    "oracle": {
      "provider": "anthropic",           // any supported provider
      "model": "claude-sonnet-5-5",      // default; user's choice, recorded in every run
      "key_env": "ANTHROPIC_API_KEY",    // anthropic provider: the variable to read — never the key itself
      "systems": ["web", "billing"],
      "pull_requests": false,            // report only unless switched on
      "max_pull_requests": 3,            // per run, one PR per finding
      "max_cost_usd": null               // off by default; Anthropic list prices when set
    }
  },
  "systems": {
    "web": { "repo": "org/web", "stack": "ts",
                   "agents": { "oracle": { "pull_requests": true } } }   // per-system override
  }
}
```

- **Keys never go in a config file.** The engine already refuses credentials in the committed config; agents follow
  the same rule. Two providers ship:
  - `anthropic` — the Anthropic API; the key comes from the variable `key_env` names (a gitignored `.env` locally).
  - `vertex` — Claude on Google Vertex AI, **keyless**: Google Application Default Credentials (gcloud locally;
    Workload Identity Federation in CI, as the fleet's other agents already run). The config names the project
    variable (`project_env`, default `ANTHROPIC_VERTEX_PROJECT_ID`) and the region (default `global`).
- **Spending cap — limitation.** `max_cost_usd` is off by default. When set it counts at Anthropic API list prices
  (`prices` in `agent.json`) whichever provider serves the requests, so on Vertex it is an estimate, not the bill.
- **Refusals.** A step the model declines fails loudly; the run is marked failed and the area not audited. The
  Anthropic provider can retry on a fallback model (`"fallbacks": true`, off by default); Vertex has no server-side
  fallback. Kept off until refusals are seen in practice.
- **Provider and model are the user's choice.** The provider layer exposes one interface (chat with tools); adding a
  provider is an adapter. Quality was measured on one model only — a cheaper model may find less or invent more, so
  `run.json` records provider and model, and a run on a new model should be checked before it is trusted (see
  *Measuring Oracle*).

## The pipeline

Plain code runs the steps; models are used only for the judgement inside each step.

| Step | Does | Writes |
|---|---|---|
| 1. Split | Divide the target into areas by size, plus one config/ops area | `areas.json` |
| 2. Audit | One auditor per area, tools: read file, search, list. Free to follow an agreement anywhere | `raw/<area>.json` |
| 3. Merge & rank | De-duplicate (one agreement found by several auditors), rank by likelihood × harm, fingerprint | `findings.json` |
| 4. Verify | A separate pass re-reads both sides of each top finding; unconfirmed findings are dropped, not reported | verdicts in `findings.json` |
| 5. Compare | Follow the previous run's open findings into this one: new, still open, fixed, guarded, broke (below) | `changes.json` |
| 6. Remedy | For the top findings (up to the PR cap): a guard as a patch, with the one-sided change it catches | `patches/<fp>.patch`, `.md` |
| 7. Report | Readable report; current bugs separate, security first | `report.md`, `bugs.json`, `run.json` |
| 8. Output | Optional PRs; optional summary to the dashboard | — |

Principles carried over from the scanner:
- **Reads, never runs.** The target is copied (local) or cloned (remote) and only read. Guards are checked by the target
  repository's own CI when the PR opens, not by Oracle.
- **Never falsely clean.** An auditor that fails fails the run; it does not become "no findings for that area".
- **Allowances.** A finding judged acceptable is allowed in `watchtower.allowances.json` with a reason, like scanner
  findings: kept in the report, marked, never re-raised as a PR.

## Step 5: following findings across runs

Two facts from the first runs shape it. Findings are rewritten from scratch each run, so neither text nor the files
named survive (fingerprints by file set matched 3 of 82–92 across two runs of one commit). And one run sees about two
thirds of what is there, so a finding missing from a run has usually not been fixed — the run did not see it.

1. **Match by meaning.** One model call pairs the previous run's open findings with this run's (`prompts/compare.md`,
   no tools). A paired finding keeps its **id**: its fingerprint in the run that first saw it, made unique against
   every id ever handed out (`changes.json` → `issued_ids`, closed ones included), never changed after. Several earlier findings paired to one current finding are duplicates: the oldest id is kept, the
   others are `merged`. One earlier finding paired to several current ones keeps its id on the first; the rest are
   `split`, with new ids.
2. **Unmatched earlier findings: look at the code before closing.** If none of its files changed since the previous
   commit, it is carried forward as still open, with no model call. If one did, a re-check reads the places now
   (`prompts/recheck.md`, tree tools) and says `still_open`, `fixed`, `guarded`, `broke` or `unsure`.
3. **Never falsely fixed.** Only a re-check closes a finding. If what changed cannot be told, every unmatched finding
   is re-checked. If matching or a re-check fails (or the spending cap stops it), the findings concerned stay open and
   the run says so.

The open backlog of a run is its findings plus `changes.json` → `carried`, so weekly runs build up coverage instead
of losing what each run missed. The previous run is the latest earlier run with a `findings.json`. Changed files are
the difference between the previous commit and the tree on disk (a local folder's uncommitted edits count), relative
to the target like the places findings name. Oracle's own shallow clone fetches the previous commit one deep; a local
folder target is only read, never fetched into.

## Runs

```
runs/oracle/<system>/<YYYY-MM-DD-HHMM>/
  report.md  findings.json  bugs.json  changes.json  run.json  areas.json  raw/  patches/
```

`run.json`: commit audited, provider, model, prompt versions, tokens, cost, duration, steps that ran, PRs raised.

## Local and remote

**Local** — `node agents/oracle/run.js --system <name>` with the same config, a folder or a repo as target, and the
key in `.env`. Writes the run folder. Publishes nothing, raises no PRs unless `pull_requests` is on and a token is
present.

**Remote** — a separate workflow in the private config repo, `oracle.yaml`, in the style of `scan.yaml`: weekly cron,
one job per system on GitHub-hosted runners, the engine action pinned to a tag, `id-token: write`, Google auth through
Workload Identity Federation for Vertex (no model key anywhere), a GitHub App token scoped to the targets (read, plus
pull requests only for systems that opted in), OIDC for the dashboard. Storage is split by kind:
- **Files → the private config repo.** The run folder is committed under `runs/`. Permanent, readable history, and the
  previous run for step 5. It holds security findings, so that repository stays private with tight access.
- **Values → the dashboard.** A small summary per run through `/ingest` (findings, new, fixed, broke, PRs raised and
  merged, cost) — the basis for agent impact numbers on the board. Each row links to its run folder.

## Pull requests

- Off by default; on per agent or per system. One PR per finding, at most `max_pull_requests` per run, highest
  ranked first. Never to the default branch directly.
- Each PR: the guard, why the agreement exists (both places), the one-sided change it catches, and the finding's
  finding's id as a label so the same finding is never raised twice. An open or closed PR for an id blocks a new
  one; a closed-unmerged PR is treated as "declined" and needs an allowance or a manual re-open to come back.
- **Security fixes on public repositories** go through a private security advisory (temporary private fork), not a
  public PR, so the vulnerability is not disclosed before the fix ships. On private repositories they are normal PRs.

## Measuring Oracle

- **Per run:** `changes.json` — which earlier findings were fixed, guarded or broke. Over time this is the agent's
  precision and impact, and it feeds the dashboard.
- **Per model:** a back-test command (later): audit a snapshot from N months ago and check findings against what broke
  since. The same method the evidence came from; lets anyone measure a cheaper model on their own history.

## Build order

1. `_shared` (config, provider layer with one adapter, target tree reuse, run folder) and Oracle steps 1–4, 7 —
   local only. Check: a run on today's code rediscovers the findings our back-tests say are still latent.
2. Step 5 (compare with previous run) and the remote workflow writing run folders to the config repo.
3. Dashboard summary via `/ingest`.
4. Step 6 + PRs, opt-in, with the public-repo security route.
5. Second provider adapter; back-test command.

## Open items

- **Team consent** before PRs are switched on for any team's repository.
- **Matching quality.** Step 5's pairing is checked against a hand-reviewed reference (two runs of one commit, 48
  pairs) before the first scheduled runs; re-check verdicts against a later commit.

Settled by the first runs (a ~3,000-file TypeScript monorepo, 2026-11-17): run-to-run variation — one run sees about two thirds of
what two runs see together, top 10 shared 8 of 10; cost — about $20 (Sonnet) / $28 (Opus) for a ~3,000-file monorepo;
fingerprints are not stable across runs, hence step 5's meaning-matching.
