# Milestone 3 — Sessions & Groups

Status: implemented and locally validated; Draft PR for owner review. **Not approved for remote migration or authenticated acceptance.**

## Isolation and checkpoints

Base: `aafb434b77a00d67650550d75d21e9ef74476878` on `collab/v2-integrated-ui`.
Branch: `codex/milestone3-sessions-groups`, isolated worktree `E:/EduLabs-Milestone3`.

| Checkpoint | Commit | Delivered |
| --- | --- | --- |
| 3A | `99e24421c5ebeb748b4262ff01df8594fb674659` | Unified route/navigation; old `/group`, `/groups`, `/sessions` remain usable; student/staff group views; existing Next Class widget/countdown. |
| 3B | `ffbbc617c31f5abeb2ec741b1f87e054b51bb883` | Persisted stream label/finite icon presets, live preview, location/mode and dedicated HTTPS/Jitsi controls, server-scoped summary/filter support. |
| 3C | `91e4b6c032b5d1eff898f5b4ae3a89a709132926` | Own homework warning, explicit attendance labels/history and actual student/staff dashboard counts; schedule retry/timeouts. |
| 3D | Commit containing this report | Regression coverage, exact migration checksum, component screenshots and delivery evidence. |

Teacher/offering selection, existing creation/editing, membership management, recurrence, one-off sessions, cancellation/rescheduling, attendance pagination/finalization/reopening remain contextual. Assistants retain assigned-group attendance scope and do not gain instructor configuration rights.

## Local-only migration

File: `supabase/migrations/20261018100132_group_presentation_and_session_summary.sql`.

SHA-256: `A0A14658BB9F09F6FC1E9FED884DB3D8F1A0A71D36A236E0152310DD97BFD4FC`.

- Adds only `study_groups.stream_label` and `stream_icon`, with safe defaults, length/control-character checks and six fixed icon values. Existing RLS and SELECT privileges apply; no new public tables or table-write grants.
- Extends the existing private `group_command` and `group_view` functions, preserving their signatures, empty search paths, caller identity resolution, locks and contextual authorization. Existing public wrappers and function grants remain unchanged.
- The dedicated editor sends an explicit `applyMeetingDefaults: true`: update only unstarted, uncancelled automatic draft occurrences whose meeting fields actually differ. Preserve IDs, recurrence templates, history, attendance and one-off exceptions. Repeating unchanged defaults leaves session versions unchanged. Ordinary metadata-only edits retain their previous snapshot behavior.
- Extends only the recurring details-update branch in the existing notification event function: use the existing bounded recipient-aware group announcement, instead of one event per future occurrence. Genuine reschedules retain their separate session policy. No preferences/worker privileges change.
- `group_view(..., 'summary')` returns `{ own: { attended, absent }, staff: { attended, absent }, pendingHomework }`. Own counts include only finalized, noncancelled attendance; staff counts include explicit marks across authorized groups, including draft/reopened marks. Counts are attendance records, not generated-session estimates. Pending/unmarked never means absent.
- Group-scoped summaries require current group access. Global own historical counts remain accessible after membership changes, matching existing own-history behavior. Students receive no peer marks, identities, submissions or timestamps through the summary.
- Pending homework uses current caller enrollment and published-content helpers, latest published assignment version per family, and excludes already submitted assignments. No invented deadlines or homework URLs.
- The offering list filter is server-scoped and paginated; it does not elevate assistants or allow students to enumerate offering management data.
- All 25 foundation migration Git blobs are unchanged. PR #11 and its two migrations are excluded. The migration file is byte-preserved by `.gitattributes`.

**No connected Supabase/Firebase write, migration or fixture provisioning was performed.** No claim is made of a fresh remote migration-history audit during this task.

## Executed verification

| Check | Result |
| --- | --- |
| `npm run check` | 201/201 application tests passed; TypeScript and architecture checks passed; lint has zero errors and seven existing warnings in unchanged files. |
| Firebase/Supabase production build | Passed using existing protected configuration in process, isolated output/config under ignored `.local/`; no credential files copied. |
| Clerk/Prisma fallback production build | Passed. Existing Tailwind ambiguity warnings remain; no fallback dependencies imported from other PRs. |
| Native PostgreSQL local replay | All 26 local migrations replayed successfully in a fresh disposable localhost database; existing-data upgrade path seeded before Lessons migration. |
| SQL regression | All 16 suites passed: authorization, hardening, Firebase identity, owner cascade, provisioning, teacher editor, three Exams suites, Lessons, Homework, Groups, Support/Notifications, group notifications, student administration and new presentation/summary. New suite: 35 assertions. |
| Preservation checks | 70 existing tables/data/grants, 108 policies and all 191 existing function grants preserved across the pending migration; only the three intentionally extended function definitions differ. |
| Concurrency | 76 real independent-PostgreSQL-session cases passed, including three new presentation/defaults conflicts plus existing Exams/Lessons/Homework/Groups/Notifications/student-administration races. |
| Chromium component acceptance | Passed at 1440px and 390px: real V2 components/CSS/fonts, online/center views, Next Class/countdown, own homework/history, teacher vs assistant controls, URL rejection, save/refresh/clear, explicit default-update contract, visible 409, attendance save/finalize, summary error/retry, scoped dashboards and empty state. No horizontal overflow or JavaScript exceptions. |
| Git/sensitive-file review | No environment files, credentials, tokens, runtime outputs or local manifests included; migration checksum and prior branch heads verified. `git diff --check` passed. |

