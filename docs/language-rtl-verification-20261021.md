# Language and RTL verification — 2026-10-21

## Local Git checkpoints and preservation

Worktree: `C:/Users/Sky-II-14600kf/.codex/worktrees/student-settings/EduLabs-LMS`.

The assignment began on `codex/student-settings-stage-visibility`, HEAD `a53a096c525d525b41d98ecf21922eb32bea9cb7`, with the 38 status entries described in the approved appearance report. The actual changes, new files, foundation reports and appearance report were reviewed. A fresh baseline run passed all 365 tests, strict TypeScript, architecture and lint (zero errors, ten pre-existing warnings). No unexplained content changes or credential/runtime artifacts were found.

The owner-approved account/settings/appearance foundation was intentionally committed locally as **`b9f47a45a09e8de1dea367be24efbd8c434575dc`**, `feat(settings): preserve approved account hub and appearance foundation` (37 content-change/new files). The extra Notifications status entry had no content diff; refreshing that index entry produced a clean checkpoint without discarding anything.

Session 3 uses the dedicated local branch **`codex/student-settings-language`** from that checkpoint. No push, merge, rebase, reset, stash, clean or deployment was performed. No protected branch, connected provider, account, database, DNS or infrastructure was modified.

## Architecture

No existing signed-in LMS localization system or i18n dependency was found. The independent public-site locale model is not a reusable LMS preference. This implementation uses the existing React/Next.js architecture: a small context provider, typed translation resources, explicit rendering helpers and native Intl APIs. It adds no library or second routing/authentication architecture.

- `shared/language.ts` defines only `en` and `ar`, directions, dedicated storage/cookie names and a fixed early script.
- `frontend/locales/en.ts` and `ar.ts` contain matching semantic keys. Arabic is Modern Standard Arabic. Resources are type-checked; tests reject missing/empty keys and mismatched interpolation parameters. Arabic plural resources deliberately omit a numeric placeholder when a natural zero/singular/dual noun already supplies the number.
- `L` translates explicit platform copy only. `Localized` forwards existing controls, refs and handlers without adding DOM wrappers. Dynamic labels are translated only where they are known platform enums/statuses. There is no DOM scanning, automatic text replacement, remote translation or arbitrary content translation.
- Interpolation is plain text and React-escaped, never injected HTML. Missing keys fail clearly during development/testing; unknown opaque provider error text has a deterministic unchanged fallback rather than exposing a translation key.
- Date/time presentation uses Intl with the selected locale. Existing Cairo session semantics and UTC exam timestamps remain unchanged. English compact exam timestamps retain their previous format. Intl.PluralRules handles Arabic zero/one/two/few/many/other in lesson/part/question and pending-work counts.
- Existing route URLs remain unchanged. Main LMS page titles update with the selected UI language; teacher public metadata is untouched.

## Persistence, initial paint and independence

Language defaults explicitly to English; device locale does not silently select Arabic. `edulabs-lms-language` is browser/origin-local localStorage, independent from `edulabs-lms-appearance`. There is no account synchronization, API setting, database column or migration.

A bounded, non-sensitive `edulabs_lms_language` preference cookie supplies an SSR hint, so normal saved Arabic requests render Arabic text with `lang=ar`, `dir=rtl` immediately. The cookie grants no authority; it uses SameSite=Lax, a bounded value and Secure on HTTPS. localStorage remains authoritative. Cookies themselves are host/path scoped (not port scoped); a stale hint from another localhost port is reconciled against that origin's localStorage. It is not a cross-origin/account preference store.

The fixed pre-paint script validates storage, sets document semantics early and, only when the SSR hint disagrees with local storage, temporarily hides the LMS shell until the first React reconciliation. Hydration starts with the server's initial language, avoiding text mismatch storms; layout effects apply the stored preference before the shell paints. The existing root HTML suppression is retained for root attribute changes; no component-level hydration suppression was added.

Selections apply immediately. Native radios provide keyboard/touch/mouse semantics and selected green cards. Settings discloses the local scope in each language. Blocked storage keeps in-memory switching and reports the limitation; failed writes do not create a persistent cookie for the new choice. Valid cross-tab changes propagate; invalid/removed/cleared values return to English. The appearance capture handler was narrowly corrected to let a clear-all event reach the language listener while retaining invalid-theme interception. Tests reset from Arabic/dark, not from an already-default state.

## Typography and directional behavior

