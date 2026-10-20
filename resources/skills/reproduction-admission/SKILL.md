---
name: reproduction-admission
description: Decide whether a paper can be reproduced with available official code, parameters, data, and independent evidence. Use before proposing any target experiment, and when the user supplies a paper, repository, or model name for reproduction.
license: MIT
compatibility: Requires access to the official repository and dataset documentation.
metadata: {"version":"1.0.0","requires":[],"source":"ScholarFlow built-in"}
---

# Reproduction admission

A target experiment may be proposed only when all of the following are recorded with evidence:

1. **Paper identity** — title, DOI or canonical URL, and why the match is unambiguous.
2. **Official repository** — ownership evidence (author affiliation, paper link, or organization),
   URL, and a pinned commit.
3. **Official script and parameters** — exact training/evaluation entry point, configuration file,
   and the parameter values that produce the target result. Do not guess missing parameters.
4. **Data** — availability, license, acquisition method, split, and preprocessing.
5. **Independent reproductions** — at least two other groups that actually ran the method and
   reported a located result. Citations or copies of the original paper's numbers do not count.
6. **Target and tolerance** — the exact table/figure position in the paper, the metric, and an
   acceptable deviation with a stated basis.

Call `assess_admission` with structured evidence. The result is `sufficient`, `insufficient`, or
`unverified`. You may propose a `smoke` run for pipeline debugging at any time, but label it as
smoke and never present it as reproduction. If admission is insufficient, list the missing items
or propose a different target; do not implement missing official code on your own.
