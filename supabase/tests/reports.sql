-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities, non-UUID subjects); every change rolls back; no real account.
-- Covers migration 20261117120000_reports.sql (read-only reports): who may read (owner, instructor-level, assistant of the run, assistant without the run, course
-- editor, student, another space, anon), the exact counting rules on a hand-built fixture, month boundaries (Cairo), Whole course, an empty course, a student who moved
-- Groups mid-month, a student in no Group, unsaved and cancelled sessions, unreleased marks, Absent never counted as 0, and the same answer under other session time zones.
-- Fixture times hang on the first moments of this Cairo month (the test needs the clock to be past 00:30 on the 1st; it is a disposable database).
begin;
create temp table rp_results(name text primary key);
create temp table rp_users(label text primary key,id uuid not null);
create temp table rp_ids(label text primary key,id uuid not null);
grant select,insert,update on rp_results,rp_users,rp_ids to authenticated,anon;
select set_config('rp.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.rp_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare c text;begin
 begin execute statement; exception when others then get stacked diagnostics c=returned_sqlstate; return c; end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare r text;begin
 r:=pg_temp.refusal(statement);
 if r is distinct from code then raise exception 'FAILED % expected % got %',label,code,r; end if;
 insert into pg_temp.rp_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('rp.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','rp-'||current_setting('rp.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.rp_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.rp_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.rp_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
-- The first instant of this Cairo month, and of the one before.
-- The calendar month used by the month tests, and the first instant fixtures hang on: the later of the month start and the start of the last-4-weeks window (so they are inside both on every day of the month).
create function pg_temp.mlo() returns timestamptz language sql as $$select date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'$$;
create function pg_temp.lo() returns timestamptz language sql as $$select greatest(pg_temp.mlo(),((clock_timestamp() at time zone 'Africa/Cairo')::date-27)::timestamp at time zone 'Africa/Cairo')$$;
create function pg_temp.cm() returns text language sql as $$select to_char(clock_timestamp() at time zone 'Africa/Cairo','YYYY-MM')$$;
create function pg_temp.plo() returns timestamptz language sql as $$select (date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo')-interval '1 month') at time zone 'Africa/Cairo'$$;
create function pg_temp.pmonth() returns text language sql as $$select to_char(date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo')-interval '1 month','YYYY-MM')$$;
-- One student's row of a Group report, by name.
create function pg_temp.row_of(rep jsonb,nm text) returns jsonb language sql as $$
 select x from jsonb_array_elements((rep->'attention')||(rep->'everyone')) x where x->>'name'=nm$$;
create function pg_temp.pct(a jsonb) returns text language sql as $$select a->>'pct'$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','editor','ta','tano','a','b','c','d','e','f','outsider','sb'] loop
  perform pg_temp.claim(label); insert into pg_temp.rp_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
update public.profiles p set display_name=initcap(u.label)||' Student' from pg_temp.rp_users u where u.id=p.id and u.label in ('a','b','c','d','e','f');

select pg_temp.put(k,gen_random_uuid()) from unnest(array['org','org_b','course','course2','course_b','off','off2','off_b','m1','m2','m3','l1','l2','l3','g1','g2','g3','h1','h2','h3','h4','h5','h6','e1','e2','e3','e4']) k;
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic reports','rp-'||current_setting('rp.run')),(pg_temp.key('org_b'),'Synthetic other','rp-b-'||current_setting('rp.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('editor','teacher'),('ta','assistant'),('tano','assistant')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org'),'Synthetic Physics','rp-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course2'),pg_temp.key('org'),'Synthetic Empty','rp-empty','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','rp-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('course'),pg_temp.uid('editor'),'editor');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),
 (pg_temp.key('off2'),pg_temp.key('course2'),'Empty run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('ta'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off'),pg_temp.uid(l),'active',now()-interval '60 days' from unnest(array['a','b','c','d','e','f']) l;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '1 day');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('m1'),pg_temp.key('course'),'Electric current',0),(pg_temp.key('m2'),pg_temp.key('course'),'Magnetism',1),(pg_temp.key('m3'),pg_temp.key('course'),'Induction',2);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('l1'),pg_temp.key('m1'),'Ohm',0,'published'),(pg_temp.key('l2'),pg_temp.key('m2'),'Fields',0,'published'),(pg_temp.key('l3'),pg_temp.key('m3'),'Coils',0,'published');
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values
 (pg_temp.key('g1'),pg_temp.key('off'),'Saturday group','center','Room 1',pg_temp.uid('owner')),(pg_temp.key('g2'),pg_temp.key('off'),'Online group','center','Room 2',pg_temp.uid('owner')),
 (pg_temp.key('g3'),pg_temp.key('off2'),'Empty group','center','Room 3',pg_temp.uid('owner'));
-- Memberships: a b e in G1 and f in G2 all along; c in G1 until 5 minutes into the month, then G2; d in no Group.
insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
 select pg_temp.put('mem_'||v.l||'_'||v.gk,gen_random_uuid()),pg_temp.key(v.gk),e.offering_id,e.user_id,e.id,v.s,v.en,pg_temp.uid('owner')
 from (values ('a','g1',now()-interval '50 days',null::timestamptz),('b','g1',now()-interval '50 days',null),('e','g1',now()-interval '50 days',null),('f','g2',now()-interval '50 days',null),
  ('c','g1',now()-interval '50 days',pg_temp.lo()+interval '5 minutes'),('c','g2',pg_temp.lo()+interval '5 minutes',null)) v(l,gk,s,en)
 join public.enrollments e on e.offering_id=pg_temp.key('off') and e.user_id=pg_temp.uid(v.l);

-- ---------------------------------------------------------------- Sessions. G1: S1..S4 finalized this month (S4 starts exactly at the first instant), S5 cancelled, S6 unsaved (draft),
-- S7 finalized one second before the month. G2: T1, T2 finalized. Marks: a P P P A; b P A P A; c P P P P (then G2: A A); e P P A A; f P P (G2).
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select pg_temp.put(v.k,gen_random_uuid()),pg_temp.key(v.g),v.k,v.t,v.t+interval '1 second',v.t,v.t+interval '1 second','center',v.c,v.st,pg_temp.uid('owner'),pg_temp.uid('owner') from (values
  ('s1','g1',pg_temp.lo()+interval '1 second',false,'finalized'),('s2','g1',pg_temp.lo()+interval '3 seconds',false,'finalized'),('s3','g1',pg_temp.lo()+interval '5 seconds',false,'finalized'),
  ('s4','g1',pg_temp.lo(),false,'finalized'),('s5','g1',pg_temp.lo()+interval '9 seconds',true,'finalized'),('s6','g1',pg_temp.lo()+interval '11 seconds',false,'draft'),
  ('s7','g1',pg_temp.plo()+interval '6 hours',false,'finalized'),
  ('t1','g2',pg_temp.lo()+interval '10 minutes',false,'finalized'),('t2','g2',pg_temp.lo()+interval '12 minutes',false,'finalized')) v(k,g,t,c,st);
