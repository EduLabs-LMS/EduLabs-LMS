-- Teaching space name. Every provisioned space was stored as 'Pending teacher portal' and nothing ever renamed it, so a teacher with two spaces saw two
-- identical choices. This draft migration (not applied anywhere):
--   * private.platform_provision_teacher: the request now REQUIRES 'spaceName' (1 to 200 characters, trimmed, spaces collapsed, no control characters) and the
--     space is created with it. Same signature, grants and security; everything else in the function is copied unchanged.
--   * private.platform_rename_teaching_space(space, name): a platform administrator renames a provisioned space.
--   * private.rename_my_teaching_space(space, name): the space's active OWNER renames their own space. Admins, teachers and assistants cannot.
--   * private.platform_portal_overview / platform_portal_detail: the same results plus the space name.
--   * the audit table accepts the action 'portal.rename' (a rename is recorded with the old and the new name).
-- Identity comes only from private.current_app_user_id(); auth.uid() is never used (a Firebase subject is not a UUID).
begin;

alter table private.platform_audit drop constraint platform_audit_action_check;
alter table private.platform_audit add constraint platform_audit_action_check check (action in
 ('portal.provision','invitation.revoke','invitation.reissue','invitation.accept','demo.mark','demo.unmark','demo.fill','demo.clear','portal.rename'));

-- Provisioning: the ONLY changes from the earlier definition are the 'spaceName' key, its validation and the organization name.
create or replace function private.platform_provision_teacher(p_request jsonb,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid := private.current_app_user_id();
 v_email text; v_days integer := 7; v_hash bytea;
 org uuid; inv uuid; prog uuid; stg uuid; subj uuid; crs uuid; v_expires timestamptz;
 sys jsonb; grd jsonb; sbj jsonb; v_course jsonb; sys_i integer; grd_i integer; sub_i integer;
 v_label text; v_board text; v_slug text; v_title text; v_space text;
 taken_programs text[] := '{}'; taken_stages text[]; taken_subjects text[] := '{}';
 sys_labels text[] := '{}'; grd_labels text[]; sub_labels text[] := '{}';
 grade_keys text[] := '{}'; subject_keys text[] := '{}'; k text;
 grade_stage jsonb := '{}'; subject_ids jsonb := '{}'; n_grades integer := 0;
begin
 if u is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_request is null or jsonb_typeof(p_request) <> 'object' or octet_length(p_request::text) > 20000
  or exists(select 1 from jsonb_object_keys(p_request) x where x not in ('teacherEmail','expiresInDays','systems','subjects','course','spaceName')) then
  raise exception 'Invalid provisioning request' using errcode='22023'; end if;
 v_email := lower(private.clean_text(p_request->'teacherEmail',254,'Teacher email'));
 -- Required: the name the teacher and their students see. clean_text trims, collapses spaces and refuses control characters (1 to 200 characters).
 v_space := private.clean_text(p_request->'spaceName',200,'Teaching space name');
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

 insert into public.organizations(name,slug,status)
  values(v_space,'portal-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),'active') returning id into org;

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

-- Read models: the same JSON as before plus the space name.
create or replace function private.platform_portal_overview(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; n integer; lim integer := least(greatest(coalesce(p_limit,50),1),100);
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 with latest as (
  select distinct on (i.organization_id) i.* from private.teacher_invitations i order by i.organization_id,i.created_at desc,i.id desc
 ), page as (
  select l.*,o.created_at as portal_created_at,o.name as portal_name from latest l join public.organizations o on o.id=l.organization_id
  order by o.created_at desc,o.id desc limit lim + 1
 )
 select count(*),coalesce(jsonb_agg(jsonb_build_object(
   'organizationId',p.organization_id,'name',p.portal_name,'teacherEmail',p.email,'createdAt',p.portal_created_at,'expiresAt',p.expires_at,
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

create or replace function private.platform_portal_detail(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 if not exists(select 1 from private.teacher_invitations where organization_id=p_organization_id) then
  raise exception 'Portal not found' using errcode='PT404'; end if;
 select jsonb_build_object(
  'organizationId',o.id,'name',o.name,'status',o.status,'createdAt',o.created_at,
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

-- A platform administrator renames a provisioned space (one that has an invitation record, like the portal pages show).
create function private.platform_rename_teaching_space(p_organization_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); v_name text; v_old text;
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 v_name := private.clean_text(to_jsonb(p_name),200,'Teaching space name');
 if not exists(select 1 from private.teacher_invitations where organization_id=p_organization_id) then raise exception 'Portal not found' using errcode='PT404'; end if;
 select name into v_old from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'Portal not found' using errcode='PT404'; end if;
 if v_old is distinct from v_name then
  update public.organizations set name=v_name where id=p_organization_id;
  perform private.write_platform_audit(u,'portal.rename','organization',p_organization_id,p_organization_id,jsonb_build_object('from',v_old,'to',v_name));
 end if;
 return jsonb_build_object('organizationId',p_organization_id,'name',v_name);
end $$;

-- The owner of a space renames it. The caller is the profile behind the verified token; only an ACTIVE owner of an ACTIVE space qualifies.
create function private.rename_my_teaching_space(p_organization_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); v_name text; v_old text;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 v_name := private.clean_text(to_jsonb(p_name),200,'Teaching space name');
 select o.name into v_old from public.organizations o join public.organization_memberships m on m.organization_id=o.id
  where o.id=p_organization_id and o.status='active' and m.user_id=u and m.role='owner' and m.status='active' for update of o;
 if not found then raise exception 'Only the owner of a teaching space can rename it' using errcode='42501'; end if;
 if v_old is distinct from v_name then
  update public.organizations set name=v_name where id=p_organization_id;
  perform private.write_platform_audit(u,'portal.rename','organization',p_organization_id,p_organization_id,jsonb_build_object('from',v_old,'to',v_name));
 end if;
 return jsonb_build_object('organizationId',p_organization_id,'name',v_name);
end $$;

revoke all on function private.platform_rename_teaching_space(uuid,text),private.rename_my_teaching_space(uuid,text) from public,anon;
grant execute on function private.platform_rename_teaching_space(uuid,text),private.rename_my_teaching_space(uuid,text) to authenticated;
create function public.platform_rename_teaching_space(p_organization_id uuid,p_name text) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_rename_teaching_space(p_organization_id,p_name) $$;
create function public.rename_my_teaching_space(p_organization_id uuid,p_name text) returns jsonb
language sql security invoker set search_path='' as $$ select private.rename_my_teaching_space(p_organization_id,p_name) $$;
revoke all on function public.platform_rename_teaching_space(uuid,text),public.rename_my_teaching_space(uuid,text) from public,anon;
grant execute on function public.platform_rename_teaching_space(uuid,text),public.rename_my_teaching_space(uuid,text) to authenticated;

commit;