The approved palette, borders, card geometry, shadows, English font setup and branding were preserved. Arabic uses **Cairo** for body/interface and **Lalezar** for headings through the same legitimate `next/font/google` build pipeline as Figtree/Caprasimo. Arabic fonts are not preloaded on English pages; they load when used. No arbitrary font downloads or new dependency were introduced.

- One desktop shell uses logical start positioning and inline-start content padding. Arabic moves the sidebar and gutter to the right; English retains the original dimensions.
- Mobile navigation chooses the correct drawer side. Normal flex direction follows the document; no duplicate shell or reordered focus DOM was created.
- Close buttons use the logical end edge. Shared input/search/textarea directions and text alignment support mixed content.
- Only horizontal navigation arrows/chevrons mirror. Logos, images, media and other icons do not.
- The Home carousel's translation and swipe calculations are direction-aware. Its English calculations, duration, autoplay and edge-clamping behavior remain intact; no infinite-loop redesign was introduced.
- Names and mixed authored titles use bidi isolation/automatic direction where needed. Email/URL controls retain LTR semantics. Released total marks are isolated LTR.
- Existing Quill content uses natural text direction and remains authored content; actual mixed Arabic/English typing was exercised. The editor was not redesigned.

## Content, public sites and security boundaries

Teacher/student course names, lessons, questions, answer options, feedback, resource names, messages, group names, organization names and profile fields are not translated. A synthetic `Advanced Physics` course and `الفصل الثاني - Electromagnetic Induction` text remain unchanged. A user-authored `Home` is not converted merely because the navigation has that translation.

Published teacher HTML/CSS remains independent and byte-for-byte unchanged. Website Studio previews retain their own configured `lang`, `dir`, theme and locale. Every preview descendant's direction, text alignment, color scheme, colors and relative layout were compared across an LMS language switch for green/cream/ink previews. Preview typography is explicitly isolated from the Arabic body font. No website configuration was saved.

No authentication, enrollment, identity-binding, CSRF, tenant/RLS, schema or academic-stage logic was changed. All **31 local migration files** and existing SQL tests remain unchanged. This is a local-file count, not a newly queried remote migration history. No SQL suite or connected database operation was required/performed for this browser-local feature.

Notifications stays independent: its event values, preference writes, read/unread actions, subscription, unsubscribe, polling, pagination and delivery implementation remain intact. Regression tests compare the original action/preference/push handler bodies with the approved checkpoint and exercise save/reload/error and push-registration paths. Only UI copy and locale-based timestamp display changed. Support action/category/status values likewise retain their original API values while displaying translated labels.

## Final automated verification

| Check | Actual outcome |
| --- | --- |
| Complete application suite | **377 passed, zero failed**: 365 prior baseline plus 12 language tests |
| Strict non-incremental TypeScript | **Passed**, no memory-exhausted run counted as a pass |
| Architecture checks | **Passed**, including the existing architecture tests in the full suite |
| ESLint | **Zero errors; nine existing warnings**; no blanket disables or new warnings. The native image localization wrapper means the old AvatarPicker image warning is no longer emitted |
| Settings/account/Notifications Chromium | **21 scenario groups passed**, zero exceptions, zero hidden stage requests |
| Appearance SSR/Chromium | **24 scenario groups passed**, including contrast, persistence, System, Quill, Studio isolation and restart |
| Language SSR/Chromium | **24 scenario groups passed**, zero hydration warnings/exceptions, zero hidden stage requests |
| Firebase/Supabase production build | **Passed, exit 0**, final source |
| Clerk/Prisma production build | **Passed, exit 0**, final source |
| Local production authentication/CSRF smoke | **3/3 passed**: anonymous GET 401, foreign-origin PUT 403, same-origin anonymous PUT 401 |
| Git whitespace and preservation | **Passed**; backend, contracts, migrations, public renderer/style, hidden selector and approved appearance stylesheet unchanged |

Browser coverage uses actual React SSR/hydration, next-themes, account dialog, navigation, Notifications, Exams, Support, teaching dashboard, lesson/module editor and Quill components. HTTP/identity/provider/push adapters and input records are synthetic. Browser tests do not create provider identities or mutate connected services.

The language scenarios cover all six English/Arabic × Light/Dark/System combinations, OS changes, pre-hydration missing/invalid/stale values, server-rendered saved Arabic, document titles, navigation/refresh, blocked storage, cross-tab and clear-all behavior, full Chromium restart, native radio keys, touch-enabled mobile controls, sidebar clearance, mobile drawer/bell, account editor, actual exam table, Support dialog focus trapping, actual toast rendering/dismiss API, Quill mixed-content editing and RTL carousel movement. Switching in either direction makes no account/settings/notification API write.

