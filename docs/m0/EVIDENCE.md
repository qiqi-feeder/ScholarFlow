# M0 evidence

This directory stores versioned acceptance evidence. Never commit API keys, credentials, personal
paths that reveal secrets, or raw licensed datasets.

## Pi lock verification

Run:

```powershell
node --import tsx scripts/verify-pi-session.ts
```

Expected output includes the installed Pi version (`1.3.0`), license (`MIT`), whether the package
can create a persistent session and reopen it, and the discovered skill/tool names. A missing API
key is reported as a blocked real model call, not as a pass.

## Real model / experiment evidence

`V03`, `V09`, and `V13` require a user-supplied DeepSeek key and a configured Python/Conda/data
environment. Until those exist, their status is **not executed**, and the corresponding milestones
must not be described as complete.
