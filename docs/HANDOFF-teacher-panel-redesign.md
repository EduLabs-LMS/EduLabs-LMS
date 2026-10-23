# Hand-off: teacher panel redesign (everything since the checkpoint `c46266f`)

**Branch:** `claude/teacher-panel-redesign` (GitHub: `EduLabs-LMS/EduLabs-LMS`). **Base:** `c46266f` ("add English and Arabic interface with RTL support").
**Scope rule followed throughout:** front end only. No file under `server/`, `supabase/`, `prisma/`, `middleware.ts` or `app/api/` was changed
(checked with `git diff --stat c46266f HEAD -- server supabase prisma middleware.ts app/api`, which is empty).
Where something needs the back end it is listed in [`codex-backend-request-teacher-academic-programs.md`](./codex-backend-request-teacher-academic-programs.md).

## How to read the history

`git log --oneline 1181a84..HEAD` is the real work. The twelve commits before `1181a84` are an old upload that was replaced by `1181a84`
("reset teacher-panel branch to checkpoint c46266f", whose tree is identical to `c46266f`); ignore them. Two commits are NotchSucks's own
(`20f66fe`, `a62ec0c`, the wordmark font fixes, cherry-picked with authorship kept). 159 files changed in total (3404 insertions, 1414 deletions).

## Things that touch shared infrastructure (review these first)

| File | What changed | Why |
| --- | --- | --- |
| `shared/website-routes.ts` | `/teacher/courses…` patterns replaced by `/self-learning/<uuid>` and `/self-learning/<uuid>/chapters/<uuid>` | Teacher course pages moved to Self-learning. This is the allowlist the middleware reads, so please look at it twice. The matching `teacher/layout.tsx` guard is reused unchanged through a re-export layout. |
| `app/globals.css` | Added the motion system (keyframes and `.m-*` classes) | Page, list and press animations. Only `transform` and `opacity` (plus cheap colour fades), hover effects only where hover exists, fade-only under `prefers-reduced-motion`. |
| `frontend/styles/appearance.css` | Dark-mode rules for the new chip and link colours | Keeps contrast in dark mode. |
| `frontend/locales/en.ts`, `ar.ts` | About 275 new keys each (prefixes `preview.`, `support.`, `users.`, `groups.`, `gv.`, `lf.`, `eb.`, `roles.`) | Arabic is complete for every new key. Both files stay in key parity (a test enforces it). |
| `frontend/components/ui/dialog.tsx` | Removed `backdrop-blur-sm` from the overlay | Blur is expensive on phones. |
| `package.json` | Only the `test` script list (new test files added) | |
| `shared/contracts/application-auth.ts` | Optional fields `teacherSide`, `studentPreview`, `role` on the navigation context | Display-only. |

## What was built

### Navigation and roles
- **Teacher courses merged into Self-learning** for teacher-side users. Routes: `/self-learning`, `/self-learning/<id>`, `/self-learning/<id>/chapters/<id>`. Old `/teacher/courses…` routes are gone (no alias). Students still get the original Self-learning page. Same condition as the teacher guard is used to pick the view (`shared/student-preview.ts: isTeacherSide`).
- **Sidebar:** the "Admin & Teacher" divider is removed; staff links sit in one list (Users & Groups after Self Learning, Homework Queue after Sessions & Groups). **Role badge** shows Admin / Teacher / Assistant / Student in its own colour (`shared/roles.ts`; red, amber, violet, green). The wordmark uses the display font.
- **View as student** (teacher-side only): a toggle in the sidebar, a bar at the bottom while on, student navigation, student components fed with the published courses and active groups the teacher can already read, lesson player in preview mode (no progress saved), homework and answers not rendered, and a client write guard (`installPreviewWriteGuard`) that blocks student-data writes on fetch and XHR. It changes only what is displayed; the cookie is ignored for non-teacher-side users.

