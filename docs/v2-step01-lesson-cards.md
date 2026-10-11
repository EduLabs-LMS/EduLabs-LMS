# V2 port — Step 01 lesson cards

## Scope and source

Implemented on `codex/v2-step01-lesson-cards`, branched from the clean visual-redesign HEAD `6201ce87cd7851f23232f8473ccb5317b6d42526`. The `codex/edulabs-visual-redesign` branch is preserved. Local launchers/configuration remain ignored and were not changed by this step.

Only `EduLabs-Step01-LessonCards-REVISED.zip` was inspected and extracted into a fresh temporary directory. Its `README-FIRST.md`, `CODEX-PROMPT.md` and three payload files were read. The original EduLabs-v2 archive was neither accessed nor imported.

The packet's V2 card is the visual authority for this area. The earlier redesign is retained outside the target lesson section, not used to recolor or reshape these cards. All three payload files were copied without changes; their hashes matched the supplied files before staging.

## Changed files

| File | Purpose |
| --- | --- |
| `frontend/features/courses/lesson-card.tsx` | Supplied shared V2 card, unchanged |
| `shared/lesson-card-model.ts` | Supplied numbering/status/module-label helpers, unchanged |
| `scripts/lesson-card-model.test.cjs` | Four supplied tests, unchanged |
| `app/(dashboard)/_components/website-pages.tsx` | Imports and `WebsiteCourse` lesson-section rendering only |
| `frontend/features/courses/lesson-cards.module.css` | Local isolation from previous application color/heading overrides |
| `scripts/lesson-card-integration.test.cjs` | Six additional rendering/mapping/guard tests |
| `docs/v2-step01-lesson-cards.md` | This report |

No dependency, database schema, RLS policy, migration, repository query, auth implementation, layout, teacher metadata editor or unrelated route changed. All 16 migrations remain present. `/home` continues to represent offerings; `/self-learning` continues to list courses.

## Real data mapping

`WebsiteCourse` keeps its existing verified Firebase identity and server-side authorized Supabase scope. Queries still run with the caller's JWT and RLS, with their existing allowlists, bounds and deterministic `position,id` ordering.

The display set contains only published lessons whose parent module is in the authorized scope. `lessonNumbersByModule` runs once over that set. Module identity, never module title or a legacy chapter bucket, determines numbering. Each module then renders its own lessons in repository order. Two modules with the same title therefore both start at 1.

| Card input | Source |
| --- | --- |
| Module label | Real module title through `moduleDisplayLabel`; blank titles use `Module N` |
| Lesson number | Number returned for that lesson ID by the supplied helper |
| Title | Authorized `lessons.title` |
| Status | Supplied helper with selected offering ID + lesson ID progress match |
| Description | Omitted; the repository has no lesson description in this read model |
| Image | Omitted; no authorized ready-to-display lesson image is currently supplied |
| Parts count | Explicit `null`; no block-count query was added |
| Destination | Omitted; no functional authorized NEW-LMS lesson-player route currently exists |

Without a selected offering, every displayed card says **Published**, even if progress exists in another offering. With an authorized selected offering, its own completed/in-progress/not-started state is used. A missing progress row maps to **Not Started** only in that selected offering. Unknown statuses do not imply completion. Invalid or inaccessible offering selections still reach the existing not-found guard.

Existing real estimated durations remain as captions outside the cards. Empty caption space keeps cards aligned where a duration is unavailable; no duration or parts count is invented.

## Visual fidelity and interaction

The unchanged component retains its module/lesson top label, title hierarchy, optional description, footer, status icon/pill, 2px black border, 16px radius, 20px padding, 200px minimum height and 3px hard shadow. Its optional link hover/active/focus behavior and optional image-error fallback remain intact.

The previous application's broad `.edu-app` rules would otherwise recolor white/slate utility classes and replace bold card headings with display typography. The local CSS Module restores only the supplied card's utility colors and heading inheritance inside the lesson section. It does not edit global styles. In dark mode, the V2 cards intentionally remain white with black text/outline, as supplied; the surrounding page retains its current dark theme.

The actual integration emits plain articles with no anchor, pointer/hover invitation, image overlay or parts badge. Future consumers may use optional props only when real authorized data/destinations exist. The packet's English card labels are retained unchanged; no unrelated translation work was added in this step.

