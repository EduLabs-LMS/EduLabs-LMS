# Milestone 1 authenticated acceptance — 18 October 2026

**Recommendation: READY WITH LIMITATIONS for owner integration review.** Real authenticated acceptance is complete; this is not deployment/merge approval or proof of real email delivery.

## Source and environment

- Actual application commit tested: `6637422e0b1ceef24af5cae154961965cb5f4072`, PR #10, `codex/milestone-1-ui-notifications`.
- Actual PR Firebase production build ran only in an isolated local process: HTTPS loopback proxy `https://localhost:3192` → local Next.js port 3191. An older deployed staging site was not substituted.
- Firebase `diagonproduction` and Supabase `gmvouqgjbtbkbhrdruzu` IDs were independently checked against provider metadata, local SDK configuration and the Admin credential project. Their misleading/generic display names were recorded in the earlier preflight. The owner subsequently explicitly designated these exact projects for disposable testing and accepted this development use; no independent production workload was discovered or contacted.
- The exact PR source remained unchanged during acceptance. All acceptance tooling and evidence were Git-ignored. The run directory containing temporary secrets, manifests and raw evidence was restricted to the local account/SYSTEM/Administrators.
- Test run: `e604483e-1d40-4832-bef9-d16a6a7f851c`.

## Authentication method and fixture ownership

Three unique reserved-domain synthetic identities were created with trusted Firebase Admin tooling: tenant-A teacher/owner, tenant-A student, and tenant-B peer/owner/student. Random passwords stayed exclusively in the protected local manifest. These specific accounts were created with `emailVerified=true` under the owner's explicit test-fixture authorization. No ordinary-user verification safeguard was changed.

All three then used the real browser email/password sign-in UI, Firebase token issuance, normal application claim provisioning, HttpOnly Secure server-session cookie and verified Firebase-to-Supabase onboarding. No custom privileged session or fake identity mapping was inserted. Organization plus initial active owner were provisioned atomically through the existing trusted operator procedure. Teacher/student enrollment used real recipient-bound invitations and acceptance; direct first-time enrollment was correctly rejected by existing policy before the harness switched to that proper workflow.

**NOT TESTED:** registration-email delivery, inbox receipt and real verification-link consumption. Admin-verified fixture accounts do not prove these. The previously documented email throttle/delivery trial gate remains unresolved by this work.

## Actual authenticated results

The final evidence contains **16 passing authenticated check groups, zero unresolved failures**, plus real staff/student empty-Exams checks captured before exam fixtures were created.

| Area | Actual result |
| --- | --- |
| Identity and badges | PASS: real teacher/owner login displays contextual STAFF; enrolled student displays STUDENT |
| Teacher operations | PASS: teacher course-management view and authorized course title update |
| Enrollment and group fixtures | PASS: authorized invitation creation/acceptance, unique enrollments, actual group creation and membership through the application |
| Tenant isolation | PASS: student reads its authorized course; foreign course is absent under RLS; student and tenant-A teacher cannot edit unauthorized content |
| Recipient isolation | PASS: real notification sets are disjoint; teacher cannot see student notices; student cannot query peer notices or mark them read; forged recipient field is rejected |
| Preview | PASS: account-area popover displays at most five genuine unread records, correct count, timestamps and links; opening does not mark anything read |
| Read/count updates | PASS: full-page Mark read updates database and badge; Mark all as read produces a genuine zero-unread preview |
| Error/retry | PASS: removing only the test browser's cookie causes a real server 401 and explicit preview error, not a false empty list; restoring the same legitimate session and Retry reloads real data |
| Loading | PASS: controlled local request delay shows loading and resolves to real authenticated API data; no fabricated notification payload used |
| Mobile | PASS: actual application at 390px and 360px; drawer, unclipped preview, Escape/focus restoration, outside interaction, authorized resource links and closing both layers; no horizontal overflow |
| Desktop | PASS: actual preview, keyboard/focus, outside dismissal and permitted navigation |
| Exams list/detail | PASS: student sees published exam/quiz, teacher sees its staff overview and draft; student cannot access draft or tenant-B state endpoints |
| Exams empty states | PASS: distinct real student and staff empty states before authoring fixtures |
| Retry restrictions | PASS: unanswered first attempt enters pending decision; direct second attempt is denied; explicit View my final mark permanently declines retry |
| Marks and answers | PASS: pending result endpoint denied; direct score/max_score and correct-option column reads denied; no pending mark in rendered UI. Explicit finalization legitimately releases the objective-only mark; correct-answer review stays locked |
| Logout | PASS: actual mobile Sign out removes server cookie, protected routes redirect, notification/exam endpoints reject, refresh does not restore access and captured old-cookie replay returns 401; teacher session remains valid |
| Direct post-logout REST | PASS: old student token cannot read its prior notification records (HTTP 200, zero rows) |
| Other sessions | PASS: teacher/peer sign out independently; no pre-existing account was used or revoked |

A privileged read of only the two run-owned attempts confirmed the distinction: the finalized objective attempt legitimately had score 0/1 released by the student's finalization choice, while the separate pending-decision attempt remained unreleased with no final score. No grading/retry/release rule was changed to satisfy a test.

## Error coverage and testing limits

