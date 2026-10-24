-- Trusted operator procedure: grant platform administration to ONE existing Firebase identity.
-- Never run from the application, a browser, a migration or a rollback test. It commits.
--
-- 1. The person signs in once so their profile and external identity exist
--    (the app creates them through onboard_firebase_profile()).
-- 2. Find their Firebase UID in the Firebase console (Authentication -> Users -> "User UID").
--    The issuer is https://securetoken.google.com/<firebase-project-id> for the target project.
-- 3. Run as postgres through your existing protected connection (no credentials here):
--
--      psql -X -v ON_ERROR_STOP=1 `
--        -v firebase_issuer="<REPLACE-WITH-ISSUER>" `
--        -v firebase_uid="<REPLACE-WITH-FIREBASE-UID>" `
--        -v grant_note="<who approved this and why>" `
--        -f supabase/manual/bootstrap_platform_admin.sql
--
-- Do not guess a UID. Do not substitute an email address: identity is issuer + subject.
-- The script refuses unless the mapping already exists, is active and its profile is active.
-- It never creates a profile, never reactivates a revoked row silently and never overwrites.
\set ON_ERROR_STOP on
begin;
select set_config('edulabs.admin_issuer', :'firebase_issuer', true);
select set_config('edulabs.admin_subject', :'firebase_uid', true);
select set_config('edulabs.admin_note', :'grant_note', true);
do $$
declare v_issuer text := current_setting('edulabs.admin_issuer'); v_subject text := current_setting('edulabs.admin_subject');
 v_note text := current_setting('edulabs.admin_note'); v_target uuid;
begin
 if current_user <> 'postgres' then raise exception 'Trusted database administrator required' using errcode='42501'; end if;
 if v_issuer !~ '^https://securetoken\.google\.com/[a-z0-9-]{3,64}$' or v_issuer like '%REPLACE%' then
  raise exception 'firebase_issuer must be https://securetoken.google.com/<project-id>' using errcode='22023'; end if;
 if v_subject = '' or length(v_subject) > 128 or v_subject like '%REPLACE%' or v_subject ~ '[[:space:]@]' then
  raise exception 'firebase_uid must be the real Firebase UID (not an email or placeholder)' using errcode='22023'; end if;
 if coalesce(length(btrim(v_note)),0) not between 1 and 500 or v_note like '%REPLACE%' then
  raise exception 'grant_note is required (1-500 characters)' using errcode='22023'; end if;
 select e.profile_id into v_target from private.external_identities e join public.profiles p on p.id=e.profile_id
  where e.provider='firebase' and e.issuer=v_issuer and e.subject=v_subject and e.status='active' and p.status='active' for share of e,p;
 if v_target is null then raise exception 'No active Firebase identity with an active profile for that issuer/UID. Have them sign in first.' using errcode='23514'; end if;
 insert into private.platform_admins(user_id,note) values(v_target,btrim(v_note));
 perform set_config('edulabs.admin_granted', v_target::text, true);
end $$;
select a.user_id as granted_profile_id, a.active, a.granted_at from private.platform_admins a
where a.user_id = current_setting('edulabs.admin_granted')::uuid;
commit;
