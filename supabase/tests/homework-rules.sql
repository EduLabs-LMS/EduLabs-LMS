-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures. Every change rolls back; no real account exists.
-- Covers migration 20261109120000_homework_teacher_rules.sql: questions only, the deadline, tries, the solutions rule (also through Storage), assistant rights,
-- Delete images, storage counts, the portal and the correcting queue, rescheduling and bulk release. EVERY identity is a Firebase identity (a non-UUID subject, created by
-- onboard_firebase_profile), so a call that cast the subject to uuid (auth.uid()) would fail every check. Real races on separate connections are in
-- scripts/homework-rules-concurrency.cjs; the reads against a naive query on a few hundred rows are in homework-reads.sql.
begin;
create temp table hr_results(name text primary key);
create temp table hr_users(label text primary key,id uuid not null);
create temp table hr_q(label text,k text,id uuid not null,primary key(label,k));
create temp table hr_hw(label text primary key,id uuid not null);
grant select,insert on hr_results,hr_users,hr_q,hr_hw to authenticated,anon;
select set_config('hr.run',gen_random_uuid()::text,true);
select set_config('hr.'||k,gen_random_uuid()::text,true) from unnest(array['org_a','org_b','course','course_b','off','off_b','ch','lesson','ch_b','lesson_b']) k;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.hr_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.hr_results values(label);end$$;
-- The refusal as {code, message, reason}.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('hr.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','hr-'||current_setting('hr.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('hr.'||k)::uuid$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.hr_users where label=k$$;
create function pg_temp.q(p_label text,p_k text) returns uuid language sql as $$select id from pg_temp.hr_q where label=p_label and k=p_k$$;
create function pg_temp.h(p_label text) returns uuid language sql as $$select id from pg_temp.hr_hw where label=p_label$$;
-- Three questions: q1 a textbook question (blank A to D, B is right, 2 points), q2 an essay (6 points), q3 a choice (x is right, 2 points).
create function pg_temp.def(p_label text,p_published boolean,p_rules jsonb,p_essay text default 'both') returns jsonb language plpgsql set search_path='' as $$
declare k text;begin
 foreach k in array array['q1','A','B','C','D','q2','q3','x','y'] loop insert into pg_temp.hr_q values(p_label,k,gen_random_uuid()) on conflict do nothing; end loop;
 return jsonb_build_object('title','Synthetic '||p_label,'instructions','','mode','PLATFORM_QUESTIONS','published',p_published,'usesMarks',true,'filePoints',10,'modelAnswer','Private worked answer',
  'solutionVideo','','solutionVideoId',null,'referenceIds','[]'::jsonb,'solutionIds','[]'::jsonb,
  'questions',jsonb_build_array(
   jsonb_build_object('id',pg_temp.q(p_label,'q1'),'type','single_choice','text','','imageId',null,'points',2,'responseMode','text','modelAnswer','',
    'options',jsonb_build_array(jsonb_build_object('id',pg_temp.q(p_label,'A'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'B'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'C'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'D'),'text','')),
    'correctIds',jsonb_build_array(pg_temp.q(p_label,'B'))),
   jsonb_build_object('id',pg_temp.q(p_label,'q2'),'type','essay','text','Explain','imageId',null,'points',6,'responseMode',p_essay,'modelAnswer','Model','options','[]'::jsonb,'correctIds','[]'::jsonb),
   jsonb_build_object('id',pg_temp.q(p_label,'q3'),'type','single_choice','text','Pick','imageId',null,'points',2,'responseMode','text','modelAnswer','',
    'options',jsonb_build_array(jsonb_build_object('id',pg_temp.q(p_label,'x'),'text','Yes'),jsonb_build_object('id',pg_temp.q(p_label,'y'),'text','No')),'correctIds',jsonb_build_array(pg_temp.q(p_label,'x')))))
  ||case when p_rules is null then '{}'::jsonb else jsonb_build_object('rules',p_rules) end;
end$$;
create function pg_temp.at(i interval) returns text language sql as $$select to_jsonb(clock_timestamp()+i)#>>'{}'$$;
-- New homework, created by the caller through save_homework (no id).
create function pg_temp.make(p_label text,p_rules jsonb,p_published boolean default true,p_essay text default 'both') returns uuid language plpgsql set search_path='' as $$
declare i uuid;begin
 i:=public.save_homework(null,pg_temp.key('off'),pg_temp.key('lesson'),null,null,pg_temp.def(p_label,p_published,p_rules,p_essay));
 insert into pg_temp.hr_hw values(p_label,i); return i; end$$;
create function pg_temp.ans(p_label text,c1 text,essay text,c3 text,photos jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('fileIds','[]'::jsonb,'answers',jsonb_build_array(
  jsonb_build_object('questionId',pg_temp.q(p_label,'q1'),'optionIds',case when c1 is null then '[]'::jsonb else jsonb_build_array(pg_temp.q(p_label,c1)) end,'text','','fileIds','[]'::jsonb),
  jsonb_build_object('questionId',pg_temp.q(p_label,'q2'),'optionIds','[]'::jsonb,'text',coalesce(essay,''),'fileIds',photos),
  jsonb_build_object('questionId',pg_temp.q(p_label,'q3'),'optionIds',case when c3 is null then '[]'::jsonb else jsonb_build_array(pg_temp.q(p_label,c3)) end,'text','','fileIds','[]'::jsonb)))$$;
-- Read as the database owner, so a check can see what the signed-in person may not.
create function pg_temp.rev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_submissions where id=s$$;
create function pg_temp.crev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.homework_corrections where submission_id=s$$;
create function pg_temp.sub(s uuid) returns public.homework_submissions language sql security definer set search_path='' as $$select x from public.homework_submissions x where x.id=s$$;
create function pg_temp.corr(s uuid) returns private.homework_corrections language sql security definer set search_path='' as $$select x from private.homework_corrections x where x.submission_id=s$$;
create function pg_temp.hwrow(i uuid) returns public.homework_assignments language sql security definer set search_path='' as $$select x from public.homework_assignments x where x.id=i$$;
create function pg_temp.set_deadline(p_label text,i interval) returns void language sql security definer set search_path='' as $$
 update public.homework_assignments set deadline_at=clock_timestamp()+i where id=pg_temp.h(p_label)$$;
-- A ready photo of a student's try (no real file), and a solution file of a homework, both as the database owner.
create function pg_temp.photo(p_label text,s uuid,who text,bytes bigint default 1500000,mime text default 'image/jpeg') returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();begin
 insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path,status,size_bytes,sha256,pages)
  values(i,pg_temp.h(p_label),pg_temp.uid(who),s,'submission','photo.jpg',mime,pg_temp.h(p_label)::text||'/'||i::text||'/resource.jpg','ready',bytes,repeat('c',64),1);
 return i; end$$;
create function pg_temp.solution_file(p_label text) returns text language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();begin
 insert into private.homework_uploads(id,assignment_id,uploaded_by,purpose,name,mime,path,status,size_bytes,sha256,pages)
  values(i,pg_temp.h(p_label),pg_temp.uid('owner'),'solution','solution.pdf','application/pdf',pg_temp.h(p_label)::text||'/'||i::text||'/resource.pdf','ready',2048,repeat('d',64),1);
 insert into private.homework_materials(assignment_id,upload_id,purpose) values(pg_temp.h(p_label),i,'solution');
 return pg_temp.h(p_label)::text||'/'||i::text||'/resource.pdf'; end$$;
create function pg_temp.upload_status(p text) returns text language sql security definer set search_path='' as $$select status from private.homework_uploads where path=p$$;
create function pg_temp.start(p_label text) returns uuid language sql as $$select (public.homework_work(pg_temp.h(p_label),'start')->>'id')::uuid$$;
create function pg_temp.save(p_label text,s uuid,a jsonb) returns jsonb language sql as $$select public.homework_work(pg_temp.h(p_label),'save',s,pg_temp.rev(s),a)$$;
create function pg_temp.submit(p_label text,s uuid) returns jsonb language sql as $$select public.homework_work(pg_temp.h(p_label),'submit',s,pg_temp.rev(s))$$;
create function pg_temp.hand(p_label text,a jsonb) returns uuid language plpgsql set search_path='' as $$declare s uuid;begin
 s:=pg_temp.start(p_label);perform pg_temp.save(p_label,s,a);perform pg_temp.submit(p_label,s);return s;end$$;
create function pg_temp.retry(p_label text,s uuid) returns uuid language sql as $$select (public.homework_work(pg_temp.h(p_label),'retry',s)->>'id')::uuid$$;
create function pg_temp.grade(p_label text,s uuid,points numeric) returns jsonb language sql as $$
 select public.homework_work(pg_temp.h(p_label),'grade',s,pg_temp.crev(s),jsonb_build_object('marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(p_label,'q2'),'points',points,'feedback','Checked')),'feedback','Checked'))$$;
create function pg_temp.release(p_label text,s uuid) returns jsonb language sql as $$select public.homework_work(pg_temp.h(p_label),'release',s,pg_temp.crev(s),'{"status":"approved"}')$$;
create function pg_temp.solutions(p_label text) returns jsonb language sql as $$select public.get_homework(pg_temp.h(p_label))->'solutions'$$;

-- Everyone signs in with Firebase first, so each has a profile.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','instructor','ta1','ta2','editor','s1','s2','s3','s4','s5','outsider','sb'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.hr_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic homework A','hr-a-'||current_setting('hr.run')),(pg_temp.key('org_b'),'Synthetic homework B','hr-b-'||current_setting('hr.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('instructor','teacher'),('ta1','assistant'),('ta2','assistant'),('editor','teacher')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org_a'),'Synthetic Physics','hr-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','hr-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('course'),pg_temp.uid('instructor'),'instructor'),(pg_temp.key('course'),pg_temp.uid('editor'),'editor');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('ta1'),'teaching_assistant'),(pg_temp.key('off'),pg_temp.uid('ta2'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off'),pg_temp.uid(l),'active',now()-interval '1 day' from unnest(array['s1','s2','s3','s4','s5']) l;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '1 day');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('ch'),pg_temp.key('course'),'Electric current',0),(pg_temp.key('ch_b'),pg_temp.key('course_b'),'Foreign chapter',0);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('lesson'),pg_temp.key('ch'),'Ohm',0,'published'),(pg_temp.key('lesson_b'),pg_temp.key('ch_b'),'Foreign lesson',0,'published');

