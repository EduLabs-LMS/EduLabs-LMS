-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities, non-UUID subjects); every change rolls back; no real account.
-- Covers migration 20261114120000_exams.sql: authoring and the derived choice type; windows (auto, picked, custom, a session moved before and after
-- opening, cancelled, a Group added after publishing, no Group, a student in two Groups); the deadline; late saves; tries (one time, fix mistakes,
-- from zero); the stored mixed order; grading (choice, number tolerance, essay); release after the student's window, bulk all or nothing;
-- auto-release; notices once per release; answer review (model photo through Storage) only after the LAST close and only to takers; paper marks
-- (halves, Absent, release, a reason to change a released mark); assistant rights; cross-tenant denial; the legacy builder closed.
-- Moving time: a test moves a window into the past by updating the stored row as the owner (the database clock cannot be set).
-- Races on separate connections: scripts/exams-concurrency.cjs. Demo Clear: exams-demo.sql. Reads against a naive query: section 12.
begin;
create temp table ex_results(name text primary key);
create temp table ex_users(label text primary key,id uuid not null);
create temp table ex_ids(label text primary key,id uuid not null);
grant select,insert,update on ex_results,ex_users,ex_ids to authenticated,anon;
select set_config('ex.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.ex_results values(label);end$$;
-- The refusal as {code, message, reason}.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.denied(statement text,code text,label text,reason text default null) returns void language plpgsql set search_path='' as $$declare r jsonb;begin
 r:=pg_temp.refusal(statement);
 if r->>'code' is distinct from code or (reason is not null and r->>'reason' is distinct from reason) then raise exception 'FAILED % expected % % got %',label,code,coalesce(reason,''),r; end if;
 insert into pg_temp.ex_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('ex.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','ex-'||current_setting('ex.run')||'-'||label)::text,true);end$$;
create function pg_temp.sub(label text) returns text language sql as $$select 'ex-'||current_setting('ex.run')||'-'||label$$;
-- The server's byte check for an upload (exam_upload claim), added to the current claims.
create function pg_temp.attest(p_upload uuid,p_size bigint) returns void language sql as $$
 select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('iat',extract(epoch from now())::bigint,'exam_upload',jsonb_build_object('id',p_upload,'size',p_size,'sha256',repeat('c',64))))::text,true)$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.ex_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.ex_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.ex_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
create function pg_temp.rev(p_exam uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.exams where id=p_exam$$;
create function pg_temp.exam(p_exam uuid) returns private.exams language sql security definer set search_path='' as $$select * from private.exams where id=p_exam$$;
create function pg_temp.try_of(p_exam uuid,p_user text) returns private.exam_attempts language sql security definer set search_path='' as $$
 select * from private.exam_attempts where exam_id=p_exam and user_id=pg_temp.uid(p_user) order by number desc limit 1$$;
create function pg_temp.result_of(p_exam uuid,p_user text) returns private.exam_results language sql security definer set search_path='' as $$
 select * from private.exam_results where exam_id=p_exam and user_id=pg_temp.uid(p_user)$$;
create function pg_temp.q(p_exam uuid,p_pos integer) returns uuid language sql security definer set search_path='' as $$select id from private.exam_questions where exam_id=p_exam and position=p_pos$$;
create function pg_temp.opt(p_exam uuid,p_pos integer,p_opt integer) returns uuid language sql security definer set search_path='' as $$
 select o.id from private.exam_options o join private.exam_questions q on q.id=o.question_id where q.exam_id=p_exam and q.position=p_pos and o.position=p_opt$$;
create function pg_temp.win(p_exam uuid,p_group uuid) returns record language sql security definer set search_path='' as $$
 select (w.source,w.session_id,w.opens_at,w.closes_at,w.state,w.frozen,w.stored) from private.exam_windows(p_exam) w where w.group_id=p_group$$;
create function pg_temp.notices(p_result uuid) returns integer language sql security definer set search_path='' as $$
 select count(*)::int from private.notification_events e join public.notifications n on n.event_id=e.id where e.event_type='exam_released' and e.resource_id=p_result$$;
-- Student actions on the latest try.
create function pg_temp.start(p_exam uuid) returns jsonb language sql as $$select public.exam_work(p_exam,'start',null,'{}')$$;
create function pg_temp.answer(p_exam uuid,p_user text,p_data jsonb) returns jsonb language sql as $$
 select public.exam_work(p_exam,'save',(pg_temp.try_of(p_exam,p_user)).revision,p_data||jsonb_build_object('attemptId',(pg_temp.try_of(p_exam,p_user)).id))$$;
create function pg_temp.submit(p_exam uuid,p_user text) returns jsonb language sql as $$
 select public.exam_work(p_exam,'submit',(pg_temp.try_of(p_exam,p_user)).revision,jsonb_build_object('attemptId',(pg_temp.try_of(p_exam,p_user)).id))$$;
create function pg_temp.release(p_exam uuid,p_user text) returns jsonb language sql as $$
 select public.exam_work(p_exam,'release',(pg_temp.result_of(p_exam,p_user)).revision,jsonb_build_object('resultId',(pg_temp.result_of(p_exam,p_user)).id))$$;
-- Close a Group's window now (the stored, frozen times move into the past) or the one window of a same-time exam.
create function pg_temp.close_group(p_exam uuid,p_group uuid) returns void language sql security definer set search_path='' as $$
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,frozen_opens_at,frozen_closes_at) values(p_exam,p_group,'custom',now()-interval '3 hours',now()-interval '2 hours',now()-interval '3 hours',clock_timestamp()-interval '1 second')
 on conflict(exam_id,group_id) do update set frozen_opens_at=now()-interval '3 hours',frozen_closes_at=clock_timestamp()-interval '1 second'$$;
create function pg_temp.close_all(p_exam uuid) returns void language sql security definer set search_path='' as $$
 update private.exams set opens_at=now()-interval '3 hours',closes_at=clock_timestamp()-interval '1 second' where id=p_exam and timing='same_time';
 select pg_temp.close_group(p_exam,g.id) from public.study_groups g join private.exams e on e.offering_id=g.offering_id where e.id=p_exam and e.timing='per_group' and g.status='active';
$$;
-- Four questions: a single choice (B right, 2 points), a multiple choice (A and C right, 3), a number (9.81 +- 0.05, 2), an essay (text or photo, 5).
create function pg_temp.questions(p_essay boolean default true) returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('type','choice','text','Unit of current?','points',2,'options',jsonb_build_array('Volt','Ampere','Ohm'),'correct',jsonb_build_array(1),'modelText','Ampere'),
  jsonb_build_object('type','choice','text','Vectors?','points',3,'options',jsonb_build_array('Force','Mass','Velocity','Time'),'correct',jsonb_build_array(0,2)),
  jsonb_build_object('type','number','text','g in m/s2','points',2,'numberValue',9.81,'tolerance',0.05))
 ||case when p_essay then jsonb_build_array(jsonb_build_object('type','essay','text','Explain Ohm''s law','points',5,'responseMode','both','modelText','V = IR')) else '[]'::jsonb end$$;

-- Everyone signs in with Firebase first.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','editor','ta','ta2','s1','s2','s3','s4','s5','s6','s7','sb','outsider'] loop
  perform pg_temp.claim(label); insert into pg_temp.ex_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
