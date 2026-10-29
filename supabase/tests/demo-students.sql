-- Disposable local PostgreSQL only (same convention as demo-clear-robust.sql). Everything rolls back; synthetic users only. Never run this
-- against a connected database except inside a transaction that is rolled back.
-- Covers migration 20261030120000_demo_students.sql: seed version 2 (14 fake students per demo Group, a finalized and a draft past Session per
-- Group), the guards that count only NON-demo enrollments, Clear removing the demo students and refusing a real one, Clear then Fill for a space
-- filled at seed version 1, and that a fake student has no identity and no way to sign in.
begin;
create temp table dst_results(name text primary key);
create temp table dst_users(label text primary key,id uuid not null);
create temp table dst_ids(label text primary key,id uuid not null);
grant select,insert on dst_results,dst_users,dst_ids to authenticated,anon;
select set_config('dst.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.dst_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.dst_results values(label);end$$;
-- The message of a refusal, so a test can check that it names what blocked.
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;begin
 begin execute statement; exception when others then msg:=sqlerrm; end; return msg; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('dst.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','dst-'||current_setting('dst.run')||'-'||label)::text,true);end$$;
create function pg_temp.id(k text) returns uuid language sql as $$select id from pg_temp.dst_ids where label=k$$;
create function pg_temp.user(k text) returns uuid language sql as $$select id from pg_temp.dst_users where label=k$$;
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
  insert into pg_temp.dst_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from dst_users where label='admin';

-- Spaces: A (demo, accepted teacher), D (an ordinary space that already has a real student), E (demo that later gets a real student),
-- F (demo that ends up looking like one filled at seed version 1).
do $$ declare k text; begin
 foreach k in array array['org_a','org_d','org_e','org_f'] loop insert into pg_temp.dst_ids values(k,gen_random_uuid()); end loop;
end $$;
insert into public.organizations(id,name,slug) select pg_temp.id(k),'Synthetic '||k,'dst-'||replace(k,'_','-')||'-'||current_setting('dst.run') from unnest(array['org_a','org_d','org_e','org_f']) k;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.id('org_a'),id,'owner','active',now() from dst_users where label='teacher'
 union all select pg_temp.id('org_d'),id,'owner','active',now() from dst_users where label='realteacher'
 union all select pg_temp.id('org_e'),id,'owner','active',now() from dst_users where label='teacher2'
 union all select pg_temp.id('org_f'),id,'owner','active',now() from dst_users where label='teacher2';
-- Every portal has an invitation row (the marking function requires one).
insert into private.teacher_invitations(organization_id,email,token_hash,status,expires_at,created_by)
 select pg_temp.id(k),k||'.'||current_setting('dst.run')||'@example.test',sha256(convert_to(k||current_setting('dst.run'),'UTF8')),'pending',now()+interval '7 days',(select id from dst_users where label='admin')
 from unnest(array['org_a','org_d','org_e','org_f']) k;

-- Space D: an ordinary space with a course, an offering and a real, enrolled student.
insert into dst_ids values('d_course',gen_random_uuid()),('d_off',gen_random_uuid());
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) select pg_temp.id('d_course'),pg_temp.id('org_d'),'Real course','real','published','private',id from dst_users where label='realteacher';
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.id('d_off'),pg_temp.id('d_course'),'Real offering','active');
insert into public.enrollments(offering_id,user_id,status) select pg_temp.id('d_off'),id,'active' from dst_users where label='student';
select set_config('dst.d_before',pg_temp.leftover(pg_temp.id('org_d')),true);

