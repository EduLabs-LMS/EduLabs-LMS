# Architecture and security map

One Next.js App Router deployment, three code layers:
- frontend/: presentation, client state and browser transports.
- server/: server-only handlers, services, RLS-bound repositories and integrations.
- shared/: contracts and pure utilities. app/ composes pages and exposes thin routes.

Firebase is the NEW LMS direction. Actual code selects it only when
NEXT_PUBLIC_AUTH_BACKEND=firebase-staging and LMS_DATA_BACKEND=supabase-staging.
Clerk/Prisma remains the fallback build, not the new academic database.
Firebase Admin verification checks revocation/project identity. Supabase maps the
verified issuer/subject to stable profile UUIDs; email matching and client IDs do
not grant identity or permissions. Ordinary application clients use the caller's
verified token plus publishable key, respecting RLS. Never expose privileged keys.
Direct table access (fix track 1): the browser role reads only the tables the app reads and writes nothing
directly; every write is a private security-definer function behind a public invoker wrapper
(`course_update`, `course_run`, ...). `scripts/direct-access.test.cjs` fails if app code writes a table.
Legacy exam tables and functions are closed to every client role, `/api/secure-exams/*` answers 410.
See fixes/TRACK-01-direct-access.md.
Reads are authorized once per statement (fix track 2a): the read policies of courses, organizations, profiles, course_modules,
lessons, lesson_blocks, lesson_segments and lesson_resources check `id in (select private.my_...())`, a security-definer set the
caller may see, computed once per statement from the existing helpers' own rules. The helpers stay for functions; a new read policy
must use a set, never a per-row helper. The page context reads the caller's spaces and courses through `public.my_scope()`; the
student lesson page reads the course outline and the opened lesson only. The caller is resolved per statement, never cached.
See fixes/TRACK-02a-my-scope.md.

Organizations are tenant boundaries; roles belong to organizations/courses/offerings.
A teacher in one organization is not an admin in another. Academic programs and
stages belong to one tenant. Selecting a stage does not enroll the student.
Courses contain reusable content; an offering is its delivery/cohort. Students need
active eligible enrollment and published content. Course, lesson and part publication
are distinct. Established active/unexpired access after an offering ends is unchanged.

Exact-origin CSRF, request bounds, UUID validation, handler authorization and RLS stay
in place. Neutral teacher pages confer no backend privileges. Shared support operators
remain support-specific, never global academic admins. Private media is authorized
and signed briefly; ordinary video is not DRM.

Canonical references: ../architecture.md (current notice plus historical details),
../database-architecture.md, ../firebase-auth-integration.md (historical rollout),
../development-db-migration-ledger.md, ../organization-provisioning.md, migrations,
server/services/application-auth.ts, server/integrations/supabase.ts and middleware.ts.

Platform admin: /platform-admin/teachers and /api/platform-admin/portals, plus
/api/teacher-invitations/accept (middleware allowlisted in Firebase mode). Authorization is
private.is_platform_admin() in PostgreSQL; see ../platform-admin-teacher-provisioning.md.
