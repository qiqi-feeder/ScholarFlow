# Blinded evaluation rubric

## Hard gates

A variant is incomplete if any of these fail:

- All repository tests pass.
- The page is self-contained and has no runtime network dependency.
- All six views and required interactions remain available.
- Inline JavaScript parses and the page has no known startup error.
- Core navigation and Agent access are not permanently lost at compact widths.
- The variant has its own Git commit and experiment handoff.

## Scoring (100 points)

| Dimension | Weight |
| --- | ---: |
| Information hierarchy and primary-task clarity | 20 |
| Research-workspace fit and density control | 20 |
| Visual craft, coherence, and distinctiveness | 20 |
| Interaction clarity and state feedback | 15 |
| Accessibility and keyboard usability | 10 |
| Responsive behavior | 10 |
| Maintainability and dependency discipline | 5 |

Screenshots are presented as anonymous variants at matching sizes. Source
review and automated guideline findings are applied to every arm using the
same rules. Skill identities are revealed only after the first ranking.

