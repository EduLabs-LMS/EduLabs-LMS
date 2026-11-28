-- Fix track 2b ("my scope" for Groups, homework, exams and enrollments; 20261128120000_my_scope_groups_work.sql). Proves the new reads
-- are the OLD reads, for every caller:
--  1. structure: the new sets and helpers are stable security definer with an empty search_path, executable by authenticated only; the
--     five policies use the sets; the list sections of group_view, homework_portal and exam_portal call no per-row helper;
--  2. the old functions, side by side under *_before names: the four small helpers verbatim (as before the migration), the four reads
--     rebuilt from their live definitions by undoing the migration's edits, each checked against the md5 of its old definition;
--  3. for every caller (2a's role matrix, plus a student in two Groups of one course, a transferred student, a student whose Group starts
--     tomorrow, a run instructor): each new set equals its old helper on every row; the single-object helpers answer what they answered
--     (every Group, run, course, homework and capability); the five policies return exactly the rows the old expressions accept;
--  4. the full JSON of group_view (every section, every Group), get_homework (every homework, every try), homework_portal and exam_portal
--     (every tab, every course and none), homework_students and exam_student_list, old vs new, each in its own rolled-back subtransaction,
--     with the rows they write (settles, linked exam windows, sessions) compared too;
--  5. the caller is not cached; the plan evaluates each set once (hashed SubPlan).
-- Synthetic fixtures only. Every change rolls back. Disposable local PostgreSQL only.
begin;
create temp table ms_results(name text primary key);
grant select,insert on ms_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.ms_results values(label) on conflict do nothing; end$$;

-- ===== 1. Structure =====
select pg_temp.ok((select count(*)=9 and bool_and(p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'])
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('caller_managed_offerings','caller_enrolled_offerings',
 'caller_viewable_offerings','caller_editable_courses','caller_managed_groups','caller_visible_groups','caller_visible_homework','caller_offering_rights','caller_course_edit')),
 'the nine new functions are stable security definer with an empty search_path');
select pg_temp.ok((select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
 from unnest(array['private.caller_managed_offerings()','private.caller_enrolled_offerings()','private.caller_viewable_offerings()','private.caller_editable_courses()',
 'private.caller_managed_groups()','private.caller_visible_groups()','private.caller_visible_homework()','private.caller_offering_rights(uuid)','private.caller_course_edit(uuid)']) f),
 'only authenticated may execute them');
select pg_temp.ok((select count(*)=5 from pg_policies where schemaname='public' and cmd='SELECT' and roles='{authenticated}' and (tablename,policyname,qual) in (
 ('enrollments','enrollments_select','((user_id = ( SELECT private.current_app_user_id() AS current_app_user_id)) OR (offering_id IN ( SELECT private.my_supported_offerings() AS my_supported_offerings)))'),
 ('enrollment_requests','enrollment_requests_read','((user_id = ( SELECT private.current_app_user_id() AS current_app_user_id)) OR (offering_id IN ( SELECT private.my_supported_offerings() AS my_supported_offerings)))'),
 ('course_offerings','course_offerings_select','(id IN ( SELECT private.caller_viewable_offerings() AS caller_viewable_offerings))'),
 ('offering_staff','offering_staff_select','(offering_id IN ( SELECT private.my_supported_offerings() AS my_supported_offerings))'),
 ('homework_assignments','homework_read','(id IN ( SELECT private.caller_visible_homework() AS caller_visible_homework))'))),'the five read policies use the once-per-statement sets');
select pg_temp.ok((select count(*)=3 from pg_policies where schemaname='public' and policyname='trusted_identity' and tablename in ('enrollments','course_offerings','offering_staff')),
 'the restrictive trusted_identity policies stay');
select pg_temp.ok((select pg_get_functiondef('private.group_view(uuid,text,integer,text)'::regprocedure) !~ 'and private\.can_view_group\(listed\.id\)|private\.can_manage_group\((g2|listed)\.id\)|private\.can_manage_offering\((o|listed\.offering)'
 and pg_get_functiondef('private.homework_portal(uuid,text,integer)'::regprocedure) !~ 'can_edit_course|can_support_offering'
 and pg_get_functiondef('private.exam_portal(uuid,text,integer)'::regprocedure) !~ 'can_edit_course|can_support_offering'),
 'group_view''s lists, homework_portal and exam_portal call no helper per Group, course or run');
select pg_temp.ok((select bool_and(pg_get_functiondef(f::regprocedure) !~ 'can_manage_offering|can_support_offering|has_org_role|is_org_member|is_enrolled') from unnest(array[
 'private.can_manage_group(uuid)','private.can_view_group(uuid)','private.homework_staff(uuid,text)','private.homework_enrolled(uuid)']) f),
 'the four single-object helpers no longer nest the per-call helpers');
select pg_temp.ok((select provolatile='v' from pg_proc where oid='private.homework_enrolled(uuid)'::regprocedure) and (select bool_and(provolatile='s') from pg_proc where oid in
 ('private.can_manage_group(uuid)'::regprocedure,'private.can_view_group(uuid)'::regprocedure,'private.homework_staff(uuid,text)'::regprocedure)),'the helpers keep their volatility');

-- ===== 2. The old functions, side by side =====
-- The four small helpers as they were before the migration (verbatim, renamed; the old can_view_group called the old can_manage_group).
CREATE OR REPLACE FUNCTION private.can_manage_group_before(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.study_groups g where g.id=p_group and
 (private.can_manage_offering(g.offering_id) or (private.can_support_offering(g.offering_id) and exists(
 select 1 from public.group_staff s where s.group_id=g.id and s.user_id=(select private.current_app_user_id())))))
$function$;
CREATE OR REPLACE FUNCTION private.can_view_group_before(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.can_manage_group_before(p_group) or exists(select 1 from public.study_groups g join public.group_memberships m on m.group_id=g.id
 where g.id=p_group and g.status='active' and m.user_id=(select private.current_app_user_id()) and m.starts_at<=clock_timestamp() and m.ends_at is null and private.is_enrolled(g.offering_id)
 and exists(select 1 from public.enrollments e where e.id=m.enrollment_id and e.status='active' and (e.expires_at is null or e.expires_at>clock_timestamp()) and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp())))
$function$;
CREATE OR REPLACE FUNCTION private.homework_staff_before(p_assignment uuid, p_capability text DEFAULT 'view'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.homework_assignments a where a.id=p_assignment and case p_capability
 when 'author' then private.can_edit_course(a.course_id)
 when 'grade' then private.can_support_offering(a.offering_id)
 when 'manage' then private.can_manage_offering(a.offering_id)
 when 'correct' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_correct from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 when 'release' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_release from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 else private.can_edit_course(a.course_id) or private.can_support_offering(a.offering_id) end)
$function$;
CREATE OR REPLACE FUNCTION private.homework_enrolled_before(p_assignment uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.homework_assignments a join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=a.course_id
 join public.lessons l on l.id=a.lesson_id left join public.lesson_segments s on s.id=a.segment_id
 where a.id=p_assignment and a.status='published' and o.status='active' and c.status='published' and l.status='published'
 and (a.segment_id is null or s.status='published') and private.is_enrolled(a.offering_id)
 and exists(select 1 from public.enrollments e where e.offering_id=a.offering_id and e.user_id=(select private.current_app_user_id()) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or clock_timestamp()<e.expires_at)))
$function$;
-- homework_visible is unchanged, but it calls the two rewritten helpers: its old meaning, with the old helpers.
create function private.homework_visible_before(p_assignment uuid) returns boolean language sql stable security definer set search_path='' as
 $$select private.homework_staff_before(p_assignment) or private.homework_enrolled_before(p_assignment)$$;
