# Part 7: notifications, push, email, support tickets and background jobs

Audit only. Branch `claude/backend-audit`, started at `bb8973d2` (2026-11-18). No code, migration, test or config was changed. No
connected Supabase project, VPS, Firebase, Brevo or push service was touched, and no real email or push was sent. Every database proof ran on
a disposable local PostgreSQL 17.10 on loopback (`timezone=UTC`, all 52 migrations of this tree replayed), with hosted-like limits
(`authenticated` statement and lock timeout 8 s, `anon` 3 s, `max_connections` 60, `idle_in_transaction_session_timeout` 0, `service_role`
none). The server and every database were stopped and deleted at the end. Brevo was mocked in-process (a replaced `fetch`); nothing left the
machine.

## Summary

- 18 findings: 0 High, 6 Medium, 10 Low, 2 Note. Two carried an **Owner question** (A7-02, A7-13); both were answered on 2026-11-18 and are recorded in their sections. A7-06's fix was corrected the same day (Cloudflare Tunnel).
- **The security side is sound.** No user can read, mark or delete another user's notice or ticket (table, RPC, or as `anon`). A push
  endpoint can only point at five fixed provider hosts (18 attack strings refused). Only `service_role` can run the worker functions. A
  removed or suspended student stops receiving session notices and queued pushes at once. Ticket isolation, the 5-tickets/hour and
  60-messages/hour limits, and request-ID replay all held. Support text is drawn as plain text, so stored XSS does not work.
- **The weak side is volume and operations**, not secrecy:
  - A course publish sends one notice per lesson per student (62 lessons × 300 students = 18,786 rows in 0.6 s; × 3,000 students =
    186,186 rows in 6.7 s, close to the 8 s limit) and repeats on every re-publish (A7-01, A7-02).
  - The bell costs about 0.2 s of database time per open tab every 30 s and nothing is ever deleted (A7-03, A7-09).
  - Push drains at 50 a minute, so a class reminder is cancelled before most students get it (A7-04).
  - The worker is off by default and nothing watches it; session reminders exist only through it (A7-05).
  - With the deployed settings the password-reset limit is one global bucket: 200 requests in 15 minutes lock everyone out (A7-06).
- Time zones are not a problem: reminders use absolute instants (same result under UTC, Africa/Cairo and Pacific/Kiritimati).

## Inventory

All objects below were read in their **live** version (replay of all 52 migrations; live file named). `svc` = `service_role`, `auth` =
`authenticated`. No object has an `anon` grant. Table grants: `auth` has `SELECT` only on `notifications`, `notification_preferences`,
`support_tickets`, `support_messages` (RLS on); every `private.*` table below has all privileges revoked from everyone.

### Tables

| Table | Written by | Read by | Cleanup |
| --- | --- | --- | --- |
| `notification_preferences` | `notification_command('preference')` | owner (policy `preferences_read`) | none |
| `private.notification_events` | `emit_notification`, demo seeds | functions only | none (demo clear only) |
| `public.notifications` | `emit_notification` | owner, only rows that are `in_app` and `notification_current` (policy `notifications_read`) | none (demo clear only) |
| `private.push_subscriptions` | `notification_command('subscribe'/'unsubscribe')` | worker | none (rows are only set inactive) |
| `private.notification_deliveries` | `emit_notification` (per active subscription), worker | worker | none (`sent`/`failed`/`cancelled` stay) |
| `private.group_notification_state` | `emit_group_joining_notice` | functions only | none |
| `public.support_tickets`, `support_messages` | `support_command` | requester or staff (policies, `support_access`) | none |
| `private.support_audit` | `support_command` (create, reply, status, assign) | nobody | none |
| `private.support_requests` | `support_command` (idempotency) | nobody | none |
| `private.support_operators`, `organization_support_staff` | SQL only (no function, no grant, documented in `docs/trial-operations.md:47-52`) | `support_staff_for` | n/a |

### Functions (live file : who can call)