select pg_temp.put(k,gen_random_uuid()) from unnest(array['org','org_b','course','course_b','off','off2','off_b','ch','ch2','ch_b','g1','g2','g3','g4','g5']) k;
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic exams','ex-'||current_setting('ex.run')),(pg_temp.key('org_b'),'Synthetic other','ex-b-'||current_setting('ex.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('editor','teacher'),('ta','assistant'),('ta2','assistant')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org'),'Synthetic Physics','ex-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','ex-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('course'),pg_temp.uid('editor'),'editor');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),
 (pg_temp.key('off2'),pg_temp.key('course'),'Second run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('ta'),'teaching_assistant'),(pg_temp.key('off'),pg_temp.uid('ta2'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off'),pg_temp.uid(l),'active',now()-interval '1 day' from unnest(array['s1','s2','s3','s4','s5','s6','s7']) l;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '1 day');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('ch'),pg_temp.key('course'),'Electricity',0),(pg_temp.key('ch2'),pg_temp.key('course'),'Mechanics',1),(pg_temp.key('ch_b'),pg_temp.key('course_b'),'Foreign',0);
-- Groups: G1 open now (s1, s2), G2 tomorrow (s3), G3 in two hours (s4), G5 has no session; s5 is in no Group; s7 is in G1 too. G4 is added after publishing.
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values
 (pg_temp.key('g1'),pg_temp.key('off'),'G1 open','center','Room 1',pg_temp.uid('owner')),(pg_temp.key('g2'),pg_temp.key('off'),'G2 tomorrow','center','Room 2',pg_temp.uid('owner')),
 (pg_temp.key('g3'),pg_temp.key('off'),'G3 later','center','Room 3',pg_temp.uid('owner')),(pg_temp.key('g5'),pg_temp.key('off'),'G5 no session','center','Room 5',pg_temp.uid('owner'));
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select v.g,e.offering_id,e.user_id,e.id,now()-interval '10 days',pg_temp.uid('owner')
 from (values (pg_temp.key('g1'),'s1'),(pg_temp.key('g1'),'s2'),(pg_temp.key('g2'),'s3'),(pg_temp.key('g3'),'s4'),(pg_temp.key('g1'),'s7')) v(g,l)
 join public.enrollments e on e.offering_id=pg_temp.key('off') and e.user_id=pg_temp.uid(v.l);
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by)
 select pg_temp.put(v.k,gen_random_uuid()),v.g,v.k,v.t,v.t+v.d,v.t,v.t+v.d,'center',pg_temp.uid('owner'),pg_temp.uid('owner') from (values
  ('s_g1',pg_temp.key('g1'),now()-interval '10 minutes',interval '2 hours'),
  ('s_g2',pg_temp.key('g2'),now()+interval '1 day',interval '1 hour'),('s_g2b',pg_temp.key('g2'),now()+interval '3 days',interval '1 hour'),
  ('s_g3',pg_temp.key('g3'),now()+interval '2 hours',interval '1 hour'),('s_g3b',pg_temp.key('g3'),now()+interval '4 days',interval '1 hour')) v(k,g,t,d);

-- ---------------------------------------------------------------- 1. Authoring and the derived choice type
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.put('oe',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','Unit test','timeLimitMinutes',30,
 'startingFrom',((now() at time zone 'Africa/Cairo')::date-1)::text,'questions',pg_temp.questions(),'chapterIds',jsonb_build_array(pg_temp.key('ch'))))->>'id')::uuid);
select pg_temp.ok((select status='draft' and kind='online' and timing='per_group' and tries_mode='one_time' and time_limit_minutes=30 and revision=1 and family_id=id and version=1 from pg_temp.exam(pg_temp.key('oe'))),
 'a new online exam is a draft, per Group, one time, with its time limit');
reset role;
select pg_temp.ok((select array_agg(type order by position)=array['single_choice','multiple_choice','number','essay'] from private.exam_questions where exam_id=pg_temp.key('oe')),
 'one right answer makes a single choice, two make a multiple choice (the type is derived)');
select pg_temp.ok((select k.correct_option_ids=array[pg_temp.opt(pg_temp.key('oe'),1,0),pg_temp.opt(pg_temp.key('oe'),1,2)] from private.exam_keys k where k.question_id=pg_temp.q(pg_temp.key('oe'),1)),'the key holds the right options');
select pg_temp.ok((select number_value=9.81 and number_tolerance=0.05 from private.exam_keys where question_id=pg_temp.q(pg_temp.key('oe'),2)),'a number question keeps its value and tolerance');
set local role authenticated;
select pg_temp.claim('editor');
select pg_temp.ok((public.exam_save(null,pg_temp.key('off'),null,'{"kind":"paper","title":"Editor paper"}')->>'status')='draft','a course editor creates exams (course edit rights)');
select pg_temp.claim('ta');
select pg_temp.denied($s$select public.exam_save(null,pg_temp.key('off'),null,'{"kind":"online"}')$s$,'42501','an assistant cannot author');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,'{"title":"x"}')$s$,'42501','an assistant cannot edit');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select public.exam_save(null,pg_temp.key('off'),null,'{"kind":"online"}')$s$,'42501','another space''s teacher cannot author here');
select pg_temp.claim('owner');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,0,'{"title":"x"}')$s$,'PT409','a stale revision is refused','stale');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,'{"colour":"red"}')$s$,'23514','an unknown field is refused');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','options',jsonb_build_array('a','b'),'correct','[]'::jsonb))))$s$,'23514','a choice needs a right answer');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','options',jsonb_build_array('a','b','c','d','e','f','g','h','i'),'correct','[0]'::jsonb))))$s$,'23514','at most eight options (A to H)');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','options',jsonb_build_array('a','b'),'correct','[2]'::jsonb))))$s$,'23514','a right answer must be an option');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','number','text','x'))))$s$,'23514','a number question needs its number');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','options',jsonb_build_array('a','b'),'correct','[0]'::jsonb,'responseMode','photo'))))$s$,'23514','photo answers are for essays only');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,'{"maxMarks":20}')$s$,'23514','an online exam has no maximum mark');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,'{"timing":"same_time","opensAt":"2030-01-01T10:00","closesAt":"2030-01-01T11:00"}')$s$,'23514','a time without an offset is refused');
select pg_temp.denied($s$select public.exam_save(pg_temp.key('oe'),null,1,jsonb_build_object('chapterIds',jsonb_build_array(pg_temp.key('ch_b'))))$s$,'23514','a chapter of another course is refused');
select pg_temp.ok((public.exam_save(pg_temp.key('oe'),null,1,'{"autoRelease":true}')->>'revision')::int=2,'a draft may hold auto-release while it is edited');
select pg_temp.denied($s$select public.exam_lifecycle(pg_temp.key('oe'),'publish',2)$s$,'23514','publishing auto-release with an essay is refused');
select pg_temp.ok((public.exam_save(pg_temp.key('oe'),null,2,'{"autoRelease":false}')->>'revision')::int=3,'auto-release off again');
select pg_temp.put('empty',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','startingFrom','2030-01-01'))->>'id')::uuid);
select pg_temp.denied($s$select public.exam_lifecycle(pg_temp.key('empty'),'publish',1)$s$,'23514','publishing without a question is refused');
select pg_temp.ok((public.exam_lifecycle(pg_temp.key('oe'),'publish',3)->>'status')='published','the owner publishes');
reset role;
-- ---------------------------------------------------------------- 2. Windows
select pg_temp.ok(pg_temp.win(pg_temp.key('oe'),pg_temp.key('g1'))::text=row('auto',pg_temp.key('s_g1'),(select starts_at from public.group_sessions where id=pg_temp.key('s_g1')),(select ends_at from public.group_sessions where id=pg_temp.key('s_g1')),'ok',false,true)::text,
 'G1 is linked automatically to its first session on or after the starting day, and stored');
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g3'))::text) like '(auto,'||pg_temp.key('s_g3')||',%,ok,f,t)','G3 is linked to its session in two hours');
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g5'))::text) like '(auto,,,,needs_time,f,f)','G5 (no session) needs a time and is not stored');
select pg_temp.ok(private.exam_last_close(pg_temp.key('oe')) is null,'while a Group needs a time there is no LAST close (review and auto-release wait)');
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.denied($s$select public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g5'),4,jsonb_build_object('source','custom','opensAt',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')))$s$,'23514','a custom window must open in the future');
select pg_temp.ok((public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g5'),4,jsonb_build_object('source','custom','opensAt',to_char(now()+interval '5 days','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '5 days 1 hour','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')))->>'revision')::int=5,
 'G5 gets a custom window');
