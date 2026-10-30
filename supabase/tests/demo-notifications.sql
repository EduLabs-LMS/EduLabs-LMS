-- Disposable local PostgreSQL only (same convention as demo-students.sql). Everything rolls back; synthetic users only. Never run this
-- against a connected database except inside a transaction that is rolled back.
-- Covers migration 20261031120000_demo_notifications.sql: seed version 3 = five notifications for the teacher of a demo space, tied to the demo
-- Group and lesson, keyed 'demo:<org id>:...', never queued for push, listed for the teacher by the notification command, and removed by Clear.
begin;
create temp table dn_results(name text primary key);
create temp table dn_users(label text primary key,id uuid not null);
create temp table dn_ids(label text primary key,id uuid not null);
grant select,insert on dn_results,dn_users,dn_ids to authenticated,anon;
select set_config('dn.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.dn_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.dn_results values(label);end$$;
-- The message of a refusal, so a test can check that it names what blocked.
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;begin
 begin execute statement; exception when others then msg:=sqlerrm; end; return msg; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('dn.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','dn-'||current_setting('dn.run')||'-'||label)::text,true);end$$;
create function pg_temp.id(k text) returns uuid language sql as $$select id from pg_temp.dn_ids where label=k$$;
create function pg_temp.user(k text) returns uuid language sql as $$select id from pg_temp.dn_users where label=k$$;
-- Everything the seed creates in a space, as one string, so "nothing left" is a single comparison.
-- courses/chapters/lessons/offerings/Groups/Sessions/weekly times/staff/enrollments/Group memberships/attendance/registry
create function pg_temp.leftover(org uuid) returns text language sql as $$
 select (select count(*) from public.courses where organization_id=org)||'/'||
  (select count(*) from public.course_modules m join public.courses c on c.id=m.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.lessons l join public.course_modules m on m.id=l.module_id join public.courses c on c.id=m.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_schedules s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_staff s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.group_memberships m join public.course_offerings o on o.id=m.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from private.demo_seed_rows where organization_id=org)
$$;
create function pg_temp.demo_profiles(org uuid) returns uuid[] language sql as $$
 select coalesce(array_agg(row_id),'{}') from private.demo_seed_rows where organization_id=org and table_name='profiles' $$;

-- Synthetic people: a platform administrator, two teachers, a real student, and the teacher of a space that already has a real student.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','teacher2','student','realteacher'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.dn_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from dn_users where label='admin';

-- Space A: a demo space with an accepted teacher. Space B: a different demo space (its notifications must be untouched by A's Clear).
do $$ declare k text; begin
 foreach k in array array['org_a','org_b'] loop insert into pg_temp.dn_ids values(k,gen_random_uuid()); end loop;
end $$;
insert into public.organizations(id,name,slug) select pg_temp.id(k),'Synthetic '||k,'dn-'||replace(k,'_','-')||'-'||current_setting('dn.run') from unnest(array['org_a','org_b']) k;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.id('org_a'),id,'owner','active',now() from dn_users where label='teacher'
 union all select pg_temp.id('org_b'),id,'owner','active',now() from dn_users where label='teacher2';
insert into private.teacher_invitations(organization_id,email,token_hash,status,expires_at,created_by)
 select pg_temp.id(k),k||'.'||current_setting('dn.run')||'@example.test',sha256(convert_to(k||current_setting('dn.run'),'UTF8')),'pending',now()+interval '7 days',(select id from dn_users where label='admin')
 from unnest(array['org_a','org_b']) k;
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_set_demo_space(pg_temp.id('org_a'),true)->>'demo')::boolean,'space A is marked');
select pg_temp.ok((public.platform_set_demo_space(pg_temp.id('org_b'),true)->>'demo')::boolean,'space B is marked');
select pg_temp.ok((public.platform_demo_status(pg_temp.id('org_a'))->>'latestSeedVersion')::int=3,'the status reports seed version 3 as the latest');
reset role;

-- 1. Fill both spaces.
select set_config('dn.a_fill',private.demo_fill_core(pg_temp.id('org_a'),(select id from dn_users where label='admin'))::text,true);
select private.demo_fill_core(pg_temp.id('org_b'),(select id from dn_users where label='admin'));
select pg_temp.ok((current_setting('dn.a_fill')::jsonb->>'seedVersion')::int=3 and (current_setting('dn.a_fill')::jsonb->>'students')::int=28,'fill reports seed version 3 and still creates the version 2 students');
select pg_temp.ok((select seed_version=3 from private.demo_spaces where organization_id=pg_temp.id('org_a')),'the space stores seed version 3');

