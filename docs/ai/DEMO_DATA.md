# Demo data (seed registry)

A platform administrator can mark a provisioned teaching space as a **demo space** and fill it with clearly labelled
synthetic data, then clear exactly that data again. Migration: `supabase/migrations/20261027120000_demo_spaces.sql`.
Admin UI: the "Demo space" checkbox when creating a teacher and the Demo section of a teacher portal page. The teacher sees
a "Demo space" label on Home only while the database confirms it.

How it works, in short:

- `private.demo_spaces` is the registry. A space is demo only while it has a row there. A space with enrolled **real** students
  can never be a demo space, and demo data is never added to one. "Real" means an enrollment that is not recorded in
  `private.demo_seed_rows`: the demo students below are recorded, so they never count (`private.space_has_real_students`).
- Every row the fill creates is recorded in `private.demo_seed_rows` (table name and row id). Clear starts from the recorded
  courses and Groups and removes them **and everything a teacher added inside them**: Sessions, weekly times, members and staff
  of those Groups, other Groups and offerings under the recorded courses, chapters, lessons and lesson blocks, stage assignments,
  and the notifications, audit and attendance rows that hang off them. It never matches by name or content and never touches a
  course, offering or Group that does not belong to a recorded course/Group of that one space. (Migration
  `20261029120000_demo_clear_robust.sql` replaced `private.demo_clear_core`; migration 34 is unchanged. Before it, a Session added by
  a teacher was not recorded and its foreign key made the whole Clear fail.)
- Clear refuses (and removes nothing) when the space has any enrollment that is not a recorded demo enrollment, and when the
  space holds content Clear does not remove:
  homework from real people (a try by anyone who is not a recorded demo student), homework files (a stored object under a
  homework of the space: SQL never deletes a storage object), exams, media, lesson segments, website courses, and what a real
  person did with student access (see "Clear and the Students screen"). The message names what it found. From seed version 5
  Clear removes the homework of the space's courses and offerings (the seeded ones and the ones the teacher added) instead of
  refusing any homework; see "Demo homework".
  `removedRows` counts every removed content row, added ones included (lesson blocks and staff rows removed by cascade are not
  counted); the audit row also holds `removedSupportRows` and `removedByTable`.
- The seed version is one integer for the whole seed. The current value is stored when a space is filled, so the admin page
  can tell when a space holds older sample data.

## Seed table

One row per (teacher feature, seed module, seed version). A module that gains data in a later version adds a new row; the
highest version in this table is the **latest seed version**.

| Teacher feature | Seed module | Seed version | What it creates |
| --- | --- | --- | --- |
| Courses, Chapters, Lessons | `courses` | 1 | 2 Courses (1 published, 1 draft), 3 Chapters, 5 Lessons (published and draft), 1 offering |
| Groups and Sessions | `groups` | 1 | 2 Groups (one at a centre, one online) with the teacher as staff, 5 upcoming Sessions (1 cancelled) |
| Students | `students` | 2 | 28 fake students, 14 per Group: a profile ("Demo Student 1" to "Demo Student 28"), an active enrollment (source `demo`) and an open Group membership each |
| Attendance | `attendance` | 2 | 4 past Sessions, 2 per Group: one finalized (about a quarter of the students absent, every student marked) and one still a draft (8 of 14 marked, 6 not yet). Their attendance rows are removed with the Session |
| Home Updates and Notifications | `notifications` | 3 | 5 notifications for the space's teacher, one per event type that can reach a teacher (see below) |
| Course content tree | `courses` | 4 | The same 3 Chapters and 5 Lessons, now the tree on the board: in the published course 3, 2 and 0 lessons, named as on the board. The draft course has no chapters. |
| Homework | `homework` | 5 | 4 questions-only homework in the published Physics course, for its whole offering: a draft, an open one, and two closed ones, with 58 tries by the demo students (waiting, corrected, released, late, a second try with a kept answer) and 20 photo rows with no stored file (see "Demo homework") |

Tables the seed may write (the `table_name` check of `private.demo_seed_rows`): `courses`, `course_modules`, `lessons`,
`course_offerings`, `study_groups`, `group_staff`, `group_sessions`, and from seed version 2 (migration
`20261030120000_demo_students.sql`) `profiles`, `enrollments`, `group_memberships`, and from seed version 5 (draft migration
`20261109120000_homework_teacher_rules.sql`) `homework_assignments`, `homework_questions`, `homework_options`, `homework_keys`,
`homework_solutions`, `homework_submissions`, `homework_responses`, `homework_marks`, `homework_corrections`, `homework_uploads`,
`homework_submission_files`. (`homework_carried`, the kept answers of a try, has a two-column key; it is removed with its tries.)

