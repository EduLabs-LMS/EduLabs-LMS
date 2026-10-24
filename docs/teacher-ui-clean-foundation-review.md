# Issue #20 — Clean teacher-UI foundation preparation

2026-10-24, Africa/Cairo. Prepared under owner comment 6383545623.

## Exact source and Git state

- Branch: `codex/teacher-ui-clean-foundation`.
- Worktree: `C:/dev/EduLabs-LMS/.local/worktrees/teacher-ui-clean-foundation`.
- Exact starting/current HEAD: `fa67875fdab88f0fc640804e2f96b6aa7c44b0c1`.
- Correction (2026-10-24): this foundation was subsequently committed as `d3451e5`; the
  branch/uncommitted statements here describe the time of writing. Platform-admin work
  continues on `claude/admin-provisioning-v1`.
- Separate worktree created from that exact SHA; no other worktree was overwritten.
- Friend redesign second-parent `16acf2f` and merge `f1be2f8` were NOT imported.
- No push, merge, deployment, connected database/provider mutation, email PR change or
  remote migration. No credentials/environment files copied into this worktree.

## Removal versus hiding

50 teacher-only presentation files are physically removed. This includes the old
course/chapter editors, academic/website managers, dashboard, student administration,
homework correction inbox, exam authoring/grading UI and group meeting editor.
The old JSX/forms are not retained behind feature flags. Existing Git history preserves
that source for audit, not as Claude's initial UI. Exact direct baseline consumers and
disposition are in `ai/RETIRED_TEACHER_UI.json`.

Mixed components were split: student exam list/runner/results remain; teacher exam
composition becomes neutral. Student homework list/answer/submission/history and private
file renderer remain; teacher authoring is removed. Groups retains the student's list,
session polling/countdown, authorized joining and own attendance/history pagination,
with all group authoring/roster-management/attendance-mutation UI removed. Shared account,
Notifications, support/operator threads, private media/PDF renderer and general primitives
remain because they serve student or separate support workflows.

### Neutral scaffolds (intentional temporary loss of teacher UI)

These placeholders state that management is unavailable during rebuild. They contain
no save/create forms, fake metrics or success claims. They are not new permissions.

- `/teacher/courses`, `/teacher/create`, `/teacher/analytics`, `/teacher/programs`,
  `/teacher/website`, `/admin/users`, `/admin/submissions`.
- `/teacher/courses/[courseId]` and its chapter route: Firebase editable-course/part
  checks retained; Clerk staff gets a neutral route rather than a Firebase-only error.
- Staff branch of `/home`, `/group` (including aliases), `/offerings/[offeringId]`,
  `/exams` and exam detail.
- Teacher editor/inbox server adapters and teacher branch of lesson homework composition.

`TeacherFoundationPage` retains existing contextual staff/legacy staff guards;
`TeacherEditor` retains exact course checks and `LearningPartPage` retains exact part
lookup through the authorized teacher learning service. Student direct lesson pages,
registration/access routes, publication/enrollment checks and existing teacher layout
remain. Managed organization onboarding stays unavailable. Student Self Learning is NOT
relocated to teacher-management routes from the excluded redesign.

Teacher UI backward compatibility is intentionally retired in both modes. Clerk student
fallback and both builds remain, not a promise that old teacher forms still exist.
This branch is not ready for a teacher trial/deployment until the UI is rebuilt.

## Preserved backend and security

All existing `server/`, `app/api/`, `shared/`, `supabase/`, `infra/`, Prisma schema and
lockfile remain unchanged relative to the baseline, except the two new Continue Learning
read-handler/route files. All 31 migrations are byte-preserved; no RLS, privileges,
identity mapping, data or teacher command changed. Unit comparisons and full disposable
SQL replay verify the retained boundary. No connected database was accessed this phase.