-- 2. The notifications: five, for the teacher only, one per event type that can reach a teacher.
select pg_temp.ok((select count(*)=5 from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'five notifications in space A');
select pg_temp.ok((select count(*)=5 and bool_and(n.recipient_id=pg_temp.user('teacher')) from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'all five are for the teacher, none for a demo student or anyone else');
select pg_temp.ok((select array_agg(e.event_type order by e.event_type) from private.notification_events e where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%')
 =array['account_approved','exam_released','homework_released','lesson_published','support_reply'],'one per event type, each different');
select pg_temp.ok((select bool_and(e.event_type=n.event_type) from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'the notification and its event agree on the type');
select pg_temp.ok((select count(*)=5 from private.notification_events e where e.event_key like 'demo:'||pg_temp.id('org_a')::text||':%' and e.organization_id=pg_temp.id('org_a')),'five events, every key starts with demo:<org id>: (what Clear removes)');
select pg_temp.ok((select count(*)=0 from private.notification_events e where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%' and e.event_type in ('session_details','session_starting')),'no session event: those are never current for staff');
select pg_temp.ok((select count(*)=1 from private.notification_events e join private.demo_seed_rows r on r.row_id=e.resource_id and r.table_name='lessons' where e.event_type='lesson_published' and e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'the lesson notice points at a recorded demo lesson');
select pg_temp.ok((select count(*)=3 from private.notification_events e join private.demo_seed_rows r on r.row_id=e.resource_id and r.table_name='study_groups' where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'three notices point at the recorded demo Groups');
select pg_temp.ok((select count(*) from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%' and n.read_at is null)=4
 and (select count(*) from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%' and n.read_at is not null)=1,'four unread (Home lists those) and one already read');
select pg_temp.ok(not exists(select 1 from private.notification_deliveries d join public.notifications n on n.id=d.notification_id join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'no push delivery is queued for a demo notification');
select pg_temp.ok(not exists(select 1 from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name in ('notifications','notification_events')),'the allowed-table list did not change: notifications are removed by their key prefix');

-- 3. The teacher sees them, through the same command Home and the Notifications page use.
set local role authenticated; select pg_temp.claim('teacher');
select set_config('dn.list',public.notification_command('list','{"page":0,"filter":"all"}')::text,true);
select set_config('dn.unread',public.notification_command('list','{"page":0,"filter":"unread"}')::text,true);
reset role;
select pg_temp.ok((current_setting('dn.list')::jsonb->>'unread')::int=4 and jsonb_array_length(current_setting('dn.list')::jsonb->'rows')=5,'the teacher lists five notifications, four unread');
select pg_temp.ok(jsonb_array_length(current_setting('dn.unread')::jsonb->'rows')=4,'the unread filter lists the four unread');
select pg_temp.ok((select (r->>'event_type') from jsonb_array_elements(current_setting('dn.list')::jsonb->'rows') r order by (r->>'created_at') desc limit 1)='account_approved','newest first');

-- 4. Another teacher sees none of them.
set local role authenticated; select pg_temp.claim('teacher2');
select set_config('dn.list2',public.notification_command('list','{"page":0,"filter":"all"}')::text,true);
reset role;
select pg_temp.ok(jsonb_array_length(current_setting('dn.list2')::jsonb->'rows')=5
 and not exists(select 1 from jsonb_array_elements(current_setting('dn.list2')::jsonb->'rows') r join public.notifications n on n.id=(r->>'id')::uuid where n.recipient_id=pg_temp.user('teacher')),'teacher 2 sees only the five of space B, never teacher 1''s');

-- 5. Clear A removes A's notifications and events and leaves B's alone.
select pg_temp.ok((private.demo_clear_core(pg_temp.id('org_a'),(select id from dn_users where label='admin'))->>'removedRows')::int>0,'Clear A succeeds');
select pg_temp.ok(not exists(select 1 from private.notification_events where event_key like 'demo:'||pg_temp.id('org_a')::text||':%') and not exists(select 1 from public.notifications where recipient_id=pg_temp.user('teacher')),'every notification and event of space A is gone');
select pg_temp.ok((select count(*)=5 from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_b') and e.event_key like 'demo:%'),'space B keeps its five');

-- 6. Fill again after Clear gives the same five.
select private.demo_fill_core(pg_temp.id('org_a'),(select id from dn_users where label='admin'));
select pg_temp.ok((select count(*)=5 from public.notifications n join private.notification_events e on e.id=n.event_id where e.organization_id=pg_temp.id('org_a') and e.event_key like 'demo:%'),'Fill after Clear creates the five again');
select pg_temp.ok(not has_function_privilege('authenticated','private.demo_fill_core(uuid,uuid)','execute') and not has_function_privilege('anon','private.demo_fill_core(uuid,uuid)','execute'),'API roles still cannot call the fill');

select count(*)||' checks passed' from dn_results;
rollback;
