-- Disposable local PostgreSQL only (same convention as platform-admin-provisioning.sql). Everything rolls back; synthetic users only.
-- Covers migration 20261029120000_demo_clear_robust.sql: private.demo_clear_core removes what a teacher added inside a demo space's
-- Groups and courses, refuses a space with an enrolled student, refuses content it does not remove, and never touches another space.
begin;
create temp table dcr_results(name text primary key);
create temp table dcr_users(label text primary key,id uuid not null);
grant select,insert on dcr_results,dcr_users to authenticated,anon;
select set_config('dcr.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.dcr_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.dcr_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('dcr.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','dcr-'||current_setting('dcr.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('dcr.'||k)::uuid$$;
-- Everything a space owns that Clear touches, as one string, so "nothing left" is a single comparison.
create function pg_temp.leftover(org uuid) returns text language sql as $$
 select (select count(*) from public.courses where organization_id=org)||'/'||
  (select count(*) from public.course_modules m join public.courses c on c.id=m.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.lessons l join public.course_modules m on m.id=l.module_id join public.courses c on c.id=m.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_schedules s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_staff s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from private.demo_seed_rows where organization_id=org)
$$;
create function pg_temp.events(org uuid) returns bigint language sql as $$
 select count(*) from private.notification_events where event_key like 'demo:'||org::text||':%' or resource_id in (
  select g.id from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org
  union select s.id from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)
$$;

-- Synthetic people: the platform administrator who clears, the demo teacher, a teacher of an ordinary space, a student.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','realteacher','student','teacher3'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.dcr_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;

-- Space A: demo, teacher accepted. Space B: an ordinary space with its own course, Group and Session. Space C: demo that later gets a student.
select set_config('dcr.org_a',gen_random_uuid()::text,true); select set_config('dcr.org_b',gen_random_uuid()::text,true); select set_config('dcr.org_c',gen_random_uuid()::text,true);
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic demo A','dcr-a-'||current_setting('dcr.run')),
 (pg_temp.key('org_b'),'Synthetic real B','dcr-b-'||current_setting('dcr.run')),(pg_temp.key('org_c'),'Synthetic demo C','dcr-c-'||current_setting('dcr.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),id,'owner','active',now() from dcr_users where label='teacher'
 union all select pg_temp.key('org_b'),id,'owner','active',now() from dcr_users where label='realteacher'
 union all select pg_temp.key('org_c'),id,'owner','active',now() from dcr_users where label='teacher3';
insert into private.demo_spaces(organization_id,marked_by) select o,(select id from dcr_users where label='admin') from unnest(array[pg_temp.key('org_a'),pg_temp.key('org_c')]) o;

-- Space B (never demo): a course, an offering, a Group, a Session and a schedule that Clear of another space must never touch.
select set_config('dcr.b_course',gen_random_uuid()::text,true); select set_config('dcr.b_off',gen_random_uuid()::text,true); select set_config('dcr.b_group',gen_random_uuid()::text,true);
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) select pg_temp.key('b_course'),pg_temp.key('org_b'),'Real course','real','published','private',id from dcr_users where label='realteacher';
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.key('b_off'),pg_temp.key('b_course'),'Real offering','active');
insert into public.study_groups(id,offering_id,name,mode,location,created_by) select pg_temp.key('b_group'),pg_temp.key('b_off'),'Real group','center','Real room',id from dcr_users where label='realteacher';
insert into public.group_staff(group_id,user_id) select pg_temp.key('b_group'),id from dcr_users where label='realteacher';
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
 select pg_temp.key('b_group'),'Real session',now()+interval '2 days',now()+interval '2 days 1 hour',now()+interval '2 days',now()+interval '2 days 1 hour','center','Real room',id,id from dcr_users where label='realteacher';
insert into public.group_schedules(group_id,weekday,local_time,duration_minutes) values(pg_temp.key('b_group'),2,'17:00',60);
select set_config('dcr.b_before',pg_temp.leftover(pg_temp.key('org_b')),true);

-- 1. Fill space A.
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_a'),(select id from dcr_users where label='admin'))->>'sessions')::int=9,'fill creates the nine sessions (five upcoming, four past)');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_a'))='2/3/5/1/2/9/0/2/'||(select count(*) from private.demo_seed_rows where organization_id=pg_temp.key('org_a')),'fill state is what the seed table says');

