# Continue Learning production App Router fix

2026-10-23. Base: `f1be2f808e437dd81df9ef62a2578b85be6e94a8`. Branch: `codex/integrate-teacher-panel-student-core`.

## Reproduction and root cause

The unchanged checkpoint failed two independent production-mode diagnostic runs at cached Back navigation. The actual progress POST returned 200/revision 2 and the local disposable database contained the saved position. The restored Home component still had revision-1 proofs and its previous server read ID. Its effect cleared the shared dirty marker, set `invalidatedData` to that old read ID and dispatched `router.refresh()`. No new data was committed to that component before the test timed out. The component therefore stayed in Loading with no request completion/error path that could settle it.

This is an application invalidation/lifecycle defect: dispatching a router refresh was treated as acknowledgement of a successful read. The shared boolean could also consume invalidation for another cached overview and could not distinguish consecutive saves while already true. Completion explicitly cleared that shared marker, relying on the lesson page's refresh to invalidate other pages.

The diagnostic logs include RSC cancellations and a Back `popstate`/restore followed by refresh. Installed Next 15.5.27's action queue prioritizes navigation/restore over pending work and its refresh reducer merges an asynchronous RSC payload; dispatch has no completion promise. **The exact internal cause of every absent/cancelled RSC commit is not established, and request cancellation during browser teardown is not proof it caused the initial stall.** This fix removes the application's dependency on that router lifecycle rather than claiming a Next framework bug or blaming the teacher redesign. The relevant Continue Learning implementation predates that redesign. An earlier successful baseline comparison did not establish reliability.

Separately, the harness used to navigate again before waiting for its previous destination. The integration checkpoint already added destination URL waits. Those waits do not cure the reproduced application stall. The new rapid-navigation scenario intentionally overlaps navigation and explicitly waits for the final destination instead of confusing an old page's content with the new page.

## Focused fix

- Each successful progress acknowledgement, including completion, advances a monotonic in-memory invalidation generation. The existing bounded map retains revision evidence (maximum 32 keys); it is not a progress database or persistent browser cache.
- Each Home/Self Learning overview acknowledges its own read. One page cannot consume another cached page's invalidation. Consecutive acknowledgements remain observable even while the legacy dirty boolean is already true.
- Continue Learning no longer invokes `router.refresh`, schedules an animation-frame refresh or waits indefinitely for a changed RSC read ID. If existing server props prove all acknowledged writes are present, they are reused. Otherwise the active overview makes one scoped, awaitable `/api/learning-overview` read.
- The read is tied to its effect lifetime, source props, organization/offering selection and generation. Navigation cancels it; obsolete results are ignored even if an already-completed response arrives after abort. A newer generation starts a new read. A failed response settles into the existing localized error/retry UI. There is no repeating timer, polling, arbitrary settling delay or automatic retry loop.
- The existing lesson-completion refresh remains for the lesson page's own server-rendered controls; **it is not used as the Continue Learning freshness mechanism**. Completion now also publishes revision evidence instead of clearing other overviews' invalidation.
- Organization and offering filters are carried through to the scoped read. Resume targets and completion remain projections of the existing authoritative progress/enrollment/content records. No client-fabricated completion or progress writes were added.

## Read authorization and bounded work

The new route is a small adapter to a server-only handler. It is Firebase/Supabase-mode gated, requires the existing verified application context, checks the existing exact-origin CSRF helper and permits only optional UUID organization/offering selectors. A client identity, extra fields, URL query parameters, invalid JSON, wrong content type and bodies over 1,024 bytes are rejected. Errors and successes are private/no-store. No permissive CORS configuration is added.

The handler reuses `getWebsiteContext`, `loadWebsiteScope` and `resumeLearning`. Supabase requests retain the authenticated identity and RLS; no service role is introduced. Unknown organization/offering scopes fail closed. Active tenant/course/publication/enrollment checks and offering-specific history are unchanged. Incomplete/truncated progress remains unavailable rather than an empty or partially completed recommendation. Real provider errors remain errors. The read does not update activity timestamps or stored progress.

The middleware permits only this exact new path; the handler supplies authentication/authorization, as with the existing API adapters. The Clerk fallback does not gain a Firebase data path. No migration, function grant, policy or database schema changed.

This costs an additional bounded projection read when stale cached server props need revalidation. `loadWebsiteScope` still performs its existing bounded queries and exact counts; exact counts have database cost. This is not claimed to have zero performance impact. Initial complete server data with no new acknowledgement needs no additional read. Updates while watching a lesson do not poll overview data. The result contains at most three recommendations and the existing bounded proof projection.

## Regression and acceptance evidence

Local-only data adapters and fixture controls are used throughout. The browser runs the real optimized Next 15.5.27 App Router, actual page functions/repositories, native video, real application HTTP validation and the new scoped handler. It does not authenticate against live Firebase or query connected Supabase.

