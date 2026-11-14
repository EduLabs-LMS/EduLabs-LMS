-- Disposable local PostgreSQL only. Synthetic verified-gateway claims; every change rolls back; no real account exists.
-- Covers demo seed version 5 (migration 20261109120000_homework_teacher_rules.sql), as the version 6 fill (20261113120000_homework_correct_demo.sql,
-- which adds "Magnetism review homework", covered in homework-correct.sql) still makes it: the homework of the Physics demo course in every state the
-- teacher board shows, every row recorded under the `homework` module, the teacher reads on that data, no stored file, Clear removing the demo
-- homework (and homework the teacher added), and Clear refusing, removing nothing, when a REAL person's try or a stored file is there.
begin;
create temp table dh_results(name text primary key);
create temp table dh_users(label text primary key,id uuid not null);
create temp table dh_ids(label text primary key,id uuid not null);
grant select,insert on dh_results,dh_users,dh_ids to authenticated,anon;
select set_config('dh.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.dh_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;code text;begin
 begin execute statement; exception when others then get stacked diagnostics msg=message_text,code=returned_sqlstate; return code||' '||msg; end;
 raise exception 'FAILED nothing was refused: %',statement; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('dh.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','dh-'||current_setting('dh.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.dh_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.dh_ids where label=k$$;
create function pg_temp.hw(p_title text) returns uuid language sql as $$
 select a.id from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=pg_temp.key('org') and a.title=p_title$$;
-- Every homework row of the space, by table, as one string.
create function pg_temp.homework_rows(org uuid) returns text language sql security definer set search_path='' as $$
 with h as (select a.id from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=org),
 s as (select id from public.homework_submissions where assignment_id in (select id from h)), q as (select id from public.homework_questions where assignment_id in (select id from h))
 select (select count(*) from h)||'/'||(select count(*) from q)||'/'||(select count(*) from public.homework_options where question_id in (select id from q))||'/'||
  (select count(*) from private.homework_keys where question_id in (select id from q))||'/'||(select count(*) from private.homework_solutions where assignment_id in (select id from h))||'/'||
  (select count(*) from s)||'/'||(select count(*) from public.homework_responses where submission_id in (select id from s))||'/'||
  (select count(*) from private.homework_marks where submission_id in (select id from s))||'/'||(select count(*) from private.homework_corrections where submission_id in (select id from s))||'/'||
  (select count(*) from private.homework_uploads where assignment_id in (select id from h))||'/'||(select count(*) from public.homework_submission_files where submission_id in (select id from s))||'/'||
  (select count(*) from private.homework_carried where submission_id in (select id from s))
$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','real'] loop
  perform pg_temp.claim(label); insert into pg_temp.dh_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from dh_users where label='admin';
insert into dh_ids values('org',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo','dh-'||current_setting('dh.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));

-- 1. Fill: seed version 8 (the version 5 homework, plus the version 6 one).
select pg_temp.ok(private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))=jsonb_build_object('seedVersion',9,'courses',2,'lessons',6,'groups',2,'sessions',10,'students',28,'homework',5,'exams',5),'fill reports seed version 9 and five homework');
select pg_temp.ok((select seed_version=9 from private.demo_spaces where organization_id=pg_temp.key('org')),'the space stores seed version 9');
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_demo_status(pg_temp.key('org'))->>'latestSeedVersion')::int=9,'the status reports seed version 9 as the latest');
reset role;
insert into dh_ids select 'course',id from public.courses where organization_id=pg_temp.key('org') and status='published';
insert into dh_ids select 'off',o.id from public.course_offerings o where o.course_id=pg_temp.key('course');
select pg_temp.ok((select count(*)=5 and bool_and(a.course_id=pg_temp.key('course') and a.offering_id=pg_temp.key('off') and a.workflow='questions' and a.mode='PLATFORM_QUESTIONS' and a.version=1)
 from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=pg_temp.key('org')),'all five homework are questions-only homework of the published Physics course, for its whole offering');