-- 2. The teacher adds things the registry does not know: a Session and a weekly time on a demo Group, a second offering with its own Group,
--    Session and staff, and a chapter with a lesson and a block inside a demo course.
select set_config('dcr.a_course',(select row_id::text from private.demo_seed_rows where organization_id=pg_temp.key('org_a') and table_name='courses' order by id limit 1),true);
select set_config('dcr.a_group',(select row_id::text from private.demo_seed_rows where organization_id=pg_temp.key('org_a') and table_name='study_groups' order by id limit 1),true);
select set_config('dcr.a_off2',gen_random_uuid()::text,true); select set_config('dcr.a_group2',gen_random_uuid()::text,true); select set_config('dcr.a_mod',gen_random_uuid()::text,true); select set_config('dcr.a_lesson',gen_random_uuid()::text,true);
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
 select pg_temp.key('a_group'),'Teacher added session',now()+interval '9 days',now()+interval '9 days 1 hour',now()+interval '9 days',now()+interval '9 days 1 hour','center','Room',id,id from dcr_users where label='teacher';
insert into public.group_schedules(group_id,weekday,local_time,duration_minutes) values(pg_temp.key('a_group'),4,'16:00',60);
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.key('a_off2'),pg_temp.key('a_course'),'Teacher added offering','active');
insert into public.study_groups(id,offering_id,name,mode,location,created_by) select pg_temp.key('a_group2'),pg_temp.key('a_off2'),'Teacher added group','center','Room 9',id from dcr_users where label='teacher';
insert into public.group_staff(group_id,user_id) select pg_temp.key('a_group2'),id from dcr_users where label='teacher';
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
 select pg_temp.key('a_group2'),'Teacher added session 2',now()+interval '10 days',now()+interval '10 days 1 hour',now()+interval '10 days',now()+interval '10 days 1 hour','center','Room 9',id,id from dcr_users where label='teacher';
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('a_mod'),pg_temp.key('a_course'),'Teacher added chapter',50);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('a_lesson'),pg_temp.key('a_mod'),'Teacher added lesson',0,'draft');
insert into public.lesson_blocks(lesson_id,block_type,position,content) values(pg_temp.key('a_lesson'),'text',0,'{"text":"Teacher added block"}'::jsonb);
select pg_temp.ok((select count(*) from public.group_sessions where group_id in (pg_temp.key('a_group'),pg_temp.key('a_group2')))>=3,'the added sessions exist (and are not in the registry)');
select pg_temp.ok(not exists(select 1 from private.demo_seed_rows where row_id in (pg_temp.key('a_group2'),pg_temp.key('a_off2'),pg_temp.key('a_mod'),pg_temp.key('a_lesson'))),'the teacher-added rows are not recorded');

-- 3. Content that Clear does not remove (here: an exam) makes it refuse, and nothing is removed.
select set_config('dcr.a_before',pg_temp.leftover(pg_temp.key('org_a')),true);
savepoint blocker;
insert into public.assessments(course_id,title,type) values(pg_temp.key('a_course'),'Teacher added quiz','quiz');
select pg_temp.denied(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_a'),(select id from dcr_users where label='admin')),'PT409','clear refuses a space holding exams');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_a'))=current_setting('dcr.a_before'),'a refused clear removed nothing');
rollback to savepoint blocker;
insert into dcr_results values('clear refuses content it does not remove, and removes nothing first');

-- 4. Space C: filled, then a student is enrolled. Clear refuses and leaves everything in place.
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_c'),(select id from dcr_users where label='admin'))->>'sessions')::int=9,'space C is filled');
insert into public.enrollments(offering_id,user_id,status) select o.id,u.id,'active' from public.course_offerings o join public.courses c on c.id=o.course_id cross join dcr_users u
 where c.organization_id=pg_temp.key('org_c') and u.label='student';
