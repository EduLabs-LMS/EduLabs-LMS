-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures. Every change rolls back; no real account exists.
-- Covers migration 20261112120000_homework_move.sql: moving a homework to another lesson, run or course before any student starts, and the refusals
-- (started, versioned, rights, another space, a course in another space even for a teacher of both, stale, a lesson of another course); the relaxed choice rule; the model answer picture (who sees it, by
-- get_homework, by the upload read and by Storage path, before and after the solutions open, after a reschedule, a student of another course, the clone
-- copy); question counts and marks on the Homework page against a naive count. EVERY identity is a Firebase identity (a non-UUID subject, created by
-- onboard_firebase_profile). Moves raced against a student's start on separate connections are in scripts/homework-move-concurrency.cjs.
begin;
create temp table hm_results(name text primary key);
create temp table hm_users(label text primary key,id uuid not null);
create temp table hm_q(label text,k text,id uuid not null,primary key(label,k));
create temp table hm_hw(label text primary key,id uuid not null);
grant select,insert on hm_results,hm_users,hm_q,hm_hw to authenticated,anon;
select set_config('hm.run',gen_random_uuid()::text,true);
select set_config('hm.'||k,gen_random_uuid()::text,true) from unnest(array['org_a','org_b','phys','chem','art','foreign','off1','off2','offc','offa','offf','ch1','ch2','chc','cha','chf','l1','l2','lc','la','lf']) k;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.hm_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.hm_results values(label);end$$;
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('hm.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','hm-'||current_setting('hm.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('hm.'||k)::uuid$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.hm_users where label=k$$;
create function pg_temp.q(p_label text,p_k text) returns uuid language sql as $$select id from pg_temp.hm_q where label=p_label and k=p_k$$;
create function pg_temp.h(p_label text) returns uuid language sql as $$select id from pg_temp.hm_hw where label=p_label$$;
create function pg_temp.at(i interval) returns text language sql as $$select to_jsonb(clock_timestamp()+i)#>>'{}'$$;
-- Two questions: a choice with four blank answers (B right, 2 marks) and an essay (5 marks) whose model answer may carry a picture.
create function pg_temp.def(p_label text,p_published boolean,p_model uuid default null,p_rules jsonb default null) returns jsonb language plpgsql set search_path='' as $$
declare k text;begin
 foreach k in array array['q1','A','B','C','D','q2'] loop insert into pg_temp.hm_q values(p_label,k,gen_random_uuid()) on conflict do nothing; end loop;
 return jsonb_build_object('title','Synthetic '||p_label,'instructions','','mode','PLATFORM_QUESTIONS','published',p_published,'usesMarks',true,'filePoints',0,'modelAnswer','Worked answer',
  'solutionVideo','','solutionVideoId',null,'referenceIds','[]'::jsonb,'solutionIds','[]'::jsonb,
  'rules',coalesce(p_rules,jsonb_build_object('deadline',pg_temp.at('3 days'))),
  'questions',jsonb_build_array(
   jsonb_build_object('id',pg_temp.q(p_label,'q1'),'type','single_choice','text','','imageId',null,'points',2,'responseMode','text','modelAnswer','',
    'options',jsonb_build_array(jsonb_build_object('id',pg_temp.q(p_label,'A'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'B'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'C'),'text',''),jsonb_build_object('id',pg_temp.q(p_label,'D'),'text','')),
    'correctIds',jsonb_build_array(pg_temp.q(p_label,'B'))),
   jsonb_build_object('id',pg_temp.q(p_label,'q2'),'type','essay','text','Explain','imageId',null,'points',5,'responseMode','text','modelAnswer','Model','modelImageId',p_model,'options','[]'::jsonb,'correctIds','[]'::jsonb)));
end$$;
create function pg_temp.make(p_label text,p_published boolean,p_off text default 'off1',p_lesson text default 'l1',p_rules jsonb default null) returns uuid language plpgsql set search_path='' as $$
declare i uuid;begin
 i:=public.save_homework(null,pg_temp.key(p_off),pg_temp.key(p_lesson),null,null,pg_temp.def(p_label,p_published,null,p_rules));
 insert into pg_temp.hm_hw values(p_label,i); return i; end$$;
-- Read as the database owner, so a check can see what the signed-in person may not.
create function pg_temp.hwrow(i uuid) returns public.homework_assignments language sql security definer set search_path='' as $$select x from public.homework_assignments x where x.id=i$$;
create function pg_temp.rev(p_label text) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_assignments where id=pg_temp.h(p_label)$$;
create function pg_temp.place(p_label text) returns text language sql security definer set search_path='' as $$
 select concat_ws('/',(select k from unnest(array['phys','chem','art','foreign']) k where pg_temp.key(k)=a.course_id),(select k from unnest(array['off1','off2','offc','offa','offf']) k where pg_temp.key(k)=a.offering_id),(select k from unnest(array['l1','l2','lc','la','lf']) k where pg_temp.key(k)=a.lesson_id))
 from public.homework_assignments a where a.id=pg_temp.h(p_label)$$;
create function pg_temp.audits(p_label text,p_action text) returns setof private.homework_audit language sql security definer set search_path='' as $$select * from private.homework_audit where assignment_id=pg_temp.h(p_label) and action=p_action order by created_at,id$$;
-- Move: the same definition, sent with the revision read, to another run and lesson.
create function pg_temp.move(p_label text,p_off text,p_lesson text) returns uuid language sql as $$
 select public.save_homework(pg_temp.h(p_label),pg_temp.key(p_off),pg_temp.key(p_lesson),null,pg_temp.rev(p_label),pg_temp.def(p_label,(pg_temp.hwrow(pg_temp.h(p_label))).status='published'))$$;
-- A ready picture upload of a homework (no real file), as the database owner.
create function pg_temp.upload(p_label text,p_purpose text,p_mime text,who text default 'teacher') returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();ext text:=case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' else 'jpg' end;begin
 insert into private.homework_uploads(id,assignment_id,uploaded_by,purpose,name,mime,path,status,size_bytes,sha256,pages)
  values(i,pg_temp.h(p_label),pg_temp.uid(who),p_purpose,'model.'||ext,p_mime,pg_temp.h(p_label)::text||'/'||i::text||'/resource.'||ext,'ready',4096,repeat('e',64),1);
 return i; end$$;
create function pg_temp.path(i uuid) returns text language sql security definer set search_path='' as $$select path from private.homework_uploads where id=i$$;
create function pg_temp.reads(i uuid) returns boolean language sql as $$select private.homework_storage('lms-homework',pg_temp.path(i),'read')$$;
create function pg_temp.gets(p_label text,i uuid) returns boolean language plpgsql set search_path='' as $$begin
 perform public.homework_upload(pg_temp.h(p_label),'get',i); return true; exception when others then return false; end$$;
create function pg_temp.model_key(p_label text) returns uuid language sql as $$
 select (k->>'modelImageId')::uuid from jsonb_array_elements(public.get_homework(pg_temp.h(p_label))->'solutions'->'keys') k where (k->>'questionId')::uuid=pg_temp.q(p_label,'q2')$$;
create function pg_temp.hand(p_label text) returns uuid language plpgsql set search_path='' as $$declare s jsonb;begin
 s:=public.homework_work(pg_temp.h(p_label),'start');
 s:=public.homework_work(pg_temp.h(p_label),'save',(s->>'id')::uuid,(s->>'revision')::bigint,jsonb_build_object('fileIds','[]'::jsonb,'answers',jsonb_build_array(
  jsonb_build_object('questionId',pg_temp.q(p_label,'q1'),'optionIds',jsonb_build_array(pg_temp.q(p_label,'B')),'text','','fileIds','[]'::jsonb),
  jsonb_build_object('questionId',pg_temp.q(p_label,'q2'),'optionIds','[]'::jsonb,'text','Mine','fileIds','[]'::jsonb))));
 perform public.homework_work(pg_temp.h(p_label),'submit',(s->>'id')::uuid,(s->>'revision')::bigint);
 return (s->>'id')::uuid; end$$;
create function pg_temp.set_deadline(p_label text,i interval) returns void language sql security definer set search_path='' as $$
 update public.homework_assignments set deadline_at=clock_timestamp()+i where id=pg_temp.h(p_label)$$;

-- Everyone signs in with Firebase first, so each has a profile.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','teacher','physonly','chemonly','ta','s1','s2','s3','s4','outsider','both'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.hm_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
-- Space A: Physics (two runs, two chapters), Chemistry and Art. teacher instructs Physics and Chemistry; physonly edits Physics only; chemonly
-- edits Chemistry only; nobody but the owner edits Art. Space B: outsider's own course. s1, s2 study Physics run 1, s4 Physics run 2, s3 Chemistry.
-- both teaches in both spaces: an instructor of Physics (space A) and of the foreign course (space B).
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic move A','hm-a-'||current_setting('hm.run')),(pg_temp.key('org_b'),'Synthetic move B','hm-b-'||current_setting('hm.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('teacher','teacher'),('physonly','teacher'),('chemonly','teacher'),('ta','assistant')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now()
 union all select pg_temp.key('org_a'),pg_temp.uid('both'),'teacher','active',now() union all select pg_temp.key('org_b'),pg_temp.uid('both'),'teacher','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('phys'),pg_temp.key('org_a'),'Synthetic Physics','hm-phys','published','private',pg_temp.uid('owner')),
 (pg_temp.key('chem'),pg_temp.key('org_a'),'Synthetic Chemistry','hm-chem','published','private',pg_temp.uid('owner')),
 (pg_temp.key('art'),pg_temp.key('org_a'),'Synthetic Art','hm-art','published','private',pg_temp.uid('owner')),
 (pg_temp.key('foreign'),pg_temp.key('org_b'),'Foreign course','hm-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('phys'),pg_temp.uid('teacher'),'instructor'),(pg_temp.key('chem'),pg_temp.uid('teacher'),'instructor'),
 (pg_temp.key('phys'),pg_temp.uid('physonly'),'editor'),(pg_temp.key('chem'),pg_temp.uid('chemonly'),'editor'),
 (pg_temp.key('phys'),pg_temp.uid('both'),'instructor'),(pg_temp.key('foreign'),pg_temp.uid('both'),'instructor');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off1'),pg_temp.key('phys'),'Run 1','scheduled','active'),(pg_temp.key('off2'),pg_temp.key('phys'),'Run 2','scheduled','active'),
 (pg_temp.key('offc'),pg_temp.key('chem'),'Chem run','scheduled','active'),(pg_temp.key('offa'),pg_temp.key('art'),'Art run','scheduled','active'),(pg_temp.key('offf'),pg_temp.key('foreign'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off1'),pg_temp.uid('ta'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key(o),pg_temp.uid(l),'active',now()-interval '1 day' from (values('off1','s1'),('off1','s2'),('off2','s4'),('offc','s3')) x(o,l);
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('ch1'),pg_temp.key('phys'),'Current',0),(pg_temp.key('ch2'),pg_temp.key('phys'),'Magnetism',1),
 (pg_temp.key('chc'),pg_temp.key('chem'),'Atoms',0),(pg_temp.key('cha'),pg_temp.key('art'),'Colour',0),(pg_temp.key('chf'),pg_temp.key('foreign'),'Foreign chapter',0);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('l1'),pg_temp.key('ch1'),'Ohm',0,'published'),(pg_temp.key('l2'),pg_temp.key('ch2'),'Field',0,'published'),
 (pg_temp.key('lc'),pg_temp.key('chc'),'Bonds',0,'published'),(pg_temp.key('la'),pg_temp.key('cha'),'Hue',0,'published'),(pg_temp.key('lf'),pg_temp.key('chf'),'Foreign lesson',0,'published');

-- ---------------------------------------------------------------- 1. Moves before anyone starts
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.make('draft',false);
select pg_temp.move('draft','off1','l2');
select pg_temp.ok(pg_temp.place('draft')='phys/off1/l2' and pg_temp.rev('draft')=2,'a draft moves to a lesson of another chapter; the revision goes up');
select pg_temp.move('draft','off2','l2');
select pg_temp.ok(pg_temp.place('draft')='phys/off2/l2','a draft moves to another run of its course');
select pg_temp.move('draft','offc','lc');
select pg_temp.ok(pg_temp.place('draft')='chem/offc/lc','a draft moves to another course the teacher edits (course, run and lesson together)');
reset role;
select pg_temp.ok((select count(*)=3 from pg_temp.audits('draft','moved')),'every move is audited');
select pg_temp.ok(exists(select 1 from pg_temp.audits('draft','moved') where before_value=jsonb_build_object('courseId',pg_temp.key('phys'),'offeringId',pg_temp.key('off2'),'lessonId',pg_temp.key('l2')) and after_value=jsonb_build_object('courseId',pg_temp.key('chem'),'offeringId',pg_temp.key('offc'),'lessonId',pg_temp.key('lc'))
 and actor=pg_temp.uid('teacher')) and exists(select 1 from pg_temp.audits('draft','moved') where before_value->>'lessonId'=pg_temp.key('l1')::text and after_value->>'lessonId'=pg_temp.key('l2')::text),'the audit holds course, run and lesson before and after, and who moved it');
select pg_temp.ok((select count(*)=0 from pg_temp.audits('draft','moved') where after_value is null),'no move audit is empty');
select pg_temp.ok((select count(*)=4 from pg_temp.audits('draft','definition')),'each save still writes its definition audit');
set local role authenticated;
select pg_temp.claim('teacher');
select public.save_homework(pg_temp.h('draft'),pg_temp.key('offc'),pg_temp.key('lc'),null,pg_temp.rev('draft'),pg_temp.def('draft',false));
reset role;
select pg_temp.ok((select count(*)=3 from pg_temp.audits('draft','moved')),'a save that stays in place writes no move audit');
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.make('published',true);
select pg_temp.move('published','off1','l2');
select pg_temp.ok(pg_temp.place('published')='phys/off1/l2' and (pg_temp.hwrow(pg_temp.h('published'))).status='published','a published homework nobody has started moves to another lesson and stays published');
select pg_temp.move('published','offc','lc');
select pg_temp.ok(pg_temp.place('published')='chem/offc/lc','a published homework nobody has started moves to another course');
select pg_temp.claim('s3');
select pg_temp.ok((public.get_homework(pg_temp.h('published'))->>'lessonId')::uuid=pg_temp.key('lc'),'a student of the new course sees it in its new lesson');
select pg_temp.claim('s1');
select pg_temp.denied($s$select public.get_homework(pg_temp.h('published'))$s$,'42501','a student of the old run no longer sees it');
-- The course editor who edits only Physics may move inside Physics.
select pg_temp.claim('physonly');
select pg_temp.make('phys_only',false);
select pg_temp.move('phys_only','off1','l2');
select pg_temp.ok(pg_temp.place('phys_only')='phys/off1/l2','an editor of the course moves its homework between its lessons');

-- ---------------------------------------------------------------- 2. Refused moves
select pg_temp.claim('teacher');
select pg_temp.make('started',true);
select pg_temp.make('handed',true);
select pg_temp.claim('s1');
select public.homework_work(pg_temp.h('started'),'start');
select pg_temp.claim('s2');
select pg_temp.hand('handed');
select pg_temp.claim('teacher');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('started','off1','l2')$s$)=jsonb_build_object('code','PT409','message','Work has started; this homework stays in its lesson','reason','started'),
 'a student''s draft stops a move to another lesson: PT409 {"reason":"started"}');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('started','offc','lc')$s$)->>'reason'='started','and to another course');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('handed','off2','l1')$s$)->>'reason'='started','a hand-in stops a move to another run');
