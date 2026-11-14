# Reports audit (branch `claude/reports`)

Written before the migration. Draft migration: `supabase/migrations/20261117120000_reports.sql` (read-only, not applied). Tests: `supabase/tests/reports.sql`, `reports-scale.sql`, `reports-demo.sql`.

## What the reports read (no table or column is added)

| Need | Source |
| --- | --- |
| Groups, their course run, their students over time | `study_groups`, `group_memberships` (`starts_at`, `ends_at`), `enrollments`, `course_offerings`, `courses` |
| Sessions and attendance | `group_sessions`, `session_attendance` |
| Homework given and handed in | `homework_assignments` (one family per assignment, `status = 'published'`), `homework_questions`, `homework_submissions` |
| Exams | the exam tables of the exams migrations (marked, waiting, absent, online or paper) |
| Chapters and lessons | `course_modules` (`chapter_number`, `position`), `lessons` (`module_id`) |
| Names | `profiles` |
| Who may read | `private.current_app_user_id()`, `private.is_active_user()`, `private.can_support_offering()`, `private.can_edit_course()` |

## How the Group "at the time" is found

Homework and exams carry no Group. The Group of a student for an item is the Group whose `group_memberships` row covers the item's reference time (`starts_at <= ref < ends_at`), where the reference time is the deadline, or the exam time. A session already has its Group. A student with no membership at that time counts under **No Group**. Reference times in the future are clamped to now so a future item never picks a future membership.

## Gaps found and how they were handled

- **No Group on homework.** Derived from memberships (above).
- **No stored publish time on homework.** `created_at` is used when there is no deadline.
- **Online exam no-shows.** Counted as Absent, like a paper exam marked absent.
- **No "lesson covered by a session".** A session does not record the lesson it covered. The Pace line therefore says how far the course content goes (the furthest lesson with published homework) and how many homework were given. A teacher marking the lesson per session is deferred until after V1 (own decisions first).
- **Marks not yet given** (waiting for marks) are not counted in any percentage; they show as "Waiting for marks".

## Counting rules (DECISIONS.md, "Reports")

- A month is a Cairo calendar month. "Whole course" is everything.
- Attendance % = present / sessions that have a saved attendance list. Homework % = handed in / given (missing counts against). Exams % = marks / maximum for marked exams.
- Needs attention: attendance under 75%, or 2 or more homework missing, or exams under 50%, or absent from an exam (up to 3 listed). Fixed for V1; teacher-editable thresholds are deferred.
- Order: worst first (the lowest of the three percentages, then by name).

## Authorization

Every function is `security definer`, `search_path = ''`, resolves the caller with `private.current_app_user_id()`, and is read-only. The public wrappers are `security invoker`, granted to `authenticated` only. Owners, instructors and a run's assistants may read Group, student and attention reports; course Results also allow a course editor. Students, other spaces and callers with no profile get SQLSTATE 42501 (the routes answer 403). Lists are capped (25 per attention page, 200 per student list, 1 to 100 Group ids per read), one query per screen.