Viewports: **1440, 768 and 390 px**, including a separate touch-enabled mobile context. No tested document overflow, clipped control or unexpected media mirroring remained.

The first test runs identified and corrected missing VM localization adapters, a Next Image fixture forwarding non-DOM props, generic localized-control typing gaps, an outdated notification whole-file assertion, a fixture with the old physical gutter, and the RTL carousel/clear-event issues described above. Failures were investigated, not counted as passes. The original notification handler regression was replaced by immutable handler-body assertions plus real component scenarios, rather than dropping authorization/behavior coverage.

## Evidence and reproduction

Git-ignored logs/results: `.local/session3-check-final.log`, `.local/session3-final-results.json`, `.local/session3-*-final.log`, `.local/language-browser/results.json`, `.local/settings-browser/results.json`, `.local/appearance-browser/results.json`, and `.local/session3-final-inventory.json`.

The language evidence directory is an ignored junction into `E:/EduLabs-Local-Builds/student-settings-language-20261021/browser` because C: had little free space. The synthetic browser profile is also E:-backed. No pre-existing evidence, dependencies, credentials or user process was deleted. Owned test servers/browser contexts were closed normally.

Screenshots in `.local/language-browser/` include:

- `settings-{en,ar}-{light,dark}-{1440,768,390}.png`.
- `home-ar-{1440,390}.png`, `self-learning-ar-{1440,390}.png`, `notifications-ar-{1440,390}.png`.
- `bell-drawer-ar.png`, `touch-drawer-ar.png`, `account-ar.png`.
- `gallery-ar-desktop.png`, `gallery-ar-mobile.png` (actual populated Exams/Support/teaching components and independent website previews).
- `support-dialog-ar.png`, `rich-text-ar.png`, `toast-ar.png`.

Normal checks are `npm test`, `npm run typecheck`, `npm run check:boundaries` and `npm run lint`. Language tests are included in `npm test`. Existing isolated build launchers and controlled memory/concurrency were reused; tracked environment and TypeScript configuration were not changed.

Run `scripts/settings-browser-components.cjs`, `scripts/appearance-browser.cjs` and `scripts/language-browser.cjs` with the established Playwright/esbuild/Chromium runtime environment paths. The language harness additionally accepts `LMS_LANGUAGE_FONT_BUILD` and `LMS_LANGUAGE_PROFILE`. Point the font build to the current Firebase output to exercise Cairo/Lalezar. These are component fixtures, never a production-preview route or authentication bypass.

## Limits and independent review

This proves the exercised authored UI and shared shell; it is not real Firebase/Clerk authentication, remote Supabase/Storage persistence, email delivery or Web Push delivery acceptance. No provider acceptance is claimed. Existing underlying security tests ran unchanged in meaning.

Firefox, WebKit and physical devices were not run. Some advanced teacher-only builders, legacy-only screens and third-party widget/tooltips have not received a complete localization pass or browser acceptance. The existing teacher dashboard and shared teacher editor controls were checked for direction/font/usability; this session does not redesign the teacher panel. Clerk-owned profile widgets and browser/native validation dialogs retain their provider/browser language behavior. Unmapped opaque provider errors fall back to their existing safe text rather than invented Arabic. Background push payload localization is not implemented by a browser-local UI setting; delivery generation/permissions were intentionally preserved.

The known scope above is explicit: do not infer that every historical route or external widget is fully Arabic. No known defect remains in the exercised student Settings, Home, Self Learning, Exams listing/table, Notifications, Support or shared account/navigation surfaces. Production launch, real-provider acceptance and a native Arabic copy/accessibility review remain separate gates.

Final source and this report are committed locally on the language branch. The approved Settings/appearance checkpoint remains on its original branch. The final commit hash is provided in the session response and Git history. The intended final tracked/untracked worktree is clean; only ignored evidence/build artifacts remain. No push, merge or deployment is authorized/performed. No Session 4 work has begun.

## Exact Session 3 file inventory

The following inventory includes every modified/new source or test file for this session; prior committed foundation files outside it were preserved.

