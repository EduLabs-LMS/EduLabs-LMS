# Selective Continue Learning port — clean teacher foundation

Source fix: d96c40ed794c0687a4d7a4167744c1ba17f91db5; target base fa67875fdab88f0fc640804e2f96b6aa7c44b0c1.
No teacher redesign was imported. Runtime changes use the baseline presentation.

Root cause: a dispatched router.refresh was incorrectly used as acknowledgement of
a new read. Cached Back/restoration could retain stale proofs indefinitely, and one
shared dirty flag could consume another page's invalidation. Completion also cleared
other overviews' invalidation. Exact Next internals were not proven to be a framework bug.

Each successful save now advances a bounded generation. Each overview independently
uses server proofs or one scoped awaitable API read, keyed to generation, source and
organization/offering. Effect cleanup aborts/ignores abandoned or obsolete results;
failures settle into visible retry. No polling/global refresh/arbitrary delay was added.
Completion still uses the existing lesson-local refresh, plus revision evidence.

The new handler requires verified Firebase context and existing exact-origin CSRF,
strict UUID-only selectors, a 1,024-byte body limit, private/no-store responses and the
existing RLS-bound loadWebsiteScope/resumeLearning projection. No identity parameter,
service-role key, database write or migration. The extra bounded read has query/count
cost; initial current proofs need no additional read. Truncated data stays unavailable.

Port adaptations: add resumeOfferingId to the original website-pages call without
preview/redesign code; preserve the harness URL-wait correction and new cancellation/
ordering scenarios; replace post-merge documentation with this baseline-specific report.
No applied migration, repository/service or shared recommendation contract was changed.

Three independent production Next fixture runs passed 14 scenarios each, using actual
App Router/HTTP/player/components with synthetic identity/data, including Back, completion,
late/out-of-order responses, 1,203 history rows under a 1,000-row ceiling, 409/503 handling,
revoked access and 25 overlapping navigations. These are not live Firebase/Supabase tests.
See teacher-ui-clean-foundation-review.md for final application/build/SQL evidence.