select pg_temp.ok(pg_temp.place('started')='phys/off1/l1' and pg_temp.place('handed')='phys/off1/l1','a refused move changes nothing');
select pg_temp.ok(pg_temp.refusal($s$select public.save_homework(pg_temp.h('started'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('started'),pg_temp.def('started',true))$s$)
 =jsonb_build_object('code','PT409','message','Work has started; clone a new version','reason',null),'a started homework saved in place keeps its old refusal (clone a new version)');
-- Versions: the clone of a started homework, and a clone made before anyone started.
select set_config('hm.v2',public.homework_lifecycle(pg_temp.h('started'),'clone',pg_temp.rev('started'))::text,true);
insert into pg_temp.hm_hw values('v2',current_setting('hm.v2')::uuid);
select pg_temp.ok(pg_temp.refusal($s$select public.save_homework(pg_temp.h('v2'),pg_temp.key('off1'),pg_temp.key('l2'),null,pg_temp.rev('v2'),public.get_homework(pg_temp.h('v2'))->'definition')$s$)
 =jsonb_build_object('code','PT409','message','A later version stays in its lesson','reason','versioned'),'a later version cannot move: PT409 {"reason":"versioned"}');
select pg_temp.make('cloned',false);
select set_config('hm.cloned2',public.homework_lifecycle(pg_temp.h('cloned'),'clone',pg_temp.rev('cloned'))::text,true);
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('cloned','off1','l2')$s$)->>'reason'='versioned','a first version that a later one supersedes cannot move, even with no work');
select pg_temp.ok(pg_temp.refusal($s$select public.save_homework(current_setting('hm.cloned2')::uuid,pg_temp.key('off1'),pg_temp.key('l2'),null,(pg_temp.hwrow(current_setting('hm.cloned2')::uuid)).revision,
 public.get_homework(current_setting('hm.cloned2')::uuid)->'definition')$s$)->>'reason'='versioned','nor can the later one');