select pg_temp.ok((select array_agg(a.title||'|'||a.status||'|'||a.tries_mode||'|'||a.max_tries||'|'||a.late_allowed||'|'||a.solutions_open||'|'||
  case when a.deadline_at>now() then 'future' else 'past' end order by a.title)
 =array['Kirchhoff''s laws practice|draft|from_zero|3|false|after_deadline|future','Magnetic field of a wire|published|from_zero|2|false|after_deadline|past',
  'Magnetism review homework|published|one_time|1|true|after_hand_in|past',
  'Ohm''s law: practice set|published|fix_mistakes|2|true|after_deadline|future','Ohm''s law: textbook page 34|published|one_time|1|true|after_hand_in|past']
 from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=pg_temp.key('org')),'a draft, an open one, two closed one-time ones and a closed from-zero one');
select pg_temp.ok((select bool_and(extract(hour from deadline_at at time zone 'Africa/Cairo')=20 and extract(minute from deadline_at at time zone 'Africa/Cairo')=0) from public.homework_assignments where id in
 (pg_temp.hw('Kirchhoff''s laws practice'),pg_temp.hw('Ohm''s law: practice set'),pg_temp.hw('Ohm''s law: textbook page 34'),pg_temp.hw('Magnetic field of a wire'))),'every demo deadline is 20:00 Cairo time');
select pg_temp.ok((select count(*)=5 and bool_and(q.type='single_choice' and (select count(*) from public.homework_options o where o.question_id=q.id and o.text='')=4)
 from public.homework_questions q join public.homework_assignments a on a.id=q.assignment_id join public.courses c on c.id=a.course_id where c.organization_id=pg_temp.key('org') and q.position=0 and q.text=''),
 'each homework starts with a textbook question: blank A to D, one right');
-- The states per homework: tries, waiting, corrected, released, late, carried answers.
create function pg_temp.states(p_hw uuid) returns text language sql security definer set search_path='' as $$
 select (select count(*) from public.homework_submissions where assignment_id=p_hw and status='submitted')||' handed in/'||
  (select count(*) from public.homework_submissions where assignment_id=p_hw and status='draft')||' draft/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.status='under_correction')||' waiting/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.status='corrected' and c.released_at is null)||' corrected/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.released_at is not null)||' released/'||
  (select count(*) from public.homework_submissions where assignment_id=p_hw and missed_deadline)||' late/'||
  (select count(*) from public.homework_submissions where assignment_id=p_hw and number=2)||' second tries/'||
  (select count(*) from private.homework_carried c join public.homework_submissions s on s.id=c.submission_id where s.assignment_id=p_hw)||' kept/'||
  (select count(*) from private.homework_uploads where assignment_id=p_hw and purpose='submission' and status='ready')||' photos'
$$;
select pg_temp.ok(pg_temp.states(pg_temp.hw('Kirchhoff''s laws practice'))='0 handed in/0 draft/0 waiting/0 corrected/0 released/0 late/0 second tries/0 kept/0 photos','the draft has no work');
select pg_temp.ok(pg_temp.states(pg_temp.hw('Ohm''s law: practice set'))='11 handed in/1 draft/6 waiting/4 corrected/1 released/0 late/2 second tries/1 kept/0 photos',
 'the open one: 10 students handed in, one started try 2 with a kept answer, one handed in try 2');
select pg_temp.ok(pg_temp.states(pg_temp.hw('Ohm''s law: textbook page 34'))='26 handed in/0 draft/9 waiting/12 corrected/5 released/2 late/0 second tries/0 kept/0 photos',
 'the closed one-time one: 26 of 28 handed in, 2 late, waiting, corrected and released');