-- ---------------------------------------------------------------- 1. New homework is questions only
set local role authenticated;
select pg_temp.claim('instructor');
select pg_temp.make('draft',null,false);
select pg_temp.ok((select workflow='questions' and mode='PLATFORM_QUESTIONS' and tries_mode='one_time' and max_tries=1 and solutions_open='after_hand_in' and photos_allowed and deadline_at is null and status='draft' from pg_temp.hwrow(pg_temp.h('draft'))),
 'new homework is created questions only, one time, solutions after hand-in, photos on, no deadline yet');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,null)||'{"mode":"FILE_UPLOAD","questions":[]}')$s$,'23514','new homework refuses File Upload');
select pg_temp.denied($s$select public.save_homework(null,pg_temp.key('off'),pg_temp.key('lesson'),null,null,pg_temp.def('fu',false,null)||'{"mode":"FILE_UPLOAD","questions":[]}')$s$,'23514','creating File Upload homework is refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',true,null))$s$,'23514','publishing without a deadline is refused');
select pg_temp.denied($s$select public.homework_lifecycle(pg_temp.h('draft'),'publish',1)$s$,'23514','the publish action also needs a deadline');
select pg_temp.ok(pg_temp.refusal($s$select public.homework_lifecycle(pg_temp.h('draft'),'publish',1)$s$)->>'message'='Set a deadline before publishing','the refusal says to set a deadline');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"deadline":"2030-01-01T10:00"}'))$s$,'23514','a deadline without an offset is refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"deadline":"2030-02-31T10:00:00Z"}'))$s$,'23514','an impossible date is refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"tries":"fix_mistakes","maxTries":1}'))$s$,'23514','fix mistakes needs two tries or more');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"tries":"from_zero","maxTries":11}'))$s$,'23514','at most ten tries');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"color":"red"}'))$s$,'23514','an unknown rule is refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,'{"photosAllowed":false}'))$s$,'23514','photos off refuses an essay that takes a photo');
select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,1,pg_temp.def('draft',false,('{"photosAllowed":false,"tries":"fix_mistakes","deadline":"'||pg_temp.at('2 days')||'"}')::jsonb,'text'));
select pg_temp.ok((select not photos_allowed and tries_mode='fix_mistakes' and max_tries=2 and deadline_at>now() from pg_temp.hwrow(pg_temp.h('draft'))),'photos off with text essays saves; fix mistakes defaults to two tries');
-- Changed by 20261112120000 (the owner's review): blank answers may be any number from 2 to 8, so three blank letters now save.
select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,2,
 jsonb_set(pg_temp.def('draft',false,null,'text'),'{questions,0,options}',(pg_temp.def('draft',false,null,'text')->'questions'->0->'options')-3));
select pg_temp.ok((select count(*)=3 from public.homework_options o join public.homework_questions q on q.id=o.question_id where q.id=pg_temp.q('draft','q1')),'a question with three blank answers saves');
-- The read gives the rules inside the definition, so the screen can save it back unchanged.
select public.save_homework(pg_temp.h('draft'),pg_temp.key('off'),pg_temp.key('lesson'),null,3,public.get_homework(pg_temp.h('draft'))->'definition');
select pg_temp.ok((select revision=4 and tries_mode='fix_mistakes' and not photos_allowed from pg_temp.hwrow(pg_temp.h('draft'))),'the definition read back saves unchanged, rules included');
select pg_temp.ok((public.get_homework(pg_temp.h('draft'))->'rules'->>'tries')='fix_mistakes' and (public.get_homework(pg_temp.h('draft'))->>'workflow')='questions','the read reports the workflow and the rules');
reset role;
select pg_temp.denied($s$update public.homework_assignments set workflow='legacy',deadline_at=null,tries_mode=null,max_tries=null,solutions_open=null,photos_allowed=true where id=pg_temp.h('draft')$s$,'23514','even the database owner cannot change a workflow');
select pg_temp.ok(not exists(select 1 from public.homework_assignments where workflow<>'legacy' and id not in (select id from pg_temp.hr_hw)),'every homework that existed before is legacy');
set local role authenticated;