-- The four reads, rebuilt by undoing the migration's edits on their live definitions; each must be byte for byte its old definition.
create temp table ms_edits(f text, n int, new_text text, old_text text);
insert into ms_edits values
 ($e$private.group_view(uuid,text,integer,text)$e$,0,$e$where (p_group is null or g2.id=p_group)
    and c2.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active')
    and g2.id in (select private.caller_managed_groups()));$e$,$e$where (p_group is null or g2.id=p_group)
    and c2.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active')
    and private.can_manage_group(g2.id));$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,1,$e$with vis as materialized (select listed.id from public.study_groups listed where listed.offering_id=session_uuid and listed.id in (select private.caller_visible_groups()))$e$,$e$with vis as materialized (select listed.id from public.study_groups listed where listed.offering_id=session_uuid and private.can_view_group(listed.id))$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,2,$e$into result from (select listed.*,listed.id in (select private.caller_managed_groups()) as staff,true as instructor,o.name as offering_name$e$,$e$into result from (select listed.*,private.can_manage_group(listed.id) as staff,true as instructor,o.name as offering_name$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,3,$e$union select gm.group_id from public.group_memberships gm where gm.user_id=u and gm.ends_at is null) and listed.id in (select private.caller_visible_groups()));$e$,$e$union select gm.group_id from public.group_memberships gm where gm.user_id=u and gm.ends_at is null) and private.can_view_group(listed.id));$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,4,$e$where m.user_id=u and m.status='active') and o.id in (select private.caller_managed_offerings()))$e$,$e$where m.user_id=u and m.status='active') and private.can_manage_offering(o.id))$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,5,$e$vis as materialized (select listed.id from public.study_groups listed where listed.id in (select id from cand) and listed.id in (select private.caller_visible_groups()))$e$,$e$vis as materialized (select listed.id from public.study_groups listed where listed.id in (select id from cand) and private.can_view_group(listed.id))$e$),
 ($e$private.group_view(uuid,text,integer,text)$e$,6,$e$from (select listed.*,listed.id in (select private.caller_managed_groups()) as staff,listed.offering_id in (select private.caller_managed_offerings()) as instructor,o.name as offering_name$e$,$e$from (select listed.*,private.can_manage_group(listed.id) as staff,private.can_manage_offering(listed.offering_id) as instructor,o.name as offering_name$e$),
 ($e$private.homework_portal(uuid,text,integer)$e$,0,$e$eds:=array(select x from unnest(courses_) x where x in (select private.caller_editable_courses()));$e$,$e$eds:=array(select x from unnest(courses_) x where private.can_edit_course(x));$e$),
 ($e$private.homework_portal(uuid,text,integer)$e$,1,$e$sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and o.id in (select private.my_supported_offerings()));$e$,$e$sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));$e$),
 ($e$private.exam_portal(uuid,text,integer)$e$,0,$e$eds:=array(select y from unnest(courses_) y where y in (select private.caller_editable_courses()));$e$,$e$eds:=array(select y from unnest(courses_) y where private.can_edit_course(y));$e$),
 ($e$private.exam_portal(uuid,text,integer)$e$,1,$e$sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and o.id in (select private.my_supported_offerings()));$e$,$e$sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));$e$),
 ($e$private.exam_student_list()$e$,0,$e$-- Settle only the exams where exam_settle has something to do (its own three conditions, in the list's order); for every other exam it is a no-op.
 for x in select e.id from unnest(ids) with ordinality t(id,n) join private.exams e on e.id=t.id where e.kind='online' and e.status<>'draft' and (
   exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at<=clock_timestamp() and a.user_id=u)
   or (e.auto_release and exists(select 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null) and private.exam_closed(e.id))
   or (e.timing='per_group' and e.status='published' and exists(select 1 from private.exam_windows(e.id) w where not w.stored and w.session_id is not null)))
  order by t.n loop perform private.exam_settle(x,u);end loop;$e$,$e$foreach x in array ids loop perform private.exam_settle(x,u);end loop;$e$);
create temp table ms_old_md5(f text primary key, m text);
insert into ms_old_md5 values
 ('private.can_manage_group(uuid)','f220338c7f44010f7be6b61b16692bb5'),
 ('private.can_view_group(uuid)','7cf473e7399a702942f48b84b41e9d33'),
 ('private.homework_staff(uuid,text)','d35604ef7517a274748aedf9833a06f1'),
 ('private.homework_enrolled(uuid)','510fff583607289796e299d57b30803b'),
 ('private.group_view(uuid,text,integer,text)','0169985ad0d65a99ea39437c440ba0d8'),
 ('private.homework_portal(uuid,text,integer)','15a01edfe3141b834163019d8f62346e'),
 ('private.exam_portal(uuid,text,integer)','92bd61093c2e5f0a376db40935bdc0ad'),
 ('private.exam_student_list()','253a76ce0881ef22d47c526f3dcecda9');
do $$ declare r record; e record; t text; begin
 for r in select distinct f from pg_temp.ms_edits loop
  t:=pg_get_functiondef(r.f::regprocedure);
  for e in select * from pg_temp.ms_edits where f=r.f order by n desc loop
   if (length(t)-length(replace(t,e.new_text,'')))/length(e.new_text)<>1 then raise exception 'FAILED edit % of % not found once',e.n,r.f; end if;
   t:=replace(t,e.new_text,e.old_text);
  end loop;
  if md5(t)<>(select m from pg_temp.ms_old_md5 where f=r.f) then raise exception 'FAILED % is not its old definition after undoing the edits',r.f; end if;
  t:=regexp_replace(t,'FUNCTION (private\.[a-z_]+)\(','FUNCTION \1_before(');
  t:=replace(replace(replace(replace(t,'private.can_view_group(','private.can_view_group_before('),'private.can_manage_group(','private.can_manage_group_before('),
   'private.homework_enrolled(','private.homework_enrolled_before('),'private.homework_staff(','private.homework_staff_before(');
  t:=replace(t,'private.homework_visible(','private.homework_visible_before(');
  execute t;
 end loop;
end $$;
select pg_temp.ok((select count(*)=4 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in
 ('group_view_before','homework_portal_before','exam_portal_before','exam_student_list_before')),'the four old reads are rebuilt, each equal to its old definition (md5)');
select pg_temp.ok((select md5(pg_get_functiondef(oid)) from pg_proc where oid='private.homework_staff(uuid,text)'::regprocedure)<>(select m from pg_temp.ms_old_md5 where f='private.homework_staff(uuid,text)'),
 'the live homework_staff is the new one');
-- The old get_homework is unchanged; its old meaning calls the old helpers.
do $$ begin execute replace(replace(replace(replace(regexp_replace(pg_get_functiondef('private.get_homework(uuid,uuid)'::regprocedure),'FUNCTION private\.get_homework\(','FUNCTION private.get_homework_before('),
 'private.homework_visible(','private.homework_visible_before('),'private.homework_staff(','private.homework_staff_before('),'private.homework_unlocked(','private.homework_unlocked_before('),
 'private.homework_submission_json(','private.homework_submission_json_before(');
 execute replace(replace(regexp_replace(pg_get_functiondef('private.homework_unlocked(uuid)'::regprocedure),'FUNCTION private\.homework_unlocked\(','FUNCTION private.homework_unlocked_before('),
 'private.homework_staff(','private.homework_staff_before('),'private.homework_enrolled(','private.homework_enrolled_before(');
 execute replace(replace(regexp_replace(pg_get_functiondef('private.homework_submission_json(uuid)'::regprocedure),'FUNCTION private\.homework_submission_json\(','FUNCTION private.homework_submission_json_before('),
 'private.homework_submission_visible(','private.homework_submission_visible_before('),'private.homework_staff(','private.homework_staff_before(');
 execute replace(replace(regexp_replace(pg_get_functiondef('private.homework_submission_visible(uuid)'::regprocedure),'FUNCTION private\.homework_submission_visible\(','FUNCTION private.homework_submission_visible_before('),
 'private.homework_staff(','private.homework_staff_before('),'private.homework_enrolled(','private.homework_enrolled_before(');
 execute replace(regexp_replace(pg_get_functiondef('private.homework_students(uuid,integer)'::regprocedure),'FUNCTION private\.homework_students\(','FUNCTION private.homework_students_before('),
 'private.homework_staff(','private.homework_staff_before(');