select pg_temp.ok(pg_temp.states(pg_temp.hw('Magnetic field of a wire'))='20 handed in/0 draft/0 waiting/0 corrected/20 released/0 late/0 second tries/0 kept/20 photos','the closed from-zero one: 20 released, each with a photo');
select pg_temp.ok((select bool_and(s.submitted_at>a.deadline_at)=true from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where s.missed_deadline)
 and (select bool_and(s.submitted_at<=a.deadline_at) from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where a.id=pg_temp.hw('Magnetic field of a wire')),
 'a late try is handed in after the deadline, every other one before it');
select pg_temp.ok((select bool_and(s.user_id in (select row_id from private.demo_seed_rows where organization_id=pg_temp.key('org') and table_name='profiles'))
 from public.homework_submissions s where s.assignment_id in (select id from public.homework_assignments where course_id=pg_temp.key('course'))),'every try belongs to a demo student');
select pg_temp.ok((select count(*)=1 from private.homework_carried c join public.homework_responses r on r.submission_id=c.submission_id and r.question_id=c.question_id
  join public.homework_responses o on o.submission_id=c.source_submission_id and o.question_id=c.question_id join private.homework_keys k on k.question_id=c.question_id
  where r.response=o.response and (r.response->'optionIds'->>0)::uuid=any(k.correct_ids)),'the kept answer is the right answer of the released try 1');
-- No real file: the photos are upload rows (1 to 2 MB) with no storage object (20 from version 5, 3 from version 6).
select pg_temp.ok((select count(*)=23 and bool_and(size_bytes between 1000000 and 2000000 and mime='image/jpeg' and path like assignment_id::text||'/%') from private.homework_uploads u
 where u.assignment_id in (select id from public.homework_assignments where course_id=pg_temp.key('course'))),'the 23 photos are 1 to 2 MB image rows');
select pg_temp.ok(not exists(select 1 from storage.objects o where o.bucket_id='lms-homework' and split_part(o.name,'/',1) in (select id::text from public.homework_assignments where course_id=pg_temp.key('course'))),'no file is stored for demo homework');

-- 2. Every homework row is recorded under the homework module, and nothing else is.
create function pg_temp.untracked(org uuid) returns bigint language sql security definer set search_path='' as $$
 with r as (select table_name,row_id from private.demo_seed_rows where organization_id=org and module='homework'),
 h as (select a.id from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=org),
 s as (select id from public.homework_submissions where assignment_id in (select id from h)), q as (select id from public.homework_questions where assignment_id in (select id from h))
 select (select count(*) from h where id not in (select row_id from r where table_name='homework_assignments'))
  +(select count(*) from q where id not in (select row_id from r where table_name='homework_questions'))
  +(select count(*) from public.homework_options where question_id in (select id from q) and id not in (select row_id from r where table_name='homework_options'))
  +(select count(*) from private.homework_keys where question_id in (select id from q) and question_id not in (select row_id from r where table_name='homework_keys'))
  +(select count(*) from private.homework_solutions where assignment_id in (select id from h) and assignment_id not in (select row_id from r where table_name='homework_solutions'))
  +(select count(*) from s where id not in (select row_id from r where table_name='homework_submissions'))
  +(select count(*) from public.homework_responses where submission_id in (select id from s) and id not in (select row_id from r where table_name='homework_responses'))
  +(select count(*) from private.homework_marks where submission_id in (select id from s) and id not in (select row_id from r where table_name='homework_marks'))
  +(select count(*) from private.homework_corrections where submission_id in (select id from s) and submission_id not in (select row_id from r where table_name='homework_corrections'))
  +(select count(*) from private.homework_uploads where assignment_id in (select id from h) and id not in (select row_id from r where table_name='homework_uploads'))
  +(select count(*) from public.homework_submission_files where submission_id in (select id from s) and id not in (select row_id from r where table_name='homework_submission_files'))
