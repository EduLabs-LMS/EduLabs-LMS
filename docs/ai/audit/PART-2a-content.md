# Part 2a: courses, course content, lesson progress, lesson media and storage

Read-only audit. No code, migration, test or config was changed. Nothing ran against the VPS or any Supabase project. All evidence
comes from a disposable local PostgreSQL 17.10 on loopback, started with `-c timezone=UTC` (hosted runs UTC). It was built from the
52 migrations in this tree, as in Part 0, and dropped afterwards. One prototype ran in a second throwaway copy (`audit_proto`), also
dropped. All users are seed or synthetic users. Branch `claude/backend-audit`, head before this part
`9e83bf1b631ac8e72c8ad1415158451ff960c35d`.

Findings are numbered `A2a-nn` in [FIX_LIST.md](FIX_LIST.md). Part 0 findings that belong to this area (A0-01, A0-02, A0-05,
A0-07) were measured again here on a large course. Their new numbers are in the first section and in their FIX_LIST rows. They are
not given new IDs.

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| A0-01 (re-measured) | High | A student opening one lesson of a 60-lesson course costs **11.5 s** of database time. One statement takes 7.8 s, close to the hosted 8 s `statement_timeout`. Home / Continue Learning costs 2.1 s. A prototype fix gives 0.43 s and 0.29 s, with identical rows for every user. |
| A0-02 (detailed) | High | Full list of direct table writes, with what the app uses. Five of the seven risky ones have no caller in the app. |
| A2a-01 | Medium | A course becomes unavailable to every student once 50 lessons hold more than 500 content blocks. The message wrongly says "unpublished, unavailable or your enrollment has expired". |
| A2a-02 | Medium | A course editor can read another course's private file in the same space by pointing a block at it. Their students can then read it too. |
| A0-07 (detailed) | Medium | 17.7 ms of the 20.6 ms progress save is a check the function already makes another way. Removing it gives about 3 ms. |
| A2a-03 | Low | A student can mark any lesson of their course "completed" by a direct write. The teacher then cannot delete that lesson. |
| A2a-04 | Low | A course editor's direct block writes skip every rule the editing function enforces (5 MB block proven; any type; any external video URL). |
| A2a-05 | Low (owner decision) | A course editor (an assistant with the course role "editor") can publish, archive and un-archive the course. The app's own course PATCH allows it. |
| A2a-06 | Low | Lesson content, lesson status and parts of an **archived** course can still be changed through `edit_learning_content`. `edit_course_structure` refuses. |
| A2a-07 | Low | `edit_learning_content` locks the course before it checks the caller. Any signed-in user can make a course's editors wait, and wait on them (proven: a student's call waited 1.5 s, then got 42501). |
| A2a-08 | Low | Each progress save holds the lesson part `FOR SHARE`, so a teacher saving that part waits for every student save in flight. `FOR KEY SHARE` is enough. |
| A2a-09 | Note | The A0-05 fix must keep a lock for `create_*` and `reorder_*`. Today they rely on the course lock for `max(position)+1` and the reorder shift. |
| A2a-10 | Note | `edit_module_details` requires a chapter type and number that a trigger always overwrites. |
| A2a-11 | Note | `complete_media_upload` can be called directly. It trusts the MIME type the uploader declared, so the server's file-signature check can be skipped (teachers only). |
| A2a-12 | Note | Dead code keeps live grants. `repositories/lms.ts` `updateProgress` and `registerMedia` have no caller. The legacy `/api/courses/*` handlers are Clerk/Prisma and answer 503 in Firebase mode. |

## Scope and live versions

**Tables:** `courses`, `course_modules` (chapters), `lessons`, `lesson_blocks` (content items), `lesson_segments` (parts),
`lesson_resources` (part attachments), `lesson_progress`, `lesson_segment_progress`, `media_assets`, `private.lesson_upload_scopes`,
`course_staff`, and the `storage.objects` policies for `lms-course-media`.

**Functions (39).** The live file is the last migration with a `create [or replace]`. "×n" means n create statements in all.