end $$;
select pg_temp.ok((select count(*)=5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in
 ('get_homework_before','homework_unlocked_before','homework_submission_json_before','homework_submission_visible_before','homework_students_before')),
 'get_homework and homework_students (unchanged) run with the old helpers in the comparison copies');

-- 2a's fixture section (supabase/tests/my-scope.sql), copied as is:
-- fixture-begin (scripts/my-scope-proof.cjs runs this section too)
create function pg_temp.u(label text) returns uuid language sql immutable as $$select md5('my-scope:person:'||label)::uuid$$;
create function pg_temp.k(label text) returns uuid language sql immutable as $$select md5('my-scope:key:'||label)::uuid$$;
create function pg_temp.person(label text,profile_status text default 'active') returns void language sql as $$
 insert into public.profiles(id,display_name,status) values(pg_temp.u(label),'My scope '||label,profile_status);
 insert into private.external_identities(profile_id,provider,issuer,subject,verified_at) values(pg_temp.u(label),'firebase','https://securetoken.google.com/diagonproduction','my-scope-'||label,now());$$;
-- The token a Firebase user of the fixture presents ('none' = no token at all, 'unmapped' = a valid token nobody owns).
create function pg_temp.claims(label text) returns text language sql stable as $$
 select case when label='none' then '' when label like 'seed%' then jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated',
  'sub','10000000-0000-0000-0000-00000000000'||substr(label,5,1))::text
 else jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'sub','my-scope-'||label,'auth_time',floor(extract(epoch from now()))::bigint)::text end$$;
create function pg_temp.as_(label text) returns void language sql as $$select set_config('request.jwt.claims',pg_temp.claims(label),true)$$;

do $$ declare l text; begin
 foreach l in array array['owner','admin','teacher','asst_run','asst_norun','cs_owner','cs_instructor','cs_editor','cs_assistant','ta_nomember',
  'st_active','st_suspended','st_cancelled','st_expired','st_future','st_invited','st_completed','st_archived_run','st_draft_course','st_other','st_two',
  'nospace','padmin','mem_suspended','mem_invited','s2_teacher','s2_student','staff_student','revoked'] loop perform pg_temp.person(l); end loop;
 perform pg_temp.person('prof_suspended','suspended');
end $$;
update private.external_identities set tokens_valid_after=now()+interval '1 day' where profile_id=pg_temp.u('revoked');
insert into private.platform_admins(user_id,note) values(pg_temp.u('padmin'),'my-scope synthetic admin');

insert into public.organizations(id,name,slug,status) values(pg_temp.k('R'),'My scope space','my-scope-r','active'),(pg_temp.k('R2'),'My scope suspended space','my-scope-r2','active');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.k('R'),pg_temp.u(l),r,s,now() from (values('owner','owner','active'),('admin','admin','active'),('teacher','teacher','active'),('asst_run','assistant','active'),
  ('asst_norun','assistant','active'),('cs_owner','teacher','active'),('cs_instructor','teacher','active'),('cs_editor','assistant','active'),('cs_assistant','assistant','active'),
  ('prof_suspended','teacher','active'),('mem_suspended','teacher','active'),('mem_invited','teacher','active'),('staff_student','assistant','active'),('revoked','owner','active'),
  ('ta_nomember','teacher','active')) v(l,r,s);
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.k('R2'),pg_temp.u('s2_teacher'),'owner','active',now());

insert into public.courses(id,organization_id,title,slug,status) values
 (pg_temp.k('C1'),pg_temp.k('R'),'Published course','ms-c1','published'),(pg_temp.k('C2'),pg_temp.k('R'),'Draft course','ms-c2','draft'),
 (pg_temp.k('C3'),pg_temp.k('R'),'Archived course','ms-c3','published'),(pg_temp.k('S1'),pg_temp.k('R2'),'Course of the suspended space','ms-s1','published');
insert into public.course_offerings(id,course_id,name,status) values
 (pg_temp.k('C1a'),pg_temp.k('C1'),'Active run','active'),(pg_temp.k('C1b'),pg_temp.k('C1'),'Archived run','archived'),(pg_temp.k('C1c'),pg_temp.k('C1'),'Draft run','draft'),
 (pg_temp.k('C2a'),pg_temp.k('C2'),'Run of the draft course','active'),(pg_temp.k('C3a'),pg_temp.k('C3'),'Run of the archived course','active'),
 (pg_temp.k('S1a'),pg_temp.k('S1'),'Run in the suspended space','active');
insert into public.course_staff(course_id,user_id,role) select pg_temp.k(c),pg_temp.u(l),r from (values('C1','cs_owner','owner'),('C1','cs_instructor','instructor'),
 ('C1','cs_editor','editor'),('C1','cs_assistant','assistant'),('C1','prof_suspended','owner'),('C1','mem_suspended','editor'),('C1','mem_invited','instructor'),
 ('C1','staff_student','editor'),('C2','cs_editor','editor'),('S1','s2_teacher','owner'),('C1','ta_nomember','instructor')) v(c,l,r);
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.k('C1a'),pg_temp.u('asst_run'),'teaching_assistant'),(pg_temp.k('C1a'),pg_temp.u('ta_nomember'),'instructor'),
 (pg_temp.k('C3a'),pg_temp.u('asst_run'),'teaching_assistant');
