-- Trusted operator procedure: remove the structures added by
-- supabase/migrations/20261024120000_platform_admin_teacher_provisioning.sql, ONLY while they hold no data.
--   psql -X -v ON_ERROR_STOP=1 -f supabase/manual/rollback_platform_admin_provisioning.sql
-- Not a migration and never applied automatically. It refuses (changing nothing) if any administrator,
-- invitation, audit row, subject, course subject reference or examination board exists, because those are
-- records of real administrative actions. After a successful run the schema equals the 31-migration baseline,
-- except that the remote migration-history row for the new version must be removed by the operator
-- (see docs/platform-admin-staging-release.md).
\set ON_ERROR_STOP on
begin;
do $$
begin
 if current_user <> 'postgres' then raise exception 'Trusted database administrator required' using errcode='42501'; end if;
 if to_regclass('private.platform_admins') is null then raise exception 'Platform administration schema is not installed' using errcode='42P01'; end if;
 if exists(select 1 from private.platform_admins) then raise exception 'Platform administrators exist; revoke and archive them first' using errcode='23514'; end if;
 if exists(select 1 from private.teacher_invitations) then raise exception 'Teacher invitations exist; refusing to discard them' using errcode='23514'; end if;
 if exists(select 1 from private.platform_audit) then raise exception 'Audit records exist; refusing to discard them' using errcode='23514'; end if;
 if exists(select 1 from public.academic_subjects) then raise exception 'Subjects exist; refusing to discard them' using errcode='23514'; end if;
 if exists(select 1 from public.courses where subject_id is not null) then raise exception 'Courses reference subjects; refusing' using errcode='23514'; end if;
 if exists(select 1 from public.academic_programs where examination_board is not null) then raise exception 'Examination boards exist; refusing' using errcode='23514'; end if;
end $$;

drop function public.platform_provision_teacher(jsonb,text), public.platform_reissue_teacher_invitation(uuid,text,integer,text),
 public.platform_revoke_teacher_invitation(uuid), public.accept_teacher_invitation(text),
 public.platform_portal_overview(integer), public.platform_portal_detail(uuid), public.is_platform_admin();
drop function private.platform_provision_teacher(jsonb,text), private.platform_reissue_teacher_invitation(uuid,text,integer,text),
 private.platform_revoke_teacher_invitation(uuid), private.accept_teacher_invitation(text),
 private.platform_portal_overview(integer), private.platform_portal_detail(uuid), private.is_platform_admin();

alter table public.courses drop constraint courses_subject_tenant_fk;
drop index public.courses_subject_idx;
alter table public.courses drop column subject_id;
drop table public.academic_subjects;
alter table public.academic_programs drop column examination_board;

drop table private.teacher_invitations;
drop table private.platform_audit;
drop table private.platform_admins;
drop function private.teacher_invitation_guard(), private.platform_audit_append_only(), private.write_platform_audit(uuid,text,text,uuid,uuid,jsonb),
 private.slugify(text,text), private.next_free_slug(text,text[]), private.clean_text(jsonb,integer,text), private.token_hash_bytes(text);
commit;