select pg_temp.denied($s$select public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g1'),5,jsonb_build_object('source','picked','sessionId',pg_temp.key('s_g1')))$s$,'PT409','an opened Group window cannot change','window_open');
select pg_temp.denied($s$select public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g2'),4,'{"source":"auto"}')$s$,'PT409','a window change with an old revision is refused','stale');
select pg_temp.claim('ta');
select pg_temp.denied($s$select public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g2'),5,'{"source":"auto"}')$s$,'42501','an assistant cannot change windows');
reset role;
select pg_temp.ok(private.exam_last_close(pg_temp.key('oe'))=(select max(x) from (select ends_at x from public.group_sessions where id in (pg_temp.key('s_g1'),pg_temp.key('s_g2'),pg_temp.key('s_g3')) union all select custom_closes_at from private.exam_group_windows where group_id=pg_temp.key('g5')) y),
 'with every Group timed, the LAST close is the latest window end');
-- A session moved BEFORE its window opened: the exam follows it.
update public.group_sessions set starts_at=now()+interval '2 days',ends_at=now()+interval '2 days 1 hour' where id=pg_temp.key('s_g2');
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g2'))::text) like '(auto,'||pg_temp.key('s_g2')||',%,ok,f,t)' and (select opens_at from private.exam_windows(pg_temp.key('oe')) where group_id=pg_temp.key('g2'))=now()+interval '2 days',
 'G2''s session moved before opening: the window follows it, nothing is frozen');
-- A cancelled linked session: held until the teacher picks another session.
update public.group_sessions set cancelled=true where id=pg_temp.key('s_g3');
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g3'))::text) like '(auto,'||pg_temp.key('s_g3')||',,,cancelled,f,t)' and private.exam_last_close(pg_temp.key('oe')) is null,
 'G3''s linked session was cancelled: its window is cancelled and the LAST close is held');
set local role authenticated;
select pg_temp.claim('s4');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('oe'))$s$,'PT409','a student of a cancelled window cannot start','no_window');
select pg_temp.claim('owner');
select pg_temp.ok((select (x->'holds'->0->>'state')='cancelled' and (x->'holds'->0->>'groupId')::uuid=pg_temp.key('g3') from public.exam_get(pg_temp.key('oe')) x),'the teacher''s read flags the held Group');
select pg_temp.ok((public.exam_set_window(pg_temp.key('oe'),pg_temp.key('g3'),5,jsonb_build_object('source','picked','sessionId',pg_temp.key('s_g3b')))->>'revision')::int=6,'the teacher picks G3''s next session');
reset role;
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g3'))::text) like '(picked,'||pg_temp.key('s_g3b')||',%,ok,f,t)' and private.exam_last_close(pg_temp.key('oe')) is not null,'G3 is picked and the hold is gone');
-- A Group added after publishing is linked by the same rule at the next read.
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values(pg_temp.key('g4'),pg_temp.key('off'),'G4 added','center','Room 4',pg_temp.uid('owner'));
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by)
 values(pg_temp.put('s_g4',gen_random_uuid()),pg_temp.key('g4'),'G4 first',now()+interval '6 days',now()+interval '6 days 1 hour',now()+interval '6 days',now()+interval '6 days 1 hour','center',pg_temp.uid('owner'),pg_temp.uid('owner'));
select pg_temp.ok((pg_temp.win(pg_temp.key('oe'),pg_temp.key('g4'))::text) like '(auto,'||pg_temp.key('s_g4')||',%,ok,f,f)','G4 (added after publishing) already follows the rule, not stored yet');
set local role authenticated; select pg_temp.claim('s1'); select public.exam_get(pg_temp.key('oe')) is not null; reset role;
select pg_temp.ok((select source='auto' and session_id=pg_temp.key('s_g4') from private.exam_group_windows where exam_id=pg_temp.key('oe') and group_id=pg_temp.key('g4')),'the next read stores G4''s link with source auto');

-- ---------------------------------------------------------------- 3. Starting, the deadline, the stored order, saving
set local role authenticated;
select pg_temp.claim('s3');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('oe'))$s$,'PT409','G2''s window has not opened','not_open');
select pg_temp.claim('s1');
select pg_temp.ok((select x->>'status'='in_progress' and jsonb_array_length(x->'items')=4 and not (x->'items'->0 ? 'correctOptionIds') and (x->'items'->0->'mark')='null'::jsonb from pg_temp.start(pg_temp.key('oe')) x),
 'a G1 student starts: four questions, no keys, no marks');
select pg_temp.ok((pg_temp.start(pg_temp.key('oe'))->>'id')::uuid=(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'starting again resumes the same try');
reset role;
select pg_temp.ok((select deadline_at=started_at+interval '30 minutes' and window_group_id=pg_temp.key('g1') and number=1 from pg_temp.try_of(pg_temp.key('oe'),'s1')),'the deadline is the start plus the time limit (inside the window)');
select pg_temp.ok((select count(*)=4 from private.exam_attempt_items where attempt_id=(pg_temp.try_of(pg_temp.key('oe'),'s1')).id),'the try stores its paper');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.ok((select x->>'savedAt' is not null from pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('oe'),0,1)))) x),'s1 answers the single choice (right)');
select pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),1),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('oe'),1,0))));
select pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),2),'numberValue',9.8));
select pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'text','Voltage equals current times resistance'));
select pg_temp.denied($s$select pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('oe'),0,0),pg_temp.opt(pg_temp.key('oe'),0,1))))$s$,'23514','a single choice takes one option');
select pg_temp.denied($s$select pg_temp.answer(pg_temp.key('oe'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('oe'),1,0))))$s$,'23514','an option of another question is refused');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'save',7,jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'questionId',pg_temp.q(pg_temp.key('oe'),2),'numberValue',1))$s$,'PT409','a save with another try revision is refused','stale');
select pg_temp.claim('s2');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'save',0,jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'questionId',pg_temp.q(pg_temp.key('oe'),2),'numberValue',1))$s$,'42501','another student cannot write into s1''s try');
select pg_temp.claim('s1');
select pg_temp.ok((pg_temp.submit(pg_temp.key('oe'),'s1')->>'status')='submitted','s1 hands in');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('oe'))$s$,'PT409','one time: no second try','no_tries_left');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'retry',null,'{}')$s$,'PT409','one time: no retry','no_tries_left');
reset role;
-- Grading: choice exact set, multiple partial is 0, number inside the tolerance, an essay waits.
select pg_temp.ok((select array_agg(m.points order by q.position)::text='{2.0,0.0,2.0,NULL}' from private.exam_marks m join private.exam_questions q on q.id=m.question_id where m.attempt_id=(pg_temp.try_of(pg_temp.key('oe'),'s1')).id),
 'marks: single right 2, multiple half-right 0, number within 0.05 is 2, the essay waits');
