-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Covers migration 20261127130000_homework_marks_immediate.sql, the owner's homework rules of 2026-11-27:
--   A. a self-marked mark shows right after the hand-in (on time or late), no notice; an essay waits for the teacher's release, which notifies;
--   B. solutions open once the student can no longer improve (one try: at once; tries: the last try, the deadline, or "I'm done" = stop);
--      'after_deadline' is refused for a new save;
--   C. one lesson-completion rule (parts and homework, homework only, parts only, nothing, versions of a homework family);
--   D. the Homework page numbers (handed in, late, average) and the per-student list.
-- The data move of the migration (old 'after_deadline' rows, the Faraday backfill) is proved by homework-marks-before/-after.sql while
-- the template is built.
begin;
create temp table hm_results(name text primary key);
create temp table hm_users(label text primary key,id uuid not null);
create temp table hm_ids(label text primary key,id uuid not null);
grant select,insert on hm_results,hm_users,hm_ids to authenticated,anon;
select set_config('hm.run',gen_random_uuid()::text,true);
insert into hm_ids select k,gen_random_uuid() from unnest(array['org_a','org_b','course','course_b','off','off_b','ch','ch_b','l_hw','l_misc','l_both','l_parts','l_none','l_fam','l_draft','l_b',
 'seg_both','seg_p1','seg_p2']) k;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.hm_results values(label);end$$;