$$;
select pg_temp.ok(pg_temp.untracked(pg_temp.key('org'))=0,'every homework row of the space is recorded');
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org'))='5/15/35/15/5/72/214/213/71/23/23/1','the homework rows: 5 homework, 15 questions, 35 options, 15 keys, 5 solutions, 72 tries, 214 answers, 213 marks, 71 corrections, 23 photos');
select pg_temp.ok((select count(*)=691 from private.demo_seed_rows where organization_id=pg_temp.key('org') and module='homework')
 and not exists(select 1 from private.demo_seed_rows where organization_id=pg_temp.key('org') and module<>'homework' and table_name like 'homework%'),'691 recorded homework rows, all under the homework module');

-- 3. The demo teacher reads it with the new reads.
set local role authenticated; select pg_temp.claim('teacher');
select set_config('dh.portal',public.homework_portal(pg_temp.key('course'),'closed',0)::text,true);
select pg_temp.ok(current_setting('dh.portal')::jsonb->'counts'=jsonb_build_object('open',1,'closed',3,'drafts',1),'the board: 1 open, 3 closed, 1 draft');
select pg_temp.ok((select array_agg((e->>'title')||'|'||(e->>'handedIn')||'/'||(e->>'total')||'|'||(e->>'late')||'|'||(e->>'waiting')||'|'||(e->>'imageBytes'>'0')) from jsonb_array_elements(current_setting('dh.portal')::jsonb->'rows') e)
 =array['Magnetism review homework|14/28|2|7|true','Ohm''s law: textbook page 34|26/28|2|9|false','Magnetic field of a wire|20/28|0|0|true'],'Closed lists all three, newest deadline first, with bytes only where photos are');
select pg_temp.ok((public.homework_portal(pg_temp.key('course'),'open',0)->'rows'->0->>'waiting')::int=6 and (public.homework_portal(pg_temp.key('course'),'drafts',0)->'rows'->0->>'title')='Kirchhoff''s laws practice','Open and Drafts list theirs');
select pg_temp.ok(jsonb_array_length(public.homework_portal(null,'open',0)->'toCorrect')=3 and (public.homework_portal(null,'open',0)->'stats'->>'essaysWaiting')::int=22,'To correct lists the three homework with essays waiting: 22 essays in all');
select pg_temp.ok(public.homework_queue(pg_temp.hw('Ohm''s law: textbook page 34'))->'counts'=jsonb_build_object('toCorrect',9,'done',17,'missing',2,'handedIn',26,'total',28,'late',2),'the closed homework queue: 9 to correct, 17 done, 2 missing, 2 late');
select pg_temp.ok(public.homework_queue(pg_temp.hw('Ohm''s law: practice set'))->'counts'=jsonb_build_object('toCorrect',6,'done',4,'missing',18,'handedIn',10,'total',28,'late',0),'the open homework queue counts the latest try of each student');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(public.homework_queue(pg_temp.hw('Ohm''s law: practice set'),'to_correct',0)->'rows') e where (e->>'try')::int=2),'one student is on try 2 in To correct');
reset role;
select pg_temp.ok((select (e->>'imageBytes')::bigint from jsonb_array_elements(current_setting('dh.portal')::jsonb->'rows') e where e->>'title'='Magnetic field of a wire')
 =(select sum(size_bytes) from private.homework_uploads where assignment_id=pg_temp.hw('Magnetic field of a wire')),'the closed homework shows exactly the bytes of its photos');
-- Delete images works on demo data (no storage object to remove: the server gets paths that do not exist and skips them).
set local role authenticated; select pg_temp.claim('teacher');
savepoint del;
select pg_temp.ok((public.homework_delete_images(pg_temp.hw('Magnetic field of a wire'))->>'deletedFiles')::int=20,'Delete images can be tried on the demo homework');
rollback to savepoint del;
reset role;

