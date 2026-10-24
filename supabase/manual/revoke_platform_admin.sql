-- Trusted operator procedure: deactivate a platform administrator (kept for audit; not deleted).
--   psql -X -v ON_ERROR_STOP=1 -v profile_id="<profile-uuid>" -f supabase/manual/revoke_platform_admin.sql
\set ON_ERROR_STOP on
begin;
select set_config('edulabs.revoke_profile', :'profile_id', true);
do $$
begin
 if current_user <> 'postgres' then raise exception 'Trusted database administrator required' using errcode='42501'; end if;
 update private.platform_admins set active=false where user_id=current_setting('edulabs.revoke_profile')::uuid and active;
 if not found then raise exception 'No active platform administrator with that profile id' using errcode='23514'; end if;
end $$;
commit;
