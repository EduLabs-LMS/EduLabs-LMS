-- Fix track 2a ("my scope", 20261127140000_my_scope_content.sql): the eight read policies now check each row against a set the caller
-- may see, computed once per statement, instead of a per-row helper. This suite proves the new rule is the OLD rule, row for row:
--  1. structure: the my_* functions are security definer, search_path '', stable, executable by authenticated only; the eight policies
--     use them; save_segment_progress no longer calls can_view_segment;
--  2. for 31 callers (every space role, every course-staff role, students in every enrollment state, a student of another space, a
--     suspended profile, a suspended or invited membership, a suspended space, a revoked token, a signed-in person with no space, an
--     unmapped token, no token, anonymous) every row each of the eight tables returns equals the rows the old policy expression accepts,
--     and each my_* set equals the old helper applied to every row of its table;
--  3. save_segment_progress gives the same answer as the old function (kept here as save_segment_progress_before) for every caller,
--     part and run combination;
--  4. the caller is not cached: a suspension or token revocation inside the transaction takes effect at the next statement, another
--     token in the same transaction gets its own rows, and no setting a client could set changes who the caller is;
--  5. the plan: a student's block read evaluates the set once (hashed SubPlan), no per-row helper.
-- Synthetic fixtures only (Firebase-shaped identities). Every change rolls back. Disposable local PostgreSQL only.
begin;
create temp table ms_results(name text primary key);
grant select,insert on ms_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.ms_results values(label) on conflict do nothing; end$$;

-- ===== 1. Structure =====
select pg_temp.ok((select count(*)=10 and bool_and(p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'])
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('my_space_roles','my_course_access','my_viewable_courses',
 'my_staff_courses','my_visible_lessons','my_visible_segments','my_viewable_organizations','my_supported_offerings','my_visible_profiles','my_scope')),
 'the ten private my_* functions are stable security definer with an empty search_path');
select pg_temp.ok((select not prosecdef from pg_proc where oid='public.my_scope()'::regprocedure),'public.my_scope is an invoker wrapper');
select pg_temp.ok((select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
 from unnest(array['private.my_space_roles()','private.my_course_access()','private.my_viewable_courses()','private.my_staff_courses()','private.my_visible_lessons()',
 'private.my_visible_segments()','private.my_viewable_organizations()','private.my_supported_offerings()','private.my_visible_profiles()','private.my_scope()','public.my_scope()']) f),
 'only authenticated may execute them');
select pg_temp.ok((select count(*)=8 from pg_policies where schemaname='public' and cmd='SELECT' and roles='{authenticated}' and (tablename,policyname,qual) in (
 ('courses','courses_select','(id IN ( SELECT private.my_viewable_courses() AS my_viewable_courses))'),
 ('organizations','organizations_select','(id IN ( SELECT private.my_viewable_organizations() AS my_viewable_organizations))'),
 ('profiles','profiles_select','(id IN ( SELECT private.my_visible_profiles() AS my_visible_profiles))'),
 ('course_modules','course_modules_select','(course_id IN ( SELECT private.my_viewable_courses() AS my_viewable_courses))'),
 ('lessons','lessons_select','(id IN ( SELECT private.my_visible_lessons() AS my_visible_lessons))'),
 ('lesson_blocks','lesson_blocks_select','(lesson_id IN ( SELECT private.my_visible_lessons() AS my_visible_lessons))'),
 ('lesson_segments','segments_read','(id IN ( SELECT private.my_visible_segments() AS my_visible_segments))'),
 ('lesson_resources','resources_read','(segment_id IN ( SELECT private.my_visible_segments() AS my_visible_segments))'))),'the eight read policies use the once-per-statement sets');
select pg_temp.ok((select count(*)=7 from pg_policies where schemaname='public' and policyname='trusted_identity' and tablename in
 ('courses','organizations','profiles','course_modules','lessons','lesson_blocks','course_offerings')),'the restrictive trusted_identity policies stay');
select pg_temp.ok((select pg_get_functiondef('private.save_segment_progress(uuid,uuid,integer,boolean,bigint)'::regprocedure) !~ 'can_view_segment'),
 'the progress save no longer calls can_view_segment (A0-07)');
select pg_temp.ok((select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'my\_%'
 and p.proname not in ('my_space_roles','my_course_access','my_viewable_courses','my_staff_courses','my_visible_lessons','my_visible_segments','my_viewable_organizations',
 'my_supported_offerings','my_visible_profiles','my_scope')),'no other my_* function exists');

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
-- fixture-end

-- ===== 2. Every caller: the new policies return exactly the rows the old expressions accept =====
-- The old expressions, evaluated as the table owner (no RLS) under the caller's token. The restrictive trusted_identity policy (a
-- resolved caller) applies to the six original tables, not to lesson_segments and lesson_resources.
create temp table ms_old(tbl text primary key, expr text not null);
insert into ms_old values
 ('courses','(select private.current_app_user_id()) is not null and private.can_view_course(id)'),
 ('organizations','(select private.current_app_user_id()) is not null and (private.is_org_member(id) or exists(select 1 from public.courses c where c.organization_id=t.id and private.can_view_course(c.id)))'),
 ('profiles','(select private.current_app_user_id()) is not null and private.can_view_profile(id)'),
 ('course_modules','(select private.current_app_user_id()) is not null and private.can_view_course(course_id)'),
 ('lessons','(select private.current_app_user_id()) is not null and private.can_view_lesson(id)'),
 ('lesson_blocks','(select private.current_app_user_id()) is not null and private.can_view_lesson(lesson_id)'),
 ('lesson_segments','private.can_view_segment(id)'),
 ('lesson_resources','private.can_view_segment(segment_id)');
