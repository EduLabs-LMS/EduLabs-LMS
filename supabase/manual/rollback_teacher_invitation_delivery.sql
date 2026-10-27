-- Trusted operator procedure: remove the structures added by
-- supabase/migrations/20261025100000_teacher_invitation_delivery.sql, ONLY while they hold no data.
--   psql -X -v ON_ERROR_STOP=1 -f supabase/manual/rollback_teacher_invitation_delivery.sql
-- Not a migration and never applied automatically. Run it BEFORE supabase/manual/rollback_platform_admin_provisioning.sql
-- (that script only knows the structures of the earlier migration). It refuses, changing nothing, if any invitation
-- records an e-mail delivery attempt, because that is the only record of what was sent, or a stored link salt (discarding it would make an already-issued
-- link impossible to re-create). After a successful run the
-- schema equals the state after migration 20261024120000, except that the remote migration-history row for
-- 20261025100000 must be removed by the operator (see docs/platform-admin-staging-release.md).
\set ON_ERROR_STOP on
begin;
do $$
begin
 if current_user <> 'postgres' then raise exception 'Trusted database administrator required' using errcode='42501'; end if;
 if to_regprocedure('private.platform_record_invitation_delivery(uuid,text,text,text)') is null then raise exception 'Invitation delivery schema is not installed' using errcode='42P01'; end if;
 if exists(select 1 from private.teacher_invitations where delivery_status <> 'not_sent' or delivery_attempted_at is not null or delivery_provider_ref is not null or delivery_failure is not null or delivery_attempts <> 0 or link_salt is not null)
  then raise exception 'Delivery attempts or link salts are recorded; refusing to discard them' using errcode='23514'; end if;
end $$;

drop function public.platform_record_invitation_delivery(uuid,text,text,text), public.platform_invitation_delivery(uuid), public.teacher_invitation_preview(text),
 public.platform_store_invitation_salt(uuid,text), public.platform_invitation_link(uuid);
drop function private.platform_record_invitation_delivery(uuid,text,text,text), private.platform_invitation_delivery(uuid), private.teacher_invitation_preview(text),
 private.platform_store_invitation_salt(uuid,text), private.platform_invitation_link(uuid);

alter table private.teacher_invitations
 drop constraint teacher_invitations_delivery_shape,
 drop column delivery_status,
 drop column delivery_attempted_at,
 drop column delivery_provider_ref,
 drop column delivery_failure,
 drop column delivery_attempts,
 drop column link_salt;
commit;
