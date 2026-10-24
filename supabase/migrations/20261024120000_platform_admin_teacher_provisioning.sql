-- Platform administration and teacher provisioning V1.
-- Additive only: no existing table, function, policy or row is rewritten. Educational structure
-- stays in the tenant-owned academic model (academic_programs = Education System,
-- academic_stages = Grade Level, courses). No global catalog and no automatic backfill.
-- Adds: an optional examination board on programs, a tenant-owned subject table with an
-- optional course reference, and a private invitation + append-only audit registry.
begin;

-- Explicit, private platform-admin registry. Rows are inserted only by the trusted
-- operator procedure supabase/manual/bootstrap_platform_admin.sql.
create table private.platform_admins (
 user_id uuid primary key references public.profiles(id) on delete restrict,
 active boolean not null default true,
 granted_at timestamptz not null default now(),
 note text check (note is null or length(note) <= 500)
);
alter table private.platform_admins enable row level security;
revoke all on private.platform_admins from public,anon,authenticated,service_role;

-- Identity comes only from the verified token through current_app_user_id(). auth.uid() is
-- never used: it is not the profile UUID.
create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.platform_admins a join public.profiles p on p.id=a.user_id
  where a.user_id=(select private.current_app_user_id()) and a.active and p.status='active')
$$;
revoke all on function private.is_platform_admin() from public,anon;
grant execute on function private.is_platform_admin() to authenticated;
create function public.is_platform_admin() returns boolean
language sql stable security invoker set search_path='' as $$ select private.is_platform_admin() $$;
revoke all on function public.is_platform_admin() from public,anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------------------
-- Tenant-owned academic additions (all nullable / additive).
-- ---------------------------------------------------------------------------------------
-- V1 examination board: a simple optional label on the Education System. A later dedicated
-- board entity can be introduced and this column migrated without touching other tables.
alter table public.academic_programs add column examination_board text
 check (examination_board is null or (examination_board = btrim(examination_board)
  and length(examination_board) between 1 and 120 and examination_board !~ '[[:cntrl:]]'));

create table public.academic_subjects (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 slug text not null check (length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 label text not null check (length(btrim(label)) between 1 and 160 and label !~ '[[:cntrl:]]'),
 label_key text generated always as (lower(regexp_replace(btrim(label),'[[:space:]]+',' ','g'))) stored,
 position integer not null default 0 check (position between 0 and 1000000),
 status text not null default 'active' check (status in ('active','archived')),
 revision bigint not null default 0 check (revision >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id,slug), unique (organization_id,label_key), unique (organization_id,id)
);
create index academic_subjects_order_idx on public.academic_subjects(organization_id,status,position,id);
create trigger touch_updated_at before update on public.academic_subjects for each row execute function private.touch_updated_at();

-- A course may reference one subject of its own organization. Existing courses stay NULL.
alter table public.courses add column subject_id uuid;
alter table public.courses add constraint courses_subject_tenant_fk
 foreign key (organization_id,subject_id) references public.academic_subjects(organization_id,id) on delete restrict;
create index courses_subject_idx on public.courses(organization_id,subject_id) where subject_id is not null;

alter table public.academic_subjects enable row level security;
revoke all on public.academic_subjects from public,anon,authenticated;
grant select on public.academic_subjects to authenticated;
create policy academic_subjects_select on public.academic_subjects for select to authenticated
 using (private.can_view_academic_organization(organization_id) and (status='active' or private.is_org_member(organization_id)));

-- ---------------------------------------------------------------------------------------
-- Private invitation registry and append-only audit trail.
-- ---------------------------------------------------------------------------------------
create table private.teacher_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254
  and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 token_hash bytea not null unique check (octet_length(token_hash) = 32),
 status text not null default 'pending' check (status in ('pending','accepted','revoked')),
 expires_at timestamptz not null,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 accepted_by uuid references public.profiles(id) on delete restrict,
 accepted_at timestamptz,
 revoked_by uuid references public.profiles(id) on delete restrict,
 revoked_at timestamptz,
 revoke_reason text check (revoke_reason in ('revoked','superseded')),
 check (expires_at > created_at),
 check ((status='accepted') = (accepted_by is not null and accepted_at is not null)),
 check ((status='revoked') = (revoked_by is not null and revoked_at is not null and revoke_reason is not null))
);
create unique index teacher_invitations_one_pending on private.teacher_invitations(organization_id) where status='pending';
create unique index teacher_invitations_one_accepted on private.teacher_invitations(organization_id) where status='accepted';
create index teacher_invitations_email_idx on private.teacher_invitations(email,status);
alter table private.teacher_invitations enable row level security;
revoke all on private.teacher_invitations from public,anon,authenticated,service_role;