-- Staff rows need an active membership when they are made; these memberships change afterwards, as they do in real life.
update public.organization_memberships set status='suspended' where user_id=pg_temp.u('mem_suspended');
update public.organization_memberships set status='invited' where user_id=pg_temp.u('mem_invited');
delete from public.organization_memberships where user_id=pg_temp.u('ta_nomember');
insert into public.enrollments(offering_id,user_id,status,enrolled_at,expires_at,completed_at) values
 (pg_temp.k('C1a'),pg_temp.u('st_active'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_suspended'),'suspended',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_cancelled'),'cancelled',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_expired'),'active',now()-interval '30 days',now()-interval '1 day',null),
 (pg_temp.k('C1a'),pg_temp.u('st_future'),'active',now()+interval '2 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_invited'),'invited',null,null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_completed'),'completed',now()-interval '30 days',null,now()-interval '1 day'),
 (pg_temp.k('C1b'),pg_temp.u('st_archived_run'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C2a'),pg_temp.u('st_draft_course'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C3a'),pg_temp.u('st_draft_course'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('S1a'),pg_temp.u('s2_student'),'active',now()-interval '30 days',null,null),
 ('60000000-0000-0000-0000-000000000003',pg_temp.u('st_other'),'active',now()-interval '30 days',null,null),
 ('60000000-0000-0000-0000-000000000003',pg_temp.u('st_two'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('st_two'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('staff_student'),'active',now()-interval '30 days',null,null),
 (pg_temp.k('C1a'),pg_temp.u('prof_suspended'),'active',now()-interval '30 days',null,null);

-- Content: two chapters per course; a published and a draft lesson; a published part, a draft part, and a published part of the draft
-- lesson; two content items per lesson; one attachment per part.
do $$ declare c text; m int; l int; p int; lesson uuid; part uuid; asset uuid; begin
 foreach c in array array['C1','C2','C3','S1'] loop
  for m in 0..1 loop
   insert into public.course_modules(id,course_id,title,position) values(pg_temp.k(c||'-m'||m),pg_temp.k(c),'Chapter '||m,m);
   for l in 0..1 loop
    lesson:=pg_temp.k(c||'-m'||m||'-l'||l);
    insert into public.lessons(id,module_id,title,position,status) values(lesson,pg_temp.k(c||'-m'||m),'Lesson '||m||'.'||l,l,case when l=0 then 'published' else 'draft' end);
    insert into public.lesson_blocks(lesson_id,block_type,position,content) values(lesson,'text',0,jsonb_build_object('text','First item')),(lesson,'text',1,jsonb_build_object('text','Second item'));
    for p in 0..1 loop
     part:=pg_temp.k(c||'-m'||m||'-l'||l||'-p'||p);
     insert into public.lesson_segments(id,lesson_id,title,position,status,video_url) values(part,lesson,'Part '||p,p,case when p=0 then 'published' else 'draft' end,'https://example.test/v.mp4');
     asset:=pg_temp.k(c||'-asset-'||m||l||p);
     insert into public.media_assets(id,organization_id,uploaded_by,kind,mime_type,original_filename,storage_provider,bucket,object_path,size_bytes,status,upload_expires_at)
      select asset,organization_id,pg_temp.u('owner'),'pdf','application/pdf','notes.pdf','supabase','lms-course-media',organization_id||'/'||asset||'/resource.pdf',10,'ready',now()+interval '1 hour'
      from public.courses where id=pg_temp.k(c);
     insert into public.lesson_resources(id,segment_id,name,media_asset_id) values(pg_temp.k(c||'-res-'||m||l||p),part,'Notes',asset);
    end loop;
   end loop;
  end loop;
 end loop;
end $$;
update public.courses set status='archived' where id=pg_temp.k('C3'); -- archived after its content was made
update public.organizations set status='suspended' where id=pg_temp.k('R2');
-- fixture-end (2a)
-- fixture-2b-begin (scripts/my-scope-2b-proof.cjs runs this section too, after 2a's fixture section of my-scope.sql)
-- More people: a student in two Groups of one course, a student transferred from G1 to G2, a student whose Group membership starts
-- tomorrow, a run instructor who is a member of the space.
do $$ declare l text; begin
 foreach l in array array['st_both','st_moved','st_grpfuture','run_instr'] loop perform pg_temp.person(l); end loop;
end $$;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.k('R'),pg_temp.u('run_instr'),'teacher','active',now());
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.k('C1a'),pg_temp.u('run_instr'),'instructor');
-- A second active run of C1, so a student can be in two Groups of one course (one active Group per run is the rule).
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.k('C1d'),pg_temp.k('C1'),'Second active run','active');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values
 (pg_temp.k('C1d'),pg_temp.u('st_both'),'active',now()-interval '30 days'),(pg_temp.k('C1a'),pg_temp.u('st_both'),'active',now()-interval '30 days'),(pg_temp.k('C1a'),pg_temp.u('st_moved'),'active',now()-interval '30 days'),
 (pg_temp.k('C1a'),pg_temp.u('st_grpfuture'),'active',now()-interval '30 days');

-- Groups: two active Groups and an archived one in the active run, one in each other kind of run (archived run, archived course,
-- draft course, suspended space, another space).
insert into public.study_groups(id,offering_id,name,mode,status,created_by) values
 (pg_temp.k('G1'),pg_temp.k('C1a'),'Group one','online','active',pg_temp.u('owner')),(pg_temp.k('G2'),pg_temp.k('C1a'),'Group two','online','active',pg_temp.u('owner')),
 (pg_temp.k('G3'),pg_temp.k('C1a'),'Archived group','online','active',pg_temp.u('owner')),(pg_temp.k('G4'),pg_temp.k('C1b'),'Group of the archived run','online','active',pg_temp.u('owner')),
 (pg_temp.k('G5'),pg_temp.k('C3a'),'Group of the archived course','online','active',pg_temp.u('owner')),(pg_temp.k('G6'),pg_temp.k('S1a'),'Group of the suspended space','online','active',pg_temp.u('s2_teacher')),
 (pg_temp.k('G9'),pg_temp.k('C1d'),'Group of the second run','online','active',pg_temp.u('owner')),
 (pg_temp.k('G7'),'60000000-0000-0000-0000-000000000003','Group of another space','online','active','10000000-0000-0000-0000-000000000001'),
 (pg_temp.k('G8'),pg_temp.k('C2a'),'Group of the draft course','online','active',pg_temp.u('owner'));
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
 select pg_temp.k(g),e.offering_id,e.user_id,e.id,s,x,pg_temp.u('owner') from (values
  ('G1','st_active',now()-interval '20 days',null),('G1','st_two',now()-interval '20 days',null),('G1','staff_student',now()-interval '20 days',null),
  ('G1','st_expired',now()-interval '20 days',null),('G1','st_future',now()-interval '20 days',null),('G1','st_suspended',now()-interval '20 days',null),
  ('G1','prof_suspended',now()-interval '20 days',null),('G1','st_both',now()-interval '20 days',null),('G1','st_cancelled',now()-interval '20 days',null),
  ('G1','st_moved',now()-interval '20 days',now()-interval '1 day'),('G2','st_moved',now()-interval '1 day',null),('G9','st_both',now()-interval '20 days',null),
  ('G2','st_grpfuture',now()+interval '1 day',null),('G2','st_completed',now()-interval '20 days',null),('G3','st_active',now()-interval '40 days',now()-interval '21 days'),
  ('G4','st_archived_run',now()-interval '20 days',null),('G5','st_draft_course',now()-interval '20 days',null),('G8','st_draft_course',now()-interval '20 days',null),
  ('G6','s2_student',now()-interval '20 days',null),('G7','st_other',now()-interval '20 days',null),('G7','st_two',now()-interval '20 days',null)) v(g,l,s,x)
 join public.study_groups sg on sg.id=pg_temp.k(v.g) join public.enrollments e on e.offering_id=sg.offering_id and e.user_id=pg_temp.u(v.l);
insert into public.group_staff(group_id,user_id) values(pg_temp.k('G1'),pg_temp.u('asst_run')),(pg_temp.k('G1'),pg_temp.u('asst_norun')),
 (pg_temp.k('G2'),pg_temp.u('cs_assistant')),(pg_temp.k('G3'),pg_temp.u('asst_run')),(pg_temp.k('G6'),pg_temp.u('s2_teacher')),(pg_temp.k('G5'),pg_temp.u('asst_run'));
-- Sessions: upcoming ones (one tomorrow per active Group, one in an hour in G1), a past finalized one with marks, a cancelled one.
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by,cancelled,attendance_state)
 select pg_temp.k(g||'-s'||n),pg_temp.k(g),'Session '||n,now()+d,now()+d+interval '1 hour',now()+d,now()+d+interval '1 hour','online',pg_temp.u('owner'),pg_temp.u('owner'),c,a
 from (values('G1',1,interval '1 day',false,'draft'),('G1',2,interval '1 hour',false,'draft'),('G1',3,interval '-3 days',false,'finalized'),('G1',4,interval '2 days',true,'draft'),
  ('G2',1,interval '1 day',false,'draft'),('G3',1,interval '1 day',false,'draft'),('G4',1,interval '1 day',false,'draft'),('G5',1,interval '1 day',false,'draft'),
  ('G6',1,interval '1 day',false,'draft'),('G7',1,interval '1 day',false,'draft'),('G8',1,interval '1 day',false,'draft'),('G9',1,interval '1 day',false,'draft')) v(g,n,d,c,a);
update public.study_groups set status='archived' where id=pg_temp.k('G3');
insert into public.session_attendance(session_id,user_id,membership_id,status) select pg_temp.k('G1-s3'),m.user_id,m.id,s from (values('st_active','attended'),('st_two','absent'),('st_both','attended')) v(l,s)
 join public.group_memberships m on m.group_id=pg_temp.k('G1') and m.user_id=pg_temp.u(v.l);

-- Join requests in every state.
insert into public.enrollment_requests(offering_id,user_id,status,reviewed_by,reviewed_at) values
 (pg_temp.k('C1a'),pg_temp.u('st_invited'),'pending',null,null),(pg_temp.k('C1a'),pg_temp.u('nospace'),'pending',null,null),
 (pg_temp.k('C1b'),pg_temp.u('st_active'),'rejected',pg_temp.u('owner'),now()-interval '2 days'),(pg_temp.k('S1a'),pg_temp.u('st_other'),'pending',null,null),
 ('60000000-0000-0000-0000-000000000003',pg_temp.u('st_active'),'pending',null,null);

-- Homework: published, on a draft part, on a draft lesson, a draft, closed, in the archived run, the archived course, the suspended
-- space, and a family with a newer version. Tries: handed in, late, a draft.
-- The demo makers record their rows for a demo space: R is one while they run, and not afterwards.
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.k('R'),pg_temp.u('padmin'));
create temp table hw2b(label text primary key, ids uuid[]);
grant select on hw2b to authenticated;
do $$ declare r record; ids uuid[]; begin
 for r in select * from (values
  ('H1','C1','C1a','C1-m0-l0',null,'published',interval '7 days'),('H2','C1','C1a','C1-m0-l0','C1-m0-l0-p1','published',interval '7 days'),
  ('H3','C1','C1a','C1-m0-l1',null,'published',interval '7 days'),('H4','C1','C1a','C1-m0-l0',null,'draft',interval '7 days'),
  ('H5','C1','C1a','C1-m1-l0',null,'published',interval '-1 day'),('H6','C1','C1b','C1-m0-l0',null,'published',interval '7 days'),
  ('H7','C3','C3a','C3-m0-l0',null,'published',interval '7 days'),('H8','S1','S1a','S1-m0-l0',null,'published',interval '7 days'),
  ('H9','C1','C1a','C1-m1-l0','C1-m1-l0-p0','published',interval '7 days')) v(label,c,o,l,s,st,d) loop
  ids:=private.demo_homework_make(pg_temp.k('R'),pg_temp.u('owner'),pg_temp.k(r.c),pg_temp.k(r.o),pg_temp.k(r.l),'Homework '||r.label,r.st,now()+r.d,true,'fix_mistakes',2,'after_hand_in');
  -- A homework's part is set when it is made: these two are remade on their part, with the same questions.
  if r.s is not null then
   insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,segment_id,title,instructions,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed,revision,created_by)
    select pg_temp.k(r.label),pg_temp.k(r.label),course_id,offering_id,lesson_id,pg_temp.k(r.s),title,instructions,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed,revision,created_by
    from public.homework_assignments where id=ids[1];
   update public.homework_questions set assignment_id=pg_temp.k(r.label) where assignment_id=ids[1];
   update private.homework_solutions set assignment_id=pg_temp.k(r.label) where assignment_id=ids[1];
   delete from private.demo_seed_rows where row_id=ids[1]; delete from public.homework_assignments where id=ids[1];
   ids[1]:=pg_temp.k(r.label);
  end if;
  insert into pg_temp.hw2b values(r.label,ids);
 end loop;
