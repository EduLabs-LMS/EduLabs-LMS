# Teacher redesign / student-core integration review

Date: 2026-10-23. Status: **local integration candidate; BLOCKED for private-staging release**.

Follow-up: the original findings below are preserved as historical evidence. The focused [Continue Learning navigation fix](continue-learning-navigation-fix.md) resolves that specific blocker with six independent production-mode runs. Real-provider acceptance and the other operational staging gates below remain open.

## Checkpoints and preservation

- Student/core base: `fa67875fdab88f0fc640804e2f96b6aa7c44b0c1`, branch `codex/student-settings-language`.
- Approved student Continue Learning checkpoint `5be818564c359689350c17497b0585f43605e983` and the subsequent registration/class-access checkpoint are ancestors of that base.
- Teacher source: `16acf2f63846efad9461944ceb89361985b8e591`, fetched and verified against `origin/claude/teacher-panel-redesign`.
- Common ancestor: `c46266f676ce09931d5002a045e9dc15216ac8aa`.
- Integration branch: `codex/integrate-teacher-panel-student-core`.
- Isolated worktree: `C:/dev/EduLabs-LMS/.local/worktrees/teacher-student-integration`.
- Original checkout: `C:/dev/EduLabs-LMS`, clean `codex/step06-complete-groups-attendance` at `0334349c4cb4ee7a213b321b720823b15dcb2f61`.
- Student worktree: `C:/Users/Sky-II-14600kf/.codex/worktrees/student-settings/EduLabs-LMS`, clean at the student/core base. Other pre-existing worktrees were inspected read-only and were clean; no stashes existed.
- Local main was `b2ca8d180c5d4bf984986850272ed8d8de916f34`; fetched integration tracking ref was `aafb434b77a00d67650550d75d21e9ef74476878`. Neither branch was integrated into or deployed.

The source diff from the common ancestor contains 160 files (3,448 additions / 1,414 deletions). Both handoff documents were read before integration. No uncommitted onboarding work needed rescuing: the latest changes already existed in the student/core commit. No reset, stash, cleanup, rebase or overwrite of either existing worktree was performed. The ending candidate is a normal local merge commit with the two exact base/source commits as parents; its full hash is supplied in the completion response to avoid a self-referential report hash.

## Resolved conflicts and necessary integration corrections

Three merge conflicts: `app/(dashboard)/_components/website-pages.tsx`, `frontend/features/self-learning/self-learning-view.tsx`, and `package.json`.

- Retained the teacher's dashboard composition, new navigation, relocated course/chapter routes, page styling, dropdowns and animations.
- Retained student Continue Learning on Home/Self Learning, offering-specific resume targets, bounded progress evidence, incomplete-progress notices and unrelated curriculum/assessment availability. The existing progress repository, service, player invalidation and recommendation implementation remain unchanged.
- Combined both test inventories instead of replacing the student suite with the teacher branch's command.
- Course preview now filters draft offering descriptors and rejects an explicitly requested draft offering. Student preview ignores a forged preview cookie on ordinary student identities.
- Restored original lesson numbering inside a chapter when filtering/searching; an unavailable progress overview cannot leave a previously selected completion filter silently hiding the curriculum.
- Corrected bulk group assignment: each sequential request now uses the version returned by the preceding successful command. Previously a second assignment could reuse a stale version and fail with 409. Capacity/authorization failures stop the sequence and report the confirmed completed count. This is a sequence of existing atomic commands, **not an all-or-nothing bulk transaction**.
- Attendance-only assistants no longer see instructor-only enrollment management controls. Server permissions were not widened.
- Adapted component harnesses to the actual approved dashboard/cards/custom dropdowns, supplied a synthetic identity hook to the standalone gallery, and fixed a Windows path-separator assertion. PDF annotation coverage now exercises the real PDF.js worker, second PDF page and image overlays.

The full final file inventory is in `teacher-panel-integration-files.md`. New local runtime, generated apps, media, logs and screenshots remain ignored under `.local/`; none belong in the source commit. No environment file or Admin credential was copied into this worktree. Build helpers read existing local build configuration without printing it.

## Security and architectural review

- No changes from the student/core base to `server/`, `supabase/`, middleware, deployment infrastructure, dependency lockfile or environment templates. All 31 local migration SQL files are preserved byte-for-byte. No migration was replayed against a connected service.
- The relocated `/self-learning/[courseId]` management subtree reuses the existing teacher layout guard. Course, chapter, exam, homework and group mutations continue through existing identity-bound handlers/RPCs and RLS.
- Role badges are presentation. An organization role in one tenant does not authorize another tenant. Platform support operators are not converted into academic administrators.
- Preview remains the teacher's real identity, not student impersonation. Published lesson queries explicitly filter published lessons/parts; the preview player does not save progress and homework/attempt controls are omitted. A browser guard prevents academic writes but is **not a replacement for server authorization**. Account/notification operations remain operations on the teacher's own account; this mode is not a universal sandbox that guarantees no account changes.
- Plain Jitsi links do not provide DRM, authenticated moderators, private-room enforcement or automatic attendance. No Jitsi backend was introduced.
- The existing SQL authorization suites verify tenant boundaries, enrollment expiry/revocation, owner protection, grading/release rules and scoped media. Their success does not establish current deployed provider configuration or a complete penetration test.

