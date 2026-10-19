-- Milestone 5A. Additive taxonomy/preferences only: never grants learning access.
-- No backfill, enrollment mutation, or replacement of existing authorization.
begin;

create table public.academic_programs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 slug text not null check (length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 label text not null check (length(btrim(label)) between 1 and 160 and label !~ '[[:cntrl:]]'),
 description text check (length(description) <= 4000),
 position integer not null default 0 check (position between 0 and 1000000),
 status text not null default 'active' check (status in ('active','archived')),
 revision bigint not null default 0 check (revision >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id,slug), unique (organization_id,id)
);
create index academic_programs_order_idx on public.academic_programs(organization_id,status,position,id);

create table public.academic_stages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 program_id uuid not null,
 slug text not null check (length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 label text not null check (length(btrim(label)) between 1 and 160 and label !~ '[[:cntrl:]]'),
 description text check (length(description) <= 4000),
 position integer not null default 0 check (position between 0 and 1000000),
 status text not null default 'active' check (status in ('active','archived')),
 revision bigint not null default 0 check (revision >= 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (organization_id,program_id) references public.academic_programs(organization_id,id) on delete restrict,
 unique (program_id,slug), unique (organization_id,id), unique (organization_id,program_id,id)
);
create index academic_stages_order_idx on public.academic_stages(organization_id,program_id,status,position,id);

-- The redundant tenant keys exist solely to enforce both sides in PostgreSQL.
-- Adds an index/constraint, never rewrites a course or changes its identity.
alter table public.courses add constraint courses_academic_tenant_key unique (organization_id,id);
create table public.course_stage_assignments (
 course_id uuid not null, stage_id uuid not null, organization_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(course_id,stage_id),
 foreign key(organization_id,course_id) references public.courses(organization_id,id) on delete restrict,
 foreign key(organization_id,stage_id) references public.academic_stages(organization_id,id) on delete restrict
);
create index course_stage_assignments_course_tenant_idx on public.course_stage_assignments(organization_id,course_id);
create index course_stage_assignments_stage_tenant_idx on public.course_stage_assignments(organization_id,stage_id,course_id);

-- Version tombstones live separately from courses; metadata/publish versions stay unchanged.
create table private.course_stage_versions (
 course_id uuid primary key references public.courses(id) on delete restrict,
 revision bigint not null default 0 check(revision >= 0)
);
alter table private.course_stage_versions enable row level security;
revoke all on private.course_stage_versions from public,anon,authenticated;

create table public.student_stage_preferences (
 user_id uuid not null references public.profiles(id) on delete restrict,
 program_id uuid not null, organization_id uuid not null, stage_id uuid,
 revision bigint not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(user_id,program_id),
 foreign key(organization_id,program_id) references public.academic_programs(organization_id,id) on delete restrict,
 foreign key(organization_id,program_id,stage_id) references public.academic_stages(organization_id,program_id,id) on delete restrict
);
-- This prefix also covers the program FK; no duplicate program-only index.
create index student_stage_preferences_stage_idx on public.student_stage_preferences(organization_id,program_id,stage_id);

create trigger touch_updated_at before update on public.academic_programs for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.academic_stages for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.student_stage_preferences for each row execute function private.touch_updated_at();

-- Non-recursive definer helpers inspect base rows, never consult a taxonomy RLS policy.
create function private.can_view_academic_organization(p_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and (
  private.is_org_member(p_organization_id) or exists (
   select 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id
   join public.courses c on c.id=o.course_id
   where e.user_id=(select private.current_app_user_id()) and c.organization_id=p_organization_id
   and private.is_enrolled(o.id)
  )
 )
$$;
create function private.can_view_academic_stage(p_stage_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.academic_stages s join public.academic_programs p
 on (p.organization_id,p.id)=(s.organization_id,s.program_id)
 where s.id=p_stage_id and private.can_view_academic_organization(s.organization_id)
 and (private.is_org_member(s.organization_id) or (s.status='active' and p.status='active')))
$$;
revoke all on function private.can_view_academic_organization(uuid),private.can_view_academic_stage(uuid) from public,anon;
grant execute on function private.can_view_academic_organization(uuid),private.can_view_academic_stage(uuid) to authenticated;

alter table public.academic_programs enable row level security;
alter table public.academic_stages enable row level security;
alter table public.course_stage_assignments enable row level security;
alter table public.student_stage_preferences enable row level security;
revoke all on public.academic_programs,public.academic_stages,public.course_stage_assignments,public.student_stage_preferences from public,anon,authenticated;
grant select on public.academic_programs,public.academic_stages,public.course_stage_assignments,public.student_stage_preferences to authenticated;
create policy academic_programs_select on public.academic_programs for select to authenticated
 using (private.can_view_academic_organization(organization_id) and (status='active' or private.is_org_member(organization_id)));
create policy academic_stages_select on public.academic_stages for select to authenticated using (private.can_view_academic_stage(id));
create policy course_stage_assignments_select on public.course_stage_assignments for select to authenticated
 using (private.can_view_course(course_id) and private.can_view_academic_stage(stage_id));
create policy student_stage_preferences_select on public.student_stage_preferences for select to authenticated
 using (user_id=(select private.current_app_user_id()) and private.can_view_academic_organization(organization_id));

-- All writes serialize on the tenant row. The low-frequency taxonomy operation
-- shares the same lock order with preference/classification writes. Permissions
-- are checked AFTER every potentially blocking lock (not from JWT role hints).
create function private.academic_command(p_action text,p_organization_id uuid,p_entity_id uuid default null,p_revision bigint default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=private.current_app_user_id(); pr public.academic_programs; st public.academic_stages;
 c public.courses; program uuid; ids uuid[]; current_ids uuid[]; r bigint;
 v_label text; v_slug text; v_description text; v_position integer; v_status text;
begin
 if u is null then raise exception 'Academic access denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('program.create','program.edit','stage.create','stage.edit','course.assign')
 or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then
  raise exception 'Invalid academic command' using errcode='22023'; end if;
 -- Reject outsiders before they can queue on another tenant's mutation lock.
 -- This early gate never replaces the checks after acquiring authorization locks.
 if p_action='course.assign' then
  if not exists(select 1 from public.courses where id=p_entity_id and organization_id=p_organization_id and private.can_edit_course(id)) then
   raise exception 'Academic access denied' using errcode='42501'; end if;
 elsif not private.has_org_role(p_organization_id,array['owner','admin']) then
  raise exception 'Academic access denied' using errcode='42501'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 perform 1 from public.profiles where id=u for share;
 -- The existing last-owner trigger locks membership then organization. Never
 -- wait here while holding its inverse order: abort safely and let caller retry.
 perform 1 from public.organization_memberships where organization_id=p_organization_id and user_id=u for share nowait;
 if private.current_app_user_id() is distinct from u or not private.is_active_user() then
  raise exception 'Academic access denied' using errcode='42501'; end if;
 if p_action='course.assign' then
  select * into c from public.courses where id=p_entity_id and organization_id=p_organization_id for update;
  perform 1 from public.course_staff where course_id=p_entity_id and user_id=u for share nowait;
  if c.id is null or not private.can_edit_course(c.id) then raise exception 'Academic access denied' using errcode='42501'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k<>'stageIds') or jsonb_typeof(p_data->'stageIds') is distinct from 'array'
  then raise exception 'Expected stageIds array' using errcode='22023'; end if;
  if jsonb_array_length(p_data->'stageIds')>50 or exists(select 1 from jsonb_array_elements(p_data->'stageIds') x where jsonb_typeof(x)<>'string') then
   raise exception 'Invalid stage list' using errcode='22023'; end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_data->'stageIds');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate stages' using errcode='22023'; end if;
  if exists(select 1 from unnest(ids) x left join public.academic_stages s on s.id=x left join public.academic_programs p on p.id=s.program_id
    where s.id is null or s.organization_id<>p_organization_id or s.status<>'active' or p.status<>'active') then
   raise exception 'Stage unavailable' using errcode='42501'; end if;
  select revision into r from private.course_stage_versions where course_id=c.id;
  r:=coalesce(r,0);
  if p_revision is distinct from r then raise exception 'Classification changed; reload' using errcode='PT409'; end if;
  select coalesce(array_agg(stage_id order by stage_id),'{}'::uuid[]) into current_ids from public.course_stage_assignments where course_id=c.id;
  if current_ids is distinct from ids then
   delete from public.course_stage_assignments where course_id=c.id and not(stage_id=any(ids));
   insert into public.course_stage_assignments(course_id,stage_id,organization_id)
    select c.id,x,p_organization_id from unnest(ids) x on conflict(course_id,stage_id) do nothing;
   r:=r+1;
   insert into private.course_stage_versions(course_id,revision) values(c.id,r) on conflict(course_id) do update set revision=excluded.revision;
  end if;
  return jsonb_build_object('courseId',c.id,'revision',r,'stageIds',to_jsonb(ids));
 end if;
 if not private.has_org_role(p_organization_id,array['owner','admin']) then raise exception 'Academic access denied' using errcode='42501'; end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('label','slug','description','position','status','programId'))
 or (p_action<>'stage.create' and p_data?'programId') then raise exception 'Unsupported academic field' using errcode='22023'; end if;
 if p_action in ('program.create','stage.create') then
  if p_entity_id is not null or p_revision is not null then raise exception 'Create cannot select identity/version' using errcode='22023'; end if;
 else
  if p_action='program.edit' then
   select * into pr from public.academic_programs where id=p_entity_id and organization_id=p_organization_id for update;
   if pr.id is null then raise exception 'Academic access denied' using errcode='42501'; end if;
   r:=pr.revision;
  else
   select * into st from public.academic_stages where id=p_entity_id and organization_id=p_organization_id for update;
   if st.id is null then raise exception 'Academic access denied' using errcode='42501'; end if;
   select * into pr from public.academic_programs where id=st.program_id;
   r:=st.revision;
  end if;
  if p_revision is distinct from r then raise exception 'Academic record changed; reload' using errcode='PT409'; end if;
 end if;
 if p_action='stage.create' then
  if jsonb_typeof(p_data->'programId') is distinct from 'string' then raise exception 'Program required' using errcode='22023'; end if;
  program:=(p_data->>'programId')::uuid;
  select * into pr from public.academic_programs where id=program and organization_id=p_organization_id;
  if pr.id is null or pr.status<>'active' then raise exception 'Program unavailable' using errcode='42501'; end if;
 elsif p_action='stage.edit' then
  program:=st.program_id;
 end if;
 if (p_data?'label' and jsonb_typeof(p_data->'label')<>'string') or (p_data?'slug' and jsonb_typeof(p_data->'slug')<>'string')
 or (p_data?'status' and jsonb_typeof(p_data->'status')<>'string')
 or (p_data?'description' and jsonb_typeof(p_data->'description') not in ('string','null'))
 or (p_data?'position' and (jsonb_typeof(p_data->'position')<>'number' or p_data->>'position' !~ '^[0-9]{1,7}$')) then
  raise exception 'Invalid academic field types' using errcode='22023'; end if;
 v_label:=case when p_data?'label' then btrim(p_data->>'label') when p_action='program.edit' then pr.label when p_action='stage.edit' then st.label end;
 v_slug:=case when p_data?'slug' then p_data->>'slug' when p_action='program.edit' then pr.slug when p_action='stage.edit' then st.slug end;
 v_description:=case when p_data?'description' then p_data->>'description' when p_action='program.edit' then pr.description when p_action='stage.edit' then st.description end;
 v_position:=case when p_data?'position' then (p_data->>'position')::integer when p_action='program.edit' then pr.position when p_action='stage.edit' then st.position else 0 end;
 v_status:=case when p_data?'status' then p_data->>'status' when p_action='program.edit' then pr.status when p_action='stage.edit' then st.status else 'active' end;
 if v_label is null or v_slug is null or length(v_label) not between 1 and 160 or v_label ~ '[[:cntrl:]]'
 or length(v_slug) not between 1 and 100 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_description)>4000
 or v_position not between 0 and 1000000 or v_status not in ('active','archived') then
  raise exception 'Invalid academic metadata' using errcode='22023'; end if;
 if p_action='stage.edit' and v_status='active' and pr.status<>'active' then raise exception 'Program unavailable' using errcode='42501'; end if;
 if p_action='program.create' then
  insert into public.academic_programs(organization_id,slug,label,description,position,status)
   values(p_organization_id,v_slug,v_label,v_description,v_position,v_status) returning * into pr;
 elsif p_action='program.edit' then
  update public.academic_programs set label=v_label,slug=v_slug,description=v_description,position=v_position,status=v_status,revision=revision+1
   where id=pr.id returning * into pr;
 elsif p_action='stage.create' then
  insert into public.academic_stages(organization_id,program_id,slug,label,description,position,status)
   values(p_organization_id,program,v_slug,v_label,v_description,v_position,v_status) returning * into st;
 else
  update public.academic_stages set label=v_label,slug=v_slug,description=v_description,position=v_position,status=v_status,revision=revision+1
   where id=st.id returning * into st;
 end if;
 if p_action like 'program.%' then return to_jsonb(pr); else return to_jsonb(st); end if;
