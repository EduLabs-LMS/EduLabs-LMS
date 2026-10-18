# Sunday October 18 teacher trial — operations checklist

This is the NEW Firebase/Supabase LMS. No Clerk/Prisma account or academic-data migration is involved. Step 08 is locally implemented but its development migration/browser acceptance is pending approval. Nothing in this document authorizes production configuration, database mutations or deployment.

## Trusted organization and owner provisioning

EduLabs staff provision organizations; teachers and students do not create them. Keep both `create_organization(text,text)` EXECUTE restrictions from migration 17. Do not add a browser service-role credential or a global profile role.

1. The intended teacher signs up with Firebase, verifies email and completes normal onboarding. Have them provide the profile UUID shown in My requests and confirm the exact Firebase UID through the trusted Auth console/verified identity registry. Never infer identity from a matching name/email, and never install a fake external-identity mapping.
2. In the explicitly approved environment, trusted staff verify the precise profile/issuer/subject pair and create the organization and its first active owner in one transaction. Example template, **not executed by Step 08**:

```sql
begin;
do $$
declare owner_profile uuid := '00000000-0000-0000-0000-000000000000';
        firebase_uid text := 'REPLACE_WITH_VERIFIED_FIREBASE_UID';
        organization uuid;
begin
 if not exists (
  select 1 from public.profiles p join private.external_identities i on i.profile_id=p.id
  where p.id=owner_profile and p.status='active' and i.provider='firebase'
    and i.status='active' and i.verified_at is not null
    and i.issuer='https://securetoken.google.com/diagonproduction' and i.subject=firebase_uid
 ) then raise exception 'Verified teacher identity mismatch'; end if;
 insert into public.organizations(name,slug,created_by)
 values('REPLACE_WITH_TEACHER_BRAND','replace-with-approved-unique-slug',owner_profile)
 returning id into organization;
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 values(organization,owner_profile,'owner','active',now());
end $$;
commit;
```

Use the actual approved Firebase project issuer when provisioning another environment. The all-zero UUID is a deliberate non-working placeholder. Confirm the transaction persisted both rows before claiming provisioning succeeded. Existing last-owner protection stays enabled; do not bypass it to remove an owner.

3. The teacher creates/edits/publishes their course through the existing teacher editor. Trusted staff prepare the initial offering/cohort for the correct course, including active status, capacity, enrollment dates, expiry policy and `Africa/Cairo` timezone. Offering creation/staff provisioning is still a staff setup task; Step 08 does not introduce a broad permissions engine or teacher self-service tenant creation.
4. An assistant first completes verified onboarding. Trusted staff assign that exact profile an active organization membership and the intended offering staff role. A teaching assistant may read assigned rosters and use allowed grading/group operations; enrollment management requires an existing offering manager/instructor. Assign group staff through the existing Groups UI. Never promote an assistant globally just to make an operation work.

## Teacher/student use without SQL

- Teacher: Home → Students & Access → select offering → create **Request approval** link → share with intended class. Students register/verify, reopen the link and request access. Teacher reviews exact pending identities and approves/rejects them.
- For an explicitly authorized single-use invitation, ask the verified student for their profile UUID from My requests. Choose invitation, bind that UUID, set the enrollment expiry and share the generated private link directly. Another account cannot consume it; email matching is never used. Revoke unused links through the page when necessary. Links are shown once, expire in seven days from the UI and must be treated as sensitive.
- Existing organization students can be enrolled in another offering using their exact profile ID from a roster. Requests/invitations are required for unknown students. There is no global Firebase account directory exposed to teachers.
- Use Groups & Attendance to assign active enrolled students to real groups. Suspension preserves submissions, progress and attendance history. Reactivation deliberately sets new access expiry; old group intervals remain historical, so reassign through Groups if needed.
- Student: Home/Self Learning for actual published parts; Exams for exams/quizzes; lesson homework for submissions; Notifications for released results/replies; Support for private issues. Homework/practice are not added to the Exams summary.

## Platform support operator provisioning

Support operators are manually vetted technical staff, not global academic administrators. After normal verified onboarding, trusted staff confirm the exact profile/Firebase identity as above, then insert/activate only that UUID in `private.support_operators` in an explicitly approved environment. For organization-specific helpers, use `private.organization_support_staff` plus an active membership in that organization. Never grant client access to these private tables.