-- Rights: the target course, the homework's own course, another space, an assistant.
select pg_temp.make('rights',false);
select pg_temp.denied($s$select pg_temp.move('rights','offa','la')$s$,'42501','a teacher who cannot edit the target course cannot move a homework there');
select pg_temp.claim('physonly');
select pg_temp.denied($s$select pg_temp.move('rights','offc','lc')$s$,'42501','an editor of the homework''s course only cannot move it into another course');
select pg_temp.claim('chemonly');
select pg_temp.denied($s$select pg_temp.move('rights','offc','lc')$s$,'42501','an editor of the target course only cannot take a homework from a course they do not edit');
select pg_temp.denied($s$select pg_temp.move('rights','off1','l2')$s$,'42501','nor move it inside that course');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select pg_temp.move('rights','offf','lf')$s$,'42501','another space''s teacher cannot move a homework into their own course');
select pg_temp.denied($s$select pg_temp.move('rights','off1','l2')$s$,'42501','nor inside its course');
select pg_temp.claim('ta');
select pg_temp.denied($s$select pg_temp.move('rights','off1','l2')$s$,'42501','an assistant cannot move a homework');
-- One space (the owner's answer): a teacher who edits a course in each space still cannot move a homework across.
select pg_temp.claim('both');
select pg_temp.ok(private.can_edit_course(pg_temp.key('phys')) and private.can_edit_course(pg_temp.key('foreign')),'both edits a course in each space');
select pg_temp.make('spaces',false);
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('spaces','offf','lf')$s$)=jsonb_build_object('code','PT409','message','A homework stays in its teaching space','reason','other_space'),
 'a move to a course in another space is refused even for a teacher of both: PT409 {"reason":"other_space"}');