| Function | Live file:line | Notes |
| --- | --- | --- |
| `edit_learning_content` | 20261110120000_lesson_publish.sql:17 (×4) | every lesson, part, block, cover and chapter-detail edit |
| `edit_course_structure` | 20261110120000_lesson_publish.sql:113 (×2) | chapters and lessons: create, rename, move, delete, publish |
| `course_structure` | 20261106130000_course_content_tree.sql:257 | teacher structure read |
| `save_segment_progress` | 20261013141230_complete_lesson_workflows.sql:173 | student progress |
| `register_lesson_upload`, `get_lesson_upload` | 20261013141230:243, :264 | lesson upload intent / inspection |
| `complete_media_upload` | 20261013141230:298 (×3) | marks an upload ready |
| `can_upload_media` | 20261013141230:288 (×3) | storage insert policy helper |
| `can_review_lesson_upload` | 20261013141230:279 | storage read of one's own pending upload |
| `can_view_media` | 20261018091735_lesson_covers.sql:100 (×3) | media read |
| `archive_unused_lesson_upload`, `can_remove_lesson_upload` | 20261018091735:110, :120 | cleanup |
| `check_lesson_cover` | 20261018091735:5 | trigger on `lessons` |
| `can_view_lesson` | 20261001230357_lms_authorization.sql:43 | RLS helper |
| `can_view_segment` | 20261013141230:53 | RLS helper |
| `check_segment_media` | 20261013141230:66 | trigger on parts and attachments |
| `abandon_media_upload`, `can_download_media` | 20261010100544_harden_storage_and_assessments.sql:47, :20 | |
| `require_ready_lesson_media` | 20261010101249_ready_media_references.sql:3 | trigger on blocks |
| `close_chapter_gaps` (+`_after_delete`), `keep_lesson_in_course`, `pin_chapter_label`, `refuse_archived_structure`, `lesson_delete_blockers`, `lesson_delete_counts` | 20261106130000_course_content_tree.sql:67, :79, :39, :58, :103, :126, :138 | structure triggers and helpers |
| `create_teacher_course` | 20261010181140_reuse_course_owner_trigger.sql:3 (×2) | |
| `assign_course_owner` | 20261001230358_lms_integrity.sql:126 | trigger on `courses` |
| `course_assistant_right` | 20261114120000_exams.sql:359 | |
| public wrappers (`edit_learning_content`, `edit_course_structure`, `course_structure`, `save_segment_progress`, `register_lesson_upload`, `get_lesson_upload`, `complete_media_upload`, `abandon_media_upload`, `archive_unused_lesson_upload`, `create_teacher_course`) | one-line invoker wrappers | granted to `authenticated` and `service_role` |

Shared helpers read in full: `can_edit_course`, `can_view_course`, `is_course_staff`, `can_manage_course_staff`,
`can_manage_offering`, `can_support_offering`, `is_enrolled`, `is_org_member`, `has_org_role`, `is_active_user`, `check_lms_integrity`.
Notification trigger `notification_business_event`: branches for `courses`, `lessons`, `lesson_segments`.

**Callers.** `server/services/lessons.ts` (`learningService`: `tree`, `offering`, `progress`, `media`, `resource`, `blockResource`,
`edit`, `saveProgress`, `registerUpload`, `finishUpload`, `upload`, `cleanup`) through `server/http/lessons.ts` and
`server/http/lesson-resource.ts` (`/api/learning/<course>/(edit|progress|upload|media|cleanup|upload-intent|finish-upload)`,
`/api/learning/<course>/(resources|blocks)/<id>`). Student pages `app/(dashboard)/_components/secure-lesson-page.tsx` and
`secure-lesson-overview.tsx`. Home / Continue Learning through `server/http/learning-overview.ts` → `server/services/website.ts`
`loadWebsiteScope` → `server/repositories/website.ts`. Teacher course routes `/api/teacher/courses[/<id>[/content]]` →
`server/http/teacher-course.ts`, `server/http/course-content.ts`. `server/services/teacher-course.ts`, `teacher-course-page.ts`,
`server/repositories/teacher-course.ts`, `server/integrations/lms-storage.ts`.