insert into public.session_attendance(session_id,user_id,membership_id,status)
 select pg_temp.key(v.s),pg_temp.uid(v.l),pg_temp.key('mem_'||v.l||'_'||v.g),v.st from (values
  ('s1','a','g1','attended'),('s2','a','g1','attended'),('s3','a','g1','attended'),('s4','a','g1','absent'),
  ('s1','b','g1','attended'),('s2','b','g1','absent'),('s3','b','g1','attended'),('s4','b','g1','absent'),
  ('s1','c','g1','attended'),('s2','c','g1','attended'),('s3','c','g1','attended'),('s4','c','g1','attended'),
  ('s1','e','g1','attended'),('s2','e','g1','attended'),('s3','e','g1','absent'),('s4','e','g1','absent'),
  ('s5','a','g1','absent'),('s6','a','g1','absent'),('s7','e','g1','attended'),
  ('t1','c','g2','absent'),('t2','c','g2','absent'),('t1','f','g2','attended'),('t2','f','g2','attended')) v(s,l,g,st);

-- ---------------------------------------------------------------- Homework (published, file upload, 10 points). H1 H2 H3 due in the first seconds of the month, H6 20 minutes in (c is in G2 by then),
-- H4 not due yet (10 days ahead), H5 last month. Submissions (released = a grade the student can see).
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
 select pg_temp.key(v.k),pg_temp.key('course'),pg_temp.key('off'),pg_temp.key(v.l),v.t,'published',pg_temp.key(v.k),pg_temp.uid('owner'),v.d,true,'questions','PLATFORM_QUESTIONS','one_time',1,'after_deadline' from (values
  ('h1','l1','Ohm practice',pg_temp.lo()+interval '1 second'),('h2','l1','Series and parallel',pg_temp.lo()+interval '2 seconds'),('h3','l1','Right-hand rule',pg_temp.lo()+interval '3 seconds'),
  ('h6','l2','Magnetic field',pg_temp.lo()+interval '20 minutes'),('h4','l1','Not due yet',now()+interval '400 days'),('h5','l1','Last month',pg_temp.plo()+interval '6 hours')) v(k,l,t,d);
insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) select gen_random_uuid(),a.id,0,'essay','Explain',10,'text' from public.homework_assignments a where a.course_id=pg_temp.key('course');
insert into public.homework_submissions(id,assignment_id,user_id,number,status,submitted_at)
 select pg_temp.put('sub_'||v.h||'_'||v.l,gen_random_uuid()),pg_temp.key(v.h),pg_temp.uid(v.l),1,'submitted',now()-interval '1 day' from (values
  ('h1','a'),('h2','a'),('h3','a'),('h5','a'),('h1','b'),('h1','c'),('h2','c'),('h3','c'),('h1','e'),('h1','f'),('h2','f'),('h3','f'),('h6','f')) v(h,l);
insert into private.homework_corrections(submission_id,status,score,released_at,released_by)
 select pg_temp.key('sub_'||v.h||'_'||v.l),'corrected',v.sc,case when v.rel then now() end,case when v.rel then pg_temp.uid('owner') end from (values
  ('h1','a',9,true),('h2','a',7,false),('h3','a',10,true),('h5','a',7,true),('h1','b',4,true),('h1','c',8,true),('h2','c',8,true),('h3','c',8,true),('h1','e',3,false),
  ('h1','f',10,true),('h2','f',10,true),('h3','f',10,true),('h6','f',6,true)) v(h,l,sc,rel);

-- ---------------------------------------------------------------- Exams. E1 paper (40) on day 1; E2 online, same time, closed 30 minutes into the month (20 points); E3 paper last month (10) on day 10;
-- E4 paper on day 1 with nothing marked (pending). Tags: E1 chapter 1, E2 chapter 1, E3 every chapter, E4 chapter 2.
insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,timing,opens_at,closes_at,tries_mode,created_by)
 select pg_temp.key(v.k),pg_temp.key(v.k),pg_temp.key('course'),pg_temp.key('off'),v.kind,v.t,'published',now()-interval '30 days',v.mx,v.held,v.tm,v.o,v.c,v.tr,pg_temp.uid('owner') from (values
  ('e1','paper','Chapter 1 exam',40,(pg_temp.lo() at time zone 'Africa/Cairo')::date,null::text,null::timestamptz,null::timestamptz,null::text),
  ('e2','online','Quiz in class',null,null::date,'same_time',pg_temp.lo()+interval '1 minute',pg_temp.lo()+interval '30 minutes','one_time'),
  ('e3','paper','Last month paper',10,(pg_temp.plo() at time zone 'Africa/Cairo')::date,null,null,null,null),
  ('e4','paper','Unmarked paper',20,(pg_temp.lo() at time zone 'Africa/Cairo')::date,null,null,null,null)) v(k,kind,t,mx,held,tm,o,c,tr);
update private.exams set covers_all_chapters=true where id=pg_temp.key('e3');
insert into private.exam_chapters(exam_id,module_id) values(pg_temp.key('e1'),pg_temp.key('m1')),(pg_temp.key('e2'),pg_temp.key('m1')),(pg_temp.key('e4'),pg_temp.key('m2'));
insert into private.exam_attempts(id,exam_id,user_id,number,started_at,deadline_at,submitted_at,status)
 select pg_temp.put('try_'||v.l,gen_random_uuid()),pg_temp.key('e2'),pg_temp.uid(v.l),1,pg_temp.lo()+interval '2 minutes',pg_temp.lo()+interval '20 minutes',pg_temp.lo()+interval '10 minutes','submitted' from (values ('a'),('c'),('f')) v(l);
insert into private.exam_results(exam_id,user_id,final_attempt_id,paper_mark,absent,status,score,max_score,released_at,released_by)
 select pg_temp.key(v.e),pg_temp.uid(v.l),case when v.e='e2' then pg_temp.key('try_'||v.l) end,case when v.e<>'e2' and not v.ab then v.sc end,v.ab,'corrected',case when v.ab then null else v.sc end,v.mx,
  case when v.rel then now() end,case when v.rel then pg_temp.uid('owner') end from (values
  ('e1','a',36,40,false,true),('e1','b',null,40,true,false),('e1','c',12,40,false,true),('e1','e',5,40,false,false),('e1','f',30,40,false,true),
  ('e2','a',18,20,false,true),('e2','c',5,20,false,true),('e2','f',20,20,false,true),
  ('e3','a',10,10,false,true)) v(e,l,sc,mx,ab,rel);