## The content tree (seed version 4)

- Draft migration `20261106130000_course_content_tree.sql` (not applied anywhere) replaces `demo_fill_core` and `platform_demo_status`. `demo_clear_core` is not replaced: it starts from the recorded courses, so chapters and lessons the teacher added, renamed, moved or deleted need nothing new (`supabase/tests/course-content-tree.sql` proves it). No table or allowed-table list changes.
- The published course has Electric current (Ohm's law, Resistors in series and parallel, Kirchhoff's laws), Magnetism (Magnetic field of a wire, Force on a wire) and Electromagnetic induction (empty). The first lesson of a chapter is published and the others are drafts. The draft course has no chapters, so the empty Content section can be tried.
- Chapters are Chapter 1, 2 and 3: the type and number come from the database trigger, like a chapter a teacher adds. A chapter the teacher adds, moves or deletes keeps the numbers right, and Clear works on an archived demo course.
- Up to seed version 4 demo data held no homework, so every lesson said "No homework". From seed version 5 three lessons of
  the published course have homework (two on Ohm's law, one each on Kirchhoff's laws and Magnetic field of a wire), so the
  board's homework pills and the delete blockers can be tried. Resistors in series and parallel, and Force on a wire, have none.
- A space filled at an earlier seed version is not upgraded in place. To get the tree: Clear, then Fill again.

## Demo homework (seed version 5, draft migration `20261109120000_homework_teacher_rules.sql`, not applied anywhere)

All four are questions-only homework (`workflow` `questions`) in the published Physics course, for its one offering (the whole
course; the lesson is where it shows). Each has three questions: a question with blank answers A to D (B is right), a choice
question, and an essay (6 points, text and one photo). Deadlines are 20:00 Cairo time.

| Homework | Lesson | State | Rules | Tries |
| --- | --- | --- | --- | --- |
| Kirchhoff's laws practice | Kirchhoff's laws | Draft, deadline in 7 days | From zero, 3 tries, solutions after the deadline | none |
| Ohm's law: practice set | Ohm's law | Open, deadline in 4 days | Late allowed, fix mistakes, 2 tries, solutions after the deadline | students 1 to 10: 1 to 5 waiting, 6 to 8 corrected (not released), 9 released and on try 2 (a draft that kept the right textbook answer), 10 corrected and try 2 waiting |
| Ohm's law: textbook page 34 | Ohm's law | Closed 3 days ago | Late allowed, one time, solutions after hand-in | students 1 to 26 (25 and 26 late), 27 and 28 missing: 1 to 9 waiting, 10 to 21 corrected, 22 to 26 released |
| Magnetic field of a wire | Magnetic field of a wire | Closed 10 days ago | From zero, 2 tries, solutions after the deadline | students 1 to 20, all released, each with a photo |

- **Photos: no real file.** The 20 photos are `homework_uploads` rows (JPEG, 1 to 2 MB) whose path points at no stored object.
  The closed homework's bytes, the storage counts and Delete images can be tried; opening such a photo shows it as unavailable.
  This was chosen over bundling sample images: demo data then never writes to Storage, and Clear stays SQL only.
- Released tries notify their demo student through the existing `homework_released` trigger; Clear removes those
  notifications with the demo students.
- Clear removes every homework of the space's courses and offerings, the ones the teacher added included, in foreign-key
  order, and counts them in `removedByTable.homework`. It refuses, removing nothing, while a try by a real person or a stored
  file under one of those homework exists ("homework from real people", "homework files"). A homework a teacher added with
  photos uploaded is therefore removed only after Delete images and the server's file removal.
- A space filled at an earlier seed version is not upgraded in place. To get the homework: Clear, then Fill again.

## Demo notifications (seed version 3)

- Migration `20261031120000_demo_notifications.sql` (draft, not applied anywhere) replaces `demo_fill_core` and `platform_demo_status` only.
  `demo_clear_core` is unchanged: it already removes every notification event whose key starts with `demo:<org id>:`, with its
  notifications and deliveries. No table or allowed-table list changes, because notifications are removed by that key prefix, not
  recorded in `demo_seed_rows`.
