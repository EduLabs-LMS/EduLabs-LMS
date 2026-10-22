# IMPORTANT FOR TESTING — read fully before doing anything

You are an agentic coder receiving a feature ("View as student" preview for teacher-side roles) that was written
WITHOUT a working toolchain, database, browser, network or git. It is implemented and has 12 passing unit/static
tests, but almost everything that matters in production is UNVERIFIED. Your job: verify it, fix what is broken
inside the allowed scope, produce evidence, commit, push, and verify the remote SHA.

Never claim something passes unless you ran it and saw it pass. Report failures honestly. Do not weaken, delete or
skip any test or guard to make things green.

---------------------------------------------------------------------------------------------------------------
## 0. Hard rules (violating any = stop and report)

1. Branch: `claude/teacher-panel-redesign`. Do not create other branches, do not force-push, do not rewrite history.
2. The small-changes round (follow-up 1) must be committed, pushed and verified BEFORE this feature is committed.
   `project/docs/follow-up-1-teacher-dashboard.md` says item 4 (waitlist on/off) was NOT DONE because no flag existed.
   Check the repo history; if that round is incomplete, STOP and ask the owner. Do not invent it.
3. NO changes to: backend contracts, API route behaviour, database schema/migrations/RLS, authentication, `middleware.ts`
   logic, or the real student pages. Only the allowlist line in `shared/website-routes.ts` was changed (exactly 3 preview URL shapes).
4. If any fix needs a backend/auth change: STOP, write down options, ask the owner. Do not "just do it".
5. Preview must be look-only. Never add any code path that records student data. Never relax `PreviewGuard`'s allowlist
   without stating why and getting approval.
6. Teacher-side only: teachers, assistants, course/offering staff. NOT owner/admin (platform) roles, NOT students.
7. Do not commit `node_modules`, `.env*` secrets, or test artifacts containing real user data/tokens.
8. If a command needs network/credentials you don't have, say exactly which and what is therefore unverified.

---------------------------------------------------------------------------------------------------------------
## 1. Get onto the real repository

The zip has no `.git`. Real repo: https://github.com/EduLabs-LMS/EduLabs-LMS (confirm with the owner).

Option A (preferred): in a clean checkout of the real repo on `claude/teacher-panel-redesign` (after follow-up 1 is
pushed), run `git apply --check student-view-preview.patch` then `git apply student-view-preview.patch`.
If it does not apply cleanly because the real branch moved on, apply by hand using the patch as the guide.
Option B: if the real repo is identical to the original upload, copy `project/` over it. DO NOT do both.

Then confirm with `git status` that ONLY these files changed (18):
```
NEW   shared/student-preview.ts
NEW   server/services/student-preview.ts
NEW   frontend/features/preview/preview-bar.tsx
NEW   frontend/features/preview/preview-guard.tsx
NEW   app/(dashboard)/(routes)/preview/layout.tsx
NEW   app/(dashboard)/(routes)/preview/page.tsx
NEW   app/(dashboard)/(routes)/preview/[courseId]/page.tsx
NEW   app/(dashboard)/(routes)/preview/[courseId]/chapters/[chapterId]/page.tsx
NEW   scripts/student-preview.test.cjs
NEW   docs/follow-up-2-student-view.md
MOD   app/(dashboard)/_components/secure-lesson-page.tsx
MOD   shared/v2-learning-model.ts
MOD   shared/website-routes.ts
MOD   frontend/components/sidebar.tsx
MOD   frontend/features/teacher/courses/course-list.tsx
MOD   frontend/locales/en.ts
MOD   frontend/locales/ar.ts
MOD   package.json   (adds student-preview.test.cjs to "test" and "test:firebase")
```

---------------------------------------------------------------------------------------------------------------
## 2. Static gates (never run before)  — fix failures that are mine; report pre-existing ones

```
npm ci
npm run typecheck
npm run lint
npm run check:boundaries
npm test
node --test scripts/student-preview.test.cjs      # must be 12/12
```
Method: first run all of these on the ORIGINAL code (git stash / base commit) and record the baseline. Then run with the
feature. Only new failures are mine. Record both in your report.

Places most likely to have type/lint problems (written blind, please check each):
- `app/(dashboard)/_components/secure-lesson-page.tsx`: `Awaited<ReturnType<typeof service.progress>>` cast for the empty
  progress array; the `...(preview?{href:...}:{})` spread into `segments`; the new `preview` prop on `UnavailableLesson`.