-- The refusal as {code, message, reason}.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('hm.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','hm-'||current_setting('hm.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.hm_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.hm_ids where label=k$$;
create function pg_temp.at(i interval) returns text language sql as $$select to_jsonb(clock_timestamp()+i)#>>'{}'$$;
-- A homework definition: p_qs is a list of 'c<points>' (one choice: answers r = right, w = wrong) and 'e<points>' (an essay, text).
-- Question ids are keyed '<label>:q<n>', answers '<label>:q<n>:r' and '<label>:q<n>:w'.
create function pg_temp.def(p_label text,p_qs text[],p_rules jsonb) returns jsonb language plpgsql set search_path='' as $$
declare qs jsonb:='[]';i integer;t text;q uuid;r uuid;w uuid;begin
 for i in 1..cardinality(p_qs) loop
  t:=p_qs[i];
  insert into pg_temp.hm_ids values(p_label||':q'||i,gen_random_uuid()),(p_label||':q'||i||':r',gen_random_uuid()),(p_label||':q'||i||':w',gen_random_uuid()) on conflict do nothing;
  q:=pg_temp.key(p_label||':q'||i);r:=pg_temp.key(p_label||':q'||i||':r');w:=pg_temp.key(p_label||':q'||i||':w');
  qs:=qs||jsonb_build_array(case when left(t,1)='c' then
   jsonb_build_object('id',q,'type','single_choice','text','Choose','imageId',null,'points',substr(t,2)::int,'responseMode','text','modelAnswer','',
    'options',jsonb_build_array(jsonb_build_object('id',r,'text','Faraday'),jsonb_build_object('id',w,'text','Ohm')),'correctIds',jsonb_build_array(r))
  else jsonb_build_object('id',q,'type','essay','text','Explain','imageId',null,'points',substr(t,2)::int,'responseMode','text','modelAnswer','Model','options','[]'::jsonb,'correctIds','[]'::jsonb) end);
 end loop;
 return jsonb_build_object('title','Synthetic '||p_label,'instructions','','mode','PLATFORM_QUESTIONS','published',true,'usesMarks',true,'filePoints',10,'modelAnswer','Worked answer',
  'solutionVideo','','solutionVideoId',null,'referenceIds','[]'::jsonb,'solutionIds','[]'::jsonb,'questions',qs,'rules',p_rules);
end$$;
-- New homework by the owner, published, in a lesson.
create function pg_temp.make(p_label text,p_lesson text,p_qs text[],p_rules jsonb) returns uuid language plpgsql set search_path='' as $$
declare i uuid;begin
 perform pg_temp.claim('owner');
 i:=public.save_homework(null,pg_temp.key('off'),pg_temp.key(p_lesson),null,null,pg_temp.def(p_label,p_qs,p_rules));
 insert into pg_temp.hm_ids values(p_label,i); return i; end$$;
-- Answers for every question of p_label: choice -> 'r' or 'w', essay -> its text.
create function pg_temp.ans(p_label text,p_choice text[]) returns jsonb language sql as $$
 select jsonb_build_object('fileIds','[]'::jsonb,'answers',coalesce(jsonb_agg(jsonb_build_object('questionId',pg_temp.key(p_label||':q'||n),
  'optionIds',case when x in ('r','w') then jsonb_build_array(pg_temp.key(p_label||':q'||n||':'||x)) else '[]'::jsonb end,'text',case when x in ('r','w') then '' else x end,'fileIds','[]'::jsonb) order by n),'[]'::jsonb))
 from unnest(p_choice) with ordinality u(x,n)$$;
create function pg_temp.rev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_submissions where id=s$$;
create function pg_temp.crev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.homework_corrections where submission_id=s$$;
create function pg_temp.corr(s uuid) returns private.homework_corrections language sql security definer set search_path='' as $$select x from private.homework_corrections x where x.submission_id=s$$;
create function pg_temp.sub(s uuid) returns public.homework_submissions language sql security definer set search_path='' as $$select x from public.homework_submissions x where x.id=s$$;
create function pg_temp.hwrev(i uuid) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_assignments where id=i$$;
create function pg_temp.notices(s uuid) returns bigint language sql security definer set search_path='' as $$select count(*) from private.notification_events where resource_id=s and event_type='homework_released'$$;
create function pg_temp.audits(s uuid,act text) returns bigint language sql security definer set search_path='' as $$select count(*) from private.homework_audit where submission_id=s and action=act$$;
-- As the student who is signed in.
create function pg_temp.hand(p_label text,p_choice text[]) returns uuid language plpgsql set search_path='' as $$declare s uuid;begin
 s:=(public.homework_work(pg_temp.key(p_label),'start')->>'id')::uuid;
 perform public.homework_work(pg_temp.key(p_label),'save',s,pg_temp.rev(s),pg_temp.ans(p_label,p_choice));
 perform public.homework_work(pg_temp.key(p_label),'submit',s,pg_temp.rev(s));return s;end$$;
-- A cloned version has new question ids: answer its first question with the option named 'Faraday' (right), read from get_homework.
create function pg_temp.hand_version(p_label text) returns uuid language plpgsql set search_path='' as $$declare s uuid;q jsonb;begin
 q:=public.get_homework(pg_temp.key(p_label))->'definition'->'questions'->0;
 s:=(public.homework_work(pg_temp.key(p_label),'start')->>'id')::uuid;
 perform public.homework_work(pg_temp.key(p_label),'save',s,pg_temp.rev(s),jsonb_build_object('fileIds','[]'::jsonb,'answers',jsonb_build_array(jsonb_build_object('questionId',q->>'id',
  'optionIds',(select jsonb_agg(o->'id') from jsonb_array_elements(q->'options') o where o->>'text'='Faraday'),'text','','fileIds','[]'::jsonb))));
 perform public.homework_work(pg_temp.key(p_label),'submit',s,pg_temp.rev(s));return s;end$$;
create function pg_temp.view(p_label text) returns jsonb language sql as $$select public.get_homework(pg_temp.key(p_label))$$;
create function pg_temp.mine(p_label text) returns jsonb language sql as $$select public.get_homework(pg_temp.key(p_label))->'submissions'->0->'correction'$$;
create function pg_temp.done(p_lesson text) returns jsonb language sql as $$
 select x from jsonb_array_elements(public.lesson_completion(array[pg_temp.key('off')])) x where x->>'lessonId'=pg_temp.key(p_lesson)::text$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','ta','s1','s2','s3','s4','s5','s6','outsider','sb'] loop
  perform pg_temp.claim(label); insert into pg_temp.hm_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic marks A','hm-a-'||current_setting('hm.run')),(pg_temp.key('org_b'),'Synthetic marks B','hm-b-'||current_setting('hm.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values
 (pg_temp.key('org_a'),pg_temp.uid('owner'),'owner','active',now()),(pg_temp.key('org_a'),pg_temp.uid('ta'),'assistant','active',now()),(pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now());
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org_a'),'Synthetic Physics','hm-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','hm-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('ch'),pg_temp.key('course'),'Electricity',0),(pg_temp.key('ch_b'),pg_temp.key('course_b'),'Foreign',0);
insert into public.lessons(id,module_id,title,position,status) values
 (pg_temp.key('l_hw'),pg_temp.key('ch'),'Homework only',0,'published'),(pg_temp.key('l_misc'),pg_temp.key('ch'),'More homework',1,'published'),
 (pg_temp.key('l_both'),pg_temp.key('ch'),'Parts and homework',2,'published'),(pg_temp.key('l_parts'),pg_temp.key('ch'),'Parts only',3,'published'),
 (pg_temp.key('l_none'),pg_temp.key('ch'),'Nothing in it',4,'published'),(pg_temp.key('l_fam'),pg_temp.key('ch'),'A homework with versions',5,'published'),
 (pg_temp.key('l_draft'),pg_temp.key('ch'),'Still a draft',6,'draft'),(pg_temp.key('l_b'),pg_temp.key('ch_b'),'Foreign lesson',0,'published');
insert into public.lesson_segments(id,lesson_id,title,position,status,description) values
 (pg_temp.key('seg_both'),pg_temp.key('l_both'),'Video',0,'published','Notes'),(pg_temp.key('seg_p1'),pg_temp.key('l_parts'),'Part 1',0,'published','Notes'),
 (pg_temp.key('seg_p2'),pg_temp.key('l_parts'),'Part 2',1,'published','Notes');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('ta'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off'),pg_temp.uid(l),'active',now()-interval '1 day' from unnest(array['s1','s2','s3','s4','s5','s6']) l;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '1 day');

set local role authenticated;
-- ---------------------------------------------------------------------------------------
-- B. 'after_deadline' is gone for new saves.
-- ---------------------------------------------------------------------------------------
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.refusal($$select public.save_homework(null,pg_temp.key('off'),pg_temp.key('l_misc'),null,null,pg_temp.def('refused',array['c1'],
 jsonb_build_object('deadline',pg_temp.at('1 day'),'tries','one_time','solutionsOpen','after_deadline')))$$)->>'message'='Invalid homework rules','save_homework refuses after_deadline (23514, Invalid homework rules)');

-- ---------------------------------------------------------------------------------------
-- The Faraday case: one single-choice question, fix mistakes (2 tries), late allowed, the deadline yesterday; handed in late.
-- ---------------------------------------------------------------------------------------
select pg_temp.make('faraday','l_hw',array['c1'],jsonb_build_object('deadline',pg_temp.at('-1 day'),'lateAllowed',true,'tries','fix_mistakes','maxTries',2,'solutionsOpen','after_hand_in'));
reset role;
select pg_temp.ok(pg_temp.refusal($$update public.homework_assignments set solutions_open='after_deadline' where id=pg_temp.key('faraday')$$)->>'code'='23514',
 'the table itself refuses after_deadline, for every writer');
set local role authenticated;
select pg_temp.claim('s1');
select pg_temp.ok((pg_temp.done('l_hw')->>'complete')::boolean=false and (pg_temp.done('l_hw')->>'started')::boolean=false,'before the hand-in the homework-only lesson is not complete and not started');
insert into hm_ids select 'faraday:s1',pg_temp.hand('faraday',array['r']);
select pg_temp.ok((select (pg_temp.sub(pg_temp.key('faraday:s1'))).missed_deadline),'the hand-in is late');
select pg_temp.ok((select (c).released_at=(pg_temp.sub(pg_temp.key('faraday:s1'))).submitted_at and (c).released_by is null and (c).status='corrected' and (c).score=1 from (select pg_temp.corr(pg_temp.key('faraday:s1')) c) x),
 'the self-marked try is released at its hand-in instant, by the rule (no person)');
select pg_temp.ok(pg_temp.mine('faraday')@>'{"released":true,"status":"corrected","score":1}' and jsonb_array_length(pg_temp.mine('faraday')->'marks')=1,'the student sees the mark right after handing in, late');
select pg_temp.ok(not (pg_temp.mine('faraday') ? 'selfMarked'),'no separate self-marked part once everything is released');
select pg_temp.ok(pg_temp.notices(pg_temp.key('faraday:s1'))=0,'no "marks released" notice for a self-marked mark');
select pg_temp.ok((pg_temp.view('faraday')->>'solutionsOpen')::boolean and pg_temp.view('faraday')->'solutions'->>'text'='Worked answer'
 and (pg_temp.view('faraday')->>'canRetry')::boolean=false and (pg_temp.view('faraday')->>'canStop')::boolean=false and (pg_temp.view('faraday')->>'triesLeft')::int=0,
 'late, the deadline has passed: no try can follow, so the answers open at once (no "I''m done" button)');
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('faraday'),'retry',pg_temp.key('faraday:s1'))$$)->>'reason'='deadline_passed','a late student gets no second try (late covers the first hand-in)');
select pg_temp.ok((pg_temp.done('l_hw')->>'complete')::boolean and (pg_temp.done('l_hw')->>'homework')::int=1 and (pg_temp.done('l_hw')->>'homeworkDone')::int=1,
 'the lesson whose only component is this homework is complete once it is handed in (late counts)');
