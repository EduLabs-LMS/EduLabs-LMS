# Follow-up 2: "View as student" for teacher-side roles

Status: implemented and unit/static-tested. NOT yet run against a live Firebase/Supabase stack, NOT type-checked or linted (see "Not verified"). No commit was made (the upload had no `.git`).

## What it is
A look-only student preview at `/preview/**`, reachable from a "View as student" button (sidebar, mobile menu, course list header). A sticky bar says "Student preview — nothing you do here is saved" with a one-tap "Back to teacher view".

## Approach (approved option A)
The real student *rendering* is reused: `SecureLessonPage` (-> `LessonTabs`, `SecureLessonPlayer`) and `SelfLearningView`. The student page loader could not be reused unchanged because it requires the viewer's own active enrollment; relaxing that would be an authorization change, so preview has its own read-only loader that calls the same `learningService` tree (same published-only filters) and `v2Chapters`.
No change to: API routes, DB/RLS/migrations, authentication, middleware logic, student pages.

## Preview mode enforcement (defence in depth)
1. Route-based, not stored: `/preview/**` only. No cookie, flag or role switch; leaving the area ends it.
2. Server gate: `requireStudentPreview()` -> 404 unless Firebase mode and `isTeacherSideContext`. Students, platform roles (owner/admin) get 404. Course pages also need course/offering staff capability.
3. Same session, same RLS as the teacher's normal pages. No enrollment is created or faked. The backend still sees the teacher.
4. Preview code paths do not call progress, homework, exam, attendance, enrollment or statistics code (static test).
5. `SecureLessonPlayer` runs with `preview:true`: no save/complete, no progress POST, no buttons.
6. Homework is replaced by a static note. Exams are not linked.
7. `PreviewGuard` (browser): all non-GET requests are refused with 403 unless on a small allowlist that records nothing about students (lesson media URL signing, Firebase session refresh, the teacher's own personalization/notifications). `sendBeacon` is disabled.

## Draft / published
Only published courses are listed; an unpublished course shows "not published, students cannot see it yet". Within a course, only published lessons and published parts appear (parts inside a draft lesson do not). A note says how many unpublished items are hidden. Enrollment dates/expiry are not simulated (the teacher has no enrollment).

## Files
New: `shared/student-preview.ts`, `server/services/student-preview.ts`, `frontend/features/preview/{preview-bar,preview-guard}.tsx`, `app/(dashboard)/(routes)/preview/{layout,page}.tsx`, `.../preview/[courseId]/page.tsx`, `.../[courseId]/chapters/[chapterId]/page.tsx`, `scripts/student-preview.test.cjs`.
Changed: `app/(dashboard)/_components/secure-lesson-page.tsx` (optional `preview` flag; student behaviour unchanged), `shared/v2-learning-model.ts` (optional `previewBase`), `shared/website-routes.ts` (allowlist: 3 preview URL shapes only — **security-relevant, please review**), `frontend/components/sidebar.tsx`, `frontend/features/teacher/courses/course-list.tsx`, `frontend/locales/{en,ar}.ts`, `package.json` (test lists).

## Tests (`node --test scripts/student-preview.test.cjs`: 12/12 pass)
Write requests refused (progress, homework, exams, groups, uploads, cross-origin, PUT/PATCH/DELETE, path tricks); blocked writes never reach the network and are not faked as success; preview data drops drafts and ignores progress; student `v2Chapters` output unchanged; server gate and no role/tenant/cookie/service-role code; no write paths in preview files; real student lesson route unchanged; toggle only under `teacherSide`; route allowlist exact; EN/AR strings with matching placeholders; bar is RTL/touch safe.

## Not verified (needs your environment)
- `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, and the other suites: `node_modules` is not installed here. Existing suites fail identically before and after my change.
- No live run: the toggle, signed media URLs for staff, and preview of real data were not exercised.
- No screenshots (LTR/RTL, light/dark, mobile/desktop). They need the running app.
- No push / remote SHA: upload has no `.git`, no network.

## Known limits
- The legacy Clerk/Prisma path has no preview (Firebase/Supabase path only).
- Teacher-side `assistant` legacy role is unchanged from follow-up 1.
- The lesson page's own "Back to Home" link leaves preview.
- Homework is a note, not a rendered read-only form.