The previous read-only audit counted 31 development migrations. The ledger contains six
historical Git/remote version mappings. No automatic migration replay/history repair.
Firebase uses verified issuer/subject -> stable UUID, not email. Ordinary reads and
writes keep caller-token RLS, exact-origin CSRF, request bounds and contextual tenant
permissions. API access does not depend on whether this branch currently has a form.

## Selected later fixes and rejected dependencies

- Ported `d96c40e` reliability logic only: generation-specific invalidation, completion
  evidence, scoped awaitable overview read, bounded input, abort/stale-response rejection
  and explicit finite failure/retry. Baseline visual classes retained.
- Adapted website-pages only to pass offering selection. No student-preview imports,
  new teacher routes or redesign primitives.
- Ported the production fixture's URL synchronization and new cancellation/order tests;
  replaced post-integration documentation with baseline-specific evidence.
- Narrow staging successful-login `router.replace` port, with no redundant refresh,
  and landing-only splash behavior. No whole auth branch or email PR was merged.
- Added a router adapter to the standalone auth browser fixture; it is synthetic,
  not evidence of real-provider soft navigation. Unit test requires one replace.
- Did not import preview/filter/bulk-group functionality introduced by the redesign.
  Their security/behavior requirements are recorded for any future implementation.
- PR #19 remains a separate draft/reference branch; no merge, cherry-pick or retarget.

## Actual verification

| Check | Result |
| --- | --- |
| Final complete application suite | 427 passed, 0 failed; includes 9 new foundation cases and ported reliability cases |
| Architecture boundary checks | Passed |
| Strict nonincremental application TypeScript | Passed, exit 0; app/frontend/server/shared included, ignored fixture outputs excluded |
| Lint | 0 errors, 3 existing warnings |
| Firebase/Supabase optimized build | Passed; final repeat also exited 0 |
| Clerk fallback optimized build | Passed; final repeat also exited 0 |
| Disposable native PostgreSQL | Fresh loopback cluster, all 31 migrations replayed; 23 SQL suites passed |
| SQL concurrency | All existing independent-session suites passed, including 14 student-administration cases, 14 group races, 14 homework races, 6 lesson races |
| Registration/access Chromium | 12 groups passed; actual components/provider with synthetic SDK/HTTP/router |
| Settings/Notifications Chromium | 21 groups passed, no hidden academic-stage requests |
| Continue Learning components/native video | 13 groups passed |
| Production Next App Router | Three independent server/browser runs, 14 scenarios each, 42 groups; synthetic identity/data |
| Extracted foundation/student group Chromium | 4 groups passed at 1440px and 390px; join/history work, no teacher forms/mutations |
| Whitespace | git diff --check passed |
| Secrets/source review | No new credentials/private keys/tokens or runtime artifacts in source inventory |

Commands: `npm test`, `npm run check:boundaries`, `npm run lint`, explicit strict
nonincremental TypeScript using ignored application-only config; both modes through
ignored `.local/settings-build.cjs`; `node scripts/exam-sql-local.cjs --postgres` against
an owned loopback cluster only; browser scripts documented in `ai/TESTING.md`.

### Failures investigated (not concealed)

Initial extraction had syntax/type errors in JSX/locale insertion and leftover teacher
state references; corrected before passing strict compilation. Presentation tests for
removed screens initially failed with missing files; replaced with explicit retirement
and retained-student assertions, not skips. Server/service/contract/RLS suites were not
removed. The standalone Firebase form harness needed a Next router adapter for the soft
replace and pathname hooks. Settings browser needed the isolated build CSS path rather
than default `.next`. Both were rerun successfully. An output-summary Python console
could not print Unicode on Windows; its already-written test log showed passing tests,
and later summaries use escaped JSON. No application failure was reclassified as a pass.

### Limits and cleanup