The 18 `/api/courses/*` handlers, `/api/progress/complete`, `/api/upload/check-limit` and `/api/uploadthing` are the legacy
Clerk/Prisma/UploadThing build (`server/http/courses/**` imports `@clerk/nextjs/server` and `@/server/db`). `middleware.ts:79`
answers 503 for every unlisted `/api/` path in Firebase mode. None of them reaches Supabase. They are listed for Part 9 (A2a-12).

## Re-measured: A0-01, the student lesson read (High)

**Fixture.** A course in seed space A with 10 chapters × 6 lessons, all published. Each lesson has 10 text blocks of ~400 characters
and one published video part. There is one active run, and seed student `…0005` is enrolled. That is 60 lessons, 600 blocks and
60 parts.

**Method.** `scratchpad/m2a.cjs` replays the exact PostgREST statements the server sends, in the same order and batches, as the
signed-in user, each in its own transaction (as PostgREST runs them). (1) One student lesson page:
`secure-lesson-page.tsx:17-19`, then `learningService` → `offering()` → `tree()` + `progress()`. (2) Home / Continue Learning:
`loadWebsiteScope`. Timings were stable across repeated runs (11,485 / 11,527 ms).

| Statement (server source) | Student, live | Owner, live | Student, prototype | Owner, prototype |
| --- | --- | --- | --- | --- |
| `courses` by id (`lessons.ts:25`) | 22 ms | 1 ms | 24 ms | 1 ms |
| `course_modules` (`lessons.ts:33`) | 71 ms | 7 ms | 37 ms | 14 ms |
| `lessons`, 10 chapters in one batch (`lessons.ts:35`) | 947 ms | 73 ms | 73 ms | 26 ms |
| `lesson_segments`, 2 batches (`lessons.ts:36`) | 1,040 ms | 40 ms | 142 ms | 54 ms |
| `lesson_blocks`, 2 batches of 50 lessons (`lessons.ts:38`) | **7,833 + 1,560 ms** | 615 + 121 ms | 72 + 70 ms | 28 + 27 ms |
| **Lesson page total** | **11,485 ms** | **857 ms** | **431 ms** | **150 ms** |
| **Home / Continue Learning total** (`website.ts:49-60`) | **2,135 ms** | | **289 ms** | |

**Why.** `EXPLAIN (ANALYZE, BUFFERS)` of the student's block read for 10 lessons (100 blocks): 2,616 ms and 127,610 shared-buffer
hits. That is ~16 ms and ~1,270 buffer hits for **every block row**, all inside the filter
`private.can_view_lesson(lesson_id)`. The function is `security definer`, so it is never inlined. On PostgreSQL 17 (hosted is 17.11)
a non-inlined SQL function is planned again on every call. Each call in turn runs `can_edit_course`, `is_course_staff`,
`can_view_course` → `can_support_offering` / `is_enrolled`, each planned again. The row count, not the user, drives the cost, so the
owner pays it too (857 ms).

**What this means on the hosted project.** The 7.8 s blocks statement is one PostgREST request. Role `authenticated` has
`statement_timeout=8s` (FIX_LIST facts). On a CPU slightly slower than the audit machine, that statement is cancelled (57014). The
server then maps the error to 503, and `secure-lesson-page.tsx:43` shows "Lessons could not be loaded. Please retry." for every
lesson of the course. This was not run on the hosted project. It is inferred from the local time and the hosted limit. Even below
the limit, one student opening one lesson holds a database connection for over 11 s, and `max_connections` is 60.

**The page reads the whole course to show one lesson.** `tree()` loads every chapter, lesson, part, attachment and block of the
course. `secure-lesson-page.tsx` then keeps the blocks of one lesson (`lessonBlockViews(tree, lesson.id, …)`) and uses the rest only
for chapter number, previous/next and part list. Those need ids, titles and positions, not 600 block bodies.

**Prototype fix (throwaway copy only), `scratchpad/proto.sql`.** Four `security definer` set-returning helpers are evaluated
**once per statement** as an uncorrelated `IN (select …)` (a hashed subplan):

- `my_viewable_courses()`: candidate courses come from the caller's own rows (memberships, course staff, run staff, enrollments),
  and each candidate is kept only if `can_view_course` accepts it.
