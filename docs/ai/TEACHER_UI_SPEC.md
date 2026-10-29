# Teacher UI rebuild contract

## Current boundary
The legacy teacher screens are removed. Neutral teacher routes keep authentication,
resource checks and build integrity while the replacement is designed. There are no
fake metrics, save buttons or fabricated success states. Do not present this scaffold
as a functioning teacher pilot. Student pages retain the approved pre-redesign V2 UI.

## Built so far (owner-approved designs, Firebase staging only; other modes keep the neutral scaffold)
- **Home** (`/home` for staff): next Session, homework (honest "not available yet"), important updates, coming up, one small
  "Courses" link. First visit shows one optional "create your first course" step. There was no tour; the owner has now decided on one (below, "Helper
  (decided, not built)"), which runs automatically on the first sign-in starting here, so that earlier "no tour" position no longer applies
  to the first Home visit.
- **Menu** (sidebar and phone drawer, active staff only), exactly six items from the one array `teacherNav` in
  `shared/teacher-home.ts`: Home, Students, Groups & Classes, Homework, Exams, Reports. Courses and Settings are not menu items.
  **Coming soon rule:** an item whose screen does not exist yet has `href: null` and renders as a disabled item
  (`aria-disabled="true"`, not a link, with a "Coming soon" pill), never as a link to an unavailable page. Reports is the only one today.
  Legacy paths such as `/teacher/analytics` are not allowed through the Firebase-staging middleware.
- **Profile footer** (bottom of the menu): photo, name, e-mail from the existing account profile, and a cog link
  (`aria-label` "Settings") to `/teacher/settings`. Support stays as its own small entry above it; sign-out lives in My account.
- **Settings** (`/teacher/settings`, own frame outside the main teacher layout): sections My account, Courses, Language and
  appearance, Notifications, all from the one array `teacherSettingsSections` (`shared/teacher-settings.ts`). Desktop: a "Settings"
  sidebar with "Back to EduLabs", content max 880px, the root redirects to the first section. Phone: a list; each section is a page
  with a back arrow. Courses is the course list moved here (`/teacher/courses` redirects; course editors stay). Language/appearance
  reuse the student components unchanged. Notifications links to the existing `/notifications` preferences screen. A new section is one
  array entry plus a page, and its exact path must be added to `middleware.ts` (a test keeps the two in step).
- **Groups & Classes** (`/teacher/groups`, `/teacher/groups/<id>`): a list of the teacher's Groups (Active/Archived with counts, search;
  each card shows course, At a centre/Online, next Session, weekly times, students and, only when the last finished Session has no saved
  attendance, a yellow "not saved" line) and one Group with Sessions (upcoming, earlier, "See older sessions"), Students and Details tabs
  and a side panel on desktop. Everything is read through the existing `POST /api/study-groups`; the database decides what is visible.
  Buttons that exist: **Add a Session** (one-off, Cairo date and time), **Cancel session** (upcoming only, asks first),
  **Archive Group** (course instructor only, asks first). Not built, by decision: Create a Group and Edit Group
  (they need a weekly-times editor and offering choice), reschedule/restore and
  student add/remove/transfer. Teacher words only: Course, Chapter, Lesson, Group, Session, Students.

- **Take attendance** (`/teacher/groups/<groupId>/attendance/<sessionId>`, branch `claude/teacher-attendance`, awaiting owner approval): opened from
  "Attendance" on a started Session row, or from the Group card's "Attendance ... not saved" line. Title "Attendance · Session N" (N is left out
  when the Session list is too long to count), subtitle with Cairo date, time and place, a quiet outlined "?" in the title row (it does nothing yet,
  and says so; the walkthrough is not built, and the phone header-bar placement belongs to the shared header and comes with the Helper). Status bar
  Not saved yet / Finalized / Reopened (draft / finalized / reopened) with Present, Absent and Not marked counts. One row per student with Present and
  Absent only (attended / absent / not marked; no late or excused); Mark everyone present; Save draft (sends only what changed, at most 100 marks a
  call, re-reading the Session version after each); Finalize attendance (asks first, warns about unmarked students, instructor only); a finalized
  list is locked and shows Reopen (instructor only, asks for a reason). Reopened behaves as a draft. Everything uses the existing
  `POST /api/study-groups` commands `view`, `attendance`, `finalize` and `reopen`; no new endpoint, migration or permission. Phone: rows, not
  boxed cards; Save draft and Finalize fixed at the bottom; 48px targets. Tour targets are marked with `data-tour` (help, status-bar, mark-all,
  student-rows, save-actions). Reading a Session's list makes the database take the dated list of students (an existing behaviour of `view`).
  Demo data: a demo space has no students in its Groups, so there is nothing to mark and no seed change; Clear already removes attendance rows.