select pg_temp.claim('s2');
select pg_temp.ok((pg_temp.done('l_hw')->>'complete')::boolean=false,'the same lesson is not complete for a classmate who has not handed in');
select pg_temp.claim('owner');
select pg_temp.ok((select x@>'{"handedIn":1,"late":1,"total":6,"averageScore":1,"waiting":0}' from jsonb_array_elements(public.homework_portal(null,'closed',0)->'rows') x where x->>'id'=pg_temp.key('faraday')::text),
 'the Homework page row: 1 of 6 handed in, 1 late, average 1');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.homework_portal(null,'closed',0)->'toCorrect') x where x->>'id'=pg_temp.key('faraday')::text),'a self-marking homework never appears under To correct');
select pg_temp.ok(public.homework_students(pg_temp.key('faraday'))->'counts'@>'{"total":6,"handedIn":1,"late":1,"notHandedIn":5,"averageScore":1}','the per-student list counts the same');
select pg_temp.ok((select x@>jsonb_build_object('userId',pg_temp.uid('s1'),'state','late','score',1,'tries',1,'waiting',false) from jsonb_array_elements(public.homework_students(pg_temp.key('faraday'))->'rows') x where x->>'userId'=pg_temp.uid('s1')::text),
 'the list shows the late student, the mark and the tries used');
