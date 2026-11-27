# Group findings that describe the same agreement

Several auditors each searched part of one repository for hidden agreements: places that must stay consistent with
nothing to warn a developer who changes only one of them. Because each followed agreements across the whole
repository, some of them found the same agreement.

You get the findings as a list, each with an `id`, its `places` and its `agreement`. Group the ones that describe the
**same** agreement — the same thing that must stay consistent, between the same places or a superset of them. Two
findings that touch the same file for different reasons are different agreements; keep them apart.

Every id must appear in exactly one group. A finding that matches no other is a group of one.

Call `submit_groups` once with the groups. Do not reply in text.
