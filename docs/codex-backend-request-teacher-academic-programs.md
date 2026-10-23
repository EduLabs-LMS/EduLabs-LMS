# Back-end request: teachers and assistants manage academic programs and stages

**For:** Codex (back-end). **From:** the teacher-panel redesign (front-end only, branch `claude/teacher-panel-redesign`).
**Status:** the front end is ready and waiting. No front-end work is needed after this back-end change.

## Product model (confirmed by the owner)

EduLabs is teacher-based: **each teacher has their own LMS**, which is one organization that they own. It is not a school
with many teachers sharing one taxonomy. So a program or stage always belongs to one teacher's own LMS.

- The teacher who creates the LMS is its `owner` and can already manage programs and stages. That must keep working.
- Staff who work for that teacher (organization role `assistant`, and any member with organization role `teacher`) need
  to manage the same programs and stages, because they build lessons and exams for that teacher.
- Unchanged on purpose: only admins can make other people admins. Teachers can make assistants.
  Nothing in this request touches membership or role management.
- Standard stages the owner wants available: **1st Secondary, 2nd Secondary, 3rd Secondary**.

## Where the current rule lives (all three must agree)

| Layer | Location | Current rule |
| --- | --- | --- |
| Service | `server/services/academics.ts` line ~22 | `const canManage = ['owner','admin'].includes(membership[0].role)` |
| Database command | `supabase/migrations/20261018203119_academic_programs_stages.sql`, `private.academic_command`, early gate (~line 128) and the second gate before the field checks (~line 163) | `private.has_org_role(p_organization_id, array['owner','admin'])` |
| Read access | `private.can_view_academic_organization`, `private.can_view_academic_stage` | already lets any org member read; no change expected |

Do **not** edit the applied migration. Add a new, additive migration that replaces `private.academic_command`
(same signature, same grants) and follow `docs/development-db-migration-ledger.md` (local only until the owner approves applying it).

## Requested change

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

## Tests and acceptance

- Extend `scripts/academics.test.cjs` with a role matrix: owner, admin, teacher, assistant, student, outsider from another
  teacher's LMS, suspended and invited members. Owner, admin, teacher and assistant can create and edit inside their own
  organization; student and outsider get `42501`.
- Extend `scripts/academic-programs-concurrency.cjs` so teacher and assistant writes cannot deadlock with the last-owner trigger.
- Prove tenant isolation: staff of teacher A's LMS cannot read or write teacher B's programs or stages.
- Prove that role and membership management is unchanged (assistants cannot become admins through any path).
- Provider acceptance is not established by synthetic tests; say so in the report.

## What the front end does once this lands

- `GET /api/teacher/academics` returning `canManage: true` makes the existing New program, Edit program, New stage,
  Edit stage, Archive and Add standard stages controls appear for that user. Nothing else changes.
- While `canManage` is false the page stays read-only with the text "An owner or admin manages the taxonomy."
  Tell the front end if that sentence should change once teachers can manage.
