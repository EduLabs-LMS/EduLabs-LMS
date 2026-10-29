# Teacher UI rebuild contract

## Current boundary
The legacy teacher screens are removed. Neutral teacher routes keep authentication,
resource checks and build integrity while the replacement is designed. There are no
fake metrics, save buttons or fabricated success states. Do not present this scaffold
as a functioning teacher pilot. Student pages retain the approved pre-redesign V2 UI.

## Built so far (owner-approved designs, Firebase staging only; other modes keep the neutral scaffold)
- **Home** (`/home` for staff): next Session, homework (honest "not available yet"), important updates, coming up, one small
  "Courses" link. First visit shows one optional "create your first course" step.
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
  **Archive Group** (course instructor only, asks first). Not built, by decision: Create a Group, Edit Group, Take attendance and the
  per-session screen (Create/Edit need a weekly-times editor and offering choice; attendance is its own task), reschedule/restore and
  student add/remove/transfer. Teacher words only: Course, Chapter, Lesson, Group, Session, Students.

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