select pg_temp.move('spaces','off2','l2');
select pg_temp.ok(pg_temp.place('spaces')='phys/off2/l2','the same teacher moves it within its space');
select pg_temp.claim('outsider');
select pg_temp.make('foreign_hw',false,'offf','lf');
select pg_temp.claim('both');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.move('foreign_hw','off1','l1')$s$)->>'reason'='other_space','and from the other space into this one');
select pg_temp.ok(pg_temp.place('foreign_hw')='foreign/offf/lf','where it was');
reset role;
select pg_temp.ok(pg_temp.place('rights')='phys/off1/l1' and (select count(*)=0 from pg_temp.audits('rights','moved')),'refused moves left it where it was, with no move audit');
set local role authenticated;
-- A lesson that is not in the target course, and a stale read.
select pg_temp.claim('teacher');
select pg_temp.denied($s$select pg_temp.move('rights','off1','lc')$s$,'23514','a lesson of another course is refused by the curriculum check');
select pg_temp.denied($s$select pg_temp.move('rights','offc','l1')$s$,'23514','a run of another course with this course''s lesson is refused too');
select pg_temp.ok(pg_temp.refusal($s$select public.save_homework(pg_temp.h('rights'),pg_temp.key('off1'),pg_temp.key('l2'),null,pg_temp.rev('rights')-1,pg_temp.def('rights',false))$s$)
 =jsonb_build_object('code','PT409','message','Homework changed; reload','reason',null),'a move sent with an old revision is stale (no reason)');