-- 1. Marking. As the administrator: space A (no student) can be marked; space D (a real student) cannot.
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_set_demo_space(pg_temp.id('org_a'),true)->>'demo')::boolean,'a space without students can be marked as a demo space');
select pg_temp.ok((public.platform_set_demo_space(pg_temp.id('org_e'),true)->>'demo')::boolean,'space E is marked');
select pg_temp.ok((public.platform_set_demo_space(pg_temp.id('org_f'),true)->>'demo')::boolean,'space F is marked');
select pg_temp.denied(format('select public.platform_set_demo_space(%L,true)',pg_temp.id('org_d')),'PT409','a space with a real student cannot become a demo space');
select pg_temp.ok((public.platform_demo_status(pg_temp.id('org_a'))->>'latestSeedVersion')::int=2,'the status reports seed version 2 as the latest');
reset role;
select pg_temp.ok(not exists(select 1 from private.demo_spaces where organization_id=pg_temp.id('org_d')),'the refused space is not marked');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_d'))=current_setting('dst.d_before'),'the refused space is unchanged');

-- 2. Fill space A: seed version 2.
select set_config('dst.a_fill',private.demo_fill_core(pg_temp.id('org_a'),(select id from dst_users where label='admin'))::text,true);
select pg_temp.ok(current_setting('dst.a_fill')::jsonb=jsonb_build_object('seedVersion',2,'courses',2,'lessons',5,'groups',2,'sessions',9,'students',28),'fill reports seed version 2: 2 courses, 5 lessons, 2 Groups, 9 sessions, 28 students');
select pg_temp.ok((select seed_version=2 from private.demo_spaces where organization_id=pg_temp.id('org_a')),'the space stores seed version 2');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_a'))='2/3/5/1/2/9/0/2/28/28/56/108','fill state: 28 enrollments, 28 memberships, 56 attendance rows, 108 recorded rows');
select pg_temp.ok((select count(*) from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='profiles')=28
 and (select count(*) from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='enrollments')=28
 and (select count(*) from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='group_memberships')=28,'every fake profile, enrollment and Group membership is recorded');
select pg_temp.ok((select count(*) from private.demo_seed_rows r join public.enrollments e on e.id=r.row_id where r.table_name='enrollments' and r.organization_id=pg_temp.id('org_a') and e.source='demo' and e.status='active')=28,'every recorded enrollment is an active demo enrollment');
select pg_temp.ok((select count(*) from private.demo_seed_rows r join public.group_memberships m on m.id=r.row_id where r.table_name='group_memberships' and m.user_id=any(pg_temp.demo_profiles(pg_temp.id('org_a'))) and m.ends_at is null)=28,'every recorded membership is an open membership of a demo student');

-- 3. A fake student is plainly fake, has no identity, no membership of any space and no way to sign in.
select pg_temp.ok((select count(distinct display_name)=28 and bool_and(display_name ~ '^Demo Student [0-9]+$') and bool_and(phone is null and avatar_path is null) from public.profiles where id=any(pg_temp.demo_profiles(pg_temp.id('org_a')))),'28 distinct plain names "Demo Student N", nothing else on the profile');
select pg_temp.ok((select count(*) from public.profiles where display_name like 'Demo Student %')=28,'no other profile is named like a demo student');
select pg_temp.ok(not exists(select 1 from private.external_identities where profile_id=any(pg_temp.demo_profiles(pg_temp.id('org_a')))),'no identity is linked to a demo student, so no token can resolve to one');
select pg_temp.ok(not exists(select 1 from public.organization_memberships where user_id=any(pg_temp.demo_profiles(pg_temp.id('org_a')))),'a demo student belongs to no organization');
select pg_temp.ok(to_regclass('auth.users') is null or not exists(select 1 from auth.users where id=any(pg_temp.demo_profiles(pg_temp.id('org_a')))),'no authentication account exists for a demo student');
select pg_temp.ok(not exists(select 1 from private.platform_admins where user_id=any(pg_temp.demo_profiles(pg_temp.id('org_a')))),'a demo student is not an administrator');

-- 4. Attendance: per Group one finalized past Session (a mix of present and absent) and one draft past Session (some marked, some not).
select pg_temp.ok((select count(*) from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id
 where c.organization_id=pg_temp.id('org_a') and s.starts_at<now() and not s.cancelled)=4,'four past Sessions, two per Group');