select set_config('dcr.c_before',pg_temp.leftover(pg_temp.key('org_c')),true);
select pg_temp.denied(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_c'),(select id from dcr_users where label='admin')),'PT409','a space with an enrolled student is refused');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_c'))=current_setting('dcr.c_before') and exists(select 1 from private.demo_spaces where organization_id=pg_temp.key('org_c') and filled_at is not null),'the refused space is unchanged');

-- 5. Clear space A. Recorded: 3+1 chapters, 5+1 lessons, 2 courses = 12. Added or recorded under the Groups and offerings: 7 sessions, 1 weekly time,
--    3 staff rows, 3 Groups, 2 offerings = 16. Total 28, and nothing is left.
select set_config('dcr.a_result',private.demo_clear_core(pg_temp.key('org_a'),(select id from dcr_users where label='admin'))::text,true);
select pg_temp.ok((current_setting('dcr.a_result')::jsonb->>'removedRows')::int=116,'removedRows counts every removed row, added ones included');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_a'))='0/0/0/0/0/0/0/0/0','clear leaves nothing for the space (courses, chapters, lessons, offerings, Groups, Sessions, weekly times, staff, registry)');
select pg_temp.ok(not exists(select 1 from public.group_sessions where group_id in (pg_temp.key('a_group'),pg_temp.key('a_group2')))
 and not exists(select 1 from public.study_groups where id in (pg_temp.key('a_group'),pg_temp.key('a_group2')))
 and not exists(select 1 from public.course_offerings where id=pg_temp.key('a_off2'))
 and not exists(select 1 from public.course_modules where id=pg_temp.key('a_mod'))
 and not exists(select 1 from public.lessons where id=pg_temp.key('a_lesson'))
 and not exists(select 1 from public.lesson_blocks where lesson_id=pg_temp.key('a_lesson')),'what the teacher added is gone, including the chapter, lesson and block');
select pg_temp.ok(pg_temp.events(pg_temp.key('org_a'))=0,'no notification event of the space remains');
select pg_temp.ok(not exists(select 1 from private.group_audit where group_id in (pg_temp.key('a_group'),pg_temp.key('a_group2'))),'no Group audit row remains');
select pg_temp.ok(exists(select 1 from private.demo_spaces where organization_id=pg_temp.key('org_a') and seed_version is null and filled_at is null),'the space is still demo, now empty');
select pg_temp.ok((select (detail->>'removedRows')::int=116 and detail ? 'removedByTable' and detail ? 'removedSupportRows' from private.platform_audit where organization_id=pg_temp.key('org_a') and action='demo.clear'),'the audit row carries the honest counts');

-- 6. Spaces that are not A are untouched; clear is not available for a space that is not demo.
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_b'))=current_setting('dcr.b_before') and exists(select 1 from public.group_sessions where group_id=pg_temp.key('b_group'))
 and exists(select 1 from public.group_schedules where group_id=pg_temp.key('b_group')) and exists(select 1 from public.group_staff where group_id=pg_temp.key('b_group')),'an ordinary space is untouched');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_c'))=current_setting('dcr.c_before'),'the other demo space is untouched');
select pg_temp.denied(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_b'),(select id from dcr_users where label='admin')),'PT409','a space that is not demo cannot be cleared');
select pg_temp.ok(pg_temp.leftover(pg_temp.key('org_b'))=current_setting('dcr.b_before'),'the refused ordinary space is unchanged');

-- 7. After a clear the space can be filled again (the same course slugs are free) and cleared again with the original count.
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_a'),(select id from dcr_users where label='admin'))->>'sessions')::int=9,'a cleared space can be filled again');
select pg_temp.ok((private.demo_clear_core(pg_temp.key('org_a'),(select id from dcr_users where label='admin'))->>'removedRows')::int=108,'a plain clear still removes exactly the 108 recorded rows');

-- 8. The function is not callable by API roles.
select pg_temp.ok((select bool_and(not has_function_privilege(r,'private.demo_clear_core(uuid,uuid)','execute')) from unnest(array['anon','authenticated']) r),'API roles cannot call demo_clear_core');

select count(*)||' checks passed' from dcr_results;
rollback;