-- ---------------------------------------------------------------- 2. Deadline
select pg_temp.claim('instructor');
select pg_temp.make('dl',('{"deadline":"'||pg_temp.at('1 hour')||'"}')::jsonb);
select pg_temp.claim('s1');
select set_config('hr.dl_s1',pg_temp.hand('dl',pg_temp.ans('dl','B','On time','x'))::text,true);
select pg_temp.ok(not (pg_temp.sub(current_setting('hr.dl_s1')::uuid)).missed_deadline,'a hand-in before the deadline is on time');
select pg_temp.claim('s3');
select set_config('hr.dl_s3',pg_temp.start('dl')::text,true);
select pg_temp.set_deadline('dl','-1 second');
select pg_temp.claim('s2');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.start('dl')$s$)=jsonb_build_object('code','PT409','message','Deadline passed','reason','deadline_passed'),'after the deadline a first start is refused with "Deadline passed"');
select pg_temp.claim('s3');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.save('dl',current_setting('hr.dl_s3')::uuid,pg_temp.ans('dl','B','Late','x'))$s$)->>'reason'='deadline_passed','a draft started in time cannot be saved after the deadline when late is not allowed');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.submit('dl',current_setting('hr.dl_s3')::uuid)$s$)->>'reason'='deadline_passed','nor handed in');
select pg_temp.ok(pg_temp.refusal($s$select public.homework_upload(pg_temp.h('dl'),'intent',null,current_setting('hr.dl_s3')::uuid,'{"purpose":"submission","name":"p.jpg","mime":"image/jpeg"}')$s$)->>'reason'='deadline_passed','nor can a photo be added');
select pg_temp.ok(public.homework_work(pg_temp.h('dl'),'start')->>'id'=current_setting('hr.dl_s3'),'start still returns the draft to look at');
reset role;
select pg_temp.ok(not private.homework_is_late(now(),now()) and private.homework_is_late(now()+interval '1 microsecond',now()) and not private.homework_is_late(now(),null),'exactly AT the deadline is on time; a microsecond later is late; no deadline is never late');
set local role authenticated;
-- Late allowed: the FIRST hand-in only, flagged.
select pg_temp.claim('instructor');
select pg_temp.make('late',('{"deadline":"'||pg_temp.at('1 hour')||'","lateAllowed":true,"tries":"fix_mistakes","maxTries":3}')::jsonb);
select pg_temp.claim('s2');
select set_config('hr.late_s2',pg_temp.hand('late',pg_temp.ans('late','A','First','y'))::text,true);
select set_config('hr.late_s2b',pg_temp.retry('late',current_setting('hr.late_s2')::uuid)::text,true);
select pg_temp.set_deadline('late','-1 second');
select pg_temp.claim('s1');
select set_config('hr.late_s1',pg_temp.hand('late',pg_temp.ans('late','B','Late but allowed','x'))::text,true);
select pg_temp.ok((pg_temp.sub(current_setting('hr.late_s1')::uuid)).missed_deadline and (public.get_homework(pg_temp.h('late'))->'submissions'->0->>'missedDeadline')::boolean,'a late first hand-in is accepted and flagged Missed the deadline');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.retry('late',current_setting('hr.late_s1')::uuid)$s$)->>'reason'='deadline_passed','late allowed covers the first hand-in only: no retry after the deadline');
select pg_temp.ok((public.get_homework(pg_temp.h('late'))->>'triesLeft')::int=0 and not (public.get_homework(pg_temp.h('late'))->>'canRetry')::boolean,'unused tries end at the deadline');
select pg_temp.claim('s2');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.save('late',current_setting('hr.late_s2b')::uuid,pg_temp.ans('late','B','Second','x'))$s$)->>'reason'='deadline_passed','a retry started in time cannot be saved after the deadline, even with late allowed');
select pg_temp.claim('s3');
select pg_temp.ok((public.get_homework(pg_temp.h('late'))->>'canStart')::boolean and (public.get_homework(pg_temp.h('late'))->>'triesLeft')::int=1,'a student who has not handed in may still start a late first hand-in');

-- ---------------------------------------------------------------- 3. Tries
select pg_temp.claim('instructor');
select pg_temp.make('fix',('{"deadline":"'||pg_temp.at('1 day')||'","tries":"fix_mistakes","maxTries":2}')::jsonb);
select set_config('hr.fix_solution',pg_temp.solution_file('fix'),true);
select pg_temp.claim('s1');
select set_config('hr.fix1',pg_temp.hand('fix',pg_temp.ans('fix','B','Full answer','y'))::text,true);
select pg_temp.ok(pg_temp.solutions('fix')='null'::jsonb,'after_hand_in with two tries: solutions stay closed after try 1 of 2');
select pg_temp.ok(not private.homework_storage('lms-homework',current_setting('hr.fix_solution'),'read'),'and the solution file cannot be read from Storage either');
select pg_temp.ok((public.get_homework(pg_temp.h('fix'))->>'canRetry')::boolean and (public.get_homework(pg_temp.h('fix'))->>'triesLeft')::int=1,'one try is left');
select pg_temp.claim('instructor');
select pg_temp.grade('fix',current_setting('hr.fix1')::uuid,6);
select pg_temp.release('fix',current_setting('hr.fix1')::uuid);
select pg_temp.claim('s1');
select set_config('hr.fix2',pg_temp.retry('fix',current_setting('hr.fix1')::uuid)::text,true);
select pg_temp.ok(pg_temp.retry('fix',current_setting('hr.fix1')::uuid)=current_setting('hr.fix2')::uuid,'asking for the next try twice gives the same try');
select pg_temp.ok((select jsonb_agg(a->'kept' order by a->>'questionId')=(select jsonb_agg(to_jsonb(k) order by i) from (values(pg_temp.q('fix','q1')::text,true),(pg_temp.q('fix','q2')::text,true)) v(i,k)) from jsonb_array_elements(public.get_homework(pg_temp.h('fix'),current_setting('hr.fix2')::uuid)->'submissions'->0->'answers') a)
 and jsonb_array_length(public.get_homework(pg_temp.h('fix'),current_setting('hr.fix2')::uuid)->'submissions'->0->'answers')=2,'fix mistakes keeps the right choice and the full-marks essay, and drops the wrong one');