select pg_temp.ok((select status='waiting' and score is null and max_score=12 and final_attempt_id=(pg_temp.try_of(pg_temp.key('oe'),'s1')).id from pg_temp.result_of(pg_temp.key('oe'),'s1')),'the result waits for the essay mark');
-- A session moved AFTER its window opened: the window keeps the times it opened with.
update public.group_sessions set starts_at=now()+interval '8 days',ends_at=now()+interval '8 days 1 hour' where id=pg_temp.key('s_g1');
select pg_temp.ok((select frozen and opens_at=now()-interval '10 minutes' and closes_at=now()+interval '110 minutes' and state='ok' from private.exam_windows(pg_temp.key('oe')) where group_id=pg_temp.key('g1')),
 'G1''s session moved after opening: the window keeps its opened times (frozen)');
set local role authenticated; select pg_temp.claim('s2');
select pg_temp.ok((pg_temp.start(pg_temp.key('oe'))->>'status')='in_progress','s2 still starts inside G1''s frozen window');
-- Late saves: once the deadline passed a save is refused, and the next read hands the try in as it stood.
select pg_temp.answer(pg_temp.key('oe'),'s2',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('oe'),0,0))));
reset role;
update private.exam_attempts set started_at=now()-interval '40 minutes',deadline_at=clock_timestamp()-interval '1 second' where id=(pg_temp.try_of(pg_temp.key('oe'),'s2')).id;
set local role authenticated; select pg_temp.claim('s2');
select pg_temp.denied($s$select pg_temp.answer(pg_temp.key('oe'),'s2',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),2),'numberValue',9.81))$s$,'PT409','a save after the deadline is refused','deadline_passed');
select pg_temp.ok((select (x->'tries'->0->>'status')='submitted' and (x->'tries'->0->>'autoSubmitted')::boolean from public.exam_get(pg_temp.key('oe')) x),'the next read hands the expired try in (auto)');
reset role;
select pg_temp.ok((select submitted_at=deadline_at and auto_submitted from pg_temp.try_of(pg_temp.key('oe'),'s2')),'it was handed in at its deadline');
select pg_temp.ok((select count(*)=1 and bool_and(number_value is null) from private.exam_responses where attempt_id=(pg_temp.try_of(pg_temp.key('oe'),'s2')).id),'only the answer saved before the deadline counts');
-- No Group: from the earliest Group start to the latest Group end. Two Groups: the first window that has not closed.
select pg_temp.ok((select state='ok' and opens_at=now()-interval '10 minutes' and closes_at=private.exam_last_close(pg_temp.key('oe')) from private.exam_student_window(pg_temp.key('oe'),pg_temp.uid('s5'))),
 's5 (no Group) gets the earliest start to the latest end');
drop index public.group_memberships_one_active;
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select pg_temp.key('g2'),e.offering_id,e.user_id,e.id,now()-interval '1 day',pg_temp.uid('owner') from public.enrollments e where e.offering_id=pg_temp.key('off') and e.user_id=pg_temp.uid('s7');
select pg_temp.ok((select group_id=pg_temp.key('g1') and closes_at=now()+interval '110 minutes' from private.exam_student_window(pg_temp.key('oe'),pg_temp.uid('s7'))),'s7 (in G1 and G2) takes the window that is open now (G1)');
select pg_temp.close_group(pg_temp.key('oe'),pg_temp.key('g1'));
select pg_temp.ok((select group_id=pg_temp.key('g2') and opens_at=now()+interval '2 days' from private.exam_student_window(pg_temp.key('oe'),pg_temp.uid('s7'))),'when G1 closed, s7''s window is G2''s coming one');
select pg_temp.ok((select closed from private.exam_user_windows(pg_temp.key('oe')) where user_id=pg_temp.uid('s1')) and not (select closed from private.exam_user_windows(pg_temp.key('oe')) where user_id=pg_temp.uid('s7')),
 'G1 closed: s1''s window is closed, s7 (also in G2) is not');

-- ---------------------------------------------------------------- 4. Correcting and releasing (after the student's window)
set local role authenticated;
select pg_temp.claim('ta');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision,jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'points',4.25))))$s$,'23514','marks go in halves');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision,jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'points',5.5))))$s$,'23514','a mark is at most the question''s points');
select pg_temp.ok((select x->>'status'='corrected' and (x->>'score')::numeric=8.5 from public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision,
 jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'points',4.5,'note','Good')))) x),
 'an assistant (right on by default) marks the essay 4.5: corrected, 8.5 of 12');
select pg_temp.claim('s1');
select pg_temp.ok((select (x->'result'->>'waiting')::boolean and not (x->'result' ? 'score') from public.exam_get(pg_temp.key('oe')) x),'before release the student sees no score');
select pg_temp.claim('ta');
select pg_temp.ok((public.exam_queue(pg_temp.key('oe'),'corrected')->>'readyToRelease')::int=2,'the queue lists s1 and s2 ready to release (their window closed)');
select pg_temp.ok((select (x->>'released')::boolean is distinct from true from public.exam_queue(pg_temp.key('oe'),'corrected') q,jsonb_array_elements(q->'rows') x where (x->>'userId')::uuid=pg_temp.uid('s1')),'not released yet');
select pg_temp.ok((pg_temp.release(pg_temp.key('oe'),'s1')->>'releasedAt') is not null,'s1''s score is released once THEIR window closed');
select pg_temp.ok(pg_temp.notices((pg_temp.result_of(pg_temp.key('oe'),'s1')).id)=1,'one notice for the release');
select pg_temp.denied($s$select pg_temp.release(pg_temp.key('oe'),'s1')$s$,'23514','a released result is not released twice','already_released');
select pg_temp.claim('s1');
select pg_temp.ok((select (x->'result'->>'score')::numeric=8.5 and not (x->>'reviewOpen')::boolean from public.exam_get(pg_temp.key('oe')) x),'s1 sees 8.5; answer review waits for the LAST window');
select pg_temp.ok((select not (x->'attempt'->'items'->0 ? 'correctOptionIds') and (x->'attempt'->'items'->0->'mark'->>'points')::numeric=2 from public.exam_get(pg_temp.key('oe'),(pg_temp.try_of(pg_temp.key('oe'),'s1')).id) x),
 'released: s1 sees the marks but not the keys yet');
-- Changing a released mark needs a reason.
select pg_temp.claim('owner');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision,jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'points',5))))$s$,'23514','a released mark changes only with a reason','reason_required');
select pg_temp.ok((select (x->>'score')::numeric=9 and (x->>'released')::boolean from public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision,
 jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s1')).id,'reason','Re-read the answer','marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),3),'points',5)))) x),'with a reason it changes and stays released');