select pg_temp.ok((select count(*) from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id
 where c.organization_id=pg_temp.id('org_a') and s.starts_at>now())=5,'the five upcoming Sessions are still there');
select pg_temp.ok((select bool_and(s.ends_at<now() and s.roster_at is not null) from public.group_sessions s join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance' where r.organization_id=pg_temp.id('org_a')),'the past Sessions ended and have a saved list of students');
select pg_temp.ok((select count(*)=2 and bool_and(attended>0 and absent>0 and not_marked=0 and total=14) from (
  select s.id,count(*) total,count(*) filter(where a.status='attended') attended,count(*) filter(where a.status='absent') absent,count(*) filter(where a.status='not_marked') not_marked
  from public.group_sessions s join public.session_attendance a on a.session_id=s.id join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance'
  where r.organization_id=pg_temp.id('org_a') and s.attendance_state='finalized' group by s.id) x),'one finalized past Session per Group: 14 students, a realistic mix, every one marked');
select pg_temp.ok((select count(*)=2 and bool_and(marked=8 and not_marked=6 and total=14 and marked_by_teacher) from (
  select s.id,count(*) total,count(*) filter(where a.status<>'not_marked') marked,count(*) filter(where a.status='not_marked') not_marked,
   bool_and((a.status<>'not_marked')=(a.updated_by is not null)) marked_by_teacher
  from public.group_sessions s join public.session_attendance a on a.session_id=s.id join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance'
  where r.organization_id=pg_temp.id('org_a') and s.attendance_state='draft' group by s.id) x),'one draft past Session per Group: 8 marked, 6 not marked yet');
select pg_temp.ok((select count(*)=2 from public.group_sessions s join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance'
  where r.organization_id=pg_temp.id('org_a') and s.attendance_state='draft' and s.ends_at<now()),'the "Attendance not saved" flag can be tested: the latest finished Session of each Group is a draft');
select pg_temp.ok((select count(distinct a.user_id)=28 from public.session_attendance a join public.group_sessions s on s.id=a.session_id join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance' where r.organization_id=pg_temp.id('org_a')),'every attendance row belongs to a demo student');
select pg_temp.ok((select count(*) from public.group_memberships where group_id in (select row_id from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='study_groups') group by group_id order by 1 limit 1)=14,'14 students per Group');

-- 5. The guards count only real enrollments.
select pg_temp.ok(not private.space_has_real_students(pg_temp.id('org_a')),'a filled demo space is not a space with real students');
select pg_temp.ok(private.space_has_real_students(pg_temp.id('org_d')),'a space with a real student is');
select pg_temp.denied(format('select private.demo_fill_core(%L,%L)',pg_temp.id('org_a'),(select id from dst_users where label='admin')),'PT409','a filled space cannot be filled twice');
-- Space E: a real student is enrolled before the fill. Fill refuses.
insert into dst_ids values('e_course',gen_random_uuid()),('e_off',gen_random_uuid());
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) select pg_temp.id('e_course'),pg_temp.id('org_e'),'Real E','real-e','published','private',id from dst_users where label='teacher2';
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.id('e_off'),pg_temp.id('e_course'),'Real E offering','active');
insert into public.enrollments(offering_id,user_id,status) select pg_temp.id('e_off'),id,'active' from dst_users where label='student';
select pg_temp.ok(pg_temp.refusal(format('select private.demo_fill_core(%L,%L)',pg_temp.id('org_e'),(select id from dst_users where label='admin'))) ilike '%enrolled students%','a space with a real student cannot receive demo data, and the refusal says why');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_e'))='1/0/0/1/0/0/0/0/1/0/0/0','the refused fill created nothing');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.id('org_e'),(select id from dst_users where label='admin'))) ilike '%enrolled students%','a space with a real student cannot be cleared, and the refusal names the blocker');

-- 6. A real student enrolls in a filled demo space: Clear refuses, naming it, and removes nothing. Without it, Clear works.
select set_config('dst.a_before',pg_temp.leftover(pg_temp.id('org_a')),true);
select set_config('dst.a_offering',(select row_id::text from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='course_offerings'),true);
insert into public.enrollments(offering_id,user_id,status) select current_setting('dst.a_offering')::uuid,id,'active' from dst_users where label='student';
select pg_temp.ok(private.space_has_real_students(pg_temp.id('org_a')),'one real enrollment among 28 demo ones is enough to count as real students');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.id('org_a'),(select id from dst_users where label='admin'))) ilike '%enrolled students%','Clear refuses and names the real student');
select pg_temp.denied(format('select private.demo_clear_core(%L,%L)',pg_temp.id('org_a'),(select id from dst_users where label='admin')),'PT409','the refusal is PT409');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_a'))='2/3/5/1/2/9/0/2/29/28/56/108','a refused Clear removed nothing (the real enrollment is still there too)');
select pg_temp.ok(exists(select 1 from public.enrollments e join dst_users u on u.id=e.user_id and u.label='student' where e.offering_id=current_setting('dst.a_offering')::uuid),'the real student is untouched');
delete from public.enrollments e using dst_users u where u.label='student' and u.id=e.user_id and e.offering_id=current_setting('dst.a_offering')::uuid;
-- Content Clear does not remove still refuses (homework would, an exam is enough here), together with the real student.
savepoint blocker;
insert into public.assessments(course_id,title,type) select row_id,'Teacher added quiz','quiz' from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='courses' order by id limit 1;
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.id('org_a'),(select id from dst_users where label='admin'))) ilike '%exams%','other content still refuses, by name');
rollback to savepoint blocker;
insert into dst_results values('content Clear does not remove still refuses, by name');