| Status | Category | File |
| --- | --- | --- |
| Modified | Production UI / local preference | `app/(dashboard)/(routes)/exams/loading.tsx` |
| Modified | Production UI / local preference | `app/(dashboard)/(routes)/settings/page.tsx` |
| Modified | Production UI / local preference | `app/(dashboard)/_components/website-pages.tsx` |
| Modified | Production UI / local preference | `app/(dashboard)/layout.tsx` |
| Modified | Production UI / local preference | `app/layout.tsx` |
| Modified | Production UI / local preference | `frontend/components/footer.tsx` |
| Modified | Production UI / local preference | `frontend/components/providers/toast-provider.tsx` |
| Modified | Production UI / local preference | `frontend/components/providers/v2-identity.tsx` |
| Modified | Production UI / local preference | `frontend/components/search-input.tsx` |
| Modified | Production UI / local preference | `frontend/components/session-countdown.tsx` |
| Modified | Production UI / local preference | `frontend/components/sidebar.tsx` |
| Modified | Production UI / local preference | `frontend/components/theme-provider.tsx` |
| Modified | Production UI / local preference | `frontend/components/ui/dialog.tsx` |
| Modified | Production UI / local preference | `frontend/components/ui/input.tsx` |
| Modified | Production UI / local preference | `frontend/components/ui/sheet.tsx` |
| Modified | Production UI / local preference | `frontend/components/ui/textarea.tsx` |
| Modified | Production UI / local preference | `frontend/components/upcoming-session.tsx` |
| Modified | Production UI / local preference | `frontend/features/auth/account-dialog.tsx` |
| Modified | Production UI / local preference | `frontend/features/auth/account-security.tsx` |
| Modified | Production UI / local preference | `frontend/features/auth/avatar-picker.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/course-detail.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson-card.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson/homework-assignments.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson/homework-student.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson/lesson-blocks.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson/lesson-tabs.tsx` |
| Modified | Production UI / local preference | `frontend/features/courses/lesson/secure-player.tsx` |
| Modified | Production UI / local preference | `frontend/features/dashboard/admin-home.tsx` |
| Modified | Production UI / local preference | `frontend/features/dashboard/mobile-sidebar.tsx` |
| Modified | Production UI / local preference | `frontend/features/dashboard/sidebar-routes.tsx` |
| Modified | Production UI / local preference | `frontend/features/dashboard/student-home.tsx` |
| Modified | Production UI / local preference | `frontend/features/exams/exam-result.tsx` |
| Modified | Production UI / local preference | `frontend/features/exams/exam-runner.tsx` |
| Modified | Production UI / local preference | `frontend/features/exams/exams-list.tsx` |
| Modified | Production UI / local preference | `frontend/features/exams/exams-view.tsx` |
| Modified | Production UI / local preference | `frontend/features/groups/group-summary-panel.tsx` |
| Modified | Production UI / local preference | `frontend/features/notifications/notifications-view.tsx` |
| Modified | Production UI / local preference | `frontend/features/personalization/appearance-settings.tsx` |
| Modified | Production UI / local preference | `frontend/features/personalization/dashboard-form.tsx` |
| Modified | Production UI / local preference | `frontend/features/self-learning/self-learning-view.tsx` |
| Modified | Production UI / local preference | `frontend/features/support/status-badge.tsx` |
| Modified | Production UI / local preference | `frontend/features/support/supabase-support-view.tsx` |
| Modified | Test workflow | `package.json` |
| Modified | Tests / workflow | `scripts/appearance-browser.cjs` |
| Modified | Tests / workflow | `scripts/communications.test.cjs` |
| Modified | Tests / workflow | `scripts/exam-runner.test.cjs` |
| Modified | Tests / workflow | `scripts/exams-foundation.test.cjs` |
| Modified | Tests / workflow | `scripts/group-presentation.test.cjs` |
| Modified | Tests / workflow | `scripts/lessons.test.cjs` |
| Modified | Tests / workflow | `scripts/milestone1.test.cjs` |
| Modified | Tests / workflow | `scripts/platform-branding.test.cjs` |
| Modified | Tests / workflow | `scripts/settings-browser-components.cjs` |
| Modified | Tests / workflow | `scripts/settings.test.cjs` |
| Modified | Tests / workflow | `scripts/student-portal.test.cjs` |
| New | Production UI / local preference | `frontend/components/language-provider.tsx` |
| New | Production UI / local preference | `frontend/features/personalization/language-settings.tsx` |
| New | Translation resources | `frontend/locales/ar.ts` |
| New | Translation resources | `frontend/locales/en.ts` |
| New | Translation resources | `frontend/locales/messages.ts` |
| New | Production UI / local preference | `frontend/styles/language.css` |
| New | Tests / workflow | `scripts/language-browser.cjs` |
| New | Tests / workflow | `scripts/language.test.cjs` |
| New | Tests / workflow | `scripts/localization-test-loader.cjs` |
| New | Production UI / local preference | `shared/language.ts` |
| New | Documentation | `docs/language-rtl-verification-20261021.md` |