end $$;
insert into public.homework_assignments(id,family_id,supersedes_id,version,course_id,offering_id,lesson_id,segment_id,title,instructions,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed,revision,created_by)
 select pg_temp.k('H9v2'),a.family_id,a.id,2,a.course_id,a.offering_id,a.lesson_id,a.segment_id,'Homework H9 v2',a.instructions,a.mode,'published',a.uses_marks,a.workflow,a.deadline_at,a.late_allowed,a.tries_mode,a.max_tries,a.solutions_open,a.photos_allowed,1,a.created_by
 from public.homework_assignments a where a.id=(select ids[1] from hw2b where label='H9');
insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values(pg_temp.k('H9v2-q'),pg_temp.k('H9v2'),0,'essay','Explain.',4,'both');
select private.demo_homework_try(pg_temp.k('R'),pg_temp.u('owner'),(select ids from hw2b where label='H1'),pg_temp.u('st_active'),1,now()-interval '1 hour',false,'submitted',1,false);
select private.demo_homework_try(pg_temp.k('R'),pg_temp.u('owner'),(select ids from hw2b where label='H5'),pg_temp.u('st_both'),1,now()-interval '1 hour',true,'submitted',2,false);
select private.demo_homework_try(pg_temp.k('R'),pg_temp.u('owner'),(select ids from hw2b where label='H9'),pg_temp.u('st_two'),1,now()-interval '1 hour',false,'submitted',3,false);
select private.demo_homework_try(pg_temp.k('R'),pg_temp.u('owner'),(select ids from hw2b where label='H1'),pg_temp.u('st_both'),1,now()-interval '1 hour',false,'draft',4,false);

-- Exams: per-Group online open now (G1 a custom window, G2 the next session), same-time closed with auto release and a corrected
-- unreleased result, paper, draft, per-Group from today with no stored windows yet (the read links them), in the archived run and the
-- suspended space. A try left open past its deadline.
create temp table ex2b(label text primary key, ids uuid[]);
grant select on ex2b to authenticated;
do $$ declare r record; ids uuid[]; begin
 for r in select * from (values('E1','C1','C1a'),('E2','C1','C1a'),('E4','C1','C1a'),('E5','C1','C1a'),('E6','C1','C1b'),('E7','S1','S1a'),('E8','C3','C3a')) v(label,c,o) loop
  ids:=private.demo_exam_make(pg_temp.k('R'),pg_temp.u('owner'),pg_temp.k(r.c),pg_temp.k(r.o),'Exam '||r.label,30,'one_time',current_date,now()-interval '1 day');
  insert into pg_temp.ex2b values(r.label,ids);
 end loop;
end $$;
insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by)
 select (select ids[1] from ex2b where label='E1'),pg_temp.k('G1'),'custom',now()-interval '1 hour',now()+interval '2 hours',pg_temp.u('owner');
insert into private.exam_group_windows(exam_id,group_id,source,session_id,updated_by)
 select (select ids[1] from ex2b where label='E1'),pg_temp.k('G2'),'auto',pg_temp.k('G2-s1'),pg_temp.u('owner');
update private.exams set timing='same_time',starting_from=null,opens_at=now()-interval '3 days',closes_at=now()-interval '2 days',auto_release=true where id=(select ids[1] from ex2b where label='E2');
insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,created_by,revision)
 values(pg_temp.k('E3'),pg_temp.k('E3'),pg_temp.k('C1'),pg_temp.k('C1a'),'paper','Exam E3 (paper)','published',now()-interval '1 day',20,current_date-1,pg_temp.u('owner'),1);