create function private.teacher_invitation_guard() returns trigger
language plpgsql set search_path='' as $$ begin
 if exists(select 1 from private.teacher_invitations where organization_id=new.organization_id and status='accepted') then
  raise exception 'A portal whose invitation was accepted cannot receive another invitation' using errcode='23505'; end if;
 return new;
end $$;
revoke all on function private.teacher_invitation_guard() from public,anon,authenticated;
create trigger teacher_invitation_guard before insert on private.teacher_invitations
 for each row execute function private.teacher_invitation_guard();

create table private.platform_audit (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default now(),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 action text not null check (action in ('portal.provision','invitation.revoke','invitation.reissue','invitation.accept')),
 target_type text not null check (target_type in ('organization','invitation')),
 target_id uuid not null,
 organization_id uuid references public.organizations(id) on delete restrict,
 detail jsonb not null default '{}' check (jsonb_typeof(detail)='object' and octet_length(detail::text) <= 4000)
);
create index platform_audit_org_idx on private.platform_audit(organization_id,id desc);
alter table private.platform_audit enable row level security;
revoke all on private.platform_audit from public,anon,authenticated,service_role;
create function private.platform_audit_append_only() returns trigger
language plpgsql set search_path='' as $$ begin
 raise exception 'Audit records are append-only' using errcode='42501';
end $$;
revoke all on function private.platform_audit_append_only() from public,anon,authenticated;
create trigger platform_audit_no_change before update or delete on private.platform_audit
 for each row execute function private.platform_audit_append_only();
create trigger platform_audit_no_truncate before truncate on private.platform_audit
 for each statement execute function private.platform_audit_append_only();

-- ---------------------------------------------------------------------------------------
-- Helpers (not callable by API roles).
-- ---------------------------------------------------------------------------------------
create function private.slugify(p_text text,p_fallback text) returns text
language sql immutable set search_path='' as $$
 select coalesce(nullif(trim(both '-' from left(trim(both '-' from regexp_replace(lower(p_text),'[^a-z0-9]+','-','g')),60)),''),p_fallback)
$$;
create function private.next_free_slug(p_base text,p_taken text[]) returns text
language plpgsql immutable set search_path='' as $$
declare s text := p_base; n integer := 1;
begin
 while s = any(p_taken) loop n := n + 1; s := p_base || '-' || n; end loop;
 return s;
