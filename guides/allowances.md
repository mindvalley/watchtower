# Allowances

Some findings are not problems — the code is development-only or the finding is a false positive.

An allowance does not affect scoring, but the finding is still included in the report with its reason.

**Matched on a specific line:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "file": "config/dev.exs",
      "rule": "generic-api-key",
      "line": 12,
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

**Matched anywhere in a file:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "file": "config/dev.exs",
      "rule": "generic-api-key",
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

**Matched anywhere in the system:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "rule": "generic-api-key",
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

Each field you add narrows the allowance — `rule` alone matches it anywhere in the codebase, `rule` + `file` only in that file. Paths are repo-relative.

Allowances apply to findings that were *found*:

| Criterion | Sub | Match on |
|---|---|---|
| `security` | `secrets` | `file`, `rule`, `line` |
| `security` | `deps` | `package`, `id`, `severity`, `bucket`, `target` |
| `security` | `sast` | `id`, `path`, `severity` |
| `simplicity` | `complexity` | `file`, `scope`, `language` |

Allowances only apply to detected findings, not to absences like "no rollback configured".

Duplication cannot be allowed — the score is a percentage from the tool, not a count of individual blocks, so removing a block wouldn't move the number.

All unused allowances are reported after every run.
