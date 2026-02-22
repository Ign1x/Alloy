# Web UX Quality Checklist

This checklist is used as a lightweight quality gate for key web UX changes.

## CI-Automated Checks

- Build must pass (`npm run build`).
- Lighthouse desktop accessibility score >= 0.90 on the home page.
- Lighthouse desktop performance score >= 0.70 (warning threshold).
- Lighthouse desktop best-practices score >= 0.85 (warning threshold).
- Lighthouse mobile accessibility score >= 0.90 on the home page.
- Lighthouse mobile performance score >= 0.55 (warning threshold).
- Lighthouse mobile best-practices score >= 0.80 (warning threshold).

## Manual Checks (PR Author + Reviewer)

- Keyboard navigation reaches primary controls in: login, instances, nodes, files, and logs.
- Focus ring is visible on actionable controls and dialogs.
- Critical touch targets on mobile are usable without hover-only affordances.
- Core troubleshooting flow is smooth: open logs -> search -> jump -> copy snippet.
- Core file flow is smooth: open file panel -> locate path -> copy path/content.
- Non-English locale smoke check (at least one CJK locale) has no obvious English leftovers on key paths.

## Notes

- Keep this checklist short, stable, and easy to run in every UI-focused PR.
- If thresholds are tuned, update this document and the CI config in the same PR.