- `my_staff_courses()`: the same, kept if `can_edit_course` or `is_course_staff` accepts it.
- `my_visible_lessons()`: staff courses' lessons, plus published lessons of viewable courses.
- `my_visible_segments()`: the same rule for parts, with both part and lesson published.

The policies `lessons_select`, `lesson_blocks_select`, `segments_read`, `resources_read` and `course_modules_select` then become
`… in (select private.my_…())`. The meaning is the existing helpers' meaning, by construction.

**Equivalence proof (`scratchpad/equiv.cjs`).** For every one of the 7 users with a trusted identity in the database, the full set of
ids readable from the 5 tables was compared between the live policies and the prototype. 35 checks, 24 of them non-empty:
**0 differences**. Seven users are not a proof for every role combination. The real fix must also pass the full SQL suites,
including the authorization suites.

**Recommended fix (two parts).**

1. Authorize once per statement, as prototyped (27× faster for the student's page). The ~70 ms that remains per statement is the
   helpers themselves. It can come down further by computing the candidate sets without calling `can_view_course` per candidate.
2. Read only what the page shows. Read the opened lesson's blocks by `lesson_id = <id>`, and the outline (ids, titles, positions,
   status) for the rest. Or use one `security definer` RPC that authorizes the enrollment once and returns the page's data. This also
   removes A2a-01.

## Detailed: A0-02, every direct table write on content (High)

Grants to `authenticated` on the Part 2a tables (live catalog), the policy that lets the write through, and whether the app uses it.
"Used by" was found by searching `server`, `app`, `frontend`, `shared` and `scripts` for `.from('<table>').(insert|update|upsert|delete)`.