Browser acceptance above uses explicitly fictional local HTTP transports. It **does not** prove Firebase authentication or connected Supabase authorization end-to-end. The SQL suites separately exercise actual PostgreSQL roles/RLS/RPCs; neither is mislabeled as real authenticated browser testing. Browser harness: `scripts/group-browser-components.cjs`, optional Playwright/esbuild runtime selected by `LMS_BROWSER_RUNTIME` (no application dependency additions).

## Visual evidence — component fixtures only

| View | Desktop | Mobile |
| --- | --- | --- |
| Student online group | [1440px](evidence/milestone3/student-1440.png) | [390px](evidence/milestone3/student-390.png) |
| Teacher management and finalized attendance | [1440px](evidence/milestone3/teacher-1440.png) | [390px](evidence/milestone3/teacher-390.png) |
| Student center group | — | [390px](evidence/milestone3/student-center-390.png) |
| Dashboard attendance | [Staff](evidence/milestone3/teacher-dashboard.png) | [Student](evidence/milestone3/student-dashboard.png) |

Screenshots retain the existing V2 components, theme and bundled Figtree/Caprasimo fonts. Teacher evidence intentionally includes a simulated 409 to show the visible conflict state. External requests were blocked in the component harness.

## Cleanup and remaining gates

- SQL test transactions rolled back. Native concurrency fixtures existed only inside randomized disposable databases, which were dropped. Verified zero owned databases remain; the task-owned localhost PostgreSQL cluster was stopped. Browser server/context closed. Ignored logs/builds/test tooling remain locally for review.
- No remote accounts, Storage objects or academic records were created or deleted. No external fixture cleanup is required.
- Owner must review and explicitly authorize the exact pending migration before development application. After that, run real Firebase teacher, assigned-assistant and student sessions against this PR: publication/group assignment, joining details, attendance finalization/correction, dashboard refresh, enrollment expiry/revocation, cross-tenant/forged IDs and direct unauthorized writes. Reconcile exact disposable fixtures afterward.
- Firefox/WebKit, real external meeting participation, production scale/load and production deployment are not tested. Jitsi remains a safe external link; the LMS cannot establish provider meeting privacy or DRM.
- The new controls/summaries require the pending migration; the Draft PR is not rollout-ready against the unchanged development schema. Ordinary existing group operations remain available.
- PR #9/#10/#11, other worktrees, `main`, Firebase settings, connected database records and deployed infrastructure were not modified by this task. Integration remote HEAD remained the pinned base at final read-only verification. No merge/deployment occurred.

## Exact changed files

- `.gitattributes`
- `app/(dashboard)/(routes)/sessions-groups/page.tsx`
- `app/(dashboard)/(routes)/sessions/page.tsx`
- `docs/evidence/milestone3/student-1440.png`
- `docs/evidence/milestone3/student-390.png`
- `docs/evidence/milestone3/student-center-390.png`
- `docs/evidence/milestone3/student-dashboard.png`
- `docs/evidence/milestone3/teacher-1440.png`
- `docs/evidence/milestone3/teacher-390.png`
- `docs/evidence/milestone3/teacher-dashboard.png`
- `docs/milestone-3-sessions-groups.md`
- `frontend/components/sidebar.tsx`
- `frontend/features/dashboard/admin-home.tsx`
- `frontend/features/dashboard/sidebar-routes.tsx`
- `frontend/features/dashboard/student-home.tsx`
- `frontend/features/groups/group-presentation-form.tsx`
- `frontend/features/groups/group-roster-view.tsx`
- `frontend/features/groups/group-summary-panel.tsx`
- `frontend/features/groups/group-workspace.tsx`
- `frontend/features/groups/stream-bubble.tsx`
- `frontend/features/groups/use-group-sessions.ts`
- `frontend/features/groups/use-group-summary.ts`
- `package.json`
- `scripts/exam-sql-local.cjs`
- `scripts/group-browser-components.cjs`
- `scripts/group-presentation-concurrency.cjs`
- `scripts/group-presentation.test.cjs`
- `scripts/groups.test.cjs`
- `scripts/student-portal.test.cjs`
- `server/http/groups.ts`
- `shared/contracts/dashboard.ts`
- `shared/contracts/database.types.ts`
- `shared/contracts/groups.ts`
- `shared/website-routes.ts`
- `supabase/migrations/20261018100132_group_presentation_and_session_summary.sql`
- `supabase/tests/group-presentation-summary.sql`
