# Part 4: Groups, sessions, attendance and the online class

Read-only audit. No code, migration, test or config was changed. Nothing ran against the VPS or any Supabase project. All evidence
comes from a disposable local PostgreSQL 17.10 on loopback (port 54874, own data folder), started with `-c timezone=UTC` (hosted runs
UTC, A0-12). It was built from the 52 migrations in this tree, as in the earlier parts, and deleted afterwards. All people are
synthetic users. Branch `claude/backend-audit`, head before this part `5a6d1d18cda7ba2d83261d1fa74ac8e366266a1c`, date 2026-11-17.

**Fixture.** One teaching space with one course run: 10 Groups, 400 students (40 per Group), one owner, an assistant on Group 1 and
one on Group 2, a year of weekly sessions (1,040 sessions) and 41,600 attendance rows; a second space with one student and one
owner. Numbers are medians of 7 warm calls unless a range is given.

Findings are numbered `A4-nn` in [FIX_LIST.md](FIX_LIST.md). The owner's answers of 2026-11-16 to the Part 3 questions were recorded
in FIX_LIST first (A3-03, A3-04, A3-11 decided; A3-07 deferred; the other A3 fixes confirmed for V1).

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| A4-01 | Medium | A student's Home card, Groups list and an assistant's Home check **every Group on the platform one by one**, about 10 to 18 ms each (five permission lookups per Group). 11 Groups: 104 ms; 31: 0.4 s; 61: 1.1 s. The planner only sometimes avoids it (it did at 111 Groups and up in this test), so the cost is not predictable. A prototype that looks at the caller's own Groups first returns the same rows in 19 ms at 61 Groups. |
| A4-02 | Medium | Any signed-in person can start a 12 to 23 second query by reading the Group tables directly (`session_attendance`, `group_sessions`, `group_memberships`). The hosted 8 s limit cancels it, but each call burns 8 s of a database core. **No code reads these tables directly**, so the grants can simply go. |
| A4-03 | Low | Reading a Group page, Home or a join takes a write lock on the Group and holds it until the read ends. 40 students of one Group opening the page at 6 PM: 30 ms alone, median 0.54 s, last one 0.86 s; a student read also waits behind a teacher's attendance save in that Group. The same read lock on the session makes "Join" and "open the sheet" wait behind a save of that session. |
| A4-04 | Low | Lock order differs between a teacher's Home read (locks Groups by id) and a transfer (locks from-Group, then target): proven to deadlock (`40P01`) with a held lock. Not reproduced by a natural 8 s run. |
| A4-05 | Note | A weekly slot between 00:00 and 00:59 on the Friday Egypt's clocks go forward (2027-04-30) is skipped without a word to the teacher. |
| A4-06 | Note | Dead and duplicate code: the same `stream_label` update written twice in `group_command`, the legacy Clerk Groups route and queries, the LiveKit npm packages. |
| A4-07 | Note | A class link is valid until the end of its window (up to 30 minutes after the class) even if the student is suspended meanwhile, and a copied link works for anyone. Accepted limits of a token-only meeting; recorded so the owner can accept them. |
| A0-04 (re-checked) | Medium | Unchanged and confirmed: every attendance save, finish, reopen and session change still takes the whole run `FOR UPDATE`. In practice the hold is 11 to 35 ms; the problem is scope. The fix and its proof are below. |

**No High finding.** No student, assistant or other space could read another Group's attendance, open a class they should not, or
change attendance after it was finished without a reopen (security section).

## Scope and live versions