## Verification

| Command/check | Actual result |
| --- | --- |
| `node --test scripts/lesson-card-model.test.cjs` | All four supplied tests passed |
| `node --test scripts/lesson-card-model.test.cjs scripts/lesson-card-integration.test.cjs` | All ten tests passed |
| `npm run check` | Existing 60 tests, architecture boundaries, TypeScript and lint passed; lint has 0 errors and the same 8 existing warnings |
| Firebase/Supabase production build | Passed using isolated `.local/step01/firebase` output and process-only acceptance origin |
| Live Supabase reads | Eight assertions passed using real verified Firebase JWTs/publishable key; anonymous/cross-tenant private reads denied, drafts hidden and own progress returned |
| Authenticated browser screenshots/checks | Clean Chromium 153.0.8010.12, real disposable student sign-in, 390/1440px, light/dark; four before combinations and eight grouped after assertions |

The production build command was `node .local/step01/run.cjs firebase build`. The ignored runner invokes the existing Next.js production builder and filesystem preload with an isolated dist directory/tsconfig, leaving the normal development server and tracked configuration alone. No production configuration changed. A new Clerk fallback runtime/build was not claimed for this narrow step; its implementation is unchanged.

Additional integration tests exercise the actual `WebsiteCourse` element tree with controlled authorized scopes: duplicate-titled module numbering, published display filtering, no fabricated optional props, exact offering/lesson progress matching, no-offering status, missing titles, empty data, authentication/not-found guards and the supplied component's optional-image error fallback. Test-only optional URLs never appear in application data or routes.

Live browser checks used two modules with identical `Foundations` titles with two published lessons each, plus a draft lesson that students could not read. Offering A had completed/in-progress states; Offering B had different progress for the same lessons. The tests verified the switch, **Published** without an offering, no links/images/parts badge, white card surface, hard black shadow, bold title, equal card heights, no horizontal overflow and no captured JavaScript/hydration errors. A different tenant's private course and an unknown offering showed the existing not-found state with no cards. Next.js may stream that not-found UI with an HTTP 200 shell; the check verifies the actual denied content, not an assumed status code.

Only Chromium was exercised for Step 01. No Firefox/WebKit, physical-device or full accessibility-audit claim is made. The optional image surface has no real authorized media fixture; its error fallback was unit-tested, and absence of images was browser-tested.

## Screenshot comparison

Screenshots use the same real authenticated course, student and selected offering before/after. Their records were synthetic development fixtures, not customer data. Both full-page and lesson-section captures remain ignored under `.local/step01/screenshots/`.

| State | Before | After |
| --- | --- | --- |
| Desktop light | `before-cards-light-1440.png` | `after-cards-light-1440.png` |
| Mobile light | `before-cards-light-390.png` | `after-cards-light-390.png` |
| Desktop dark | `before-cards-dark-1440.png` | `after-cards-dark-1440.png` |
| Mobile dark | `before-cards-dark-390.png` | `after-cards-dark-390.png` |

The before view is the existing compact text/status/duration list. The after view uses the supplied V2 cards, with independently restarted numbering and real selected-offering status pills. Other course sections and navigation retain their previous presentation. No separate original-V2 screenshot was supplied or accessed; fidelity is established against the unchanged supplied component, local computed-style assertions and actual course screenshots.

## Preservation, cleanup and handoff

Acceptance data was created with three disposable verified Firebase accounts and authorized application endpoints/JWT requests: two organizations/courses, three modules, six lessons (including a draft and the private second-tenant lesson), two offerings, two enrollments and three offering-specific progress rows. No schema changes or legacy records were involved. Cleanup is limited to the exact recorded fixture IDs/keys, with ownership, identity and unexpected-child guards; existing accounts/data are preserved. Cleanup completed: no fixture profiles, organizations, courses, lessons or progress remained. All three Firebase accounts were revoked/deleted, and the ignored manifest was rewritten without credentials/tokens. The temporary acceptance servers were stopped; existing development servers were left running.

No lesson playback, chapter editor, homework, exam, group mutation, contact cleanup, carousel or site-wide redesign was started. Step 01 is complete and awaits owner review; Step 02 requires separate approval. No merge, push or deployment is authorized by this report. The final implementation commit hash and cleanup outcome are recorded in the task completion.

