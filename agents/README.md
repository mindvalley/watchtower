# Agents

The scanners measure. Agents act: each one looks for one kind of problem in a codebase and proposes the change that
fixes it. They read code the same way the scanners do — a copy or a shallow clone, never run — and they write run
folders, not scores.

| Agent | Looks for | Changes |
|---|---|---|
| [**Oracle**](oracle/) | places that will break when someone changes one side of an unwritten agreement | proposes a guard: a test that fails on a one-sided change, or a single source of truth |

Agents are defined by what they look for, not by being proactive — every agent here is. A new agent that predicts
breaks from another signal extends Oracle; one that prevents problems another way gets its own row.

## Running one

Agents read the same `watchtower.config.json` as the scanners. Add an `agents` section:

```jsonc
{
  "agents": {
    "oracle": {
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "key_env": "ANTHROPIC_API_KEY",      // the variable to read — never the key itself
      "systems": ["web"]
    }
  },
  "systems": {
    "web": { "path": "code/web", "stack": "ts" }
  }
}
```

With `"provider": "anthropic"`, put the key in a gitignored `.env` beside the config (or export it). With
`"provider": "vertex"` there is no key: set `ANTHROPIC_VERTEX_PROJECT_ID` and log in to Google
(`gcloud auth application-default login` locally; Workload Identity Federation in CI). Then:

```sh
node agents/oracle/run.js --system web
```

The run lands in `runs/oracle/web/<YYYY-MM-DD-HHMM>/` (`WATCHTOWER_RUNS` to move it).

- **Any provider, any model.** The provider and model are your choice; agents talk to an interface in
  `_shared/providers/`, and each provider is an adapter. Quality was measured on one model; a cheaper one may find less
  or invent more, and every run records which model made it.
- **Credentials never in the config.** As with the scanners, a key in a committed file stops the run.
- **Spending cap** (`max_cost_usd`) is off by default. When set it counts at Anthropic API list prices whatever the
  provider, so on Vertex it is an estimate, not your bill.
- **Refusals fail loudly.** If the model declines a step, that step fails and the run says so; nothing is reported as
  clean. An automatic retry on a fallback model exists for the Anthropic provider (`"fallbacks": true`), off by default.
- **Settings, later ones winning:** the agent's `agent.json` → `agents.<name>` in the config → `systems.<s>.agents.<name>`.

## Layout

```
agents/
  README.md        this table
  _shared/         config, provider layer, read-only tree tools, agent loop, spending cap, run folders
  oracle/          agent.json, prompts/, run.js, the pipeline, DESIGN.md
```

**Prompts are part of the measurement.** As with `scanner-pins.json`: change a prompt and you have changed what the agent
finds. Bump `prompt_version` in `agent.json`, and re-run before comparing runs across the change.
