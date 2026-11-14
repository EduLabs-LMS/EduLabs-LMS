-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Covers migration 20261116120000_demo_seed_8_and_notice_links.sql:
--   (a) demo seed version 8: every session and deadline of the seed lands at the Cairo wall time meant (Group 1 at 18:00, Group 2 at 20:00,
--       homework due at 20:00), whatever time zone the database SESSION is on. The hosted database runs on UTC; a server on Cairo time hid the mistake.
--   (b) a homework_released notice for homework in a lesson with no published part opens the student lesson page by lesson id; with a part it still
--       opens the part; for anyone else, or before the release, it is null.
begin;
create temp table ds_results(name text primary key);
create temp table ds_users(label text primary key,id uuid not null);
create temp table ds_ids(label text primary key,id uuid not null);
grant select,insert,update on ds_results,ds_users,ds_ids to authenticated,anon;
select set_config('ds.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.ds_results values(label);end$$;
-- The refusal as {code, message, reason, questions}.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end,'questions',case when coalesce(d,'') like '{%' then d::jsonb->'questions' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('ds.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','ds-'||current_setting('ds.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.ds_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.ds_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.ds_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
create function pg_temp.rev(p_exam uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.exams where id=p_exam$$;
create function pg_temp.status_of(p_exam uuid) returns text language sql security definer set search_path='' as $$select status from private.exams where id=p_exam$$;
create function pg_temp.qcount(p_exam uuid) returns integer language sql security definer set search_path='' as $$select count(*)::int from private.exam_questions where exam_id=p_exam$$;
create function pg_temp.exam_named(t text) returns uuid language sql security definer set search_path='' as $$
 select e.id from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=pg_temp.key('org') and e.title=t$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher'] loop
  perform pg_temp.claim(label); insert into pg_temp.ds_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from ds_users where label='admin';
select pg_temp.put('org',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo exams student','ds-'||current_setting('ds.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));

-- (a) The cause is gone from the function: the day is a wall time, not an instant.
select pg_temp.ok(pg_get_functiondef('private.demo_fill_core(uuid,uuid)'::regprocedure) like '%v_day timestamp;%' and pg_get_functiondef('private.demo_fill_core(uuid,uuid)'::regprocedure) not like '%v_day timestamptz%','demo_fill_core keeps its day as a wall time (timestamp), not an instant');

-- The Cairo wall times of every session and homework deadline of the space, as 'group|title|HH24:MI' lines.
create function pg_temp.wall(p_org uuid) returns text language sql security definer set search_path='' as $$
 select string_agg(g.name||'|'||s.title||'|'||to_char(s.starts_at at time zone 'Africa/Cairo','HH24:MI'),',' order by g.name,s.starts_at,s.title)
 from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=p_org and s.title<>'Demo live class'$$;
create function pg_temp.deadlines(p_org uuid) returns text language sql security definer set search_path='' as $$
 select string_agg(distinct to_char(a.deadline_at at time zone 'Africa/Cairo','HH24:MI'),',') from public.homework_assignments a join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=o.course_id where c.organization_id=p_org$$;

-- Fill under four session time zones (UTC like the hosted database, Cairo like a local one, and two far from both), clearing between them.
do $$ declare tz text; w text; d text; r jsonb; org_ uuid := (select id from pg_temp.ds_ids where label='org'); adm uuid := (select id from pg_temp.ds_users where label='admin'); begin
 foreach tz in array array['UTC','Africa/Cairo','America/Los_Angeles','Pacific/Kiritimati'] loop
  perform set_config('TimeZone',tz,true);
  r := private.demo_fill_core(org_,adm);
  if r is distinct from jsonb_build_object('seedVersion',9,'courses',2,'lessons',6,'groups',2,'sessions',10,'students',28,'homework',5,'exams',5) then raise exception 'FAILED fill result under %: %',tz,r; end if;
  w := pg_temp.wall(org_); d := pg_temp.deadlines(org_);
  -- Group 1: the two earlier sessions and the three upcoming ones at 18:00; Group 2: the two earlier and the two upcoming ones at 20:00. Nothing at midnight.
  if w is distinct from 'Demo Group 1|Demo earlier session 1|18:00,Demo Group 1|Demo earlier session 2|18:00,Demo Group 1|Demo session 1|18:00,Demo Group 1|Demo session 2|18:00,Demo Group 1|Demo session 3|18:00,Demo Group 2|Demo earlier session 1|20:00,Demo Group 2|Demo earlier session 2|20:00,Demo Group 2|Demo session 1|20:00,Demo Group 2|Demo session 2|20:00'
   then raise exception 'FAILED session times under %: %',tz,w; end if;
  if d is distinct from '20:00' then raise exception 'FAILED homework deadlines under %: %',tz,d; end if;
  insert into pg_temp.ds_results values('under session time zone '||tz||': Group 1 sessions at 18:00, Group 2 at 20:00, homework due 20:00 (Cairo)');
  perform set_config('TimeZone','UTC',true);
  perform private.demo_clear_core(org_,adm);
 end loop;
end $$;

-- The space ends at the latest seed version (9: version 8 plus the live class of 20261119120000).
select pg_temp.ok(private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion'='9','the space fills at seed version 9 (version 8 plus the live class of 20261119120000)');
select pg_temp.ok((select seed_version=9 from private.demo_spaces where organization_id=pg_temp.key('org')),'the space stores seed version 9');
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_demo_status(pg_temp.key('org'))->>'latestSeedVersion')::int=9 and (public.platform_demo_status(pg_temp.key('org'))->>'seedVersion')::int=9,'the status reports seed version 9 as the latest');
reset role;
select pg_temp.ok((select (detail->>'seedVersion')::int=9 from private.platform_audit where organization_id=pg_temp.key('org') and action='demo.fill' order by id desc limit 1),'the audit row records seed version 9');

-- (b) The notice link.
select pg_temp.put('course',(select id from public.courses where organization_id=pg_temp.key('org') and status='published'));
select pg_temp.put('off',(select o.id from public.course_offerings o where o.course_id=pg_temp.key('course')));
select pg_temp.put('lesson',(select l.id from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=pg_temp.key('course') and l.title='Magnetism review'));
select pg_temp.put('hw',(select a.id from public.homework_assignments a where a.lesson_id=pg_temp.key('lesson')));
create function pg_temp.student(n integer) returns uuid language sql security definer set search_path='' as $$
 select p.id from public.profiles p join private.demo_seed_rows d on d.row_id=p.id and d.table_name='profiles' where d.organization_id=pg_temp.key('org') and p.display_name='Demo Student '||n$$;
create function pg_temp.try_of(n integer) returns uuid language sql security definer set search_path='' as $$
 select s.id from public.homework_submissions s where s.assignment_id=pg_temp.key('hw') and s.user_id=pg_temp.student(n) order by s.number desc limit 1$$;
create function pg_temp.link_for(n integer) returns text language sql security definer set search_path='' as $$select private.notification_link((select id from private.notification_events where event_type='homework_released' and resource_id=(select s.id from public.homework_submissions s where s.assignment_id=pg_temp.key('hw') and s.user_id=pg_temp.student(3) order by s.number desc limit 1) order by created_at limit 1),pg_temp.student(n))$$;
grant execute on function pg_temp.link_for(integer) to authenticated;
create function pg_temp.event_of(p_sub uuid) returns uuid language sql security definer set search_path='' as $$select id from private.notification_events where event_type='homework_released' and resource_id=p_sub order by created_at limit 1$$;
-- Two demo students get a sign-in of their own (the demo's own profiles have none), as a real student would after joining.
insert into private.external_identities(profile_id,provider,issuer,subject,verified_at)
 select pg_temp.student(n),'firebase','https://securetoken.google.com/diagonproduction','ds-'||current_setting('ds.run')||'-student'||n,now() from generate_series(3,4) n;
create function pg_temp.as_student(n integer) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email','student'||n||'.'||current_setting('ds.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','ds-'||current_setting('ds.run')||'-student'||n)::text,true);end$$;
grant execute on function pg_temp.as_student(integer) to authenticated;

select pg_temp.ok((select a.segment_id is null and not exists(select 1 from public.lesson_segments s where s.lesson_id=pg_temp.key('lesson')) from public.homework_assignments a where a.id=pg_temp.key('hw')),'the demo homework sits in a lesson with no part');
select pg_temp.ok((select count(*)=0 from private.notification_events where event_type='homework_released' and resource_id=pg_temp.try_of(3)),'nothing is sent before the release');
-- The correction is released the way a release writes it; the existing trigger then writes the notice (the release path itself is tested in homework-correct.sql).
create function pg_temp.release(p_sub uuid) returns void language sql security definer set search_path='' as $$
 update private.homework_corrections set status='approved',released_at=now(),released_by=(select user_id from public.organization_memberships where organization_id=pg_temp.key('org') and role='owner' limit 1) where submission_id=p_sub$$;
select pg_temp.release(pg_temp.try_of(3));
select pg_temp.ok(pg_temp.event_of(pg_temp.try_of(3)) is not null,'a homework_released notice exists');
set local role authenticated; select pg_temp.as_student(3);
select pg_temp.ok(pg_temp.link_for(3)='/courses/'||pg_temp.key('course')||'/lessons/'||pg_temp.key('lesson')||'?offering='||pg_temp.key('off'),'the notice opens the lesson page by lesson id');
select pg_temp.ok(pg_temp.link_for(4) is null,'asking for another student''s notice gives nothing');
reset role;
set local role authenticated; select pg_temp.as_student(4);
select pg_temp.ok(pg_temp.link_for(4) is null,'a student with no released work of their own gets no link from it');
reset role;
-- An unpublished lesson is a dead end, so it keeps no link.
update public.lessons set status='draft' where id=pg_temp.key('lesson');
set local role authenticated; select pg_temp.as_student(3);
select pg_temp.ok(pg_temp.link_for(3) is null,'once the lesson is unpublished the notice links nowhere');
reset role;
update public.lessons set status='published' where id=pg_temp.key('lesson');
-- With a published part the link is today's link to the part.
insert into public.lesson_segments(lesson_id,title,position,status) values(pg_temp.key('lesson'),'Synthetic part',0,'published');
set local role authenticated; select pg_temp.as_student(3);
select pg_temp.ok(pg_temp.link_for(3) like '/courses/'||pg_temp.key('course')||'/chapters/%?offering='||pg_temp.key('off'),'with a published part the link still goes to the part');
reset role;
-- The function changed only there: the other branches keep their text, and its grants are as before.
select pg_temp.ok(pg_get_functiondef('private.notification_link(uuid,uuid)'::regprocedure) like '%private.exam_released(r.id)%/exams/%' and pg_get_functiondef('private.notification_link(uuid,uuid)'::regprocedure) like '%''/groups''%' and pg_get_functiondef('private.notification_link(uuid,uuid)'::regprocedure) like '%''/support?ticket=''%','the exam, group and support links are unchanged');
select pg_temp.ok(not has_function_privilege('authenticated','private.notification_link(uuid,uuid)','execute') and not has_function_privilege('anon','private.notification_link(uuid,uuid)','execute') and not has_function_privilege('service_role','private.notification_link(uuid,uuid)','execute'),'no client role can run notification_link (grants unchanged)');

select count(*) as demo_seed_8_checks from ds_results;
rollback;
