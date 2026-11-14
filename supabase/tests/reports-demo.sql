-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Reports on the demo space: every Group has someone needing attention, one chapter is the weakest, nothing in the demo seed is a real person.
-- Covers the Demo Clear change of migration 20261114120000_exams.sql (owner's answer 13): Clear removes the exams a teacher added in a demo
-- space (with demo students' tries, marks, results, photo rows, windows and release notices) and still refuses, removing nothing, while a
-- real person's work or a stored exam file is there. The demo students cannot sign in, so their tries are written as fixtures.
begin;
create temp table rd_results(name text primary key);
create temp table rd_users(label text primary key,id uuid not null);
create temp table rd_ids(label text primary key,id uuid not null);
grant select,insert,update on rd_results,rd_users,rd_ids to authenticated,anon;
select set_config('rd.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.rd_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;code text;begin
 begin execute statement; exception when others then get stacked diagnostics msg=message_text,code=returned_sqlstate; return code||' '||msg; end;
 raise exception 'FAILED nothing was refused: %',statement; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('rd.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','rd-'||current_setting('rd.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.rd_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.rd_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.rd_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
create function pg_temp.student(n integer) returns uuid language sql security definer set search_path='' as $$
 select p.id from public.profiles p join private.demo_seed_rows d on d.row_id=p.id and d.table_name='profiles' where d.organization_id=pg_temp.key('org') and p.display_name='Demo Student '||n$$;
-- A handed-in try of a demo student, written as the database would (stored paper, marks, result).
create function pg_temp.demo_try(p_exam uuid,p_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;begin
 insert into private.exam_attempts(exam_id,user_id,number,started_at,deadline_at) values(p_exam,p_user,1,now()-interval '20 minutes',now()+interval '1 hour') returning id into a;
 perform private.exam_items(a,p_exam,false);
 insert into private.exam_responses(attempt_id,question_id,option_ids) select a,q.id,k.correct_option_ids from private.exam_questions q join private.exam_keys k on k.question_id=q.id where q.exam_id=p_exam and q.type='single_choice';
 insert into private.exam_uploads(exam_id,uploaded_by,attempt_id,purpose,mime,path,status,size_bytes,sha256) values(p_exam,p_user,a,'answer','image/png',p_exam||'/'||gen_random_uuid()||'/file','ready',100,repeat('d',64));
 perform private.exam_finish(a,false);
 return a;
end$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','real'] loop
  perform pg_temp.claim(label); insert into pg_temp.rd_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from rd_users where label='admin';
select pg_temp.put('org',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo exams','rd-'||current_setting('rd.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion')::int=9,'the demo space fills (seed version 9: five exams)');
select pg_temp.ok((select count(*)=5 from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=pg_temp.key('org')),'the seed adds five exams');
select pg_temp.put('course',(select id from public.courses where organization_id=pg_temp.key('org') and status='published' order by title limit 1));
select pg_temp.put('off',(select o.id from public.course_offerings o where o.course_id=pg_temp.key('course') order by o.id limit 1));

set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((select count(*)=2 and bool_and((public.report_group(g.id,null)->>'attentionTotal')::int>=1) from public.study_groups g join public.course_offerings o on o.id=g.offering_id
  where o.course_id in (select id from public.courses where organization_id=pg_temp.key('org'))),'every demo Group has at least one student needing attention (no seed change is needed)');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(public.report_course((select id from public.courses where organization_id=pg_temp.key('org') and title like '%Physics%'),null)->'chapters') x where x->>'weakest'='true'),
 'the demo Physics course has one weakest chapter');
select pg_temp.ok((select (public.report_course((select id from public.courses where organization_id=pg_temp.key('org') and title like '%Chemistry%'),null)->'chapters')='[]'::jsonb),'a demo course with no run shows an empty Results');
select pg_temp.ok((select (public.report_attention(null,0)->>'total')::int>=10),'the Students list has a Needs attention filter with students in it');
reset role;
select count(*)::integer reports_demo_tests from rd_results;
rollback;