| Object | Live version |
| --- | --- |
| Tables `study_groups`, `group_staff`, `group_memberships`, `group_schedules`, `group_sessions`, `session_attendance` (RLS on, `SELECT` for `authenticated`, no write grant) | `20261014054726_complete_group_attendance_workflows.sql:112-128` |
| `private.group_audit` (RLS on, no grant) | same file, :95 |
| `private.can_manage_group`, `private.can_view_group` | same file, :98-109 |
| `private.materialize_group` (:136), `private.snapshot_group_roster` (:158) | same file |
| Trigger `group_enrollment_interval` (an enrollment change opens/closes Group memberships) | same file, :388-406 |
| `private.group_command` / `public.group_command` | `20261018100132_group_presentation_and_session_summary.sql:7` (replaces :170 of the first file) |
| `private.group_view` / `public.group_view` | `20261106120000_listing_performance.sql:18-147` (after :310 of the first file, `20261018100132:165`, `20261105120000:17`) |
| `private.live_class_rooms`, `private.live_class_joins`, `private.live_class_open`, `private.live_class_joined` | `20261119120000_live_class.sql:43-144` |
| Triggers `exam_window_freeze`, `exam_link_new_group`, `exam_link_new_session` | `20261114120000_exams.sql:292-340` |
| Triggers `notification_session`, `notification_group_details`, `notification_group_join` | notification triggers, replaced in `20261119120000_live_class.sql` |
| Server: `app/api/study-groups/route.ts`, `server/http/groups.ts`, `server/services/groups.ts`, `server/http/group-course-run.ts`, `shared/contracts/groups.ts` | the app reads and writes Groups only through `group_view` and `group_command` (no direct table access found) |
| Live class: `app/api/live-class/open/route.ts`, `app/api/live-class/joined/route.ts`, `server/http/live-class.ts`, `server/services/live-class.ts`, `server/services/live-class-provider.ts` (token), `shared/live-class.ts`, `frontend/features/live-class/class-view.tsx` | the token is signed in `live-class-provider.ts:37-48` |

Not in this tree any more: the old LiveKit route (`/api/livekit`) exists only in an ignored old build folder (`.next-after1`).

## A4-01: Medium, performance

**Home, the Groups list and an assistant's Home read every Group on the platform, one permission check per Group.**

`group_view` builds the list of Groups the caller may see with
`select … from study_groups listed where listed.id in (candidates) and private.can_view_group(listed.id)`
(`20261106120000:82`, the `upcoming` and `list` sections). The candidates are already the caller's own Groups, but the planner may
run `can_view_group` over every Group first and then intersect. Each `can_view_group` call costs about 10 ms because it resolves the
caller again inside every helper (per call about 36 lookups of the caller and 16 organization-role checks).

Proof (a student of one Group; call counts from `pg_stat_user_functions` with a fresh connection per call):

| Groups on the platform | Student Home "upcoming" | Groups list | Owner Groups list | `can_view_group` calls |
| --- | --- | --- | --- | --- |
| 11 | 104 ms (6 ms after `ANALYZE`) | 114 ms | 100 ms | 11 |
| 31 | 0.39 s | 0.40 s | 0.33 s | 31 |
| 61 | **1.08 s** | 1.11 s | 0.92 s | 61 |
| 111 / 161 / 211 | 28 / 36 / 5 ms | 64 / 85 / 10 ms | 92 / 100 / 40 ms | few |