-- 7. The teacher adds a past Session in a demo Group; Clear removes the demo students and everything, once, and leaves other people alone.
insert into dst_ids values('a_group',(select row_id from private.demo_seed_rows where organization_id=pg_temp.id('org_a') and table_name='study_groups' order by id limit 1));
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
 select pg_temp.id('a_group'),'Teacher added past session',now()-interval '5 days',now()-interval '5 days'+interval '1 hour',now()-interval '5 days',now()-interval '5 days'+interval '1 hour','center','Room',id,id from dst_users where label='teacher';
insert into dst_ids select 'enroll_'||n,e.id from (select e.id,row_number() over(order by e.id) n from public.enrollments e where e.offering_id=current_setting('dst.a_offering')::uuid) e where n<=3;
select set_config('dst.a_profiles',array_to_string(pg_temp.demo_profiles(pg_temp.id('org_a')),','),true);
select set_config('dst.a_result',private.demo_clear_core(pg_temp.id('org_a'),(select id from dst_users where label='admin'))::text,true);
select pg_temp.ok((current_setting('dst.a_result')::jsonb->>'removedRows')::int=109,'removedRows: 108 recorded rows plus the Session the teacher added');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_a'))='0/0/0/0/0/0/0/0/0/0/0/0','Clear leaves nothing (including enrollments, memberships, attendance and the registry)');
select pg_temp.ok(not exists(select 1 from public.profiles where id=any(string_to_array(current_setting('dst.a_profiles'),',')::uuid[])) and not exists(select 1 from public.profiles where display_name like 'Demo Student %'),'every fake profile is gone');
select pg_temp.ok(not exists(select 1 from public.notifications n where n.recipient_id=any(string_to_array(current_setting('dst.a_profiles'),',')::uuid[])),'no notification for a demo student remains');
select pg_temp.ok(not exists(select 1 from private.notification_events e where e.resource_id in (select id from dst_ids where label like 'enroll\_%')),'no notice about a demo enrollment remains');
select pg_temp.ok((select (detail->>'removedRows')::int=109 and (detail->'removedByTable'->>'profiles')::int=28 and (detail->'removedByTable'->>'enrollments')::int=28 and (detail->'removedByTable'->>'group_memberships')::int=28
  from private.platform_audit where organization_id=pg_temp.id('org_a') and action='demo.clear' order by id desc limit 1),'the audit row says what was removed, students included');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_d'))=current_setting('dst.d_before') and exists(select 1 from public.profiles p join dst_users u on u.id=p.id where u.label in ('student','teacher','admin')),'an ordinary space and the real people are untouched');
