# Upstream and dependency licenses

Locked at M0. Verify with `npm ls --depth=0` and each package's `package.json` before release.
This file records direct runtime dependencies, not every transitive package.

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 1.3.0 | MIT | Agent session, providers, tools, skills, compaction |
| `typebox` | 1.3.27 | MIT | Pi tool parameter schemas |
| `archiver` | 7.x | MIT | Submission zip export |
| `unpdf` | 0.12.x | MIT | Extract text from readable PDFs (scanned PDFs explicitly rejected) |
| `react`, `react-dom` | 19.x | MIT | Web UI |
| `react-markdown`, `remark-gfm` | 10.x / 4.x | MIT | Safe Markdown rendering in chat |
| `vite`, `@vitejs/plugin-react` | 6.x / 4.x | MIT | Web build |
| `tsx` | 4.x | MIT | Run TypeScript host/worker/tests |
| `playwright-core` | 1.x | Apache-2.0 | Browser tests using a locally installed Chromium |

Pi itself depends on packages such as `@earendil-works/pi-ai`, `pi-agent-core`, `pi-mcp`, and
`pi-codemode` (all part of the same MIT project). The static demo assets under `demo/` retain their
own provenance recorded in `demo/assets/ide-light/manifest.json`; they are not part of the new app.