create temp table ms_seen(caller text, tbl text, new_ids uuid[], old_ids uuid[]);
grant select,insert on ms_seen to authenticated;
create temp table ms_callers(label text primary key);
insert into ms_callers select unnest(array['owner','admin','teacher','asst_run','asst_norun','cs_owner','cs_instructor','cs_editor','cs_assistant','ta_nomember',
 'st_active','st_suspended','st_cancelled','st_expired','st_future','st_invited','st_completed','st_archived_run','st_draft_course','st_other','st_two',
 'nospace','padmin','prof_suspended','mem_suspended','mem_invited','s2_teacher','s2_student','staff_student','revoked','unmapped','none',
 'seed1','seed2','seed3','seed4','seed5','seed6','seed7']);
grant select on ms_callers, ms_old to authenticated;

do $$ declare c text; t record; ids uuid[]; begin
 for c in select label from pg_temp.ms_callers loop
  perform pg_temp.as_(c);
  for t in select * from pg_temp.ms_old loop
   execute 'set local role authenticated';
   execute format('select coalesce(array_agg(id order by id),''{}'') from public.%I',t.tbl) into ids;
   execute 'reset role';
   insert into pg_temp.ms_seen values(c,t.tbl,ids,null);
   execute format('select coalesce(array_agg(id order by id),''{}'') from public.%I t where %s',t.tbl,t.expr) into ids;
   update pg_temp.ms_seen set old_ids=ids where caller=c and tbl=t.tbl;
  end loop;
 end loop;
end $$;
select pg_temp.ok((select count(*)=39*8 from ms_seen),'312 caller and table pairs compared');
select pg_temp.ok(not exists(select 1 from ms_seen where new_ids is distinct from old_ids),
 'every caller sees exactly the rows of the old policies: '||coalesce((select string_agg(caller||'/'||tbl,', ') from ms_seen where new_ids is distinct from old_ids),'no difference'));
