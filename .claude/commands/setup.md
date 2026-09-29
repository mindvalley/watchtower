---
description: Set up Watchtower — configure a local or remote scan, install dependencies, and optionally bring up the dashboard.
---

Ask the user: **Are you running the scan locally (inside a clone of this repo) or setting up a remote scan that runs in GitHub Actions?**

- Answer **local** → follow the Local path below.
- Answer **remote** → follow the Remote path below.

---

## Local path

### 1 — Run the scan

Invoke the `agent-compatibility` skill. The skill handles all steps end-to-end: it verifies Node and the scanner tools, builds or confirms `watchtower.config.json`, runs the seven scans in the correct order, assembles the scores, and prints the results. Do not repeat those steps here — use the skill.

When the skill completes, the scores are in `data/benchmark.json` and printed to the console.

### 2 — Board or stop?

Ask the user: **Do you want to bring up the dashboard to explore the scores visually, or are the printed numbers enough?**

If the user wants the **mock board** first ("see a sample board before scanning your own code"), run:

Before running any Docker commands, verify Docker is available:

```sh
docker info
```

If `docker info` fails or Docker is not installed, stop cleanly here. The user can come back to the board step once Docker is available.

If Docker is available, run:

```sh
cd dashboard && npm ci
WATCHTOWER_DB_PORT=5432 docker compose -f docker-compose.example.yml up -d
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"
npm run migrate:mock && npm start   # http://localhost:3000 — data flagged as invented
```

If the user wants the **real board** (their own scan results):

Before running any Docker commands, verify Docker is available:

```sh
docker info
```

If `docker info` fails or Docker is not installed, stop cleanly here. The scores already exist in `data/benchmark.json` — the user can view them there or come back to the board step once Docker is available.

If Docker is available, run:

```sh
cd dashboard && npm ci
WATCHTOWER_DB_PORT=5432 docker compose -f docker-compose.example.yml up -d
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"
npm run migrate
npm run load -- ../data
npm start   # open http://localhost:3000
```

If the user says **stop at the numbers**, nothing more is needed. The scan output and `data/benchmark.json` are the deliverable.

---

## Remote path

### 1 — Write or confirm `watchtower.config.json`

If `watchtower.config.json` already exists in the repo root, display its contents and ask the user to confirm it is correct before continuing.

If it does not exist, build it interactively. For each system the user wants to scan, collect:

- Either `path` (a local absolute path) **or** `repo` (a GitHub repository slug such as `owner/repo`) — exactly one per system entry.
- `stack` — one of: `elixir`, `ruby`, `ts`, `js`, `python`.

Do not write any credential, token, or secret into the file. If a `repo` entry needs authentication, tell the user to set `GITHUB_TOKEN` in their Actions environment; do not put the token in the config.

Example:

```json
{
  "systems": {
    "my-service": {
      "repo": "owner/my-service",
      "stack": "ts"
    }
  }
}
```

### 2 — Emit `.github/workflows/scan.yaml`

Write the workflow file. Pin every action reference to `mindvalley/watchtower@v1`. Include one `run` step per criterion script, then the assembler. Base the file on this template and expand it for each system in the config:

```yaml
name: Watchtower scan

on:
  workflow_dispatch:
  schedule:
    - cron: "0 2 * * 1"   # every Monday at 02:00 UTC

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: mindvalley/watchtower@v1
        id: engine
        with:
          config: watchtower.config.json

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-security.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-simplicity.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-observability.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-deployment.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-documented-apis.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-test-coverage.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/scan-boundaries.js"
        env:
          SYSTEM: my-service
          WATCHTOWER_CONFIG: watchtower.config.json
          WATCHTOWER_REPORTS: reports

      - run: node "${{ steps.engine.outputs.engine-path }}/dist/assemble-scores.js"
        env:
          WATCHTOWER_DATA: data

      - uses: actions/upload-artifact@v4
        with:
          name: watchtower-data
          path: data/
```

Replace `my-service` with each system key from the config. If there are multiple systems, add a scan-step block for each.

### 3 — The `publish` gate and the 503

Artifacts are always uploaded (the `upload-artifact` step above). If you also want to post results to a hosted dashboard, add `"publish": "ingest"` to `watchtower.config.json`:

```json
{
  "publish": "ingest",
  "systems": { ... }
}
```

With `"publish": "ingest"` set, the assembler will attempt to POST to `/ingest` on your board after every scan. **This endpoint returns 503 until your board is deployed and both the allowlist and the audience are configured.** The scan and artifact upload still succeed — the 503 only means the board did not receive the data.

### 4 — Hosting and auth handoff

Setting up the hosted board and wiring ingest auth are outside the scope of this command. Refer to:

- **`README.md#configuration`** — full config reference including `publish`, allowlist, and audience fields.
- **`dashboard/README.md#run-it-split-up`** — how to run the dashboard server separately (database, migrations, ingest auth).

Do not attempt to stand up a hosted board or configure ingest auth here. Follow those docs when you are ready.
