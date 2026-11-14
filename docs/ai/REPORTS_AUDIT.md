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
- **No "lesson covered by a session".** A session does not record the lesson it covered, so there is no Pace line (homework belongs to the run, not a Group, so it would read the same for every Group). "Pace per Group" and the teacher marking the lesson per session are deferred until after V1 (own decisions first).
- **Attendance `not_marked`** is neither present nor absent: those rows are left out of the count and of the total.
- **Which homework is "given".** The rule students are held to (`private.homework_enrolled`): the homework is published, its lesson is published, its segment (if any) is published, and the course is published. Homework in a draft lesson is invisible to students and counts for nobody. Open homework (not handed in and the deadline is ahead or there is none) is not counted yet: it is left out of the percentage and of "missing" and is listed as "Open". Given = handed in or deadline passed.
- **Per-Group online exams.** A student in no Group can take them (window = earliest opening to last closing, `private.exam_student_window`), so a no-show is Absent after the last close. A result with no final attempt, or whose attempt names a Group with no window, is kept at the exam's last window.
- **Marks not yet given** (waiting for marks) are not counted in any percentage; they show as "Waiting for marks".

## Counting rules (DECISIONS.md, "Reports")

- The default range is the last 28 Cairo days (rolling, up to the start of tomorrow); a month is a Cairo calendar month; "Whole course" is everything. The Groups list and the Needs attention list always use the last 4 weeks. Migration `20261118120000_reports_last_4_weeks.sql` replaces `report_bounds`, `report_reasons` and `report_reason_count`.
- Attendance % = present / sessions that have a saved attendance list. Homework % = handed in / given (missing counts against). Exams % = marks / maximum for marked exams.
- Needs attention: 2 or more missed sessions in the range, or 2 or more homework missing, or exams under 50%, or absent from an exam (up to 3 listed). Fixed for V1; teacher-editable thresholds are deferred.
- Order: worst first (the lowest of the three percentages, then by name).

## Authorization

Every function is `security definer`, `search_path = ''`, resolves the caller with `private.current_app_user_id()`, and is read-only. The public wrappers are `security invoker`, granted to `authenticated` only. Owners, instructors and a run's assistants may read Group, student and attention reports; course Results also allow a course editor. Students, other spaces and callers with no profile get SQLSTATE 42501 (the routes answer 403). Lists are capped (25 per attention page, 200 per student list, 1 to 100 Group ids per read), one query per screen.