Confirm a real operator can read/reply/assign the intended queue and cannot gain course/enrollment management through the operator assignment. Assign queue coverage before the trial. A 48-hour indicator tracks response targets, not guaranteed resolution. Revoking the operator's active flag removes that authority; academic memberships remain independent. Do not delete support history to revoke privileges.

## Configuration that must be verified before hosting the trial

- Owner-approved hosting target and database environment. Do not point a trial build at an unintended project or change `main`/production merely because the Sunday deadline is near.
- Current Firebase/Supabase application mode names and exact `APP_ORIGIN` for the hosted HTTPS origin. The code currently uses `NEXT_PUBLIC_AUTH_BACKEND=firebase-staging` and `LMS_DATA_BACKEND=supabase-staging`; changing production authentication is a separate reviewed action.
- Correct Firebase public web configuration, authorized domains, Email/Password/Google providers as used, verification/password-reset links and actual inbox delivery. Synthetic verification tests do not prove real mail deliverability or quotas.
- Firebase Admin credentials through protected server configuration/secret management, never committed files or `NEXT_PUBLIC_` variables. Preserve revocation-aware server verification.
- Supabase public URL and PUBLISHABLE key in the client; correct trusted Firebase issuer/audience and the expected applied migration history. RLS must stay enabled. No service-role credential is needed for ordinary teacher/student actions.
- HTTPS/cookie/session restoration on desktop and mobile. Authentication continuation is limited to the exact student access routes; do not widen it to arbitrary URLs.
- Course/offering publication, enrollment dates, capacity and expiry. Staff must supply the initial cohort and contextual assignments before asking a teacher to manage admissions.

## Reminders and Web Push

Step 07's bounded reminder worker must be deliberately scheduled using a protected server credential bound to the correct project. `scripts/notification-dispatch.cjs --once --in-app-only` supports reminders without Web Push; consult its required environment checks. No scheduled deployment was created by Step 08. Without a worker, ordinary transaction-generated in-app notifications still work, but near-start scheduled reminders do not run automatically.

Device push additionally requires VAPID public/private configuration, subject, protected dispatcher execution, opt-in and real browser/device receipt testing. Never put the private key/service credential into browser code or reports. Development currently has no validated device delivery; do not promise it to the trial teacher until configured and tested.

## Video, files and unresolved launch risks

- Private lesson/submission resources use the existing ownership, file-signature/type/size validation and authorized Storage access. Check project Storage quota, bucket/privacy policy and intended teacher upload sizes before real uploads.
- Direct external video URLs and ordinary embeds are not DRM. Providers may restrict embedding or fail independently; verify actual teacher videos and supported formats on the students' target devices. Private signed access expires and requires a valid session; it does not prevent screen recording. No streaming/DRM provider was introduced here.
- Legacy fallback dependencies remain. The prior npm audit baseline contains seven high and two low advisories in development tooling/Quill export dependencies; Step 08 does not claim their remediation. Review their trial exposure separately rather than silently accepting them as resolved.
- Existing Supabase Auth password-protection warning and Groups FK-index advisory remain documented. Review environment-specific security advisories after migration. Do not drop indexes or weaken policies merely to silence advisor output.
- Final real Firebase end-to-end, direct REST/RPC denial, mobile/desktop acceptance and exact cleanup are mandatory after migration approval. They are not replaced by local SQL impersonation tests or a simulated manual-review demo.

## Go/no-go

Before Sunday, confirm: approved migration applied and verified; real acceptance and cleanup passed; teacher/owner/operator identities intentionally provisioned; initial course/cohort/group usable; deployment separately authorized; email/session/video/storage checks passed; and any missing scheduled reminders/push explicitly communicated. Keep production untouched until its own approval.

### October 16 acceptance: Firebase email verification blocker

Actual student signup succeeded and the unverified account was denied student-administration access. Firebase Admin verification-link generation then returned HTTP 400 `TOO_MANY_ATTEMPTS_TRY_LATER` (wrapped as `auth/internal-error` by the SDK), including when an explicit localhost continuation was supplied. This is a provider throttle, not evidence of successful email verification. Only the manifest-owned synthetic student was marked verified through Admin so the remaining real Firebase-session authorization workflows could be tested. No production auth configuration was changed.

Before admitting real trial students, the owner must confirm Firebase verification-email/link quota availability, retry a fresh verification flow after the throttle clears and verify actual inbox delivery on the intended trial domain. Do not disable email verification, grant unverified access or describe the synthetic Admin step as verification-link acceptance. Provider quota/billing/domain changes require their own reviewed configuration action.