- `shared/student-preview.ts`: `guardFetch` typing (`'method' in input`, `Request`/`Response`/`location` globals), unused vars.
- `server/services/student-preview.ts`: `context.repository.courses()` / `.modules()` / `.offerings()` call signatures,
  `scope.segments ?? []`, row property names (`status`, `course_id`, `organization_id`).
- `app/(dashboard)/(routes)/preview/page.tsx`: `CourseCard` props (`href`, `category`, `chaptersLength`).
- `frontend/components/sidebar.tsx`: `<L id={cond ? 'a' : 'b'}/>` must satisfy the `MessageKey` union.
- `check:boundaries`: `app/` must not import `server/integrations`. The preview pages import only `server/services/*`.
  The lesson preview route imports `_components/secure-lesson-page` via a relative path (same as `/courses/.../chapters/...`).
- Tailwind 3.3.3: `rtl:rotate-180` variant is used in `preview-bar.tsx`; confirm it renders (needs `dir="rtl"` on <html>).
- `npm run build` must succeed (`next build`).

---------------------------------------------------------------------------------------------------------------
## 3. Stand up a real environment

Use the repo docs (`README.md`, `docs/pre-vps-validation.md`, `docs/v2-step02b-s-development-validation.md`,
`.env.example`, `supabase/`) to run the app in Firebase staging mode against a LOCAL/DEV Supabase (never production).
Seed (or create via the app) this data in ONE organization, plus a second organization for isolation tests:

Users:  T1 teacher (course staff of C1) · A1 assistant (offering staff only, NOT course staff) · O1 org owner/admin ·
        S1 student enrolled in C1 offering G1 · S2 student NOT enrolled · T2 teacher of a DIFFERENT organization.
Content in C1: published course with ≥2 modules; published lesson with ≥2 published parts (one with an uploaded video asset,
        one with an embed URL); one DRAFT lesson with a published part; one published lesson with a DRAFT part;
        one homework assignment on a published part; one scheduled exam for G1.
        A second course C2 that is DRAFT (unpublished). A course C3 in the other org.
If the "teacher-side" role model is unclear, read `server/services/teacher-side.ts` and
`docs/follow-up-1-teacher-dashboard.md` (role table). Legacy `ASSISTANT` role is intentionally unchanged.

---------------------------------------------------------------------------------------------------------------
## 4. THE CRITICAL TEST: preview writes NOTHING (database snapshot diff)

Before and after every preview session, snapshot these tables (generic hash works for any columns):
```sql
select 'lesson_progress' t, count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.lesson_progress x
union all select 'lesson_segment_progress', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.lesson_segment_progress x
union all select 'enrollments', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.enrollments x
union all select 'enrollment_requests', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.enrollment_requests x
union all select 'homework_submissions', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.homework_submissions x
union all select 'homework_submission_files', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.homework_submission_files x
union all select 'homework_responses', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.homework_responses x
union all select 'assessment_attempts', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.assessment_attempts x
union all select 'assessment_responses', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.assessment_responses x
union all select 'session_attendance', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.session_attendance x
union all select 'group_memberships', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.group_memberships x
union all select 'media_assets', count(*), md5(coalesce(string_agg(x::text,'' order by x::text),'')) from public.media_assets x;
```
Also snapshot the private schema tables `private.homework_uploads`, `private.assessment_participations`,
`private.notification_events` (use a role that can read them). Also record Supabase storage object count for buckets
`lms-homework` and `lms-course-media`.

Procedure (as T1, then as A1):
1. Snapshot. 2. Sign in, click View as student. Browse `/preview`, the course, every lesson part. PLAY a video to the end, pause,
seek, leave the tab (visibilitychange), close the tab mid-play, press browser back/forward, reload. Wait >9 minutes on one lesson to
trigger the 8-minute signed-URL refresh. 3. Snapshot again. **Every row/hash must be identical.** Any difference = bug in preview: fix it.
Notes: `notifications` and the teacher's own settings may legitimately change for unrelated reasons; document, don't hide.

