# ScholarFlow UI redesign brief

Redesign `demo/index.html` into a polished, credible desktop-first research
workspace for researchers in computer science, AI, and data science. Improve
the hierarchy, typography, spacing, information density, navigation clarity,
interaction feedback, accessibility, and responsive behavior. The result
should feel specific to sustained scholarly work rather than like a generic
SaaS dashboard.

## Product intent

ScholarFlow is a local-first agentic research workspace. Researchers move
between literature, PDF reading, notes, traceable evidence, experiments, and
an agent that understands the current project context. The primary job of the
screen is to help a researcher resume meaningful work quickly while retaining
source traceability and control over agent actions.

Treat this as an authorized redesign. Choose one coherent visual direction
without asking the user additional questions. Preserve product truth and
functionality while replacing the current visual treatment.

## Hard implementation constraints

1. Keep the implementation in `demo/index.html` using self-contained HTML,
   CSS, inline SVG, and vanilla JavaScript.
2. Do not add frameworks, packages, build steps, remote fonts, remote images,
   external stylesheets, external scripts, network requests, or runtime
   dependencies.
3. Preserve the title `ScholarFlow · Research Workspace` and all markers
   required by `tests/web-demo.tests.ps1` and
   `tests/ui-bakeoff.tests.ps1`.
4. Preserve all six workspace views: overview, sources, reading, notes,
   evidence, and experiments.
5. Preserve and keep working: project switching, activity navigation,
   contextual editor tab, command palette and keyboard shortcut, agent quick
   prompts and composer, context-chip removal, paper filtering, toast feedback,
   and the asynchronous experiment runner.
6. Preserve the substantive Chinese product content and realistic research
   data. Small copy edits for clarity are allowed; do not invent commercial
   claims or remove capabilities to make the interface simpler.
7. Use semantic controls, visible keyboard focus, meaningful accessible names,
   an accessible status/toast announcement, and reduced-motion handling.
8. Desktop widths 1440x900 and 1280x800 are the primary targets. 1024x768 is
   the compact-desktop target. At narrower widths, core navigation and the
   Agent must remain discoverable rather than being permanently hidden.
9. Avoid rendered body/control text below 12px. Use a legible type hierarchy
   and comfortable interaction targets appropriate to a dense desktop tool.
10. Make one complete implementation pass and at most one batched repair pass.
    Do not inspect or borrow from another experiment arm.

## Required verification and handoff

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\web-demo.tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\ui-bakeoff.tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\product-design.tests.ps1
```

If browser rendering is available, inspect the primary targets plus the narrow
pressure-test width and perform one batched repair pass. If it is unavailable,
state that limitation and do not claim visual verification.

Write `EXPERIMENT_RESULT.md` containing only the design thesis, notable changes,
verification performed, and remaining limitations. Then commit every change
on the experiment branch.