No real Firebase/Supabase identity, email delivery, live Storage upload, push delivery,
Firefox/WebKit, physical-device or load acceptance ran. Synthetic SDK/router adapters
are explicitly not real-provider proof. Full teacher workflows cannot pass because the
legacy UI is intentionally removed; existing backend authorization/grading tests remain.
No customer/test identities or remote objects were created, so none were deleted.
The disposable database was removed by its harness and the owned cluster stopped;
its stopped ignored data is retained as evidence. Browser servers close in their
finally handlers. Existing user servers were not stopped. Generated fixtures, native
video, logs, builds, screenshots and a dependency junction remain ignored in `.local/`
(or ignored node_modules), never in the source inventory. Protected build configuration
was read by existing tooling without copying or exposing it.

## Claude onboarding and next gates

`CLAUDE.md` plus `ai/PROJECT_STATE.md`, `ARCHITECTURE.md`, `TEACHER_UI_SPEC.md`,
`DECISIONS.md`, `TESTING.md`, `HANDOFF.md` and the retirement consumer inventory are
prepared. `docs/architecture.md` now distinguishes current direction from its historical
Clerk/Prisma layer-refactor text. Canonical schema truth stays in migrations/ledger.

Owner review -> authorize/pin a foundation commit -> independent handoff review ->
explicit Claude assignment (first scoped course-list/navigation screen). No deployment
or merge is implied. Teacher self-service offering administration, assistant permission
expansion, waitlist switch and student email disclosure remain backend/product decisions,
not reasons to broaden permissions while building the UI. Jitsi and PR #19 stay separate.

## Complete changed-file inventory

The report itself is an additional new documentation file. Status below is the source
inventory at review time; `??` means new/untracked, not omitted from review.