select pg_temp.ok((select x@>'{"state":"not_handed_in","tries":0}' and x->'score'='null'::jsonb from jsonb_array_elements(public.homework_students(pg_temp.key('faraday'))->'rows') x where x->>'userId'=pg_temp.uid('s2')::text),
 'a student who has not handed in is listed as not handed in');
select pg_temp.claim('ta');
select pg_temp.ok(jsonb_array_length(public.homework_students(pg_temp.key('faraday'))->'rows')=6,'an assistant of the run reads the list');
select pg_temp.claim('outsider');
select pg_temp.ok(pg_temp.refusal($$select public.homework_students(pg_temp.key('faraday'))$$)->>'code'='42501','a teacher of another space is refused the list');
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.refusal($$select public.homework_students(pg_temp.key('faraday'))$$)->>'code'='42501','a student is refused the list');

-- ---------------------------------------------------------------------------------------
-- B. Tries: the answers stay shut while a try is left; they open after the last try, or when the student stops.
-- ---------------------------------------------------------------------------------------
select pg_temp.make('tries','l_misc',array['c1'],jsonb_build_object('deadline',pg_temp.at('2 days'),'tries','fix_mistakes','maxTries',2,'solutionsOpen','after_hand_in'));
select pg_temp.claim('s2');
insert into hm_ids select 'tries:s2:1',pg_temp.hand('tries',array['w']);
select pg_temp.ok(pg_temp.mine('tries')@>'{"released":true,"score":0}','on time, a wrong answer: the mark (0) shows at once');
select pg_temp.ok((pg_temp.view('tries')->>'solutionsOpen')::boolean=false and pg_temp.view('tries')->'solutions'='null'::jsonb
 and (pg_temp.view('tries')->>'canRetry')::boolean and (pg_temp.view('tries')->>'canStop')::boolean and (pg_temp.view('tries')->>'triesLeft')::int=1,
 'a try is left: the answers stay shut, Try again and "I''m done" are offered');
