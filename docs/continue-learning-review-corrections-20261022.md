# Session 4 — focused independent-review corrections

Date: 2026-10-22 (Africa/Cairo).

Worktree: `C:/Users/Sky-II-14600kf/.codex/worktrees/student-settings/EduLabs-LMS`.
Branch: `codex/student-settings-language`.
HEAD remains `c46266f676ce09931d5002a045e9dc15216ac8aa`.
Everything remains local, unstaged and uncommitted. No provider, connected database,
environment, migration, protected branch, deployment or GitHub changes were made.

## Preservation

Before editing, all 18 prior source/report files and the original complete patch
were copied to the ignored `.local/session4-review-baseline/`. The historical
report has a superseding-review notice; its executed results remain recorded.
No reset, clean, stash, rebase, source replacement, commit, merge or push was used.

## 1. Truncation is a distinct result, not a provider failure

`completeProgress()` now returns `{ rows, incomplete }`:

- A successful response with an exact count matching the returned row count is complete.
- A missing, invalid or mismatched count is explicitly incomplete. Returned partial
  rows are discarded at the repository boundary; they cannot accidentally become
  a zero, completion percentage, last-activity selection or a complete summary.
- Supabase errors, null data and rejected network promises still fail. Authorization
  failures are not converted into a legitimate empty/incomplete result.
- Empty offering IDs produce a complete empty result without issuing a query.

`loadWebsiteScope()` separates `progressLimited` from `contentLimited` and retains
the aggregate `limited` flag. Either incomplete progress projection or an exceeded
existing progress sentinel causes **both** lesson and part progress to be discarded.
No completion is inferred from cached lesson summaries or a partial set of parts.

Home, Self Learning and course overviews gate curriculum visibility on content
completeness, independently of progress completeness. Their authorized courses,
published lesson cards, offering links and assessments remain accessible when only
progress is incomplete. Cards use **Open Lesson**, not a fabricated Completed or
Not Started status; chapter totals say **Progress overview unavailable**. Existing
missing-offering guidance remains separate. Continue Learning is explicitly
unavailable and offers retry. The notice is translated in English and Arabic.

The new unit and real-page tests simulate 1,203 caller-owned history records with
a PostgREST ceiling of 1,000, below the requested 1,001/5,001 result limits. They
verify discarded partial arrays, unknown progress, preserved course/lesson/offering/
exam information, exact identity filters, no extra queries, and no invented resume
targets. Missing metadata, genuine provider/authorization errors and network failures
have separate regression cases.

## 2. Actual Next.js client navigation and cache invalidation

The previous component harness uses a router adapter; it was **not** sufficient
evidence for Next's Router Cache. `scripts/continue-learning-next.cjs` therefore
builds a separate loopback-only Next **15.5.27 production** test application under
`.local/session4-review-next/`.

It imports the actual Website page functions, repository, scope loader, student
components, SecureLessonPlayer and progress HTTP handler. `next/link`, RSC,
hydration, `next/navigation`, history restoration and cache behavior are real.
Identity and database access are explicitly synthetic fixture adapters. The
generated fixture routes/configuration are ignored and cannot become routes in the
normal application. Child processes receive a small allowlisted environment, not
Firebase Admin credentials or application secrets. The server binds an ephemeral
`127.0.0.1` port and is stopped after testing.

### Finding and correction

Ordinary Link navigation can already fetch fresh data in Next 15. Cached Back
restoration did reproduce stale recommendations after a **confirmed HTTP 200 and
persisted synthetic progress save** with invalidation disabled. The controlled
baseline remains under `.local/session4-review-next-baseline*`; its Back test times
out waiting for the updated ordering. An earlier adapter-origin rejection was
corrected before that confirmed-write baseline was used; a rejected save is not
evidence of a caching problem.

Successful non-completion saves now record only bounded, ephemeral cache revision
markers. There is no second progress store: no positions, titles, grades, user
identity, localStorage, cookie or persisted academic data is stored by this helper.
Repeated saves of one offering/part coalesce to its highest acknowledged revision.
The helper retains at most 32 keys and falls back conservatively if that bound is
exceeded.

