# Back-end requests from the teacher-panel redesign

**For:** Codex (back-end). **From:** the teacher-panel redesign (front-end only, branch `claude/teacher-panel-redesign`).
This one file collects every back-end change the redesign needs. The front end never works around a missing back-end
feature: where something is missing, the screen leaves it out and the gap is listed here.

| # | Request | Front-end status |
| --- | --- | --- |
| 1 | Teachers and assistants manage academic programs and stages | ready and waiting |
| 2 | Users page: richer student data and a real waitlist setting | reduced version shipped |
| 3 | Sessions & Groups and Jitsi | see the section |
| 4 | Support: fields the target design shows | reduced version shipped |
| 5 | A real "platform Admin" signal for the role badge | label derived from memberships |

## Request 1: teachers and assistants manage academic programs and stages

**Status:** the front end is ready and waiting. No front-end work is needed after this back-end change.

### Product model (confirmed by the owner)

EduLabs is teacher-based: **each teacher has their own LMS**, which is one organization that they own. It is not a school
with many teachers sharing one taxonomy. So a program or stage always belongs to one teacher's own LMS.

- The teacher who creates the LMS is its `owner` and can already manage programs and stages. That must keep working.
- Staff who work for that teacher (organization role `assistant`, and any member with organization role `teacher`) need
  to manage the same programs and stages, because they build lessons and exams for that teacher.
- Unchanged on purpose: only admins can make other people admins. Teachers can make assistants.
  Nothing in this request touches membership or role management.
- Standard stages the owner wants available: **1st Secondary, 2nd Secondary, 3rd Secondary**.

### Where the current rule lives (all three must agree)

| Layer | Location | Current rule |
| --- | --- | --- |
| Service | `server/services/academics.ts` line ~22 | `const canManage = ['owner','admin'].includes(membership[0].role)` |
| Database command | `supabase/migrations/20261018203119_academic_programs_stages.sql`, `private.academic_command`, early gate (~line 128) and the second gate before the field checks (~line 163) | `private.has_org_role(p_organization_id, array['owner','admin'])` |
| Read access | `private.can_view_academic_organization`, `private.can_view_academic_stage` | already lets any org member read; no change expected |

Do **not** edit the applied migration. Add a new, additive migration that replaces `private.academic_command`
(same signature, same grants) and follow `docs/development-db-migration-ledger.md` (local only until the owner approves applying it).

### Requested change

1. Allow org roles `assistant` and `teacher` (plus the existing `owner`, `admin`) to run `program.create`, `program.edit`,
   `stage.create`, `stage.edit` in `private.academic_command` and set `canManage` for them in `academicService`.
   Leave `course.assign` as is (it already follows `private.can_edit_course`).
2. Scope is the teacher's own organization only, so there is no school-wide versus own-rows question. Every manager
   below acts inside the one organization they belong to; tenant isolation by `organization_id` must stay exact.
3. Keep every existing safeguard: tenant isolation by `organization_id`, the revision and conflict checks (`PT409`),
   slug uniqueness (`23505`), archive and restore rules, the lock ordering comments in the function, and the
   `course_stage_versions` behaviour. Do not weaken audit or rate limiting.
4. Standard stages. The front end already shows **Add standard stages (1st to 3rd Secondary)** for managers. It calls the
   existing `stage.create` once per missing stage with these values, and treats a duplicate-slug error as "already there":

   | label | slug | position |
   | --- | --- | --- |
   | 1st Secondary | `1st-secondary` | after the program's last stage, +1 |
   | 2nd Secondary | `2nd-secondary` | +2 |
   | 3rd Secondary | `3rd-secondary` | +3 |

   Optional back-end improvements (the owner has not asked for these, confirm first): seed these three stages when a
   program is created, or backfill them for existing programs. If you do, keep it idempotent by slug per program, so the
   front-end button stays harmless.

### Tests and acceptance

- Extend `scripts/academics.test.cjs` with a role matrix: owner, admin, teacher, assistant, student, outsider from another
  teacher's LMS, suspended and invited members. Owner, admin, teacher and assistant can create and edit inside their own
  organization; student and outsider get `42501`.
- Extend `scripts/academic-programs-concurrency.cjs` so teacher and assistant writes cannot deadlock with the last-owner trigger.
- Prove tenant isolation: staff of teacher A's LMS cannot read or write teacher B's programs or stages.
- Prove that role and membership management is unchanged (assistants cannot become admins through any path).
- Provider acceptance is not established by synthetic tests; say so in the report.

### What the front end does once this lands

- `GET /api/teacher/academics` returning `canManage: true` makes the existing New program, Edit program, New stage,
  Edit stage, Archive and Add standard stages controls appear for that user. Nothing else changes.
- While `canManage` is false the page stays read-only with the text "An owner or admin manages the taxonomy."
  Tell the front end if that sentence should change once teachers can manage.


## Request 2: Users page (`/admin/users`, shipped component `supabase-student-admin.tsx`)

The page lists the students of one course offering through `student_administration` (`roster`, `requests`, `links`, `metrics`).
The design the owner approved also shows data the current responses do not carry. The front end shows the reduced version
today and will show more as soon as the responses include it. Product rule: only people the teacher already supports
(their own LMS and offerings) may appear; admins and other teachers' users must never be listed.

