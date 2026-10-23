# Back-end request: teachers and assistants manage academic programs and stages

**For:** Codex (back-end). **From:** the teacher-panel redesign (front-end only, branch `claude/teacher-panel-redesign`).
**Status:** the front end is ready and waiting. No front-end work is needed after this back-end change.

## What the owner wants

1. Teachers and assistants can create and edit their own academic programs and stages at `/teacher/programs`.
   Today only organization `owner` and `admin` can.
2. The owner has standard stages that should be easy to get: **1st Secondary, 2nd Secondary, 3rd Secondary**.
3. Unchanged on purpose: only admins can make other people admins. Teachers can make assistants.
   Nothing in this request touches membership or role management.

## Where the current rule lives (all three must agree)

| Layer | Location | Current rule |
| --- | --- | --- |
| Service | `server/services/academics.ts` line ~22 | `const canManage = ['owner','admin'].includes(membership[0].role)` |
| Database command | `supabase/migrations/20261018203119_academic_programs_stages.sql`, `private.academic_command`, early gate (~line 128) and the second gate before the field checks (~line 163) | `private.has_org_role(p_organization_id, array['owner','admin'])` |
| Read access | `private.can_view_academic_organization`, `private.can_view_academic_stage` | already lets any org member read; no change expected |

Do **not** edit the applied migration. Add a new, additive migration that replaces `private.academic_command`
(same signature, same grants) and follow `docs/development-db-migration-ledger.md` (local only until the owner approves applying it).

## Requested change

1. Allow org roles `teacher` and `assistant` (plus the existing `owner`, `admin`) to run `program.create`, `program.edit`,
   `stage.create`, `stage.edit` in `private.academic_command` and set `canManage` for them in `academicService`.
   Leave `course.assign` as is (it already follows `private.can_edit_course`).
2. **Open question for the owner (decide before building):** should a teacher or assistant manage the whole organization's
   taxonomy, or only programs and stages they created?
   - Option A, simplest: every teacher and assistant manages the shared taxonomy of their organization.
   - Option B: they edit only rows they created. This needs a `created_by` column, backfill for existing rows,
     and owner/admin keeping full control.
   The front end works with either because it only reads `canManage` per response. If B is chosen, `canManage` is
   still one boolean per page, so tell the front end if per-row permission flags are wanted (that would be a small
   follow-up request to the front end).
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
  organization, suspended and invited members. Teacher and assistant can create and edit; student and outsider get `42501`.
- Extend `scripts/academic-programs-concurrency.cjs` so teacher and assistant writes cannot deadlock with the last-owner trigger.
- Prove tenant isolation: a teacher of organization A cannot read or write organization B's programs or stages.
- Prove that role and membership management is unchanged (assistants cannot become admins through any path).
- Provider acceptance is not established by synthetic tests; say so in the report.

## What the front end does once this lands

- `GET /api/teacher/academics` returning `canManage: true` makes the existing New program, Edit program, New stage,
  Edit stage, Archive and Add standard stages controls appear for that user. Nothing else changes.
- While `canManage` is false the page stays read-only with the text "An owner or admin manages the taxonomy."
  Tell the front end if that sentence should change once teachers can manage.