Real notification error/retry was exercised through cookie loss and restored authentication; loading used transport delay with real responses. Those are controlled test conditions, not claims of a naturally occurring provider outage.

A genuine upstream Firebase Exams-list failure was **not induced**: doing so would require unrelated provider/service disruption. The current-route retry callback, safe server-error rendering, and legacy failure-versus-empty distinction remain covered by the automated/component regressions, not misreported as a real authenticated upstream-outage test. The originally vague Exams loading issue was not reproduced in healthy authenticated navigation.

Test harness corrections were required for asynchronous loading waits, cancelled delayed requests, a resumed-script variable, the exact button label, and the expected objective finalization policy. These did not require application changes. A desktop coordinate click was replaced by an actionable outside element after the preview finished loading; the resulting real outside-dismiss test passed. Raw diagnostic failures are retained privately, rather than described as application defects.

Chromium desktop/mobile viewport checks are not physical-device, Firefox/WebKit, accessibility-certification or load testing. Existing staff Exams copy still states authoring/grading is unavailable despite working controls; this inherited message predates Milestone 1 and was not rewritten during acceptance. Existing dependency/deployment limitations remain in the prerequisite reports.

## Exact fixture reconciliation

The private manifest and ownership-scoped database inventory recorded resource IDs before cleanup. Main resources created and removed:

| Resource | Created | Remaining after cleanup |
| --- | ---: | ---: |
| Firebase identities | 3 | 0 |
| LMS profiles / verified external mappings | 3 / 3 | 0 / 0 |
| Organizations / active owner memberships | 2 / 2 | 0 / 0 |
| Courses / offerings / enrollments | 2 / 2 / 2 | 0 / 0 / 0 |
| Modules / lessons / lesson segments | 2 / 7 / 7 | 0 / 0 / 0 |
| Study groups / memberships | 2 / 2 | 0 / 0 |
| Assessments / offering assessments | 5 / 5 | 0 / 0 |
| Questions / options | 5 / 10 | 0 / 0 |
| Attempts / participation records | 2 / 2 | 0 / 0 |
| Notification events / recipient records | 10 / 10 | 0 / 0 |
| Private invitation links | 3 | 0 |
| Storage uploads/objects | 0 | 0 |

Associated run-owned staff entries, audit/command records, grading outcomes and dependent rows were removed in guarded dependency order. No rows were deleted merely because a name looked synthetic. Ownership checks required the exact manifest organization IDs/slugs, created_by identities, verified external mappings and absence of foreign members/media/homework.

Cleanup was prepared before account creation and first rehearsed with no fixtures. The populated rollback rehearsal found the expected circular final-attempt foreign key; the run-owned participation/final-attempt references were cleared in the same guarded cleanup transaction before deletion. The revised populated rehearsal passed, then cleanup committed. No trigger, constraint, RLS or grant was disabled.

Final before/after reconciliation:

- **102 tables:** original row fingerprints, RLS flags and ACLs restored; zero differences.
- **191 functions / 108 policies:** definitions and privileges unchanged.
- **25 migrations:** exact history unchanged; no migration applied.
- **LMS profiles:** 9 before → 9 after; Firebase mappings: 2 → 2.
- **Pre-existing Firebase identities:** 3 before → 3 after, identical sanitized fingerprints. All three manifest-owned test UIDs independently confirmed absent.
- Synthetic sessions revoked; all test browser contexts and loopback server/proxy processes stopped.
- Temporary passwords and raw invitation tokens removed from the manifest; all three stored cookie/IndexedDB state files deleted. The owner's protected Admin file and original environment configuration were preserved.
- Immutable provider audit logs, usage counters and service metadata may retain synthetic test activity; literal erasure of provider audit history is neither claimed nor attempted.

## Evidence and checks

Private raw evidence remains under `E:/EduLabs-Milestone1/.local/milestone1/authorized-run/`, outside Git:

- `student-preview-desktop.png`, `student-preview-mobile-390.png`, `student-preview-mobile-360.png`.
- `student-exams-desktop.png`, `teacher-exams-desktop.png`, `student-pending-exam.png`.
- `student-empty-exams.png`, `teacher-empty-exams.png`.
- `acceptance-results.json`, `revoked-rest.json`, `database-reconciliation.json`, `firebase-reconciliation.json`, sanitized ownership manifest and inventory.

After cleanup, 36 focused milestone/communications/Exams-foundation tests passed. The unchanged tested application commit already has 205 passing application tests, TypeScript/lint/architecture and both production builds from implementation verification; those full suites/builds were not needlessly repeated in this acceptance-only task. Seven pre-existing lint warnings remain.

## Integration recommendation

Milestone 1 is **READY WITH LIMITATIONS for owner review**, with real authenticated functionality and cleanup verified. The remaining email-delivery, upstream-outage reproduction, cross-browser/device and inherited-copy limits above must not be presented as passed.

Review/integrate the existing dependency chain in order: PR #8 → PR #9 → PR #10. Their current stacked bases require deliberate owner review before any later retarget/integration. No merge, retarget, staging/production deployment, DNS/provider change, RLS change, permanent migration, main modification or Milestone 2 work occurred. This sanitized report is the only new repository file; acceptance tooling and sensitive evidence remain ignored.