-- The comparison is not empty-against-empty: the roles see what they should.
select pg_temp.ok((select count(*) from ms_seen where cardinality(new_ids)>0)=149,'149 of the 312 pairs return rows (the rest are the refusals)');
select pg_temp.ok((select new_ids=array[pg_temp.k('C1')] from ms_seen where caller='st_active' and tbl='courses'),'an active student sees the published course of their run');
select pg_temp.ok((select count(*)=21 and bool_and(cardinality(new_ids)=0) from ms_seen where caller in ('st_suspended','st_cancelled','st_expired','st_future','st_invited','st_completed','st_archived_run',
 'nospace','padmin','prof_suspended','unmapped','none','revoked','teacher','asst_norun','mem_suspended','mem_invited','ta_nomember','s2_student','s2_teacher','st_draft_course') and tbl='courses'),
 'no course for an ended, future, cancelled or invited enrollment, a draft course, a suspended profile, membership or space, a revoked or unmapped token, no token, a bare member or a platform admin');
select pg_temp.ok((select cardinality(new_ids)=3 from ms_seen where caller='owner' and tbl='courses') and (select cardinality(new_ids)=2 from ms_seen where caller='cs_editor' and tbl='courses'),
 'the space owner sees the three courses of the space; an editor of two courses sees two');
select pg_temp.ok((select cardinality(new_ids)=2 from ms_seen where caller='st_active' and tbl='lesson_resources')
 and (select cardinality(new_ids)=16 from ms_seen where caller='cs_editor' and tbl='lesson_resources'),
 'a student reads the attachments of published parts of published lessons only (2 of 8); an editor of two courses reads all 16');

