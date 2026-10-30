# Teacher UI rebuild contract

## Current boundary
The legacy teacher screens are removed. Neutral teacher routes keep authentication,
resource checks and build integrity while the replacement is designed. There are no
fake metrics, save buttons or fabricated success states. Do not present this scaffold
as a functioning teacher pilot. Student pages retain the approved pre-redesign V2 UI.

## Built so far (owner-approved designs, Firebase staging only; other modes keep the neutral scaffold)
- **Logo** (teacher sidebar, the phone header and the logo at the top of the phone menu): mark + "EduLabs" wordmark in the brand font (`font-display`, Caprasimo) + "Learning Platform" line, built once in `frontend/components/brand-logo.tsx`. For active staff the whole logo is ONE link to Home (`teacherHomeHref`, the same href as the Home menu item) with an aria-label ("EduLabs, learning platform. Go to Home"), a 44px+ target and a visible focus ring; it plays the existing loading screen like any link. Students get the same markup without a link.
- **Home** (`/home` for staff): next Session (buttons: Open this Group, and Take attendance once it has started; no "All sessions" button), important updates, coming up. **No Homework card yet**: "Homework to correct" was always "not available yet" and is removed until the Homework screen exists; it returns on Home with the Homework build (see V1.md). **Home no longer shows courses** (no "Your courses" block, no "Create a course" header button): courses live in Settings > Courses, which is unchanged. First visit still shows one optional "create your first course" step. Attendance on Home, with no new section: once the next Session has started and is not cancelled its card label becomes "HAPPENING NOW" and a light outlined "Take attendance" button sits below "Open this Group" (phone) or beside it (desktop). Finished Sessions whose attendance is not finalized (the same rule as the Group card's "attendance not saved" line: the latest finished Session of each Group, read from the existing per-Group `sessions` view for up to 10 Groups) appear at the top of Coming up: date, Group, "attendance not saved" and a yellow "Finish" button, at most 3; with none, Home looks as before. Tour targets: `next-session`, `take-attendance`, `unsaved-attendance`. There was no tour; the owner has now decided on one (below, "Helper (decided, not built)"), which runs automatically on the first sign-in starting here.
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

- **Take attendance** (`/teacher/groups/<groupId>/attendance/<sessionId>`, branch `claude/attendance-simple`, awaiting owner approval; replaces the first build). Calm and flat, no boxed cards and no status bar. Header bar: back, "?" (does nothing yet and says so). Title "Session N · <session title>" (just the Session name when N cannot be counted), date/time/place line, ONE counts line ("11 present · 2 absent · 1 not marked") with an "All present" text link beside it, then plain rows with thin dividers: student name left, Present and Absent pills right (the chosen one filled green or red; pressing it again takes it back to not marked). One fixed bottom button "Finish attendance" with a small "Saved as you tap" line. There is no Save draft: **every tap saves by itself** through the existing `attendance` command, one call after another (a queue), each with the Session version read after the previous save; the line says Saving, Saved or "Couldn't save." with Retry; marks stay on screen until saved and nothing is dropped; Finish is disabled while a save is pending or failed. Finish asks first and warns about unmarked students (instructor only). **Finished view = the same screen, read-only:** the same rows in the same positions showing only the result (green Present, red Absent, "Not marked" in plain text), counts line "Finished · 12 present · 2 absent", and an outlined "Edit attendance" button with "Editing asks for a short reason" (the existing reopen, reason of 3+ characters, instructor only). Reopened behaves as a draft. Opened from Home (Take attendance, Finish), from the Group card's "not saved" line, and by tapping a started, not cancelled Session row on the Group page. Everything uses the existing `POST /api/study-groups` commands `view`, `attendance`, `finalize` and `reopen`; no new endpoint, migration or permission. 48 px targets. Tour targets: `help`, `status-bar` (counts line), `mark-all` (All present), `student-rows`, `save-actions` (bottom button). Reading a Session's list makes the database take the dated list of students (existing behaviour of `view`). Demo data: from demo seed version 2 a demo space has 14 fake students per Group and four past Sessions (a finalized and a draft one per Group); Clear removes them.

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