insert into pg_temp.ex2b values('E3',array[pg_temp.k('E3')]);
update private.exams set status='draft',published_at=null where id=(select ids[1] from ex2b where label='E4');
update private.exams set status='archived' where id=(select ids[1] from ex2b where label='E6');
select private.demo_exam_try(pg_temp.k('R'),(select ids from ex2b where label='E1'),pg_temp.u('st_both'),pg_temp.k('G1'),1,now()-interval '50 minutes',30,false,1);
select private.demo_exam_try(pg_temp.k('R'),(select ids from ex2b where label='E1'),pg_temp.u('st_active'),pg_temp.k('G1'),1,now()-interval '10 minutes',30,true,2);
select private.demo_exam_try(pg_temp.k('R'),(select ids from ex2b where label='E2'),pg_temp.u('st_active'),null,1,now()-interval '3 days',30,true,3);
select private.demo_exam_try(pg_temp.k('R'),(select ids from ex2b where label='E2'),pg_temp.u('st_two'),null,1,now()-interval '3 days',30,true,4);
update private.exam_results set status='corrected',score=5 where exam_id=(select ids[1] from ex2b where label='E2');
delete from private.demo_seed_rows where organization_id=pg_temp.k('R');
delete from private.demo_spaces where organization_id=pg_temp.k('R');
-- fixture-2b-end


-- ===== 3. Every caller: sets, helpers and policies =====
create temp table ms_callers(label text primary key);
insert into ms_callers select unnest(array['owner','admin','teacher','asst_run','asst_norun','cs_owner','cs_instructor','cs_editor','cs_assistant','ta_nomember',
 'st_active','st_suspended','st_cancelled','st_expired','st_future','st_invited','st_completed','st_archived_run','st_draft_course','st_other','st_two',
 'nospace','padmin','prof_suspended','mem_suspended','mem_invited','s2_teacher','s2_student','staff_student','revoked','unmapped','none',
 'seed1','seed2','seed3','seed4','seed5','seed6','seed7','st_both','st_moved','st_grpfuture','run_instr']);
create temp table ms_diff(kind text, caller text, item text, old text, new text);
grant select,insert on ms_diff,ms_callers to authenticated;
create temp table ms_count(kind text primary key, n int default 0);
grant select,insert,update on ms_count to authenticated;
create function pg_temp.cmp(kind text, caller text, item text, o text, n text) returns void language sql as $$
 insert into pg_temp.ms_count values(kind,1) on conflict(kind) do update set n=pg_temp.ms_count.n+1;
 insert into pg_temp.ms_diff select kind,caller,item,o,n where o is distinct from n$$;

do $$ declare c text; begin
 for c in select label from pg_temp.ms_callers loop
  perform pg_temp.as_(c);
  -- each set against its helper on every row of its table
  perform pg_temp.cmp('set caller_managed_offerings',c,'', (select string_agg(id::text,',' order by id) from public.course_offerings where private.can_manage_offering(id)),
   (select string_agg(x::text,',' order by x) from private.caller_managed_offerings() x));
  perform pg_temp.cmp('set caller_enrolled_offerings',c,'', (select string_agg(id::text,',' order by id) from public.course_offerings where private.is_enrolled(id)),
   (select string_agg(x::text,',' order by x) from (select distinct x from private.caller_enrolled_offerings() x) y));
  perform pg_temp.cmp('set caller_viewable_offerings',c,'', (select string_agg(id::text,',' order by id) from public.course_offerings where private.can_support_offering(id) or private.is_enrolled(id)),
   (select string_agg(x::text,',' order by x) from private.caller_viewable_offerings() x));
  perform pg_temp.cmp('set my_supported_offerings',c,'', (select string_agg(id::text,',' order by id) from public.course_offerings where private.can_support_offering(id)),
   (select string_agg(x::text,',' order by x) from private.my_supported_offerings() x));
  perform pg_temp.cmp('set caller_editable_courses',c,'', (select string_agg(id::text,',' order by id) from public.courses where private.can_edit_course(id)),
   (select string_agg(x::text,',' order by x) from private.caller_editable_courses() x));
  perform pg_temp.cmp('set caller_managed_groups',c,'', (select string_agg(id::text,',' order by id) from public.study_groups where private.can_manage_group_before(id)),
   (select string_agg(x::text,',' order by x) from private.caller_managed_groups() x));
  perform pg_temp.cmp('set caller_visible_groups',c,'', (select string_agg(id::text,',' order by id) from public.study_groups where private.can_view_group_before(id)),
   (select string_agg(x::text,',' order by x) from private.caller_visible_groups() x));
  perform pg_temp.cmp('set caller_visible_homework',c,'', (select string_agg(id::text,',' order by id) from public.homework_assignments where private.homework_visible_before(id)),
   (select string_agg(x::text,',' order by x) from private.caller_visible_homework() x));
  -- the single-object helpers
  perform pg_temp.cmp('helper caller_offering_rights',c,'', (select string_agg(id||':'||private.can_manage_offering(id)||private.can_support_offering(id),',' order by id) from public.course_offerings),
   (select string_agg(id||':'||r.manage||r.support,',' order by id) from public.course_offerings o cross join lateral private.caller_offering_rights(o.id) r));
  perform pg_temp.cmp('helper caller_course_edit',c,'', (select string_agg(id||':'||private.can_edit_course(id),',' order by id) from public.courses),
   (select string_agg(id||':'||private.caller_course_edit(id),',' order by id) from public.courses));
  perform pg_temp.cmp('helper can_manage_group',c,'', (select string_agg(id||':'||private.can_manage_group_before(id),',' order by id) from public.study_groups),
   (select string_agg(id||':'||private.can_manage_group(id),',' order by id) from public.study_groups));
  perform pg_temp.cmp('helper can_view_group',c,'', (select string_agg(id||':'||private.can_view_group_before(id),',' order by id) from public.study_groups),
   (select string_agg(id||':'||private.can_view_group(id),',' order by id) from public.study_groups));
  perform pg_temp.cmp('helper homework_enrolled',c,'', (select string_agg(id||':'||private.homework_enrolled_before(id),',' order by id) from public.homework_assignments),
   (select string_agg(id||':'||private.homework_enrolled(id),',' order by id) from public.homework_assignments));
  perform pg_temp.cmp('helper homework_staff',c,'', (select string_agg(a.id||':'||cap||':'||private.homework_staff_before(a.id,cap),',' order by a.id,cap) from public.homework_assignments a,
    unnest(array['view','author','grade','manage','correct','release','other']) cap),
   (select string_agg(a.id||':'||cap||':'||private.homework_staff(a.id,cap),',' order by a.id,cap) from public.homework_assignments a,
    unnest(array['view','author','grade','manage','correct','release','other']) cap));
  -- unknown ids answer false, as before
  perform pg_temp.cmp('helper unknown ids',c,'', (select private.can_view_group_before(gen_random_uuid())::text||private.can_manage_group_before(gen_random_uuid())||private.homework_staff_before(gen_random_uuid())||private.homework_enrolled_before(gen_random_uuid())),
   (select private.can_view_group(gen_random_uuid())::text||private.can_manage_group(gen_random_uuid())||private.homework_staff(gen_random_uuid())||private.homework_enrolled(gen_random_uuid())));
  perform pg_temp.cmp('helper unknown run or course',c,'', 'falsefalsefalse',
   (select (select manage::text||support from private.caller_offering_rights(gen_random_uuid()))||private.caller_course_edit(gen_random_uuid())));
 end loop;
end $$;

