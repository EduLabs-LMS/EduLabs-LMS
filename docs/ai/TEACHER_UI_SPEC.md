# Teacher UI rebuild contract

## Current boundary
The legacy teacher screens are removed. Neutral teacher routes keep authentication,
resource checks and build integrity while the replacement is designed. There are no
fake metrics, save buttons or fabricated success states. Do not present this scaffold
as a functioning teacher pilot. Student pages retain the approved pre-redesign V2 UI.

## Built so far (owner-approved designs, Firebase staging only; other modes keep the neutral scaffold)
- **Logo** (teacher sidebar, the phone header and the logo at the top of the phone menu): mark + "EduLabs" wordmark in the brand font (`font-display`, Caprasimo) + "Learning Platform" line, built once in `frontend/components/brand-logo.tsx`. For active staff the whole logo is ONE link to Home (`teacherHomeHref`, the same href as the Home menu item) with an aria-label ("EduLabs, learning platform. Go to Home"), a 44px+ target and a visible focus ring; it plays the existing loading screen like any link. Students get the same markup without a link.
- **Home (`claude/design-v2-foundation`, replaces the older Home text below where they differ):** greeting with date and "N sessions today"; summary tiles for active Groups and students (no attendance tile: no read exists); the Happening now card with progress ring, time, place and student count, Take attendance and Open group (Attendance taken and Edit when finished), or the next session with a countdown line when nothing is live; Needs attention (unsaved attendance, waiting join requests with Review); Coming up (date tiles, a countdown line, each row opens its Group); Updates with See all. Same order stacked on a phone.
- **Home** (`/home` for staff): next Session (buttons: Open this Group, and Take attendance once it has started; no "All sessions" button), important updates, coming up. **No Homework card yet**: "Homework to correct" was always "not available yet" and is removed until the Homework screen exists; it returns on Home with the Homework build (see V1.md). **Home no longer shows courses** (no "Your courses" block, no "Create a course" header button): courses live in Settings > Courses, which is unchanged. First visit still shows one optional "create your first course" step. Attendance on Home, with no new section: once the next Session has started and is not cancelled its card label becomes "HAPPENING NOW" and a light outlined "Take attendance" button sits below "Open this Group" (phone) or beside it (desktop). Finished Sessions whose attendance is not finalized (the same rule as the Group card's "attendance not saved" line: the latest finished Session of each Group, read from the existing per-Group `sessions` view for up to 10 Groups) appear at the top of Coming up: date, Group, "attendance not saved" and a yellow "Finish" button, at most 3; with none, Home looks as before. Tour targets: `next-session`, `take-attendance`, `unsaved-attendance`. There was no tour; the owner has now decided on one (below, "Helper (decided, not built)"), which runs automatically on the first sign-in starting here.
- **Frame and menu (`claude/design-v2-foundation`, replaces the six-item menu, the phone drawer and the profile footer below; see DECISIONS.md, "Design foundation"):** `frontend/features/teacher-frame/`. Desktop: sidebar flush to the edge, 240 px, logo, Home, Groups, Students, Courses; at the bottom Notifications with the unread count, Settings, and a profile row opening Settings, Help and Sign out. Homework, Exams and Reports are shown with a "Soon" tag, not links, until they are built (DECISIONS.md, "Owner feedback on the New look"). Phone: 56 px header with logo and bell, bottom tabs Home, Groups, Students, More (Courses, Homework, Exams, Reports with their Soon tags, Settings, Help, Sign out), no tabs on Attendance, one line of footer. Courses list: `/teacher/courses`. Settings is inside the main shell with its own tabs in the content area. Two looks: Classic and New, chosen in Settings > Language and appearance.
- **Menu** (sidebar and phone drawer, active staff only), exactly six items from the one array `teacherNav` in
  `shared/teacher-home.ts`: Home, Students, Groups & Classes, Homework, Exams, Reports. Courses and Settings are not menu items.
  **Coming soon rule:** an item whose screen does not exist yet has `href: null` and renders as a disabled item
  (`aria-disabled="true"`, not a link, with a "Coming soon" pill), never as a link to an unavailable page. Reports is the only one today.
  Legacy paths such as `/teacher/analytics` are not allowed through the Firebase-staging middleware.
- **Profile footer** (bottom of the menu): photo, name, e-mail from the existing account profile, and a cog link
  (`aria-label` "Settings") to `/teacher/settings`. Support stays as its own small entry above it; sign-out lives in My account.
- **Course page** (`/teacher/settings/courses/<course id>`, inside the Settings frame; Courses stays active in the sidebar and the phone back arrow goes to the list): title, education system and grade (read from the existing classification endpoint, with its own error and retry), the short description when there is one, Draft or Published, and Publish / Unpublish. Publishing asks first ("Publish \"<title>\"? Students you invite will be able to see it.") and sends the version the page read to the existing `PATCH /api/teacher/courses/<id>`; a change made elsewhere gets "changed somewhere else, reload" with a Reload button and nothing is overwritten; a lost reply says it could not confirm and offers Reload. The database decides who may publish (owner or admin of the space, or course staff owner, instructor or editor); the page only hides the button for others. There is no minimum-content rule in the database, so none is shown. The space is named under the title only when the teacher has more than one. Below it, the Content section (see "Course content tree").
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
  **Archive Group** (course instructor only, asks first). **Create a Group** (`/teacher/groups/new`, from the list header and the empty
  state): name, course, at a centre or online, location or join link, one or more weekly times, optional capacity; opens the new Group.
  **Edit Group** (Details tab, instructor of an active Group): same fields, sends the version it read; a change elsewhere says so and offers Reload.
  Removing a weekly time warns that its upcoming Sessions are cancelled; unchanged times are not sent. A changed place moves upcoming weekly Sessions.
  **Students tab**: add from students who already have access to the course (search, 25 a page, several in a row), remove asks first and keeps
  attendance and course access. Only staff of an active Group see these. Not built: reschedule/restore and moving a student between Groups (transfer).
  Giving a student access still comes from enrollment and access links. Teacher words only: Course, Chapter, Lesson, Group, Session, Students.
- **Students** (`/teacher/students`, `/teacher/students/<student id>?course=<run id>`, branch `claude/students-screen`, awaiting owner approval). Rows, not boxed
  cards: name, course, Group(s) and a status pill (Active, Suspended, Expired, Completed, Cancelled, Invited). Search by name, filter by course and status
  ("Waiting" points at Join requests), 25 at a time across courses in name order with "Load more students". **Join requests** appear at the top only while someone
  waits: Approve (optionally "Approve into a Group": that course's active Groups or "No Group yet"; if the Group step fails: "Approved, but not added to the Group.
  Add them from the Group page." and nothing is retried or undone) or Reject (asks for a short reason). Teachers who only support a course see no buttons.
  **Student page**: status, course, Groups, attendance (date, Group, Present/Absent) and Suspend/Reactivate with confirmation; no grades or homework.
  **Invite students** (button here and in an empty Group's Students tab): only published courses can be chosen (a draft is shown disabled with "Publish this course before inviting students" and an "Open course" link to that course's page; the client also refuses to ask for a link to a draft): pick a course and how long (default 7 days), Create link, the link is shown once
  with Copy and Share (the phone's share sheet; no WhatsApp address, because that would put the secret in a URL), active links below with Revoke.
  Every section has its own error with Retry; 48px targets; English and Arabic (RTL); dark theme. Tour targets: `invite-students`, `student-filters`,
  `student-rows`, `join-requests`, `invite-panel`, `create-link`, `student-access`, `student-groups`, `student-attendance`.

- **Attendance trust (branch `claude/attendance-trust`, supersedes the details above where they differ):** the title is the class title and date (no "Session N"; Latin text is isolated inside Arabic with `bdi dir=auto`). "All present" is now **"Mark the rest present"** (Arabic "تسجيل الباقين حاضرين") and changes only students still not marked; an existing mark is never overwritten. Students are in Arabic-aware alphabetical order (the same collation as the Group's Students tab, ties by id); above 15 students a search box appears (name only, accents and case ignored). A tap sends the marks at once as ONE keepalive request (the reply's Session version replaces the second `view` call); the line says Saving, Saved, "Couldn't save. Trying again…" or "Couldn't save. Retry"; failures retry by themselves (1, 2, 4, 8, 15 s, five times) before asking for Retry. While a save is pending the browser warns before reload or closing, and an in-app question (Stay / Leave anyway) guards links, the menu, the logo and Back. After a reload that interrupted a save the page shows the server's state, says "Checking your last change…", and re-reads until the save lands, then notes that the page shows what is saved now. "Edit attendance" scrolls the reason field into view and focuses it; finished results are flat labels (no border, shadow, fill or button shape). The "?" Helper button is hidden everywhere until the Helper is built (the `data-tour` targets stay). Home: a finished class with unsaved attendance says **Take attendance** (no "Finish"); up to 3 of the newest unsaved classes across all Groups are listed (a Group can show more than one); during a live class **Take attendance is the primary dark button, first**, and Open this Group the secondary one, on phone and desktop. Dark mode keeps the yellow buttons at WCAG AA (dark text).
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

## Update 2026-11-06: the component system

Every teacher screen is built on `frontend/components/design` in both looks. Targets are 44 px and the minimum text is 12 px; where this file says 48 px or 16 px, this replaces it. Invite students is its own page at `/teacher/students/invite`, reached from the Students header and an empty Group's Students tab. See "Every teacher screen on the component system" in DECISIONS.md.

## Course content tree (built on `claude/course-content`)

Boards `Main` and `Content-Phone`. On `/teacher/settings/courses/<id>`, a Content section replaces the "Lessons" note: chapters and lessons in order, Chapter N from the stored number and lessons N.1, N.2 from their order, never their position (positions may have gaps), collapsible; add a chapter; add a lesson inline (Add, Cancel; "Add the first lesson" in an empty chapter); rename; delete with a confirmation, and a refusal in plain words; drag on desktop plus Move up, Move down and Move to another chapter in each row's menu; a bottom sheet with the same actions and no drag on a phone; each lesson shows its homework or "No homework"; a small Draft pill; a change made elsewhere says so and offers Reload. A lesson may move to any chapter of its course. A refused delete says what is inside, from the counts (the wording, in English and Arabic, is in DECISIONS.md). On an archived course (`archived: true` from the read) the content shows read-only, with a short line saying why. The chapter label comes from the stored type and number, so it matches the student's. Lesson content is not in scope. Not built until draft migration `20261106130000` is reviewed and applied on dev (DECISIONS.md, "Course content tree").

How it is built: `frontend/features/teacher-course/content-section.tsx`, on the design components in both looks. Reading and writing go through one route, `/api/teacher/courses/<id>/content`. A reorder shows at once and goes back on any failure, so the screen never keeps an order the server refused. Create, rename, delete and move to another chapter wait for the server. One write at a time; each reply carries a fresh read, so the next write has the current versions. A refusal, a stale write or a failure is said at the row or form where it happened, and what was typed stays. Dragging moves nothing on screen (the row dims and a line shows where it lands), so reduced motion and Arabic need no special case. The arrow keys on the handle do the same as dragging. Focus stays on the row that changed; after a delete it goes to the neighbouring row. The Delete in the menu is off, but still reachable by keyboard, with the reason under it whenever the read has `deleteBlockers`. Assistants (`canEdit: false`, not archived) see the same list with no edit controls and a line saying so. The phone starts with only the first chapter open.

## Homework and course content (decided, not built)

Boards: `docs/design/homework-content/`. Build with the design components in both looks, not by copying board markup. The rules are in DECISIONS.md, "Homework and course content"; this is the screen shape.

- **File system:** Course > Chapter > Lesson. Homework belongs to exactly one Lesson. Exams belong to the course (later).
- **Homework tab (portal):** stats (essays to correct, corrected, handed in, on time), a To correct list, Open / Closed / Drafts, and "New homework".
- **New homework:** a 4-step wizard like the platform admin's provision form: Details, Questions, Rules, Solutions, then Review. One question on screen at a time. Question types: Multiple choice (auto-graded, including "textbook" questions with letters only) and Essay (text box, plus one photo per question, max 5 MB, if the per-homework switch allows photos). Every homework has a deadline.
- **Correcting:** one student at a time with Save and next. Student photos are shown, never edited or drawn on; the annotation feature is not used in the UI.
- **Assistants:** correct and release are per-assistant permissions, on by default; the switches come with the assistants screen.
- **Not in scope for now:** the student side, which must keep working.

## Homework screens, part 1 (built on `claude/homework-ui`, awaiting owner approval)

Routes: `/teacher/homework` (the page), `/teacher/homework/new` (`?course=<id>` preselects a course the teacher may edit) and
`/teacher/homework/<id>` (the wizard on one homework). Exact paths in `middleware.ts`, no referrer, private no-store. Both looks,
English and Arabic, phone first. Screenshots: `docs/design/screenshots/homework-ui/` (list in its README).

- **Menu:** Homework is a real item after Courses on the desktop menu and in the phone More sheet; it no longer says Soon.
- **Page:** this week's numbers (essays to correct, corrected, handed in, on time %), the week Saturday to Friday in Cairo as the
  database gives it; To correct (essays only) where Correct is shown but off (`aria-disabled`, "Correcting comes in the next
  update"); Open / Closed / Drafts with counts and paging (25 a page, Previous/Next only when there is somewhere to go); a course
  filter when there is more than one course; "+ New homework" only for a teacher who can edit a course. On a phone the numbers are
  2 by 2 and "All homework" opens the list. Empty, loading, error (Try again) and signed-out states.
- **Row menu:** Edit; Change deadline (questions homework, not drafts); Publish or Unpublish; Delete images (Closed tab, managers of
  that run; shows the image space; off with "No images" when there are none). Each action reads the homework first for its
  revision (the page read has none) and sends it unchanged.
- **Change deadline:** a Cairo date and time, which must be in the future (checked on screen and again by the database), and "Allow
  after the deadline". The note: "Students who already saw the solutions keep them and get no more tries." It changes the date for
  everyone without a new version.
- **Delete images:** confirms that grades and notes are kept; sends only `{ confirm: true }`.
- **Wizard:** Details (title, course, lesson grouped by chapter; a draft lesson is allowed with "Students see it when this lesson is
  published" and Publish lesson for an editor; optional instructions), Questions (Choice / Essay, marks stepper, add, remove,
  reorder from the question menu (an off item says why inside it: "Move up (already first)"), a choice starts with four blank
  answers A to D (A to H, 2 to 8; Arabic أ to ح), texts optional; blank answers show as a row of letters, any text as a list; the
  teacher taps every right answer and the type follows (one: "Choose the right answer", more: "Choose every right answer"), a
  picture per question through the existing upload flow once the draft exists, model answer text and picture for an essay, an explanation and picture for a choice),
  Rules ("How students answer": the photo answers switch for the whole homework, a one-line note when off; Cairo deadline, late allowed, One time / Fix mistakes / From zero with 2 to 10 tries), Solutions (when they open with the plain
  rule, solution text, an optional video or PDF), Review (a summary with Edit links, then Publish, which needs a deadline, or Save
  as draft). A draft saves itself a moment after typing ("Draft saved"); a save that finds it changed keeps what was typed and offers
  Reload. A saved homework is offered only the courses of its own teaching space. Course and lesson stay editable until a student starts or for a later version (then `aria-disabled` with "A student has
  started this homework, so it stays in this lesson."); another course clears the lesson and nothing saves until one is picked; a
  move refused because a student started meanwhile keeps what was typed and offers Reload. Rows show "N questions · M marks". Homework that students started says that saving makes a new version and points to
  Change deadline for a new date. Every off control is `aria-disabled` with its reason; no native checkbox; 44 px targets.
- **Content section:** Publish lesson (a draft lesson, at once) and Unpublish lesson (asks first: "Students won't see this lesson or
  its homework until you publish it again. Their answers and grades are kept."). On the phone sheet Move up, Move down and Move to
  another chapter are off with their reason ("Already the first lesson", "Already the last lesson", "No other chapter").
- **Not in part 1:** correcting, the Home card, the student side, Preview as student, the assistants' switches.

## Homework screens, part 2 (built on `claude/homework-correct`, awaiting owner approval)

Boards `Correct-Desktop` and `Correct-Phone` in `docs/design/homework-content/`; Home board in `docs/design/teacher-ui-v2/`.

- **Correcting** (`/teacher/homework/<id>/correct`, opened by Correct on the Homework page and by the Home card; `?try=<id>` opens one
  student). Tabs To correct / Done / Missing from `homework_queue` with the try number and Late. One student at a time: the choice
  summary (right or wrong per question with the letters A to H, Arabic letters in Arabic), each essay's text and photo exactly as
  sent (nothing drawn on it; a deleted photo says "Image deleted to free space"), a mark stepper 0 to the question's points and a note
  per essay, one overall note, Save and Save and next student. Kept answers say so and are not editable. A released grade changes
  only with a reason of three letters or more, and saving takes it back until it is released again. A change made elsewhere keeps
  what the teacher typed and offers Reload. Release grade per student; "Release N grades" sends the queue's list exactly, all or
  nothing, and explains a refusal plainly. Buttons follow `canGrade` / `canRelease` from `get_homework` (aria-disabled with the
  reason); the database decides. Photos open through the existing signed-media route (five-minute links).
- **Routes** (same pattern as the other teacher Homework routes: sign-in, origin, body cap, strict zod, no client user id, exact
  middleware paths): `GET /api/teacher/homework/<id>/queue?tab=&page=`, `GET|POST /api/teacher/homework/<id>/tries/<submissionId>`
  (grade or release), `POST /api/teacher/homework/<id>/release-many`.
- **Home card "Homework to correct"**: up to five homework with essays waiting (title, course, count), each one tap to its
  correcting screen, plus All homework. Hidden when nothing waits; a failed read shows the section error.
- **Student side** (plain existing styles): the lesson page by lesson id; the homework shows its deadline (Cairo), tries left,
  "Missed the deadline" on a late hand-in, "Try again" (the database's retry), kept answers locked, and "Your tries ended when the
  deadline changed". Refusals are said plainly in English and Arabic ("The deadline has passed", "No tries left", changed, already
  handed in, unavailable).

## Reports, spread into existing pages (built on `claude/reports`, awaiting owner approval)

No Reports menu item or page. Existing design components, both looks, light and dark, English and Arabic (RTL), phone first; each section has its own error with Retry and a skeleton that keeps the layout.

- **Groups list:** each card adds "Attendance 91% · Homework 84% · Exams 72%" for the last 4 weeks and a "N need attention" pill when N > 0; a Group with nothing says "No numbers yet". One read for the whole list.
- **Group page:** tabs Sessions · Students · Report · Details (tour `group-report-tab`). Report: range picker (Last 4 weeks by default, then the months, then Whole course; Cairo time), three numbers each with a count under it, "Needs attention · N" (plain-word reason pills, worst first), "Everyone else · N". Rows open the Student page.
- **Students list:** a "Needs attention · N" chip beside the course and status filters (tour `needs-attention-filter`): all Groups and No Group, last 4 weeks, worst first, each row with its Group and reasons, 25 a page.
- **Student page:** keeps status, Groups and Suspend/Reactivate; adds (tour `student-marks`) the month picker, three numbers, the month's sessions as P/A boxes with the day number under each (letters, not colour alone), a Homework list (mark / Missing / Open / Waiting for marks) and an Exams list (score/max, online or paper, Absent).
- **Course page:** a Content / Results switch (tour `course-results-switch`). Results: one card per chapter with a bar and % per Group, "N exams · M homework", a "Weakest" flag, and "No marks yet" for empty chapters.

## Live classes (built on `claude/online-class`, awaiting owner approval)

Only when the meeting server is configured; otherwise nothing below shows and Own link works as before. An EduLabs class is an online Session with no link.

- **Group page, Sessions:** inside the class window (15 minutes before to 30 minutes after) the Session row shows **Start class** (primary) and Take attendance becomes secondary.
- **Home, next session card:** Start class is the primary button while the window is open.
- **Create/Edit Group:** under the online link field: "Leave the link empty to hold the class in EduLabs: no Zoom or Meet needed."
- **Class page `/class/<session>`:** back link to the Group, the title, Group and times; states: opens at (early), Start class with a recording note (staff, not started), the meeting on the page (open), waiting for the teacher (students; asks again by itself), ended, cancelled, not allowed, not available. Leaving shows Rejoin.
- **Take attendance:** a "Joined online" tag next to students who opened the class; joined students still not marked are saved as Present once per visit (never a mark changed, never Finish).
- **Students:** "Join class" on the Group card and the Home next-class card inside the window; the "Your class has started" and "starts soon" notifications open the class page.