select pg_temp.ok((select count(*) from public.enrollments e join dst_users u on u.id=e.user_id where u.label='student')=2,'the real student keeps the enrollments in spaces D and E');

-- 8. Fill again (the same slugs are free), then clear again with exactly the recorded rows.
select pg_temp.ok((private.demo_fill_core(pg_temp.id('org_a'),(select id from dst_users where label='admin'))->>'students')::int=28,'a cleared space can be filled again with 28 new demo students');
select pg_temp.ok((select count(distinct id)=28 from public.profiles where display_name like 'Demo Student %') and not exists(select 1 from public.profiles where id=any(string_to_array(current_setting('dst.a_profiles'),',')::uuid[])),'the new fake profiles have new ids');
select pg_temp.ok((private.demo_clear_core(pg_temp.id('org_a'),(select id from dst_users where label='admin'))->>'removedRows')::int=108,'a plain Clear removes exactly the 108 recorded rows');

-- 9. A space filled at seed version 1 works with Clear, then Fill. Space F is filled, then reduced to what version 1 created.
select private.demo_fill_core(pg_temp.id('org_f'),(select id from dst_users where label='admin'));
select set_config('dst.f_profiles',array_to_string(pg_temp.demo_profiles(pg_temp.id('org_f')),','),true);
delete from public.session_attendance where session_id in (select s.id from public.group_sessions s join private.demo_seed_rows r on r.row_id=s.id and r.module='attendance' where r.organization_id=pg_temp.id('org_f'));
delete from public.group_memberships where id in (select row_id from private.demo_seed_rows where organization_id=pg_temp.id('org_f') and table_name='group_memberships');
delete from public.enrollments where id in (select row_id from private.demo_seed_rows where organization_id=pg_temp.id('org_f') and table_name='enrollments');
delete from private.notification_deliveries where notification_id in (select id from public.notifications where recipient_id=any(string_to_array(current_setting('dst.f_profiles'),',')::uuid[]));
delete from public.notifications where recipient_id=any(string_to_array(current_setting('dst.f_profiles'),',')::uuid[]);
delete from public.profiles where id=any(string_to_array(current_setting('dst.f_profiles'),',')::uuid[]);
delete from public.group_sessions where id in (select row_id from private.demo_seed_rows where organization_id=pg_temp.id('org_f') and module='attendance' and table_name='group_sessions');
delete from private.demo_seed_rows where organization_id=pg_temp.id('org_f') and (module in ('students','attendance'));
update private.demo_spaces set seed_version=1 where organization_id=pg_temp.id('org_f');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_f'))='2/3/5/1/2/5/0/2/0/0/0/20','space F now looks like a seed version 1 space: 20 recorded rows, no students, 5 upcoming Sessions');
select pg_temp.ok((private.demo_clear_core(pg_temp.id('org_f'),(select id from dst_users where label='admin'))->>'removedRows')::int=20,'Clear works for a space filled at seed version 1');
select pg_temp.ok((private.demo_fill_core(pg_temp.id('org_f'),(select id from dst_users where label='admin'))->>'seedVersion')::int=2,'Fill then gives it seed version 2');
select pg_temp.ok(pg_temp.leftover(pg_temp.id('org_f'))='2/3/5/1/2/9/0/2/28/28/56/108','and the full version 2 data');

-- 10. Nothing here is callable by API roles.
select pg_temp.ok((select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated']) r
 cross join unnest(array['private.space_has_real_students(uuid)','private.demo_fill_core(uuid,uuid)','private.demo_clear_core(uuid,uuid)']) f),'API roles cannot call the helper, the fill or the clear');

select count(*)||' checks passed' from dst_results;
rollback;
