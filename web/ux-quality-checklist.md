# Web UX Quality Checklist (Thread J)

This is the canonical acceptance checklist for `goals/web-ux-250-updates-ulw.md` Thread J.

## How to use

- Use this checklist for UI PR acceptance and release sign-off.
- Keep this file as the stable source of truth.
- Record actual pass/fail for each release in `web/ux-release-archive/<date>-<tag>.md`.

## Thread J Checklist

- [ ] J01 Define a minimum UI PR acceptance checklist and require it in every UI PR.
- [ ] J02 Build passes as a baseline quality gate (`npm run build`).
- [ ] J03 Run desktop walkthrough for key pages (login, instances, nodes, files, logs, settings).
- [ ] J04 Run mobile walkthrough for key pages (same scope as J03).
- [ ] J05 Validate login flow usability (success, invalid credentials, loading feedback).
- [ ] J06 Validate instances flow usability (filter, open detail, run action, result feedback).
- [ ] J07 Validate nodes flow usability (search, select, update/delete guarded actions).
- [ ] J08 Validate files and logs troubleshooting flow end-to-end.
- [ ] J09 Validate error recovery flow (retry, clear filters, return to actionable state).
- [ ] J10 Validate read-only mode behavior (disabled actions and readable reasons).
- [ ] J11 Validate empty-state copy quality (what happened + next action).
- [ ] J12 Validate error-state copy quality (actionable, non-ambiguous, consistent tone).
- [ ] J13 Validate loading-state stability (no major layout jump or broken skeleton rhythm).
- [ ] J14 Validate focus ring visibility on all actionable controls and dialogs.
- [ ] J15 Validate keyboard end-to-end reachability on key flows.
- [ ] J16 Validate dark-theme contrast for critical text and controls.
- [ ] J17 Validate light/dark visual consistency on spacing, hierarchy, and emphasis.
- [ ] J18 Validate toast feedback timeliness and semantic accuracy.
- [ ] J19 Validate modal/drawer close behavior and focus return target.
- [ ] J20 Validate mobile touch target precision for frequent actions.
- [ ] J21 Run component-level visual regression sampling for high-change surfaces.
- [ ] J22 Run key-path perceived performance sampling (no obvious interaction stall).
- [ ] J23 Run bundle-size warning review (`npm run bundle:check`) and record result.
- [ ] J24 Run pre-release multilingual smoke check (at least one non-English locale).
- [ ] J25 Complete release sign-off and archive regression evidence.

## CI-Enforced Baseline

- Build passes (`npm run build`).
- Bundle budget check runs (`npm run bundle:check`).
- Lighthouse desktop: accessibility >= 0.90, performance >= 0.70 (warn), best-practices >= 0.85 (warn).
- Lighthouse mobile: accessibility >= 0.90, performance >= 0.55 (warn), best-practices >= 0.80 (warn).

## Evidence Requirements

- Attach screenshots or screen recordings for J03, J04, J14, J16, J17, J20, and J21.
- Attach flow notes for J05-J10 with pass/fail and blocking issues.
- Attach timing notes for J18 and J22 (quick perceived timing notes are enough).
- Attach locale scope and leftovers count for J24.
- Store all final evidence in the release record file for J25.
