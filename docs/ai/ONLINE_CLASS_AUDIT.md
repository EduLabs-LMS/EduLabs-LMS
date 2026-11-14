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
7. **Unrelated security finding:** `app/api/livekit/route.ts` (`server/http/livekit/route.ts`) minted a LiveKit publish token
   for **any room and any name** taken from query parameters, with no authorization check beyond being signed in: in the Clerk
   fallback build the middleware's `auth.protect()` requires a Clerk session; in Firebase mode the middleware answers 503. It
   worked only if `LIVEKIT_*` variables were set (not part of the documented deployment). **Removed** on the owner's instruction
   in its own commit, together with its only consumers, `frontend/components/media-room.tsx` and the legacy `/channel` page. The
   `livekit-*` npm packages stay in package.json (removing them changes the lockfile; a separate cleanup).
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

## 5. Questions asked before the migration (answered in section 6)

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

## 6. The owner's answers (2026-11-14)

1. **Existing online Groups keep their links.** An online Group with a link stays "Own link"; an online Group with no link
   becomes "EduLabs class". New online Groups default to "EduLabs class".
2. **"Class started" is a new notification type** ("Your class has started") with its own In-app and Push switches, English and
   Arabic labels. EduLabs class Sessions **also get the existing "starts soon" reminder**, pointing to Join instead of a link.
   "Joining details changed" is not sent for them (there is no link to change); time changes keep the existing session notices.
3. **Pre-mark (a):** the teacher's own Take attendance screen saves joined, not-marked students as Present, recorded as the
   teacher, never overwriting a mark and never finishing the sheet. **A student's Join never writes attendance.**
4. **Recording notice: notify everyone** (`ENABLE_LOCAL_RECORDING_NOTIFY_ALL_PARTICIPANT=true`).
5. **Server:** `meet.edulabs-eg.com`, `turn.edulabs-eg.com`, public IP `51.195.252.97`. The Cloudflare API token (Zone > DNS > Edit
   on `edulabs-eg.com` only) is approved; the owner creates it and stores it in `/etc/letsencrypt/cloudflare-turn.ini` (root, 0600;
   runbook step 7 reads it without echo and nothing prints it). **`/api/livekit` is removed** in its own commit on this branch.
   The EduLabs origin for the meeting page's `frame-ancestors` (owner, later the same day): `https://staging.edulabs-eg.com` for
   now, as a list so production can be added (`CSP_HEADER` in `jitsi.env.example`, runbook step 16).

## 7. Known limits (Jitsi stable-11248-3, read from the sources on 2026-11-14)

The owner asked that students cannot record, share a screen or open the whiteboard, with server enforcement where Jitsi has
it. What Jitsi actually enforces, and what it does not:

| Action by a student | Server-side rule in Jitsi? | What we do |
| --- | --- | --- |
| Become moderator | **Yes.** Moderator only from a token with `moderator: true` (prosody `token_affiliation`); no auto-owner; moderators cannot grant it (`DISABLE_GRANT_MODERATOR`). | EduLabs signs `moderator: true` only for the Group's staff. |
| Join before the teacher | **Yes, in EduLabs.** No token is issued to a student until staff pressed Start (Jitsi's own wait-for-host treats every token holder as a host and needs the lobby, so it is not used). | Join route + database. |
| **Open (create) the whiteboard** | **Yes.** Creating it writes the room's metadata, which prosody accepts from moderators only (`mod_room_metadata_component`: `if occupant.role ~= 'moderator'`). | Whiteboard button hidden for students too. |
| **Draw on the whiteboard once the teacher opened it** | **No.** Jitsi has no view-only whiteboard and no moderators-only drawing setting (`config.whiteboard` has only `enabled`, `collabServerBaseUrl`, `userLimit`, `limitUrl`, `storageBackendUrl`; `userLimit` caps people, not drawing). | Accepted: students can draw. The teacher can close it. |
| **Share a screen** | **No.** jicofo accepts a screen source at source-add (it only caps the number of video senders). Desktop moderation exists, but a moderator must switch it on in each meeting from the participants list; there is no room default for it, and the IFrame API cannot do it (`toggle-moderation` turns anything but `'video'` into **audio** moderation). | Share-screen button off by default and added only for staff (display only). Phone browsers (Android Chrome) cannot share a screen at all. On a laptop a student who edits the page address could share; the teacher can stop it (mute the student's video, or remove them). |
| **Local recording** | **No.** Local recording runs entirely in the recorder's own browser; any participant with desktop Chromium can start it when it is enabled. `ENABLE_LOCAL_RECORDING_SELF_START` only hides the "record only myself" choice (it maps to `disableSelfRecording`); no setting limits recording to moderators, and the record path checks no token feature. The only server-wide switch, `DISABLE_LOCAL_RECORDING`, would take it from the teacher too. | Kept on for the teacher. Record button off by default and added only for staff (display only). **Everyone is notified** when local recording starts. Phone browsers cannot use local recording. Nobody can stop a person recording their own screen with their device's tools. |

Option recorded, not taken: prosody documents a room flag `av_can_unmute = false` that turns on audio, video **and** desktop
moderation when the first moderator joins. Using it needs a small custom prosody module (the flag has no setting in this
release), it would also stop students from unmuting their microphones until the teacher allows each one, and whether jicofo then
blocks a screen at the bridge was not verified. It is an owner decision for later, not part of V1.

**Whiteboard backend** (`jitsi/excalidraw-backend:2026.3.0`):

- Browsers reach it only through `https://meet.edulabs-eg.com/socket.io/` (the web container proxies `/socket.io/` to
  `http://whiteboard.meet.jitsi`, because `WHITEBOARD_COLLAB_SERVER_URL_BASE` is set and no separate public URL is). It listens
  on 80 inside the Docker network (metrics on 9090) and publishes no port. `CORS_ORIGIN` is set to the meet origin.
- It checks **no token**: its `join-room` handler joins whatever room id the client sends. The room id Jitsi uses is the
  conference name, which EduLabs makes a random, per-Session key. The drawing itself is encrypted in the browser (AES-GCM with a
  random 128-bit `roomKey`); the backend only relays ciphertext. The `roomKey` sits in the conference's metadata, so every
  participant of that class and the Jitsi server (prosody, jicofo) can read it; someone outside the class who guessed the room id
  could connect to the backend but would see only ciphertext. Accepted as a known limit.

## 8. Part A review fixes (2026-11-14)

- **A (recording):** the env file no longer claims self-start limits recording; recording is off the default toolbar; the
  runbook check now tests what is enforced and states the limit. See section 7.
- **B (screen share, whiteboard):** as section 7; desktop and whiteboard are off the default toolbar.
- **C (whiteboard backend):** as section 7; `CORS_ORIGIN` added; runbook checks the handshake through the meet host and that
  80/9090 are not public.
- **D (relay ports):** the `172.16.0.0/12` rule was unnecessary and is removed. The bridge reaches coturn's relay on this host by
  replying to coturn's own packets (coturn to 51.195.252.97:10000 is handed to the container by Docker's NAT or proxy; the replies
  are tracked connections the firewall accepts as `ESTABLISHED`). A packet the bridge sent first would carry the container's
  private address, and coturn would drop it. Nothing outside can reach 49160-49200: no rule allows it, and runbook step 9 proves it
  with an outside probe logged as `[UFW BLOCK]`, plus a relayed call. If that call fails with blocked `IN=br-jitsi` lines, the
  runbook gives one rule bound to the Jitsi network's fixed interface name `br-jitsi` (set in the override).
- **E (published ports):** read from the stable-11248-3 Compose files: web 8000/8443 (loopback through `jitsi.env`), jicofo
  127.0.0.1:8888, jvb 10000/udp and 127.0.0.1:8080; prosody only `expose`s; the whiteboard publishes nothing; no 4443. `./jitsi.sh
  ports` lists them from `docker compose config`, `check`/`up` refuse any non-loopback port except 10000/udp, and the runbook
  lists the expected `ss -tulpn` lines after start.

## 9. Part B as built (2026-11-14; differs from the plan in section 4 where noted)

- **No Group choice column.** Section 4 planned an `edulabs`/`link` setting per Group. Built instead: an online Session with no link is an EduLabs class (DECISIONS.md, "Live classes"). It gives exactly the owner's answer 1 with no data change, and nothing in `group_command`/`group_view` changes.
- **One open route instead of start and join:** `POST /api/live-class/open` with `{ sessionId, start }` (strict body, 512 bytes), and `GET /api/live-class/joined?sessionId=` for Take attendance. Both: Firebase staging, configured, exact origin (`validFirebaseOrigin`) or same-origin read, sign-in, 30 (open) and 60 (joined) calls a minute per person, `no-store`, no referrer.
- **Database:** `private.live_class_rooms` and `private.live_class_joins` (RLS on, no grants), `private.live_class_open` and `private.live_class_joined` (definer, `search_path=''`, caller from `private.current_app_user_id()`) behind public invoker wrappers for `authenticated`, `private.emit_class_started`. Both event-type checks gain `class_started`. Replaced (marked "live class"): `notification_current`, `notification_link`, `emit_session_notice`, `notification_business_event`, `notification_worker`.
- **Known limits:**
  - A join row means EduLabs issued a token, not that the student stayed connected; a student who joins and leaves at once is still pre-marked Present (the teacher can change it).
  - "Starts soon" and "class started" are sent even when the web server is not configured; the link then shows "not available".
  - Jitsi's `MAX_PARTICIPANTS` (40 in `jitsi.env.example`) is not tied to the Group's capacity; a larger Group's later joiners would be refused by Jitsi.
  - Room and join rows go with their Session (ON DELETE CASCADE), so the demo Clear's removed-row count does not include them.
  - The class page frames the meeting host; the meeting page allows only the origins in `CSP_HEADER` (staging now; production
    is added with runbook step 16). Until then a production EduLabs page cannot show the meeting in the page; "Open in a new tab" still works.
  - "Open in a new tab" puts the visit's token in an address (`?jwt=`, Jitsi's own way): it is visible in that tab's address bar and
    history, and may be written to the meeting server's web access log (not checked). It is the same short-lived token (one room, at most 3 hours,
    the person's display name and the moderator flag only). Accepted for the fallback; the meeting inside the page never uses an address.
  - The class page browser harness uses a stub of `external_api.js`; the real Jitsi IFrame API, camera and microphone permissions in a
    frame, and Android browsers were not exercised (TESTING.md).