-- 4. Clear refuses, removing nothing, while a REAL person's try is there (the real person is not enrolled, so this is the only blocker).
select set_config('dh.before',pg_temp.homework_rows(pg_temp.key('org')),true);
savepoint real_try;
insert into public.homework_submissions(assignment_id,user_id,number,status) values(pg_temp.hw('Ohm''s law: practice set'),pg_temp.uid('real'),1,'draft');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin')))
 ='PT409 This demo space holds content that Clear does not remove: homework from real people. Remove it first.','Clear refuses homework from real people, by name');
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org'))=regexp_replace(current_setting('dh.before'),'^(\d+/\d+/\d+/\d+/\d+/)(\d+)','\1'||'73'),'and removes nothing (the 72 tries and the real one are there)');
rollback to savepoint real_try;
-- A stored file under a demo homework (SQL never deletes storage objects) also refuses.
savepoint real_file;
insert into storage.objects(bucket_id,name,owner_id) values('lms-homework',pg_temp.hw('Ohm''s law: practice set')::text||'/'||gen_random_uuid()::text||'/resource.jpg',pg_temp.uid('teacher')::text);
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin'))) like 'PT409 %homework files%','Clear refuses while a homework file is stored, by name');
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org'))=current_setting('dh.before'),'and removes nothing');
rollback to savepoint real_file;
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org'))=current_setting('dh.before'),'after both refusals the demo homework is all there');

-- 5. The teacher adds a homework of their own (no file); Clear removes it with the demo homework and reports the count.
set local role authenticated; select pg_temp.claim('teacher');
insert into dh_ids values('q_own',gen_random_uuid());
select pg_temp.ok(public.save_homework(null,pg_temp.key('off'),(select l.id from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=pg_temp.key('course') and l.title='Ohm''s law'),null,null,
 jsonb_build_object('title','Teacher added homework','instructions','','mode','PLATFORM_QUESTIONS','published',false,'usesMarks',true,'filePoints',10,'modelAnswer','','solutionVideo','','solutionVideoId',null,
  'referenceIds','[]'::jsonb,'solutionIds','[]'::jsonb,'questions',jsonb_build_array(jsonb_build_object('id',pg_temp.key('q_own'),'type','essay','text','Explain Ohm''s law','imageId',null,'points',4,
   'responseMode','both','modelAnswer','','options','[]'::jsonb,'correctIds','[]'::jsonb)))) is not null,'the demo teacher adds a homework');
reset role;
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org')) like '6/16/%','the space now has 6 homework');
select set_config('dh.clear',private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))::text,true);
select pg_temp.ok(pg_temp.homework_rows(pg_temp.key('org'))='0/0/0/0/0/0/0/0/0/0/0/0','Clear removes all homework of the space, the teacher''s included');
select pg_temp.ok(not exists(select 1 from public.courses where organization_id=pg_temp.key('org')) and not exists(select 1 from private.demo_seed_rows where organization_id=pg_temp.key('org')),'and everything else of the space');
select pg_temp.ok((select (detail->'removedByTable'->>'homework')::int from private.platform_audit where organization_id=pg_temp.key('org') and action='demo.clear' order by id desc limit 1)=695,
 'the audit row counts 695 homework rows: 691 recorded, plus the teacher''s homework, its question, its key and its solution row');
select pg_temp.ok(not exists(select 1 from public.notifications n where n.recipient_id in (select id from public.profiles where display_name like 'Demo Student %')),'no notification of a released demo try remains');
select pg_temp.ok(exists(select 1 from public.profiles where id=pg_temp.uid('real')),'the real person is untouched');

-- 6. Fill again, then a plain Clear removes exactly the recorded rows.
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'homework')::int=5,'the space fills again with five homework');
select pg_temp.ok((private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'removedRows')::int=1568,'a plain Clear removes exactly the 1568 rows (800 recorded before seed version 7, plus the 767 exam rows and the seed version 9 Session)');

-- 7. The seed helpers are not callable by anyone else.
select pg_temp.ok((select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.demo_homework_make(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,boolean,text,integer,text)','private.demo_homework_try(uuid,uuid,uuid[],uuid,integer,timestamptz,boolean,text,integer,boolean)']) f),'the seed helpers are not callable from outside');
select count(*)::integer demo_homework_tests from dh_results;
rollback;
