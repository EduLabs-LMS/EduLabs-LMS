# EduLabs visual integration and acceptance

Verified locally on 11 October 2026. Branch: `codex/edulabs-visual-redesign`, based on the clean Phase 1 + Phase 2 checkpoint `b2ca8d180c5d4bf984986850272ed8d8de916f34` in `C:/dev/EduLabs-LMS`.

## Scope and boundaries

This is a presentation change to the NEW LMS. Firebase identity, server-verified sessions, Supabase repositories, tenant permissions and PostgreSQL RLS remain authoritative. No backend service, shared security contract, database migration, package manifest, lockfile or environment configuration changed. All 16 migrations remain present; the canceled preservation ledger remains absent. No legacy identities or records were investigated, imported or linked.

`/design-preview` is the new public marketing reference. `/` and authentication redirects retain their existing behavior. In fallback mode the public preview still traverses Clerk middleware so the root layout has valid Clerk request context. Protected fallback routes continue to require authentication. Firebase mode continues to block unmigrated legacy APIs.

No merge, push, deployment or production authentication change was performed. Existing local credentials remain outside version control.

## Design audit and implementation

The full supplied handoff was inspected. `source/original-EduLabs-1.html` was treated as canonical, ahead of the simplified showcase. The stylesheet, logo geometry, motion specification, component map, acceptance criteria, dictionaries, examples and demo-source audit informed the implementation. Demo account/session/persistence code was not copied.

The following were reproduced or adapted:

- Exact light/dark palette, 2.5px outlines, pill buttons, offset shadows, rounded cards and tactile states.
- Caprasimo/Figtree English and Lalezar/Cairo Arabic, self-hosted through `next/font`.
- The exact 22 separate tree paths, 400 × 468.8 viewBox, transform origins, root-first indices and stagger. A structural comparison against the supplied JSON passed for the entire geometry object.
- Static green, white and black SVG assets; reusable accessible tree/wordmark components.
- Sticky marketing header, floating hero tree, services, four steps, illustrative teacher cards, plan cards, CSS book covers, FAQ, final band, footer and mobile menu.
- Real Firebase forms, organization navigation, student/teacher dashboards, course cards/search/details, teacher editor, offering roster, empty/error/loading states, dialogs, support form and toasts.

The original CSS was audited and namespaced under `.edu-marketing`. Application styling is scoped under `.edu-app` and dedicated `edu-*` classes. Generic reference selectors are not imported globally. Existing reusable primitives and rich-text components remain in use.

### Source map and dependencies

| Area | Files |
| --- | --- |
| Tokens and scoped styles | `frontend/styles/edulabs.css`, `frontend/styles/marketing.css` |
| Exact identity | `frontend/design/tree-data.ts`, `tree.tsx`, `public/edulabs/tree-*.svg` |
| Preferences and translations | `frontend/design/preferences.tsx`, `translations.ts`, `locales/` |
| Public reference and motion | `frontend/design/marketing.tsx`, `motion.tsx`, `app/design-preview/page.tsx` |
| LMS presentation | `frontend/design/application-shell.tsx`, `learning-dashboard.tsx`, `course-card.tsx`, `course-search.tsx`, `group-roster.tsx` |
| Existing integrations | Dashboard server views, Firebase form, teacher form, sidebar, footer, support/loading/toast providers and UI primitives |
| Errors | `app/error.tsx`, `app/not-found.tsx`, existing unavailable view |
| Browser verification | `scripts/edulabs-browser-acceptance.cjs`, `scripts/edulabs-motion-acceptance.cjs` |

No dependencies were added or upgraded. Existing Framer Motion was evaluated; it remains in existing application transitions. Native CSS plus small React/IntersectionObserver components better preserve the reference timings without introducing another global animation controller.

## Route coverage

| Routes | Presentation |
| --- | --- |
| `/design-preview` | Public reference with splash, scroll motion and honest preview states |
| `/sign-in`, `/sign-up` | Responsive Firebase forms, Google control, verification/reset states, loading/errors |
| `/`, `/home`, `/dashboard` | Existing authenticated entry behavior; real learning/teaching summaries |
| `/self-learning`, `/search`, `/teacher/courses` | Authorized real courses, search, organization filtering and paging |
| `/teacher/create`, `/onboarding/organization` | Existing contextual creation flows with branded forms |
| `/teacher/courses/[courseId]` | Real metadata/rich-text editor, status/visibility, save/error feedback |
| `/courses/[courseId]`, `/courses/[courseId]/detail` | Authorized course details, rich description, published lessons, progress/assessment summaries |
| `/group`, `/groups`, `/offerings/[offeringId]` | Offering/enrollment views and permitted staff roster |
| `/unavailable`, not-found/error states | Honest unavailable/retry presentation |