| Table | Direct write granted | Policy (who) | App uses it? | Proven here |
| --- | --- | --- | --- | --- |
| `courses` | `DELETE` | `courses_delete`: `can_edit_course(id)` (owner, admin, course owner/instructor/editor) | **no** | Part 0 (course without runs: deleted with all chapters, lessons and blocks). New: a course **with a run** cannot be deleted (`course_offerings_course_id_fkey` restricts, 23503) |
| `courses` | `INSERT` (incl. `status`, `visibility`) | `courses_insert`: owner/admin/teacher, `created_by` = self | **no** (`create_teacher_course` RPC) | a course could be inserted already `published` and `public` |
| `courses` | `UPDATE` (`title, description, status, slug, visibility`) | `courses_update`: `can_edit_course` | **yes**: `server/repositories/teacher-course.ts:23` (course PATCH, `/api/teacher/courses/<id>`) | A2a-05: an editor archives and un-archives |
| `course_modules` | `UPDATE` (`title, description, group_type`) | `can_edit_course` | **no** (`edit_course_structure` / `edit_learning_content`) | skips the 120-character and control-character rules of `rename_chapter` |
| `course_staff` | `INSERT, UPDATE (role), DELETE` | `can_manage_course_staff` (owner, admin, course-staff owner) | **no** | a course-staff owner can add another teacher of the space as owner, or remove any staff row, including the creator's |
| `lessons` | `INSERT` (incl. `status`, `cover_asset_id`), `UPDATE` (`title, position, description, estimated_duration_seconds`) | through `course_modules`: `can_edit_course` | **no** | the cover still goes through `check_lesson_cover`; title/position skip the RPC's stale checks |
| `lesson_blocks` | `INSERT, UPDATE, DELETE` | through `lessons`/`course_modules`: `can_edit_course` | **no**. No function creates or deletes a block; `edit_block` only edits text | A2a-02 (another course's file), A2a-04 (5 MB block) |
| `lesson_progress` | `INSERT, UPDATE` (incl. `status, completed_at`) | own row, `is_enrolled`, `can_view_lesson` | **no**. `server/repositories/lms.ts:59` `updateProgress` has no caller (`getStagingLmsRepository` is never imported) | A2a-03 |
| `media_assets` | `INSERT` | own `pending` row; course media for owner/admin/teacher, submissions for enrolled students | **only submissions**: `server/services/exam-runner.ts:94` (Part 6a). `lms.ts:50` `registerMedia` has no caller | course-media rows are made by `register_lesson_upload` |
| `lesson_segments`, `lesson_resources`, `lesson_segment_progress` | none (select only) | | | correct: writes go through the functions |

**Fix.** Revoke `INSERT/UPDATE/DELETE` on `courses` (except what the course PATCH needs, or move the PATCH into an RPC),
`course_modules`, `course_staff`, `lessons`, `lesson_blocks` and `lesson_progress`. Revoke `INSERT` on `media_assets` for
`lms-course-media` (keep the submissions path, or move it to an RPC in Part 6a). Drop the policies that only existed for those
writes. The app keeps working: the only write the app uses on these tables is the course PATCH.

**Owner decision (the existing A0-02 question):** should the course PATCH stay a direct table update or become an RPC? Who may change
`status` (see A2a-05)?

## Detailed: A0-07, the progress save (Medium)

Measured on the large course as student `…0005`, warm connection, median of 7: **`save_segment_progress` 20.6 ms**. Inside it:

| Step | Cost |
| --- | --- |
| `private.can_view_segment(s.id)` | **17.7 ms** |
| `private.is_enrolled(p_offering_id)` | 0.9 ms |
| replacement: "lesson is published", read inside the definer (no RLS) | 0.3 ms |

The function already requires the part to be published (`s.status<>'published'`), the student to be enrolled in an active run of a
published course (`is_enrolled`), and the run to belong to the part's course
(`course_offerings.course_id = c`; `20261013141230:181-182`). Given those, `can_view_segment` reduces to "the lesson is published".
**Fix:** replace `private.can_view_segment(s.id)` with a check that the lesson is published (it reads the row already joined). That
gives about 3 ms per save, a 7× cut on the most frequent student write (the player saves every few seconds while a video plays,
`video-player.tsx:78-104`). The prototype from A0-01 does not help here, because the function calls the helper directly.

## A2a-01: Medium, correctness

**A course becomes unavailable to every student once 50 lessons hold more than 500 content blocks.**

`server/services/lessons.ts:27-31` (`batch`) reads blocks for 50 lessons at a time with `.limit(501)`. It throws
`413 'Content is too large for this editor. Narrow the module.'` when a batch returns more than 500 rows. `tree()` uses it for the
**student** page too (`lessons.ts:38`). So 50 lessons averaging more than 10 blocks each break every lesson page of the course, not
only the editor. The same applies to more than 500 parts per 50 lessons, or more than 5,000 rows in all.

**Proof (rolled back).** One extra block per lesson was added to the large course (11 per lesson), and the server's first block batch
was run as the owner: **501 rows**, which `batch()` turns into the 413. `secure-lesson-page.tsx:43` catches it. Because the status is
not 503, the student sees **"This lesson is unpublished, unavailable or your enrollment has expired."** That is wrong on every count,
and it is the same for every lesson of the course. `secure-lesson-overview.tsx:22` behaves the same.

**Why Medium and not High.** No function in the app creates a block today (`edit_learning_content` only edits block text, and there
is no create-block action), so block counts grow only through direct writes or imported content. The rebuilt teacher editor will
create blocks, so this must be fixed before that screen ships.

**Fix.** The second part of the A0-01 fix: read the opened lesson's blocks by lesson id. The student page must never fail because of
other lessons' size. If a limit stays, report it as "too large" and not as "unpublished or expired".

## A2a-02: Medium, security

**A course editor can read another course's private file in the same space by pointing a block at it, and their students can then
read it too.**

`lesson_blocks` accepts a direct insert from any editor of the lesson's course (A0-02). The block triggers check only that the
file is `ready` (`require_ready_lesson_media`) and belongs to the **same space** (`check_lms_integrity`, `lesson_blocks` branch).
They do not check that the caller may see the file, nor that it was uploaded for this course. Parts and attachments do both checks
(`check_segment_media` calls `can_view_media`), and covers check the upload scope (`check_lesson_cover`). Once the block exists,
`can_view_media` grants the file to everyone who can view the lesson (its `lesson_blocks` branch), and `can_download_media` lets
them sign a storage URL for it.

**Proof (rolled back).** A ready image was uploaded for the large course (scope: that course) by the space owner. Seed user `…0004`
(space role `assistant`, course-staff `editor` on seed course 1, no access to the large course):

| Step | Result |
| --- | --- |
| `can_view_media(file)` before | `false` |
| same file through `edit_learning_content('attach_resource')` | refused, `23514 Invalid lesson media` |
| direct `insert into lesson_blocks(… media_asset_id = file)` on a course-1 lesson | **accepted** |
| `can_view_media(file)` after | **`true`** |
| `can_download_media('lms-course-media', path)` after | **`true`** (can sign a download URL) |
| student `…0005` of course 1: `can_view_media(file)` | **`true`** |

The attacker needs the file's id. That id is not a secret: it is part of the storage path (`<space>/<file id>/resource.<ext>`) in
every signed URL ever handed out for it. Anyone who has once seen the file's link has the id. Examples: a former staff member of the
other course, or someone who is a student there and an assistant here. Files at risk include lesson material of a course that is not
yet published.

**Fix.** Revoking direct block writes (A0-02) closes this path. Also add the missing check to the block trigger, for defence in
depth and for the future create-block action: the file must belong to this course's upload scope, or the caller must already be able
to view it. That is the rule `check_segment_media` and `check_lesson_cover` apply.

## A2a-03: Low, integrity

**A student can mark any lesson of their course completed by a direct write, and the teacher then cannot delete that lesson.**

Proof (rolled back): student `…0005` upserted `lesson_progress` `status='completed'` for seed lesson 1 directly. It was accepted.
`lesson_delete_blockers(lesson)` then returned `["student_progress", …]`, so `edit_course_structure('delete_lesson')` refuses. Only
the student's own Home view reads `lesson_progress` (`repositories/website.ts`; for a lesson with parts, `website.ts` recomputes the
status from part progress, which only `save_segment_progress` writes). No teacher report reads it. Hence Low. **Fix:** part of
A0-02 (no caller uses the direct write).