## Executed verification

All browser tests below use actual React components in Chromium with **synthetic local identity/API adapters**, unless explicitly described as production Next. They do not establish real Firebase authentication, remote uploads, push delivery or email delivery.

| Check | Actual result |
| --- | --- |
| Complete application suite | 467 passed, 0 failed |
| Architecture boundary checks | Passed |
| Explicit strict TypeScript, isolated application project, no incremental cache | Passed |
| Lint | 0 errors; 9 existing warnings (hook dependencies and image optimization) |
| Firebase/Supabase production build | Passed using ignored isolated output and existing local build configuration |
| Clerk/Prisma fallback production build | Passed using separate ignored output |
| Disposable native PostgreSQL | Full replay of 31 migrations; all 23 SQL suites passed; independent-session concurrency suites passed; owned test database dropped and cluster stopped |
| Registration/class-access Chromium | 12 groups passed: verification-failure recovery, restored sessions, class-link continuation, duplicates, revoked/expired/rejected access, logout, desktop/mobile and language/theme matrix; mocked Firebase SDK only |
| Settings / Notifications Chromium | 21 groups passed, including existing account editor, seven preference pairs, save/reload errors, feed/read/pagination, bell/drawer, push-registration adapter, hidden stage selector and Clerk delegation |
| Appearance Chromium | 24 groups passed: SSR/hydration, light/dark/system, contrast, dialogs, actual title and Quill editors, teacher/exam/homework/support layouts, storage errors and browser restart |
| Language Chromium | 24 groups passed: Arabic/English, RTL, mobile drawer/bell, actual exam cards/support dialog, mixed authored text, theme independence and restart |
| Groups Chromium | 12 groups passed: teacher/assistant/student views, two selected students with successive versions, validation, stale writes, attendance/finalization, retry, online/center and mobile |
| Continue Learning component/native playback Chromium | 13 groups passed: saved playback position, completion, errors, access/incomplete states, desktop/mobile and restart |
| PDF/image annotation Chromium | 4 groups passed: real PDF.js worker/page 2 and normalized PDF/image annotation overlays at 1440px and 390px; local synthetic save callback |
| Production Next 15 App Router resume acceptance | **NOT reliably passing.** One complete 11-group candidate run passed; repeated runs failed at cached Back or a late save followed by mobile navigation, leaving Continue Learning loading. A baseline comparison also passed once. Neither a single baseline pass nor the successful candidate run proves absence of a race. See blocker below. |

The first check attempt lacked the already installed auxiliary `web-push` dependency in module resolution; rerunning with the existing dependency runtime passed. No dependencies or lockfiles were changed. Standalone harness failures caused by old table/native-select/carousel selectors were corrected against the approved UI, retaining behavioral assertions.

Production Next diagnostics showed that the old harness could click the next link before its prior destination had committed. The harness now waits for the destination URL. That correction improves the test, but a repeated run still failed, so it is **not** claimed to resolve the loading race. Experimental delays, prefetch changes, router replacements and diagnostic instrumentation were removed from application code. No global refresh/polling workaround was shipped. Failed-run evidence stays in ignored local logs; a stale successful results JSON must not be mistaken for the outcome of the repeat run.

### Coverage limits

No connected Firebase/Supabase writes, identities, fixtures or Storage objects were created. Real-provider acceptance was not executed: the current onboarding checkpoint requires separate authorization for connected identities/provider writes, and no suitable current authorized account pair was established for this candidate. No provider cleanup was therefore necessary. Existing historical provider acceptance does not validate this commit.

Unit/service/SQL coverage includes course edits/publication, upload validation, homework creation/grading, timed exam/retry/release, roster/invitation authorization, notification/support isolation and stale writes. This assignment did **not** execute a new real authenticated end-to-end teacher-creates-course → student-takes-exam/homework workflow, nor live upload persistence or live email/push delivery. The synthetic gallery tests actual title/Quill editing, but is not evidence of hosted course publication persistence. Firefox/WebKit, device playback, assistive-technology and production load tests were not run.

## Backend request classification

