# Online class: audit (branch `claude/online-class`, from `claude/reports` at d3f340e, 2026-11-14)

What sessions, `mode` and `join_url` do today, what the student and teacher screens show, where Start/Join would go, and the
questions the owner must answer before the draft migration is written. Server side: `docs/ai/ONLINE_CLASS_RUNBOOK.md`.

## 1. The data today

**`public.study_groups`** (`20261014054726`): `mode text check in ('online','center')`, `location`, `join_url text not null
default ''` checked by `private.valid_group_meeting_url` (empty, or `https://` + an ASCII DNS name, no IP literal, no userinfo,
≤ 2000 chars), `instructions`, `status active|archived`, `version`. A centre Group needs a location; **the database does not
require a link for an online Group** (empty is allowed). The teacher form does require one today
(`shared/teacher-groups.ts`: `form.mode === 'online' && !validGroupMeetingUrl(joinUrl)` is a problem).

**`public.group_sessions`**: each Session copies `mode`, `location`, `join_url`, `instructions` from its Group when it is
created (weekly materialisation `private.materialize_group`, one-off, reschedule). `applyMeetingDefaults: true` on `edit`
re-copies them onto unstarted, uncancelled, automatic draft Sessions only. `cancelled`, `attendance_state draft|finalized|
reopened`, `roster_at`, `version`, `starts_at`/`ends_at` (≤ 24 h). Nothing records that a class was started or who joined.

**`public.session_attendance`**: `status not_marked|attended|absent` per (session, user), filled from the dated roster by
`private.snapshot_group_roster` the first time staff read the sheet or save a mark. Writes only through `group_command`
(`attendance`, `finalize` instructor-only, `reopen` instructor-only with a reason). Reads: staff of the Group; a student sees
their own row only when finalized.

**Who is who** (`private.can_manage_group`): space owner/admin, course owner/instructor, run instructor
(`can_manage_offering`), or a run assistant **listed in `group_staff` of that Group** (`can_support_offering` + `group_staff`).
`private.can_view_group` adds a student with a current membership of an **active** Group (started, not ended), an active,
unexpired, started enrollment in the run, and `is_enrolled` (published course, active run and space). A student moved to
another Group has `ends_at` set on the old membership and loses the old Group at once.

**RLS:** students read `group_sessions` (including `join_url`) of Groups they can view; there is no table write grant.
`group_view` returns Sessions with `join_url` to staff and students (`upcoming`, `sessions`, `detail`).