-- ---------------------------------------------------------------- Who may read
set local role authenticated;
select pg_temp.claim('owner');
select set_config('rp.g1',public.report_group(pg_temp.key('g1'),pg_temp.cm())::text,true);
select set_config('rp.g2',public.report_group(pg_temp.key('g2'),pg_temp.cm())::text,true);
select set_config('rp.groups',public.report_groups(array[pg_temp.key('g1'),pg_temp.key('g2')])::text,true);
select set_config('rp.att',public.report_attention(pg_temp.key('off'),0)::text,true);
select set_config('rp.att_all',public.report_attention(null,0)::text,true);
select set_config('rp.course',public.report_course(pg_temp.key('course'),pg_temp.cm())::text,true);
select pg_temp.ok(public.report_group(pg_temp.key('g1'),pg_temp.cm()) is not null,'the owner reads a Group report');
select pg_temp.claim('ta');
select pg_temp.ok(public.report_group(pg_temp.key('g1'),pg_temp.cm())->'group'->>'name'='Saturday group','an assistant of the run reads a Group report');
select pg_temp.ok((public.report_student(pg_temp.uid('b'),pg_temp.key('off'),pg_temp.cm())->'attendance'->>'pct')='50','an assistant of the run reads a student report');
select pg_temp.ok((public.report_attention(pg_temp.key('off'),0)->>'total')::int=4,'an assistant of the run reads the Needs attention list');
select pg_temp.ok(jsonb_array_length(public.report_course(pg_temp.key('course'),pg_temp.cm())->'chapters')=3,'an assistant of the run reads the course results');
select pg_temp.claim('editor');
select pg_temp.ok(jsonb_array_length(public.report_course(pg_temp.key('course'),pg_temp.cm())->'chapters')=3,'a course editor reads the course results (the view capability)');
select pg_temp.denied(format('select public.report_group(%L,null)',pg_temp.key('g1')),'42501','a course editor who is not support staff gets no Group report');
select pg_temp.denied(format('select public.report_student(%L,%L,null)',pg_temp.uid('b'),pg_temp.key('off')),'42501','a course editor gets no student report');
select pg_temp.denied(format('select public.report_attention(%L,0)',pg_temp.key('off')),'42501','a course editor gets no attention list');
select pg_temp.claim('tano');
select pg_temp.denied(format('select public.report_group(%L,null)',pg_temp.key('g1')),'42501','an assistant of no run gets no Group report');
select pg_temp.denied(format('select public.report_groups(array[%L]::uuid[])',pg_temp.key('g1')),'42501','an assistant of no run gets no Groups numbers');
select pg_temp.denied(format('select public.report_student(%L,%L,null)',pg_temp.uid('b'),pg_temp.key('off')),'42501','an assistant of no run gets no student report');
select pg_temp.denied(format('select public.report_course(%L,null)',pg_temp.key('course')),'42501','an assistant of no run gets no course results');
select pg_temp.denied('select public.report_attention(null,0)','42501','an assistant of no run gets no attention list');
select pg_temp.claim('a');
select pg_temp.denied(format('select public.report_group(%L,null)',pg_temp.key('g1')),'42501','a student gets no Group report');
select pg_temp.denied(format('select public.report_groups(array[%L]::uuid[])',pg_temp.key('g1')),'42501','a student gets no Groups numbers');
select pg_temp.denied(format('select public.report_student(%L,%L,null)',pg_temp.uid('a'),pg_temp.key('off')),'42501','a student gets no student report, not even their own');
select pg_temp.denied(format('select public.report_course(%L,null)',pg_temp.key('course')),'42501','a student gets no course results');
select pg_temp.denied('select public.report_attention(null,0)','42501','a student gets no attention list');
select pg_temp.claim('outsider');
select pg_temp.denied(format('select public.report_group(%L,null)',pg_temp.key('g1')),'42501','another space gets no Group report');
select pg_temp.denied(format('select public.report_groups(array[%L,%L]::uuid[])',pg_temp.key('g1'),pg_temp.key('g3')),'42501','another space gets no Groups numbers');
select pg_temp.denied(format('select public.report_student(%L,%L,null)',pg_temp.uid('b'),pg_temp.key('off')),'42501','another space gets no student report');
select pg_temp.denied(format('select public.report_course(%L,null)',pg_temp.key('course')),'42501','another space gets no course results');
select pg_temp.denied(format('select public.report_attention(%L,0)',pg_temp.key('off')),'42501','another space gets no attention list for this run');
select pg_temp.claim('owner');
select pg_temp.denied(format('select public.report_student(%L,%L,null)',pg_temp.uid('sb'),pg_temp.key('off')),'42501','a student of another run is not found');
select pg_temp.denied(format('select public.report_group(%L,%L)',pg_temp.key('g1'),'2099-01'),'23514','a future month is refused');
select pg_temp.denied(format('select public.report_group(%L,%L)',pg_temp.key('g1'),'bogus'),'23514','a malformed month is refused');
select pg_temp.denied('select public.report_groups(array[]::uuid[])','23514','no Groups is refused');
select pg_temp.denied(format('select public.report_attention(%L,-1)',pg_temp.key('off')),'23514','a negative page is refused');
reset role;
set local role anon;
select pg_temp.denied(format('select public.report_group(%L,null)',pg_temp.key('g1')),'42501','anon gets no Group report');
select pg_temp.denied('select public.report_attention(null,0)','42501','anon gets no attention list');
reset role;
select pg_temp.ok(not exists(select 1 from information_schema.routine_privileges where routine_schema in ('private','public') and routine_name like 'report\_%' and grantee in ('anon','PUBLIC')),'no report function is granted to anon or public');
select pg_temp.ok(not exists(select 1 from information_schema.routine_privileges where routine_schema='private' and routine_name in ('report_caller','report_bounds','report_reasons','report_reason_count','report_pct','report_sessions','report_homework','report_exams','report_facts','report_stats') and grantee='authenticated'),'the helpers are granted to nobody');