Shared desktop/mobile navigation, organization selection, avatar/sign-out, support dialog and footer cover these routes. Unsupported legacy features remain unavailable in Firebase mode. This redesign does not claim to implement lesson authoring, video playback, homework, assessment delivery or enrollment mutation flows that were deferred before this work.

## Motion and preferences

Reusable `Reveal` supports rise, pop, side, split, covers and line patterns. Its observer uses threshold `.14` and bottom root margin `-6%`, and disconnects on unmount. SSR, reduced-motion and unsupported-observer environments start with visible content. Dense teacher forms have no decorative entrance animations.

The public splash uses 600ms tree growth with 55ms indexed stagger, 650ms letters with 70ms stagger, tagline, 3100ms display and the reference curtain exit. It is clickable and Escape-skippable, skips hash/query deep links and reduced motion, and runs only once per tab session. The sessionStorage value is a cosmetic intro preference, never authentication. Timers, font callbacks and keyboard listeners clean up. It is absent from authentication and authenticated navigation.

Hero floating pauses outside the viewport. Scroll progress uses one scheduled animation frame and removes listeners on unmount. Pricing segmentation changes only a visual concept state; it does not implement billing. Reduced-motion styles disable movement and leave content visible.

The existing `next-themes` provider controls the explicit persisted theme. Forced light mode is removed only for the NEW LMS; fallback behavior stays light. Server-rendered locale comes from an `edulabs-locale` preference cookie, with real `lang`/`dir`, logical spacing, mirrored sidebar and RTL-aware forms. Static UI, statuses, errors and empty states have Arabic translations. User-authored names/course descriptions, EduLabs, email addresses, URLs, identifiers and creator names are intentionally not translated. No new hydration-warning suppression was added.

## Screenshot comparison

Canonical original HTML and implementation screenshots were captured at matching **390px and 1440px**, in EN/light, EN/dark, AR/light and AR/dark. Locale/theme transitions and font loading were allowed to settle before measuring the reference. Browser implementation captures also cover the other required widths.

Artifacts remain local and ignored under `.local/redesign/`; screenshots are not committed alongside account/session artifacts.

| Evidence | Local path/pattern |
| --- | --- |
| Original reference, eight states | `.local/redesign/screenshots/reference-{en,ar}-{light,dark}-{390,1440}.png` |
| Public implementation | `.local/redesign/screenshots/{chromium,firefox,webkit}-{en,ar}-{light,dark}-{390,1440}.png` |
| Auth forms, four modes | `.local/redesign/screenshots/auth-{browser}-{locale}-{theme}-{width}-{sign-in,sign-up}.png` |
| Authenticated home/editor/offering | `.local/redesign/screenshots/app-{browser}-{locale}-{theme}-{width}-{home,editor,offering}.png` |
| Course and student views | `.local/redesign/screenshots/app-chromium-*-course.png`, `student-*.png` |
| Splash animation samples | `.local/redesign/screenshots/motion-{browser}-splash.png` |
| Measurements | `.local/redesign/reference-metrics.json`, `implementation-metrics.json` |

Measured English/light comparison:

| Geometry | Original | Implementation |
| --- | --- | --- |
| Mobile h1 size at 390px | 350 × 127.27px | 350 × 127.27px |
| Desktop h1 size at 1440px | 594 × 424.30px | 594 × 424.30px |
| Hero art mobile / desktop | 350px / 440px square | 350px / 440px square |
| Desktop hero art x | 817px | 817px |
| Mobile hero art y | 492.81px | 552.58px |
| Desktop hero art y | 234.81px | 218.56px |

Both themes use the specified exact background colors. Typography, path geometry, hero sizing, rounded cards and hard shadows closely reproduce the original. This is not a claim of pixel-perfect parity: honest revised copy changes wrapping/section heights, mobile hero placement differs by about 60px, header actions are simplified, illustrative teacher palettes differ, and pricing/books sections are shorter because unavailable commerce/waitlist interactions were removed. The authenticated editor has no equivalent reference screen and is judged by consistent design-system use.

## Actual verification