select pg_temp.denied($s$select pg_temp.save('fix',current_setting('hr.fix2')::uuid,pg_temp.ans('fix','C','Full answer','x'))$s$,'23514','a kept answer cannot change');
select pg_temp.save('fix',current_setting('hr.fix2')::uuid,pg_temp.ans('fix','B','Full answer','x'));
select pg_temp.submit('fix',current_setting('hr.fix2')::uuid);
select pg_temp.ok(((pg_temp.corr(current_setting('hr.fix2')::uuid)).status,(pg_temp.corr(current_setting('hr.fix2')::uuid)).score)=('corrected'::text,10::numeric),'the kept essay keeps its marks, so try 2 is corrected at once with 10');
select pg_temp.ok((pg_temp.sub(current_setting('hr.fix1')::uuid)).status='submitted' and (pg_temp.corr(current_setting('hr.fix1')::uuid)).score=8,'try 1 stays in history, locked, with its own score');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.retry('fix',current_setting('hr.fix2')::uuid)$s$)=jsonb_build_object('code','PT409','message','No tries left','reason','no_tries_left'),'after the last try: "No tries left"');
select pg_temp.denied($s$select pg_temp.retry('fix',current_setting('hr.fix1')::uuid)$s$,'PT409','an old try cannot be retried');
select pg_temp.denied($s$select pg_temp.save('fix',current_setting('hr.fix2')::uuid,pg_temp.ans('fix','B','x','x'))$s$,'PT409','a finished try is locked');
select pg_temp.ok((pg_temp.solutions('fix')->>'text')='Private worked answer' and private.homework_storage('lms-homework',current_setting('hr.fix_solution'),'read'),'after the last try the solutions open, also in Storage');
select pg_temp.claim('instructor');
select pg_temp.ok((public.homework_queue(pg_temp.h('fix'),'done')->'rows'->0->>'try')::int=2 and (public.homework_queue(pg_temp.h('fix'),'done')->'rows'->0->>'score')::numeric=10,'the latest try counts in the correcting queue');
-- From zero: a new empty try. One time: no second try.
select pg_temp.make('zero',('{"deadline":"'||pg_temp.at('1 day')||'","tries":"from_zero","maxTries":3}')::jsonb);
select pg_temp.make('once',('{"deadline":"'||pg_temp.at('1 day')||'"}')::jsonb);
select pg_temp.claim('s2');
select set_config('hr.zero1',pg_temp.hand('zero',pg_temp.ans('zero','B','Answer','x'))::text,true);
select set_config('hr.zero2',pg_temp.retry('zero',current_setting('hr.zero1')::uuid)::text,true);
select pg_temp.ok(jsonb_array_length(public.get_homework(pg_temp.h('zero'),current_setting('hr.zero2')::uuid)->'submissions'->0->'answers')=0 and (pg_temp.sub(current_setting('hr.zero2')::uuid)).number=2,'from zero starts try 2 empty');
select pg_temp.save('zero',current_setting('hr.zero2')::uuid,pg_temp.ans('zero','A','Changed everything','y'));
select pg_temp.ok((pg_temp.rev(current_setting('hr.zero2')::uuid))=1,'from zero lets every answer change');
select set_config('hr.once1',pg_temp.hand('once',pg_temp.ans('once','B','Answer','x'))::text,true);
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.retry('once',current_setting('hr.once1')::uuid)$s$)->>'reason'='no_tries_left','one time has no second try');
select pg_temp.ok(pg_temp.start('once')=current_setting('hr.once1')::uuid,'start after the hand-in returns the finished try, not a new one');
select pg_temp.ok((pg_temp.solutions('once')->>'text')='Private worked answer','one time with solutions after hand-in: they open right after the hand-in');
-- One photo per essay, images only, and the legacy-only actions are refused.
select set_config('hr.zero3',pg_temp.start('zero')::text,true);
select pg_temp.ok(current_setting('hr.zero3')=current_setting('hr.zero2'),'start returns the open try');
select set_config('hr.p1',pg_temp.photo('zero',current_setting('hr.zero2')::uuid,'s2')::text,true);
select set_config('hr.p2',pg_temp.photo('zero',current_setting('hr.zero2')::uuid,'s2')::text,true);
select set_config('hr.pdf',pg_temp.photo('zero',current_setting('hr.zero2')::uuid,'s2',1000,'application/pdf')::text,true);
select pg_temp.denied($s$select pg_temp.save('zero',current_setting('hr.zero2')::uuid,pg_temp.ans('zero','B','Two photos','x',jsonb_build_array(current_setting('hr.p1'),current_setting('hr.p2'))))$s$,'23514','one photo per essay');
select pg_temp.denied($s$select pg_temp.save('zero',current_setting('hr.zero2')::uuid,pg_temp.ans('zero','B','A pdf','x',jsonb_build_array(current_setting('hr.pdf'))))$s$,'23514','a photo answer is an image');
select pg_temp.save('zero',current_setting('hr.zero2')::uuid,pg_temp.ans('zero','B','One photo','x',jsonb_build_array(current_setting('hr.p1'))));
select pg_temp.ok(jsonb_array_length(public.get_homework(pg_temp.h('zero'),current_setting('hr.zero2')::uuid)->'submissions'->0->'files')=1,'one photo saves');
select pg_temp.denied($s$select public.homework_upload(pg_temp.h('zero'),'intent',null,current_setting('hr.zero2')::uuid,'{"purpose":"submission","name":"w.pdf","mime":"application/pdf"}')$s$,'23514','a PDF upload is refused for a photo answer');
select pg_temp.claim('instructor');
select pg_temp.denied($s$select public.homework_work(pg_temp.h('once'),'release',current_setting('hr.once1')::uuid,pg_temp.crev(current_setting('hr.once1')::uuid),'{"status":"resubmit_required","reason":"Again please"}')$s$,'23514','the teacher resubmit request is replaced by tries');
select pg_temp.denied($s$select public.homework_work(pg_temp.h('once'),'annotate',current_setting('hr.once1')::uuid,pg_temp.crev(current_setting('hr.once1')::uuid),'{}')$s$,'23514','student images are never edited');
select pg_temp.denied($s$select public.homework_work(pg_temp.h('dl'),'retry',current_setting('hr.dl_s1')::uuid)$s$,'42501','staff cannot take a try for a student');
-- Photos off: no photo intent at all.
select public.homework_lifecycle(pg_temp.h('draft'),'publish',4);
select pg_temp.claim('s4');
select set_config('hr.nophoto',pg_temp.start('draft')::text,true);
select pg_temp.ok(pg_temp.refusal($s$select public.homework_upload(pg_temp.h('draft'),'intent',null,current_setting('hr.nophoto')::uuid,'{"purpose":"submission","name":"p.jpg","mime":"image/jpeg"}')$s$)->>'message'='Photo answers are off for this homework','photos off refuses a photo');

-- ---------------------------------------------------------------- 4. Solutions after the deadline
select pg_temp.claim('instructor');
select pg_temp.make('ad',('{"deadline":"'||pg_temp.at('1 hour')||'","lateAllowed":true,"solutionsOpen":"after_deadline"}')::jsonb);
select set_config('hr.ad_solution',pg_temp.solution_file('ad'),true);
select pg_temp.make('fix2',('{"deadline":"'||pg_temp.at('1 hour')||'","tries":"from_zero","maxTries":2}')::jsonb);
select pg_temp.claim('s1');
select pg_temp.hand('ad',pg_temp.ans('ad','B','Before','x'));
select pg_temp.hand('fix2',pg_temp.ans('fix2','B','Before','x'));
select pg_temp.ok(pg_temp.solutions('ad')='null'::jsonb and not private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'after_deadline: closed after a hand-in before the deadline');
select pg_temp.ok(pg_temp.solutions('fix2')='null'::jsonb,'after_hand_in with a try left: closed before the deadline');
select pg_temp.set_deadline('ad','-1 second');
select pg_temp.set_deadline('fix2','-1 second');
select pg_temp.ok((pg_temp.solutions('ad')->>'text')='Private worked answer' and private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'after the deadline: open for a student who handed in, Storage included');
select pg_temp.ok((pg_temp.solutions('fix2')->>'text')='Private worked answer','with tries: the deadline opens them when it comes before the last try');
select pg_temp.claim('s2');
select pg_temp.ok(pg_temp.solutions('ad')='null'::jsonb and not private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'after the deadline: closed for a student who did not hand in, Storage included');
select pg_temp.hand('ad',pg_temp.ans('ad','B','Late','x'));
select pg_temp.ok((pg_temp.solutions('ad')->>'text')='Private worked answer' and private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'a late student sees them right after handing in');
select pg_temp.claim('sb');
select pg_temp.denied($s$select public.get_homework(pg_temp.h('ad'))$s$,'42501','a student of another course cannot read the homework');
select pg_temp.ok(not private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'nor its solution file');
select pg_temp.claim('ta1');
select pg_temp.ok(private.homework_storage('lms-homework',current_setting('hr.ad_solution'),'read'),'staff always read solutions');