### Pages rebuilt in one shared look
Shared pieces: `frontend/components/page-kit.tsx` (PageHeader, Card, Chip, StatCard, EmptyState, FilterPills, SearchField, SkeletonList), `frontend/components/ui/dropdown-select.tsx` (our own animated dropdown, same props as a native `<select>`, now used for all 55 selects; the public teacher site keeps native selects because it runs without scripts), `count-up.tsx`, `page-transition.tsx`.
- **Dashboard (teacher):** simplified hero, waitlist card only while someone is waiting, no quick-actions, no attendance card, no assessments widget.
- **Home and Self-learning (student):** header, search, progress filters, progress bars. The placeholder photo carousel is gone.
- **Users** (`supabase-student-admin.tsx`): people only. Offering picker, stat cards, Students and Waitlist tabs (waitlist only while there are pending requests; past requests stay reachable from the status filter), table on desktop and cards on phones, confirmations before Reject, Suspend and Revoke link, all invite-link features kept.
- **Sessions & Groups** (`group-workspace.tsx`): a group opens as its own screen with a back button. Tabs Overview / Members / Sessions / Settings (students: Overview / My attendance). Header merges the group name, status, location and stream badges, next class and live countdown, Join and "Open room to host". List has countdown, sort, and an Online / In person / Both filter (Online default). Reasons are asked in dialogs. Archive, Cancel, Deactivate, Finalize and Reopen confirm first. Several students can be added at once (the existing add command, one after another). **Jitsi:** "Create a Jitsi room" makes a random `meet.jit.si/EduLabs-…` link that passes `validGroupMeetingUrl`. Teachers no longer see "My attendance history".
- **Support** (`supabase-support-view.tsx`): list and conversation to the target, who-is-waiting chips (derived from `response_due_at`), status dropdown, "Support team" label, reply drafts kept on the device. Attachments, requester email and avatars of other people are left out (not in the data).
- **Homework Queue, Exams list, Notifications, Settings, teacher lesson list:** header, search, filters, sort, cards, empty and loading states.
- **Palette pass:** old blue, cyan and emerald accents and soft light borders across 85 files now use the green-and-black card style; amber and red are kept for warnings and errors.

### Motion
Page rise-in on every route, capped list stagger (first ten items), count-up on stat numbers, press and hover feedback on buttons, animated dropdown, tab content animation, skeleton shimmer, progress bars that grow. All CSS-driven; research notes: animate only `transform` and `opacity`, keep staggers short, respect reduced motion.

## Tests
`npm test` now runs 425 tests (was 377 at the start of this work). New files: `student-preview`, `support-view`, `users-view`, `groups-redesign`, `dropdown`, `learning-filter`, `exam-browse`, `roles`. Several older tests that pinned exact markup got updated stubs or patterns (for example `student-academics`, `milestone1`, `groups`, `homework`, `settings`, `exams-foundation`). Typecheck, lint and `check:boundaries` pass.

## Not done or not verified (please check with real data)
- Nothing here was exercised against the real Firebase and Supabase stack; screens were reviewed in a local fake-data preview only. Treat provider behaviour as unverified.
- Arabic, dark mode and mobile were spot-checked, not fully screenshotted. The lesson player, course editor, segment editor, Programs and Website studio got the palette pass and light touches, not a full layout rebuild.
- Known dev-only console warning: "Accessing element.ref was removed in React 19" from Radix popover 1.0.x. It is harmless but noisy; upgrading the Radix packages would fix it (a dependency change, not done).
- The old Clerk screens (`admin-users-view`, `support-view`, `master-user-directory`, …) were only recoloured by the palette pass, not redesigned.

## Local-only branch (do not merge)
A branch `local/preview-bypass` exists only on one machine (a pre-push hook blocks pushing any `local/*` branch). It holds a fake sign-in and fake data for previewing screens without credentials. It must never be merged or pushed.

## Likely merge conflicts
Heavily rewritten files: `frontend/features/dashboard/admin-home.tsx`, `student-home.tsx`, `frontend/features/groups/group-workspace.tsx`, `frontend/features/support/supabase-support-view.tsx`, `frontend/features/admin/users/supabase-student-admin.tsx`, `frontend/features/self-learning/self-learning-view.tsx`, `frontend/components/sidebar.tsx`, `frontend/features/teacher/courses/course-list.tsx`, `frontend/features/exams/exams-list.tsx`, both locale files, `shared/website-routes.ts`. If you changed any of them, rebase onto this branch and keep the new structure; the logic functions (data loading, commands, polling) were kept as they were.