end $$;
create function private.clean_text(p_value jsonb,p_max integer,p_what text) returns text
language plpgsql immutable set search_path='' as $$
declare v text;
begin
 if p_value is null or jsonb_typeof(p_value) <> 'string' then raise exception '% must be text',p_what using errcode='22023'; end if;
 v := btrim(regexp_replace(p_value #>> '{}','[[:space:]]+',' ','g'));
 if length(v) not between 1 and p_max or v ~ '[[:cntrl:]]' then raise exception '% is invalid',p_what using errcode='22023'; end if;
 return v;
end $$;
create function private.token_hash_bytes(p_hash text) returns bytea
language plpgsql immutable set search_path='' as $$
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation token hash' using errcode='22023'; end if;
 return decode(p_hash,'hex');
end $$;
create function private.write_platform_audit(p_actor uuid,p_action text,p_target_type text,p_target uuid,p_org uuid,p_detail jsonb)
returns void language sql set search_path='' as $$
 insert into private.platform_audit(actor_id,action,target_type,target_id,organization_id,detail)
 values(p_actor,p_action,p_target_type,p_target,p_org,coalesce(p_detail,'{}'::jsonb))
$$;
revoke all on function private.slugify(text,text),private.next_free_slug(text,text[]),private.clean_text(jsonb,integer,text),
 private.token_hash_bytes(text),private.write_platform_audit(uuid,text,text,uuid,uuid,jsonb) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- Provisioning: portal + pending owner invitation + educational path in ONE transaction.
-- The caller supplies only the SHA-256 of an invitation secret generated by the trusted
-- server; the secret itself is never stored. Any failure rolls the whole call back.
-- ---------------------------------------------------------------------------------------
create function private.platform_provision_teacher(p_request jsonb,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid := private.current_app_user_id();
 v_email text; v_days integer := 7; v_hash bytea;
 org uuid; inv uuid; prog uuid; stg uuid; subj uuid; crs uuid; v_expires timestamptz;
 sys jsonb; grd jsonb; sbj jsonb; v_course jsonb; sys_i integer; grd_i integer; sub_i integer;
 v_label text; v_board text; v_slug text; v_title text;
 taken_programs text[] := '{}'; taken_stages text[]; taken_subjects text[] := '{}';
 sys_labels text[] := '{}'; grd_labels text[]; sub_labels text[] := '{}';
 grade_keys text[] := '{}'; subject_keys text[] := '{}'; k text;
 grade_stage jsonb := '{}'; subject_ids jsonb := '{}'; n_grades integer := 0;
begin
 if u is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_request is null or jsonb_typeof(p_request) <> 'object' or octet_length(p_request::text) > 20000
  or exists(select 1 from jsonb_object_keys(p_request) x where x not in ('teacherEmail','expiresInDays','systems','subjects','course')) then
  raise exception 'Invalid provisioning request' using errcode='22023'; end if;
 v_email := lower(private.clean_text(p_request->'teacherEmail',254,'Teacher email'));
 if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Teacher email is invalid' using errcode='22023'; end if;
 if p_request ? 'expiresInDays' then
  if jsonb_typeof(p_request->'expiresInDays') <> 'number' or (p_request->>'expiresInDays') not in ('1','3','7','14','30') then
   raise exception 'Invitation lifetime is not allowed' using errcode='22023'; end if;
  v_days := (p_request->>'expiresInDays')::integer;
 end if;
 v_hash := private.token_hash_bytes(p_token_hash);
 if jsonb_typeof(p_request->'systems') is distinct from 'array' or jsonb_array_length(p_request->'systems') not between 1 and 5
  or jsonb_typeof(p_request->'subjects') is distinct from 'array' or jsonb_array_length(p_request->'subjects') not between 1 and 20
  or jsonb_typeof(p_request->'course') is distinct from 'object' then
  raise exception 'An education system, a subject and a first course are required' using errcode='22023'; end if;
 v_course := p_request->'course';
 if exists(select 1 from jsonb_object_keys(v_course) x where x not in ('title','gradeKey','subjectKey')) then
  raise exception 'Invalid course fields' using errcode='22023'; end if;
 v_title := private.clean_text(v_course->'title',160,'Course title');

 -- One live invitation per email; serialized so a double submit cannot create two portals.
 perform pg_advisory_xact_lock(hashtextextended('teacher-invitation:'||v_email,0));
 if exists(select 1 from private.teacher_invitations where email=v_email and status='pending' and expires_at > clock_timestamp()) then
  raise exception 'A pending invitation already exists for this email' using errcode='23505'; end if;

 -- Neutral placeholder: the teacher chooses the display name during onboarding.
 insert into public.organizations(name,slug,status)
  values('Pending teacher portal','portal-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),'active') returning id into org;

 sys_i := 0;
 for sys in select value from jsonb_array_elements(p_request->'systems') loop
  if jsonb_typeof(sys) <> 'object' or exists(select 1 from jsonb_object_keys(sys) x where x not in ('label','examinationBoard','grades')) then
   raise exception 'Invalid education system' using errcode='22023'; end if;
  v_label := private.clean_text(sys->'label',160,'Education system name');
  if lower(v_label) = any(sys_labels) then raise exception 'Duplicate education system' using errcode='23505'; end if;
  sys_labels := sys_labels || lower(v_label);
  v_board := case when sys ? 'examinationBoard' and jsonb_typeof(sys->'examinationBoard') <> 'null'
   then private.clean_text(sys->'examinationBoard',120,'Examination board') end;
  if jsonb_typeof(sys->'grades') is distinct from 'array' or jsonb_array_length(sys->'grades') not between 1 and 20 then
   raise exception 'Each education system needs 1 to 20 grade levels' using errcode='22023'; end if;
  v_slug := private.next_free_slug(private.slugify(v_label,'education-system'),taken_programs);
  taken_programs := taken_programs || v_slug;
  insert into public.academic_programs(organization_id,slug,label,description,position,status,examination_board)
   values(org,v_slug,v_label,null,sys_i,'active',v_board) returning id into prog;
  sys_i := sys_i + 1;
  grd_i := 0; taken_stages := '{}'; grd_labels := '{}';
  for grd in select value from jsonb_array_elements(sys->'grades') loop
   if jsonb_typeof(grd) <> 'object' or exists(select 1 from jsonb_object_keys(grd) x where x not in ('key','label')) then
    raise exception 'Invalid grade level' using errcode='22023'; end if;
   k := private.clean_text(grd->'key',40,'Grade level key');
   if k !~ '^[a-z0-9_-]+$' or k = any(grade_keys) then raise exception 'Grade level key is invalid or repeated' using errcode='22023'; end if;
   grade_keys := grade_keys || k;
   v_label := private.clean_text(grd->'label',160,'Grade level name');
   if lower(v_label) = any(grd_labels) then raise exception 'Duplicate grade level' using errcode='23505'; end if;
   grd_labels := grd_labels || lower(v_label);
   v_slug := private.next_free_slug(private.slugify(v_label,'grade-level'),taken_stages);
   taken_stages := taken_stages || v_slug;
   insert into public.academic_stages(organization_id,program_id,slug,label,description,position,status)
    values(org,prog,v_slug,v_label,null,grd_i,'active') returning id into stg;
   grade_stage := grade_stage || jsonb_build_object(k,stg);
   grd_i := grd_i + 1; n_grades := n_grades + 1;
  end loop;
 end loop;

 sub_i := 0;
 for sbj in select value from jsonb_array_elements(p_request->'subjects') loop
  if jsonb_typeof(sbj) <> 'object' or exists(select 1 from jsonb_object_keys(sbj) x where x not in ('key','label')) then
   raise exception 'Invalid subject' using errcode='22023'; end if;
  k := private.clean_text(sbj->'key',40,'Subject key');
  if k !~ '^[a-z0-9_-]+$' or k = any(subject_keys) then raise exception 'Subject key is invalid or repeated' using errcode='22023'; end if;
  subject_keys := subject_keys || k;
  v_label := private.clean_text(sbj->'label',160,'Subject name');
  if lower(v_label) = any(sub_labels) then raise exception 'Duplicate subject' using errcode='23505'; end if;
  sub_labels := sub_labels || lower(v_label);
  v_slug := private.next_free_slug(private.slugify(v_label,'subject'),taken_subjects);
  taken_subjects := taken_subjects || v_slug;
  insert into public.academic_subjects(organization_id,slug,label,position) values(org,v_slug,v_label,sub_i) returning id into subj;
  subject_ids := subject_ids || jsonb_build_object(k,subj);
  sub_i := sub_i + 1;
 end loop;

 if jsonb_typeof(v_course->'gradeKey') is distinct from 'string' or not (grade_stage ? (v_course->>'gradeKey'))
  or jsonb_typeof(v_course->'subjectKey') is distinct from 'string' or not (subject_ids ? (v_course->>'subjectKey')) then
  raise exception 'The first course must use one of the configured grade levels and subjects' using errcode='22023'; end if;
 stg := (grade_stage->>(v_course->>'gradeKey'))::uuid;
 subj := (subject_ids->>(v_course->>'subjectKey'))::uuid;
 -- Empty course: no chapters, lessons, groups, students or media. Owner access is inherited
 -- from the organization owner role once the invitation is accepted.
 insert into public.courses(organization_id,title,slug,status,visibility,subject_id)
  values(org,v_title,private.slugify(v_title,'course'),'draft','private',subj) returning id into crs;
 insert into public.course_stage_assignments(course_id,stage_id,organization_id) values(crs,stg,org);
 insert into private.course_stage_versions(course_id,revision) values(crs,1);

 v_expires := clock_timestamp() + make_interval(days => v_days);
 insert into private.teacher_invitations(organization_id,email,token_hash,expires_at,created_by)
  values(org,v_email,v_hash,v_expires,u) returning id into inv;
 perform private.write_platform_audit(u,'portal.provision','organization',org,org,
  jsonb_build_object('invitationId',inv,'courseId',crs,'systems',sys_i,'grades',n_grades,'subjects',sub_i));
 return jsonb_build_object('organizationId',org,'invitationId',inv,'courseId',crs,'expiresAt',v_expires);
end $$;

-- Re-issuing supersedes any pending invitation. Allowed until an invitation is accepted.
create function private.platform_reissue_teacher_invitation(p_organization_id uuid,p_token_hash text,p_expires_in_days integer,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid := private.current_app_user_id(); v_hash bytea; v_email text; old private.teacher_invitations; inv uuid; v_expires timestamptz;
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_expires_in_days is null or p_expires_in_days not in (1,3,7,14,30) then raise exception 'Invitation lifetime is not allowed' using errcode='22023'; end if;
 v_hash := private.token_hash_bytes(p_token_hash);
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'Portal not found' using errcode='PT404'; end if;
 select * into old from private.teacher_invitations where organization_id=p_organization_id order by created_at desc,id desc limit 1;
 if old.id is null then raise exception 'Portal not found' using errcode='PT404'; end if;
 if exists(select 1 from private.teacher_invitations where organization_id=p_organization_id and status='accepted') then
  raise exception 'The invitation was already accepted' using errcode='PT409'; end if;
 v_email := case when p_email is null then old.email else lower(private.clean_text(to_jsonb(p_email),254,'Teacher email')) end;
 if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Teacher email is invalid' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('teacher-invitation:'||v_email,0));
 if exists(select 1 from private.teacher_invitations where email=v_email and status='pending' and expires_at > clock_timestamp()
  and organization_id <> p_organization_id) then
  raise exception 'A pending invitation already exists for this email' using errcode='23505'; end if;
 update private.teacher_invitations set status='revoked',revoked_by=u,revoked_at=clock_timestamp(),revoke_reason='superseded'
  where organization_id=p_organization_id and status='pending';
 v_expires := clock_timestamp() + make_interval(days => p_expires_in_days);
 insert into private.teacher_invitations(organization_id,email,token_hash,expires_at,created_by)
  values(p_organization_id,v_email,v_hash,v_expires,u) returning id into inv;
 perform private.write_platform_audit(u,'invitation.reissue','invitation',inv,p_organization_id,jsonb_build_object('supersedes',old.id));
 return jsonb_build_object('organizationId',p_organization_id,'invitationId',inv,'expiresAt',v_expires);
end $$;

create function private.platform_revoke_teacher_invitation(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); inv private.teacher_invitations;
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'Portal not found' using errcode='PT404'; end if;
 select * into inv from private.teacher_invitations where organization_id=p_organization_id and status='pending' for update;
 if inv.id is null then raise exception 'There is no pending invitation to revoke' using errcode='PT409'; end if;
 update private.teacher_invitations set status='revoked',revoked_by=u,revoked_at=clock_timestamp(),revoke_reason='revoked' where id=inv.id;
 perform private.write_platform_audit(u,'invitation.revoke','invitation',inv.id,p_organization_id,'{}'::jsonb);
 return jsonb_build_object('organizationId',p_organization_id,'invitationId',inv.id);
end $$;

-- Acceptance: the caller proves possession of the secret AND holds a verified Firebase
-- identity whose verified email equals the invited email. The tenant comes from the stored
-- invitation, never from the client. Consumption and owner membership are one transaction.
create function private.accept_teacher_invitation(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid := private.current_app_user_id(); v_hash bytea; v_email text; inv private.teacher_invitations; org uuid;
begin
 if u is null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 v_hash := private.token_hash_bytes(p_token_hash);
 v_email := lower(btrim(coalesce(auth.jwt()->>'email','')));
 if v_email = '' or auth.jwt()->>'email_verified' is distinct from 'true'
  or not exists(select 1 from private.external_identities e where e.profile_id=u and e.provider='firebase'
   and e.issuer=auth.jwt()->>'iss' and e.subject=auth.jwt()->>'sub' and e.status='active') then
  raise exception 'A verified email is required to accept an invitation' using errcode='42501'; end if;
 select organization_id into org from private.teacher_invitations where token_hash=v_hash;
 if org is null then raise exception 'Invitation unavailable' using errcode='PT404'; end if;
 perform 1 from public.organizations where id=org for update;
 perform 1 from public.profiles where id=u for share;
 select * into inv from private.teacher_invitations where token_hash=v_hash for update;
 if inv.status = 'accepted' then raise exception 'Invitation already used' using errcode='PT409'; end if;
 if inv.status = 'revoked' then raise exception 'Invitation revoked' using errcode='PT410'; end if;
 if inv.expires_at <= clock_timestamp() then raise exception 'Invitation expired' using errcode='PT410'; end if;
 if inv.email <> v_email then raise exception 'This invitation was issued to a different email address' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations where id=org and status='active') then
  raise exception 'Invitation unavailable' using errcode='PT404'; end if;
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
  values(org,u,'owner','active',clock_timestamp())
  on conflict (organization_id,user_id) do update set role='owner',status='active',joined_at=coalesce(public.organization_memberships.joined_at,clock_timestamp());
 update private.teacher_invitations set status='accepted',accepted_by=u,accepted_at=clock_timestamp() where id=inv.id;
 perform private.write_platform_audit(u,'invitation.accept','invitation',inv.id,org,'{}'::jsonb);
 return jsonb_build_object('organizationId',org);
end $$;

-- ---------------------------------------------------------------------------------------
-- Read models for the administrator (provisioned portals only; existing tenants are not listed).
-- ---------------------------------------------------------------------------------------
create function private.platform_portal_overview(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; n integer; lim integer := least(greatest(coalesce(p_limit,50),1),100);
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 with latest as (
  select distinct on (i.organization_id) i.* from private.teacher_invitations i order by i.organization_id,i.created_at desc,i.id desc
 ), page as (
  select l.*,o.created_at as portal_created_at from latest l join public.organizations o on o.id=l.organization_id
  order by o.created_at desc,o.id desc limit lim + 1
 )
 select count(*),coalesce(jsonb_agg(jsonb_build_object(
   'organizationId',p.organization_id,'teacherEmail',p.email,'createdAt',p.portal_created_at,'expiresAt',p.expires_at,
   'acceptedAt',p.accepted_at,
   'invitationStatus',case when p.status='pending' and p.expires_at <= clock_timestamp() then 'expired' else p.status end,
   'course',(select jsonb_build_object('id',c.id,'title',c.title,'subject',s.label,'grade',st.label,'educationSystem',pr.label,'examinationBoard',pr.examination_board)
     from public.courses c left join public.academic_subjects s on s.id=c.subject_id
     left join public.course_stage_assignments a on a.course_id=c.id left join public.academic_stages st on st.id=a.stage_id
     left join public.academic_programs pr on pr.id=st.program_id
     where c.organization_id=p.organization_id order by c.created_at,c.id limit 1)
  ) order by p.portal_created_at desc,p.organization_id) filter (where p.rn <= lim),'[]'::jsonb)
 into n,rows
 from (select page.*,row_number() over (order by page.portal_created_at desc,page.organization_id) as rn from page) p;
 return jsonb_build_object('items',coalesce(rows,'[]'::jsonb),'hasMore',coalesce(n,0) > lim);
end $$;

create function private.platform_portal_detail(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 if not exists(select 1 from private.teacher_invitations where organization_id=p_organization_id) then
  raise exception 'Portal not found' using errcode='PT404'; end if;
 select jsonb_build_object(
  'organizationId',o.id,'status',o.status,'createdAt',o.created_at,
  'hasOwner',exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.role='owner' and m.status='active'),
  'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'teacherEmail',i.email,'createdAt',i.created_at,'expiresAt',i.expires_at,
     'acceptedAt',i.accepted_at,'revokedAt',i.revoked_at,'revokeReason',i.revoke_reason,
     'status',case when i.status='pending' and i.expires_at <= clock_timestamp() then 'expired' else i.status end) order by i.created_at desc,i.id desc)
     from private.teacher_invitations i where i.organization_id=o.id),'[]'::jsonb),
  'educationSystems',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.label,'examinationBoard',p.examination_board,
     'gradeLevels',coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'name',st.label) order by st.position,st.id)
       from public.academic_stages st where st.program_id=p.id),'[]'::jsonb)) order by p.position,p.id)
     from public.academic_programs p where p.organization_id=o.id),'[]'::jsonb),
  'subjects',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.label) order by s.position,s.id)
     from public.academic_subjects s where s.organization_id=o.id),'[]'::jsonb),
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'subject',s.label,
     'gradeLevel',st.label,'educationSystem',pr.label) order by c.created_at,c.id)
     from public.courses c left join public.academic_subjects s on s.id=c.subject_id
     left join public.course_stage_assignments a on a.course_id=c.id left join public.academic_stages st on st.id=a.stage_id
     left join public.academic_programs pr on pr.id=st.program_id where c.organization_id=o.id),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('action',x.action,'occurredAt',x.occurred_at,
     'actor',case when exists(select 1 from private.platform_admins a2 where a2.user_id=x.actor_id) then 'administrator' else 'teacher' end)
     order by x.id desc) from (select * from private.platform_audit au where au.organization_id=o.id order by au.id desc limit 50) x),'[]'::jsonb)
 ) into result from public.organizations o where o.id=p_organization_id;
 return result;
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants and public invoker wrappers.
-- ---------------------------------------------------------------------------------------
revoke all on function private.platform_provision_teacher(jsonb,text),private.platform_reissue_teacher_invitation(uuid,text,integer,text),
 private.platform_revoke_teacher_invitation(uuid),private.accept_teacher_invitation(text),
 private.platform_portal_overview(integer),private.platform_portal_detail(uuid) from public,anon;