reset role;
-- The trigger holds for every writer, the database owner included.
select pg_temp.denied($s$update public.homework_assignments set lesson_id=pg_temp.key('l2') where id=pg_temp.h('handed')$s$,'23514','even the database owner cannot move a homework with a hand-in');
select pg_temp.denied($s$update public.homework_assignments set lesson_id=pg_temp.key('l2') where id=pg_temp.h('cloned')$s$,'23514','nor a homework with another version');
select pg_temp.denied($s$update public.homework_assignments set lesson_id=pg_temp.key('lc') where id=pg_temp.h('rights')$s$,'23514','the trigger still checks the lesson belongs to the course');
update public.homework_assignments set course_id=pg_temp.key('art'),offering_id=pg_temp.key('offa'),lesson_id=pg_temp.key('la') where id=pg_temp.h('rights');
select pg_temp.ok(pg_temp.place('rights')='art/offa/la','the database owner may move a homework with no work and no other version');
select pg_temp.ok(pg_temp.refusal($s$update public.homework_assignments set course_id=pg_temp.key('foreign'),offering_id=pg_temp.key('offf'),lesson_id=pg_temp.key('lf') where id=pg_temp.h('rights')$s$)
 =jsonb_build_object('code','PT409','message','A homework stays in its teaching space','reason','other_space'),'but not into another space: the trigger holds for every writer');

-- ---------------------------------------------------------------- 3. The relaxed choice rule
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.make('choice',false);
create function pg_temp.choice(n integer,rights integer,p_type text,p_published boolean,p_text text default '') returns jsonb language plpgsql set search_path='' as $$
declare opts jsonb:='[]';keys jsonb:='[]';i integer;o uuid;begin
 for i in 1..n loop o:=gen_random_uuid();opts:=opts||jsonb_build_array(jsonb_build_object('id',o,'text',case when p_text='' then '' else p_text||i end));if i<=rights then keys:=keys||jsonb_build_array(o);end if;end loop;
 return jsonb_set(pg_temp.def('choice',p_published),'{questions,0}',jsonb_build_object('id',pg_temp.q('choice','q1'),'type',p_type,'text','','imageId',null,'points',2,'responseMode','text','modelAnswer','','options',opts,'correctIds',keys));
end$$;
select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(6,2,'multiple_choice',true));
select pg_temp.ok((select count(*)=6 from public.homework_options where question_id=pg_temp.q('choice','q1')) and (select type='multiple_choice' from public.homework_questions where id=pg_temp.q('choice','q1')),
 'six blank answers with two right ones publish as multiple choice, with no question text');