-- ---------------------------------------------------------------- 5. Assistant rights (default on, per assistant per course)
select pg_temp.claim('s3');
select set_config('hr.ad_s3',pg_temp.hand('ad',pg_temp.ans('ad','B','Third','x'))::text,true);
select set_config('hr.once_s3',pg_temp.hand('once',pg_temp.ans('once','B','Third','x'))::text,true);
select pg_temp.claim('ta1');
select pg_temp.ok((public.get_homework(pg_temp.h('ad'))->>'canGrade')::boolean and (public.get_homework(pg_temp.h('ad'))->>'canRelease')::boolean and not (public.get_homework(pg_temp.h('ad'))->>'canManage')::boolean,'an assistant may correct and release by default, and does not manage');
select pg_temp.grade('ad',current_setting('hr.ad_s3')::uuid,5);
select pg_temp.release('ad',current_setting('hr.ad_s3')::uuid);
select pg_temp.ok((pg_temp.corr(current_setting('hr.ad_s3')::uuid)).released_by=pg_temp.uid('ta1'),'an assistant released, as the spec allows by default');
select pg_temp.denied($s$select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),false,false,null)$s$,'42501','an assistant cannot change rights');
select pg_temp.claim('editor');
select pg_temp.denied($s$select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),false,false,null)$s$,'42501','a course editor cannot change rights');
select pg_temp.denied($s$select pg_temp.grade('once',current_setting('hr.once_s3')::uuid,3)$s$,'42501','a course editor who is not support staff cannot correct');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),false,false,null)$s$,'42501','another space cannot change rights');
select pg_temp.denied($s$select public.homework_assistants(pg_temp.key('course'))$s$,'42501','another space cannot read rights');
select pg_temp.denied($s$select pg_temp.grade('once',current_setting('hr.once_s3')::uuid,3)$s$,'42501','another teacher cannot correct');
select pg_temp.claim('instructor');
select pg_temp.ok((select count(*)=2 and bool_and((e->>'canCorrect')::boolean and (e->>'canRelease')::boolean and e->'updatedAt'='null'::jsonb) from jsonb_array_elements(public.homework_assistants(pg_temp.key('course'))) e),'the course instructor reads both assistants, both rights on by default');
select pg_temp.denied($s$select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('s1'),false,false,null)$s$,'23514','a student is not an assistant');
select set_config('hr.ta2_stamp',public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),false,true,null)->>'updatedAt',true);
select pg_temp.denied($s$select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),true,true,null)$s$,'PT409','a stale rights screen is refused');
select pg_temp.claim('ta2');
select pg_temp.denied($s$select pg_temp.grade('once',current_setting('hr.once_s3')::uuid,3)$s$,'42501','an assistant whose correct right is off cannot correct');
select pg_temp.ok(not (public.get_homework(pg_temp.h('once'))->>'canGrade')::boolean,'and the read says so');
select pg_temp.claim('instructor');
select public.set_homework_assistant(pg_temp.key('course'),pg_temp.uid('ta2'),true,false,current_setting('hr.ta2_stamp')::timestamptz);
select pg_temp.claim('ta2');
select pg_temp.grade('once',current_setting('hr.once_s3')::uuid,3);
select pg_temp.denied($s$select pg_temp.release('once',current_setting('hr.once_s3')::uuid)$s$,'42501','an assistant whose release right is off cannot release');
select pg_temp.claim('ta1');
select pg_temp.release('once',current_setting('hr.once_s3')::uuid);
select pg_temp.ok((pg_temp.corr(current_setting('hr.once_s3')::uuid)).released_at is not null,'another assistant of the same course still can');

-- ---------------------------------------------------------------- 6. Delete images (after the deadline, managers only, audited, grades kept)
select pg_temp.claim('instructor');
select pg_temp.make('img',('{"deadline":"'||pg_temp.at('1 hour')||'"}')::jsonb);
select pg_temp.claim('s1');
select set_config('hr.img_s1',pg_temp.start('img')::text,true);
select set_config('hr.img_p1',pg_temp.photo('img',current_setting('hr.img_s1')::uuid,'s1',1500000)::text,true);
select pg_temp.save('img',current_setting('hr.img_s1')::uuid,pg_temp.ans('img','B','With a photo','x',jsonb_build_array(current_setting('hr.img_p1'))));
select pg_temp.submit('img',current_setting('hr.img_s1')::uuid);
select pg_temp.claim('s2');
select set_config('hr.img_s2',pg_temp.start('img')::text,true);
select set_config('hr.img_p2',pg_temp.photo('img',current_setting('hr.img_s2')::uuid,'s2',700000)::text,true);
select pg_temp.claim('instructor');
select pg_temp.grade('img',current_setting('hr.img_s1')::uuid,4);
select pg_temp.ok(pg_temp.refusal($s$select public.homework_delete_images(pg_temp.h('img'))$s$)=jsonb_build_object('code','PT409','message','Homework is still open','reason','still_open'),'Delete images is refused before the deadline');
select pg_temp.set_deadline('img','-1 second');
select pg_temp.claim('ta1');
select pg_temp.denied($s$select public.homework_delete_images(pg_temp.h('img'))$s$,'42501','an assistant cannot delete images');
select pg_temp.claim('editor');
select pg_temp.denied($s$select public.homework_delete_images(pg_temp.h('img'))$s$,'42501','a course editor cannot delete images');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select public.homework_delete_images(pg_temp.h('img'))$s$,'42501','another space cannot delete images');
select pg_temp.claim('owner');
select pg_temp.denied($s$select public.homework_delete_images('70000000-0000-0000-0000-000000000001')$s$,'42501','an exam is never touched (an exam id is not a homework)');
select pg_temp.ok((public.homework_storage_usage(pg_temp.key('org_a'))->>'studentBytes')::bigint=1500000+700000+1500000+1500000+1000,'storage counts every ready student file of the space');
select pg_temp.ok((select (e->>'studentBytes')::bigint=2200000 and (e->>'studentFiles')::int=2 from jsonb_array_elements(public.homework_storage_usage(pg_temp.key('org_a'))->'homework') e where e->>'id'=pg_temp.h('img')::text),'and per homework');
select set_config('hr.deleted',public.homework_delete_images(pg_temp.h('img'))::text,true);
select pg_temp.ok(current_setting('hr.deleted')::jsonb=jsonb_build_object('deletedFiles',1,'bytesFreed',1500000,'paths',jsonb_build_array(pg_temp.h('img')::text||'/'||current_setting('hr.img_p1')||'/resource.jpg')),'Delete images reports the files, the bytes freed and the paths for the Storage API');
select pg_temp.ok((public.homework_storage_usage(pg_temp.key('org_a'))->>'studentBytes')::bigint=700000+1500000+1500000+1000,'storage no longer counts the deleted file');
select pg_temp.ok(private.homework_storage('lms-homework',pg_temp.h('img')::text||'/'||current_setting('hr.img_p1')||'/resource.jpg','delete'),'a manager may now remove the object through the Storage API');
select pg_temp.ok((public.homework_delete_images(pg_temp.h('img'))->>'deletedFiles')::int=0,'deleting again frees nothing');
select pg_temp.claim('ta1');
select pg_temp.ok(not private.homework_storage('lms-homework',pg_temp.h('img')::text||'/'||current_setting('hr.img_p1')||'/resource.jpg','delete'),'an assistant may not remove it');
select pg_temp.denied($s$select public.homework_storage_usage(pg_temp.key('org_a'))$s$,'42501','storage usage is for the space owner and admins');
select pg_temp.claim('s1');
select pg_temp.ok((public.get_homework(pg_temp.h('img'))->'submissions'->0->'files'->0->>'deleted')::boolean,'the student sees the photo as deleted');
select pg_temp.ok(not private.homework_storage('lms-homework',pg_temp.h('img')::text||'/'||current_setting('hr.img_p1')||'/resource.jpg','read'),'and can no longer read it');
reset role;
select pg_temp.ok((select points=4 from private.homework_marks where submission_id=current_setting('hr.img_s1')::uuid and question_id=pg_temp.q('img','q2'))
 and (select score=8 and feedback='Checked' from private.homework_corrections where submission_id=current_setting('hr.img_s1')::uuid)
 and (select count(*)=3 from public.homework_responses where submission_id=current_setting('hr.img_s1')::uuid),'grades, marks, notes and answers are kept');
select pg_temp.ok((select status='ready' from private.homework_uploads where id=current_setting('hr.img_p2')::uuid),'a photo of a try not handed in is left alone');
select pg_temp.ok((select count(*)=2 and bool_and(actor=pg_temp.uid('owner')) and min((after_value->>'bytesFreed')::bigint)=0 and max((after_value->>'bytesFreed')::bigint)=1500000 from private.homework_audit where assignment_id=pg_temp.h('img') and action='images_deleted'),'every Delete images is audited');
set local role authenticated;

