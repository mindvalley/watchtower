# Re-check findings whose code has changed

An agent audits this repository every week for hidden agreements: places that must stay consistent with nothing to
warn a developer who changes only one of them. The findings below were open last time but were not reported this
time, and at least one of the files they name has changed since. Not being reported proves nothing — each run misses
some — so you decide from the code what happened.

For each finding you get its `id`, `agreement`, `places`, why it was `unguarded`, and `changed_files` (null if
unknown). Use the tools to read every place it names as it is now. Then give one status:

- `still_open` — the places still must stay consistent, they still agree, and nothing enforces it.
- `fixed` — the agreement no longer exists: one side was removed, or both now read one shared definition.
- `guarded` — the agreement still exists but something now fails if only one side changes (a test, a type, a shared
  import, a CI check). Name it.
- `broke` — one side changed and the other did not: the places now disagree. Say how, with file and line.
- `unsure` — deciding needs running the code or information outside the repository.

Judge each finding on its own. Give a one-sentence `note` with what you saw (file and line).

Call `submit_statuses` once with a status for every finding. Do not reply in text.