| Handoff request | Classification / pilot impact |
| --- | --- |
| 1. Program/stage writes for organization teachers/assistants | **Needed later / conditional pilot requirement.** Owners/admins already manage taxonomy. Broadening other roles requires an explicitly approved additive authorization migration and role-matrix/concurrency tests. No permission change made. Owner-led pilot can use current permissions. If assistants must edit taxonomy in this pilot, this becomes a required owner decision and implementation gate. |
| 1. Standard-stage creation button | Existing identity-bound stage commands are reused; owner/admin can use it. Automatic seeding/backfill is **optional enhancement**, not required and not performed. |
| 2. Roster emails, signup date, group names, submission counts | **Needed later** for richer roster display. Email disclosure needs a deliberate tenant-scoped privacy decision; current roster/request approval works without these columns. |
| 2. Assigned-student metric | **Optional enhancement**; do not fabricate a number. |
| 2. Organization waitlist switch, off by default | **Needed later / conditional pilot product gate.** Hiding a zero-count card is not a backend disabled feature. Existing explicit access requests still require authorized approval and do not grant academic access on registration. If selling an off-by-default add-on at pilot, implement the actual switch separately before promising it. |
| 2. Bulk approval/rejection | **Optional enhancement**; individual decisions remain supported. |
| 3. Group meeting URL isolation | **Required for pilot; existing RLS/RPC protections retained and local authorization suites pass.** Must also be exercised in the candidate's eventual live authenticated acceptance. No anonymous/group-outsider grant added. |
| 3. List member counts, schedules and next-session projection | **Needed later** performance/data enrichment. Current next-session lookups are bounded and use existing authorized queries; not a batched list projection. |
| 3. Atomic bulk add (up to 100), exact eligible semantics | **Optional backend enhancement.** Current sequential UI now respects returned versions; capacity/tenant checks remain authoritative. Eligible students can include a transfer candidate rather than exclusively students with no prior group; UI/backend retain existing semantics. |
| 3. Assistant create/edit groups | **Needed later / owner permission decision.** Existing attendance/member reads do not authorize enrollment/group configuration; UI corrected to match. |
| 3. Jitsi host tokens / privacy / attendance / unpublished collaborator implementation | **Deferred explicitly.** Plain links can be used as external links only; secure conferencing needs separate provider/configuration/backend work. No unpublished code imported. |
| 4. Support requester email/name, preview/count and sender role | **Needed later** enrichment; current support thread/assignment flow retained. Email visibility needs scoped disclosure approval. |
| 4. Other users' avatar sharing | **Optional enhancement** requiring a narrow support-specific access model; private avatar policies unchanged. |
| 4. Support attachments | **Optional enhancement / separate feature**; no existing support upload backend invented. |
| 4. Support permissions/provisioning UI for assistants/teachers | Trusted support-staff provisioning already exists. **Required operational setup if those roles will handle pilot tickets;** a new UI and automatic role expansion are **needed later**, not implied by academic role. |
| 5. Platform Admin badge signal | **Optional display enhancement.** A support operator must not implicitly become a global academic admin. |

No additional schema change is inherently required for an owner-led first teacher pilot using current supported workflows. Conditional role/product requirements above need confirmation before being promised.

## Private-staging blockers and next action

1. **Reproduce and fix the intermittent actual Next cached-navigation/late-save loading failure.** Keep proof-based stale-data protection; do not replace it with a client progress cache, fabricated completion, polling or a timing-only workaround. Repeat the complete App Router suite reliably before staging acceptance.
2. Authorize a controlled connected-provider acceptance run for this candidate (or supply suitable existing controlled identities). Test Firebase sign-in/verification/recovery, teacher and student sessions, invitation approval/revocation and the actual academic workflows against the designated development projects. Do not infer permission from old unrelated fixture approvals.
3. Real verification-email delivery remains an external acceptance gate: the historical throttling error is not evidence of a current provider outage, and Admin-verified synthetic accounts cannot establish inbox delivery. Do not change quotas/provider configuration to pass testing.
4. Before hosting, independently verify private-staging secrets/runtime configuration, exact origin/CSRF, HTTPS/domain/Firebase authorized-domain configuration, database-ledger alignment, Storage/media configuration and worker/push scheduling. Build success does not verify those operational prerequisites. No server/DNS/configuration was changed here.
5. Provision pilot owners/support staff through existing trusted workflows; decide whether the conditional assistant taxonomy/group permissions or actual waitlist add-on toggle are needed. Do not reopen self-service organization provisioning.

Recommended next action: review the local candidate, resolve the reproducible navigation race, then authorize scoped real-provider acceptance. Do not merge this candidate to a protected branch or describe it as production-ready yet.

## Local evidence

Ignored logs: `.local/integration-final-check.log`, `.local/integration-final-strict-tsc.log`, `.local/integration-final-build-firebase.log`, `.local/integration-final-build-legacy.log`, `.local/integration-sql.log`, `.local/integration-next-browser.log`, `.local/integration-next-browser-repeat.log`.

Screenshots: `.local/appearance-browser/gallery-dark-1440.png`, `.local/appearance-browser/gallery-light-390.png`, `.local/language-browser/gallery-ar-mobile.png`, `.local/m3-browser/teacher-1440.png`, `.local/m3-browser/teacher-390.png`, `.local/teacher-pdf-browser/`.

These are synthetic component evidence, not provider acceptance. Transient debug/control fixture files remain ignored, contain only synthetic loopback data and were never imported into production routes. Generated test processes were stopped; existing user servers were not stopped. No push, deployment, connected migration or remote mutation was performed.