reset role;
select pg_temp.ok((select reason='Re-read the answer' from private.exam_audit where exam_id=pg_temp.key('oe') and action='grade' order by id desc limit 1) and pg_temp.notices((pg_temp.result_of(pg_temp.key('oe'),'s1')).id)=1,'the change is audited with its reason; no second notice');
-- Bulk release: all or nothing.
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.ok((select (x->>'status')='waiting' from public.exam_work(pg_temp.key('oe'),'grade',(pg_temp.result_of(pg_temp.key('oe'),'s2')).revision,
 jsonb_build_object('attemptId',(pg_temp.try_of(pg_temp.key('oe'),'s2')).id,'marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q(pg_temp.key('oe'),0),'points',0)))) x) is false,'s2''s try needs no essay mark (an empty essay is 0)');
reset role;
select pg_temp.ok((select status='corrected' and score=0 from pg_temp.result_of(pg_temp.key('oe'),'s2')),'s2''s result is corrected at 0');
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.denied(format($s$select public.exam_release_many(%L,%L)$s$,pg_temp.key('oe'),jsonb_build_array(jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s1')).id,'revision',(pg_temp.result_of(pg_temp.key('oe'),'s1')).revision))),'23514','bulk: an already released result refuses the call','already_released');
select pg_temp.denied(format($s$select public.exam_release_many(%L,%L)$s$,pg_temp.key('oe'),jsonb_build_array(jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s2')).id,'revision',99))),'PT409','bulk: a stale revision refuses the call','stale');
select pg_temp.denied(format($s$select public.exam_release_many(%L,%L)$s$,pg_temp.key('oe'),jsonb_build_array(jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s2')).id,'revision',(pg_temp.result_of(pg_temp.key('oe'),'s2')).revision),jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s2')).id,'revision',0))),'23514','bulk: a duplicate is refused');
select pg_temp.ok((select x->>'released'='1' from public.exam_release_many(pg_temp.key('oe'),jsonb_build_array(jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s2')).id,'revision',(pg_temp.result_of(pg_temp.key('oe'),'s2')).revision))) x)
,'bulk: a valid list is released');
reset role;
-- Review: only after the LAST window, only to a student who handed in.
select pg_temp.close_all(pg_temp.key('oe'));
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.ok((select (x->>'reviewOpen')::boolean and (x->'attempt'->'items'->0 ? 'correctOptionIds') from public.exam_get(pg_temp.key('oe'),(pg_temp.try_of(pg_temp.key('oe'),'s1')).id) x),'after the LAST close s1 sees the keys (answer review)');
select pg_temp.claim('s5');
select pg_temp.ok((select not (x->>'reviewOpen')::boolean and not (x ? 'questions') from public.exam_get(pg_temp.key('oe')) x),'s5 never started: no review, no questions');
select pg_temp.denied($s$select public.exam_get(pg_temp.key('oe'),(pg_temp.try_of(pg_temp.key('oe'),'s1')).id)$s$,'42501','s5 cannot read s1''s try');
reset role;

-- ---------------------------------------------------------------- 5. Tries: fix mistakes and from zero; the stored mixed order
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.put('fm',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','Fix mistakes','tries','fix_mistakes','shuffle',true,'timing','same_time',
 'opensAt',to_char(now()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '3 hours','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'questions',pg_temp.questions()))->>'id')::uuid);
select public.exam_lifecycle(pg_temp.key('fm'),'publish',1);
select pg_temp.put('fz',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','From zero','tries','from_zero','timing','same_time',
 'opensAt',to_char(now()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '3 hours','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'questions',pg_temp.questions()))->>'id')::uuid);
select public.exam_lifecycle(pg_temp.key('fz'),'publish',1);
select pg_temp.claim('s1');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('fm'))$s$,'PT409','a same-time exam that has not opened','not_open');
reset role;
update private.exams set opens_at=now()-interval '1 minute' where id in (pg_temp.key('fm'),pg_temp.key('fz'));
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.ok((select (x->>'deadlineAt')::timestamptz=(pg_temp.exam(pg_temp.key('fm'))).closes_at from pg_temp.start(pg_temp.key('fm')) x),'no time limit: the deadline is the window''s end');
select pg_temp.ok((select jsonb_agg(i->'id' order by (i->>'position')::int) from public.exam_get(pg_temp.key('fm'),(pg_temp.try_of(pg_temp.key('fm'),'s1')).id) g,jsonb_array_elements(g->'attempt'->'items') i)
 =(select jsonb_agg(i->'id' order by (i->>'position')::int) from public.exam_get(pg_temp.key('fm'),(pg_temp.try_of(pg_temp.key('fm'),'s1')).id) g,jsonb_array_elements(g->'attempt'->'items') i),'a refresh keeps the order');
reset role;
select pg_temp.ok((select bool_and(array_length(option_order,1)=(select count(*) from private.exam_options o where o.question_id=i.question_id) or (select count(*) from private.exam_options o where o.question_id=i.question_id)=0) from private.exam_attempt_items i where attempt_id=(pg_temp.try_of(pg_temp.key('fm'),'s1')).id),
 'each choice stores its option order');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('fm'),0,1))));
select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),1),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('fm'),1,1))));
select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),2),'numberValue',9.81));
select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),3),'text','First essay'));
select pg_temp.submit(pg_temp.key('fm'),'s1');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('fm'))$s$,'PT409','start after the first try points to retry','started');
select pg_temp.ok((public.exam_work(pg_temp.key('fm'),'retry',null,'{}')->>'number')::int=2,'fix mistakes: the second try starts');
reset role;
select pg_temp.ok((select array_agg(i2.position order by i2.question_id)=array_agg(i1.position order by i1.question_id) and string_agg(i2.option_order::text,';' order by i2.question_id)=string_agg(i1.option_order::text,';' order by i1.question_id)
 from private.exam_attempt_items i1 join private.exam_attempt_items i2 on i2.question_id=i1.question_id and i2.attempt_id=(pg_temp.try_of(pg_temp.key('fm'),'s1')).id
 where i1.attempt_id=(select id from private.exam_attempts where exam_id=pg_temp.key('fm') and user_id=pg_temp.uid('s1') and number=1)),'the second try keeps the first try''s order');
select pg_temp.ok((select string_agg(q.position||':'||r.kept||':'||coalesce(r.text,''),',' order by q.position)='0:true:,2:true:,3:false:First essay' from private.exam_responses r join private.exam_questions q on q.id=r.question_id
 where r.attempt_id=(pg_temp.try_of(pg_temp.key('fm'),'s1')).id),'right choice and number answers are kept; the wrong one is open; the essay reopens with the first answer, editable');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.denied($s$select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('fm'),0,0))))$s$,'23514','a kept answer cannot change');