Reading the table: with a stale or small-table plan every Group is checked (the call count equals the number of Groups on the
platform, not the caller's one); once the planner's statistics make it start from the caller's own Groups the cost disappears. The
change of plan happened between 61 and 111 Groups here, **but it is a planner choice, not a guarantee**: a student's Home read
(every student, every visit) can cost 1 s at 60 Groups, and the pooled connection's generic plan (Part 0, "plan flip") makes the
choice worse, not better. At about 18 ms per Group the hosted 8 s limit would be reached near 450 Groups if the bad plan stays.

Same operation on the whole read path of the assistant: 148 ms at 11 Groups (an assistant's candidate list is the whole space).

**Prototype** (throwaway database, nothing committed): resolve the candidate list first as a materialized set, then check only
those. Same rows, measured at 61 Groups:

| Caller | Today | Candidates first |
| --- | --- | --- |
| Student of 1 Group | 1,081 ms | 19 ms |
| Student (large space) | 1,078 ms | 19 ms |
| Owner of 10 Groups | 883 ms | 33 ms |
| Assistant of 2 Groups | 1,122 ms | 223 ms (each `can_view_group` still costs about 20 ms; the caller must be resolved once per statement) |

**Fix (part of the shared "my scope" fix, A0-01 + A0-07 + A1-01 + A3-05).** `group_view` asks the "my scope" function for the
caller's Groups once and filters by it; `can_view_group` and `can_manage_group` read the once-per-statement caller instead of
resolving it five times. Add `group_view`'s `upcoming` and `list` sections to that fix's proof list.

## A4-02: Medium, performance and hardening

**Any signed-in person can start a query that runs 12 to 23 seconds against the Group tables.**

The six Group tables have `SELECT` for `authenticated` and policies that run `can_view_group` or `can_manage_group` on every row
(`20261014054726:120-128`). `count(*)` through the Data API (proof, as the named person):

| Caller | `session_attendance` (41,600 rows) | `group_sessions` (1,050) | `group_memberships` (402) |
| --- | --- | --- | --- |
| Student of the space | **22.9 s** | 12.1 s | 3.3 s |
| Student of another space (sees nothing) | 11.9 s | not run | not run |
| Owner | 8.3 s | 4.1 s | 1.25 s |

The hosted `statement_timeout` of 8 s cancels these, so the failure is not an outage, but every call spends 8 s of a database core
and a loop of them fills the 60 connections (A0-06). **No page reads these tables directly**: `grep` finds no `from('study_groups'
| 'group_sessions' | 'session_attendance' | 'group_memberships' | 'group_schedules' | 'group_staff')` and no `/rest/v1/` path to
them in `app`, `server`, `frontend` or `scripts`.

**Fix (recommended, technical): revoke `SELECT` on the six tables from `authenticated` and drop the six policies**, as A0-02 did for
content writes. The functions are `SECURITY DEFINER` and keep working. If the owner later wants Supabase Realtime on a Group
table, give it a narrow policy then. Ships with the A0-02 change.

## A4-03: Low, lock

**Three read paths take write locks.**

1. `materialize_group` runs `select … from study_groups where id=… for update` at the start of every call
   (`20261014054726:138`), and `group_view` calls it from the Group page (every section), from the Home `upcoming` card (up to 100
   Groups) and from the sheet. It then does nothing in all but one read a day (a Group's schedule is topped up once per day). The lock
   is held until the **read** ends, so readers queue.
   *Proof:* 40 students of one Group open the page at once: alone 30 ms; together min 183, **median 535, max 859 ms**. Home "upcoming":
   111 ms alone, 491 to 735 ms together. A student opening the page waits for a teacher's attendance save in the same Group (a held
   save: 697 to 715 ms).
2. `snapshot_group_roster` locks the session `FOR UPDATE` even when the roster is already saved (:158-160), and the sheet read calls
   it. A teacher opening the sheet of a session that someone is saving waits (691 ms against a held save), which is correct for a
   write and wrong for a read.
3. `live_class_open` takes the session `FOR SHARE` (`20261119120000:91`), so a student pressing Join waits behind a save of that
   session's attendance (741 ms against a held save). A student joining a different session of the same Group does not wait (46 ms).

**Fix.** (1) Check without a lock whether the schedule is due and take the lock only then: `if not exists (select 1 from
group_schedules where group_id=p_group and active and materialized_through < today+90) then return;`. Prototype (throwaway
database): 40 students opening the Group page: median 256 ms, max 267 ms (from 535 and 859). The rest is the read's own CPU (A4-01).
(2) Return early when `roster_at` is set, before the lock; take the lock only to create the roster. (3) Use `FOR KEY SHARE` in
`live_class_open`; it only needs the row not to be deleted. Ships with A0-04.

## A4-04: Low, lock order

**A teacher's Home read and a transfer can deadlock.**

`group_view('upcoming')` locks the caller's Groups one after the other in id order and keeps every lock to the end
(`materialize_group`, A4-03). `group_command('transfer')` locks the run, then the from-Group, then the target Group in the order the
teacher chose (`20261018100132:27` and :97). A read that holds the lower id and waits for the higher meets a transfer that holds the
higher and waits for the lower.

*Proof (held lock):* the reader holds the first Group; a transfer from the later Group to it starts; the reader asks for the later
Group: `40P01 deadlock detected`, the transfer was the victim. A natural run (5 teacher Home reads against 3 students moving
between Groups for 8 s, 605 calls) produced **no deadlock**: the window is a few milliseconds. The A4-03 fix removes the reader's
lock and so the cycle; as a second layer, `transfer` should lock the two Groups in id order.

## A4-05: Note, time zone

`materialize_group` creates sessions in Cairo local time (`20261014054726:136-155`). Tested against the 2027 rules:

| Local time | Result |
| --- | --- |
| Fri 2027-04-30 00:00 and 00:30 (spring forward 00:00 to 01:00) | **skipped** (no such time); no notice, no reschedule |
| Fri 2027-04-30 01:00 | kept |
| Thu 2027-10-28 23:30 (falls back; the time happens twice) | kept once, at the standard-time instant (21:30 UTC) |
| every other ordinary day | kept |

The skipped slot is written down in the code comment. A class at 00:30 on a Friday is rare and the day is one a year, so this is a
Note. **Recommended:** when a slot is skipped, create the session at the first valid time after (01:00) rather than none.

## A4-06: Note, dead and duplicate code (Part 9)

- `20261018100132` runs the same `update study_groups set stream_label=…, stream_icon=…` twice for `create` and `edit` (:106-108 and
  :154-156). The second is a copy that changes nothing. Harmless, but the second copy sits after the transfer branch, so a reader
  may think a transfer changes the label.
- `server/http/admin/groups/route.ts` (reached through `app/api/admin/groups/route.ts`) and `server/queries/groups.ts`, with the Clerk
  branch of `app/(dashboard)/(routes)/group/page.tsx`: the Clerk/Prisma Group screens, answered `false` under Firebase
  (`isFirebaseStaging`). Same family as A1-08.
- `@livekit/components-react`, `@livekit/components-styles`, `livekit-client` and `livekit-server-sdk` are still in `package.json`
  (lines 35, 36, 61, 62) with no import in the source; the route is gone. Decision recorded in `docs/ai/DECISIONS.md`.

## A4-07: Note, class links

A class link is a signed token (HS256, `live-class-provider.ts:37-48`): `aud`/`iss` the app id, a random room, `nbf` 30 s back,
`exp` at the end of the class window and never more than 3 hours ahead. Nothing in the token identifies the person except the
display name. Two consequences:

- A student **suspended or transferred during a class** keeps a working link until it expires (the database refuses a new token at
  once: proof below).
- A copied class link works for anyone who holds it until it expires.

This is how a token-only meeting works. The mitigations that exist: the database issues no token without the Group's
membership, the window and the Start by staff, the token lives at most 3 hours, and the page is `no-store` with
`Referrer-Policy: no-referrer`. **Recommended: accept** (the owner decides).

## Re-checked: A0-04, now with the Part 4 numbers (Medium, unchanged)

A held attendance save (40 marks) in Group 1; each other action run alone while it was held (a table from 15 probes, one at a time):

| Action during the save | Waited |
| --- | --- |
| Staff saves attendance in **another Group of the same run** | **711 ms** |
| Staff saves another session of the same Group | 622 ms |
| Teacher edits another Group; adds a session to another Group | 702; 732 ms |
| Teacher edits the same Group | 704 ms (then `PT409`, correct) |
| Teacher or student opens something that locks Group 1 (A4-03) | 691 to 715 ms |
| Teacher opens another session's sheet; a student of another Group; another space; a student joining another session | 36 to 134 ms (free) |

A real save takes **11 ms** with the connection open (35 ms with the connection setup counted); 10 Groups saving at the same
moment: wall 74 ms, median 44 ms, no error. So today's cost is small and the risk is scope: a slow thing under the run lock (the
join burst of A3-02, a reschedule, a schedule edit of 14 slots at 56 to 63 ms) makes every Group's attendance wait.

**Fix, with proof that it is safe.** Attendance, finish, reopen and session changes need the Group row and the session row, not the
run: a roster is dated (`starts_at <= session.starts_at and (ends_at is null or ends_at > session.starts_at)`,
`snapshot_group_roster`), so a transfer that commits just before or after the roster is taken gives the same dated result (proof:
R7 below; the transfer holds the run, the old Group's session mark waited 720 ms and was then accepted for the student who was in the
old Group at the session's start, and refused for the new Group's already-started session: `Student not in dated roster`). Take the
run `FOR NO KEY UPDATE` only for `add`, `remove`, `transfer` and `create` (capacity and one-Group-per-student need it), and not at all
for `attendance`, `finalize`, `reopen`, `session`, `one-off`, `edit` and `archive`. It must ship in the same change as A3-02 (Part 3).

## Security

| Check | Result |
| --- | --- |
| Public functions are invoker wrappers over `private` definer functions with `search_path=''`, caller from `private.current_app_user_id()` | yes for `group_command`, `group_view`, `live_class_open`, `live_class_joined` |
| RLS on all six Group tables, `private.group_audit`, `live_class_rooms`, `live_class_joins` | yes; no write grant on any (proof: `insert group_sessions`, `update session_attendance`, `delete group_memberships` as student and as owner: `42501`) |
| A student reads another student's attendance | no: 104 rows (own, finished sessions only), 0 of anyone else's |
| A student reads staff, audit or live-class room rows | `group_staff` 0 rows, `group_audit` and `live_class_rooms` `42501` |
| A student of a Group sees another Group's sessions | no: 1 Group visible |
| A student of another space or run | no Group, no session, no class (`Session unavailable`) |
| Staff of another Group or run | cannot open, start, mark or finish: assistant of Group 1 on Group 2's class `42501`, assistant of Group 2 on Group 1's `42501` |
| Class: before the start | student gets `early` and no token (opens 15 minutes before) |
| Class: waiting for the teacher | student gets `waiting` and no room, even when sending `start: true` |
| Class: moderator | only staff (`mod=true` for owner and the Group's assistant, `false` for students) |
| Class: window, cancelled, Own link and centre Sessions | `ended` after 30 minutes, `cancelled`, `Not an EduLabs class` |
| Class: suspended student | refused (`Session unavailable`) on the next call; a transferred student is refused for the old Group's class and admitted to the new Group's |
| Student calls `live_class_joined` (who opened the class) | refused (`42501`) |
| Token secret | read from `LIVE_CLASS_SECRET` on the server only (`live-class-provider.ts:19`); no `NEXT_PUBLIC`, not in the reply, no logging in the four live-class files (no `console` call) |
| Rate limit | 30 opens per person per minute, in memory per server process (`server/http/live-class.ts:16`); the 10 s waiting poll is 6 per minute |
| Attendance after finishing | refused by anyone (`PT409 Attendance finalized`); only a reopen by an instructor with a reason of 3 or more letters; the audit row keeps a SHA-256 digest of the sheet at finish and at reopen (the two digests matched in the proof) |
| Reopen / finish by an assistant | reopen `42501 Instructor required`; finish also requires an instructor |

## Races and locks that were run

Each pair ran with a held transaction (900 ms) so the order is certain, both orders where it matters.

| Pair | Result |
| --- | --- |
| **Suspend vs transfer of the same student** (the race Part 3 left open), both orders | the second call waits 0.7 s and then either succeeds in a consistent state or is refused (`PT409 Stale group`); the student ends suspended with their membership closed in every case |
| Suspend vs remove, both orders | same |
| Suspend vs add (add needs an active enrollment) | add refused `23514 Active eligible enrollment required` once suspended; an add that committed first is closed by the suspend |
| Direct enrollment update (A3-01) vs transfer, both orders | consistent; no deadlock either way (the `40P01` of A0-10 is the other order, against `student_administration`) |
| Stress: 6 workers, 7 s, random suspend / reactivate / transfer / add / remove over 30 students | 266 completed, 0 deadlocks, 0 students with an open membership while suspended or with two open memberships |
| Two transfers of the same student at once | second `PT409 Stale group` |
| Two staff save attendance on the same session at the same version | second `PT409 Stale session` after waiting; the page retries with the fresh version by itself (`attendance-view.tsx:205-213`) and the retry took 54 ms |
| Same student marked by two staff in turn | last write wins, both marks audited (4 audit rows) |
| Finish vs a mark at the old version | the mark is refused (`Stale session`), and at the fresh version `Attendance finalized` |
| Reopen vs a mark | refused at the old version, accepted at the fresh version once reopened |
| **Start class pressed by two staff at once** | one room, one `class_started` event, 40 notices; the second call waited 651 ms and got `startedNow: false` and the same room |
| Start class while 15 students tap Join | no error; students see `waiting` or `open` (one saw `waiting` because they asked before the commit) and all see `open` on the next poll: Start 87 ms, Join 86 to 103 ms |
| 40 waiting students poll while the teacher saves | polls 181 to 230 ms, none refused |
| 5 and 10 Groups of one run save attendance at the same moment | wall 38 ms and 74 ms, no error (A0-04: scope, not duration) |
| Teacher Home reads vs transfers (8 s) | 605 completed, 0 deadlocks (A4-04: possible, proven with a held lock) |

## Correctness and history

- **History is never rewritten by a Group move.** A transfer closes the old membership and opens a new one at the server's time;
  the dated roster of a started session never changes, and a student moved after the session started is still on the old Group's
  sheet (proof R7).
- **Schedule edits.** A schedule of 14 weekly slots creates 182 sessions in 63 ms; cutting it to 2 slots cancels the 180 future
  automatic sessions in 47 ms and keeps one-off and past sessions; going back to 14 slots is 56 ms. Sessions with a saved roster
  or a started class are never rescheduled (`Past session or saved roster immutable`).
- **Cancel and reschedule** are refused once attendance is finished or reopened (`Attendance already finalized`).
- **Time.** All times are `timestamptz`; Cairo is the only zone (a check constraint), shown in `class-view.tsx:15`. See A4-05.
- **The A3-04 decision (the reactivated student returns to the Group).** The fix must open a new membership interval at the
  reactivation time (so sessions held during the suspension stay off the student's record) and check the Group's capacity and
  status in the same transaction; if either fails, no Group and a notice for the teacher. Part 3's trigger already keeps the past
  interval.

## Checked and fine

- Wrapper/definer pattern, `search_path=''`, revokes and grants on every Part 4 function (listed above).
- All Group commands are version-checked and audited (`private.group_audit`), including the attendance marks, with the old values.
- `session_attendance` allows only the three statuses (`not_marked`, `attended`, `absent`) and cannot be written outside `group_command` (no grant, no policy).
- Attendance save: 100 marks at most per call, 40 marks in 11 ms; the sheet read (page 0 and 1) is 7 ms; members, eligible
  students (400-student run), history, audit sections are 7 to 8 ms; summary for the whole space (41,600 rows) 47 ms.
- A student cannot see attendance of an unfinished or cancelled session.
- The Group, session and enrollment triggers: `exam_window_freeze` and `exam_link_group` are deferred or skip locked exam rows; no
  lock cycle with Group commands was found in the stress runs.
- The class page asks again every 10 s only while `waiting` and sleeps until the opening time while `early` (`class-view.tsx:17-90`).
- The live-class join log records "a token was issued", never attendance; attendance is only what a teacher marks.

## Could not verify

- **The Jitsi server itself** (`infra/jitsi`, `compose.override.yml`, `web/custom-config.js`): guests off, token-only, 40 participants,
  recording off are read from the files, not tested against a running server. `docs/ai/ONLINE_CLASS_AUDIT.md` covers the server.
- **The hosted planner's choice for A4-01.** The point where the plan changed (between 61 and 111 Groups) comes from the local
  statistics after `ANALYZE`; hosted autovacuum timing and the pooled generic plan can move it. The fix does not depend on it.
- **Hosted hardware.** Timings are from a 20-core machine; the lock queues are the same, the CPU part (A4-01, A4-03) is longer on a
  small hosted instance.
- **Notices on schedule edits.** Cancelling 180 sessions created no notices in the throwaway database (the session notice trigger
  only reacts to changes of started or soon sessions); not checked against the real notification settings (Part 7).
- **The report side of A3-04** and the real Realtime use of the Group tables (none found in the repository; the Supabase
  dashboard was not checked).
- **Spring-forward day inside the 90-day window.** `materialize_group` was tested against the 2027 rules with the same expression
  it uses; no schedule can be created in the past, so the full function was not run on that day.

## How the proofs were run

1. A separate server (`.local/step03a/pg-data-audit4`, port 54874, `timezone=UTC`, `max_connections` raised) and database `audit4`,
   built from the bootstrap, the 52 migrations and the seed in the order `scripts/exam-sql-local.cjs` does.
2. Fixtures through the commands themselves (`group_command`) and, for bulk rows, direct inserts as the table owner: 10 Groups,
   400 students, 1,040 sessions, 41,600 attendance rows; Firebase-shaped synthetic claims signed in per person.
3. Reads and writes timed from node `pg` with the person's claims set (`set local role authenticated`), 2 warm-up calls then the
   median; helper call counts from `pg_stat_user_functions` with a fresh connection per call and `auto_explain` (nested statements)
   for plans. Timings taken with `track_functions='all'` are not quoted.
4. Locks and races: a held transaction (900 ms) started first, the second action started 150 ms later; `pg_stat_activity` and
   `pg_blocking_pids` for who waits for whom. Stress runs with 6 workers for 7 to 8 s.
5. The prototypes (candidate-first Group list; the pre-check in `materialize_group`) were installed in the throwaway database only.
6. The server and its data folder were stopped and deleted afterwards.