## A2a-04: Low, integrity

**A course editor's direct block writes skip every rule the editing function enforces.**

Proof (rolled back): editor `…0004` inserted a text block of **5,000,020 bytes** directly. The function refuses anything over 100,000
characters (`Invalid text block`). Direct writes also accept any `block_type`, any JSON shape, and for `video`/`embed` blocks any
`content.url`. The student page renders text with tags stripped and plays video only through `lessonPlayback`
(`shared/contracts/lessons.ts:51`: https YouTube, Vimeo, or any https `.mp4`/`.webm`). So there is no script injection. But a large
block is loaded into server memory for every student page view (A0-01 reads all blocks), and a video can come from any outside
host. **Fix:** part of A0-02.

## A2a-05: Low, owner decision

**A course editor can publish, archive and un-archive the course.**

The course PATCH (`server/http/teacher-course.ts:42-46`) accepts `status: draft | published | archived` (`shared/teacher-course.ts:9`)
from anyone `canEditTeacherCourse` accepts. That includes course-staff `editor`, an assistant-level role. The database allows the
same (`courses_update` uses `can_edit_course`). Proof (rolled back): editor `…0004` set seed course 1 to `archived` and then back to
`published` by a direct update. Both were accepted. Publishing sends a "lesson published" notification for every published lesson to
every enrolled student (`notification_business_event`, `courses` branch). Un-archiving reverses a state that `edit_course_structure`
treats as final.

**Owner question:** who may publish, archive and un-archive a course: space owner/admin only, course owner/instructor, or any course
editor? Is archive reversible? Then enforce the answer in the database (an RPC with the rule), not only in the route.

## A2a-06: Low, correctness

**The content of an archived course can still be changed.**

`edit_course_structure` refuses every action on an archived course (`PT409 Course archived`). The trigger `refuse_archived_structure`
refuses chapter and lesson **title, position and chapter** changes only. `edit_learning_content` checks neither. Proof (rolled back,
large course set to `archived`, as its owner):

| Action | Result |
| --- | --- |
| `edit_learning_content('edit_block')` | accepted |
| `edit_learning_content('edit_lesson')` to `draft` | accepted |
| `edit_learning_content('edit_segment')`, publish | accepted |
| `edit_course_structure('rename_lesson')`, for comparison | `PT409 Course archived` |