-- The five policies: the rows each returns as the caller equal the rows the OLD expression accepts (evaluated as the table owner, with the
-- old helpers, under the same token; the restrictive trusted_identity policy is ANDed on both sides).
create temp table ms_rls(caller text, tbl text, ids text);
grant select,insert on ms_rls to authenticated;
do $$ declare c text; begin
 for c in select label from pg_temp.ms_callers loop
  perform pg_temp.as_(c);
  insert into pg_temp.ms_rls values
   (c,'enrollments',(select string_agg(id::text,',' order by id) from public.enrollments where ((user_id=(select private.current_app_user_id()) and private.is_active_user()) or private.can_support_offering(offering_id)) and (select private.current_app_user_id()) is not null)),
   (c,'enrollment_requests',(select string_agg(id::text,',' order by id) from public.enrollment_requests where private.is_active_user() and (user_id=(select private.current_app_user_id()) or private.can_support_offering(offering_id)))),
   (c,'course_offerings',(select string_agg(id::text,',' order by id) from public.course_offerings where (private.can_support_offering(id) or private.is_enrolled(id)) and (select private.current_app_user_id()) is not null)),
   (c,'offering_staff',(select string_agg(offering_id||'/'||user_id,',' order by offering_id,user_id) from public.offering_staff where private.can_support_offering(offering_id) and (select private.current_app_user_id()) is not null)),
   (c,'homework_assignments',(select string_agg(id::text,',' order by id) from public.homework_assignments where private.homework_visible_before(id)));
 end loop;
end $$;
set role authenticated;
do $$ declare c text; begin
 for c in select label from pg_temp.ms_callers loop
  perform pg_temp.as_(c);
  perform pg_temp.cmp('policy '||t,c,'',(select ids from pg_temp.ms_rls where caller=c and tbl=t),n) from (values
   ('enrollments',(select string_agg(id::text,',' order by id) from public.enrollments)),
   ('enrollment_requests',(select string_agg(id::text,',' order by id) from public.enrollment_requests)),
   ('course_offerings',(select string_agg(id::text,',' order by id) from public.course_offerings)),
   ('offering_staff',(select string_agg(offering_id||'/'||user_id,',' order by offering_id,user_id) from public.offering_staff)),
   ('homework_assignments',(select string_agg(id::text,',' order by id) from public.homework_assignments))) v(t,n);
 end loop;
end $$;
reset role;
select pg_temp.ok((select count(*)=0 from pg_temp.ms_diff),'every set, helper and policy answers as before: '||(select coalesce(string_agg(kind||' '||caller,'; '),'') from (select * from pg_temp.ms_diff limit 5) d));
select pg_temp.ok((select sum(n)=43*21 from pg_temp.ms_count),'set, helper and policy comparisons: 43 callers x 21');
select pg_temp.ok((select count(*) filter(where ids is not null)>=80 from pg_temp.ms_rls),'most caller x table pairs see rows (the comparison is not empty)');

-- ===== 4. The reads, as JSON, old vs new =====
-- One call in its own subtransaction, always rolled back; returns the answer (or the SQLSTATE) with the clock fields removed, and a digest
-- of the rows the call wrote (exam settles, linked windows, sessions, notices).
create function pg_temp.strip(j jsonb, extra text[] default '{}') returns jsonb language sql immutable as $$
 select case jsonb_typeof(j) when 'object' then (select coalesce(jsonb_object_agg(k,pg_temp.strip(v,extra)),'{}'::jsonb) from jsonb_each(j) e(k,v) where k not in ('serverNow','secondsLeft') and k<>all(extra))
  when 'array' then (select coalesce(jsonb_agg(pg_temp.strip(v,extra) order by n),'[]'::jsonb) from jsonb_array_elements(j) with ordinality a(v,n)) else j end$$;
create function pg_temp.written() returns text language sql as $$
 select md5(concat_ws('|',
  (select string_agg(id||status||coalesce(auto_submitted::text,'')||(submitted_at is null),',' order by id) from private.exam_attempts),
  -- a result the call creates gets a random id: results are identified by exam and student
  (select string_agg(exam_id||':'||user_id||status||coalesce(score::text,'')||(released_at is null)||revision,',' order by exam_id,user_id) from private.exam_results),
  (select string_agg(exam_id||':'||group_id||source||coalesce(session_id::text,''),',' order by exam_id,group_id) from private.exam_group_windows),
  (select string_agg(action||n,',' order by action) from (select action,count(*) n from private.exam_audit group by action) a),
  (select count(*) from public.notifications),(select count(*) from private.notification_events),
  (select string_agg(id||':'||group_id||starts_at||cancelled,',' order by id) from public.group_sessions),
  (select count(*) from public.session_attendance),(select count(*) from private.group_audit)))$$;
-- extra: keys the call itself sets to the current time (the attendance roster snapshot's roster_at and each row's updated_at).
create function pg_temp.call(q text, extra text[] default '{}') returns text language plpgsql as $$
declare r jsonb; begin
 begin execute q into r; raise exception using errcode='MS002',message=coalesce(pg_temp.strip(r,extra)::text,'null')||' written '||pg_temp.written();
 exception when sqlstate 'MS002' then return sqlerrm; when others then return 'error '||sqlstate; end;
end$$;
create function pg_temp.pair(kind text, caller text, item text, old_q text, new_q text) returns void language sql as $$
 select pg_temp.cmp(kind,caller,item,pg_temp.call(old_q),pg_temp.call(new_q))$$;
create temp table ms_answers(kind text, answered boolean);
create function pg_temp.pair2(kind text, caller text, item text, old_q text, new_q text, extra text[] default '{}') returns void language plpgsql as $$
declare o text:=pg_temp.call(old_q,extra); n text:=pg_temp.call(new_q,extra); begin
 perform pg_temp.cmp(kind,caller,item,o,n); insert into pg_temp.ms_answers values(kind,o not like 'error %');
end$$;