select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(2,1,'single_choice',true));
select pg_temp.ok((select count(*)=2 from public.homework_options where question_id=pg_temp.q('choice','q1')),'two blank answers with one right one publish');
select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(8,8,'multiple_choice',true));
select pg_temp.ok((select count(*)=8 from public.homework_options where question_id=pg_temp.q('choice','q1')),'eight blank answers, all right, publish');
select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(5,1,'single_choice',true,'Answer '));
select pg_temp.ok((select count(*)=5 from public.homework_options where question_id=pg_temp.q('choice','q1') and text like 'Answer %'),'answers with text still save');
select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(3,0,'single_choice',false));
select pg_temp.ok((select count(*)=3 from public.homework_options where question_id=pg_temp.q('choice','q1')),'a draft may have no right answer yet');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(9,1,'single_choice',false))$s$,'23514','nine answers are refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(1,1,'single_choice',false))$s$,'23514','one answer is refused');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(4,0,'single_choice',true))$s$,'23514','publishing needs a right answer');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),pg_temp.choice(4,2,'single_choice',false))$s$,'23514','single choice has one right answer');
select pg_temp.ok(pg_temp.refusal($s$with d as (select pg_temp.choice(4,1,'multiple_choice',false) d) select public.save_homework(pg_temp.h('choice'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('choice'),
 jsonb_set(d.d,'{questions,0,correctIds}',(d.d->'questions'->0->'correctIds')||(d.d->'questions'->0->'correctIds'))) from d$s$)=jsonb_build_object('code','23514','message','Invalid choice structure/key','reason',null),'a right answer listed twice is refused');

-- ---------------------------------------------------------------- 4. The model answer picture
select pg_temp.make('model',false,'off1','l1',jsonb_build_object('deadline',pg_temp.at('3 days'),'solutionsOpen','after_hand_in'));
reset role;
select set_config('hm.pic',pg_temp.upload('model','solution','image/png')::text,true);
select set_config('hm.pdf',pg_temp.upload('model','solution','application/pdf')::text,true);
select set_config('hm.qpic',pg_temp.upload('model','question','image/jpeg')::text,true);
select set_config('hm.otherpic',pg_temp.upload('draft','solution','image/png')::text,true);
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('model'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('model'),pg_temp.def('model',false,current_setting('hm.pdf')::uuid))$s$,'23514','a model answer picture is an image, not a PDF');
select pg_temp.ok(pg_temp.refusal($s$select public.save_homework(pg_temp.h('model'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('model'),pg_temp.def('model',false,current_setting('hm.pdf')::uuid))$s$)->>'message'='A model answer picture is an image','and the refusal says so');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('model'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('model'),pg_temp.def('model',false,current_setting('hm.qpic')::uuid))$s$,'42501','a question picture upload is not a model answer upload');
select pg_temp.denied($s$select public.save_homework(pg_temp.h('model'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('model'),pg_temp.def('model',false,current_setting('hm.otherpic')::uuid))$s$,'42501','another homework''s upload is refused');
select public.save_homework(pg_temp.h('model'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('model'),pg_temp.def('model',true,current_setting('hm.pic')::uuid));
reset role;
select pg_temp.ok((select model_image_id=current_setting('hm.pic')::uuid from private.homework_keys where question_id=pg_temp.q('model','q2')),'the picture is stored with the question''s key');
select pg_temp.ok((select model_image_id is null from private.homework_keys where question_id=pg_temp.q('model','q1')),'a question without one has none');
set local role authenticated;
select pg_temp.ok(((public.get_homework(pg_temp.h('model'))->'definition'->'questions'->1->>'modelImageId'))::uuid=current_setting('hm.pic')::uuid,'the teacher reads it back in the definition');
select pg_temp.ok(pg_temp.reads(current_setting('hm.pic')::uuid) and pg_temp.gets('model',current_setting('hm.pic')::uuid),'staff read it from Storage and through the upload read');
select pg_temp.denied($s$select public.homework_upload(pg_temp.h('model'),'archive',current_setting('hm.pic')::uuid)$s$,'42501','a picture a key uses cannot be archived');
select pg_temp.claim('ta');
select pg_temp.ok(pg_temp.reads(current_setting('hm.pic')::uuid),'an assistant of the run reads it');
-- Students: closed before their hand-in.
select pg_temp.claim('s1');
select pg_temp.ok(public.get_homework(pg_temp.h('model'))->'solutions'='null'::jsonb and (public.get_homework(pg_temp.h('model'))->'definition'->'questions'->1->'modelImageId')='null'::jsonb,'before a hand-in a student gets no solutions and no picture id');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic')::uuid),'before a hand-in Storage refuses the picture by its path');
select pg_temp.ok(not pg_temp.gets('model',current_setting('hm.pic')::uuid),'and the upload read refuses it');
select pg_temp.hand('model');
select pg_temp.ok(pg_temp.model_key('model')=current_setting('hm.pic')::uuid,'after the hand-in the solutions carry the picture id');
select pg_temp.ok(pg_temp.reads(current_setting('hm.pic')::uuid) and pg_temp.gets('model',current_setting('hm.pic')::uuid),'and Storage and the upload read give it');
select pg_temp.claim('s2');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic')::uuid) and not pg_temp.gets('model',current_setting('hm.pic')::uuid),'a classmate who has not handed in still cannot read it');
select pg_temp.claim('s3');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic')::uuid),'a student of another course cannot read it by path');
select pg_temp.denied($s$select public.homework_upload(pg_temp.h('model'),'get',current_setting('hm.pic')::uuid)$s$,'42501','nor through the upload read');
select pg_temp.claim('outsider');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic')::uuid),'another space''s teacher cannot read it by path');
reset role;
select pg_temp.ok(not has_function_privilege('anon','private.homework_storage(text,text,text)','execute') and not has_function_privilege('anon','public.homework_upload(uuid,text,uuid,uuid,jsonb)','execute'),'a signed-out caller has no way to read the picture');
-- After the deadline, and after a reschedule (solutions after the deadline).
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.make('later',false,'off1','l1',jsonb_build_object('deadline',pg_temp.at('3 days'),'solutionsOpen','after_deadline'));
reset role;
select set_config('hm.pic2',pg_temp.upload('later','solution','image/jpeg')::text,true);
set local role authenticated;
select pg_temp.claim('teacher');
select public.save_homework(pg_temp.h('later'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('later'),pg_temp.def('later',true,current_setting('hm.pic2')::uuid,jsonb_build_object('deadline',pg_temp.at('3 days'),'solutionsOpen','after_deadline')));
select pg_temp.claim('s1');
select pg_temp.hand('later');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic2')::uuid) and pg_temp.model_key('later') is null,'solutions after the deadline: closed right after the hand-in, picture included');
select pg_temp.set_deadline('later','-1 second');
select pg_temp.ok(pg_temp.reads(current_setting('hm.pic2')::uuid) and pg_temp.model_key('later')=current_setting('hm.pic2')::uuid,'open once the deadline passes, picture included');
select pg_temp.claim('s2');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic2')::uuid),'not for a student who did not hand in');
select pg_temp.claim('teacher');
select public.homework_lifecycle(pg_temp.h('later'),'reschedule',pg_temp.rev('later'),jsonb_build_object('deadline',pg_temp.at('2 days')));
select pg_temp.claim('s1');
select pg_temp.ok(pg_temp.reads(current_setting('hm.pic2')::uuid) and pg_temp.model_key('later')=current_setting('hm.pic2')::uuid,'after a reschedule a student who already saw the solutions keeps the picture');
select pg_temp.claim('s2');
select pg_temp.hand('later');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.pic2')::uuid) and pg_temp.model_key('later') is null,'a student who hands in after the reschedule waits for the new deadline');
-- A choice question's model answer may carry a picture too, opened the same way.
select pg_temp.claim('teacher');
select pg_temp.make('cmodel',false,'off1','l1',jsonb_build_object('deadline',pg_temp.at('3 days'),'solutionsOpen','after_hand_in'));
reset role;
select set_config('hm.cpic',pg_temp.upload('cmodel','solution','image/webp')::text,true);
set local role authenticated;
select pg_temp.claim('teacher');
select public.save_homework(pg_temp.h('cmodel'),pg_temp.key('off1'),pg_temp.key('l1'),null,pg_temp.rev('cmodel'),
 jsonb_set(jsonb_set(pg_temp.def('cmodel',true),'{questions,0,modelImageId}',to_jsonb(current_setting('hm.cpic'))),'{questions,0,modelAnswer}','"B, because the current halves"'));
select pg_temp.ok(((public.get_homework(pg_temp.h('cmodel'))->'definition'->'questions'->0->>'modelImageId'))::uuid=current_setting('hm.cpic')::uuid,'a choice question keeps its model answer picture');
create function pg_temp.choice_key(p_label text) returns jsonb language sql as $$
 select k from jsonb_array_elements(public.get_homework(pg_temp.h(p_label))->'solutions'->'keys') k where (k->>'questionId')::uuid=pg_temp.q(p_label,'q1')$$;
select pg_temp.claim('s1');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.cpic')::uuid) and not pg_temp.gets('cmodel',current_setting('hm.cpic')::uuid),'before the solutions open a student cannot read a choice question''s picture');
select pg_temp.hand('cmodel');
select pg_temp.ok((pg_temp.choice_key('cmodel')->>'modelImageId')::uuid=current_setting('hm.cpic')::uuid and pg_temp.choice_key('cmodel')->>'modelAnswer'='B, because the current halves'
 and pg_temp.reads(current_setting('hm.cpic')::uuid),'once they open: its explanation, its picture id and the picture by path');
select pg_temp.claim('s2');
select pg_temp.ok(not pg_temp.reads(current_setting('hm.cpic')::uuid),'not for a classmate who has not handed in');
-- The clone copies it to a new path, like the other solution media.
select pg_temp.claim('teacher');
select set_config('hm.model2',public.homework_lifecycle(pg_temp.h('model'),'clone',pg_temp.rev('model'))::text,true);
reset role;
select pg_temp.ok((select k.model_image_id is not null and k.model_image_id<>current_setting('hm.pic')::uuid and u.assignment_id=current_setting('hm.model2')::uuid and u.status='pending' and u.purpose='solution'
  and exists(select 1 from private.homework_clone_sources c where c.upload_id=u.id and c.source_id=current_setting('hm.pic')::uuid)
 from private.homework_keys k join public.homework_questions q on q.id=k.question_id join private.homework_uploads u on u.id=k.model_image_id where q.assignment_id=current_setting('hm.model2')::uuid and q.position=1),
 'a clone points its key at a copy of the picture under the new version''s own path');
select pg_temp.ok((select count(*)=0 from private.homework_keys k join public.homework_questions q on q.id=k.question_id where q.assignment_id=current_setting('hm.model2')::uuid and q.position=0 and k.model_image_id is not null),'and copies nothing for a question without one');
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.ok((public.get_homework(current_setting('hm.model2')::uuid)->>'mediaCopyPending')::boolean,'the copy shows as pending until the server copies the file');
select pg_temp.ok(pg_temp.refusal($s$select public.homework_lifecycle(current_setting('hm.model2')::uuid,'publish',(pg_temp.hwrow(current_setting('hm.model2')::uuid)).revision)$s$)->>'message'='Finish cloned media before publishing','the new version cannot be published before its picture is copied');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.homework_upload(current_setting('hm.model2')::uuid,'clone-tasks')) t where t->>'sourcePath'=pg_temp.path(current_setting('hm.pic')::uuid)),'the copy is one of the clone tasks the server finishes');