**Notifications** (`20261015185510`): event types are fixed by a check constraint on `notification_preferences.event_type`
and `private.notification_events.event_type`: `account_approved, lesson_published, session_details, session_starting,
exam_released, homework_released, support_reply` (mirrored in `shared/contracts/communications.ts` with their labels).
`session_details` (the joining information changed) and `session_starting` (the reminder job, "Your online session starts
soon") exist **only for online Sessions with a non-empty `join_url` that have not started yet**: `group_notice_upcoming`,
`emit_session_notice` and `notification_current` all require `s.join_url<>''` and `s.starts_at > now`. Each person's
preference has In-app (default on) and Push (default off); `emit_notification` respects both. The link of a session notice
is `/groups`.

## 2. The screens today

| Where | What it shows for an online Session | Start / Join today |
| --- | --- | --- |
| Teacher Home, Happening now / Next session card (`frontend/features/teacher-home/home-view.tsx`, `NextSession`) | Group, title, time, "Online" or the place; Take attendance (live), Open group | None |
| Teacher Group page, Sessions tab (`frontend/features/teacher-groups/group-view.tsx`, session row) | State pill (Ongoing), Take attendance / Open, row menu (cancel) | None |
| Teacher Group page, Details tab | "Join link" with the URL as an outside link | Opens the teacher's own link in a new tab |
| Teacher Create / Edit Group (`group-form.tsx`) | At a centre / Online; Online asks for a join link (required) | — |
| Take attendance (`frontend/features/teacher-attendance/attendance-view.tsx`) | Rows: name, Present / Absent; Mark the rest present (never overwrites) | — |
| Student Home, Next class card (`frontend/components/upcoming-session.tsx` via `student-home.tsx`, `useGroupSessions('upcoming')`) | Date, Group name, countdown | **None** (no link on Home) |
| Student Groups page (`/groups`, `frontend/features/groups/group-workspace.tsx`) | "Next class", Online, and `<a href={join_url} target=_blank>Join class</a>` when the Session has a link | Opens the teacher's Zoom/Meet link in a new tab, at any time |

The student pages are the retained V2 student design; the Groups page and the Home card are the two places a student looks
for the next class.

## 3. Findings

1. **Today's "Join class" is an outside link with no window and no record.** Anyone who can view the Group can open it at any
   time; nothing is logged, nothing reaches attendance. That stays as it is for "Own link" Groups.
2. **An EduLabs class Group will have an empty `join_url`,** so with today's functions it gets **no** `session_details` or
   `session_starting` notifications, and the "Class started" notice cannot reuse them unchanged (they also require
   `starts_at > now`, while "Class started" is sent after the start). See question 2.
3. **The Groups endpoint files are pinned to the baseline** (DECISIONS.md, Create Group), and `group_command` is a large shared
   function. The new choice and the start/join reads go through **new** functions and new routes, not edits to
   `group_command`, `group_view` or `/api/study-groups`.
4. **EduLabs sets no Content-Security-Policy or Permissions-Policy** for app pages (Caddy sets `nosniff` and
   `Referrer-Policy: no-referrer`), so an `<iframe allow="camera; microphone; display-capture; fullscreen; autoplay">` of the
   meet host works without header changes. The meet host only allows being framed by the EduLabs origin (`CSP_HEADER
   frame-ancestors` in `jitsi.env`).
5. **Jitsi's "wait for host" cannot do what we need with tokens:** its prosody module counts **any** verified-token user as a
   host, and it works through the lobby, which the owner wants off. So "students wait for the teacher" is enforced by EduLabs:
   the join route gives a student no token until a teacher or assistant has pressed Start for that Session (the server keeps
   `started_at`). Jitsi then sees only people EduLabs let in.
6. **Moderator from the token** works through prosody's `token_affiliation` (`context.user.moderator: true` -> room owner, any
   other token -> member), with `ENABLE_AUTO_OWNER=0` and `DISABLE_GRANT_MODERATOR` so a student never becomes moderator.
7. **Unrelated security finding, not changed:** `app/api/livekit/route.ts` (`server/http/livekit/route.ts`) mints a LiveKit
   publish token for **any room and any name** from query parameters, with no sign-in or authorization check. It only works if
   `LIVEKIT_*` variables are set (they are not part of the documented deployment). It should be removed or gated in its own
   change; owner decision.
8. Rate limits: the only limiter is `server/services/password-reset-limiter.ts` (in-memory fixed windows, hashed keys, bounded).
   The start and join routes will reuse `createLimiter` with their own rules (per person; see the plan).

## 4. The plan (after the owner's answers)

- **One provider seam:** `server/services/live-class-provider.ts` is the only file that knows Jitsi (token claims, meeting URL,
  IFrame script URL). Settings `LIVE_CLASS_PROVIDER=jitsi`, `LIVE_CLASS_URL`, `LIVE_CLASS_APP_ID`, `LIVE_CLASS_SECRET` (server
  only, never `NEXT_PUBLIC_*`). Any missing -> "not configured": Start/Join and the "EduLabs class" choice are hidden, Own link
  works as today.
