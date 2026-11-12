-- Disposable local PostgreSQL only (same convention as demo-clear-robust.sql). Everything rolls back; synthetic users only. Never run this
-- against a connected database except inside a transaction that is rolled back.
-- Covers migration 20261104120000_demo_students_screen.sql (run with every earlier migration applied): the demo students are in the roster; a teacher's own
-- use of the Students screen in a demo space (Invite students, Suspend, Reactivate, Revoke) no longer makes Clear impossible; Clear leaves a trace of
-- what it removed; and what a REAL person did (a join request, an enrollment, an audit row about them) is never removed: Clear stops and names it.
begin;
create temp table dss_results(name text primary key);
create temp table dss_users(label text primary key,id uuid not null);
grant select,insert on dss_results,dss_users to authenticated,anon;
select set_config('dss.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.dss_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.dss_results values(label);end$$;
-- The message of a refusal, so a test can check that it names what blocked.
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;begin
 begin execute statement; exception when others then msg:=sqlerrm; end; return msg; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('dss.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','dss-'||current_setting('dss.run')||'-'||label)::text,true);end$$;
create function pg_temp.user(k text) returns uuid language sql as $$select id from pg_temp.dss_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('dss.'||k)::uuid$$;
-- A 43-character token, the form the database requires; the hash is what is stored.
create function pg_temp.token(n integer) returns text language sql as $$select rpad('dss'||n::text||replace(current_setting('dss.run'),'-',''),43,'x')$$;
-- Everything the Students screen can leave in one demo space, as one string.
create function pg_temp.traces(org uuid) returns text language sql as $$
 select (select count(*) from private.student_access_links l join public.course_offerings o on o.id=l.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.enrollment_requests r join public.course_offerings o on o.id=r.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from private.student_admin_audit a join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id where c.organization_id=org)||'/'||
  (select count(*) from public.courses where organization_id=org)
$$;

-- Synthetic people: the platform administrator who clears, the demo teacher, a teacher of an ordinary space, and a real student.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','realteacher','student'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.dss_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;

select set_config('dss.org_a',gen_random_uuid()::text,true); select set_config('dss.org_b',gen_random_uuid()::text,true);
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic demo A','dss-a-'||current_setting('dss.run')),(pg_temp.key('org_b'),'Synthetic real B','dss-b-'||current_setting('dss.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),id,'owner','active',now() from dss_users where label='teacher'
 union all select pg_temp.key('org_b'),id,'owner','active',now() from dss_users where label='realteacher';
insert into private.demo_spaces(organization_id,marked_by) select pg_temp.key('org_a'),(select id from dss_users where label='admin');

-- Space B (never demo): a course and an offering with a join link and an audit row of its own, which Clear of another space must never touch.
select set_config('dss.b_course',gen_random_uuid()::text,true); select set_config('dss.b_off',gen_random_uuid()::text,true);
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) select pg_temp.key('b_course'),pg_temp.key('org_b'),'Real course','real','published','private',id from dss_users where label='realteacher';
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.key('b_off'),pg_temp.key('b_course'),'Real offering','active');
insert into private.student_access_links(offering_id,token_hash,kind,created_by,expires_at) select pg_temp.key('b_off'),encode(sha256(convert_to(pg_temp.token(99),'UTF8')),'hex'),'request',id,now()+interval '3 days' from dss_users where label='realteacher';
insert into private.student_admin_audit(offering_id,actor_id,action,before_data,after_data) select pg_temp.key('b_off'),id,'link','{}','{}' from dss_users where label='realteacher';
select set_config('dss.b_before',pg_temp.traces(pg_temp.key('org_b')),true);

-- 1. Fill: the demo students are in the teacher's roster (the seed is unchanged: no new rows, still seed version 3).
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_a'),(select id from dss_users where label='admin'))->>'sessions')::int=9,'fill creates the nine sessions');
select set_config('dss.a_off',(select o.id::text from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=pg_temp.key('org_a') order by o.id limit 1),true);
select pg_temp.ok((select seed_version=6 from private.demo_spaces where organization_id=pg_temp.key('org_a')),'the seed version is what Fill stored (6): the Students screen did not change it');
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.ok(jsonb_array_length(public.student_administration('roster',pg_temp.key('a_off'),null,null,null,'{"page":0,"search":"","filter":"all"}')->'rows')=25,'the roster lists the demo students (first page of 28)');
select pg_temp.ok(jsonb_array_length(public.student_administration('roster',pg_temp.key('a_off'),null,null,null,'{"page":1,"search":"","filter":"all"}')->'rows')=3,'and the rest on the second page');
select pg_temp.ok((public.student_administration('roster',pg_temp.key('a_off'),null,null,null,'{"page":0,"search":"Demo Student 1","filter":"all"}')->'rows'->0->>'display_name') like 'Demo Student 1%','a demo student is found by name');
reset role;

