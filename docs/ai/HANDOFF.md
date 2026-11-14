# Handoff state — not yet approved for Claude implementation

V1 definition and checklist: [V1.md](V1.md). Integration branch: claude/teacher-v1.

Branch: claude/admin-provisioning-v1. Base HEAD: d3451e52c13a64f28d865ace8c9bd32059b4e696
(the committed clean foundation; the former codex/teacher-ui-clean-foundation text at
fa67875 was stale). Teacher Provisioning V1 (platform admin) is in the working
tree, uncommitted, for owner review; its migration is unapplied. Do not pretend HEAD
contains these changes. No push/merge/deployment has occurred. Next milestone not started.

Read PROJECT_STATE, ARCHITECTURE, DECISIONS, TEACHER_UI_SPEC, TESTING and the preparation
review. RETIRED_TEACHER_UI.json lists every deleted teacher presentation path with its
baseline direct consumers. The review lists every neutral scaffold and modified file.

Codex owns foundation preparation and existing backend contracts. Claude begins only
after explicit owner handoff approval, with the first scoped teacher course-list task.
No implicit permission to change APIs, RLS, provider settings, migrations or release.

Outstanding release gates: independent review of removed/replaced source; pin a final
commit; approve teacher UI scope; rebuild screens incrementally; controlled real
Firebase/Supabase acceptance, email delivery and deployment validation separately.
Teacher management is intentionally unavailable until replaced. Student synthetic
acceptance is not real-provider acceptance; no customer data was used.

## Update 2026-10-29
Teacher Home, menu, Settings and Groups & Classes are built (see TEACHER_UI_SPEC.md, "Built so far") on branch
claude/teacher-settings-groups, after claude/demo-spaces. Owner approval is still needed for any push beyond that branch, merge, PR,
deploy, migration or provider change. Next candidates, each needing its own approval: Create/Edit Group, Take attendance and the
per-session screen, Reports (replacing its "Coming soon" item), Students, Homework and Exams screens. Do not resurrect retired
components; do not add legacy paths to the middleware allow-list.

## Update 2026-11-05: design foundation

Branch `claude/design-v2-foundation`, from `claude/teacher-v1`, pushed as a new branch, not merged or deployed. Classic and New looks behind a per-person switch, the new frame, Courses at `/teacher/courses`, Settings in the main shell, Home rebuilt. Decisions: DECISIONS.md, "Design foundation". Next step: the owner and co-founder compare the looks and choose; no screen beyond Home and the frame was rebuilt.

## Update 2026-11-05: owner feedback on the New look

Same branch, `claude/design-v2-foundation`, not merged or deployed. New now carries Classic's lime pill, edge and rounded shapes; the logo has no box; Homework, Exams and Reports show with a Soon tag; New has its motion; the logo plays on every fresh opening of the site and replaces the old landing splash; Home has a countdown. Decisions: DECISIONS.md, "Owner feedback on the New look". Next step: the owner judges it on staging.

## Update 2026-11-06: owner feedback after testing New

Same branch, `claude/design-v2-foundation`, not merged or deployed. Both looks stay permanently, so every screen has to work in both. New this round: the credits in the owner's order; a help line for teachers in the footer; a menu that changes in place; a logo at 3:1 or more everywhere; `Switch`, `ChoiceGroup` and `Select` in place of native controls; "Edit attendance" in the page header. Decisions: DECISIONS.md, "Owner feedback after testing New".

## Update 2026-11-06: every teacher screen on the component system

Same branch, `claude/design-v2-foundation`, not merged or deployed. Every teacher screen is rebuilt on the design components in both looks, one commit each. New is the default for a browser that has not chosen, and its tokens now need the teacher shell, so student pages keep Classic values. Next for the owner: check New on staging, including whether existing teachers should get New by default, since a cookie cannot tell them from new ones.

## Update 2026-11-06: follow-ups on `claude/design-followups`