select pg_temp.answer(pg_temp.key('fm'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fm'),1),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('fm'),1,0),pg_temp.opt(pg_temp.key('fm'),1,2))));
select pg_temp.submit(pg_temp.key('fm'),'s1');
select pg_temp.denied($s$select public.exam_work(pg_temp.key('fm'),'retry',null,'{}')$s$,'PT409','no third try','no_tries_left');
reset role;
select pg_temp.ok((select final_attempt_id=(pg_temp.try_of(pg_temp.key('fm'),'s1')).id and status='waiting' from pg_temp.result_of(pg_temp.key('fm'),'s1')),'the result follows the second try');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.start(pg_temp.key('fz'));
select pg_temp.answer(pg_temp.key('fz'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fz'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('fz'),0,1))));
select pg_temp.submit(pg_temp.key('fz'),'s1');
select public.exam_work(pg_temp.key('fz'),'retry',null,'{}');
reset role;
select pg_temp.ok((select count(*)=0 from private.exam_responses where attempt_id=(pg_temp.try_of(pg_temp.key('fz'),'s1')).id) and (pg_temp.try_of(pg_temp.key('fz'),'s1')).number=2,'from zero: the second try starts empty');

-- ---------------------------------------------------------------- 6. Auto-release after the LAST window (no essays); notices once; review with a model photo
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.put('ar',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','Auto','autoRelease',true,'timing','same_time',
 'opensAt',to_char(now()+interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '2 hours','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM')))->>'id')::uuid);
select pg_temp.put('up_model',(public.exam_upload(pg_temp.key('ar'),'intent',null,'{"purpose":"model","mime":"image/png","name":"model.png"}')->>'id')::uuid);
reset role;
select set_config('ex.model_path',(select path from private.exam_uploads where id=pg_temp.key('up_model')),true);
set local role authenticated; select pg_temp.claim('owner');
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-exams',current_setting('ex.model_path'),pg_temp.sub('owner'),'{"size":2048,"mimetype":"image/png"}');
select pg_temp.denied(format($s$select public.exam_upload(%L,'complete',%L,'{}')$s$,pg_temp.key('ar'),pg_temp.key('up_model')),'42501','completing needs the server''s byte check');
select pg_temp.attest(pg_temp.key('up_model'),2048);
select pg_temp.ok((public.exam_upload(pg_temp.key('ar'),'complete',pg_temp.key('up_model'),'{}')->>'status')='ready','the model picture is ready after the byte check');
select pg_temp.claim('owner');
select pg_temp.ok((public.exam_save(pg_temp.key('ar'),null,1,jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','text','Unit?','points',4,'options',jsonb_build_array('V','A'),'correct',jsonb_build_array(1),'modelImageId',pg_temp.key('up_model')))||(pg_temp.questions(false)-0-0)))->>'revision')::int=2,
 'the exam takes its model picture');
select pg_temp.ok((public.exam_lifecycle(pg_temp.key('ar'),'publish',2)->>'status')='published','auto-release without essays publishes');
reset role;
update private.exams set opens_at=now()-interval '1 minute' where id=pg_temp.key('ar');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.start(pg_temp.key('ar'));
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='lms-exams' and name=current_setting('ex.model_path')),'before the LAST close a student cannot read the model picture');
select pg_temp.answer(pg_temp.key('ar'),'s1',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('ar'),0),'optionIds',jsonb_build_array(pg_temp.opt(pg_temp.key('ar'),0,1))));
select pg_temp.submit(pg_temp.key('ar'),'s1');
reset role;
select pg_temp.ok((select status='corrected' and score=4 and released_at is null from pg_temp.result_of(pg_temp.key('ar'),'s1')),'auto: corrected at once, not released before the close');
select pg_temp.ok(pg_temp.notices((pg_temp.result_of(pg_temp.key('ar'),'s1')).id)=0,'no notice before the close');
select pg_temp.close_all(pg_temp.key('ar'));
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.ok((select (x->'result'->>'score')::numeric=4 from public.exam_get(pg_temp.key('ar')) x),'after the LAST close the next read releases (auto)');
select public.exam_get(pg_temp.key('ar'));
reset role;
select pg_temp.ok((select released_at is not null and released_by is null from pg_temp.result_of(pg_temp.key('ar'),'s1')) and pg_temp.notices((pg_temp.result_of(pg_temp.key('ar'),'s1')).id)=1,'the release is stored once and sends one notice');
select pg_temp.ok((select event_key='exam:'||r.id||':'||r.released_at from private.notification_events e,pg_temp.result_of(pg_temp.key('ar'),'s1') r where e.resource_id=r.id),'the notice key is the result and its release time');
set local role authenticated; select pg_temp.claim('s1');
select pg_temp.ok((select count(*)=1 from storage.objects where bucket_id='lms-exams' and name=current_setting('ex.model_path')),'after the LAST close the taker reads the model picture through Storage');
select pg_temp.ok((public.exam_upload(pg_temp.key('ar'),'get',pg_temp.key('up_model'),'{}')->>'path')=current_setting('ex.model_path'),'and through the exam function');
select pg_temp.claim('s2');
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='lms-exams' and name=current_setting('ex.model_path')),'a student who did not take the exam cannot read it');
select pg_temp.denied(format($s$select public.exam_upload(%L,'get',%L,'{}')$s$,pg_temp.key('ar'),pg_temp.key('up_model')),'42501','nor through the function');
select pg_temp.claim('sb');
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='lms-exams'),'a student of another course reads no exam object');
select pg_temp.claim('s1');
with d as (delete from storage.objects where bucket_id='lms-exams' and name=current_setting('ex.model_path') returning 1) select pg_temp.ok((select count(*)=0 from d),'no one deletes an exam object (no delete policy)');
select pg_temp.claim('s2');
select pg_temp.denied(format($s$insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-exams',%L,%L,'{}')$s$,pg_temp.key('ar')||'/'||gen_random_uuid()||'/file',pg_temp.sub('s2')),'42501','nobody writes an object without a pending upload');
reset role;

-- ---------------------------------------------------------------- 7. A photo answer; too large
set local role authenticated; select pg_temp.claim('s3');
reset role;
update private.exams set timing='same_time',starting_from=null,opens_at=now()-interval '1 minute',closes_at=now()+interval '2 hours' where id=pg_temp.key('fz');
set local role authenticated; select pg_temp.claim('s3');
select pg_temp.start(pg_temp.key('fz'));
select pg_temp.put('up_ans',(public.exam_upload(pg_temp.key('fz'),'intent',null,jsonb_build_object('purpose','answer','mime','image/jpeg','attemptId',(pg_temp.try_of(pg_temp.key('fz'),'s3')).id))->>'id')::uuid);
reset role;
select set_config('ex.ans_path',(select path from private.exam_uploads where id=pg_temp.key('up_ans')),true);
set local role authenticated; select pg_temp.claim('s3');
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-exams',current_setting('ex.ans_path'),pg_temp.sub('s3'),'{"size":6000000,"mimetype":"image/jpeg"}');
select pg_temp.attest(pg_temp.key('up_ans'),6000000);
select pg_temp.denied(format($s$select public.exam_upload(%L,'complete',%L,'{}')$s$,pg_temp.key('fz'),pg_temp.key('up_ans')),'PT413','a photo over 5 MB is refused');
reset role;
update storage.objects set metadata='{"size":4000,"mimetype":"image/jpeg"}' where name=current_setting('ex.ans_path');
set local role authenticated; select pg_temp.claim('s3'); select pg_temp.attest(pg_temp.key('up_ans'),4000);
select pg_temp.ok((public.exam_upload(pg_temp.key('fz'),'complete',pg_temp.key('up_ans'),'{}')->>'status')='ready','a photo answer is ready');
select pg_temp.ok((pg_temp.answer(pg_temp.key('fz'),'s3',jsonb_build_object('questionId',pg_temp.q(pg_temp.key('fz'),3),'uploadId',pg_temp.key('up_ans'),'text','See photo'))->>'savedAt') is not null,'the essay takes the photo');
select pg_temp.claim('s2');
select pg_temp.ok((select count(*)=0 from storage.objects where name=current_setting('ex.ans_path')),'another student cannot read the photo');
select pg_temp.claim('ta');
select pg_temp.ok((select count(*)=1 from storage.objects where name=current_setting('ex.ans_path')),'the run''s staff can');
reset role;

-- ---------------------------------------------------------------- 8. Paper exams
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.put('pp',(public.exam_save(null,pg_temp.key('off'),null,'{"kind":"paper","title":"Paper test","maxMarks":20,"heldOn":"2026-11-10"}')->>'id')::uuid);
select pg_temp.denied($s$select public.exam_save(pg_temp.key('pp'),null,1,'{"timeLimitMinutes":20}')$s$,'23514','a paper exam has a maximum mark only');
select public.exam_lifecycle(pg_temp.key('pp'),'publish',1);
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',12.25))),'23514','paper marks go in halves');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',20.5))),'23514','a paper mark is at most the maximum');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',3,'absent',true))),'23514','a mark and Absent together are refused');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('sb'),'mark',3))),'42501','a student of another course cannot be marked');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',12.5),jsonb_build_object('userId',pg_temp.uid('s2'),'mark',1,'absent',true))),'23514','one bad line refuses the whole sheet');
reset role;
select pg_temp.ok((select count(*)=0 from private.exam_results where exam_id=pg_temp.key('pp')),'nothing was written');
set local role authenticated; select pg_temp.claim('ta');
select pg_temp.ok(jsonb_array_length(public.exam_paper_mark(pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',12.5),jsonb_build_object('userId',pg_temp.uid('s2'),'absent',true),jsonb_build_object('userId',pg_temp.uid('s3'),'mark',0)))->'items')=3,
 'an assistant marks 12.5, Absent and 0');
reset role;
select pg_temp.ok((select paper_mark=12.5 and not absent and score=12.5 and max_score=20 from pg_temp.result_of(pg_temp.key('pp'),'s1')) and (select absent and paper_mark is null and score is null and status='corrected' from pg_temp.result_of(pg_temp.key('pp'),'s2'))
 and (select paper_mark=0 and not absent from pg_temp.result_of(pg_temp.key('pp'),'s3')),'Absent is stored apart from 0');
set local role authenticated; select pg_temp.claim('ta');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',13))),'PT409','a mark sheet without the revision is stale','stale');
select pg_temp.ok((select (x->'counts'->>'marked')::int=2 and (x->'counts'->>'absent')::int=1 and (x->'counts'->>'total')::int=7 from public.exam_paper_sheet(pg_temp.key('pp')) x),'the sheet counts the run''s seven students');
select pg_temp.ok((select jsonb_agg((r->>'userId')::uuid order by r->>'userId')=(select jsonb_agg(u order by u::text) from unnest(array[pg_temp.uid('s5'),pg_temp.uid('s6')]) u) from public.exam_paper_sheet(pg_temp.key('pp'),'none') x,jsonb_array_elements(x->'rows') r),'the "no Group" sheet lists s5 and s6');
select pg_temp.ok((select jsonb_array_length(x->'rows')=3 from public.exam_paper_sheet(pg_temp.key('pp'),pg_temp.key('g1')::text) x),'G1''s sheet lists its members (s1, s2, s7)');
select pg_temp.claim('s1');
select pg_temp.ok((select x->'result'->>'waiting'='true' from public.exam_get(pg_temp.key('pp')) x),'before release the student sees no mark');
select pg_temp.denied($s$select public.exam_paper_sheet(pg_temp.key('pp'))$s$,'42501','a student cannot read the mark sheet');
select pg_temp.claim('owner');
select pg_temp.release(pg_temp.key('pp'),'s1');
select pg_temp.release(pg_temp.key('pp'),'s2');
select pg_temp.claim('s1');
select pg_temp.ok((select (x->'result'->>'score')::numeric=12.5 and (x->'result'->>'maxScore')::numeric=20 from public.exam_get(pg_temp.key('pp')) x),'released: 12.5 of 20');
select pg_temp.claim('s2');
select pg_temp.ok((select (x->'result'->>'absent')::boolean and x->'result'->'score'='null'::jsonb from public.exam_get(pg_temp.key('pp')) x),'Absent is shown as Absent, not 0');
select pg_temp.claim('owner');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',14,'revision',(pg_temp.result_of(pg_temp.key('pp'),'s1')).revision))),'23514','a released paper mark changes only with a reason','reason_required');
select public.exam_paper_mark(pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s1'),'mark',14,'reason','Added a missed page','revision',(pg_temp.result_of(pg_temp.key('pp'),'s1')).revision)));
reset role;
select pg_temp.ok((select paper_mark=14 and released_at is not null from pg_temp.result_of(pg_temp.key('pp'),'s1')) and (select reason='Added a missed page' from private.exam_audit where exam_id=pg_temp.key('pp') and action='paper_mark' order by id desc limit 1),
 'with a reason it changes, stays released and is audited');
select pg_temp.ok(pg_temp.notices((pg_temp.result_of(pg_temp.key('pp'),'s1')).id)=1 and pg_temp.notices((pg_temp.result_of(pg_temp.key('pp'),'s2')).id)=1,'one notice per released paper result');

-- ---------------------------------------------------------------- 9. Assistant rights on and off (shared with homework)
insert into private.homework_assistant_permissions(course_id,user_id,can_correct,can_release) values(pg_temp.key('course'),pg_temp.uid('ta2'),false,false);
set local role authenticated; select pg_temp.claim('ta2');
select pg_temp.denied(format($s$select public.exam_paper_mark(%L,%L)$s$,pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s4'),'mark',3))),'42501','correct off: an assistant cannot mark');
select pg_temp.denied($s$select pg_temp.release(pg_temp.key('pp'),'s3')$s$,'42501','release off: an assistant cannot release');
select pg_temp.ok((public.exam_paper_sheet(pg_temp.key('pp'))->'counts'->>'total')::int=7,'the assistant still reads the sheet');
reset role;
update private.homework_assistant_permissions set can_correct=true where course_id=pg_temp.key('course') and user_id=pg_temp.uid('ta2');
set local role authenticated; select pg_temp.claim('ta2');
select pg_temp.ok(jsonb_array_length(public.exam_paper_mark(pg_temp.key('pp'),jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('s4'),'mark',3)))->'items')=1,'correct back on: the assistant marks');
select pg_temp.denied($s$select pg_temp.release(pg_temp.key('pp'),'s3')$s$,'42501','release still off');
reset role;

-- ---------------------------------------------------------------- 10. Cross-tenant and anonymous denial
set local role authenticated; select pg_temp.claim('outsider');
select pg_temp.denied($s$select public.exam_get(pg_temp.key('oe'))$s$,'42501','another space''s teacher cannot read the exam');
select pg_temp.denied($s$select public.exam_queue(pg_temp.key('oe'))$s$,'42501','nor its queue');
select pg_temp.denied($s$select public.exam_lifecycle(pg_temp.key('oe'),'archive',pg_temp.rev(pg_temp.key('oe')))$s$,'42501','nor archive it');
select pg_temp.denied($s$select public.exam_portal(pg_temp.key('course'))$s$,'42501','nor list its course');
select pg_temp.ok((public.exam_portal(null,'open')->'rows')='[]'::jsonb,'their own Exams page lists nothing of this space');
select pg_temp.denied($s$select public.exam_storage_usage(pg_temp.key('org'))$s$,'42501','nor read its storage');
select pg_temp.claim('sb');
select pg_temp.denied($s$select public.exam_get(pg_temp.key('oe'))$s$,'42501','a student of another course cannot read the exam');
select pg_temp.denied($s$select pg_temp.start(pg_temp.key('fm'))$s$,'42501','nor start it');
select pg_temp.ok((public.exam_student_list()->'rows')='[]'::jsonb,'their list has no exam of this course');
select pg_temp.claim('s1');
select pg_temp.denied($s$select public.exam_queue(pg_temp.key('oe'))$s$,'42501','a student cannot read the queue');
select pg_temp.denied(format($s$select public.exam_release_many(%L,%L)$s$,pg_temp.key('oe'),jsonb_build_array(jsonb_build_object('resultId',(pg_temp.result_of(pg_temp.key('oe'),'s1')).id,'revision',0))),'42501','a student cannot release');
select pg_temp.ok((select count(*)=0 from public.exam_student_list() x,jsonb_array_elements(x->'rows') r where (r->>'id')::uuid=pg_temp.key('empty')),'a draft is not in the student''s list');
select pg_temp.denied($s$select public.exam_get(pg_temp.key('empty'))$s$,'42501','a student cannot read a draft');
reset role;
set local role anon;
select pg_temp.denied($s$select public.exam_get(pg_temp.key('oe'))$s$,'42501','anonymous callers cannot execute exam functions');
select pg_temp.denied($s$select public.exam_student_list()$s$,'42501','anonymous: no list');
reset role;
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.denied($s$select 1 from private.exams$s$,'42501','no client reads the private tables');
select pg_temp.denied($s$select private.exam_windows(pg_temp.key('oe'))$s$,'42501','internal helpers are not callable');
select pg_temp.denied($s$select private.exam_settle(pg_temp.key('oe'),null)$s$,'42501','settle is not callable');
reset role;

-- ---------------------------------------------------------------- 11. The legacy builder is closed
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.denied($s$select public.save_exam_definition_v2(pg_temp.key('off'),null,null,'{}')$s$,'42501','the legacy save is closed to the teacher');
select pg_temp.denied($s$select public.save_exam_definition(pg_temp.key('off'),null,null,'{}')$s$,'42501','the first legacy save is closed too');
select pg_temp.denied($s$select public.clone_exam_schedule(gen_random_uuid())$s$,'42501','the legacy clone is closed');
select pg_temp.denied($s$select private.save_exam_definition_v2(pg_temp.key('off'),null,null,'{}')$s$,'42501','and its private definer');
reset role;

-- ---------------------------------------------------------------- 12. Teacher reads against a naive query; lifecycle
set local role authenticated; select pg_temp.claim('owner');
reset role;
create function pg_temp.naive_counts(p_course uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('open',count(*) filter(where status='published' and kind='online' and not private.exam_closed(id)),'closed',count(*) filter(where status='published' and (kind='paper' or private.exam_closed(id))),
  'drafts',count(*) filter(where status='draft'),'archived',count(*) filter(where status='archived')) from private.exams where course_id=p_course$$;
create function pg_temp.naive_queue(p_exam uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('to_correct',(select count(*) from private.exam_results where exam_id=p_exam and status='waiting' and final_attempt_id is not null),
  'corrected',(select count(*) from private.exam_results where exam_id=p_exam and status='corrected' and final_attempt_id is not null),
  'missing',(select count(*) from public.enrollments e join private.exams x on x.offering_id=e.offering_id where x.id=p_exam and e.status='active' and not exists(select 1 from private.exam_results r where r.exam_id=x.id and r.user_id=e.user_id)),
  'released',(select count(*) from private.exam_results where exam_id=p_exam and released_at is not null))$$;
set local role authenticated; select pg_temp.claim('owner');
select pg_temp.ok((public.exam_portal(pg_temp.key('course'),'open')->'counts')=pg_temp.naive_counts(pg_temp.key('course')),'Exams page tab counts match a naive count');
select pg_temp.ok((select jsonb_array_length(x->'rows')=(x->'counts'->>'drafts')::int from public.exam_portal(pg_temp.key('course'),'drafts') x),'the drafts tab lists every draft');
select pg_temp.ok((select (x->'counts')-'inProgress'=pg_temp.naive_queue(pg_temp.key('oe')) from public.exam_queue(pg_temp.key('oe'),'missing') x),'queue counts match a naive count');
select pg_temp.ok((select jsonb_array_length(x->'rows')=(x->'counts'->>'missing')::int from public.exam_queue(pg_temp.key('oe'),'missing') x),'the missing tab lists every student without a try');
select pg_temp.claim('ta');
select pg_temp.ok((select (x->'counts'->>'open')::int+(x->'counts'->>'closed')::int+(x->'counts'->>'drafts')::int>0 from public.exam_portal(null,'open') x),'an assistant sees the run''s exams');
select pg_temp.claim('owner');
-- Work started: only details change; times move with Reschedule; unpublish is refused.
select pg_temp.denied(format($s$select public.exam_save(%L,null,%s,'{"questions":[]}')$s$,pg_temp.key('oe'),pg_temp.rev(pg_temp.key('oe'))),'PT409','after work started the questions are frozen','started');
select pg_temp.ok((public.exam_save(pg_temp.key('oe'),null,pg_temp.rev(pg_temp.key('oe')),'{"title":"Unit test (renamed)"}')->>'status')='published','details still change');
select pg_temp.denied(format($s$select public.exam_lifecycle(%L,'unpublish',%s)$s$,pg_temp.key('oe'),pg_temp.rev(pg_temp.key('oe'))),'PT409','unpublish after work started is refused','started');
select pg_temp.denied(format($s$select public.exam_lifecycle(%L,'reschedule',%s,'{"opensAt":"2030-01-01T10:00:00+02:00"}')$s$,pg_temp.key('fm'),pg_temp.rev(pg_temp.key('fm'))),'PT409','a same-time window that opened keeps its times','window_open');
select pg_temp.ok((public.exam_lifecycle(pg_temp.key('oe'),'clone',pg_temp.rev(pg_temp.key('oe')),jsonb_build_object('offeringId',pg_temp.key('off2')))->>'version')::int=2,'clone makes version 2 in another run');
reset role;
select pg_temp.ok((select status='draft' and offering_id=pg_temp.key('off2') and supersedes_id=pg_temp.key('oe') and (select count(*) from private.exam_questions q where q.exam_id=e.id)=4
 and (select k.correct_option_ids=array[(select o.id from private.exam_options o where o.question_id=q.id and o.position=1)] from private.exam_questions q join private.exam_keys k on k.question_id=q.id where q.exam_id=e.id and q.position=0)
 from private.exams e where family_id=pg_temp.key('oe') and version=2),'the clone copies questions and remaps the keys to its own options');

select count(*) as exams_tests from ex_results;
rollback;