insert into hm_ids select 'tries:s2:2',(public.homework_work(pg_temp.key('tries'),'retry',pg_temp.key('tries:s2:1'))->>'id')::uuid;
select public.homework_work(pg_temp.key('tries'),'save',pg_temp.key('tries:s2:2'),pg_temp.rev(pg_temp.key('tries:s2:2')),pg_temp.ans('tries',array['r']));
select public.homework_work(pg_temp.key('tries'),'submit',pg_temp.key('tries:s2:2'),pg_temp.rev(pg_temp.key('tries:s2:2')));
select pg_temp.ok(pg_temp.mine('tries')@>'{"released":true,"score":1}' and (pg_temp.view('tries')->>'solutionsOpen')::boolean and (pg_temp.view('tries')->>'canStop')::boolean=false,
 'after the last try the mark shows and the answers open');

select pg_temp.claim('s3');
insert into hm_ids select 'tries:s3',pg_temp.hand('tries',array['w']);
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3'))-1)$$)->>'code'='PT409','stop with an old revision: PT409 (reload)');
select pg_temp.claim('s4');
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3')))$$)->>'code'='42501','a student cannot stop another student''s tries');
select pg_temp.claim('sb');
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3')))$$)->>'code'='42501','a student of another space is refused');
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3')))$$)->>'code'='42501','the teacher cannot stop for a student');
select pg_temp.claim('s3');
select pg_temp.ok((pg_temp.view('tries')->>'solutionsOpen')::boolean=false,'before stopping the answers are shut');
select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3')));
select pg_temp.ok((pg_temp.view('tries')->>'solutionsOpen')::boolean and (pg_temp.view('tries')->>'stopped')::boolean and (pg_temp.view('tries')->>'triesEnded')::boolean=false
 and (pg_temp.view('tries')->>'triesLeft')::int=0 and (pg_temp.view('tries')->>'canRetry')::boolean=false and (pg_temp.view('tries')->>'canStop')::boolean=false,
 '"I''m done": the answers open, the remaining tries end (stopped, not "the deadline changed")');
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'retry',pg_temp.key('tries:s3'))$$)->>'reason'='no_tries_left','after stopping, Try again is refused: No tries left');
select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s3'),pg_temp.rev(pg_temp.key('tries:s3')));
select pg_temp.ok(pg_temp.audits(pg_temp.key('tries:s3'),'stopped')=1,'stopping twice writes one audit row (the second writes nothing)');
select pg_temp.claim('s5');
insert into hm_ids select 'tries:s5:1',pg_temp.hand('tries',array['w']);
select public.homework_work(pg_temp.key('tries'),'retry',pg_temp.key('tries:s5:1'));
select pg_temp.ok(pg_temp.refusal($$select public.homework_work(pg_temp.key('tries'),'stop',pg_temp.key('tries:s5:1'),pg_temp.rev(pg_temp.key('tries:s5:1')))$$)->>'code'='PT409'
 and (pg_temp.view('tries')->>'canStop')::boolean=false,'while a new try is being written, stop is refused (PT409) and not offered');