- Five notifications, all for the space's teacher, keyed `demo:<org id>:notification:1` to `:5`: `account_approved` (newest),
  `lesson_published` (points at the first demo lesson), `support_reply` (first demo Group), `exam_released` and
  `homework_released` (second demo Group) Four are unread (Home's "Important updates" lists unread ones); the oldest is read.
- They are inserted directly, never through `private.emit_notification`, so no push delivery is ever queued for them.
- Not seeded: `session_details` and `session_starting` (Online session details, Your online session starts soon). They are only
  "current" for a student who is a member of the Group, never for staff, so a teacher could never see them. There is no event type for a
  cancelled Session, a schedule change or a teaching-space update; adding one needs a notification-system change (a new event type).
- None of the five has a link for a teacher, so the Notifications page shows "resource currently unavailable" under them. That is the
  existing page behaviour for an event without a link.
- A space filled at seed version 1 or 2 is not upgraded in place. To get the notifications: Clear, then Fill again.

## Demo students (seed version 2)

- A demo student is a `public.profiles` row with a plain name ("Demo Student N"), no phone, no avatar and **no sign-in**:
  no authentication account, no linked identity (`private.external_identities`), no organization membership. No token can
  resolve to one, and no real account can ever match one. The `profiles` table has no foreign key to an authentication
  account (dropped by migration `20261010123515`), so none is needed.
- They exist only so Take attendance and the later Students, Homework and Reports screens can be tried without real people.
  The admin portal has no platform-wide user counts or lists, so they appear in none.
- Clear removes the demo students, their enrollments and Group memberships, their attendance rows and their fake profiles
  (plus notifications created for them). It still refuses, naming "enrolled students", when any enrollment that is not a
  recorded demo enrollment exists in the space.
- A space filled at seed version 1 is not upgraded in place. To get the students: Clear, then Fill again.

## Rule: demo data stays current

Any new teacher-facing feature that stores data **must extend the demo seed in the same change**:

1. Add a seed module for it in a new migration (a new `demo_fill_core` that creates the sample rows and records every one
   with `private.demo_track`, and a matching `demo_clear_core` step for anything triggers create, and for any table a teacher can add rows to under the seeded Groups or courses)
   -- a new clear migration replaces the function, it never edits an applied one.
2. Bump the seed version (`'latestSeedVersion'` in `platform_demo_status`, the version stored by the fill) and
   `latestDemoSeedVersion` in `shared/contracts/platform-demo.ts`.
3. Add the new tables to the `table_name` allowed list of `private.demo_seed_rows` in that same migration.
4. Add a row to the table above.

`scripts/demo-spaces.test.cjs` fails when the latest seed version in the SQL, the service constant and this table disagree,
or when the SQL tracks a module or table this document does not list.

## Not in demo data

Real students, homework by real people, stored homework files, exams, results, payments, e-mail and any customer record. The only enrollments in demo data are
the fake demo students above. Demo data is synthetic and is never copied from a real space.

## Clear and the Students screen (draft migration `20261104120000_demo_students_screen.sql`, not applied anywhere)

- A teacher who tries Invite students, Approve or Suspend in a demo space leaves join links, join requests and student-administration audit rows
  behind. Before this migration Clear refused any space that had one, so the Students screen made Clear impossible.
- The migration replaces `private.demo_clear_core` only (same signature and grants, no new objects, seed version stays 3). Clear now:
  - removes, found only through the space's recorded course runs: the join links, the join requests of demo students and the
    `private.student_admin_audit` rows of the space (links, revoke, suspend, reactivate of demo students). Each count goes into the platform
    audit row (`removedByTable.student_access_links`, `.enrollment_requests`, `.student_admin_audit`; the audit rows count as support rows);
  - still refuses, naming it, and removes nothing, when a REAL person is involved: `join requests or invitations from real people` (a request
    from, or an invitation for or claimed by, someone who is not a recorded demo student) and `student administration records of real people`
    (an audit row about someone who is not a recorded demo student). Real enrolled students are still refused first as `enrolled students`;
  - leaves `private.student_admin_commands` (the idempotency record of the teacher's commands) alone.
- The three tables are not append-only: no trigger, rule or grant makes them so (checked in the migrations). Removing the audit rows is
  therefore possible, and the platform audit row is the trace that it happened. Audit immutability is not weakened because there is none to weaken;
  if the owner wants it later, that is a separate decision.
- Tested by `supabase/tests/demo-students-screen.sql` (rolled back, 19 checks) and `scripts/demo-spaces.test.cjs`.

Model answer pictures (`homework_keys.model_image_id`, migration `20261112120000`) are not seeded: demo data never writes Storage,
so a picture row would point at no file. The demo homework keeps `model_image_id` null.
