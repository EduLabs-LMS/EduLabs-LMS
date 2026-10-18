# Milestone 2 — lesson covers and chapter customization

Implementation branch: `codex/milestone2-lesson-covers-chapters`.
Base: merged integration `aafb434b77a00d67650550d75d21e9ef74476878`.
Worktree: `E:/EduLabs-Milestone2`. PR #9/#10 were not imported.

## Checkpoint 2A — independent lesson covers

Commit `035b621` implements a nullable `lessons.cover_asset_id`, independently of segment thumbnails, videos, resources and progress. The current learning editor has upload, preview, replace and remove controls. PNG/JPEG/WebP use the existing 5 MiB limit and private course-media upload workflow. Server-side image decoding additionally rejects corrupt/disguised images, animation/multiple pages, excessive dimensions and decompression size. Existing HTTP origin/session checks and Firebase upload identity remain intact.

Cover attachment uses the existing editing RPC, contextual course permissions, course-root serialization and the lesson's optimistic timestamp. A database trigger requires a ready image of the correct organization AND registered course scope, permitted bucket/MIME and bounded size. Students cannot attach covers. Existing lesson RLS and approved lesson-access rules authorize cover reads; no public bucket or public media link was added.

Cover references participate in media authorization, archive protection, Storage-delete authorization and the trusted maintenance queue. A replaced/removed, genuinely unreferenced cover is archived transactionally; shared resources are preserved. The client attempts Storage-API cleanup only through the existing guarded cleanup endpoint. Objects owned by another uploader or shared references can remain for trusted maintenance; an explicit warning is shown. No Storage metadata is deleted directly.

Dashboard Quick Access and Self-Learning use the same lesson-cover projection and existing `LessonCard`. A part thumbnail is no longer a fallback lesson cover. Cards retain their existing image gradient, typography/classes, borders, shadows, interactions, part count and status. A failed image falls back cleanly and requests one route refresh to renew signed access, without an infinite refresh loop. Private signed URLs remain short-lived (600 seconds).

Principal files: `lesson-cover-form.tsx`, `lesson-card.tsx`, `lesson-upload.ts` (reused unchanged), `lesson-image-validation.ts`, lesson/website services, website repository, shared learning contracts/types/model, migration and cover regressions.

## Checkpoint 2B — persistent chapter details

Commit `caf2d47` adds nullable legacy-aware `course_modules.chapter_number` and `summary`; existing `group_type`, `title` and `description` store type, name and full description. Custom types are supported alongside the seven existing presets. New modules default to number 1; the teacher explicitly edits it independently of position. Existing unconfigured modules retain their display fallback until the teacher selects/saves a number. No historical number is inferred and written during migration.

The current Firebase learning editor provides an inline editing panel with preset/custom type, number, name, summary, existing rich-text editor, live title preview, save/cancel, prepopulation, validation and loading/errors. It calls the authorized Supabase RPC rather than legacy Clerk/Prisma handlers. Bounds reuse the established chapter conventions: type 24 characters, number 1–99, name 120, summary 200 and description 2,000 including markup.

Saved student headings/cards use the explicit number, type and title. Offering labels preserve the chapter summary. Full descriptions use a restrictive React-rendered formatting subset (paragraphs, headings, emphasis and lists), with no attributes, scripts, links, images or arbitrary HTML execution. Unsupported rich-text styling is intentionally omitted. The shared `ChapterDescription` renderer does not use `dangerouslySetInnerHTML`.

Reordering changes positions without changing selected numbers. Chapter saves do not modify lesson/segment IDs, course associations, publication, academic records or progress. Legacy builds and older chapter components remain available.

Principal files: `module-details-form.tsx`, `learning-editor.tsx`, `chapter-rich-text.ts`, `chapter-description.tsx`, Self-Learning, shared contracts/model/types, website repository and chapter regressions.

## Local-only migrations — owner approval required

Both migrations were created with Supabase CLI and tested only in disposable local PostgreSQL/PGlite. They are **NOT applied to connected development or production**. Read-only development history still contains exactly 25 migrations through `20261016053117_student_administration_workflows`.

| Pending migration | SHA-256 |
| --- | --- |
| `20261018091735_lesson_covers.sql` | `E58F0D40A0AFAA1B152736C2C66F69B92A4657933B7916F7986216EB5F36FB98` |
| `20261018092002_chapter_metadata.sql` | `8D0423AB55D7EB729A79C8CEBD375114D699C35AA7DACC7532B68C6E2BE91F5A` |