select pg_temp.claim('owner');
select public.homework_lifecycle(pg_temp.key('tries'),'reschedule',pg_temp.hwrev(pg_temp.key('tries')),jsonb_build_object('deadline',pg_temp.at('3 days')));
select pg_temp.claim('s3');
select pg_temp.ok((pg_temp.view('tries')->>'stopped')::boolean and (pg_temp.view('tries')->>'solutionsOpen')::boolean,'a later deadline change keeps a stopped student stopped, answers open');

-- One time: the answers open right after the hand-in, and "I'm done" is never offered.
select pg_temp.make('once','l_misc',array['c1'],jsonb_build_object('deadline',pg_temp.at('2 days'),'tries','one_time','solutionsOpen','after_hand_in'));
select pg_temp.claim('s4');
select pg_temp.hand('once',array['r']);
select pg_temp.ok((pg_temp.view('once')->>'solutionsOpen')::boolean and (pg_temp.view('once')->>'canStop')::boolean=false and pg_temp.mine('once')@>'{"released":true,"score":1}',
 'one try: mark and answers right after the hand-in');

-- ---------------------------------------------------------------------------------------
-- A. Mixed homework: the choice part shows at once, the essay waits for the teacher, the total after the release (which notifies).
-- ---------------------------------------------------------------------------------------
select pg_temp.make('mixed','l_misc',array['c2','e4'],jsonb_build_object('deadline',pg_temp.at('2 days'),'tries','one_time','solutionsOpen','after_hand_in'));
select pg_temp.claim('s1');
insert into hm_ids select 'mixed:s1',pg_temp.hand('mixed',array['r','My essay']);
select pg_temp.ok((select (c).released_at is null and (c).status='under_correction' from (select pg_temp.corr(pg_temp.key('mixed:s1')) c) x),'an essay waits: the correction is not released');
select pg_temp.ok(pg_temp.mine('mixed')@>'{"released":false,"status":"under_correction"}' and pg_temp.mine('mixed')->'score'='null'::jsonb and pg_temp.mine('mixed')->'marks'='[]'::jsonb,
 'the student sees no total and no essay mark yet');
select pg_temp.ok(pg_temp.mine('mixed')->'selfMarked'=jsonb_build_object('score',2,'max',2,'essays',1,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.key('mixed:q1'),'points',2))),
 'the self-marked part shows at once: 2 of 2, one essay waiting');
select pg_temp.claim('owner');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.homework_portal(null,'open',0)->'toCorrect') x where x->>'id'=pg_temp.key('mixed')::text),'the essay is under To correct');
select public.homework_work(pg_temp.key('mixed'),'grade',pg_temp.key('mixed:s1'),pg_temp.crev(pg_temp.key('mixed:s1')),
 jsonb_build_object('marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.key('mixed:q2'),'points',3,'feedback','Good')),'feedback','Good'));
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.mine('mixed')@>'{"released":false}' and pg_temp.mine('mixed')->'score'='null'::jsonb and pg_temp.mine('mixed')->'selfMarked'->>'score'='2',
 'marked but not released: still only the self-marked part');
select pg_temp.claim('owner');
select pg_temp.ok((select x@>'{"handedIn":1}' and x->'averageScore'='null'::jsonb from jsonb_array_elements(public.homework_portal(null,'open',0)->'rows') x where x->>'id'=pg_temp.key('mixed')::text),
 'the average leaves out a try whose mark is not released');
select public.homework_work(pg_temp.key('mixed'),'release',pg_temp.key('mixed:s1'),pg_temp.crev(pg_temp.key('mixed:s1')),'{"status":"approved"}');
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.mine('mixed')@>'{"released":true,"score":5}' and jsonb_array_length(pg_temp.mine('mixed')->'marks')=2 and not (pg_temp.mine('mixed') ? 'selfMarked'),
 'after the release the total (5) and the essay mark show');