-- ---------------------------------------------------------------- Counting (this month): the Saturday group
create function pg_temp.g(n text) returns jsonb language sql as $$select current_setting('rp.'||n)::jsonb$$;
select pg_temp.ok(pg_temp.g('g1')->>'month'=to_char(pg_temp.lo() at time zone 'Africa/Cairo','YYYY-MM') and pg_temp.g('g1')->>'timezone'='Africa/Cairo','the month and its time zone are named');
select pg_temp.ok((pg_temp.g('g1')->'summary'->'attendance'->>'pct')='69' and (pg_temp.g('g1')->'summary'->'attendance'->>'sessions')='4','Group attendance 11 of 16 = 69% over 4 sessions (cancelled, unsaved and last month excluded)');
select pg_temp.ok((pg_temp.g('g1')->'summary'->'homework'->>'pct')='53' and (pg_temp.g('g1')->'summary'->'homework'->>'given')='4','Group homework 8 of 15 = 53% over 4 given');
select pg_temp.ok((pg_temp.g('g1')->'summary'->'exams'->>'pct')='66' and (pg_temp.g('g1')->'summary'->'exams'->>'count')='2','Group exams 66 of 100 = 66% over 2 exams (unreleased 5/40, Absent and the unmarked paper excluded)');
select pg_temp.ok(pg_temp.g('g1')->>'attentionTotal'='3','three students of the Saturday group need attention');
select pg_temp.ok((select array_agg(x->>'name') from jsonb_array_elements(pg_temp.g('g1')->'attention') x)=array['B Student','E Student','C Student'],'needs attention is worst first: most reasons, then lowest numbers');
select pg_temp.ok((select array_agg(x->>'name') from jsonb_array_elements(pg_temp.g('g1')->'everyone') x)=array['A Student'],'everyone else is A (one missed session never flags)');
select pg_temp.ok(pg_temp.row_of(pg_temp.g('g1'),'B Student')->'reasons'=jsonb_build_array(jsonb_build_object('code','missed_sessions','n',2),jsonb_build_object('code','homework_missing','n',3),
 jsonb_build_object('code','exam_absent','title','Chapter 1 exam'),jsonb_build_object('code','exam_absent','title','Quiz in class')),'B: missed 2 sessions, 3 homework missing, absent from both exams');
select pg_temp.ok(pg_temp.row_of(pg_temp.g('g1'),'E Student')->'reasons'=jsonb_build_array(jsonb_build_object('code','missed_sessions','n',2),jsonb_build_object('code','homework_missing','n',3),jsonb_build_object('code','exam_absent','title','Quiz in class')),
 'E: an unreleased paper mark counts nothing, the online exam they never took is Absent');
select pg_temp.ok(pg_temp.row_of(pg_temp.g('g1'),'C Student')->'reasons'=jsonb_build_array(jsonb_build_object('code','exams_low','pct',30)),'C in the Saturday group: only the 12/40 paper (the old Group keeps the old numbers)');
select pg_temp.ok((pg_temp.row_of(pg_temp.g('g1'),'C Student')->'attendance'->>'total')='4' and (pg_temp.row_of(pg_temp.g('g1'),'C Student')->'attendance'->>'pct')='100','C attended 4 of 4 in the Saturday group');
select pg_temp.ok((pg_temp.row_of(pg_temp.g('g1'),'A Student')->'homework'->>'done')='3' and (pg_temp.row_of(pg_temp.g('g1'),'A Student')->'exams'->>'pct')='90','A: homework 3 done (an unreleased grade still counts as handed in), exams 54 of 60 = 90%');
select pg_temp.ok((pg_temp.row_of(pg_temp.g('g1'),'B Student')->'exams'->>'pct') is null and (pg_temp.row_of(pg_temp.g('g1'),'B Student')->'exams'->>'absent')='2','Absent is listed, never an average of 0');
-- The Online group
select pg_temp.ok((pg_temp.g('g2')->'summary'->'attendance'->>'pct')='50' and (pg_temp.g('g2')->'summary'->'attendance'->>'sessions')='2','Online group attendance 2 of 4 = 50%');
select pg_temp.ok((pg_temp.g('g2')->'summary'->'homework'->>'given')='4' and (pg_temp.g('g2')->'summary'->'homework'->>'pct')='80','Online group: 4 homework counted, 4 of 5 done (C only got H6 here; H1 to H3 stayed with the Saturday group)');
select pg_temp.ok(pg_temp.g('g2')->>'attentionTotal'='1' and pg_temp.g('g2')->'attention'->0->>'name'='C Student','the Online group has one student needing attention: C, who moved in');
select pg_temp.ok(pg_temp.g('g2')->'attention'->0->'reasons'=jsonb_build_array(jsonb_build_object('code','missed_sessions','n',2),jsonb_build_object('code','exams_low','pct',25)),'C in the Online group: missed 2 sessions, Exams 25% (the new Group only counts what happened in it)');
select pg_temp.ok((select array_agg(x->>'name') from jsonb_array_elements(pg_temp.g('g2')->'everyone') x)=array['F Student'],'F is everyone else in the Online group');
-- The Groups list agrees with the Report tab, one call for the page
select pg_temp.ok((select (x->'attendance'->>'pct')='69' and (x->'homework'->>'pct')='53' and (x->'exams'->>'pct')='66' and (x->>'attention')='3' and (x->>'hasNumbers')='true'
  from jsonb_array_elements(pg_temp.g('groups')->'groups') x where x->>'groupId'=pg_temp.key('g1')::text),'the Groups list line for the Saturday group is the Report tab''s numbers');