-- ---------------------------------------------------------------- 5. Questions and marks on the Homework page
create function pg_temp.portal_rows() returns jsonb language plpgsql set search_path='' as $$declare acc jsonb:='[]';t text;r jsonb;page integer;begin
 foreach t in array array['open','closed','drafts'] loop page:=0;
  loop r:=public.homework_portal(null,t,page)->'rows'; exit when jsonb_array_length(r)=0; acc:=acc||r; page:=page+1; end loop; end loop; return acc; end$$;
create function pg_temp.naive_counts(i uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('questionCount',(select count(*) from public.homework_questions where assignment_id=i),
  'totalMarks',(select case when a.mode='FILE_UPLOAD' then a.file_points else (select coalesce(sum(points),0) from public.homework_questions where assignment_id=i) end from public.homework_assignments a where a.id=i))$$;
select pg_temp.ok((select count(*)>=8 from jsonb_array_elements(pg_temp.portal_rows())),'the page lists the teacher''s homework');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.portal_rows()) r where jsonb_build_object('questionCount',r->'questionCount','totalMarks',r->'totalMarks')<>pg_temp.naive_counts((r->>'id')::uuid)),
 'every row''s questions and marks equal a naive count');
select pg_temp.ok((select (r->>'questionCount')::int=2 and (r->>'totalMarks')::int=7 from jsonb_array_elements(pg_temp.portal_rows()) r where (r->>'id')::uuid=pg_temp.h('published')),'two questions, seven marks');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.homework_portal(null,'open',0)->'toCorrect') r where (r->>'id')::uuid=pg_temp.h('handed') and (r->>'questionCount')::int=2 and (r->>'totalMarks')::int=7),'To correct rows carry them too');
select pg_temp.claim('physonly');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.portal_rows()) r where (r->>'courseId')::uuid<>pg_temp.key('phys')),'a Physics editor still sees only Physics homework');
select pg_temp.claim('outsider');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.portal_rows()) r where (r->>'courseId')::uuid<>pg_temp.key('foreign')),'another space''s teacher sees none of it (only their own space''s homework)');
reset role;