select pg_temp.ok(pg_temp.notices(pg_temp.key('mixed:s1'))=1,'the essay release sends the "marks released" notice, once');
select pg_temp.claim('owner');
select pg_temp.ok((select (x->>'averageScore')::numeric=5 from jsonb_array_elements(public.homework_portal(null,'open',0)->'rows') x where x->>'id'=pg_temp.key('mixed')::text),'then it counts in the average');

-- Reports: a self-marked mark counts at once; an essay waits until it is released.
reset role;
select pg_temp.ok((select state='done' and detail='released' and score=0 and maxv=1 from private.report_homework(array[pg_temp.key('off')],now()-interval '1 year',now()+interval '1 year') r
 where r.item_id=pg_temp.key('tries') and r.user_id=pg_temp.uid('s3')),'report_homework counts a self-marked mark at once (released at hand-in)');
select pg_temp.ok((select state='done' and detail='released' and score=5 and maxv=6 from private.report_homework(array[pg_temp.key('off')],now()-interval '1 year',now()+interval '1 year') r
 where r.item_id=pg_temp.key('mixed') and r.user_id=pg_temp.uid('s1')),'and a mixed homework once the teacher released the essay');
set local role authenticated;

-- ---------------------------------------------------------------------------------------
-- C. Lesson completion.
-- ---------------------------------------------------------------------------------------
select pg_temp.make('both','l_both',array['c1'],jsonb_build_object('deadline',pg_temp.at('2 days'),'tries','one_time','solutionsOpen','after_hand_in'));
select pg_temp.claim('s6');
select pg_temp.ok(pg_temp.done('l_both')@>'{"complete":false,"started":false,"parts":1,"homework":1}','parts and homework: nothing done yet');
select public.save_segment_progress(pg_temp.key('off'),pg_temp.key('seg_both'),30,true,0);
select pg_temp.ok(pg_temp.done('l_both')@>'{"complete":false,"started":true,"partsDone":1,"homeworkDone":0}','every part done but the homework not handed in: not complete');
select pg_temp.hand('both',array['w']);
select pg_temp.ok(pg_temp.done('l_both')@>'{"complete":true,"homeworkDone":1}','parts done and the homework handed in (a wrong answer still counts): complete');
select public.save_segment_progress(pg_temp.key('off'),pg_temp.key('seg_p1'),10,true,0);
select pg_temp.ok(pg_temp.done('l_parts')@>'{"complete":false,"started":true,"parts":2,"partsDone":1,"homework":0}','parts only: one of two done');
select public.save_segment_progress(pg_temp.key('off'),pg_temp.key('seg_p2'),10,true,0);
select pg_temp.ok(pg_temp.done('l_parts')@>'{"complete":true}','parts only: every part done is complete');
select pg_temp.ok(pg_temp.done('l_none')@>'{"complete":false,"started":false,"parts":0,"homework":0}','nothing in it, not opened: not complete');
select pg_temp.ok(public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_none'))=jsonb_build_object('recorded',true),'opening it records the visit');
select pg_temp.ok(pg_temp.done('l_none')@>'{"complete":true,"started":true}','nothing in it, opened: complete');
select pg_temp.ok(public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_none'))=jsonb_build_object('recorded',false),'opening it again writes nothing');
select pg_temp.ok(public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_parts'))=jsonb_build_object('recorded',false),'a lesson with a part is not recorded by opening it');
select pg_temp.ok(pg_temp.refusal($$select public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_draft'))$$)->>'code'='42501','a draft lesson is refused');
select pg_temp.ok(pg_temp.refusal($$select public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_b'))$$)->>'code'='42501','a lesson of another course is refused');
select pg_temp.ok(pg_temp.refusal($$select public.lesson_opened(pg_temp.key('off_b'),pg_temp.key('l_b'))$$)->>'code'='42501','a run the student is not in is refused');
select pg_temp.ok(public.lesson_completion(array[pg_temp.key('off_b')])='[]'::jsonb,'completion of a run the student is not in: nothing, without a word');
select pg_temp.ok(pg_temp.refusal($$select public.lesson_completion(array(select gen_random_uuid() from generate_series(1,101)))$$)->>'code'='23514','more than 100 runs is refused');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.lesson_completion(array[pg_temp.key('off')])) x where x->>'lessonId'=pg_temp.key('l_draft')::text),'a draft lesson is not listed');
select pg_temp.claim('sb');
select pg_temp.ok(public.lesson_completion(array[pg_temp.key('off')])='[]'::jsonb,'a student of another space sees nothing of this run');
select pg_temp.ok(pg_temp.refusal($$select public.lesson_opened(pg_temp.key('off'),pg_temp.key('l_none'))$$)->>'code'='42501','and cannot record a visit in it');
select pg_temp.claim('s2');
select pg_temp.ok(pg_temp.done('l_none')@>'{"complete":false}','one student''s visit is not another''s');

-- Versions of one homework family: a hand-in of any version counts.
select pg_temp.make('fam','l_fam',array['c1'],jsonb_build_object('deadline',pg_temp.at('2 days'),'tries','one_time','solutionsOpen','after_hand_in'));
select pg_temp.claim('s5');
select pg_temp.hand('fam',array['r']);
select pg_temp.claim('owner');
insert into hm_ids select 'fam:v2',public.homework_lifecycle(pg_temp.key('fam'),'clone',pg_temp.hwrev(pg_temp.key('fam')));
select public.homework_lifecycle(pg_temp.key('fam:v2'),'publish',pg_temp.hwrev(pg_temp.key('fam:v2')));
select pg_temp.claim('s5');
select pg_temp.ok(pg_temp.done('l_fam')@>'{"complete":true,"homework":1,"homeworkDone":1}','two published versions are one homework; the hand-in of version 1 completes the lesson');
select pg_temp.claim('s6');
select pg_temp.ok(pg_temp.done('l_fam')@>'{"complete":false,"homework":1}','not handed in: not complete');
select pg_temp.hand_version('fam:v2');
select pg_temp.ok(pg_temp.done('l_fam')@>'{"complete":true,"homeworkDone":1}','a hand-in of version 2 completes it too');
select pg_temp.claim('owner');
select public.homework_lifecycle(pg_temp.key('fam'),'unpublish',pg_temp.hwrev(pg_temp.key('fam')));
select public.homework_lifecycle(pg_temp.key('fam:v2'),'unpublish',pg_temp.hwrev(pg_temp.key('fam:v2')));
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.done('l_fam')@>'{"complete":false,"homework":0,"parts":0,"started":false}','an unpublished homework does not count (an empty lesson then needs a visit)');

-- ---------------------------------------------------------------------------------------
-- Grants: the new functions are for signed-in callers only.
-- ---------------------------------------------------------------------------------------
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.lesson_completion(uuid[])','execute') and not has_function_privilege('anon','public.lesson_opened(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.homework_students(uuid,integer)','execute') and has_function_privilege('authenticated','public.lesson_opened(uuid,uuid)','execute'),
 'anon cannot call the new functions; authenticated can');
select pg_temp.ok((select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('lesson_completion','lesson_opened','homework_students'))
 and (select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('lesson_completion','lesson_opened','homework_students')),
 'private definers behind public invoker wrappers');
select pg_temp.ok((select count(*)=0 from pg_trigger where tgname='notification_homework' and tgenabled='D'),'the notice trigger is on');

select count(*) as homework_marks_tests from hm_results;
rollback;