Students do not see an archived course (`is_enrolled` requires a published course), so the harm is limited to changing what is
meant to be frozen. **Fix:** refuse archived courses at the top of `edit_learning_content`, as `edit_course_structure` does.

## A2a-07: Low, lock

**`edit_learning_content` locks the course before it checks the caller.**

`20261110120000:21` runs `perform 1 from public.courses c where c.id=p_course_id for update;` and only then checks
`can_edit_course` (`:22`). The function is `security definer` and granted to `authenticated`, so any signed-in user can take the
course row `FOR UPDATE` by calling it with a course id. Proof (two sessions): session A, the owner, held an `edit_block` save open.
Session B, student `…0005`, called `edit_learning_content` on the same course. B **waited** (one session in `wait_event_type='Lock'`
at 1.5 s) until A ended, then got `42501 Content editing denied`, 1,528 ms later. While waiting, B also queues ahead of every later
editor of that course. Each call holds the lock only until its own error, so this is a nuisance, not an outage. But it lets anyone
outside the course join the course's lock queue. `edit_course_structure` does it in the right order (check at `:117`, then lock at
`:118`). **Fix:** check `can_edit_course` first, then lock.

## A2a-08: Low, lock

**Each progress save holds the lesson part `FOR SHARE`.**

`save_segment_progress` (`20261013141230:177`) takes `select … from lesson_segments … for share`. A teacher saving that part
(`edit_segment`, an `UPDATE` that takes `FOR NO KEY UPDATE`) conflicts with `FOR SHARE`. So the teacher waits for every student save
in flight on that part, and new student saves queue behind the teacher. Each save holds it for ~20 ms today (~3 ms after the A0-07
fix). This was not load-tested in this part (Part 0 measured 40 concurrent saves: p50 89 ms, p95 139 ms). **Fix:**
`FOR KEY SHARE`. That still stops the part from being deleted mid-save, and no longer conflicts with a teacher's edit.

## A2a-09: Note, for the A0-05 fix

`edit_learning_content` `create_*` computes `max(position)+1`, and `reorder_*` shifts all positions and rewrites them. Both are safe
today only because the course row is locked `FOR UPDATE` first. `edit_course_structure` `create_chapter` and `move_lesson` rely on
the same lock, and `close_chapter_gaps` takes it too. When A0-05 narrows the course lock to structural actions, each item action
must lock its **parent** row (the chapter for lessons, the lesson for parts) `FOR NO KEY UPDATE`. Otherwise two concurrent creates
under the same parent collide on the unique `(parent, position)` index (23505). Lock order stays course → chapter → lesson → item.

## A2a-10: Note, dead input

`edit_learning_content('edit_module_details')` validates and writes `group_type` and `chapter_number`, and the contract requires them
(`shared/contracts/lessons.ts:29-31`). But the trigger `pin_chapter_label` (`20261106130000:58`) overwrites them on every write
with `'Chapter'` and `position+1`, and two check constraints pin those values. The teacher's input is silently discarded. **Fix:**
drop the two fields from the action and the contract when the action is next touched.

## A2a-11: Note, upload validation

The server checks a lesson file's real bytes (`validLessonFile`, `validateLessonImage`) in `finishUpload` and `upload`
(`lessons.ts:84-96`, `:100-112`) before it calls `complete_media_upload`. The RPC is granted to `authenticated`, and it accepts the
object if its storage metadata MIME (declared by the uploader at upload time) matches the registered MIME and the size fits. A
teacher who calls the RPC directly therefore skips the byte checks. The bucket is private, files are served by short-lived signed
URLs with the declared content type, and only the space's teachers or course editors can do it. **Fix (optional):** mark
course-media uploads ready only through a trusted path, or record that the byte check is advisory.

## A2a-12: Note, dead code with live grants (Part 9)

- `server/repositories/lms.ts` `updateProgress` (`:59`) and `registerMedia` (`:50`) are only reachable through
  `server/services/lms-staging.ts` `getStagingLmsRepository`, which nothing imports. They are the only reason the
  `lesson_progress` and course-media `media_assets` write grants look used.