1. Roster and request rows: add `email` (confirm with the owner that a teacher may see their own students' emails),
   `signed_up_at`, `groups` (names of the study groups the student is in, for this offering) and `homework_submissions`
   (count). Today only `display_name`, `status`, `expires_at`, `eligible` and `version` come back.
2. `metrics`: add `assignedStudents` (students who are in at least one study group), shown as a card in the target design.
3. **Waitlist switch.** The waitlist is an optional add-on that is off by default, but no setting reaches the front end.
   The screen currently hides every waitlist element while `pendingWaitlistCount` is 0 and keeps past requests reachable from
   the student status filter. Please add a per-organization setting (for example `waitlist_enabled`, default false) and return it
   to the front end with `offerings` or `metrics`. When it exists the front end switches to it with a one-line change.
4. Optional: approve or reject several requests at once.

## Request 3: Sessions & Groups and Jitsi

The owner wants one page where teachers and assistants create groups, put students into groups, and link each group to its
Jitsi link. Almost all of this already exists in the back end and needs no change: `group_view` and `group_command` support
create, edit, archive, add, remove, transfer, weekly schedules, one-off sessions, attendance, and a per-group `join_url`
(validated by `validGroupMeetingUrl`: HTTPS only, no credentials). A Jitsi link is just an HTTPS `join_url`, and the front end
can generate a Jitsi room address (`https://meet.jit.si/<random-room>`) on its own and save it through `edit`.

What the back end should confirm or add:

1. **Who can read `join_url`.** Please confirm that only members of the group and the group's staff receive it, never other
   students of the offering. If that is not already so, restrict it.
2. **List rows.** `group_view` for the group list returns only the group row. The redesigned list wants, per group:
   `member_count`, `schedules` (weekday, time, duration) and `next_session` (start and end). Please add them to the list
   response so the page does not make one request per group.
3. **Several students at once.** `add` takes one `userId`. Please allow a list (maximum 100) in one command, with the same
   audit and capacity checks, so a teacher can place a whole class in a group quickly. Also return students who are enrolled in the
   offering but in no group (`eligible` does something close; please confirm it returns exactly those).
4. **Assistants.** Today only a group's instructor can create or edit a group (`instructor`), while any staff member can take
   attendance. Confirm this is intended for assistants. If the owner wants assistants to create groups, that is a permission change.
5. **Host / admin login link for Jitsi (the owner reported this is missing).** On the public `meet.jit.si` service nobody gets an
   admin link: the first person must sign in (Google, GitHub or Facebook) through "I am the host". The front end now shows a
   "Start as host" button with that hint. A real host link that opens straight into a moderated room needs signed Jitsi tokens:
   either JaaS (8x8 Jitsi as a Service) or a self-hosted Jitsi with JWT authentication. Please add a server endpoint that, for a
   group's instructor or staff only, returns a short-lived signed moderator link for that group's room (and a participant-only
   link for members), with the room name tied to the group. The front end will then show the host link instead of the hint.
5b. **Jitsi privacy (optional, later).** A plain meeting link is not private: anyone with the link can join. If the owner
   wants private rooms with a lobby and moderator rights, that needs signed Jitsi tokens (self-hosted Jitsi or JaaS) created on
   the server, and the front end would only embed or open the signed link. Not requested yet; listed so it is not a surprise.
6. **Jitsi attendance (optional, later).** Automatic attendance from who actually joined needs a Jitsi webhook handled on the
   server. Not requested yet.
7. **The friend's Jitsi work.** The owner said a collaborator already built Jitsi integration. Only the external-link version
   (commit `ffbbc61`, Milestone 3B) is on GitHub. If more exists, please push it to a branch so the front end can use it.

## Request 4: Support, fields the target design shows

The shipped Support screen (`supabase-support-view.tsx`) was rebuilt to the target. Some parts of the target need data the
`support_command` responses do not return, so they are left out for now. In priority order:

1. Ticket list rows: `requester_name`, `requester_email`, `last_message_preview`, `message_count`.
2. Messages: `sender_role` (admin, teacher, assistant, student) so the label can name who wrote the reply instead of a
   generic "Support team", and `sender_avatar_url` (account photos are private to their owner today, so this needs a
   deliberate, narrow sharing rule between a requester and the support staff of their ticket).
3. Attachments (images and PDFs up to 16 MB): no storage or endpoint exists in the Supabase support model.
4. Visibility question for the owner: assistants and organization `teacher` members cannot see students' tickets unless
   someone adds them to `private.organization_support_staff`, and no screen manages that table.

## Request 5: platform Admin signal for the role badge

The sidebar badge now names the person's role (Admin, Teacher, Assistant, Student) in its own colour. The front end derives it from
what the page already receives: organization memberships (`owner` and `teacher` show as Teacher, `admin` as Admin, `assistant` as
Assistant) and course or group staff rows. The project owners' platform-level access (the private `support_operators` list) is not
visible to the front end, so those accounts show their organization role instead of "Admin".
Please expose one boolean for the signed-in user, for example `is_platform_admin`, through the existing viewer or navigation data,
without exposing the list itself. The front end will then show "Admin" for those accounts with a one-line change in `shared/roles.ts`.

## Provider acceptance

Synthetic tests do not establish provider acceptance. Say so in every report.
