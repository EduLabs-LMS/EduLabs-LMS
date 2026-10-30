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
  homework, exams, media, lesson segments, website courses, student access links/requests. The message names what it found.
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

Tables the seed may write (the `table_name` check of `private.demo_seed_rows`): `courses`, `course_modules`, `lessons`,
`course_offerings`, `study_groups`, `group_staff`, `group_sessions`, and from seed version 2 (migration
`20261030120000_demo_students.sql`) `profiles`, `enrollments`, `group_memberships`.

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

Real students, homework, exams, results, payments, e-mail and any customer record. The only enrollments in demo data are
the fake demo students above. Demo data is synthetic and is never copied from a real space.
