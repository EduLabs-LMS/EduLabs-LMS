-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Covers the Demo Clear change of migration 20261114120000_exams.sql (owner's answer 13): Clear removes the exams a teacher added in a demo
-- space (with demo students' tries, marks, results, photo rows, windows and release notices) and still refuses, removing nothing, while a
-- real person's work or a stored exam file is there. The demo students cannot sign in, so their tries are written as fixtures.
begin;
create temp table xd_results(name text primary key);
create temp table xd_users(label text primary key,id uuid not null);
create temp table xd_ids(label text primary key,id uuid not null);
grant select,insert,update on xd_results,xd_users,xd_ids to authenticated,anon;
select set_config('xd.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.xd_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;code text;begin
 begin execute statement; exception when others then get stacked diagnostics msg=message_text,code=returned_sqlstate; return code||' '||msg; end;
 raise exception 'FAILED nothing was refused: %',statement; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('xd.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','xd-'||current_setting('xd.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.xd_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.xd_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.xd_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
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
  perform pg_temp.claim(label); insert into pg_temp.xd_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from xd_users where label='admin';
select pg_temp.put('org',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo exams','xd-'||current_setting('xd.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion')::int=7,'the demo space fills (seed version 7: five exams)');
select pg_temp.ok((select count(*)=5 from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=pg_temp.key('org')),'the seed adds five exams');
select pg_temp.put('course',(select id from public.courses where organization_id=pg_temp.key('org') and status='published' order by title limit 1));
select pg_temp.put('off',(select o.id from public.course_offerings o where o.course_id=pg_temp.key('course') order by o.id limit 1));

-- The teacher adds two exams in the demo course: an online one (published, open now) and a paper one, with a clone of the online one.
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.put('oe',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','Demo quiz','timing','same_time',
 'opensAt',to_char(now()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '2 hours','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
 'questions',jsonb_build_array(jsonb_build_object('type','choice','text','2+2?','points',2,'options',jsonb_build_array('3','4'),'correct',jsonb_build_array(1)),
  jsonb_build_object('type','essay','text','Why?','points',3))))->>'id')::uuid);
select public.exam_lifecycle(pg_temp.key('oe'),'publish',1);
select pg_temp.put('pp',(public.exam_save(null,pg_temp.key('off'),null,'{"kind":"paper","title":"Demo paper","maxMarks":10}')->>'id')::uuid);
select public.exam_lifecycle(pg_temp.key('pp'),'publish',1);
select pg_temp.put('clone',(public.exam_lifecycle(pg_temp.key('oe'),'clone',2)->>'id')::uuid);
reset role;
update private.exams set opens_at=now()-interval '1 hour' where id=pg_temp.key('oe');
select pg_temp.put('try1',pg_temp.demo_try(pg_temp.key('oe'),pg_temp.student(1)));
select pg_temp.put('try2',pg_temp.demo_try(pg_temp.key('oe'),pg_temp.student(2)));
select pg_temp.ok((select count(*)=2 and bool_and(status='corrected') from private.exam_results where exam_id=pg_temp.key('oe')),'the demo students'' tries are corrected (an empty essay is 0)');
update private.exams set closes_at=clock_timestamp()-interval '1 second' where id=pg_temp.key('oe');
create function pg_temp.items(p_exam uuid) returns jsonb language sql security definer set search_path='' as $$select jsonb_agg(jsonb_build_object('resultId',id,'revision',revision)) from private.exam_results where exam_id=p_exam$$;
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((public.exam_release_many(pg_temp.key('oe'),pg_temp.items(pg_temp.key('oe')))->>'released')::int=2,'the teacher releases both demo results');
select pg_temp.ok(jsonb_array_length(public.exam_paper_mark(pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.student(3),'mark',7.5),jsonb_build_object('userId',pg_temp.student(4),'absent',true)))->'items')=2,
 'the teacher marks two demo students on paper');
reset role;
select pg_temp.ok((select count(*)=2 from private.notification_events e join private.exam_results r on r.id=e.resource_id where r.exam_id=pg_temp.key('oe') and e.event_type='exam_released'),'two release notices exist');

insert into xd_ids select 'res'||row_number() over(order by id),id from private.exam_results where exam_id=pg_temp.key('oe');
-- Clear refuses, removing nothing, while a real person's try is there.
savepoint real_try;
insert into private.exam_attempts(exam_id,user_id,number,started_at,deadline_at) values(pg_temp.key('oe'),pg_temp.uid('real'),1,now()-interval '1 minute',now()+interval '1 hour');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin')))
 ='PT409 This demo space holds content that Clear does not remove: exams from real people. Remove it first.','Clear refuses an exam try of a real person');
select pg_temp.ok((select count(*)=3 from private.exams where id in (pg_temp.key('oe'),pg_temp.key('pp'),pg_temp.key('clone'))) and exists(select 1 from public.courses where id=pg_temp.key('course')),'and removes nothing');
rollback to savepoint real_try;
savepoint real_mark;
insert into private.exam_results(exam_id,user_id,paper_mark,status,score,max_score) values(pg_temp.key('pp'),pg_temp.uid('real'),5,'corrected',5,10);
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin')))
 ='PT409 This demo space holds content that Clear does not remove: exams from real people. Remove it first.','Clear refuses a paper mark of a real person');
rollback to savepoint real_mark;
savepoint stored_file;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-exams',pg_temp.key('oe')||'/'||gen_random_uuid()||'/file','xd-owner','{"size":10}');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin')))
 ='PT409 This demo space holds content that Clear does not remove: exam files. Remove it first.','Clear refuses while a stored exam file is there (SQL never deletes Storage objects)');
rollback to savepoint stored_file;

-- Otherwise Clear removes the exams with everything else.
select set_config('xd.clear',private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))::text,true);
select pg_temp.ok(not exists(select 1 from private.exams where id in (pg_temp.key('oe'),pg_temp.key('pp'),pg_temp.key('clone'))) and not exists(select 1 from private.exam_attempts where id in (pg_temp.key('try1'),pg_temp.key('try2')))
 and not exists(select 1 from private.exam_uploads u where u.exam_id=pg_temp.key('oe')) and not exists(select 1 from public.courses where organization_id=pg_temp.key('org')),'Clear removes the exams, the tries, the photo rows and the courses');
select pg_temp.ok(not exists(select 1 from private.notification_events e where e.event_type='exam_released' and e.resource_id in (select id from pg_temp.xd_ids where label like 'res%')),'no release notice of a demo result remains');
select pg_temp.ok((select (detail->'removedByTable'->>'exams')::int>20 from private.platform_audit where organization_id=pg_temp.key('org') and action='demo.clear' order by id desc limit 1),'the audit row counts the removed exam rows');
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion')::int=7,'the space fills again');
select pg_temp.ok((private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'removedRows')::int=1567,'a plain Clear still removes exactly the 1567 rows (800 recorded before seed version 7, plus the 767 exam rows)');
select count(*)::integer exams_demo_tests from xd_results;
rollback;