-- Each set equals the old helper applied to every row of its table.
create temp table ms_sets(caller text, name text, same boolean);
grant select,insert on ms_sets to authenticated;
do $$ declare c text; begin
 for c in select label from pg_temp.ms_callers where label<>'none' or true loop
  perform pg_temp.as_(c);
  insert into pg_temp.ms_sets values
   (c,'my_staff_courses',(select coalesce(array_agg(x order by x),'{}') from private.my_staff_courses() x)=(select coalesce(array_agg(id order by id),'{}') from public.courses where private.can_edit_course(id) or private.is_course_staff(id))),
   (c,'my_viewable_courses',(select coalesce(array_agg(x order by x),'{}') from private.my_viewable_courses() x)=(select coalesce(array_agg(id order by id),'{}') from public.courses where private.can_view_course(id))),
   (c,'my_visible_lessons',(select coalesce(array_agg(x order by x),'{}') from private.my_visible_lessons() x)=(select coalesce(array_agg(id order by id),'{}') from public.lessons where private.can_view_lesson(id))),
   (c,'my_visible_segments',(select coalesce(array_agg(x order by x),'{}') from private.my_visible_segments() x)=(select coalesce(array_agg(id order by id),'{}') from public.lesson_segments where private.can_view_segment(id))),
   (c,'my_viewable_organizations',(select coalesce(array_agg(x order by x),'{}') from private.my_viewable_organizations() x)=(select coalesce(array_agg(id order by id),'{}') from public.organizations o where private.is_org_member(id) or exists(select 1 from public.courses k where k.organization_id=o.id and private.can_view_course(k.id)))),
   (c,'my_space_roles',(select coalesce(array_agg(organization_id order by organization_id),'{}') from private.my_space_roles())=(select coalesce(array_agg(id order by id),'{}') from public.organizations where private.is_org_member(id))),
   (c,'my_supported_offerings',(select coalesce(array_agg(x order by x),'{}') from private.my_supported_offerings() x)=(select coalesce(array_agg(id order by id),'{}') from public.course_offerings where private.can_support_offering(id))),
   (c,'my_visible_profiles',(select coalesce(array_agg(x order by x),'{}') from private.my_visible_profiles() x)=(select coalesce(array_agg(id order by id),'{}') from public.profiles where private.can_view_profile(id))),
   (c,'my_scope',private.my_scope()=jsonb_build_object(
     'organizations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status) order by id) from (select * from public.organizations o where (select private.current_app_user_id()) is not null and (private.is_org_member(o.id) or exists(select 1 from public.courses k where k.organization_id=o.id and private.can_view_course(k.id))) order by id limit 101) x),'[]'),
     'courses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'organization_id',organization_id,'title',title,'description',description,'status',status) order by id) from (select * from public.courses where (select private.current_app_user_id()) is not null and private.can_view_course(id) order by id limit 101) x),'[]')));
 end loop;
end $$;
select pg_temp.ok((select count(*)=39*9 and bool_and(same) from ms_sets),'each my_* set equals its old helper on every row, for every caller: '||coalesce((select string_agg(caller||'/'||name,', ') from ms_sets where not same),'no difference'));

-- Anonymous: no table grant before or after.
set local role anon;
do $$ declare t text; caught text; begin
 foreach t in array array['courses','organizations','profiles','course_modules','lessons','lesson_blocks','lesson_segments','lesson_resources'] loop
  caught:=null; begin execute format('select 1 from public.%I limit 1',t); exception when others then caught:=sqlstate; end;
  if caught is distinct from '42501' then raise exception 'FAILED anonymous read of % gave %',t,caught; end if;
 end loop;
 caught:=null; begin perform public.my_scope(); exception when others then caught:=sqlstate; end;
 if caught is distinct from '42501' then raise exception 'FAILED anonymous my_scope gave %',caught; end if;
end $$;
reset role;
select pg_temp.ok(true,'anonymous reads none of the eight tables and cannot call my_scope (42501)');

-- ===== 3. The progress save: the same answer as before for every caller, part and run =====
-- The old function, as it was (20261013141230), under another name for this transaction only.
do $$ begin execute replace(replace(pg_get_functiondef('private.save_segment_progress(uuid,uuid,integer,boolean,bigint)'::regprocedure),
 'private.save_segment_progress(','private.save_segment_progress_before('),
 'or not (case when lesson_status=''published'' then true else private.can_edit_course(c) or private.is_course_staff(c) end)','or not private.can_view_segment(s.id)'); end $$;
select pg_temp.ok((select pg_get_functiondef('private.save_segment_progress_before(uuid,uuid,integer,boolean,bigint)'::regprocedure) ~ 'not private.can_view_segment\(s\.id\)'),'the old check is back in the comparison copy');
grant execute on function private.save_segment_progress_before(uuid,uuid,integer,boolean,bigint) to authenticated;
-- One save, undone at once; returns 'ok <reply>' or the SQLSTATE.
create function pg_temp.save(fn text,off uuid,seg uuid) returns text language plpgsql as $$
declare reply text; begin
 begin execute format('select %s(%L,%L,30,false,0)::text',fn,off,seg) into reply; raise exception using errcode='MS001',message=reply;
 exception when sqlstate 'MS001' then get stacked diagnostics reply=message_text; return 'ok '||reply; when others then return sqlstate; end;
end$$;
create temp table ms_saves(caller text, off text, part text, before text, after text);
grant select,insert on ms_saves to authenticated;
set local role authenticated;
do $$ declare c text; o text; p text; begin
 foreach c in array array['st_active','staff_student','cs_editor','owner','st_expired','st_future','st_suspended','st_other','st_archived_run','prof_suspended','nospace','revoked','none'] loop
  perform pg_temp.as_(c);
  foreach o in array array['C1a','C1b','C2a','S1a'] loop
   foreach p in array array['C1-m0-l0-p0','C1-m0-l0-p1','C1-m0-l1-p0','C1-m1-l0-p0','C2-m0-l0-p0','S1-m0-l0-p0'] loop
    insert into pg_temp.ms_saves values(c,o,p,pg_temp.save('private.save_segment_progress_before',pg_temp.k(o),pg_temp.k(p)),pg_temp.save('public.save_segment_progress',pg_temp.k(o),pg_temp.k(p)));
   end loop;
  end loop;
 end loop;
end $$;
reset role;
select pg_temp.ok((select count(*)=13*4*6 from ms_saves),'312 progress saves compared');
select pg_temp.ok(not exists(select 1 from ms_saves where before is distinct from after),
 'every save gives the old answer: '||coalesce((select string_agg(caller||'/'||off||'/'||part||' '||before||' -> '||after,', ') from ms_saves where before is distinct from after),'no difference'));
select pg_temp.ok((select after like 'ok %' from ms_saves where caller='st_active' and off='C1a' and part='C1-m0-l0-p0'),'a student saves a published part of a published lesson');
select pg_temp.ok((select after='42501' from ms_saves where caller='st_active' and off='C1a' and part='C1-m0-l1-p0'),'a student cannot save a published part of a draft lesson');
select pg_temp.ok((select after like 'ok %' from ms_saves where caller='staff_student' and off='C1a' and part='C1-m0-l1-p0'),
 'an enrolled course editor still can (the old can_view_segment allowed staff)');
select pg_temp.ok((select count(*)=0 from ms_saves where after like 'ok %' and caller not in ('st_active','staff_student')),'nobody else saves');
select pg_temp.ok((select count(*)=0 from public.lesson_segment_progress where user_id in (select pg_temp.u(label) from ms_callers)),'every save was undone');

-- ===== 4. The caller is resolved per statement, never cached =====
set local role authenticated;
select pg_temp.as_('owner');
select pg_temp.ok((select count(*)=3 from public.courses where organization_id=pg_temp.k('R')),'the owner reads the three courses');
reset role;
update public.profiles set status='suspended' where id=pg_temp.u('owner');
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.courses) and (select count(*)=0 from private.my_viewable_courses()),'suspended in this transaction: nothing at the next statement');
reset role;
update public.profiles set status='active' where id=pg_temp.u('owner');
update private.external_identities set tokens_valid_after=now()+interval '1 hour' where profile_id=pg_temp.u('owner');
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.courses) and private.my_scope()='{"courses":[],"organizations":[]}','token revoked in this transaction: nothing at the next statement');
reset role;
update private.external_identities set tokens_valid_after='1970-01-01' where profile_id=pg_temp.u('owner');
set local role authenticated;
select pg_temp.as_('st_active');
select pg_temp.ok((select array_agg(id)=array[pg_temp.k('C1')] from public.courses),'another token in the same transaction gets its own rows');
-- Settings a client might hope to use. None of them is read: only request.jwt.claims (set by the gateway from the verified token) is.
select set_config('request.jwt.claim.sub','my-scope-owner',true), set_config('request.jwt.claim.role','authenticated',true),
 set_config('lms.caller',pg_temp.u('owner')::text,true), set_config('app.current_user_id',pg_temp.u('owner')::text,true), set_config('my_scope.caller',pg_temp.u('owner')::text,false);
