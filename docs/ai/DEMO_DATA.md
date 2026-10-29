# Demo data (seed registry)

A platform administrator can mark a provisioned teaching space as a **demo space** and fill it with clearly labelled
synthetic data, then clear exactly that data again. Migration: `supabase/migrations/20261027120000_demo_spaces.sql`.
Admin UI: the "Demo space" checkbox when creating a teacher and the Demo section of a teacher portal page. The teacher sees
a "Demo space" label on Home only while the database confirms it.

How it works, in short:

- `private.demo_spaces` is the registry. A space is demo only while it has a row there. A space with enrolled students can
  never be a demo space, and demo data is never added to one.
- Every row the fill creates is recorded in `private.demo_seed_rows` (table name and row id). Clear starts from the recorded
  courses and Groups and removes them **and everything a teacher added inside them**: Sessions, weekly times, members and staff
  of those Groups, other Groups and offerings under the recorded courses, chapters, lessons and lesson blocks, stage assignments,
  and the notifications, audit and attendance rows that hang off them. It never matches by name or content and never touches a
  course, offering or Group that does not belong to a recorded course/Group of that one space. (Migration
  `20261029120000_demo_clear_robust.sql` replaced `private.demo_clear_core`; migration 34 is unchanged. Before it, a Session added by
  a teacher was not recorded and its foreign key made the whole Clear fail.)
- Clear refuses (and removes nothing) when the space has any enrollment, and when the space holds content Clear does not remove:
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

Tables the seed may write (the `table_name` check of `private.demo_seed_rows`): `courses`, `course_modules`, `lessons`,
`course_offerings`, `study_groups`, `group_staff`, `group_sessions`.

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

Students, enrollments, homework, exams, results, payments, e-mail and any customer record. Demo data is synthetic and is
never copied from a real space.