-- 2. The teacher uses the Students screen in the demo space: an Invite students link, a Suspend and a Reactivate of a demo student, and a Revoke.
select set_config('dss.demo_student',(select e.user_id::text from public.enrollments e join public.profiles p on p.id=e.user_id where e.offering_id=pg_temp.key('a_off') order by p.display_name,e.user_id limit 1),true);
set local role authenticated;
select pg_temp.claim('teacher');
select set_config('dss.link',public.student_administration('link',pg_temp.key('a_off'),null,null,gen_random_uuid(),jsonb_build_object('token',pg_temp.token(1),'kind','request','recipientId',null,'expiresAt',(now()+interval '7 days')::text,'enrollmentExpiresAt',null))->>'id',true);
select public.student_administration('suspend',pg_temp.key('a_off'),pg_temp.key('demo_student'),0,gen_random_uuid(),'{}');
select pg_temp.ok((select status='suspended' from public.enrollments where offering_id=pg_temp.key('a_off') and user_id=pg_temp.key('demo_student')),'a demo student can be suspended');
select public.student_administration('reactivate',pg_temp.key('a_off'),pg_temp.key('demo_student'),1,gen_random_uuid(),'{"expiresAt":null}');
select public.student_administration('revoke-link',pg_temp.key('a_off'),null,null,gen_random_uuid(),jsonb_build_object('linkId',current_setting('dss.link')));
reset role;
select pg_temp.ok(pg_temp.traces(pg_temp.key('org_a'))='1/0/4/28/2','the teacher left one link and four audit rows (link, suspend, reactivate, revoke) in the space');

-- 3. Clear used to refuse this ("student access"). It now finishes, removes those rows, and says so in the audit row.
select set_config('dss.a_result',private.demo_clear_core(pg_temp.key('org_a'),(select id from dss_users where label='admin'))::text,true);
select pg_temp.ok(pg_temp.traces(pg_temp.key('org_a'))='0/0/0/0/0','Clear removes the link, the audit rows, the demo students and the courses');
select pg_temp.ok((select (detail->'removedByTable'->>'student_access_links')::int=1 and (detail->'removedByTable'->>'student_admin_audit')::int=4 and detail->'removedByTable' ? 'enrollment_requests'
 from private.platform_audit where organization_id=pg_temp.key('org_a') and action='demo.clear'),'the platform audit row records how many link and audit rows were removed');
select pg_temp.ok(pg_temp.traces(pg_temp.key('org_b'))=current_setting('dss.b_before'),'another space''s link and audit row are untouched');

-- 4. A real person uses a link of the demo space. The fill again, a link, and the real student asks to join.
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_a'),(select id from dss_users where label='admin'))->>'sessions')::int=9,'the cleared space is filled again');
select set_config('dss.a_off',(select o.id::text from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=pg_temp.key('org_a') order by o.id limit 1),true);
set local role authenticated;
select pg_temp.claim('teacher');
select public.student_administration('link',pg_temp.key('a_off'),null,null,gen_random_uuid(),jsonb_build_object('token',pg_temp.token(2),'kind','request','recipientId',null,'expiresAt',(now()+interval '7 days')::text,'enrollmentExpiresAt',null));
select pg_temp.claim('student');
select public.student_administration('request',null,null,null,gen_random_uuid(),jsonb_build_object('token',pg_temp.token(2)));
reset role;
select pg_temp.ok((select count(*)=1 from public.enrollment_requests where user_id=pg_temp.user('student') and offering_id=pg_temp.key('a_off')),'the real student has a waiting join request');
select set_config('dss.before_refusal',pg_temp.traces(pg_temp.key('org_a')),true);
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_a'),(select id from dss_users where label='admin'))) like '%join requests or invitations from real people%','Clear refuses and names the real person''s join request');
select pg_temp.denied(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_a'),(select id from dss_users where label='admin')),'PT409','the refusal is a conflict');
select pg_temp.ok(pg_temp.traces(pg_temp.key('org_a'))=current_setting('dss.before_refusal') and exists(select 1 from public.enrollment_requests where user_id=pg_temp.user('student')),'a refused Clear removed nothing, not even the teacher''s link');

-- 5. The teacher approves the real student: now there is a real enrollment and an audit row about a real person. Clear names both.
set local role authenticated;
select pg_temp.claim('teacher');
select public.student_administration('approve',pg_temp.key('a_off'),pg_temp.user('student'),0,gen_random_uuid(),'{"expiresAt":null}');
reset role;
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_a'),(select id from dss_users where label='admin'))) like '%enrolled students%','a real enrollment is still refused, as before');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org_a'),(select id from dss_users where label='admin'))) like '%student administration records of real people%','and so is the audit row about the real person');
select pg_temp.ok(exists(select 1 from public.enrollments where user_id=pg_temp.user('student') and offering_id=pg_temp.key('a_off')) and exists(select 1 from private.student_admin_audit where subject_id=pg_temp.user('student')),'the real student''s enrollment and audit row are still there');

-- 6. The function is not callable by API roles.
select pg_temp.ok((select bool_and(not has_function_privilege(r,'private.demo_clear_core(uuid,uuid)','execute')) from unnest(array['anon','authenticated']) r),'API roles cannot call demo_clear_core');

select count(*)||' checks passed' as demo_students_screen_tests from dss_results;
rollback;
