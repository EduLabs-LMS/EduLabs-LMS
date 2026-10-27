# Decisions and deferred work

- Owner chose the pre-redesign student/core base fa67875, not post-merge d96c40e.
- Owner approved removing legacy teacher-facing presentation from this branch.
- Backend/API/security/schema/contracts and student functionality are preserved.
- Reliability logic is ported separately; no friend-design ancestry is imported.
- Firebase identity + Supabase/PostgreSQL/RLS is the NEW LMS. Clerk fallback remains
  buildable for student/legacy routes. Old teacher UI compatibility is intentionally
  retired here; do not claim full teacher-UI backward compatibility.
- Organizations are managed/provisioned by trusted EduLabs staff, not end-user signup.
- One teacher organization can have multiple programs/stages in one dashboard.
- Enrollment is offering-specific; publication alone does not grant access.
- No changes to the established enrollment-end policy, role grants or RLS.
- Jitsi backend tokens/privacy/attendance and DRM are deferred.
- PR #19 remains separate. Do not merge, retarget, cherry-pick or import it. Later
  email work must be reviewed and ported on its own without friend UI ancestry.
- Teacher self-service offering setup, assistant permission expansion, roster email
  disclosure and a real waitlist add-on switch require product/backend decisions.
- Existing teacher API operations remain callable only under existing authorization;
  retiring forms does not disable the backend or change data.
- No migrations, connected fixtures, provider writes, staging or production deployment
  were authorized by this preparation. Local disposable PostgreSQL is test-only.
- Platform administration is a dedicated private registry (private.platform_admins) keyed to
  the verified Firebase identity; it is not a role, membership or claim. Initial admin is
  granted only by a trusted operator SQL procedure; there is no UI/API to grant it.
- Teacher provisioning is invitation-only. Educational structure stays tenant-owned (no global
  catalog): Education System = academic_programs (+ optional examination_board), Grade Level =
  academic_stages, Subject = new academic_subjects, Course.subject_id. Creating a portal does
  not grant ownership; a verified-email-bound, single-use, hash-only invitation does.
- Demo spaces: a platform administrator may mark a provisioned teaching space as a demo and fill/clear tagged synthetic data
  (migration 20261027120000, not applied anywhere by this change). Any new teacher-facing feature that stores data must extend
  the demo seed in the same change: new seed module, bump the seed version, add its tables to the demo_seed_rows allowed list in
  a new migration, and update docs/ai/DEMO_DATA.md. scripts/demo-spaces.test.cjs enforces that the SQL, the service constant and
  the document agree.