## Helper (decided, not built)
A spotlight tour: the page is dimmed, the explained part stays bright, the page scrolls to it, and a small box beside it shows a
title, one or two plain lines, "Step N of M", Back and Next (Done on the last step). Skip is visible on every step; Escape closes it.
On phone the box sits at the bottom of the screen and never covers the highlighted part. In Arabic the layout mirrors and Back/Next
swap sides. It runs automatically the first time a new teacher signs in, starting on Home (the menu, the main parts of Home, the "?"
button). Every teacher page has a quiet outlined "?" button in its header (top right of the title row on desktop; beside the menu
button in the header bar on phone) that starts the tour for that page only. Settings > My account gets "Show the walkthrough again"
(design pending). Tour steps are written per page after the final screens exist, in English and Arabic, in teacher words only. Each
step points at a real element, so **every new screen marks its tour targets**. Open: where the "seen" flag is stored (preferred per
teacher in the database; that needs a migration and owner approval first). Stored Helper data must extend the demo seed or be excluded
with a reason. See V1.md.

### Helper animation (owner decision): soft, never harsh
- The dim fades in over about 250 ms, in a soft dark green (not black).
- The spotlight glides between targets over about 350 ms, ease-out, with a rounded cut-out and a thin green outline.
- The page scrolls smoothly to the target before the step box appears.
- The step box fades in with an 8 px slide up over about 200 ms. On a step change the text cross-fades and the box does not jump.
  Progress dots fill softly. The first-run welcome card fades in.
- Never: confetti, bounce, sparkle, looping or pulsing animation, a sudden brightness change, or auto-advancing a step.
- `prefers-reduced-motion`: plain fades only, no movement.
- RTL mirrors the slide directions.
- Animate with transform and opacity only.

## Calm phone rule (owner decision)
Phone screens follow the calm style of the phone One Group design: list rows instead of boxed cards, one main action, generous
spacing, and touch targets of 48 px or more. This applies to every teacher screen built from now on.

## Screens to rebuild incrementally, after owner approval
1. Teacher course list/dashboard and navigation.
2. Course/module/lesson/part authoring, ordering, media, draft/publication and preview.
3. Program/stage management and course classification within the same organization.
4. Student requests/invitations/enrollment administration.
5. Groups, schedules, rosters and attendance/corrections.
6. Homework authoring/correction/PDF annotations and exam authoring/grading/release.
7. Teacher website/catalog/domain administration, using existing contracts.

Reuse existing APIs and server services; do not invent endpoints, numbers or provider
capabilities. Read the relevant shared/contracts, service and SQL tests before a view.
Unknown/failed data is not an empty result. Surface 401/403, stale-write 409, validation
and retryable failure states. Respect supplied versions and capacity; bulk operations
are not atomic unless the backend explicitly guarantees it.

## Permission rules
Owners/admins manage taxonomy under existing rules. Teachers/assistants only have
existing contextual course/offering permissions; broadening them needs separate backend
approval. Keep last-owner protection and trusted/manual tenant provisioning. Staff
badges/navigation are never grants. Do not restore self-service organization creation.

## Shared behavior preserved
Student course access, direct lesson routes, playback/resources, progress/resume,
exam attempts/results/retry, homework submission/history, groups/join links/own attendance,
Notifications/push, account editing/Settings, English/Arabic/RTL and appearance stay.
Shared support flows and their technical-operator controls remain a separate feature.
The hidden student stage selector must remain hidden, with no hidden requests.

## First proposed Claude assignment
After explicit handoff approval: implement only the teacher course-list/navigation
screen using existing authorized data, with empty/error/loading and mobile states.
Preserve neutral editor routes until separately assigned. Do not import the friend's
redesign, revive deleted screens, expand permissions or begin Jitsi/email work.