- **Draft migration** (one file, not applied): the Group's choice (`edulabs` or `link`), a private per-Session room record
  (random room key, `started_at`, `started_by`), a private join log (session, student, first and last join, count), and
  functions in the usual pattern (private security definer, `search_path=''`, caller from `private.current_app_user_id()`, public
  invoker wrappers, `authenticated` only): `live_class_start(session)`, `live_class_join(session)`, `live_class_joined(session)`
  (staff only, for the attendance sheet), `set_group_class_kind(group, version, kind)` (instructor of the Group). The window is
  checked in the database: from 15 minutes before `starts_at` to 30 minutes after `ends_at`, never for a cancelled Session or an
  archived Group.
- **Routes:** `POST /api/live-class/<sessionId>/start` and `POST /api/live-class/<sessionId>/join`: Firebase staging only, exact
  origin, sign-in, UUID, empty strict body, rate limit, then the database decides; the server signs the token (HS256, `aud`/`iss`
  = app id, `sub` = meet host, `room` = that Session's room key, `nbf` now-30 s, `exp` = the window end (at most 3 h ahead),
  `context.user` = `{ name, moderator }`, no email, no id) and returns `{ meetingUrl, room, token, scriptUrl, displayName,
  moderator, endsAt }` with `Cache-Control: no-store`. A student before the start gets `{ state: 'waiting' }` (no token); outside
  the window `{ state: 'closed', opensAt }`.
- **Class page** inside EduLabs: Jitsi IFrame API, full screen on a phone, a clear Leave, "Open in a new tab" fallback.
- **Teacher UI:** Start class on Home's live/next card and on the online Session row; EduLabs class / Own link in Create/Edit
  Group. **Student UI:** Join on the Home next-class card and on the Groups page; "Waiting for the teacher"; the time it opens.
- **Attendance:** "Joined online" on the sheet, pre-marked Present (question 3).
- **Demo data:** seed version 9: the demo online Group becomes an EduLabs class Group with a one-off Session starting just after
  the fill (Start works at once for the demo teacher).
- **Tests:** SQL (who, window, cancelled, moved, suspended, other space, join log), unit (token, room binding, moderator, no PII,
  secret never sent, rate limit, routes), browser harness with a stub IFrame API (both looks, light/dark, en/ar, phone/desktop).

## 5. Questions for the owner (answer before the migration is written)

1. **Existing online Groups.** New online Groups default to "EduLabs class". For online Groups that exist already: (a) a Group
   that has a link stays "Own link" and a Group with no link becomes "EduLabs class" (recommended: nobody's Zoom/Meet link stops
   working), or (b) every online Group becomes "EduLabs class".
2. **"Class started" notification.** (a) A new notification type "Your class has started" with its own In-app and Push switches
   in Notifications settings (recommended; needs the two check constraints widened in the migration and the labels in English
   and Arabic), or (b) reuse "Your online session starts soon" (`session_starting`) for it, so students have one switch for both.
   Also: should EduLabs class Sessions also get the existing "joining details changed" and "starts soon" reminders (today they go
   only to Sessions with a link)?
3. **"Pre-marked Present".** (a) When the teacher opens Take attendance, students who joined and are still "not marked" are
   saved as Present by the teacher's own screen (the same save as "Mark the rest present": recorded as the teacher, never
   overwrites a mark, never finishes the sheet) (recommended), or (b) the database marks the student Present at the moment they
   join (the student's own action writes attendance; the sheet must already exist).
4. **Recording notice.** Jitsi can tell everyone in the class when the teacher starts local recording
   (`ENABLE_LOCAL_RECORDING_NOTIFY_ALL_PARTICIPANT`). Students are likely minors: (a) notify everyone (recommended, set in
   `jitsi.env.example` now), or (b) no notice.
5. **Not blocking, needed for the server:** the domain (`meet.` and `turn.` hostnames), the VPS public IP, and approval to create
   a Cloudflare API token limited to DNS edits on that zone (for the TURN certificate without port 80). And what to do with the
   unauthenticated `/api/livekit` route (finding 7): remove it in its own change?
