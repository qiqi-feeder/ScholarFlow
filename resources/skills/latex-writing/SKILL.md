---
name: latex-writing
description: Write and revise an English article from verified result versions, maintain BibTeX and figure provenance, compile locally, and export a submission package. Use for manuscript drafting, reviewer responses, and camera-ready preparation.
license: MIT
compatibility: Requires latexmk and a TeX distribution for PDF builds.
metadata: {"version":"1.0.0","requires":["latexmk"],"source":"ScholarFlow built-in"}
---

# LaTeX writing

1. Cite only sources present in the project material list or BibTeX file. Every numeric result
   must name a `ResultVersion` and its run IDs.
2. Never describe a smoke, failed, unknown, or incomparable run as a successful reproduction.
   State deviations and limitations in the manuscript.
3. Edit `.tex`, `.bib`, and figure files through the manuscript API so each save creates a
   version. Do not overwrite a built PDF with an old file.
4. Run `compile_manuscript`. Read the diagnostics. Fix undefined references, missing figures,
   and LaTeX errors before claiming a build succeeded.
5. Keep the build free of shell escape. Use local figures generated from result artifacts and
   record their source version.
6. Export with `export_submission`, then verify the file manifest contains only manuscript files,
   sources, and the build PDF, with no credentials or unrelated large data.
7. When responding to reviewers, create a new task that references the old manuscript/result IDs.
   Do not silently rewrite history.