select pg_temp.ok((select array_agg(id)=array[pg_temp.k('C1')] from public.courses) and (select count(*)=1 from private.my_viewable_courses()),
 'forged caller settings (transaction or session) change nothing');
select set_config('my_scope.caller','',false);
select pg_temp.as_('owner');
select pg_temp.ok((select count(*)=3 from public.courses where organization_id=pg_temp.k('R')),'back to the owner: the owner''s rows again');
reset role;

-- ===== 5. The plan: the set is evaluated once per statement =====
create function pg_temp.plan(q text) returns text language plpgsql as $$declare line text; result text:=''; begin
 for line in execute 'explain (costs off) '||q loop result:=result||line||E'\n'; end loop; return result; end$$;
set local role authenticated;
select pg_temp.as_('st_active');
select pg_temp.ok((select p ~ 'hashed SubPlan' and p !~ 'can_view_lesson' from pg_temp.plan(format('select * from public.lesson_blocks where lesson_id=%L',pg_temp.k('C1-m0-l0'))) p),
 'a student''s block read checks a hashed set, with no per-row helper');
select pg_temp.ok((select p ~ 'hashed SubPlan' and p !~ 'can_view_course' from pg_temp.plan('select id from public.courses order by id limit 101') p),
 'an unfiltered course read checks a hashed set, with no per-row helper');
reset role;

select jsonb_build_object('passed',count(*)) as my_scope_tests from ms_results;
rollback;
