# Match findings with the previous run's

An agent audits this repository every week for hidden agreements: places that must stay consistent with nothing to
warn a developer who changes only one of them. Each run writes its findings afresh, in different words and sometimes
naming more or fewer places, so the same agreement looks different from week to week.

You get two lists: `previous` (the open findings from earlier runs, ids `P1`, `P2`, …) and `current` (this run's, ids
`C1`, `C2`, …), each with its `agreement` and `places`. Match each current finding to the previous findings that
describe the **same** agreement — the same thing that must stay consistent, between the same places or a superset or
subset of them. Wording, line numbers and the exact list of places will differ; judge by what must stay consistent.

- Two findings that touch the same file for different reasons are different agreements. Do not match them.
- A current finding may match several previous ones if they were the same agreement reported more than once.
- Leave a finding unmatched rather than guess. A wrong match hides a new finding or a fixed one.

Call `submit_matches` once, listing only current findings that match at least one previous finding. Do not reply in
text.