- The 18 `/api/courses/*` handlers, `/api/progress/complete`, `/api/upload/check-limit` and `/api/uploadthing` are the
  Clerk/Prisma/UploadThing build. In Firebase mode `middleware.ts:79` answers 503 for them.

Both belong to Part 9's route inventory. Removing them is cleanup, not a security fix.

## Checked and fine

- **Upload flow.** `register_lesson_upload` checks `can_edit_course`, allows five MIME types and a 1-200 character name, and builds
  the path itself (`<space>/<new id>/resource.<ext>`, so no client path is ever used). It records the course scope.
  `lms_objects_insert` allows a storage upload only for the caller's own `pending` row that has not expired
  (`can_upload_media`), with `owner_id` = token subject. `complete_media_upload` locks the row `FOR UPDATE` and re-checks the
  course permission. It also checks storage owner, size (scoped limits: 50 MB video, 20 MiB PDF, 5 MiB image) and MIME. There is
  **no `UPDATE` policy** on `storage.objects` for the lesson buckets, so a ready file can never be replaced. Delete is allowed only
  for the uploader's own `archived` file that nothing references (`can_remove_lesson_upload`, `archive_unused_lesson_upload`).
- **Media reads.** `media()` signs for 600 s, and only after `media_assets` passes RLS (`can_view_media`). `resource()` and
  `blockResource()` check that the item belongs to the course in the URL. `lesson-blocks.ts` strips tags, and `lessonPlayback`
  accepts only https and no credentials.
- **Parts, attachments and covers** can reference only ready files of the same space that the caller can already view
  (`check_segment_media`), or files uploaded for this course (`check_lesson_cover`). A part's video must be `video/mp4` and its
  thumbnail an image.
- **Integrity triggers.** A lesson cannot leave its course (`keep_lesson_in_course`), and no row can be re-parented
  (`reject_reparenting`). Chapter numbers have no gaps after a delete (`close_chapter_gaps`, statement-level, one course lock per
  course). Lesson delete is refused while homework, student work, progress, parts or content exist, with counts for the UI.
- **Stale-write protection.** Every edit carries the `updated_at` the teacher saw (PT409 on mismatch). Reorder and move require the
  full current list with stamps, and delete-chapter requires every lesson in it, so nothing changed elsewhere is overwritten or
  removed unseen.
- **Dynamic SQL** in `edit_learning_content`: table and column names come only from fixed literals (as Part 0 found). Values go
  through `using`.
- **Lock cost of writes on the large course** (warm connection, median of 7): `edit_block` 1.0 ms, `rename_lesson` 1.1 ms,
  `course_structure` read for 60 lessons 4.0 ms. A0-05 stays about lock **scope** (every save takes the whole course), not about
  duration.
- **Progress save ordering.** Enrollment `FOR SHARE`, then a per-student-and-run advisory lock, then the progress row `FOR UPDATE`,
  with a revision check (PT409). One student's saves are serialized, and different students never wait on each other except on the
  part row (A2a-08).
- **Notifications.** The `courses`, `lessons` and `lesson_segments` triggers emit only on a draft → published change, and only for a
  published course, with idempotency keys. They take no lock on shared rows beyond the foreign-key share lock of the event insert.
- **Every function in scope** is `security definer` with `search_path=''`, and the public wrappers are one-line invokers.
  Internal triggers and helpers (`assign_course_owner`, `check_*`, `close_chapter_gaps`, `lesson_delete_*`, `pin_chapter_label`,
  `refuse_archived_structure`, `require_ready_lesson_media`, `course_assistant_right`) are not executable by `authenticated`.

## Evidence scripts (scratchpad, not committed)

`big.cjs` (fixture), `m2a.cjs` (lesson page and Home replay), `ex2a.sql` (EXPLAIN), `lim.sql` (501-row proof), `proto.sql` +
`equiv.cjs` (prototype and equivalence), `w2a.cjs` (write costs), `sp.cjs` (progress-save breakdown), `proofs2a.cjs` (T2-T7
above). All ran only against the disposable local databases, which were then dropped.