end $$;

create function private.set_student_stage_preference(p_program_id uuid,p_stage_id uuid,p_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.current_app_user_id(); org uuid; p public.academic_programs; pref public.student_stage_preferences;
begin
 if u is null then raise exception 'Academic access denied' using errcode='42501'; end if;
 select organization_id into org from public.academic_programs where id=p_program_id;
 if org is null or not private.can_view_academic_organization(org) then raise exception 'Academic access denied' using errcode='42501'; end if;
 perform 1 from public.organizations where id=org for update;
 perform 1 from public.profiles where id=u for share;
 perform 1 from public.organization_memberships where organization_id=org and user_id=u for share nowait;
 -- Retain eligible enrollment/status rows until commit, so suspension cannot
 -- race a preference grant. Offering ends_at deliberately remains unchanged.
 perform 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id
  where c.organization_id=org and e.user_id=u for share of e,o,c nowait;
 if private.current_app_user_id() is distinct from u or not private.can_view_academic_organization(org) then
  raise exception 'Academic access denied' using errcode='42501'; end if;
 select * into p from public.academic_programs where id=p_program_id and organization_id=org;
 -- Clear remains possible when a selection/program is archived, while authorized.
 if p.id is null or (p_stage_id is not null and (p.status<>'active' or not exists(select 1 from public.academic_stages s
  where s.id=p_stage_id and s.program_id=p.id and s.organization_id=org and s.status='active'))) then
  raise exception 'Stage unavailable' using errcode='42501'; end if;
 select * into pref from public.student_stage_preferences where user_id=u and program_id=p.id for update;
 if p_revision is distinct from coalesce(pref.revision,0) then raise exception 'Preference changed; reload' using errcode='PT409'; end if;
 if pref.user_id is not null and pref.stage_id is not distinct from p_stage_id then return to_jsonb(pref); end if;
 insert into public.student_stage_preferences(user_id,program_id,organization_id,stage_id,revision)
  values(u,p.id,org,p_stage_id,1) on conflict(user_id,program_id) do update set stage_id=excluded.stage_id,revision=student_stage_preferences.revision+1
  returning * into pref;
 return to_jsonb(pref);
end $$;

create function private.course_stage_classification(p_course_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_edit_course(p_course_id) then raise exception 'Academic access denied' using errcode='42501'; end if;
 return jsonb_build_object('courseId',p_course_id,'revision',coalesce((select revision from private.course_stage_versions where course_id=p_course_id),0),
  'stageIds',coalesce((select jsonb_agg(stage_id order by stage_id) from public.course_stage_assignments where course_id=p_course_id),'[]'::jsonb));
end $$;

revoke all on function private.academic_command(text,uuid,uuid,bigint,jsonb),private.set_student_stage_preference(uuid,uuid,bigint),private.course_stage_classification(uuid) from public,anon;
grant execute on function private.academic_command(text,uuid,uuid,bigint,jsonb),private.set_student_stage_preference(uuid,uuid,bigint),private.course_stage_classification(uuid) to authenticated;
create function public.academic_command(p_action text,p_organization_id uuid,p_entity_id uuid default null,p_revision bigint default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.academic_command(p_action,p_organization_id,p_entity_id,p_revision,p_data) $$;
create function public.set_student_stage_preference(p_program_id uuid,p_stage_id uuid,p_revision bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$ select private.set_student_stage_preference(p_program_id,p_stage_id,p_revision) $$;
create function public.course_stage_classification(p_course_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.course_stage_classification(p_course_id) $$;
revoke all on function public.academic_command(text,uuid,uuid,bigint,jsonb),public.set_student_stage_preference(uuid,uuid,bigint),public.course_stage_classification(uuid) from public,anon;
grant execute on function public.academic_command(text,uuid,uuid,bigint,jsonb),public.set_student_stage_preference(uuid,uuid,bigint),public.course_stage_classification(uuid) to authenticated;

comment on table public.student_stage_preferences is 'Per identity and program discovery preference only. Never authorizes enrollment, private content or staff access. Null stage is a versioned cleared preference.';
comment on table public.course_stage_assignments is 'Same-organization classification. Unassigned courses remain unassigned; archived stages retain historical associations. No academic IDs are duplicated.';
comment on table private.course_stage_versions is 'Deny-by-default RPC-only optimistic version, retained even when all classification links are cleared.';
commit;