Apply order after separate authorization: covers, then chapter metadata. Migrations 1–25 remain byte-identical. No new tables, public buckets, authentication architecture or privileged browser credentials are introduced. Existing RLS/grants remain; the new internal trigger function has client EXECUTE revoked and an empty search path. Existing authorization/cleanup functions gain the necessary cover-reference handling. The module type constraint is widened deliberately for validated custom text. The existing public editing RPC signature is unchanged.

No installation backfill of cover files, academic records or selected chapter numbers occurs. Recovery should use a reviewed forward correction; do not drop academic rows or restore unsafe permissions. Coordinate code and schema rollout: the new application expects the new columns/actions and must not be deployed against the unchanged 25-migration database.

## Verification and limits

- Application: **200 tests passed**, including seven new cover/chapter tests. TypeScript, lint and architecture checks passed; seven inherited lint warnings remain.
- SQL: **17 suites passed** on fresh PGlite replay and native disposable PostgreSQL, including 21 cover assertions and 18 chapter assertions, plus the existing Exams/Lessons/Homework/Groups/Notifications/Admissions suites.
- Concurrency: **77 independent-session cases passed** (73 existing plus four new cases for competing cover edits, referenced-cover cleanup, cleanup-before-attachment and competing metadata edits).
- SQL checks cover student/foreign-tenant edit denial, draft/expired-enrollment media denial, forged/foreign/PDF cover IDs, reference-aware cleanup, invalid chapter fields, independent number after reorder, and exact lesson/progress preservation.
- Browser: **five Chromium component groups passed**, at desktop 1440px and mobile 390px. Real shared components with explicitly fictional/local transports verify covered/empty/failed-image cards, metadata prepopulation/custom preview/cancel/save and cover replace/remove request shapes. All nonlocal requests were blocked; no JavaScript exceptions or horizontal overflow occurred.
- Rich editor transport in the component harness uses a textarea fixture; this does not prove the real Quill toolbar or authenticated Storage upload end-to-end.
- Production builds: **Firebase/Supabase and Clerk/legacy both passed**, using isolated output directories and in-process local configuration. No environment files were copied into the worktree or committed. Existing Tailwind ambiguous-utility warnings remain.
- `git diff --check` passed.

Initial environment checks ran before dependency copying completed and failed on missing/truncated packages; these are not application failures. Fresh `npm ci` was interrupted after prolonged filesystem extraction. Final application verification used an independent copy of the existing installed dependency tree; no dependency-version or lockfile changes were introduced in Git. A prior card test was updated to assert an explicit cover instead of a part thumbnail. Local harness fixes addressed its isolated tsconfig base URL, a new UTF-8 separator and SQL fixture assumptions (UUID/path constraints, row-lock permissions and test ordering). Final passing runs supersede those retained intermediate logs.

**BLOCKED:** real Firebase-authenticated teacher/student cover upload, publication, signed-media and chapter persistence acceptance against development. This requires explicit authorization to apply both migrations first; no connected accounts/fixtures were created to work around that boundary. Physical-device, Firefox/WebKit and load testing were not performed. Ordinary signed images are not DRM and remain usable until their short expiry.

Ignored evidence: `.local/m2-check-final.log`, `m2-native-final.log`, `m2-fresh.log`, `m2-build-firebase.log`, `m2-build-legacy.log`, and `.local/m2-browser/results.json`. Screenshots: `student-1440.png`, `student-390.png`, `teacher-desktop.png`, `teacher-mobile.png` under `.local/m2-browser/`. Screenshots show synthetic component data, not authenticated acceptance.

## Isolation and cleanup

The localhost-only database harness removed all randomized test databases. The task-owned PostgreSQL cluster was stopped and verified with zero owned databases remaining. Browser contexts and the component server were closed. Local evidence/builds remain ignored. No remote fixtures, Firebase accounts, Storage objects, provider settings or deployed runtimes were created/modified. PR #9, PR #10, `main` and local unpushed acceptance commit `443586f` are preserved.

## Next acceptance gate

Review the draft PR and complete SQL files. Separately authorize the exact migrations for the designated development project, then run real teacher/student upload/replace/remove, unauthorized-media, publication, chapter-save/reorder, refresh and student Dashboard/Self-Learning acceptance with scoped cleanup. This report is not migration, merge or deployment approval.