-- Why the session section drops two keys: the old function, called twice, differs in exactly those (it snapshots the roster at call time).
select pg_temp.as_('owner');
select pg_temp.ok(pg_temp.call(format('select private.group_view_before(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''))
  <> pg_temp.call(format('select private.group_view_before(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''))
 and pg_temp.call(format('select private.group_view_before(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''),array['roster_at','updated_at'])
  = pg_temp.call(format('select private.group_view_before(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''),array['roster_at','updated_at']),
 'the old attendance-session read differs from itself only in roster_at and the rows'' updated_at (written at call time)');
do $$ declare c text; g uuid; s text; o uuid; h uuid; sub uuid; t text; crs uuid; begin
 for c in select label from pg_temp.ms_callers loop
  perform pg_temp.as_(c);
  foreach s in array array['summary','upcoming','list','offerings','history'] loop
   perform pg_temp.pair2('group_view '||s,c,'',format('select private.group_view_before(null,%L,0,%L)',s,''),format('select private.group_view(null,%L,0,%L)',s,''));
  end loop;
  perform pg_temp.pair2('group_view list search',c,'',$q$select private.group_view_before(null,'list',0,'two')$q$,$q$select private.group_view(null,'list',0,'two')$q$);
  for o in select id from public.course_offerings where id in (pg_temp.k('C1a'),pg_temp.k('C1b'),pg_temp.k('C1d'),pg_temp.k('S1a'),'60000000-0000-0000-0000-000000000003') loop
   perform pg_temp.pair2('group_view offering',c,o::text,format('select private.group_view_before(null,%L,0,%L)','offering:'||o,''),format('select private.group_view(null,%L,0,%L)','offering:'||o,''));
  end loop;
  for g in select id from public.study_groups order by id loop
   foreach s in array array['summary','detail','sessions','members','eligible','staff','audit','history'] loop
    perform pg_temp.pair2('group_view group '||s,c,g::text,format('select private.group_view_before(%L,%L,0,%L)',g,s,''),format('select private.group_view(%L,%L,0,%L)',g,s,''));
   end loop;
  end loop;
  perform pg_temp.pair2('group_view session',c,'',format('select private.group_view_before(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''),format('select private.group_view(%L,%L,0,%L)',pg_temp.k('G1'),pg_temp.k('G1-s3'),''),array['roster_at','updated_at']);
  for h in select id from public.homework_assignments order by id loop
   perform pg_temp.pair2('get_homework',c,h::text,format('select private.get_homework_before(%L,null)',h),format('select private.get_homework(%L,null)',h));
   perform pg_temp.pair2('homework_students',c,h::text,format('select private.homework_students_before(%L,0)',h),format('select private.homework_students(%L,0)',h));
   for sub in select id from public.homework_submissions where assignment_id=h loop
    perform pg_temp.pair2('get_homework try',c,sub::text,format('select private.get_homework_before(%L,%L)',h,sub),format('select private.get_homework(%L,%L)',h,sub));
   end loop;
  end loop;
  for crs in select null::uuid union all select id from public.courses where id in (pg_temp.k('C1'),pg_temp.k('C2'),pg_temp.k('C3'),pg_temp.k('S1')) loop
   foreach t in array array['open','closed','drafts'] loop
    perform pg_temp.pair2('homework_portal '||t,c,coalesce(crs::text,'all'),format('select private.homework_portal_before(%L,%L,0)',crs,t),format('select private.homework_portal(%L,%L,0)',crs,t));
   end loop;
   foreach t in array array['open','closed','drafts','archived'] loop
    perform pg_temp.pair2('exam_portal '||t,c,coalesce(crs::text,'all'),format('select private.exam_portal_before(%L,%L,0)',crs,t),format('select private.exam_portal(%L,%L,0)',crs,t));
   end loop;
  end loop;
  perform pg_temp.pair2('exam_student_list',c,'','select private.exam_student_list_before()','select private.exam_student_list()');
 end loop;
end $$;
select pg_temp.ok((select count(*)=0 from pg_temp.ms_diff),'every read answers as before, with the same rows written: '||(select coalesce(string_agg(kind||' '||caller||' '||item,'; '),'') from (select * from pg_temp.ms_diff limit 5) d));
select pg_temp.ok((select count(*)>=6000 from pg_temp.ms_answers),'reads compared: '||(select count(*) from pg_temp.ms_answers));
select pg_temp.ok((select bool_and(n>0) from (select kind,count(*) filter(where answered) n from pg_temp.ms_answers group by kind) x),
 'every kind of read answers for some callers (not only refusals)'||(select coalesce(': none for '||string_agg(kind,', '),'') from (select kind from pg_temp.ms_answers group by kind having count(*) filter(where answered)=0) x));
-- The old list settles every exam; the new one only those with something to do. As st_both (a try left open past its deadline) the
-- open exam is settled by both, and the rows written are the same (compared above). Here: how many settles each made.
select pg_temp.as_('st_both');
do $$ declare o int; n int; begin
 set local track_functions='all';
 o:=coalesce((select calls from pg_stat_xact_user_functions where funcname='exam_settle'),0);
 perform pg_temp.call('select private.exam_student_list_before()');
 n:=coalesce((select calls from pg_stat_xact_user_functions where funcname='exam_settle'),0);
 perform pg_temp.ok(n-o>=4,'the old list settled every listed exam ('||(n-o)||')');
 o:=n; perform pg_temp.call('select private.exam_student_list()');
 n:=coalesce((select calls from pg_stat_xact_user_functions where funcname='exam_settle'),0);
 perform pg_temp.ok(n-o between 1 and 3,'the new list settles only the exams with something to do ('||(n-o)||')');
end $$;

-- ===== 5. No cache, and the plan =====
-- A suspension inside the transaction takes effect at the next statement, for the sets and for the single-object helpers.
select pg_temp.as_('st_active');
select pg_temp.ok(private.can_view_group(pg_temp.k('G1')) and pg_temp.k('G1') in (select private.caller_visible_groups()) and pg_temp.k('C1a') in (select private.caller_enrolled_offerings()),'st_active sees G1');
update public.enrollments set status='suspended' where user_id=pg_temp.u('st_active') and offering_id=pg_temp.k('C1a');
select pg_temp.ok(not private.can_view_group(pg_temp.k('G1')) and pg_temp.k('G1') not in (select private.caller_visible_groups()),'after the suspension, the next statement no longer sees G1');
update public.enrollments set status='active' where user_id=pg_temp.u('st_active') and offering_id=pg_temp.k('C1a');
select pg_temp.as_('asst_run');
select pg_temp.ok(private.can_manage_group(pg_temp.k('G1')) and private.homework_staff((select ids[1] from pg_temp.hw2b where label='H1'),'grade'),'asst_run manages G1 and grades H1');
update public.organization_memberships set status='suspended' where user_id=pg_temp.u('asst_run');
select pg_temp.ok(not private.can_manage_group(pg_temp.k('G1')) and not private.homework_staff((select ids[1] from pg_temp.hw2b where label='H1'),'grade')
 and pg_temp.k('G1') not in (select private.caller_managed_groups()),'after the membership is suspended, the next statement refuses');
update public.organization_memberships set status='active' where user_id=pg_temp.u('asst_run');
update private.external_identities set tokens_valid_after=now()+interval '1 hour' where profile_id=pg_temp.u('asst_run');
select pg_temp.ok(not private.can_manage_group(pg_temp.k('G1')) and (select count(*) from private.my_supported_offerings())=0,'after the token is revoked, the next statement refuses');
-- Forged settings next to a student token change nothing.
select pg_temp.as_('st_two');
select set_config('request.jwt.claim.sub','my-scope-owner',true),set_config('lms.caller',pg_temp.u('owner')::text,true),set_config('app.current_user_id',pg_temp.u('owner')::text,true);
select pg_temp.ok(not private.can_manage_group(pg_temp.k('G1')) and (select count(*) from private.caller_managed_groups())=0 and (select count(*) from private.caller_editable_courses())=0,
 'forged caller settings next to a student token change nothing');
-- Two tokens in one transaction each get their own sets.
select pg_temp.as_('owner');
select pg_temp.ok((select count(*) from private.caller_managed_groups())>=6,'the owner, next, gets the owner''s Groups');
select pg_temp.as_('st_two');
select pg_temp.ok((select array_agg(x order by x) from private.caller_visible_groups() x)=(select array_agg(x order by x) from unnest(array[pg_temp.k('G1'),pg_temp.k('G7')]) x),'and the student, after, only theirs');

-- The plan: as a student, each policy evaluates its set once (hashed SubPlan), with no per-row helper.
set role authenticated;
create function pg_temp.plan(q text) returns text language plpgsql as $$declare l text; r text:=''; begin for l in execute 'explain (analyze, costs off, timing off, summary off) '||q loop r:=r||l||E'\n'; end loop; return r; end$$;
select pg_temp.ok((select bool_and(p ~ 'hashed SubPlan' and p !~ 'can_support_offering|is_enrolled|homework_visible') from (select pg_temp.plan(q) p from unnest(array[
 'select count(*) from public.enrollments','select count(*) from public.enrollment_requests','select count(*) from public.course_offerings',
 'select count(*) from public.offering_staff','select count(*) from public.homework_assignments']) q) x),'each of the five policies evaluates its set once per statement (hashed SubPlan, loops=1)');
reset role;

select count(*) as my_scope_2b_passed from pg_temp.ms_results;
select json_build_object('passed',(select count(*) from pg_temp.ms_results),
 'compared',(select json_object_agg(kind,n) from pg_temp.ms_count)) as my_scope_2b_tests;
rollback;