-- ---------------------------------------------------------------- 6. Shape and grants
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.save_homework(uuid,uuid,uuid,uuid,bigint,jsonb,boolean)'::regprocedure)
 and (select not prosecdef from pg_proc where oid='public.save_homework(uuid,uuid,uuid,uuid,bigint,jsonb,boolean)'::regprocedure),'save_homework stays a private definer behind an invoker wrapper');
select pg_temp.ok(not has_function_privilege('anon','public.save_homework(uuid,uuid,uuid,uuid,bigint,jsonb,boolean)','execute') and not has_function_privilege('anon','private.homework_portal(uuid,text,integer)','execute')
 and has_function_privilege('authenticated','private.get_homework(uuid,uuid)','execute') and not has_function_privilege('authenticated','private.homework_upload_referenced(uuid)','execute'),'grants are unchanged');
select pg_temp.ok((select relrowsecurity and not has_table_privilege('authenticated',c.oid,'select') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='homework_keys'),'the keys, picture included, stay private');
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('save_homework','get_homework','homework_portal','homework_lifecycle','homework_upload','homework_integrity','homework_upload_visible','homework_upload_referenced') and p.prosrc ~ 'auth\.uid\(\)'),'no replaced function uses auth.uid()');
select count(*)::integer homework_move_tests from hm_results;
rollback;