### 4b. Network-level proof (Playwright or similar, not just DB)
Record every request made while on `/preview/**`. Assert: every non-GET/HEAD request is one of
 - `POST /api/learning/<uuid>/media`  (view-URL signing; records nothing)
 - `POST /api/auth/firebase/*`        (session refresh)
 - `POST /api/personalization`, `POST /api/communications`  (teacher's own settings/notifications)
Anything else (especially `/api/learning/*/progress`, `/api/homework/*`, `/api/secure-exams/*`, `/api/study-groups`,
`/api/student-*`, `/api/courses/*`) = FAIL. Save the HAR/request log as evidence.

### 4c. Adversarial attempts from inside the preview page (devtools / script injection)
In the preview page console, run each and confirm result is a 403 JSON `{"error":"Student preview is look-only. Nothing is saved."}`
generated by the guard AND that nothing hits the server and the DB snapshot is unchanged:
```js
fetch('/api/learning/<courseId>/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offeringId:'<g1>',segmentId:'<seg>',position:30,complete:true,revision:0})})
fetch('/api/homework/new/list',{method:'POST',body:'{}'})
navigator.sendBeacon('/api/learning/<courseId>/progress','{}')   // must return false
```
Then bypass the guard (open a NEW tab on a non-preview page, same session) and send the same progress POST as T1.
EXPECTED: the BACKEND rejects it because T1 has no enrollment (403/42501/"Active course enrollment required").
If the backend ACCEPTS a teacher's progress write, that is a pre-existing backend hole: DO NOT fix it silently; report it
prominently to the owner (it means the browser guard is the only protection).

---------------------------------------------------------------------------------------------------------------
## 5. Access / authorization matrix (HTTP, with real sessions)

For each user, request each URL (follow redirects; record final status). `UUID` = real ids.

| URL | T1 teacher | A1 assistant | O1 org owner/admin | S1 student | S2 student | T2 other-org teacher | anonymous |
|---|---|---|---|---|---|---|---|
| /preview | 200 | 200 | **404** | **404** | **404** | 200 (only own org) | redirect /sign-in |
| /preview/C1 | 200 | 200 if offering staff of C1 | **404** | **404** | **404** | **404** | redirect |
| /preview/C1/chapters/<part> | 200 | 200 if capable | 404 | 404 | 404 | 404 | redirect |
| /preview/C2 (draft course) | 200 with "not published" message, no content | same | 404 | 404 | 404 | 404 | redirect |
| /preview/C3 (other org) | **404** | **404** | 404 | 404 | 404 | 200 | redirect |
| /preview/not-a-uuid, /preview/C1/chapters/x | 404 (middleware sends unlisted shapes to /unavailable — record which) | | | | | | |
Also: the "View as student" toggle (sidebar, mobile menu, course-list header `[data-student-preview-toggle]`) is PRESENT for T1/A1
and ABSENT for O1, S1, S2. Confirm A1 actually sees it given how `isTeacherSideContext` treats offering-only staff.
Confirm T1 in preview cannot read anything T1 could not read outside preview (compare data returned for another teacher's course in the same org).
Confirm session/role unchanged: `getWebsiteContext()` viewer id/role identical before, during, after preview.
Confirm no cookie/localStorage is set by entering/leaving preview (devtools Application tab).
Teacher who is ALSO enrolled as a student in a course: normal student pages must still record THEIR real progress; preview must not.

---------------------------------------------------------------------------------------------------------------
## 6. Draft / published behaviour (must match what a real student sees)

Compare side by side: S1's real view of C1 vs T1's `/preview/C1`.
- Draft lesson never appears (even though it has a published part). Draft part never appears in lists, playlist, prev/next.
- Direct URL to a draft part in preview → "Unavailable"/not found message, not content.
- Draft course C2 → "not published" message in preview, and not listed in `/preview`.
- The "N unpublished items are hidden" note shows a sensible N (check it counts what the teacher can see via RLS; verify it is not misleading).
- Student-only gates NOT simulated (by design): enrollment window/expiry, offering status. Note any case where a student would see
  LESS than the preview and tell the owner.
- Verify the lesson list in preview equals the lessons S1 sees (same ordering, titles, covers/thumbnails).
- Verify videos (uploaded asset + embed) play for T1 in preview (staff storage policy for signed URLs). If signing fails for
  staff, that is a backend/storage-policy issue: report, don't change it.

---------------------------------------------------------------------------------------------------------------
## 7. Functional / UX checks

- Toggle: sidebar (desktop), mobile drawer, course-list header. Label flips to "Back to teacher view" inside preview. One tap exits to `/self-learning`.
- Banner: sticky, always visible while scrolling long lessons, does not overlap the mobile header/safe areas, reads clearly, exit button ≥44px.
- Look-only: no Complete/Save buttons; homework area shows the note only; no quiz/exam entry; nothing clickable that submits.
- Navigation inside preview stays inside `/preview/**` (course → part → next/previous part/lesson, playlist links).
  KNOWN: the lesson page's own "Back to Home" link goes to `/home` (leaves preview). Decide with owner whether to hide it in preview.
- Shell widgets while in preview: notification bell and support modal still work as the teacher (their POSTs are allowlisted or blocked?).
  `/api/support` is NOT allowlisted so the support modal submit will be blocked in preview. Decide with owner; do not silently allowlist.
- Next.js client navigation, `router.refresh()`, prefetch and RSC fetches keep working with `window.fetch` wrapped (no hydration errors, no console errors).
- `PreviewGuard` restores `window.fetch` and `navigator.sendBeacon` when leaving preview (navigate out via client router and confirm a POST works again, e.g. teacher saving a setting).
- Empty states: no published courses; course with zero published lessons; `scope.limited` true (>500 lessons etc.).
- Error state: simulate Supabase failure (503) on a lesson → friendly message with "Back to preview".

---------------------------------------------------------------------------------------------------------------
## 8. Visual evidence matrix (screenshots required)

Save to `docs/evidence/follow-up-2/` (named `<page>__<lang>__<theme>__<viewport>.png`).
Languages: English LTR, Arabic RTL. Themes: Light, Dark, System (test System by emulating prefers-color-scheme both ways).
Viewports: mobile 390×844 and desktop 1440×900. Minimum shots (2 langs × 2 themes × 2 viewports = 8 per page; add System spot checks):
1. teacher dashboard/course list showing the "View as student" button
2. sidebar (desktop) and mobile drawer with the toggle, normal state and inside preview
3. `/preview` course picker (with courses; and empty state)
4. `/preview/<course>` (with the draft-hidden note)
5. a lesson page with video + banner at top and scrolled (sticky)
6. unpublished-course message
7. homework note area
Check in RTL: banner layout mirrors, exit icon flips (`rtl:rotate-180`), no physical left/right spacing bugs, Arabic text not clipped,
numbers/Latin course titles render with `dir=auto`. Check in Dark: banner contrast (yellow `bg-primary` + black text), borders visible, no white flashes.
Check against EduLabs identity (neo-brutalist yellow/black, `shadow-hard-sm`, 2px black borders) consistent with the sidebar active state.
Accessibility: banner has `role="status"`, toggle focus ring, keyboard reachable, screen-reader label meaningful in both languages.

---------------------------------------------------------------------------------------------------------------
## 9. Automated tests to ADD (browser/integration level; the existing 12 are unit/static)

Add under `scripts/` or the repo's e2e location, wire into `package.json`, and keep them deterministic:
1. Playwright e2e: T1 enters preview, plays video, completes a "watch", asserts zero forbidden requests (4b) and unchanged DB hashes (4).
2. Role matrix from section 5 as an automated HTTP test (`scripts/firebase-tenant-http.cjs` is an existing pattern for tenant tests — follow it).
3. A React render test for `SecureLessonPlayer` with `preview:true`: no buttons, `fetch` mock receives no POST to `/progress` on play/pause/ended/unmount.
4. A test that `PreviewGuard` mounts/unmounts and restores `fetch`.
5. A regression test that a real student (S1) still records progress through the unchanged student route.
Do not delete or loosen `scripts/student-preview.test.cjs`.

---------------------------------------------------------------------------------------------------------------
## 10. Commit, push, verify

1. Confirm follow-up 1 commits are pushed and verified (section 0.2).
2. Review `git diff` yourself: no unrelated changes, no secrets, formatting consistent.
3. Commit on `claude/teacher-panel-redesign`, e.g. separate commits: (a) shared helpers + guard + tests, (b) routes/UI/toggle/locales, (c) evidence + docs.
4. `git push origin claude/teacher-panel-redesign`
5. Verify: `git rev-parse HEAD` equals `git ls-remote origin refs/heads/claude/teacher-panel-redesign` (print both). Verify the pushed tree contains the 18 files.
6. Update `docs/follow-up-2-student-view.md`: replace "Not verified" with what you verified; add SHA, test outputs, evidence paths, deviations.

---------------------------------------------------------------------------------------------------------------
## 11. Final report to the owner (use the setup prompt's section 8 format if you have it)

Must include: what was verified vs not; baseline vs feature test results; DB-diff and network-log proof; the access matrix result table;
draft/published handling; screenshots index; bugs found and fixed (with files); backend issues found but NOT fixed (e.g. if a teacher's
progress POST is accepted by the backend, or staff cannot sign media URLs); open decisions for the owner (legacy Clerk preview,
homework as read-only form instead of a note, hiding "Back to Home" in preview, support modal in preview); final commit SHAs and remote SHA check.

## Done means (all must be true)
- [ ] typecheck, lint, check:boundaries, build, full `npm test` pass, with no new failures vs baseline
- [ ] DB snapshots identical before/after preview sessions (T1 and A1)
- [ ] Network log shows no forbidden non-GET requests; console adversarial attempts blocked
- [ ] Access matrix passes exactly as in section 5; toggle absent for students/owner-admin/other orgs
- [ ] Draft/published behaviour matches a real student
- [ ] Screenshots for LTR, RTL, light, dark, system, mobile, desktop are in `docs/evidence/follow-up-2/`
- [ ] Added e2e/integration tests committed and passing
- [ ] Commits pushed on `claude/teacher-panel-redesign`; remote SHA == local SHA, printed in the report


---

## Task: Support area redesign (Follow-up 3) — added by the chat agent

Written for the NEXT agent, who has a real environment. Earlier sections above are untouched. Extra backend wishes are in `BACKEND_REQUESTS.md` (top level of this zip). Full detail is in `IMPLEMENTATION_REPORT.md`.

### a) What was done, and what was NOT verified
Done (UI only): Support list and conversation restyled to the target in both runtimes (`supabase-support-view.tsx` and the legacy `support-view.tsx` / `support-chat.tsx`), new shared pieces in `frontend/features/support/support-ui.tsx`, draft saving in `use-reply-draft.ts`, 15 new strings in `frontend/locales/en.ts` and `ar.ts`, and `scripts/support-redesign.test.cjs`. No backend, database, auth or contract file was edited.
NOT verified: typecheck, lint, build, the full test suite, any rendering. The chat sandbox had no `node_modules`, no browser, no network, no git and no database.

### b) Commands, in order (run on the untouched base first so only new failures count)
1. `npm ci`
2. `npm run typecheck` (expected: no errors in `frontend/features/support/**` or the locales)
3. `npm run lint`
4. `npm run build`
5. `node --test scripts/support-redesign.test.cjs` (expected: 7 pass)
6. `npm test` (expected: all pass; in the chat sandbox without dependencies `scripts/language.test.cjs` showed 3 failures and `scripts/communications.test.cjs` failed to load, identically on base and on the changed tree, so those are environment failures, not regressions)

### c) Risky places written without compiling
- `supabase-support-view.tsx`: dense one-line style kept from the original; `Localized as="section" ref={scrollRef} tabIndex={0}` (ref/prop typing on the shared `Localized` component); the `statusOptions` array typing.
- `support-ui.tsx`: `SendIcon` calls a hook inside a component; Tailwind 3.3.3 classes `rounded-ee-md`, `rounded-es-md`, `-scale-x-100`, `line-clamp-2`, `h-[calc(100dvh-9rem)]`, `[@media(pointer:fine)]:inline` (confirm they generate).
- Dark mode relies on the existing compatibility layer in `frontend/styles/appearance.css`; new combinations `bg-red-50/text-red-700`, `bg-amber-50/text-amber-800`, `text-primary-foreground` on `bg-primary` need a visual check.
- `support-chat.tsx`: the upload handler is now in try/catch (the stub throws).

### d) Missing tests to add
Browser/e2e: type a reply, press Back, reopen the ticket (draft returns); simulate a failed send (draft stays); change status with a half-written reply (reply stays); Enter sends on desktop, newline on a touch device; `?ticket=<id>` deep link and the `support_reply` notification link. Role/access matrix: requester, platform support operator, org owner/admin, org support-staff member, teacher/assistant who is not staff (must see only their own tickets), inactive user. Regression: In Progress and Assign stay staff-only; requesters only get Open/Resolved. RTL mirroring: bubbles, avatars, chevron, back and send arrows.

### e) Evidence needed
Screenshots of the list and a conversation in: English LTR, Arabic RTL, light, dark, system, mobile (390 px) and desktop. Cases: empty, loading, error banner, long unbroken message, 25+ messages with Older/Newer, overdue ticket, staff view with assignee select. Request log showing `support_command` calls for reply/status/assign. Database before/after snapshots only if you test with real data.

### f) Git steps
Branch `claude/teacher-panel-redesign`, commit, push, then print the local SHA next to the remote SHA. Nothing was committed in the chat.

### g) Done means
- Matches the approved design and nothing was lost.
- Authorization unchanged (compare `shared/support.ts`, `shared/contracts/*`, `supabase/**`, `server/**`, `app/api/**` against base: no diff).
- Typecheck, lint, build and full tests pass; evidence in (e) attached.
- Reply drafts survive navigation and a failed send.

### h) Hard rules
No backend, authentication or database changes (schema, migrations, rules, contracts, provider config) without asking the owner. Never weaken, delete or skip a test or safety guard. Label every check VERIFIED (command and result) or NOT VERIFIED (why).

### i) What the chat agent lacked
git history (the git binary exists but there is no repo), network, a database, a browser and installed dependencies. Therefore unverified: types, lint, build, runtime behavior, visuals, RTL and dark rendering, Tailwind class generation, and everything that depends on the live Supabase function.


---

## Task: Users & Study Groups redesign (Follow-up 4) — added by the chat agent

Written for the NEXT agent, who has a real environment. Earlier sections above are untouched. Full detail: `IMPLEMENTATION_REPORT.md`. Backend wishes: `BACKEND_REQUESTS.md` (items 9 to 13). Front end only; no backend, auth, database, contract, `server/**` or `app/api/**` file was edited.

### a) What was done, and what was NOT verified
Done: legacy Users & Study Groups restyled to the target PDF (header with pill and Refresh, four stat cards, section tabs, Master User Directory with search/filters, table on desktop and cards on mobile, Waitlist Approvals, Study Groups with accordion and member cards). New confirmations for Revoke, waitlist Deny, delete group (replaces a browser `confirm()`), and the existing delete-user dialog restyled. Display role names (labels only). Directory renders 50 rows at a time. 130 new en/ar strings. The Firebase-runtime screen (`supabase-student-admin.tsx`) got a header and panel reskin only (logic untouched, still English-only text).
NOT verified: typecheck, lint, build, the full test suite, any rendering. The chat sandbox had no `node_modules`, browser, network, git history or database.

### b) Commands, in order (run on the untouched base first so only new failures count)
1. `npm ci`
2. `npm run typecheck` (expected: no errors in `frontend/features/admin/users/**` or the locales)
3. `npm run lint` (watch for `react-hooks/exhaustive-deps` on the `useEffect` that calls `loadData`; a disable comment is in place)
4. `npm run check:boundaries`
5. `npm run build`
6. `node --test scripts/users-groups-redesign.test.cjs` (expected: 9 pass)
7. `npm test` (in the chat sandbox `scripts/language.test.cjs` shows the same 3 failures on base and on the changed tree, tests 9, 10, 11; they need installed dependencies)

### c) Risky places written without compiling
- `users-ui.tsx`: `useCountText` builds the key `counts.${noun}.${category}` and casts it to `MessageKey`; `ConfirmDialog` passes `autoFocus` to `Button`.
- `admin-users-view.tsx`: `group.students` is `any[]` so the member and `onConfirm` callbacks are loosely typed; `tabs` mixes a ReactNode label; `formatNext` uses the Date from `getNextUpcomingSession`.
- `master-user-directory.tsx`: `t(...)` value maps; the revoke dialog `busy` expression.
- Tailwind 3.3.3 classes to confirm they generate: `start-3`, `ps-9`, `me-1`, `text-start`, `text-end`, `rtl:rotate-180`, `[overflow-wrap:anywhere]`, `min-h-[44px]`, `sm:rounded-full`.
- Dark mode relies on the compatibility layer in `frontend/styles/appearance.css`; new combinations (`bg-amber-50`, `bg-emerald-50`, `bg-purple-50`, `border-red-300`, `text-red-700`, `bg-primary` tabs) need a visual check.
- The Firebase file is dense one-line code; only the header block, the `panel` constant, three class names and two imports changed.

### d) Missing tests to add
Browser/e2e: filter + search + "Show more" with 200+ users; Revoke cancel vs confirm; Deny cancel vs confirm; delete group cancel vs confirm; Group assign and Move still call the same requests; accordion by keyboard (Enter/Space, `aria-expanded`); mobile 390 px has no horizontal scroll. Role/access matrix: platform ADMIN, TEACHER, STUDENT (redirected), ASSISTANT (note: no guard recognises it today), anonymous. Regression: request payloads of PATCH `/api/admin/users`, POST/DELETE `/api/admin/waitlist`, DELETE `/api/admin/groups` identical to base. RTL: columns, chips, chevron, dialogs mirror.

### e) Evidence needed
Screenshots (English LTR, Arabic RTL, light, dark, system, mobile 390x844, desktop 1440x900) of: full page, directory with filters active, empty directory, loading, waitlist with requests and empty, groups collapsed and expanded, empty groups, every confirmation dialog, Group assign dialog. Request log for the four mutations above. Database before/after only if you test with real data.

### f) Git steps
Branch `claude/teacher-panel-redesign`, commit, push, print local SHA next to remote SHA. Nothing was committed in the chat. `changes.patch` is made against `base/` (the Follow-up 3 project); `changes-previous-rounds.patch` is the old file from the earlier handoff.

### g) Done means
- Matches the approved design; nothing lost; authorization unchanged (compare `server/**`, `app/api/**`, `shared/**`, `supabase/**` against base: no diff).
- Typecheck, lint, build, full tests pass; evidence from (e) attached.
- Waitlist card, tab and section all hide when `WAITLIST_ENABLED` is false (one constant, ON for now; replace it with the flag when it exists).

### h) Hard rules
No backend, authentication or database changes without asking the owner. Never weaken, delete or skip a test or guard. Label every check VERIFIED (command and result) or NOT VERIFIED (why).

### i) What the chat agent lacked
git history, network, a database, a browser, installed dependencies. Therefore unverified: types, lint, build, runtime behavior, visuals, RTL and dark rendering, Tailwind class generation, keyboard behavior.


---------------------------------------------------------------------------------------------------------------
## FOLLOW-UP 5 — Homework Approval Queue redesign (front end only)  [added; earlier sections untouched]

Read `IMPLEMENTATION_REPORT.md` first. Files changed: `frontend/features/admin/submissions/submissions-view.tsx`, `frontend/locales/en.ts`, `frontend/locales/ar.ts` (71 new `hq.*` keys). No backend/auth/API/schema change.

(a) Done / not verified: see report. NOT verified: typecheck, lint, build, all rendering. Written WITHOUT compiling.
(b) Commands, run on untouched base first, then with the change: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run build`, `npm test`. Only new failures are mine. Locally, 4 tests failed identically on base without node_modules.
(c) Risky spots: imports `Initial`, `Pill`, `PageHeader`, `FOCUS` from `users/users-ui` (confirm exports); `LocalDate` from `language-provider`; `t('hq.by',{name})`; `rtl:rotate-180` in Tailwind 3.3.3; `Skeleton` default export; `Dialog` inside `max-h-[95vh]` scroll; `data-appearance-island` on the file viewer so dark mode keeps it black; `looksLikeRawId` regex hiding approver ids.
(d) Tests to add: e2e approve one / approve-and-next / filters kept while navigating / unsaved-note discard prompt; role matrix (STUDENT redirected, TEACHER and ADMIN allowed); regression that PATCH body is unchanged; RTL snapshot; 375px no horizontal scroll.
(e) Evidence: screenshots English LTR, Arabic RTL, light, dark, system, mobile, desktop for: loaded, loading, empty, filtered-empty, error, preview panel, discard prompt.
(f) Git: branch `claude/teacher-panel-redesign`, `git apply --check changes.patch` then apply, commit, push, print local SHA next to remote SHA. Not committed in chat.
(g) Done means: matches PDF at desktop; mobile cards keep all info/actions; approve still sends the same PATCH; no console errors; baseline tests unchanged.
(h) Hard rules from sections 0 of this file still apply.
(i) Lacked: git, network, database, browser, node_modules.