select pg_temp.ok((select (x->>'attention')='1' from jsonb_array_elements(pg_temp.g('groups')->'groups') x where x->>'groupId'=pg_temp.key('g2')::text),'the Groups list pill for the Online group says 1');
-- Needs attention across the run
select pg_temp.ok(pg_temp.g('att')->>'total'='4' and pg_temp.g('att_all')->>'total'='4','Needs attention (one run, and every run): B, E, D and C');
select pg_temp.ok((select array_agg(x->>'name') from jsonb_array_elements(pg_temp.g('att')->'rows') x)=array['B Student','E Student','D Student','C Student'],'worst first: 4, 3 and 2 reasons; D (0% homework) before C');
select pg_temp.ok((select x->'group' from jsonb_array_elements(pg_temp.g('att')->'rows') x where x->>'name'='D Student')='null'::jsonb or (select x->'group' from jsonb_array_elements(pg_temp.g('att')->'rows') x where x->>'name'='D Student') is null,'D is in no Group');
select pg_temp.ok((select x->'group'->>'name' from jsonb_array_elements(pg_temp.g('att')->'rows') x where x->>'name'='C Student')='Online group','C is shown with the Group they are in now');
select pg_temp.ok((select x->'reasons'=jsonb_build_array(jsonb_build_object('code','missed_sessions','n',2),jsonb_build_object('code','exams_low','pct',28)) from jsonb_array_elements(pg_temp.g('att')->'rows') x where x->>'name'='C Student'),'across Groups C is missed 2 sessions (of 6) and Exams 28% (17 of 60)');
select pg_temp.ok((select x->'reasons'=jsonb_build_array(jsonb_build_object('code','homework_missing','n',4),jsonb_build_object('code','exam_absent','title','Quiz in class')) from jsonb_array_elements(pg_temp.g('att')->'rows') x where x->>'name'='D Student'),'D: 4 homework missing, absent from the online exam; the unmarked paper is not Absent');
-- Course results
select pg_temp.ok((select (x->>'exams')='2' and (x->>'homework')='3' and (x->>'pct')='73' from jsonb_array_elements(pg_temp.g('course')->'chapters') x where (x->>'number')='1'),'chapter 1: 2 exams, 3 homework, homework and exam marks together');
select pg_temp.ok((select x->>'pct' from jsonb_array_elements(pg_temp.g('course')->'chapters') x where (x->>'number')='3') is null and (select x->'groups' from jsonb_array_elements(pg_temp.g('course')->'chapters') x where (x->>'number')='3')='[]'::jsonb,'chapter 3 has no marks yet this month');
select pg_temp.ok((select (x->>'weakest')='true' from jsonb_array_elements(pg_temp.g('course')->'chapters') x where (x->>'number')='2') and (select count(*) from jsonb_array_elements(pg_temp.g('course')->'chapters') x where x->>'weakest'='true')=1,'chapter 2 is the one weakest chapter');
select pg_temp.ok((select (g->>'pct')='60' from jsonb_array_elements((select x->'groups' from jsonb_array_elements(pg_temp.g('course')->'chapters') x where (x->>'number')='2')) g where g->>'groupId'=pg_temp.key('g2')::text),'chapter 2, Online group: F got 6 of 10 on the magnetism homework') ;
-- Student page
select set_config('rp.sc',public.report_student(pg_temp.uid('c'),pg_temp.key('off'),pg_temp.cm())::text,true);
select pg_temp.ok(jsonb_array_length(pg_temp.g('sc')->'groups')=2 and jsonb_array_length(pg_temp.g('sc')->'sessions')=6,'C: 6 sessions in two Groups, each in the Group of its time');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.g('sc')->'sessions') x where x->>'groupId'=pg_temp.key('g1')::text and x->>'state'='present')=4 and (select count(*) from jsonb_array_elements(pg_temp.g('sc')->'sessions') x where x->>'groupId'=pg_temp.key('g2')::text and x->>'state'='absent')=2,'C: 4 present in the Saturday group, 2 absent in the Online group');
select pg_temp.ok((pg_temp.g('sc')->'attendance'->>'pct')='67' and (pg_temp.g('sc')->'exams'->>'pct')='28' and (pg_temp.g('sc')->'homework'->>'missing')='1','C totals: attendance 67%, exams 28%, 1 homework missing (H6)');
select set_config('rp.sd',public.report_student(pg_temp.uid('d'),pg_temp.key('off'),pg_temp.cm())::text,true);
select pg_temp.ok((pg_temp.g('sd')->'attendance'->>'pct') is null and (pg_temp.g('sd')->'attendance'->>'total')='0' and jsonb_array_length(pg_temp.g('sd')->'sessions')=0,'a student in no Group has numbers without attendance');
select pg_temp.ok((pg_temp.g('sd')->'homework'->>'missing')='4' and (pg_temp.g('sd')->'homework'->>'done')='0','D: 4 homework, none handed in');
select set_config('rp.sa',public.report_student(pg_temp.uid('a'),pg_temp.key('off'),pg_temp.cm())::text,true);
select pg_temp.ok((select x->>'detail' from jsonb_array_elements(pg_temp.g('sa')->'homeworkList') x where x->>'title'='Series and parallel')='waiting' and (select x->>'state' from jsonb_array_elements(pg_temp.g('sa')->'homeworkList') x where x->>'title'='Series and parallel')='done','A: an unreleased grade shows as waiting for marks');
select pg_temp.ok((select x->>'score' from jsonb_array_elements(pg_temp.g('sa')->'homeworkList') x where x->>'title'='Ohm practice')='9' and (select x->>'max' from jsonb_array_elements(pg_temp.g('sa')->'homeworkList') x where x->>'title'='Ohm practice')='10','A: a released grade shows its mark');
select pg_temp.ok((select array_agg(x->>'title' order by o) from jsonb_array_elements(pg_temp.g('sa')->'examList') with ordinality t(x,o))=array['Chapter 1 exam','Quiz in class'],'A: this month''s exams, the unmarked paper left out');
select set_config('rp.sb',public.report_student(pg_temp.uid('b'),pg_temp.key('off'),pg_temp.cm())::text,true);
select pg_temp.ok((select x->>'state' from jsonb_array_elements(pg_temp.g('sb')->'examList') x where x->>'title'='Chapter 1 exam')='absent' and (select x->>'score' from jsonb_array_elements(pg_temp.g('sb')->'examList') x where x->>'title'='Chapter 1 exam') is null,'B: Absent is listed, with no mark');

-- ---------------------------------------------------------------- Months and Whole course
select set_config('rp.gp',public.report_group(pg_temp.key('g1'),pg_temp.pmonth())::text,true);
select pg_temp.ok((pg_temp.g('gp')->'summary'->'attendance'->>'sessions')='1' and (pg_temp.g('gp')->'summary'->'attendance'->>'total')='2' or (pg_temp.g('gp')->'summary'->'attendance'->>'sessions')='1','last month has the one session of its last second; the session that starts exactly at the new month is not in it');
select pg_temp.ok((pg_temp.g('gp')->'summary'->'attendance'->>'pct')='100','last month attendance: E present = 100%');
select pg_temp.ok((pg_temp.g('gp')->'summary'->'exams'->>'count')='1' and (pg_temp.g('gp')->'summary'->'exams'->>'pct')='100','last month exams: the paper of day 10, 10 of 10');
select pg_temp.ok((pg_temp.g('gp')->'summary'->'homework'->>'given')='1','last month homework: H5');
select set_config('rp.sall',public.report_student(pg_temp.uid('a'),pg_temp.key('off'),'all')::text,true);
select pg_temp.ok((pg_temp.g('sall')->>'month')='all' and (pg_temp.g('sall')->'attendance'->>'present')='3' and (pg_temp.g('sall')->'attendance'->>'total')='4','Whole course: A attended 3 of 4 finalized sessions (cancelled and unsaved still excluded)');
select pg_temp.ok((pg_temp.g('sall')->'homework'->>'given')='5' and (pg_temp.g('sall')->'homework'->>'done')='4' and (pg_temp.g('sall')->'homework'->>'missing')='1','Whole course: A has 5 homework given, 4 done, 1 missing; the one not due yet is open, not given and not missing');
select pg_temp.ok((select x->>'state' from jsonb_array_elements(pg_temp.g('sall')->'homeworkList') x where x->>'title'='Not due yet')='open','Whole course: homework not due yet is listed as Open');
select set_config('rp.call',public.report_group(pg_temp.key('g1'),'all')::text,true);
select pg_temp.ok((pg_temp.g('call')->'summary'->'exams'->>'count')='3','Whole course: three exams in the Saturday group');
-- Empty course
select pg_temp.ok((select (x->>'hasNumbers')='false' and x->'attendance'->>'pct' is null from jsonb_array_elements(public.report_groups(array[pg_temp.key('g3')])->'groups') x),'an empty Group has no numbers yet');
select pg_temp.ok(public.report_group(pg_temp.key('g3'),pg_temp.cm())->>'attentionTotal'='0' and jsonb_array_length(public.report_group(pg_temp.key('g3'),pg_temp.cm())->'everyone')=0,'an empty Group has nobody to show');
select pg_temp.ok(jsonb_array_length(public.report_course(pg_temp.key('course2'),pg_temp.cm())->'chapters')=0,'a course with no chapters has no results');
-- The same answer in any session time zone
select set_config('rp.base',public.report_group(pg_temp.key('g1'),pg_temp.cm())::text,true);
select set_config('timezone','America/Los_Angeles',true);
select pg_temp.ok((public.report_group(pg_temp.key('g1'),pg_temp.cm())-'from'-'to')=(pg_temp.g('base')-'from'-'to'),'the Group report is the same under America/Los_Angeles');
select set_config('timezone','Pacific/Kiritimati',true);
select pg_temp.ok((public.report_group(pg_temp.key('g1'),pg_temp.cm())-'from'-'to')=(pg_temp.g('base')-'from'-'to'),'the Group report is the same under Pacific/Kiritimati');
select set_config('timezone','UTC',true);
select pg_temp.ok((public.report_group(pg_temp.key('g1'),pg_temp.cm())-'from'-'to')=(pg_temp.g('base')-'from'-'to'),'the Group report is the same under UTC');
select pg_temp.ok((public.report_group(pg_temp.key('g1'),pg_temp.cm())->>'from')::timestamptz=pg_temp.mlo() and (public.report_group(pg_temp.key('g1'),pg_temp.cm())->>'to')::timestamptz=(date_trunc('month',pg_temp.mlo() at time zone 'Africa/Cairo')+interval '1 month') at time zone 'Africa/Cairo','the range is the Cairo month, whatever the session time zone');
-- An assistant whose correcting and releasing rights are off still reads the numbers (they are the same view the queues give)
reset role;
insert into private.homework_assistant_permissions(course_id,user_id,can_correct,can_release) values(pg_temp.key('course'),pg_temp.uid('ta'),false,false);
set local role authenticated;
select pg_temp.claim('ta');
select pg_temp.ok(public.report_group(pg_temp.key('g1'),pg_temp.cm())->'group'->>'name'='Saturday group','an assistant with correcting and releasing off still reads the Group report');
select pg_temp.claim('owner');
-- Nothing was written
reset role;
select pg_temp.ok((select count(*) from public.group_sessions where group_id in (pg_temp.key('g1'),pg_temp.key('g2')))=9,'the reads wrote nothing');