grant execute on function private.platform_provision_teacher(jsonb,text),private.platform_reissue_teacher_invitation(uuid,text,integer,text),
 private.platform_revoke_teacher_invitation(uuid),private.accept_teacher_invitation(text),
 private.platform_portal_overview(integer),private.platform_portal_detail(uuid) to authenticated;

create function public.platform_provision_teacher(p_request jsonb,p_token_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_provision_teacher(p_request,p_token_hash) $$;
create function public.platform_reissue_teacher_invitation(p_organization_id uuid,p_token_hash text,p_expires_in_days integer,p_email text default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_reissue_teacher_invitation(p_organization_id,p_token_hash,p_expires_in_days,p_email) $$;
create function public.platform_revoke_teacher_invitation(p_organization_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_revoke_teacher_invitation(p_organization_id) $$;
create function public.accept_teacher_invitation(p_token_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select private.accept_teacher_invitation(p_token_hash) $$;
create function public.platform_portal_overview(p_limit integer default 50) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.platform_portal_overview(p_limit) $$;
create function public.platform_portal_detail(p_organization_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.platform_portal_detail(p_organization_id) $$;
revoke all on function public.platform_provision_teacher(jsonb,text),public.platform_reissue_teacher_invitation(uuid,text,integer,text),
 public.platform_revoke_teacher_invitation(uuid),public.accept_teacher_invitation(text),
 public.platform_portal_overview(integer),public.platform_portal_detail(uuid) from public,anon;
grant execute on function public.platform_provision_teacher(jsonb,text),public.platform_reissue_teacher_invitation(uuid,text,integer,text),
 public.platform_revoke_teacher_invitation(uuid),public.accept_teacher_invitation(text),
 public.platform_portal_overview(integer),public.platform_portal_detail(uuid) to authenticated;

comment on table private.teacher_invitations is 'Email-bound, single-use, expiring, revocable owner invitations. Only the SHA-256 of the secret is stored. Not exposed to API roles.';
comment on table private.platform_audit is 'Append-only record of administrative provisioning actions.';
comment on column public.academic_programs.examination_board is 'V1 optional free-text examination board. A future dedicated board entity may replace it.';
commit;
