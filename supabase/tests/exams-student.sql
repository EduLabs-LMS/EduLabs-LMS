-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Covers migration 20261115120000_exams_drafts_and_demo_v7.sql: (1) a DRAFT keeps unfinished questions (a choice without a right answer or with one
-- option, a number without a value) and Publish refuses them with the list; a published exam keeps the strict rules; (2) the demo seed version 7
-- (five exams: open now, closed with essays waiting, released with review open, upcoming, paper) and Clear removing all of it.
begin;
create temp table xs_results(name text primary key);
create temp table xs_users(label text primary key,id uuid not null);
create temp table xs_ids(label text primary key,id uuid not null);
grant select,insert,update on xs_results,xs_users,xs_ids to authenticated,anon;
select set_config('xs.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.xs_results values(label);end$$;
-- The refusal as {code, message, reason, questions}.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end,'questions',case when coalesce(d,'') like '{%' then d::jsonb->'questions' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('xs.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','xs-'||current_setting('xs.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.xs_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.xs_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.xs_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
create function pg_temp.rev(p_exam uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.exams where id=p_exam$$;
create function pg_temp.status_of(p_exam uuid) returns text language sql security definer set search_path='' as $$select status from private.exams where id=p_exam$$;
create function pg_temp.qcount(p_exam uuid) returns integer language sql security definer set search_path='' as $$select count(*)::int from private.exam_questions where exam_id=p_exam$$;
create function pg_temp.exam_named(t text) returns uuid language sql security definer set search_path='' as $$
 select e.id from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=pg_temp.key('org') and e.title=t$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher'] loop
  perform pg_temp.claim(label); insert into pg_temp.xs_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from xs_users where label='admin';
select pg_temp.put('org',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo exams student','xs-'||current_setting('xs.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));
select pg_temp.ok(private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))=jsonb_build_object('seedVersion',9,'courses',2,'lessons',6,'groups',2,'sessions',10,'students',28,'homework',5,'exams',5),'Fill reports seed version 9 with five exams');
select pg_temp.ok((select seed_version=9 from private.demo_spaces where organization_id=pg_temp.key('org')),'the space stores seed version 9');
select pg_temp.put('course',(select id from public.courses where organization_id=pg_temp.key('org') and status='published' order by title limit 1));
select pg_temp.put('off',(select o.id from public.course_offerings o where o.course_id=pg_temp.key('course') order by o.id limit 1));
select pg_temp.put('g1',(select g.id from public.study_groups g where g.offering_id=pg_temp.key('off') and g.name='Demo Group 1'));
select pg_temp.put('g2',(select g.id from public.study_groups g where g.offering_id=pg_temp.key('off') and g.name='Demo Group 2'));

-- ---------------------------------------------------------------------------------------
-- Demo seed version 7
-- ---------------------------------------------------------------------------------------
select pg_temp.put('open',pg_temp.exam_named('Electric current: quiz (open now)'));
select pg_temp.put('closed',pg_temp.exam_named('Electric current: mid-term (closed)'));
select pg_temp.put('released',pg_temp.exam_named('Magnetism: unit test (released)'));
select pg_temp.put('upcoming',pg_temp.exam_named('Electromagnetic induction: quiz (upcoming)'));
select pg_temp.put('paper',pg_temp.exam_named('Electricity: paper exam'));
select pg_temp.ok((select count(*)=5 and bool_and(e.status='published' and e.published_at is not null) from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=pg_temp.key('org')),'five published exams');
select pg_temp.ok((select w.state='ok' and w.opens_at<=clock_timestamp() and w.closes_at>clock_timestamp() from private.exam_windows(pg_temp.key('open')) w where w.group_id=pg_temp.key('g1')),'the open-now exam is open for Demo Group 1');
select pg_temp.ok((select w.state='ok' and w.opens_at>clock_timestamp() from private.exam_windows(pg_temp.key('open')) w where w.group_id=pg_temp.key('g2')),'and opens later for Demo Group 2');
select pg_temp.ok((select count(*) filter(where status='submitted')=3 and count(*) filter(where status='in_progress')=2 from private.exam_attempts where exam_id=pg_temp.key('open')),'some students started, 3 handed in, 2 working');
select pg_temp.ok(not private.exam_closed(pg_temp.key('open')),'the open-now exam is not closed');
select pg_temp.ok(private.exam_closed(pg_temp.key('closed')) and private.exam_closed(pg_temp.key('released')),'the closed and released exams are closed');
select pg_temp.ok((select count(*) filter(where status='waiting')>0 and count(*) filter(where status='corrected')>0 and count(*) filter(where released_at is not null)=0 from private.exam_results where exam_id=pg_temp.key('closed')),'closed: essays waiting, some corrected and not released');
select pg_temp.ok((select count(*)=20 and bool_and(status='corrected' and released_at is not null) from private.exam_results where exam_id=pg_temp.key('released')),'released: 20 results corrected and released');
select pg_temp.ok((select bool_and(w.state='ok' and w.opens_at>clock_timestamp()) and count(*)=2 from private.exam_windows(pg_temp.key('upcoming')) w),'upcoming: each Group has its next session');
select pg_temp.ok((select count(*) filter(where paper_mark is not null)=17 and count(*) filter(where absent)=1 and count(*)=18 and count(*) filter(where released_at is not null)=4 from private.exam_results where exam_id=pg_temp.key('paper')),'paper: 17 marks, one Absent, the rest missing');
select pg_temp.ok((select count(*)=183 from private.demo_seed_rows where organization_id=pg_temp.key('org') and module='exams'),'the exam rows are recorded');
select pg_temp.ok(not exists(select 1 from private.exam_uploads where exam_id in(select id from private.exams where course_id=pg_temp.key('course'))),'the seed stores no exam file');

-- A plain Clear (nothing added by the teacher) removes exactly the recorded rows plus the exam rows.
savepoint plain_clear;
create temp table xs_probe as select private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin')) r;
select pg_temp.ok((select (r->>'removedRows')::int=1568 from xs_probe),'a plain Clear removes exactly 1568 rows (800 before the exams, plus 767 exam rows)');
rollback to plain_clear;

-- The release notice of a new exam result links to the exam page (the link is generated and checked again when read; it needs the student's own sign-in,
-- which demo students do not have, so this only proves the branch is installed and the grants are unchanged).
select pg_temp.ok(pg_get_functiondef('private.notification_link(uuid,uuid)'::regprocedure) like '%private.exam_released(r.id)%/exams/%','the exam_released link opens the exam page');

-- ---------------------------------------------------------------------------------------
-- Drafts keep unfinished questions
-- ---------------------------------------------------------------------------------------
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.put('d',(public.exam_save(null,pg_temp.key('off'),null,jsonb_build_object('kind','online','title','Draft with gaps','timing','same_time',
 'opensAt',to_char(now()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),'closesAt',to_char(now()+interval '2 days','YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
 'questions',jsonb_build_array(
  jsonb_build_object('type','choice','text','No right answer','points',1,'options',jsonb_build_array('a','b'),'correct',jsonb_build_array()),
  jsonb_build_object('type','choice','text','One option, nothing ticked','points',1,'options',jsonb_build_array('only')),
  jsonb_build_object('type','number','text','No value','points',1,'numberValue',null),
  jsonb_build_object('type','essay','text','Why?','points',2))))->>'id')::uuid);
reset role;
select pg_temp.ok(pg_temp.qcount(pg_temp.key('d'))=4,'a draft with unfinished questions saves, all 4 questions stored');
select pg_temp.ok((select count(*)=3 from private.exam_keys k join private.exam_questions q on q.id=k.question_id where q.exam_id=pg_temp.key('d') and q.type<>'essay' and cardinality(k.correct_option_ids)=0 and k.number_value is null),'unfinished keys are stored empty');
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((select (r->>'code')='23514' and r->>'reason'='unfinished_questions' and r->'questions'='[1,2,3]'::jsonb from (select pg_temp.refusal(format('select public.exam_lifecycle(%L,''publish'',%s)',pg_temp.key('d'),pg_temp.rev(pg_temp.key('d')))) r) x),
 'Publish refuses the unfinished questions and lists them (1, 2, 3)');
select pg_temp.ok(pg_temp.rev(pg_temp.key('d'))>=1 and pg_temp.status_of(pg_temp.key('d'))='draft','the exam is still a draft');
-- A second save of the same draft keeps working with every question, then finishing them makes Publish work.
select public.exam_save(pg_temp.key('d'),null,pg_temp.rev(pg_temp.key('d')),jsonb_build_object('questions',jsonb_build_array(
 jsonb_build_object('type','choice','text','Right one','points',1,'options',jsonb_build_array('a','b'),'correct',jsonb_build_array(1)),
 jsonb_build_object('type','choice','text','Two options','points',1,'options',jsonb_build_array('x','y'),'correct',jsonb_build_array(0)),
 jsonb_build_object('type','number','text','Value','points',1,'numberValue',4.5,'tolerance',0.1),
 jsonb_build_object('type','essay','text','Why?','points',2))));
select pg_temp.ok(public.exam_lifecycle(pg_temp.key('d'),'publish',pg_temp.rev(pg_temp.key('d')))->>'status'='published','once finished the exam publishes');
-- A published exam keeps the strict rules.
select pg_temp.ok((x.r->>'code')='23514','a published exam refuses a choice without a right answer') from (select pg_temp.refusal(format('select public.exam_save(%L,null,%s,%L::jsonb)',pg_temp.key('d'),pg_temp.rev(pg_temp.key('d')),
 jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','text','x','points',1,'options',jsonb_build_array('a','b')))))) r) x;
select pg_temp.ok((x.r->>'code')='23514','a published exam refuses a number without a value') from (select pg_temp.refusal(format('select public.exam_save(%L,null,%s,%L::jsonb)',pg_temp.key('d'),pg_temp.rev(pg_temp.key('d')),
 jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','number','text','x','points',1,'numberValue',null))))) r) x;
-- A draft still refuses nonsense (an index outside the options, a number question with options).
select pg_temp.put('d2',(public.exam_save(null,pg_temp.key('off'),null,'{"kind":"online","title":"Second draft"}')->>'id')::uuid);
select pg_temp.ok((x.r->>'code')='23514','a draft refuses a right answer outside the options') from (select pg_temp.refusal(format('select public.exam_save(%L,null,%s,%L::jsonb)',pg_temp.key('d2'),pg_temp.rev(pg_temp.key('d2')),
 jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','choice','text','x','points',1,'options',jsonb_build_array('a','b'),'correct',jsonb_build_array(5)))))) r) x;
select pg_temp.ok((x.r->>'code')='23514','a draft refuses options on a number question') from (select pg_temp.refusal(format('select public.exam_save(%L,null,%s,%L::jsonb)',pg_temp.key('d2'),pg_temp.rev(pg_temp.key('d2')),
 jsonb_build_object('questions',jsonb_build_array(jsonb_build_object('type','number','text','x','points',1,'options',jsonb_build_array('a')))))) r) x;
reset role;

-- ---------------------------------------------------------------------------------------
-- Clear removes everything the seed made
-- ---------------------------------------------------------------------------------------
select pg_temp.ok(private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin')) is not null,'Clear runs');
select pg_temp.ok(not exists(select 1 from private.exams where course_id=pg_temp.key('course')) and not exists(select 1 from private.exam_attempts a where a.exam_id in(pg_temp.key('open'),pg_temp.key('closed'),pg_temp.key('released')))
 and not exists(select 1 from private.exam_results where exam_id in(pg_temp.key('open'),pg_temp.key('closed'),pg_temp.key('released'),pg_temp.key('paper'))),'every exam, try and result is gone');
select pg_temp.ok((select seed_version is null and filled_at is null from private.demo_spaces where organization_id=pg_temp.key('org')),'the space is demo again and empty');
select pg_temp.ok(private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion'='9','it fills again');

select count(*) as exams_student_checks from xs_results;
rollback;