-- ---------------------------------------------------------------- Review fixes: not_marked, homework visibility, open homework, exam edge cases. One more run (off3) with its own Group G4.
-- a and b are in G4 all along; d is in no Group. Homework: HP (published lesson) a handed in, b did not; HD in a DRAFT lesson (published homework, invisible to students);
-- HO due a minute before the month ends, handed in by nobody (open). Sessions X1, X2: a attended both; b attended X1 and is not_marked in X2.
-- Exams (online, per Group, window of G4 = the first 20 minutes of the month): X5 a took it, b has a result with no final attempt, d (no Group) did not come;
-- X6 a's result names an attempt whose Group (G1) has no window, b and d did not come.
reset role;
select pg_temp.put(k,gen_random_uuid()) from unnest(array['course3','off3','g4','m4','lp','ld','hp','hd','ho','x1','x2','x5','x6']) k;
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values(pg_temp.key('course3'),pg_temp.key('org'),'Synthetic Chemistry','rp-chem','published','private',pg_temp.uid('owner'));
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off3'),pg_temp.key('course3'),'Chemistry run','scheduled','active');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('m4'),pg_temp.key('course3'),'Acids',0);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('lp'),pg_temp.key('m4'),'pH',0,'published'),(pg_temp.key('ld'),pg_temp.key('m4'),'Draft lesson',1,'draft');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off3'),pg_temp.uid(l),'active',now()-interval '60 days' from unnest(array['a','b','d']) l;
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values(pg_temp.key('g4'),pg_temp.key('off3'),'Chemistry group','center','Room 4',pg_temp.uid('owner'));
insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
 select pg_temp.put('mem4_'||e.user_id,gen_random_uuid()),pg_temp.key('g4'),e.offering_id,e.user_id,e.id,now()-interval '50 days',null,pg_temp.uid('owner')
 from public.enrollments e where e.offering_id=pg_temp.key('off3') and e.user_id in (pg_temp.uid('a'),pg_temp.uid('b'));
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select pg_temp.put(v.k,gen_random_uuid()),pg_temp.key('g4'),v.k,v.t,v.t+interval '1 second',v.t,v.t+interval '1 second','center',false,'finalized',pg_temp.uid('owner'),pg_temp.uid('owner')
 from (values ('x1',pg_temp.lo()+interval '1 second'),('x2',pg_temp.lo()+interval '2 seconds')) v(k,t);
insert into public.session_attendance(session_id,user_id,membership_id,status)
 select pg_temp.key(v.s),pg_temp.uid(v.l),pg_temp.key('mem4_'||pg_temp.uid(v.l)),v.st from (values ('x1','a','attended'),('x2','a','attended'),('x1','b','attended'),('x2','b','not_marked')) v(s,l,st);
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
 select pg_temp.key(v.k),pg_temp.key('course3'),pg_temp.key('off3'),pg_temp.key(v.l),v.t,'published',pg_temp.key(v.k),pg_temp.uid('owner'),v.d,true,'questions','PLATFORM_QUESTIONS','one_time',1,'after_deadline' from (values
  ('hp','lp','Published homework',pg_temp.lo()+interval '3 seconds'),('hd','ld','Homework in a draft lesson',pg_temp.lo()+interval '4 seconds'),
  ('ho','lp','Still open',pg_temp.lo()+interval '1 month'-interval '1 minute')) v(k,l,t,d);
insert into public.homework_submissions(id,assignment_id,user_id,number,status,submitted_at) values(gen_random_uuid(),pg_temp.key('hp'),pg_temp.uid('a'),1,'submitted',now()-interval '1 day');
insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,timing,tries_mode,starting_from,created_by)
 select pg_temp.key(v.k),pg_temp.key(v.k),pg_temp.key('course3'),pg_temp.key('off3'),'online',v.t,'published',now()-interval '30 days','per_group','one_time',(pg_temp.lo() at time zone 'Africa/Cairo')::date-1,pg_temp.uid('owner') from (values ('x5','Quiz 5'),('x6','Quiz 6')) v(k,t);
insert into private.exam_chapters(exam_id,module_id) values(pg_temp.key('x5'),pg_temp.key('m4')),(pg_temp.key('x6'),pg_temp.key('m4'));
insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at) values
 (pg_temp.key('x5'),pg_temp.key('g4'),'custom',pg_temp.lo()+interval '1 minute',pg_temp.lo()+interval '20 minutes'),(pg_temp.key('x6'),pg_temp.key('g4'),'custom',pg_temp.lo()+interval '1 minute',pg_temp.lo()+interval '20 minutes');