| Check | Result |
| --- | --- |
| `npm run check` | 60 tests passed; architecture and TypeScript passed; lint 0 errors, 8 existing warnings |
| Firebase/Supabase production build | Passed with isolated output and process-only staging configuration |
| Clerk/legacy production build | Passed with isolated output and process-only fallback configuration |
| Legacy HTTP smoke | Sign-in and design preview 200; Firebase provision disabled with 404 |
| Public visual matrix | 84 combinations: three browsers × four locale/theme states × seven widths; no captured hydration/JS errors or overflow |
| Authenticated visual matrix | 445 route/viewport checks; no captured hydration/JS errors or overflow |
| Sign-in/sign-up visual capture | 48 combinations: three browsers × four modes × two widths × two forms |
| Motion | 21 grouped checks across all three browsers passed |
| Real Firebase/Supabase acceptance | 18 assertions passed using three disposable verified accounts |
| Live PostgreSQL teacher authorization suite | 20 checks passed in a rolled-back transaction |
| Geometry/source comparison | Exact tree JSON, including origins and indices, matched |

Actual browsers: Chromium **153.0.8010.12**, Firefox **155.0**, WebKit **26.6**, all clean headless Playwright contexts. Public checks use 360, 390, 430, 768, 900, 1120 and 1440px. Authenticated Chromium checks cover fourteen routes in all four modes at all seven widths; Firefox/WebKit cover home/editor/offering in all four modes at 390/1440px, plus mobile drawer behavior. Student views were checked with an actual enrolled disposable student. This is engine coverage, not a physical iOS/device test.

Real acceptance covered password sign-in, contextual organization ownership, private draft creation, title/slug/rich-text persistence, publication/visibility, stale-tab 409 guidance, cross-tenant/unauthorized page/API/direct-RLS edit denial, secure session cookie attributes, logout revocation, fresh login and missing-cookie session restoration. Firefox/WebKit loaded the real authenticated editor. Database checks cover anonymous, student, suspended, owner/admin, assigned staff and cross-tenant permissions; database authorization was not replaced with UI visibility checks.

Keyboard checks covered Escape, mobile menu/link closure, Radix dialog focus containment, trigger state/restoration and scrim closure. Reduced motion, observer fallback, font selection, RTL overflow, persisted theme/locale and readable black text on green fills were checked. Screenshot review found and fixed font-variable inheritance, drawer height, dark green-card text and fallback-preview middleware issues. A browser assertion and middleware regression test cover the latter two classes of error. No full automated WCAG audit or screen-reader session is claimed.

Disposable fixture cleanup completed: three Firebase users revoked/deleted; three Supabase profiles, two organizations, one course, one module, one lesson, one offering and one enrollment removed using recorded IDs and guard assertions in a transaction. Zero test courses/organizations/profiles remained. The private manifest was rewritten without passwords/tokens. Existing accounts, test data and security policies were preserved.

## Running and rechecking

Use the existing local Firebase/Supabase development configuration and `npm run dev`; open `/design-preview` for the public reference and `/sign-in` for the real application. Do not substitute demo account data. The temporary acceptance servers on 3131/3132/3133 are stopped after verification.

With Playwright and its browser engines installed, the committed optional scripts can target an already-running test server:

```powershell
$env:EDULABS_TEST_URL = 'http://localhost:3000'
node scripts/edulabs-browser-acceptance.cjs
node scripts/edulabs-motion-acceptance.cjs
```

If Playwright is outside this repository, set `PLAYWRIGHT_MODULE_PATH` to its module location. No dependency was added just to run local acceptance. Scripts write ignored artifacts and require no credentials. Authenticated acceptance needs explicitly authorized disposable fixtures and the existing protected Admin setup; private fixture manifests are intentionally not committed.

## Deliberate omissions and review decisions

Demo localStorage users/passwords, fake sessions, demo projects, checkout, quotas, prices, endorsements, active teacher domains and nonfunctional waitlists were excluded. Public cards explicitly say concept/coming soon. Support honestly opens a draft in the existing email application flow. Existing real footer contact links and creator credits were preserved; their suitability for the EduLabs launch needs owner review.

Actual Google OAuth completion, delivery of verification/reset emails and a physical mobile Safari run were not exercised; their existing implementations were retained. Commercial copy/pricing, whether to make the public page the future `/` route, launch contacts and final screenshot approval remain owner decisions. No reproducible overflow or hydration defect remains in the tested matrix. Exact animation curves were ported and lifecycle behavior tested, but frame-by-frame perceptual identity is not claimed.

The branch is ready for owner review and a separately approved local-main integration. It has not been merged.

## Commit stages

- `a70c2e9`: tokens, fonts, exact tree, preferences and translation foundation.
- `5ade81c`: public/auth/LMS presentation integration and reusable motion architecture.
- `f15b680`: RTL, dark contrast, drawer/error/search refinements, fallback preview fix and regression test.
- Final acceptance commit: this report, README pointer and reusable browser/motion scripts (its hash is reported in the task completion).