-- ---------------------------------------------------------------- 7. Teacher reads
select pg_temp.claim('instructor');
select set_config('hr.portal',public.homework_portal(pg_temp.key('course'),'closed',0)::text,true);
select pg_temp.ok((current_setting('hr.portal')::jsonb->'counts')=jsonb_build_object('open',4,'closed',5,'drafts',0),'the portal counts Open, Closed and Drafts');
select pg_temp.ok((select (r->>'handedIn')::int=3 and (r->>'late')::int=2 and (r->>'total')::int=5 and (r->>'imageBytes')::bigint=0 from jsonb_array_elements(current_setting('hr.portal')::jsonb->'rows') r where r->>'id'=pg_temp.h('ad')::text),'a closed row has handed in, total, late and image bytes');
select pg_temp.ok((select (r->>'handedIn')::int=1 and (r->>'waiting')::int=1 and (r->>'tries')='one_time' and r->>'solutionsOpen'='after_hand_in' from jsonb_array_elements(current_setting('hr.portal')::jsonb->'rows') r where r->>'id'=pg_temp.h('dl')::text),'it has the waiting count, the tries and the solutions rule');
select pg_temp.ok((select count(*)>0 from jsonb_array_elements(current_setting('hr.portal')::jsonb->'toCorrect') r where (r->>'waiting')::int>0) and not exists(select 1 from jsonb_array_elements(current_setting('hr.portal')::jsonb->'toCorrect') r where (r->>'waiting')::int=0),'To correct lists only homework with essays waiting');
select pg_temp.ok((current_setting('hr.portal')::jsonb->'stats'->>'handedInThisWeek')::int>=10 and (current_setting('hr.portal')::jsonb->'stats'->>'correctedThisWeek')::int>=4,'the week stats count this week''s hand-ins and corrections');
select pg_temp.ok(public.homework_portal(null,'open',0)->'counts'=public.homework_portal(pg_temp.key('course'),'open',0)->'counts','all my courses equals my one course here');
select pg_temp.denied($s$select public.homework_portal(pg_temp.key('course'),'archived',0)$s$,'23514','an unknown tab is refused');
select set_config('hr.queue',public.homework_queue(pg_temp.h('late'),'to_correct',0)::text,true);
select pg_temp.ok(current_setting('hr.queue')::jsonb->'counts'=jsonb_build_object('toCorrect',2,'done',0,'missing',3,'handedIn',2,'total',5,'late',1),'the queue counts To correct, Done and Missing');
select pg_temp.ok((select bool_or((r->>'late')::boolean and r->>'userId'=pg_temp.uid('s1')::text) and bool_and((r->>'try')::int=1) from jsonb_array_elements(current_setting('hr.queue')::jsonb->'rows') r),'each row has the try number and the late flag');
select pg_temp.ok((select count(*)=3 from jsonb_array_elements(public.homework_queue(pg_temp.h('late'),'missing',0)->'rows')),'Missing lists the students without a hand-in');
select pg_temp.claim('ta1');
select pg_temp.ok((public.homework_queue(pg_temp.h('late'),'to_correct',0)->'counts'->>'toCorrect')::int=2,'an assistant reads the queue');
select pg_temp.claim('editor');
select pg_temp.denied($s$select public.homework_queue(pg_temp.h('late'))$s$,'42501','a course editor who is not support staff cannot read the queue');
select pg_temp.ok((select bool_and(r->'handedIn'='null'::jsonb and r->'waiting'='null'::jsonb) from jsonb_array_elements(public.homework_portal(pg_temp.key('course'),'closed',0)->'rows') r),'a course editor sees the homework, without numbers from student work');
select pg_temp.claim('s1');
select pg_temp.denied($s$select public.homework_queue(pg_temp.h('late'))$s$,'42501','a student cannot read the queue');
select pg_temp.denied($s$select public.homework_portal(pg_temp.key('course'))$s$,'42501','a student cannot read the portal of the course');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select public.homework_portal(pg_temp.key('course'))$s$,'42501','another space cannot read the portal of the course');
select pg_temp.ok(public.homework_portal(null,'closed',0)->'counts'=jsonb_build_object('open',0,'closed',0,'drafts',0),'another teacher''s own portal holds nothing of this space');
select pg_temp.denied($s$select public.get_homework(pg_temp.h('late'))$s$,'42501','another teacher cannot read the homework');

-- ---------------------------------------------------------------- 9. Reschedule (owner's answer 1)
reset role;
create function pg_temp.hrev(p_label text) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_assignments where id=pg_temp.h(p_label)$$;
create function pg_temp.reschedule(p_label text,p_data jsonb) returns uuid language sql as $$select public.homework_lifecycle(pg_temp.h(p_label),'reschedule',pg_temp.hrev(p_label),p_data)$$;
create function pg_temp.seen(p_label text) returns text[] language sql security definer set search_path='' as $$
 select coalesce(array_agg(u.label order by u.label),'{}') from private.homework_solutions_seen x join pg_temp.hr_users u on u.id=x.user_id where x.assignment_id=pg_temp.h(p_label)$$;
set local role authenticated;
-- 9a. Before the old deadline: no new version, and nothing opens or ends.
select pg_temp.claim('instructor');
select pg_temp.make('rs',('{"deadline":"'||pg_temp.at('1 hour')||'","tries":"fix_mistakes","maxTries":3,"solutionsOpen":"after_deadline"}')::jsonb);
select pg_temp.claim('s1');
select set_config('hr.rs_s1',pg_temp.hand('rs',pg_temp.ans('rs','B','Before','x'))::text,true);
select pg_temp.claim('ta1');
select pg_temp.denied($s$select pg_temp.reschedule('rs',('{"deadline":"'||pg_temp.at('2 days')||'"}')::jsonb)$s$,'42501','an assistant cannot change the deadline (authoring)');
select pg_temp.claim('s1');
select pg_temp.denied($s$select pg_temp.reschedule('rs',('{"deadline":"'||pg_temp.at('2 days')||'"}')::jsonb)$s$,'42501','a student cannot change the deadline');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select pg_temp.reschedule('rs',('{"deadline":"'||pg_temp.at('2 days')||'"}')::jsonb)$s$,'42501','another space cannot change the deadline');
select pg_temp.claim('instructor');
select pg_temp.denied($s$select public.homework_lifecycle(pg_temp.h('rs'),'reschedule',pg_temp.hrev('rs')-1,('{"deadline":"'||pg_temp.at('2 days')||'"}')::jsonb)$s$,'PT409','a stale revision is refused');
select pg_temp.denied($s$select pg_temp.reschedule('rs',('{"deadline":"'||pg_temp.at('-1 minute')||'"}')::jsonb)$s$,'23514','a new deadline in the past is refused (it would open solutions)');
select pg_temp.denied($s$select pg_temp.reschedule('rs','{"deadline":"2031-01-01T10:00"}')$s$,'23514','a new deadline without an offset is refused');
select pg_temp.denied($s$select pg_temp.reschedule('rs','{"tries":"from_zero"}')$s$,'23514','only the deadline and late hand-ins can change this way');
select pg_temp.denied($s$select pg_temp.reschedule('rs','{}')$s$,'23514','an empty change is refused');
select set_config('hr.rs_rev',pg_temp.hrev('rs')::text,true);
select pg_temp.ok(pg_temp.reschedule('rs',('{"deadline":"'||pg_temp.at('2 days')||'"}')::jsonb)=pg_temp.h('rs'),'the instructor moves the deadline after a student handed in');
select pg_temp.ok((select deadline_at>now()+interval '47 hours' and version=1 and revision=current_setting('hr.rs_rev')::bigint+1 from pg_temp.hwrow(pg_temp.h('rs')))
 and (select count(*)=1 from pg_temp.hr_hw x join public.homework_assignments a on a.family_id=x.id where x.label='rs'),'no new version: the same homework, a new revision');