The server overview carries an opaque per-read UUID and up to eight recent
caller-authorized revision proofs. These are cache metadata, not authentication
tokens or timestamps used to order study activity. If the newly navigated payload
already proves every pending revision, no invalidation refresh is needed. If it
does not, only the active Home/Self Learning section withholds stale recommendations
and requests one fresh read. The refresh is deferred one animation frame to let a
restoring/streaming navigation commit; this is not polling. A new server read ID
acknowledges completion, rather than relying on overlapping transition flags or
React object identity. Retry remains available during a slow refresh. The existing
completion refresh is reused and clears pending markers, rather than adding a
second completion refresh.

If navigation moves away before the scheduled refresh, the invalidation is retained
for the next learning view. An incomplete overview stays explicitly unavailable;
it does not consume markers and leave another cached overview falsely current.
Failed saves never invalidate. No sidebar/layout-wide refresh effect or repeating
timer was added. Existing timers, save RPCs, CSRF, revisions, identity and RLS remain
unchanged.

### Real Next acceptance evidence

Eleven scenario groups pass:

1. Native playback/seek and acknowledged save, then cached Back to Home: updated ordering.
2. Another acknowledged save, then ordinary Link to Self Learning: fresh target.
3. Part completion followed by client navigation: next unfinished part.
4. Full lesson completion: removed from both previously visited overviews.
5. Large truncated history: Home retains course cards, offering and exam links;
   Continue Learning exposes no recommendation.
6. Large truncated history: Self Learning retains curriculum, unknown totals and no false completion.
7. Individual course overview remains usable despite incomplete progress.
8. Genuine authorization/provider failure remains a failure state, not an empty overview.
9. Revoked synthetic enrollment hides content and is denied by the real HTTP-handler
   validation pipeline with a synthetic authorization adapter.
10. Mobile save acknowledged **after** navigating back to Home: refreshed ordering.
11. Explicit synthetic unknown/bounded cache-invalidation probe during navigation:
    the fallback finishes without a full reload or stuck loading panel.

The desktop learning workflow asserts the same window witness and exactly **one
document navigation** through save, navigation and completion. The mobile workflow
also asserts no additional document load. The final five document requests recorded
in the results include deliberate full-page loads for separate failure/large-history
fixture scenarios; they are not reloads used to pass the SPA workflow.

## 3. Performance observations and limits

- Two existing progress requests still carry `count: 'exact'`; there are no extra
  database/HTTP queries just to detect truncation. Identity/offering filters and
  existing row bounds are preserved. Partial arrays are not sent to the browser.
- **Exact counts have a real database cost.** PostgreSQL must count the caller's
  qualifying rows under RLS, including rows beyond the response ceiling. That work
  is not bounded by the requested row limit and grows with matching history.
  Existing user/offering indexes support filtering, but do not make counting free.
  No hosted EXPLAIN, production latency benchmark or large-load SLO is claimed.
- Freshness metadata adds one read UUID and at most eight key/revision pairs to
  the RSC payload, plus a bounded in-memory invalidation map. Proof selection sorts
  only the already bounded complete part-progress result; it adds no database read.
- Already-fresh payloads avoid the extra refresh when their proofs cover pending
  saves. Cached/unknown cases can add **one RSC overview read per batch of pending
  mutations**, which repeats that overview's existing authorized queries. This is
  measurable additional work, even though it does not happen on each autosave.
  Missing/overflowed proofs may conservatively refresh an otherwise fresh page.
- `router.refresh()` clears Next's Router Cache as framework behavior. It is invoked
  at the affected learning destination, not globally on every route or save.
- Very large histories deliberately lose overview progress/resume summaries, not
  access to course content. A future indexed/paged resume projection could improve
  that limit, but requires separate database/API design and was not introduced here.

## 4. Verification

| Check | Result |
| --- | --- |
| Complete application tests | **407/407 passed**, including 30 Continue Learning cases |
| Strict TypeScript | Passed, nonincremental, actual successful run |
| Architecture | Passed |
| Lint | Zero errors; nine pre-existing warnings |
| Disposable native PostgreSQL | All 31 migrations replayed; all 23 SQL/RLS suites and existing concurrency suites passed |
| Real Next.js production fixture | **11 groups passed**, with confirmed saves and document-navigation assertions |
| Existing Continue Learning Chromium components | **13 groups passed** |
| Settings/Notifications components | **21 groups passed** |
| Appearance browser regressions | **24 groups passed** |
| Language/RTL browser regressions | **24 groups passed** |
| Firebase/Supabase production build | Passed |
| Clerk/Prisma fallback production build | Passed |
| Whitespace | `git diff --check` passed |