insert into private.exam_attempts(id,exam_id,user_id,number,window_group_id,started_at,deadline_at,submitted_at,status) values
 (pg_temp.put('try5a',gen_random_uuid()),pg_temp.key('x5'),pg_temp.uid('a'),1,pg_temp.key('g4'),pg_temp.lo()+interval '2 minutes',pg_temp.lo()+interval '15 minutes',pg_temp.lo()+interval '10 minutes','submitted'),
 (pg_temp.put('try6a',gen_random_uuid()),pg_temp.key('x6'),pg_temp.uid('a'),1,pg_temp.key('g1'),pg_temp.lo()+interval '2 minutes',pg_temp.lo()+interval '15 minutes',pg_temp.lo()+interval '10 minutes','submitted');
insert into private.exam_results(exam_id,user_id,final_attempt_id,absent,status,score,max_score,released_at,released_by) values
 (pg_temp.key('x5'),pg_temp.uid('a'),pg_temp.key('try5a'),false,'corrected',18,20,now(),pg_temp.uid('owner')),
 (pg_temp.key('x5'),pg_temp.uid('b'),null,false,'corrected',10,20,now(),pg_temp.uid('owner')),
 (pg_temp.key('x6'),pg_temp.uid('a'),pg_temp.key('try6a'),false,'corrected',16,20,now(),pg_temp.uid('owner'));
set local role authenticated;
select pg_temp.claim('owner');
select set_config('rp.g4',public.report_group(pg_temp.key('g4'),pg_temp.cm())::text,true);
select set_config('rp.s4a',public.report_student(pg_temp.uid('a'),pg_temp.key('off3'),pg_temp.cm())::text,true);
select set_config('rp.s4b',public.report_student(pg_temp.uid('b'),pg_temp.key('off3'),pg_temp.cm())::text,true);
select set_config('rp.s4d',public.report_student(pg_temp.uid('d'),pg_temp.key('off3'),pg_temp.cm())::text,true);
-- 1. not_marked is neither present nor absent
select pg_temp.ok((pg_temp.g('s4b')->'attendance'->>'present')='1' and (pg_temp.g('s4b')->'attendance'->>'total')='1' and (pg_temp.g('s4b')->'attendance'->>'pct')='100','a not_marked row in a finalized session leaves the student numbers as they were (1 of 1)');
select pg_temp.ok(jsonb_array_length(pg_temp.g('s4b')->'sessions')=1 and (pg_temp.g('s4a')->'attendance'->>'total')='2','the not_marked session is not in the student session boxes');
-- 2. homework of a lesson that is not published is not given
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.g('s4a')->'homeworkList') x where x->>'title'='Homework in a draft lesson') and not exists(select 1 from jsonb_array_elements(pg_temp.g('s4b')->'homeworkList') x where x->>'title'='Homework in a draft lesson'),'published homework in a draft lesson counts for nobody');
select pg_temp.ok((pg_temp.g('g4')->'summary'->'homework'->>'given')='1','the Group has one homework given (the published lesson), not the draft lesson one');
-- 3. open homework is not counted yet
select pg_temp.ok((pg_temp.g('s4a')->'homework'->>'given')='1' and (pg_temp.g('s4a')->'homework'->>'done')='1' and (pg_temp.g('s4b')->'homework'->>'missing')='1' and (pg_temp.g('s4b')->'homework'->>'given')='1','homework due at the end of the month and not handed in is left out of given and of missing');
select pg_temp.ok((select x->>'state' from jsonb_array_elements(pg_temp.g('s4b')->'homeworkList') x where x->>'title'='Still open')='open','it is listed as Open on the Student page');
select pg_temp.ok((pg_temp.g('g4')->'summary'->'homework'->>'pct')='50','the Group homework % ignores the open homework (1 of 2 students handed in the due one)');
-- the Group report has no Pace
select pg_temp.ok(not (pg_temp.g('g4') ? 'pace'),'the Group report carries no Pace');
-- 5a. a student in no Group could take the per-Group exam: the no-show is Absent
select pg_temp.ok((pg_temp.g('s4d')->'exams'->>'absent')='2','a student in no Group who did not come to two per-Group online exams is Absent from both');
-- 5b. a per-Group result with no final attempt, or with an attempt of a Group that has no window, still counts
select pg_temp.ok((select x->>'state' from jsonb_array_elements(pg_temp.g('s4b')->'examList') x where x->>'title'='Quiz 5')='marked' and (pg_temp.g('s4b')->'exams'->>'pct')='50','a result with no final attempt stays in the numbers (10 of 20)');
select pg_temp.ok((select x->>'state' from jsonb_array_elements(pg_temp.g('s4a')->'examList') x where x->>'title'='Quiz 6')='marked' and (pg_temp.g('s4a')->'exams'->>'pct')='85','a result whose attempt names a Group with no window stays in the numbers ((18+16) of 40)');
select pg_temp.ok((pg_temp.g('s4b')->'exams'->>'absent')='1','b is Absent only from the exam they did not come to');

-- ---------------------------------------------------------------- Last 4 weeks (the default range) and the missed-sessions rule. One more run (off4) with its own Group G6.
-- The window is the last 28 Cairo days: today and the 27 days before it, from the start of that Cairo day to the start of tomorrow. RS = the first instant of the window.
-- a, b, c, e are in G6 all along. Sessions (finalized): R1 exactly at RS, R2 one second before RS, R3 two days later, R4 yesterday, R5 two hours ago.
-- a: absent R1 and R2, present R3 R4 R5 (one miss inside the window, a second one just outside it). b: absent R1 and R3 (two misses). c: present at all five.
-- e: absent R1, present R3 (one miss, 50%). Homework (published lesson, file marks): HA due exactly at RS, HB due one second before RS; nobody handed in either.
reset role;
select pg_temp.put(k,gen_random_uuid()) from unnest(array['course4','off4','g6','m5','l5','r1','r2','r3','r4','r5','ha','hb']) k;
create function pg_temp.rs() returns timestamptz language sql as $$select ((clock_timestamp() at time zone 'Africa/Cairo')::date-27)::timestamp at time zone 'Africa/Cairo'$$;
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values(pg_temp.key('course4'),pg_temp.key('org'),'Synthetic Biology','rp-bio','published','private',pg_temp.uid('owner'));
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off4'),pg_temp.key('course4'),'Biology run','scheduled','active');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('m5'),pg_temp.key('course4'),'Cells',0);
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('l5'),pg_temp.key('m5'),'Membranes',0,'published');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off4'),pg_temp.uid(l),'active',now()-interval '90 days' from unnest(array['a','b','c','e']) l;
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values(pg_temp.key('g6'),pg_temp.key('off4'),'Biology group','center','Room 6',pg_temp.uid('owner'));
insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
 select pg_temp.put('mem6_'||e.user_id,gen_random_uuid()),pg_temp.key('g6'),e.offering_id,e.user_id,e.id,now()-interval '80 days',null,pg_temp.uid('owner')
 from public.enrollments e where e.offering_id=pg_temp.key('off4');
insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select pg_temp.put(v.k,gen_random_uuid()),pg_temp.key('g6'),v.k,v.t,v.t+interval '1 second',v.t,v.t+interval '1 second','center',false,'finalized',pg_temp.uid('owner'),pg_temp.uid('owner')
 from (values ('r1',pg_temp.rs()),('r2',pg_temp.rs()-interval '1 second'),('r3',pg_temp.rs()+interval '2 days'),('r4',now()-interval '1 day'),('r5',now()-interval '2 hours')) v(k,t);
insert into public.session_attendance(session_id,user_id,membership_id,status)
 select pg_temp.key(v.s),pg_temp.uid(v.l),pg_temp.key('mem6_'||pg_temp.uid(v.l)),v.st from (values
  ('r1','a','absent'),('r2','a','absent'),('r3','a','attended'),('r4','a','attended'),('r5','a','attended'),
  ('r1','b','absent'),('r2','b','attended'),('r3','b','absent'),('r4','b','attended'),('r5','b','attended'),
  ('r1','c','attended'),('r2','c','attended'),('r3','c','attended'),('r4','c','attended'),('r5','c','attended'),
  ('r1','e','absent'),('r3','e','attended')) v(s,l,st);
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
 select pg_temp.key(v.k),pg_temp.key('course4'),pg_temp.key('off4'),pg_temp.key('l5'),v.t,'published',pg_temp.key(v.k),pg_temp.uid('owner'),v.d,true,'questions','PLATFORM_QUESTIONS','one_time',1,'after_deadline' from (values
  ('ha','Due at the start of the window',pg_temp.rs()),('hb','Due just before the window',pg_temp.rs()-interval '1 second')) v(k,t,d);
set local role authenticated;
select pg_temp.claim('owner');
select set_config('rp.g6',public.report_group(pg_temp.key('g6'),null)::text,true);
select set_config('rp.g6all',public.report_group(pg_temp.key('g6'),'all')::text,true);
select set_config('rp.att6',public.report_attention(pg_temp.key('off4'),0)::text,true);
select set_config('rp.s6a',public.report_student(pg_temp.uid('a'),pg_temp.key('off4'),null)::text,true);
-- the window itself
select pg_temp.ok((pg_temp.g('g6')->>'month')='last4weeks' and (pg_temp.g('g6')->>'from')::timestamptz=pg_temp.rs() and (pg_temp.g('g6')->>'to')::timestamptz=(((clock_timestamp() at time zone 'Africa/Cairo')::date+1)::timestamp at time zone 'Africa/Cairo'),'no month sent: the range is the last 28 Cairo days, from the start of the first day to the start of tomorrow');
select pg_temp.ok((public.report_groups(array[pg_temp.key('g6')])->>'month')='last4weeks' and (public.report_attention(pg_temp.key('off4'),0)->>'month')='last4weeks','the Groups list and the Needs attention list always use the last 4 weeks');
select pg_temp.ok((pg_temp.g('g6')->'summary'->'attendance'->>'sessions')='4','the session exactly at the start of the window is in, the one second before it is out (4 of 5 sessions)');
select pg_temp.ok((pg_temp.g('g6all')->>'month')='all' and (pg_temp.g('g6all')->'summary'->'attendance'->>'sessions')='5','Whole course still counts all five sessions');
select pg_temp.ok((pg_temp.g('s6a')->'attendance'->>'total')='4' and (pg_temp.g('s6a')->'attendance'->>'present')='3' and jsonb_array_length(pg_temp.g('s6a')->'sessions')=4,'the Student page default is the same window: a was at 3 of 4');
select pg_temp.ok((pg_temp.g('s6a')->'homework'->>'given')='1' and (pg_temp.g('s6a')->'homework'->>'missing')='1','homework due exactly at the start of the window counts, the one due a second earlier does not');
select pg_temp.ok((public.report_student(pg_temp.uid('a'),pg_temp.key('off4'),'all')->'attendance'->>'total')='5' and (public.report_student(pg_temp.uid('a'),pg_temp.key('off4'),'all')->'homework'->>'missing')='2','Whole course on the Student page still counts everything');
select pg_temp.ok((public.report_student(pg_temp.uid('a'),pg_temp.key('off4'),to_char(clock_timestamp() at time zone 'Africa/Cairo','YYYY-MM'))->>'month')=to_char(clock_timestamp() at time zone 'Africa/Cairo','YYYY-MM'),'this month is still a choice');
select pg_temp.ok(jsonb_array_length(public.report_course(pg_temp.key('course4'),null)->'chapters')=1 and (public.report_course(pg_temp.key('course4'),null)->>'month')='last4weeks','Course Results default to the last 4 weeks too');
-- missed 2 or more sessions in the range
select pg_temp.ok((pg_temp.row_of(pg_temp.g('g6'),'A Student')->'reasons')='[]'::jsonb or not exists(select 1 from jsonb_array_elements(pg_temp.row_of(pg_temp.g('g6'),'A Student')->'reasons') r where r->>'code'='missed_sessions'),'one missed session never flags (a missed one in the window and a second just outside it)');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.g('g6')->'attention') x where x->>'name' in ('A Student','C Student','E Student')),'a (75%), c (100%) and e (50%, one miss) are not under Needs attention');
select pg_temp.ok((select x->'reasons' from jsonb_array_elements(pg_temp.g('g6')->'attention') x where x->>'name'='B Student')=jsonb_build_array(jsonb_build_object('code','missed_sessions','n',2)),'two missed sessions flag, worded Missed N sessions (n = 2)');
select pg_temp.ok((pg_temp.g('g6')->>'attentionTotal')='1' and (pg_temp.g('att6')->>'total')='1' and (pg_temp.g('att6')->'rows'->0->>'name')='B Student','the Group page and the Students filter agree: only b');
select pg_temp.ok((select (x->>'attention')='1' from jsonb_array_elements(public.report_groups(array[pg_temp.key('g6')])->'groups') x),'the Groups list pill says 1');
select pg_temp.ok((pg_temp.g('g6all')->>'attentionTotal')::int>=1 and exists(select 1 from jsonb_array_elements(pg_temp.g('g6all')->'attention') x where x->>'name'='A Student' and x->'reasons'->0->>'n'='2'),'over the whole course a has missed two sessions and is flagged');

select count(*)::integer reports_tests from rp_results;
rollback;