| Check | Actual outcome |
| --- | --- |
| Unchanged checkpoint diagnostics | Two independent failures at cached Back; additional ignored queue/event diagnostics also reproduced the stall |
| Focused Continue Learning tests | 34 passed |
| Full application suite | 471 passed, 0 failed |
| Architecture checks | Passed |
| Explicit strict TypeScript | Passed, no incremental cache; isolated application project excludes generated local test apps |
| Lint | 0 errors; 9 existing warnings |
| Firebase/Supabase optimized application build | Passed |
| Component/native-video Chromium | 13 groups passed, including Arabic/English, light/dark, desktop/mobile, restoration, completion, HTTP errors and browser restart |
| Six independent optimized Next server/browser runs | 14/14 scenarios in **each** run; 84 scenario groups total; zero uncaught page exceptions |

Each independent run uses a fresh browser, fresh server process/loopback port and reset synthetic state. It covers:

1. Saved playback → cached Back → current Home recommendation, same browser document.
2. Ordinary client-side navigation to Self Learning after another save.
3. Part completion targets the next unfinished part.
4. Full lesson completion disappears from both previously visited overviews.
5. More than 1,000 progress rows under a lower provider ceiling preserve unrelated curriculum/offering/exam content and expose unavailable progress.
6. Incomplete Self Learning and course overview behavior.
7. Genuine provider/authorization failure and revoked access remain distinct from empty results; actual progress handler rejects the revoked fixture.
8. Mobile save acknowledgement arriving after navigation.
9. Unknown/bounded invalidation while another navigation overlaps.
10. A real overview response held before a later successful progress write, followed by a second read. The second response is released first and the old response last. Current selection and recommendation remain intact. Ordering uses explicit gates, not sleeps.
11. A forced 503 ends loading, shows retry and recovers. Exactly one request is issued for that invalidation; no polling.
12. Twenty-five deliberately overlapping Link clicks settle at the intended destination and current recommendation without a document reload.

The unit regression also checks consecutive generations while dirty, two independently cached overview instances, cleanup/abort, an obsolete result after a newer success, finite error/retry behavior, verified identity binding, strict selectors, cross-origin denial, body bounds, foreign scopes and sanitized provider failures. The component test deliberately supplies no `useRouter` implementation: this freshness path cannot depend on a router refresh.

The harness now removes its previous pass summary before running, so a failed repeat cannot leave a stale successful JSON result as current evidence. Synthetic delayed writes reread their state after the controlled delay, avoiding a test-adapter lost update. All generated controls, fixture sources, traces, logs and dependencies are Git-ignored under `.local/`; the production application cannot activate them.

## Exact source inventory

- `app/(dashboard)/_components/website-pages.tsx` — preserve offering selection in the resume boundary.
- `app/api/learning-overview/route.ts` — server-only handler adapter.
- `frontend/features/courses/lesson/secure-player.tsx` — retain invalidation evidence on completion.
- `frontend/features/self-learning/continue-learning.tsx` — scoped read lifecycle and stale-result protection.
- `frontend/features/self-learning/learning-overview-freshness.ts` — monotonic generations.
- `frontend/features/self-learning/student-learning.tsx` — pass organization/offering scope.
- `middleware.ts` — exact API path allowance.
- `server/http/learning-overview.ts` — verified, read-only, bounded projection.
- `scripts/continue-learning.test.cjs` — focused lifecycle/authorization regressions.
- `scripts/continue-learning-next.cjs` — production-mode cancellation/order/navigation stress tests and honest result cleanup.
- `docs/continue-learning-navigation-fix.md` — this report.
- `docs/teacher-panel-integration-review.md` — historical review follow-up pointer only.

## Evidence, preservation and limits

Ignored evidence: `.local/resume-baseline-1.log`, `.local/resume-baseline-2.log`, `.local/resume-queue-trace.log`, `.local/resume-independent-{1..5}.json`, `.local/resume-final-production.json` and corresponding logs, `.local/resume-final-check.log`, `.local/resume-strict-tsc.log`, `.local/resume-production-build.log`, `.local/resume-component-browser.log`.

No failure or nondeterministic result was observed in the six independent fixed-code runs. RSC prefetch request totals vary, as expected; assertions do not assume a fixed prefetch count. This demonstrates reliability across the tested schedules, not a universal browser/network guarantee. Firefox/WebKit and live provider acceptance were not repeated. A genuine network/provider failure continues to require the visible retry action; it is not hidden as an empty result.

The specific intermittent Continue Learning blocker is resolved within this local acceptance scope. Other private-staging gates in the integration report — real provider/email acceptance and deployment configuration — remain open. No claim of production readiness is made.

All 31 migration files remain unchanged. No connected database/provider changes, test identities, uploads or real data were used. Other worktrees, main and protected branches were preserved. The final focused local commit SHA is supplied in the completion response; no push, merge or deployment is part of this task.