Branched from `claude/teacher-v1` after it was fast-forwarded to the design branch (owner tested it on staging). Sign-in and sign-up are on the design components in both looks; `/teacher/website` is switched off until its feature exists; V1.md lists the eleven stale browser harnesses to repair. Not merged or deployed.

## Update 2026-11-06: the Content section is built on `claude/course-content`

The owner applied `20261106130000_course_content_tree.sql` on dev and smoke-tested it with a real Firebase teacher. The Content section is now on the course page, through one new route, `/api/teacher/courses/<id>/content`. The migration did not change. It has been tested with synthetic data in a browser and against the real functions on a disposable database, not yet on dev. **Next:** the owner tries it on dev, then decides on the merge. Pushed to `claude/course-content`; no merge, no PR.

## Earlier on 2026-11-06: course content, stopped for review on `claude/course-content`

The homework and content boards and the owner's decisions are committed. The backend audit found delete, move and a safe rename missing, so the work stopped at one draft migration and its tests, as the owner instructed: `20261106130000_course_content_tree.sql`, not applied anywhere. **Next:** the owner reviews it and applies it on dev. Then build the Content section: contract and service, reasons in English and Arabic, the screen, unit tests and a browser harness. The owner's four answers are in DECISIONS.md, "Course content tree", and the draft follows them. Pushed to `claude/course-content`; no merge, no PR, nothing applied.

## Update 2026-11-12: homework part 2 on `claude/homework-correct`

Correcting, the Home "Homework to correct" card, and the student side (lesson page with no parts, Try again, deadline, tries left,
plain refusals) are built on `claude/homework-correct` (from `claude/homework-move` at be1d486). One draft migration,
`20261113120000_homework_correct_demo.sql` (demo seed 6 only), is **not applied anywhere**. No merge, PR or deploy. The owner approved
the three pinned baseline edits for the student refusal reasons, the retry action and the Locked card link. Next: owner review of the
screens and the screenshots, then apply the migration on dev.

## Update 2026-11-13: exams part 1 (teacher screens) on `claude/exams-ui`

The teacher Exams screens are built on `claude/exams-ui` (from 438388c) on top of migration `20261114120000_exams.sql`, which the owner
applied on dev. No new migration, no merge, PR or deploy. Built: the Exams page (`/teacher/exams`: Live now, To correct, course filter,
Open/Closed/Drafts/Archived, row menu), the wizard (`/teacher/exams/new`, `/teacher/exams/<id>`: online Details, Questions with
Choice/Number/Essay, When with each Group's window, Rules, Review; paper Details and Review), correcting (`/teacher/exams/<id>/correct`)
and the paper mark sheet (`/teacher/exams/<id>/marks`). Exams is a real menu item; only Reports is Soon. **Part 2** (not started): the
student side, the Home "Live now" card and demo seed v7. Next: owner review of the screens and `docs/design/screenshots/exams-ui/`.

## Update 2026-11-14: exams part 2 (student side, Home card, demo v7) on `claude/exams-student`

Built on `claude/exams-student` (from `claude/exams-ui` at efc4af9). One new migration, `20261115120000_exams_drafts_and_demo_v7.sql`
(**not applied anywhere**; `20261114120000_exams.sql` is untouched). It (1) lets a draft keep unfinished questions (a choice with no right
answer, a number with no value) and makes Publish refuse them, naming the question numbers; (2) adds the exam's `rule` and `courseTitle`
to the student view; (3) links release notices to `/exams/<id>`; (4) fills demo seed v7 (five Physics exams). The client now always sends
every question on autosave (the leave-them-out logic is gone). Student screens: `/exams` (list) and `/exams/<id>` (overview, taking,
hand-in, second try, answer review) with routes under `/api/exams`; the teacher Home has a "Live now" card from `exam_portal`.
Next: owner review of the screens (`docs/design/screenshots/exams-student/`), then the owner decides on applying the migration.