select pg_temp.ok(pg_temp.seen('rs')='{}','before the old deadline nobody could see solutions, so nobody''s tries end');
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.solutions('rs')='null'::jsonb and (public.get_homework(pg_temp.h('rs'))->>'canRetry')::boolean and (public.get_homework(pg_temp.h('rs'))->>'triesLeft')::int=2,'the student still has tries, and solutions do not open early');
select pg_temp.claim('editor');
select pg_temp.ok(pg_temp.reschedule('rs','{"lateAllowed":true}')=pg_temp.h('rs') and (pg_temp.hwrow(pg_temp.h('rs'))).late_allowed,'a course editor (authoring) may turn late hand-ins on');
-- 9b. After the old deadline: whoever could see solutions keeps them and has no more tries; the others work under the new deadline.
select pg_temp.claim('instructor');
select pg_temp.make('rx',('{"deadline":"'||pg_temp.at('1 hour')||'","tries":"fix_mistakes","maxTries":3,"solutionsOpen":"after_deadline"}')::jsonb);
select set_config('hr.rx_solution',pg_temp.solution_file('rx'),true);
select pg_temp.claim('s1');
select set_config('hr.rx_s1',pg_temp.hand('rx',pg_temp.ans('rx','A','First','y'))::text,true);
select pg_temp.claim('s2');
select set_config('hr.rx_s2',pg_temp.start('rx')::text,true);
select pg_temp.claim('s4');
select set_config('hr.rx_s4',pg_temp.hand('rx',pg_temp.ans('rx','A','First','y'))::text,true);
select set_config('hr.rx_s4b',pg_temp.retry('rx',current_setting('hr.rx_s4')::uuid)::text,true);
select set_config('hr.rx_s4p',pg_temp.photo('rx',current_setting('hr.rx_s4b')::uuid,'s4')::text,true);
select pg_temp.set_deadline('rx','-1 second');
select pg_temp.claim('s1');
select pg_temp.ok((pg_temp.solutions('rx')->>'text')='Private worked answer','after the old deadline the student who handed in sees the solutions');
select pg_temp.claim('s2');
select pg_temp.ok(pg_temp.solutions('rx')='null'::jsonb and pg_temp.refusal($s$select pg_temp.submit('rx',current_setting('hr.rx_s2')::uuid)$s$)->>'reason'='deadline_passed','a student with only a draft sees no solutions and cannot hand in');
select pg_temp.claim('instructor');
select pg_temp.ok(pg_temp.reschedule('rx',('{"deadline":"'||pg_temp.at('1 day')||'"}')::jsonb)=pg_temp.h('rx'),'the deadline is extended after it passed');
select pg_temp.ok(pg_temp.seen('rx')='{s1,s4}','the two students who could see the solutions are recorded, nobody else');
select pg_temp.ok((public.homework_portal(pg_temp.key('course'),'open',0)->'rows') @> jsonb_build_array(jsonb_build_object('id',pg_temp.h('rx'))) and (public.homework_queue(pg_temp.h('rx'))->'homework'->>'deadline')::timestamptz>now()+interval '23 hours','the portal lists it as open again, and the queue has the new deadline');
select pg_temp.claim('s1');
select pg_temp.ok((pg_temp.solutions('rx')->>'text')='Private worked answer' and private.homework_storage('lms-homework',current_setting('hr.rx_solution'),'read'),'their solutions do not close again, Storage included');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.retry('rx',current_setting('hr.rx_s1')::uuid)$s$)=jsonb_build_object('code','PT409','message','No tries left','reason','no_tries_left'),'and they get no new try');
select pg_temp.ok((select (g->>'triesLeft')::int=0 and not (g->>'canRetry')::boolean and not (g->>'canStart')::boolean and (g->>'triesEnded')::boolean and not (g->>'deadlinePassed')::boolean from (select public.get_homework(pg_temp.h('rx')) g) x),'the read says no tries left, tries ended, deadline not passed');
select pg_temp.claim('s4');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.save('rx',current_setting('hr.rx_s4b')::uuid,pg_temp.ans('rx','B','Second','x'))$s$)->>'reason'='no_tries_left','a try started before cannot be saved');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.submit('rx',current_setting('hr.rx_s4b')::uuid)$s$)->>'reason'='no_tries_left','after the reschedule that try cannot be handed in either');
select pg_temp.ok(pg_temp.refusal($s$select public.homework_upload(pg_temp.h('rx'),'intent',null,current_setting('hr.rx_s4b')::uuid,'{"purpose":"submission","name":"p.jpg","mime":"image/jpeg"}')$s$)->>'reason'='no_tries_left','nor can a photo be added to it');
select pg_temp.ok(pg_temp.start('rx')=current_setting('hr.rx_s4b')::uuid,'start only shows the try they had');
select pg_temp.claim('s2');
select pg_temp.save('rx',current_setting('hr.rx_s2')::uuid,pg_temp.ans('rx','B','Now on time','x'));
select pg_temp.submit('rx',current_setting('hr.rx_s2')::uuid);
select pg_temp.ok((pg_temp.sub(current_setting('hr.rx_s2')::uuid)).status='submitted' and not (pg_temp.sub(current_setting('hr.rx_s2')::uuid)).missed_deadline,'a student with no hand-in hands in under the new deadline, on time');
select pg_temp.ok(pg_temp.solutions('rx')='null'::jsonb and not private.homework_storage('lms-homework',current_setting('hr.rx_solution'),'read') and (public.get_homework(pg_temp.h('rx'))->>'canRetry')::boolean,'their solutions do not open early (after the deadline), and tries remain');
select pg_temp.claim('s3');
select pg_temp.ok((public.get_homework(pg_temp.h('rx'))->>'canStart')::boolean and pg_temp.start('rx') is not null,'a student who never started may start now');
reset role;
select pg_temp.ok((select count(*)=1 and bool_and(actor=pg_temp.uid('instructor') and (after_value->>'triesEnded')::int=2 and (before_value->>'deadline')::timestamptz<clock_timestamp() and (after_value->>'deadline')::timestamptz>clock_timestamp()) from private.homework_audit where assignment_id=pg_temp.h('rx') and action='rescheduled'),'the reschedule is audited with before and after');
set local role authenticated;
-- 9c. A late hand-in stays flagged; after_hand_in tries also end when the deadline had opened the solutions.
select pg_temp.claim('instructor');
select pg_temp.make('rl',('{"deadline":"'||pg_temp.at('1 hour')||'","lateAllowed":true,"tries":"from_zero","maxTries":2}')::jsonb);
select pg_temp.set_deadline('rl','-1 second');
select pg_temp.claim('s5');
select set_config('hr.rl_s5',pg_temp.hand('rl',pg_temp.ans('rl','B','Late','x'))::text,true);
select pg_temp.claim('instructor');
select pg_temp.ok(pg_temp.reschedule('rl','{"lateAllowed":false}')=pg_temp.h('rl'),'late hand-ins can be turned off after the deadline without moving it');
select pg_temp.reschedule('rl',('{"deadline":"'||pg_temp.at('1 day')||'"}')::jsonb);
select pg_temp.ok((pg_temp.sub(current_setting('hr.rl_s5')::uuid)).missed_deadline and pg_temp.seen('rl')='{s5}','a stored Missed the deadline is never rewritten; the late student who saw solutions is recorded');
select pg_temp.claim('s5');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.retry('rl',current_setting('hr.rl_s5')::uuid)$s$)->>'reason'='no_tries_left' and (pg_temp.solutions('rl')->>'text')='Private worked answer','their second try never opens, and their solutions stay');
-- Legacy homework has no deadline to change.
reset role;
insert into pg_temp.hr_hw select 'legacy',x from (select gen_random_uuid() x) y;
insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,created_by) values(pg_temp.h('legacy'),pg_temp.h('legacy'),pg_temp.key('course'),pg_temp.key('off'),pg_temp.key('lesson'),'Legacy',pg_temp.uid('owner'));
set local role authenticated;
select pg_temp.claim('instructor');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.reschedule('legacy',('{"deadline":"'||pg_temp.at('1 day')||'"}')::jsonb)$s$)->>'code'='23514','legacy homework cannot be rescheduled');
select pg_temp.ok(public.homework_lifecycle(pg_temp.h('legacy'),'publish',pg_temp.hrev('legacy'))=pg_temp.h('legacy'),'the three-argument lifecycle call still works');