Relevant local evidence: `.local/session4-review-focused.log`,
`.local/session4-review-check-final.log`, `.local/session4-review-sql.log`,
`.local/session4-review-next-build.log`, `.local/session4-review-next-final.log`,
`.local/session4-review-next-repeat.log`, `.local/session4-review-next/results.json`,
`.local/session4-review-{components,settings,appearance,language}.log`,
and `.local/session4-review-build-{firebase,legacy}-final.log`.

The Next fixture build itself deliberately skips lint/type validation because of
test aliases; it is not counted as the TypeScript gate. The real application runs
strict TypeScript, lint and both full production builds separately.

Browser/backend adapters are synthetic. These results do **not** prove real Firebase
authentication, hosted Supabase queries/Storage, email delivery, push delivery,
physical-device behavior or Firefox/WebKit compatibility. Actual RLS and concurrency
are covered by disposable local PostgreSQL, not by pretending the adapters enforce
hosted RLS.

## 5. Exact inventory relative to the previous 18-file patch

Changed existing Session 4 files:

1. `app/(dashboard)/_components/website-pages.tsx`
2. `frontend/features/courses/lesson/secure-player.tsx`
3. `frontend/features/self-learning/student-learning.tsx`
4. `frontend/features/self-learning/continue-learning.tsx`
5. `frontend/locales/en.ts`
6. `frontend/locales/ar.ts`
7. `server/repositories/website.ts`
8. `shared/continue-learning.ts`
9. `scripts/continue-learning.test.cjs`
10. `scripts/lessons.test.cjs`
11. `scripts/website.test.cjs`
12. `docs/continue-learning-verification-20261022.md` — superseding-review notice only.

Newly modified pre-existing project files:

13. `server/services/website.ts` — completeness separation and bounded read acknowledgement metadata.
14. `shared/v2-learning-model.ts` — unknown progress with usable lesson links.
15. `shared/contracts/dashboard.ts` — optional unavailable-progress presentation flag.
16. `frontend/features/self-learning/self-learning-view.tsx` — accurate unavailable-progress label.
17. `scripts/student-portal.test.cjs` — complete the existing limited-scope fixture contract; original assertions retained.

Added in this correction:

18. `frontend/features/self-learning/learning-overview-freshness.ts`
19. `scripts/continue-learning-next.cjs`
20. `docs/continue-learning-review-corrections-20261022.md`

Unchanged from the previous Session 4 patch: the four Home/Self Learning loading/
error boundary files, `package.json` and `scripts/continue-learning-browser.cjs`.
There are 26 total modified/new source/report files against HEAD, of which 20
changed relative to that preserved 18-file baseline. Ignored runtime evidence,
generated Next fixture apps, logs, synthetic JSON state, media and stopped local
PostgreSQL data are not source changes.

## 6. Preservation, cleanup and remaining limitations

All migrations/SQL tests, Firebase/Clerk identity bindings, middleware, existing
progress HTTP/RPC code, RLS, Notifications/push/preferences, account/appearance/
language persistence, academic-stage APIs and hidden-selector behavior, teacher
permissions/editors, Exams, Homework and Website Studio remain intact. UI changes
are limited to accurate progress availability and learning refresh state.

The test servers/browsers are closed and the owned PostgreSQL cluster is stopped.
The SQL harness dropped only its own randomized disposable database. No hosted
accounts, records, objects or credentials were created, copied, modified or deleted.
The synthetic files and ignored failure diagnostics remain available for review.

Remaining limits are the intentional overview caps and exact-count cost, the
bounded-proof conservative refresh case, and lack of connected-provider/device/
load acceptance. Existing lesson-detail paging and external-video-provider seeking
limits are unchanged; this review does not claim unlimited-history playback
validation. No owner product decision or migration is needed for these corrections.
Ready for independent local review; no commit/push/merge/deployment was performed.

Review exports (Git-ignored): `.local/session4-review-corrections.patch` contains
the exact delta against the preserved Session 4 files; `.local/session4-review-complete.patch`
contains all current changes against HEAD, including new files. The original
`.local/session4-complete.patch` is retained unchanged.
