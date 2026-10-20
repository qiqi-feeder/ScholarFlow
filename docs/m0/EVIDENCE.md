# M0 evidence

This directory stores versioned acceptance evidence. Never commit API keys, credentials, personal
paths that reveal secrets, or raw licensed datasets.

## Pi lock verification

Run:

```powershell
node --import tsx scripts/verify-pi-session.ts
```

Observed on 2026-10-20 with Node 24.21.0:

```json
{
  "sdkVersion": "1.3.0",
  "packageVersion": "1.3.0",
  "license": "MIT",
  "persistentSession": true,
  "reopenedSessionId": "01a15927-7e84-7673-af74-bbd1c8d2b900",
  "skills": [
    "experiment-design",
    "latex-writing",
    "literature-review",
    "reproduction-admission",
    "result-analysis"
  ],
  "tools": ["read"],
  "realModelCall": "blocked: no DeepSeek API key"
}
```

The script proves the installed package, license, session persistence/reopen, and Skill/tool
discovery. It does not prove a real model tool loop; the missing key is reported as blocked.

## Search and build evidence

- A real Crossref query on 2026-10-20 returned records with a retained response hash and showed
  that title search can return near-matches. See [VERIFICATION](../VERIFICATION.md) section 3.
- The server integration suite ran real `pdflatex`/`bibtex`, rejected an undefined citation,
  returned `409 STALE_BUILD` for an older PDF, and produced a submission zip. See
  [VERIFICATION](../VERIFICATION.md) section 4.

## Real model / experiment evidence

`V03`, `V09`, and `V13` require a user-supplied DeepSeek key and a configured Python/Conda/data
environment. Until those exist, their status is **not executed**, and the corresponding milestones
must not be described as complete. The current status matrix is in [VERIFICATION](../VERIFICATION.md)
and [PLAN](../../PLAN.md).