-- ---------------------------------------------------------------- 10. Bulk release (owner's answer 2)
reset role;
create function pg_temp.items(variadic p uuid[]) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('submissionId',x,'revision',(select revision from private.homework_corrections where submission_id=x))),'[]'::jsonb) from unnest(p) x$$;
create function pg_temp.released(p_label text) returns bigint language sql security definer set search_path='' as $$
 select count(*) from private.homework_corrections c join public.homework_submissions s on s.id=c.submission_id where s.assignment_id=pg_temp.h(p_label) and c.released_at is not null$$;
set local role authenticated;
select pg_temp.claim('instructor');
select pg_temp.make('bulk',('{"deadline":"'||pg_temp.at('1 day')||'"}')::jsonb);
do $$ declare l text; begin
 foreach l in array array['s1','s2','s3','s4','s5'] loop
  perform pg_temp.claim(l); perform set_config('hr.bulk_'||l,pg_temp.hand('bulk',pg_temp.ans('bulk','B','Answer '||l,'x'))::text,true);
 end loop;
 perform pg_temp.claim('instructor');
 foreach l in array array['s1','s2','s3','s4'] loop perform pg_temp.grade('bulk',current_setting('hr.bulk_'||l)::uuid,5); end loop;
end $$;
create function pg_temp.b(l text) returns uuid language sql as $$select current_setting('hr.bulk_'||l)::uuid$$;
select set_config('hr.bq',public.homework_queue(pg_temp.h('bulk'))::text,true);
select pg_temp.ok((current_setting('hr.bq')::jsonb->>'readyToRelease')::int=4 and current_setting('hr.bq')::jsonb->'releasable'=(select jsonb_agg(e order by e->>'submissionId') from jsonb_array_elements(pg_temp.items(pg_temp.b('s1'),pg_temp.b('s2'),pg_temp.b('s3'),pg_temp.b('s4'))) e),
 'the queue lists the four corrected, unreleased tries with their revisions');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s1'),pg_temp.b('s2'),pg_temp.b('s5'))))=jsonb_build_object('code','23514','message','Finish correction before release','reason','unfinished') and pg_temp.released('bulk')=0,
 'one unfinished try refuses the whole call; nothing is released');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),jsonb_set(pg_temp.items(pg_temp.b('s1'),pg_temp.b('s2')),'{1,revision}','0')))=jsonb_build_object('code','PT409','message','Correction changed; reload','reason','stale') and pg_temp.released('bulk')=0,
 'one stale revision refuses the whole call; nothing is released');
select pg_temp.release('bulk',pg_temp.b('s1'));
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s1'),pg_temp.b('s2'))))->>'reason'='already_released' and pg_temp.released('bulk')=1,
 'an already released try refuses the whole call (re-release stays single, with its reason)');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'))||pg_temp.items(pg_temp.b('s2'))),'23514','a try listed twice is refused');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),(select jsonb_agg(jsonb_build_object('submissionId',gen_random_uuid(),'revision',1)) from generate_series(1,501))),'23514','more than 500 is refused');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),(select jsonb_agg(jsonb_build_object('submissionId',gen_random_uuid(),'revision',1)) from generate_series(1,500))))->>'code'='42501','500 is accepted as a size (unknown tries are then denied)');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),'[]'),'23514','an empty list is refused');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'),current_setting('hr.once1')::uuid)),'42501','a try of another homework is refused');
select pg_temp.claim('ta2');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'))),'42501','an assistant whose release right is off cannot release in bulk');
select pg_temp.claim('editor');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'))),'42501','a course editor cannot release');
select pg_temp.claim('s2');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'))),'42501','a student cannot release');
select pg_temp.claim('outsider');
select pg_temp.denied(format('select public.homework_release_many(%L,%L)',pg_temp.h('bulk'),pg_temp.items(pg_temp.b('s2'))),'42501','another space cannot release');
select pg_temp.ok(pg_temp.released('bulk')=1,'every refusal released nothing');
select pg_temp.claim('ta1');
select set_config('hr.bulk_done',public.homework_release_many(pg_temp.h('bulk'),public.homework_queue(pg_temp.h('bulk'))->'releasable')::text,true);
select pg_temp.ok((current_setting('hr.bulk_done')::jsonb->>'released')::int=3
 and current_setting('hr.bulk_done')::jsonb->'items'=(select jsonb_agg(e order by e->>'submissionId') from jsonb_array_elements(pg_temp.items(pg_temp.b('s2'),pg_temp.b('s3'),pg_temp.b('s4'))) e),'an assistant with the release right releases the rest in one call, with the new revisions');
select pg_temp.ok(pg_temp.released('bulk')=4 and (public.homework_queue(pg_temp.h('bulk'))->>'readyToRelease')::int=0 and public.homework_queue(pg_temp.h('bulk'))->'releasable'='[]'::jsonb,'nothing is left to release');
select pg_temp.claim('s3');
select pg_temp.ok((public.get_homework(pg_temp.h('bulk'))->'submissions'->0->'correction'->>'released')::boolean and (public.get_homework(pg_temp.h('bulk'))->'submissions'->0->'correction'->>'score')::numeric=9,'the student sees the released grade');
reset role;
select pg_temp.ok((select count(*)=3 and bool_and(actor=pg_temp.uid('ta1') and reason='bulk release' and after_value->>'released_at' is not null) from private.homework_audit where assignment_id=pg_temp.h('bulk') and action='release' and reason='bulk release'),'one audit row per released try');
select pg_temp.ok((select bool_and(status='approved' and released_by=pg_temp.uid('ta1')) from private.homework_corrections where submission_id in (pg_temp.b('s2'),pg_temp.b('s3'),pg_temp.b('s4'))),'released as approved, by the assistant');
set local role authenticated;

-- ---------------------------------------------------------------- 8. Anonymous and grants
reset role;
set local role anon;
select pg_temp.denied($s$select public.homework_portal(null)$s$,'42501','anonymous cannot read the portal');
select pg_temp.denied($s$select public.homework_delete_images(gen_random_uuid())$s$,'42501','anonymous cannot delete images');
select pg_temp.denied($s$select public.homework_release_many(gen_random_uuid(),'[]')$s$,'42501','anonymous cannot release');
select pg_temp.denied($s$select public.homework_lifecycle(gen_random_uuid(),'reschedule',1,'{}')$s$,'42501','anonymous cannot reschedule');
reset role;
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and position('homework' in p.proname)>0 and has_function_privilege('anon',p.oid,'execute')),'anonymous cannot execute any homework function');
select pg_temp.ok(not has_function_privilege('authenticated','private.homework_is_late(timestamptz,timestamptz)','execute') and not has_function_privilege('authenticated','private.homework_week_start(timestamptz)','execute')
 and not has_function_privilege('authenticated','private.homework_course_manager(uuid)','execute') and not has_function_privilege('authenticated','private.homework_solutions_rule(uuid,uuid)','execute') and not has_function_privilege('authenticated','private.demo_homework_try(uuid,uuid,uuid[],uuid,integer,timestamptz,boolean,text,integer,boolean)','execute'),'internal helpers are not callable');
select pg_temp.ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('homework_assistant_permissions','homework_carried','homework_solutions_seen') and (not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))),'the new private tables have RLS and no API grant');
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.homework_portal(uuid,text,integer)'::regprocedure) and (select not prosecdef from pg_proc where oid='public.homework_portal(uuid,text,integer)'::regprocedure),'private definer with an empty search path, public invoker wrapper');
select pg_temp.ok(private.homework_week_start('2026-11-06 21:59:59+00')='2026-10-31 00:00:00+02' and private.homework_week_start('2026-11-06 22:00:00+00')='2026-11-07 00:00:00+02','the week runs Saturday to Friday, Africa/Cairo');
select count(*)::integer homework_rules_tests from hr_results;
rollback;
