# UI batch 2: before and after (owner's homework rules, 2026-11-27)

`before/` is commit 18ac623 (the base of `claude/ui-batch-2`); `after/` is this branch. The same harness took both
(`scripts/ui-batch-2-browser.cjs`), with synthetic data only. Its fictional API answers with the shape the database returns in each
version: before, a self-marked try stays "corrected" and unreleased (the "Faraday homework 1" bug); after, migration 20261127130000
releases it at hand-in. Names: `<item>-<screen>-<phone|wide>-<light|dark>-<en|ar>.png`. Phone is 390x844 and wide desktop is 1920x1080.

- `1-student-homework-one-*`: one-try homework right after the hand-in. Before: "corrected", no mark, answers locked. After: the mark at once, the mark beside each question, the answers open.
- `1-student-homework-tries-*`: homework with tries left. After: the mark at once, the answers wait ("open when you have used all your tries…") and "I'm done, show me the answers".
- `1-student-homework-mixed-*`: choice questions and an essay. After: the self-marked part (2 / 3) at once, the essay says "Waiting for your teacher", no total until the release.
- `2-student-homework-stop-ask-*`, `2-student-homework-stopped-*` (after only): the confirmation, then the answers open and the tries end.
- `3-student-course-*`, `3-student-home-*`: lesson cards and "X / Y completed" under the one completion rule. Before: a homework-only lesson and an empty lesson are not complete. After: complete once handed in / opened; a lesson whose parts are done but whose homework is not handed in is "In progress". Arabic chapter labels, no placeholder slides or "Your Grade" badge.
- `4-teacher-homework-open-*`, `4-teacher-homework-closed-*`: every homework says "X of Y handed in · Z late · average"; the self-marked homework is no longer under "To correct"; Closed newest first.
- `5-teacher-homework-students-*` (after only): one homework's students by Group, read only.
- `6-wizard-solutions-*`: the Solutions step. Before: "Right after they hand in" / "After the deadline". After: no choice; the rule line says when the answers open.

Student pages are rendered on the server without browser scripts, so the sections that load in the browser show "Loading".
