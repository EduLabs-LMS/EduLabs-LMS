# Backend audit: fix list before V1

The single list of everything the backend audit found that must be fixed, or explicitly accepted, before V1. Every part appends its
findings here when it finishes. IDs are `A<part>-<nn>`, numbered as in the part's report. V1 needs every High and Medium fixed and
verified. A Low or Note is either fixed or marked "won't fix" by the owner, with the reason (docs/ai/V1.md, checklist row
"Backend audit").

Status values: `open`, `fixed in <commit>`, `verified` (the fix's proof was re-run), `won't fix: <why>` (owner only).

| ID | Severity | Title | Part | Needs owner decision | Fix | Status | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0-01 | High | A student opening a lesson costs seconds of database time | 0 → 2a | no | Authorize once per statement instead of once per row, and read only the opened lesson | open. Part 2a, 60-lesson course: student lesson page 11.5 s (one statement 7.8 s, near the hosted 8 s limit), Home 2.1 s; prototype 0.43 s / 0.29 s with identical rows ([2a](PART-2a-content.md#re-measured-a0-01-the-student-lesson-read-high)) | [PART-0 §1](PART-0-map-and-locks.md#1-high--performance-a-student-opening-a-lesson-costs-seconds-of-database-time-per-row-rls-helpers) |
| A0-02 | High | A course editor can delete a whole course with one direct database call | 0 → 2a | yes: which direct table writes may the app keep? | Revoke `delete` on `courses` and direct writes on content tables; keep writes behind the audited functions | open. Confirmed on dev. Full grant list and app use in [2a](PART-2a-content.md#detailed-a0-02-every-direct-table-write-on-content-high): the app uses only the course PATCH; a course with a run cannot be deleted (foreign key) | [PART-0 §2](PART-0-map-and-locks.md#2-high--security-a-course-editor-can-delete-a-whole-course-with-its-chapters-lessons-and-blocks-by-a-plain-table-delete) |
| A0-03 | Medium | A student choosing a stage locks the whole teaching space | 0 → 2b | no | Take the space row `FOR KEY SHARE`; use `FOR NO KEY UPDATE` where a lock is needed | open | [PART-0 §3](PART-0-map-and-locks.md#3-medium--lock-a-student-choosing-a-stage-locks-the-whole-space) |
| A0-04 | Medium | Every attendance save locks the whole course run | 0 → 4 | no | Lock the run only for membership changes, `FOR NO KEY UPDATE` | open | [PART-0 §4](PART-0-map-and-locks.md#4-medium--lock-every-attendance-save-locks-the-whole-run-every-group-of-the-course-run) |
| A0-05 | Medium | Every lesson, part or block save locks the whole course | 0 → 2a | no | Lock the course only for structural actions; lock just the row for item edits | open. Part 2a: a save holds it ~1 ms on a warm connection; the issue is scope. The fix must lock the parent row instead (A2a-09) | [PART-0 §5](PART-0-map-and-locks.md#5-medium--lock-every-lesson-part-or-block-save-locks-the-whole-course) |
| A0-06 | Medium | No lock or query time limit is set in our code; the platform limits leave two paths unbounded | 0 | yes: approve function-level `lock_timeout` | Put `set lock_timeout = '3s'` on functions that lock shared rows; bound the service-role worker; map 55P03 to "busy, try again" | open (see facts below) | [PART-0 §6](PART-0-map-and-locks.md#6-medium--lock-no-lock-timeout-or-statement-timeout-is-set-anywhere) |
| A0-07 | Medium | A lesson-progress save costs about 23 ms of database CPU | 0 → 2a | no | Replace `can_view_segment` in `save_segment_progress` with a lesson-published check (the function already checks enrollment, run and part) | open. Part 2a: 20.6 ms, of which 17.7 ms is `can_view_segment`; the replacement costs 0.3 ms, so ~3 ms per save ([2a](PART-2a-content.md#detailed-a0-07-the-progress-save-medium)) | [PART-0 §7](PART-0-map-and-locks.md#7-medium--performance-a-lesson-progress-save-costs-about-23-ms-of-database-cpu) |
| A0-08 | Low | A student's stage pick fails if a teacher is saving a lesson or taking attendance at that moment | 0 → 2b | no | Lock the run and course rows `FOR KEY SHARE`, or not at all | open | [PART-0 §8](PART-0-map-and-locks.md#8-low--correctness-a-students-stage-pick-fails-if-a-teacher-is-saving-a-lesson-or-taking-attendance-at-that-moment) |
| A0-09 | Low | Renaming a live exam pauses every student's answer save for about 14 ms | 0 → 6a | no | Accept (explicit save only); or lock the exam `FOR NO KEY UPDATE` for detail-only saves | open | [PART-0 §9](PART-0-map-and-locks.md#9-low--lock-renaming-a-live-exam-makes-every-students-answer-save-in-it-wait) |
| A0-10 | Low | A direct `enrollments` update reverses the lock order of `student_administration` | 0 → 3 | no | Removed by the A0-02 fix (no direct enrollment writes) | open | [PART-0 §10](PART-0-map-and-locks.md#10-low--lock-order-a-direct-enrollments-update-reverses-student_administrations-order) |
| A0-11 | Note | Token issuers are hard-coded and every environment trusts the same Firebase project | 0 → 1 | yes: separate Firebase projects per environment, or accept one? | Owner decision; then either a per-environment issuer setting or a recorded "intended" | open | [PART-0 §11](PART-0-map-and-locks.md#11-note--security-trusted-token-issuers-are-hard-coded-and-every-environment-trusts-the-same-firebase-project) |
| A0-12 | Note | Local tests ran in Cairo time; hosted Supabase runs in UTC | 0 | yes: approve the test-server change | Start the test server with `-c timezone=UTC` | open | [PART-0 §12](PART-0-map-and-locks.md#12-note--testing-the-local-test-server-runs-in-cairo-time-hosted-supabase-runs-in-utc) |
| A0-13 | Note | Two exam systems are both live | 0 → 6b | yes: can the legacy exam system be retired? | Part 6b lists what still calls it | open | [PART-0 §13](PART-0-map-and-locks.md#13-note--cleanup-two-exam-systems-are-both-live) |
| A0-14 | Note | `is_enrolled` uses `now()`; the other checks use `clock_timestamp()` | 0 | no | Use `clock_timestamp()` when the helper is next touched | open | [PART-0 §14](PART-0-map-and-locks.md#14-note--correctness-is_enrolled-uses-now-the-other-checks-use-clock_timestamp) |
| A2a-01 | Medium | A course becomes unavailable to every student once 50 lessons hold more than 500 blocks; the message says "unpublished or expired" | 2a | no | Read only the opened lesson's blocks (A0-01 fix, part 2); never report size as unavailability | open | [PART-2a A2a-01](PART-2a-content.md#a2a-01-medium-correctness) |
| A2a-02 | Medium | A course editor can read another course's private file in the same space by pointing a block at it; their students can too | 2a | no | Revoke direct block writes (A0-02); the block trigger must require this course's upload scope or `can_view_media` | open | [PART-2a A2a-02](PART-2a-content.md#a2a-02-medium-security) |
| A2a-03 | Low | A student can mark any lesson completed directly; the teacher then cannot delete it | 2a | no | Revoke direct `lesson_progress` writes (no caller) | open | [PART-2a A2a-03](PART-2a-content.md#a2a-03-low-integrity) |
| A2a-04 | Low | A course editor's direct block writes skip every editing rule (5 MB block proven, any type, any video URL) | 2a | no | Revoke direct block writes (no caller) | open | [PART-2a A2a-04](PART-2a-content.md#a2a-04-low-integrity) |
| A2a-05 | Low | A course editor can publish, archive and un-archive the course | 2a | yes: who may publish or archive, and is archive reversible? | Enforce the owner's rule in the database (an RPC for status) | open | [PART-2a A2a-05](PART-2a-content.md#a2a-05-low-owner-decision) |
| A2a-06 | Low | Content of an archived course can still be changed through `edit_learning_content` | 2a | no | Refuse archived courses at the top of `edit_learning_content` | open | [PART-2a A2a-06](PART-2a-content.md#a2a-06-low-correctness) |
| A2a-07 | Low | `edit_learning_content` locks the course before it checks the caller (a student's call waited 1.5 s on a teacher save) | 2a | no | Check `can_edit_course` first, then lock | open | [PART-2a A2a-07](PART-2a-content.md#a2a-07-low-lock) |
| A2a-08 | Low | Each progress save holds the lesson part `FOR SHARE`, so a teacher's part save waits on student saves | 2a | no | `FOR KEY SHARE` | open | [PART-2a A2a-08](PART-2a-content.md#a2a-08-low-lock) |
| A2a-09 | Note | The A0-05 fix must lock the parent row for `create_*`, `reorder_*` and `move_lesson` | 2a | no | Lock the chapter (for lessons) or the lesson (for parts) `FOR NO KEY UPDATE` | open | [PART-2a A2a-09](PART-2a-content.md#a2a-09-note-for-the-a0-05-fix) |
| A2a-10 | Note | `edit_module_details` requires a chapter type and number that a trigger always overwrites | 2a | no | Drop the two fields from the action and the contract | open | [PART-2a A2a-10](PART-2a-content.md#a2a-10-note-dead-input) |
| A2a-11 | Note | `complete_media_upload` can be called directly, skipping the server's file-signature check (teachers only) | 2a | yes: accept, or mark ready only through a trusted path? | Owner decision | open | [PART-2a A2a-11](PART-2a-content.md#a2a-11-note-upload-validation) |
| A2a-12 | Note | Dead code keeps live grants (`lms.ts` `updateProgress` and `registerMedia`; legacy `/api/courses/*`) | 2a → 9 | no | Remove in the Part 9 cleanup | open | [PART-2a A2a-12](PART-2a-content.md#a2a-12-note-dead-code-with-live-grants-part-9) |

## Totals (open, by severity)

| Severity | Open | IDs |
| --- | --- | --- |
| High | 2 | A0-01, A0-02 |
| Medium | 7 | A0-03, A0-04, A0-05, A0-06, A0-07, A2a-01, A2a-02 |
| Low | 9 | A0-08, A0-09, A0-10, A2a-03 to A2a-08 |
| Note | 8 | A0-11 to A0-14, A2a-09 to A2a-12 |
| **All** | **26** | none fixed yet |

## Facts from the connected Supabase project (checked from the owner's chat, 2026-11-16)

Not checked by the audit itself; recorded as the owner reported them.

- PostgreSQL 17.11. Non-inlined SQL functions are planned on every call, as on the local PostgreSQL 17.10 used for the measurements;
  plan caching for SQL functions arrived only in PostgreSQL 18.
- Role `authenticated`: `statement_timeout=8s`. Role `authenticator`: `statement_timeout=8s`, `lock_timeout=8s`. Role `anon`:
  `statement_timeout=3s`. Role `service_role`: no timeouts. `idle_in_transaction_session_timeout=0`.
- `TimeZone` is UTC. `max_connections` is 60.
- On dev, `public.courses` has the policy `courses_delete USING private.can_edit_course(id)`, and `authenticated` has `DELETE` on it.
  A0-02 is confirmed on the real project.

**A0-06 updated with these facts.** The 8 s limits on `authenticated` and `authenticator` cap how long an API call can wait on a lock or
run, so an API request cannot wait forever. Two paths are still unbounded:

1. **`service_role`**: the push worker (`scripts/notification-dispatch.cjs`) and storage maintenance have no time limit. A worker call
   stuck behind a lock waits indefinitely and keeps its connection.
2. **An open transaction that does nothing**: `idle_in_transaction_session_timeout=0`. Someone who runs `begin; update ...` in the
   Supabase SQL editor and leaves the tab open holds that row until the session ends.

While a lock is held like that, every API call that needs the row waits its full 8 s and then fails. Up to 60 connections are shared
by everything, so a burst of such calls can still exhaust the pool. The fix stays: a short function-level `lock_timeout` on the
functions that lock shared rows, so a busy row fails fast with "busy, try again" instead of holding a connection for 8 s.

The same limit matters for reads: Part 2a measured one student read statement at 7.8 s locally (A0-01). On the hosted project such a
statement is close to being cancelled by the 8 s `statement_timeout`.