| Status | Category | Repository-relative path |
| --- | --- | --- |
| M | production/configuration | `app/(dashboard)/(routes)/admin/submissions/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/admin/users/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/home/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/analytics/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/courses/[courseId]/chapters/[chapterId]/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/courses/[courseId]/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/courses/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/create/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/programs/page.tsx` |
| M | production/configuration | `app/(dashboard)/(routes)/teacher/website/page.tsx` |
| M | production/configuration | `app/(dashboard)/_components/homework-inbox-page.tsx` |
| M | production/configuration | `app/(dashboard)/_components/learning-part-page.tsx` |
| M | production/configuration | `app/(dashboard)/_components/teacher-editor.tsx` |
| M | production/configuration | `app/(dashboard)/_components/website-exams.tsx` |
| M | production/configuration | `app/(dashboard)/_components/website-pages.tsx` |
| M | documentation | `docs/architecture.md` |
| M | production/configuration | `frontend/components/intro-splash.tsx` |
| D | production/configuration | `frontend/features/admin/submissions/homework-inbox.tsx` |
| D | production/configuration | `frontend/features/admin/submissions/submissions-view.tsx` |
| D | production/configuration | `frontend/features/admin/users/add-students-modal.tsx` |
| D | production/configuration | `frontend/features/admin/users/admin-users-view.tsx` |
| D | production/configuration | `frontend/features/admin/users/group-form-modal.tsx` |
| D | production/configuration | `frontend/features/admin/users/master-user-directory.tsx` |
| D | production/configuration | `frontend/features/admin/users/reassign-modal.tsx` |
| D | production/configuration | `frontend/features/admin/users/student-mirror-drawer.tsx` |
| D | production/configuration | `frontend/features/admin/users/supabase-student-admin.tsx` |
| M | production/configuration | `frontend/features/auth/firebase-form.tsx` |
| M | production/configuration | `frontend/features/courses/lesson/homework-assignments.tsx` |
| M | production/configuration | `frontend/features/courses/lesson/secure-player.tsx` |
| D | production/configuration | `frontend/features/dashboard/admin-home.tsx` |
| D | production/configuration | `frontend/features/exams/exam-builder.tsx` |
| D | production/configuration | `frontend/features/exams/exam-grading-panel.tsx` |
| D | production/configuration | `frontend/features/exams/exam-staff.tsx` |
| D | production/configuration | `frontend/features/exams/exam-teacher-portal.tsx` |
| M | production/configuration | `frontend/features/exams/exams-view.tsx` |
| D | production/configuration | `frontend/features/groups/group-presentation-form.tsx` |
| M | production/configuration | `frontend/features/groups/group-workspace.tsx` |
| M | production/configuration | `frontend/features/self-learning/continue-learning.tsx` |
| M | production/configuration | `frontend/features/self-learning/learning-overview-freshness.ts` |
| M | production/configuration | `frontend/features/self-learning/student-learning.tsx` |
| D | production/configuration | `frontend/features/teacher/academics/course-stages.tsx` |
| D | production/configuration | `frontend/features/teacher/academics/program-workspace.tsx` |
| D | production/configuration | `frontend/features/teacher/analytics/chart.tsx` |
| D | production/configuration | `frontend/features/teacher/analytics/data-card.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/attachment-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-actions.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-content-type-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-description-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-solution-video-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-title-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/chapter-video-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/homework-editor.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/homework-questions-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/learning-editor.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/lesson-cover-form.tsx` |
| D | production/configuration | `frontend/features/teacher/chapters/editor/module-details-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/course-create.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/course-editor.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/course-list.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/create-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/actions.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/attachment-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/category-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/chapter-naming-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/chapter-number-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/chapters-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/chapters-list.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/description-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/image-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/editor/title-form.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/list/columns.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/list/data-table.tsx` |
| D | production/configuration | `frontend/features/teacher/courses/teacher-form.tsx` |
| D | production/configuration | `frontend/features/teacher/website/custom-domains.tsx` |
| D | production/configuration | `frontend/features/teacher/website/website-workspace.tsx` |
| M | production/configuration | `frontend/locales/ar.ts` |
| M | production/configuration | `frontend/locales/en.ts` |
| M | production/configuration | `middleware.ts` |
| M | production/configuration | `package.json` |
| M | tests/harness | `scripts/academics.test.cjs` |
| M | tests/harness | `scripts/appearance.test.cjs` |
| M | tests/harness | `scripts/continue-learning-next.cjs` |
| M | tests/harness | `scripts/continue-learning.test.cjs` |
| M | tests/harness | `scripts/exam-runner.test.cjs` |
| M | tests/harness | `scripts/exams-foundation.test.cjs` |
| M | tests/harness | `scripts/firebase-auth.test.cjs` |
| M | tests/harness | `scripts/group-presentation.test.cjs` |
| M | tests/harness | `scripts/groups.test.cjs` |
| M | tests/harness | `scripts/homework.test.cjs` |
| M | tests/harness | `scripts/student-access-browser.cjs` |
| ?? | documentation | `CLAUDE.md` |
| ?? | production/configuration | `app/(dashboard)/_components/teacher-foundation-page.tsx` |
| ?? | production/configuration | `app/api/learning-overview/route.ts` |
| ?? | documentation | `docs/ai/ARCHITECTURE.md` |
| ?? | documentation | `docs/ai/DECISIONS.md` |
| ?? | documentation | `docs/ai/HANDOFF.md` |
| ?? | documentation | `docs/ai/PROJECT_STATE.md` |
| ?? | documentation | `docs/ai/RETIRED_TEACHER_UI.json` |
| ?? | documentation | `docs/ai/TEACHER_UI_SPEC.md` |
| ?? | documentation | `docs/ai/TESTING.md` |
| ?? | documentation | `docs/continue-learning-navigation-fix.md` |
| ?? | production/configuration | `frontend/components/teacher-foundation-notice.tsx` |
| ?? | tests/harness | `scripts/teacher-foundation-browser.cjs` |
| ?? | tests/harness | `scripts/teacher-foundation.test.cjs` |
| ?? | production/configuration | `server/http/learning-overview.ts` |

| ?? | documentation | `docs/teacher-ui-clean-foundation-review.md` |