| Function | Live file | Callable by |
| --- | --- | --- |
| `public.notification_command`, `public.support_command` → `private.*` | 20261015185510:309, :337 | `auth` only (`anon` refused: 42501) |
| `public.notification_worker` → `private.notification_worker` | 20261119120000:254 | `svc` only (`auth` refused: 42501, proven) |
| `private.emit_notification`, `emit_group_joining_notice`, `revoke_session_notices`, `notification_business_event` (trigger) | 20261015185510:183, :222, :238; 20261119120000:190 | nobody (revoked from all roles; definer) |
| `private.emit_session_notice` | 20261119120000:171 | nobody |
| `private.emit_class_started` | 20261119120000:68 | nobody; called by `live_class_open` when the teacher starts a class (:112) |
| `private.notification_current` | 20261119120000:152 | nobody (called inside definers and the policy) |
| `private.notification_visible` | 20261015185510:152 | `auth` (only true for the caller's own current notice) |
| `private.notification_link` | 20261119120000:291 | nobody (checks `p_user = caller`) |
| `private.group_notice_hash`, `session_notice_hash`, `group_notice_recipient`, `group_notice_upcoming` | 20261015185510:120-139 | nobody |
| `private.support_access`, `support_contact_org` | 20261015185510:107, :111 | `auth` (both read only the caller's identity) |
| `private.support_staff_for` | 20261015185510:101 | nobody |

The trigger `notification_business_event` is attached to nine tables: `courses`, `lessons`, `lesson_segments`, `enrollments`,
`group_sessions`, `study_groups`, `group_memberships`, `private.homework_corrections` and `private.assessment_participations` (legacy,
retired by Part 6b). The new exams emit through `exam_result_notice` (20261114120000:599), which is Part 6a.

### Server, worker and infrastructure files

| File | Role |
| --- | --- |
| `server/http/communications.ts`, `server/services/communications.ts` | The one route `/api/communications` for notifications and support (Firebase mode only; origin, JSON, 16 KB body checks; error mapping: 42501 → 403, PT409 → 409, PT429 → 429, 23514/23502/23505/22P02/22003 → 400, else 503). `push-config` returns only the public VAPID key |
| `scripts/notification-dispatch.cjs` | The worker loop: `claim` (or `sweep`), `check`, web-push, `finish`; sleeps 30 s |
| `infra/worker.cjs`, `worker-health.cjs`, `worker.env.example`, `worker/package.json` | Wraps the dispatcher, writes `/tmp/worker-heartbeat`, health check reads it (< 180 s). Disabled by default (`NOTIFICATION_WORKER_ENABLED=false`, push off, compose profile `notifications`) |
| `compose.yaml:56-80` | Worker container (`restart: unless-stopped`, 384 MB, key from a secret file) |
| `infra/monitor.sh`, `edulabs-monitor.service/.timer` | Every 5 minutes: app container health and disk % only |
| `server/services/password-reset.ts`, `password-reset-email.ts`, `password-reset-limiter.ts`, `server/http/password-reset.ts` | Password reset by Brevo (Firebase makes the code; EduLabs sends the mail) |
| `server/services/invitation-delivery.ts` + migration `20261025100000` | Teacher invitation e-mail through Brevo; `platform_record_invitation_delivery` (5 attempts per invitation) |
| `server/services/storage-cleanup.ts`, `server/http/upload/check-limit/route.ts` | Legacy Prisma/UploadThing purge (dormant, A7-17) |
| `scripts/lms-storage-maintenance.cjs` | Operator-run Supabase storage cleanup (A7-16) |

No `pg_cron`, no scheduled function and no Edge Function exist in the repository (`supabase/functions` is absent; no migration mentions `cron`).

## Findings (worst first)

### A7-01 Medium, performance and noise: publishing a course sends one notice per lesson to every student

`notification_business_event` on `courses` (live 20261119120000:190-197, first written 20261015185510:247-252) loops over every published
lesson and calls `emit_notification` once per lesson, with the key `'course-publish:'||course||':'||new.updated_at||':'||lesson`. The
loop runs inside the teacher's `UPDATE courses`, so the course row stays locked for the whole fan-out.

**Proof** (course with 62 published lessons, all students enrolled, teacher's `update courses set status='published'`, authenticated, 8 s limit):

| Enrolled students | Notices written | Teacher's call |
| --- | --- | --- |
| 300 | 18,786 | 0.61 s |
| 3,000 | 186,186 | **6.75 s** (limit 8 s) |

Every student then has 62 unread "lesson published" notices at once. A course that goes draft → published again (the key holds
`updated_at`, which changes) repeats all of them.

**Impact.** A large course can reach the 8 s limit and fail the teacher's publish, after holding the course lock for seconds (A0-05 lock
class); students get a flood that buries real notices.
**Fix.** One notice per student per course publish ("new lessons are available") with one key per course and first publish; or, at most,
the lessons published after the course already had students. Do the fan-out outside the teacher's transaction: the trigger writes one
small job row and the worker fills notices in batches (same change as A7-11). Add `notification_business_event` to the A0-06
`lock_timeout` list.

### A7-02 Medium, product and noise: the same event can be announced again and again

The keys contain `updated_at` or the session version, so any new write is a new notice:

- Lesson: `'lesson:'||id||':'||updated_at` (20261015185510:268). Unpublish and publish a lesson three times: each of the two enrolled students
  went from 2 to **4** notices (8 rows for 2 students, proven).
- Session: each reschedule changes the hash and sends a new `session_details` notice to every member (old ones are hidden by
  `revoke_session_notices`, which works). Ten reschedules in a row, 300 members, all with push on: **3,310 notices and 3,010 push
  deliveries queued**, 2,709 of them cancelled only later by the worker; every push the worker had already sent before the next edit still reaches the student.
  Nothing limits how fast a teacher can do this.

Revocation itself is correct: a student sees only the newest revision (65 visible notices after ten edits, not 3,310), and queued
deliveries of a revoked event are cancelled at the next `claim` and again at `check`.

**Owner answer (2026-11-18): decided, option (a).** A lesson is announced once only (key without `updated_at`, also when it is unpublished and
published again). A class time change is announced for the newest time only, and push deliveries are created only after the session has been
stable for 2 minutes. (Options were: (b) again at most once an hour; (c) every time, today.)
**Fix (recommended, technical).** Lesson key without `updated_at`; for session changes, create deliveries only after the event has been stable
for 2 minutes and then only for the newest revision (the worker already re-checks at send time).

### A7-03 Medium, performance: every open bell costs about 0.2 s of database time, and the cost grows because nothing is deleted

The teacher frame polls `notification_command('list', {filter:'unread'})` every 30 s per open tab
(`frontend/features/teacher-frame/unread.tsx:7`; the notifications page polls the same way, `notifications-view.tsx:28`), only to read the
number. `list` counts every unread row through `notification_current` and builds 25 rows with `notification_link` (20261015185510:316).

**Proof** (one student of a Group, one school year of rows: 72 reminders + 72 class-started + 100 lessons + 40 homework + 8 exams = 292 rows, 148
of them still "current"; the rest are past sessions; statement run as that student):

| Rows kept | `list` first page | `list` page 6 | `select count(*) from notifications` (the RLS path) |
| --- | --- | --- | --- |
| 292 (1 year) | 180–208 ms | 1,450 ms | not measured |
| 1,168 (4 years) | 234–260 ms | 1,447–1,502 ms | 262–269 ms |

At 100 students with the page open, that is 100 / 30 s × 0.2 s ≈ 0.7 of a core; at 1,000 it is 6.7 cores, on the hosted database that
also serves every lesson and exam read. The cost is mostly fixed (the policy and `notification_current` run about 0.2 ms per row) and
grows with the kept rows.

**Fix.** (1) A separate `count` action for the poll: a stored counter or `count(*)` on an index of "visible" rows, no links. (2) Keep
`notification_current` out of the count: write the dead state when a session notice is revoked or has passed (the worker does it in the
same sweep) so the list filters on a column. (3) Compute `notification_link` for the 25 returned rows only (already so) and cache it.
(4) Retention (A7-09). Part of the "notification read and retention" group below.

### A7-04 Medium, reliability: push drains at 50 a minute, so class reminders are cancelled before most students get them

`notification_worker('claim')` hands out 25 deliveries (`limit 25`, 20261119120000:271) and `scripts/notification-dispatch.cjs:39` then sleeps
30 s. Throughput is 25 per 30 s = **50 per minute, 750 per 15-minute reminder window**. A reminder is only valid while the class has not
started (`notification_current`: `s.starts_at>clock_timestamp()`), so everything still queued at the start is cancelled by the next
`claim`/`check` and never sent.

**Proof.** 3,000 deliveries queued: the first `claim` took 0.85 s and returned 25 (the rest wait); 3,000 / 25 × 30 s = 60 minutes. A single
300-student Group: 6 minutes. Several classes at 16:00 (1,800 students over 20 teachers): 36 minutes. This applies only once push is
switched on (`NOTIFICATION_WORKER_PUSH=true`; off by default). In-app reminders are not affected: one `sweep` created 3,000 reminders in
0.84 s.

**Fix.** Loop at once while a claim returns a full batch and sleep only when it is empty; batch 200; send 20 in parallel; add a
per-provider cap. Add the numbers to `docs/ai/TESTING.md`.

### A7-05 Medium, operations: session reminders exist only if an optional, disabled-by-default container runs, and nothing watches it

- "Starts in 15 minutes" notices are created only by `notification_worker('sweep'/'claim')`. The worker is in the compose profile
  `notifications`, ships with `NOTIFICATION_WORKER_ENABLED=false` (`infra/worker.env.example:1`) and exits at start if not enabled
  (`infra/worker.cjs:2`). With it off (the default) no reminder is ever created; no screen, test or log says so. (Class-start notices and
  schedule notices do not depend on it: they are written by the teacher's action.)
- `infra/monitor.sh:4-6` checks only the `app` container's health and disk. The worker's heartbeat check (`worker-health.cjs`, stale after
  180 s) only marks the container `unhealthy`; Docker Compose does not restart or report an unhealthy container, and the monitor never reads it.
- `monitor.sh` only prints and exits 1 under a systemd timer: its own line says "External HTTPS alarms must be configured separately"
  (`edulabs-monitor.service`), so a failure is written to the journal and **nobody is told**.
- **Verified 2026-11-18 (owner's chat, VPS `docker ps`): the worker is NOT running on staging.** Only the 5 jitsi containers, `edulabs-staging-app-1`
  and `edulabs-staging-caddy-1` are up, so on staging no session reminder has ever been created. **Decided:** the worker is REQUIRED for V1;
  it stays off until the worker reliability group (A7-04, A7-05, A7-08) ships, then it is switched on with monitoring. Push
  (`NOTIFICATION_WORKER_PUSH`) stays off in every environment until then.
- The worker's database calls have no timeout (`supabase-js` fetch, `service_role` has no statement or lock timeout, A0-06): a hung call
  stops the loop; only the stale heartbeat shows it, with no restart.

**Fix.** Treat the worker as required when reminders are a feature: check it in `monitor.sh` (state, health, heartbeat age), restart on
unhealthy (`autoheal` or a healthcheck-aware restart), send the failure somewhere a person sees it (email or chat webhook), give the worker
an `AbortSignal.timeout` and a per-session `statement_timeout`. Add "worker running" to the V1 deployment checklist.

### A7-06 Medium, security (availability) and abuse: with the deployed settings the password-reset limit is one global bucket

`passwordResetRules` (`server/services/password-reset-limiter.ts:39-41`): 3 mails per address and 20 requests per client address in 15 minutes,
**and one shared bucket of 200 when no client address is known** (`password-reset.ts:39`). The client address comes only from the header named
in `PASSWORD_RESET_CLIENT_IP_HEADER` (`password-reset-limiter.ts:50`). That variable is in `.env.example:50` but **not in
`infra/web.env.example`**, the file the deployed `app` container uses, Unset, every request shares the one bucket.

**Proof** (limiter code run as-is):

| Case | Result |
| --- | --- |
| 300 requests for 300 different addresses, header unset | 200 accepted, then an honest user gets 429, "retry in 900 s"; repeat every 15 minutes = the reset flow is down for everybody |
| One victim address, a client with a valid address header | 288 emails a day (3 per 15 minutes), no daily cap |
| Server restart | the buckets are empty again (in memory, one process) |

Everything else about the reset is as designed: the reply is a 202 for every address; the account lookup, the link and the mail run after
the reply (`after`); the mail is sent only to an address that has an account; the link is built from `APP_ORIGIN` and a Firebase code (single
use, 1 hour) and is never logged (only fixed event names); the body is JSON to Brevo, so no header injection.

**Correction (owner's chat, 2026-11-18, verified on the VPS).** The first version of this fix said `x-forwarded-for`. That is wrong for this
deployment. Traffic reaches Caddy through the Cloudflare Tunnel (cloudflared to Caddy on loopback), so the entry Caddy appends to
`X-Forwarded-For` is the tunnel's own address, the same for every visitor. Setting `x-forwarded-for` would put everyone in ONE per-address bucket
of 20, which is worse than today.

**Fix.** Set `PASSWORD_RESET_CLIENT_IP_HEADER=cf-connecting-ip` in `infra/web.env.example` and make the deployment check fail when it is empty.
Cloudflare's edge sets that header to the real client (one value). It is trustworthy only because the origin is reachable through the tunnel
alone: verified on the VPS on 2026-11-18, `ss -ltnp` shows Caddy (docker-proxy) bound to `127.0.0.1:8080` and `127.0.0.1:8443` only; the only
public listeners are coturn on `51.195.252.97:443` (TURN). So add a **deploy check that Caddy's published ports stay on `127.0.0.1`** (Docker
port publishing bypasses `ufw`, so a changed `ports:` line would open the origin and let anyone forge the header). Also: stop counting a refused
request against the shared bucket; add a daily cap per address (about 10); keep the limiter in the database if a second web container is ever
added (today `compose.yaml` runs one).

### A7-07 Low, correctness: a second account on the same browser can never turn push on

`subscribe` refuses an endpoint that belongs to another user (20261015185510:331), and `unsubscribe` only sets `active=false` and keeps
`user_id` (:334). **Proof:** user 5 subscribed, then unsubscribed; user 6 on the same browser: "Subscription belongs to another account"
(42501), also after the unsubscribe. A family tablet or school computer where two students sign in never gets push for the second.
**Fix.** An endpoint is a secret only the browser has: let a different user take over the row (set `user_id`, deactivate the old owner's
deliveries); no one else can know the endpoint.

### A7-08 Low, reliability: a wrong or rotated push key turns the whole queue into dead letters, with no alert

`finish` marks status 400, 401, 403, 404, 410 and 413 as `failed` for good (20261119120000:287). A VAPID key problem returns 401/403 for every
send, so every queued delivery is dead after one try each (attempts 8 would otherwise take about two hours: 60 s, 120, 240, 480, 960, 1,920,
3,600, then failed, proven). `failed` rows are kept and nobody is told.
**Proof of the rest of the outbox** (all held): two workers running at once claimed 25 and 25 with **no overlap** (`FOR UPDATE SKIP LOCKED`);
a crashed worker's leases expire after 5 minutes and the rows are claimed again (attempts 1 → 2); a finish with an expired or wrong
lease is refused (PT409); 429, 5xx and a network error (status 0) return the row to `pending` with backoff; 404 and 410 set the
subscription inactive; 2xx is `sent`. The only duplicate risk is a crash between "provider accepted" and `finish`: one push repeats after 5 minutes.
**Fix.** Treat 401/403 as "stop the worker and alert", not a per-delivery failure; show counts of `failed` and `pending` older than 1 hour in the
monitor.

### A7-09 Low, growth: no notification, delivery, subscription or support-request row is ever deleted

No migration deletes from `notifications`, `notification_events`, `notification_deliveries`, `push_subscriptions`, `support_requests` or
`support_audit` (only the demo clear). Measured row sizes: notification 324 bytes, delivery 411 bytes (with indexes). For 20 teachers × 3
groups × 30 students (1,800 students), one school year at the volume above (about 292 notices a student): about **525,000 notices ≈ 170 MB**,
plus deliveries (one per notice per active subscription, up to the same count ≈ 215 MB with push on for all) and events. Not a failure at
this size, but A7-03 says what it does to reads. `support_requests` (every action's idempotency row) and inactive subscriptions only grow.
**Fix.** A weekly worker job: delete read notices older than 90 days and any notice whose event is revoked or past; delivery rows
(`sent`, `cancelled`, `failed`) older than 14 days; `support_requests` older than 1 day (same as A3-12); inactive subscriptions older than 30 days.

### A7-10 Low, correctness: notices that open nothing stay in the list and in the unread count

Lesson, homework, exam and approval notices are "current" for ever (`notification_current` returns true for every type except sessions). After the
lesson is unpublished, or the student's enrollment is suspended, the notice stays, counted as unread, with no link.
**Proof:** a student with 25 lesson notices kept all 25 and an unread count of 63 after the enrollment was suspended and after the lesson went back to
draft; the rows had `link: null`. Only the type is visible (no title, score or text), so nothing leaks, but the bell lies.
**Fix.** Make `notification_current` true only while `notification_link` would open something (or clean the row when its resource goes away);
exclude link-less rows from the count.

### A7-11 Low, lock: fan-out runs inside the teacher's action and grows with the Group

Measured in the teacher's own call (authenticated, 8 s limit), one online Group, Group edit with "apply to future sessions", one session
reschedule, add one student, publish one lesson, start a live class (every number a single call):

| Members | Edit link + defaults | Reschedule one session | Add one student | Publish a lesson | Start a class |
| --- | --- | --- | --- | --- | --- |
| 30 | 42 ms | 18 ms | 15 ms | 9 ms | not measured |
| 300 | 102 ms | 43 ms | 15 ms | 17 ms | 29 ms |
| 3,000 | **2,371 ms** | 836 ms | 16 ms | 88 ms | 466 ms |

A normal Group (up to about 300) is fine. Beyond that, an edit holds the run row (`group_command`, A0-04) for seconds, and every other write
in that run waits; per-session emits in `group_sessions` triggers re-scan all members once per changed session. Also, an exam, homework or
class action emits one row per student inside the same transaction (3,000 class-started rows took 0.47 s).
**Fix.** Same as A7-01: the trigger writes one job row, the worker fans out in batches of 200. Ships with A0-04 / A4-03 (those remove the run
lock from `edit`; this removes the time).

### A7-12 Low, performance: a staff member opening a ticket scans every profile on the platform

`support_command('get')` builds `assignees` with `select ... from public.profiles p where private.support_staff_for(t.organization_id,p.id)`
(20261015185510:349), one function call for every profile. With 20,000 profiles a staff `get` takes 100 ms (a student's `get` 1 ms) and grows
linearly.
**Fix.** Build the list from the three staff sources (active operators; owners and admins of the ticket's space; that space's
`organization_support_staff`), not from `profiles`.

### A7-13 Low, product: nobody is told when a ticket is opened or when a student replies

A staff reply notifies the requester (`support_reply`); a new ticket or a student's reply notifies no one (`support_command` creates no event
for staff). Tickets wait in a queue that someone has to open; the 48-hour response mark is stored (`response_due_at`) but nothing reads it
or warns.
**Owner answer (2026-11-18): decided, option (a).** The space's owner and admins get a bell notice when a student opens a ticket or replies to one.
**Fix note:** this needs a new notification type for staff (today every type is student-facing; `notification_link`, `notification_current` and
the preference list must learn it). (Options were: (b) also a daily email; (c) no one.)

### A7-14 Note, audit: support reads are not recorded; operators exist only through SQL

`support_audit` records `create`, `reply`, `status` and `assign` (proven: after two staff reads of a ticket and one list, the audit had only the
create rows). A staff member opening a student's ticket is not logged. Support operators and space support staff can only be added by a
database administrator in SQL (no function or screen), documented in `docs/trial-operations.md`. Ticket isolation itself was proven:
another student, a staff member of another space, and a teacher with no staff role were all refused (42501) on read, reply, status and assign.
Recommended: log `get` by a person other than the requester; give the platform administrator a function to add or remove operators with an
audit row.

### A7-15 Low, correctness: a Brevo "too many requests" (429) is reported as a permanent failure

`invitation-delivery.ts:96` and `password-reset.ts` map every 4xx to `rejected`. Proof (mocked Brevo): 400, 401 and **429** all give `rejected`;
500, 503 and a network error give `unconfirmed`. A rate-limited invitation is recorded `failed: provider refused` and the administrator must
send again by hand (at most 5 attempts). The timeout path is right: no verdict inside 15 s is `unconfirmed`, never repeated automatically,
because Brevo has no idempotency key. Also (not verified against Brevo): the provider reference accepted by `^[A-Za-z0-9_.:-]{1,100}$`
(`invitation-delivery.ts:99`) does not allow `<` or `@`, the shape of a Brevo message id, so the reference is probably always `null`.
**Fix.** 408 and 429 → `unconfirmed` (retry later); widen the reference pattern or store it hashed.

### A7-16 Low, operations: no scheduled storage cleanup, and the operator script refuses to run outside development

`scripts/lms-storage-maintenance.cjs` is safe: the candidate list is a view that excludes anything referenced by a lesson cover, block, part
video or thumbnail, resource or legacy answer (checked: six foreign keys, all six in `private.expired_media_uploads`); the claim update
re-checks status and the two references; an asset that is not `ready` can never become referenced; failures keep the archived row for the
next run (idempotent); it deletes no metadata. A teacher upload in progress has a future `upload_expires_at`, so it is never a candidate.
But it is run by hand, only prints and applies with `--apply`, and **throws unless `LMS_MAINTENANCE_ENV=development`** (line 7), so on a
production project it cannot run. Nothing schedules it. Not covered at all: storage objects with no row ("unregistered, manual review"), exam
uploads (the expired list for exams does not exist, A6a-04) and the avatar bucket.
**Fix.** Decided (owner's chat, 2026-11-18): production cleanup runs inside the worker (with the storage secret), scheduled; the operator script stays for development. Add the exam list with A6a-04; report orphans.

### A7-17 Note, dead code: the legacy 1.8 GB purge deletes the oldest files that are still in use

`checkAndPruneStorageIfNeeded` (`server/services/storage-cleanup.ts:94`) deletes the oldest ~1 GB of `submission` and `attachment` rows and
their UploadThing files once total use passes 1.8 GB, whether or not anything still uses them. `POST /api/upload/check-limit` runs it with
no sign-in check in the handler for the non-forced call (`server/http/upload/check-limit/route.ts:23-41`; only "force" checks a teacher), and
callers include the legacy attachment and homework-submission routes. In Firebase mode it is unreachable: `middleware.ts:78-79` answers every
unlisted `/api/` path with 503 (and the path is not in the allow-list). In legacy (Clerk) mode, any signed-in user could trigger it.
**Fix.** Delete the service and its three callers in the Part 9 cleanup (joins A2a-12 / A1-08). Decided (owner's chat, 2026-11-18): delete, as written.

### A7-18 Low, correctness: a reactivated enrollment sends another "account approved" notice

Found in Part 7 ("Seen"), now a finding. The enrollment notice key holds `updated_at`, so when an enrollment becomes `active` again after a
suspension (reactivation) the key is new and the student gets "account approved" a second time.
**Fix.** Key per enrollment and first approval only. Notification fan-out group; covered by the A7-02 decision (announce once).

## Fix groups

| Group | Findings | Notes |
| --- | --- | --- |
| **Notification fan-out** (new) | A7-01, A7-02, A7-11, A7-18 | One change: the trigger writes a job row, the worker fans out in batches; keys without `updated_at`; debounce session pushes. Ships with the lock group (A0-03/04/05, A4-03): add `notification_business_event`, `emit_*` and `live_class_open` to the A0-06 `lock_timeout` list |
| **Notification read and retention** (new) | A7-03, A7-09, A7-10 | A cheap `count`, a "current" column, a weekly cleanup |
| **Worker reliability** (new) | A7-04, A7-05, A7-08 | Batch loop, monitor and alert, 401/403 handling; bound the service-role calls (A0-06) |
| **Email** (new) | A7-06, A7-15 | Deployment setting plus limiter change; mapping change |
| **Support** (new) | A7-12, A7-13, A7-14 | Staff list, who is told, audit reads |
| Direct-access group (existing) | none | The tables here already have `SELECT` only |
| Part 9 cleanup (existing) | A7-17 (with A2a-12, A1-08) | Remove legacy purge |
| Stand-alone | A7-07, A7-16 | |

## Checked and fine

- **RLS and RPC isolation.** A student read 0 of another student's notices, could not update or delete (42501), `read` with another's id changed
  nothing, `read-all` touched only their own. Preferences are own-only. `anon` was refused on both tables, all three commands, the worker and the private
  tables (42501).
- **Push endpoints.** The `subscribe` pattern allows only `fcm.googleapis.com`, the two Mozilla hosts, `*.notify.windows.com` and
  `web.push.apple.com`. Refused (23514): lookalike hosts, user-info, ports, `http`, upper case, newline, fragment, IP address, a second-level
  host under `notify.windows.com`, spaces, over-long. `../` in the path is accepted, but the host cannot change. The worker sends a fixed
  payload `{"type":"edulabs-update"}`; no title, name, score or answer ever reaches a push. A user cannot read other keys or endpoints (no
  grant), 10 active subscriptions per user, and the endpoint belongs to one user.
- **Worker rights.** `public` and `private` `notification_worker` are executable by `service_role` only (an authenticated call: 42501). The key
  is read from a secret file in the worker container only (`worker.cjs:3`, `compose.yaml:62-85`); the browser never sees it.
- **Revocation.** A student removed from a Group lost the session notices at once (list: 1 → 0) and the queued delivery's `check` returned
  `valid:false`; a revoked event's deliveries are cancelled; turning a type's push off cancels pending deliveries; both switches off creates no
  notice and consumes no event key.
- **Dedupe of reminders.** Two sweeps made one reminder per student (300 → 300); a session at +12 minutes got reminders, at +16 minutes none.
- **Time.** Reminders and `notification_current` use absolute instants (`clock_timestamp()`, hash from epoch seconds). The same sweep under
  `UTC`, `Africa/Cairo` and `Pacific/Kiritimati` produced identical results. The only DST issue is the weekly slot at 00:00-00:59 on the day Egypt's clocks
  go forward, already A4-05.
- **Support.** Another student, another space's owner, a teacher without a staff role, and a student setting a ticket to IN_PROGRESS or assigning
  themselves were refused (42501). A student cannot open a ticket for a space they do not belong to. 5 tickets an hour (the 6th: PT429).
  Replaying a request ID returns the same ticket; a changed payload with the same ID is refused (23514). Message bodies are rendered as plain
  text (`support-chat.tsx:209`; no `dangerouslySetInnerHTML` in any support or notification file); there are no attachments.
- **Email.** The reply is identical for every address; real work is after the reply; links come from `APP_ORIGIN`, never a header; HTML is
  escaped; nothing logs an address, code or link (fixed event names); `redirect:'error'`, an 8 s fetch timeout and a 15 s race; a missing
  key sends nothing.
- **Preferences.** Push default off, in-app default on. Existing in-app notices stay when in-app is switched off later (by design).
- **Storage script.** Safe and idempotent (A7-16); it cannot delete a referenced file.

## Could not verify

- Whether the **production** server will run the worker (staging does not: verified 2026-11-18 from the owner's chat, `docker ps`, see A7-05). Dev: not yet known; the owner will check.
- Brevo's real replies (429 body, message id format) and real web-push provider replies; both were mocked or read from code.
- Whether the browser's push subscription survives a sign-out (A7-07 is proven in the database, not in a browser).
- Whether Firebase's own endpoint can send a reset mail to an address directly, bypassing this limiter and its caps (Part 9, Firebase
  settings).
- Real traffic: bell and reminder numbers are from one local core.

## Why "Caddy adds X-Forwarded-For" no longer matters

It was listed as unverified. It does not matter: in this deployment the entry Caddy appends is the Cloudflare Tunnel's own address, so it could
not identify a visitor anyway. The header to use is `cf-connecting-ip` (A7-06), and the only thing to verify is that Caddy's ports stay on
`127.0.0.1` (done on 2026-11-18, and now a deploy check).

## Seen, belongs to Part 8/9

- Part 8: demo seed notices whose `resource_id` matches nothing (already carried in FIX_LIST, 2 on dev). The demo seed inserts notification
  rows directly (`20261116120000:122-128`), so it bypasses `emit_notification`.
- Part 9: `/api/upload/check-limit`, `/api/support` and `/api/courses/*/attachments` legacy routes; the origin check shared by every route
  (`validFirebaseOrigin`); the service-role key use of the worker (limits only: A0-06).
- Part 6a: `exam_result_notice` emits one row per released student inside the settle (A6a-10).
- Part 3 / now A7-18: an enrollment turning `active` again (reactivation) sends another "account approved" notice (the key holds `updated_at`).

## How the proofs ran

A disposable PostgreSQL 17.10 (embedded binaries from `.local/step03a/runtime`, data directory in the session's scratchpad, port 54899,
`timezone=UTC`, `max_connections=60`, `idle_in_transaction_session_timeout=0`). The 52 migrations were replayed in file order exactly as
`scripts/exam-sql-local.cjs` does (bootstrap, seed before `complete_lesson_workflows`, the rest). Role settings: `authenticated`
`statement_timeout=8s`, `authenticator` 8 s and `lock_timeout=8s`, `anon` 3 s; the harness also sets 8 s statement and lock timeouts inside each
authenticated transaction (a role setting does not follow `SET ROLE`). Each experiment ran in a database cloned from the clean replay.
Users were the seed's fixed identities plus synthetic students (`Student N`, ids `11000000-…`, one external identity each, inserted without
triggers; the measured actions then ran through the real functions: `group_command`, `edit_course_structure`, `live_class_open`,
`notification_command`, `support_command`, `notification_worker` as `service_role`). The two-worker race used two connections. The email
limiter and the Brevo mapping were the repository's own TypeScript run with Node's type stripping against a replaced `fetch`; no network. No
real key, token or address appears in any file. Timing is the median of 3 runs where "x–y" is shown; single numbers are one run. The server
and all databases were stopped and deleted at the end.
