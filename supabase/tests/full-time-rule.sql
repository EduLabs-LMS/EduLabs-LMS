-- Disposable local PostgreSQL only. Synthetic people (Firebase identities); every change rolls back; no real account exists.
-- Covers migration 20261128140000_full_time_rule.sql (fix track 3) where one session is enough: grants and definer settings of what it adds,
-- the Protect answers column (default ON on every existing exam, the demo fill's exams read back ON), saving, cloning and the paper refusal of
-- protectAnswers, the two constants, the three-argument homework_is_late, and the over gate on synthetic rows. The two-session proofs (a to g)
-- are scripts/full-time-rule-concurrency.cjs.
begin;
create temp table ft_results(name text primary key);
grant select,insert on ft_results to authenticated;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.ft_results values(label);end$$;
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;m text;c text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail,m=message_text,c=returned_sqlstate;
  return jsonb_build_object('code',c,'message',m,'reason',case when coalesce(d,'') like '{%' then d::jsonb->>'reason' end); end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.u(label text) returns uuid language sql immutable as $$select md5('full-time:person:'||label)::uuid$$;
create function pg_temp.person(label text) returns void language sql as $$
 insert into public.profiles(id,display_name,status) values(pg_temp.u(label),'Full time '||label,'active');
 insert into private.external_identities(profile_id,provider,issuer,subject,verified_at) values(pg_temp.u(label),'firebase','https://securetoken.google.com/diagonproduction','full-time-'||label,now());$$;
create function pg_temp.claim(label text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'sub','full-time-'||label,'auth_time',floor(extract(epoch from now()))::bigint)::text,true)$$;

-- 1. What the migration adds: private helpers are definers with an empty search path that nobody but their owner may call; the changed
-- public entry points stay invokers callable by signed-in people only; the new view is closed.
select pg_temp.ok(bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('authenticated',p.oid,'execute')
  and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')) and count(*)=6,'the six new private helpers: definer, empty search path, no caller grants')
 from pg_proc p where p.oid in ('private.homework_grace()'::regprocedure,'private.upload_cap()'::regprocedure,'private.exam_over_at(uuid)'::regprocedure,'private.exam_writing(uuid)'::regprocedure,
  'private.homework_is_late(timestamptz,timestamptz,timestamptz)'::regprocedure,'private.homework_draft_open(uuid,uuid)'::regprocedure);
-- create or replace keeps each ACL: only the bodies behind the public wrappers (and homework_unlocked, used by the Storage policies) are callable
-- by authenticated, as before this migration; none by anon.
select pg_temp.ok(bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon',p.oid,'execute'))
  and array_agg(p.proname::text order by p.proname) filter (where has_function_privilege('authenticated',p.oid,'execute'))
   =array['exam_get','exam_lifecycle','exam_save','exam_upload','get_homework','homework_unlocked','homework_upload','homework_work'],
  'the replaced private functions keep definer, empty search path and their grants')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('exam_closed','exam_review_open','exam_release_check','exam_user_windows','exam_settle',
  'exam_settings_json','exam_save','exam_get','exam_attempt_json','exam_lifecycle','exam_upload','homework_solutions_rule','homework_unlocked','homework_work','homework_upload','get_homework','report_homework','report_exams');
select pg_temp.ok(bool_and(not p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')),'the public entry points stay invokers, authenticated only')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('exam_get','exam_work','exam_save','exam_lifecycle','exam_upload','homework_work','homework_upload','get_homework','exam_student_list');
select pg_temp.ok(not has_table_privilege(r,'private.expired_exam_uploads','select') and not has_table_privilege(r,'private.expired_homework_uploads','select'),'the cleanup views are closed to '||r)
 from unnest(array['authenticated','anon','service_role']) r;
-- Every private view runs with the caller's rights (create or replace view without the WITH clause would silently drop the option).
select pg_temp.ok(coalesce(c.reloptions,'{}') @> array['security_invoker=true'],'private view '||c.oid::regclass::text||' keeps security_invoker=true')
 from pg_class c where c.relnamespace='private'::regnamespace and c.relkind='v';
select pg_temp.ok(count(*)>=3,'the private views were checked ('||count(*)||')') from pg_class c where c.relnamespace='private'::regnamespace and c.relkind='v';
select pg_temp.ok((select attnotnull and pg_get_expr(d.adbin,d.adrelid)='true' from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='private.exams'::regclass and a.attname='protect_answers'),'protect_answers is boolean not null default true');
select pg_temp.ok(private.homework_grace()=interval '30 minutes' and private.upload_cap()=40,'the grace is 30 minutes and the photo cap 40');

-- 2. The three-argument lateness (the deadline at 12:00).
select pg_temp.ok(private.homework_is_late(t::timestamptz,'2026-12-01 12:00Z',s::timestamptz)=late,format('late at %s for a try started %s: %s',t,s,late))
 from (values ('2026-12-01 11:59Z','2026-12-01 11:00Z',false),('2026-12-01 12:20Z','2026-12-01 11:55Z',false),('2026-12-01 12:30Z','2026-12-01 12:00Z',false),
  ('2026-12-01 12:30:01Z','2026-12-01 11:55Z',true),('2026-12-01 12:10Z','2026-12-01 12:01Z',true),('2026-12-01 12:10Z',null,true)) v(t,s,late);
select pg_temp.ok(private.homework_is_late('2026-12-01 13:00Z',null,'2026-12-01 11:00Z')=false,'no deadline: never late');

-- 3. The demo fill: every exam it makes reads back Protect answers ON (the column default; nothing else sets it).
select pg_temp.person('admin'); select pg_temp.person('owner');
insert into private.platform_admins(user_id,note) values(pg_temp.u('admin'),'full-time admin');
insert into public.organizations(id,name,slug) values(md5('full-time:org')::uuid,'Full time demo','full-time-demo');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(md5('full-time:org')::uuid,pg_temp.u('owner'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(md5('full-time:org')::uuid,pg_temp.u('admin'));
select private.demo_fill_core(md5('full-time:org')::uuid,pg_temp.u('admin'));
select pg_temp.ok(count(*)>0 and bool_and(e.protect_answers) and bool_and((private.exam_settings_json(e.id)->>'protectAnswers')::boolean),'every demo exam reads back Protect answers ON ('||count(*)||' exams)')
 from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=md5('full-time:org')::uuid;

-- 4. Save, read back, clone, and the paper refusal, as the space owner.
create temp table ft_ids(k text primary key,id uuid);
grant select,insert on ft_ids to authenticated;
insert into ft_ids select 'run',o.id from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=md5('full-time:org')::uuid order by o.id limit 1;
select pg_temp.claim('owner');
set local role authenticated;
insert into ft_ids select 'off',((public.exam_save(null,(select id from ft_ids where k='run'),null,jsonb_build_object('kind','online','title','Protect off','timing','same_time',
 'opensAt',to_char((now()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'closesAt',to_char((now()+interval '1 day 2 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'protectAnswers',false,
 'questions',jsonb_build_array(jsonb_build_object('type','choice','text','Pick B','points',2,'options',jsonb_build_array('A','B'),'correct',jsonb_build_array(1))))))->>'id')::uuid;
select pg_temp.ok((public.exam_get((select id from ft_ids where k='off'))->>'protectAnswers')::boolean=false,'protectAnswers false is saved and read back');
create function pg_temp.rv(k_ text) returns bigint language sql as $$select (public.exam_get((select id from pg_temp.ft_ids where k=k_))->>'revision')::bigint$$;
select public.exam_save((select id from ft_ids where k='off'),null,pg_temp.rv('off'),'{"protectAnswers":true}');
select pg_temp.ok((public.exam_get((select id from ft_ids where k='off'))->>'protectAnswers')::boolean,'and switched back ON');
select public.exam_lifecycle((select id from ft_ids where k='off'),'publish',pg_temp.rv('off'));
select public.exam_save((select id from ft_ids where k='off'),null,pg_temp.rv('off'),'{"protectAnswers":false}');
select pg_temp.ok((public.exam_get((select id from ft_ids where k='off'))->>'protectAnswers')::boolean=false and (public.exam_get((select id from ft_ids where k='off'))->>'status')='published',
  'a published exam nobody started may change it');
insert into ft_ids select 'clone',((public.exam_lifecycle((select id from ft_ids where k='off'),'clone',pg_temp.rv('off')))->>'id')::uuid;
select pg_temp.ok((public.exam_get((select id from ft_ids where k='clone'))->>'protectAnswers')::boolean=false,'a clone copies Protect answers');
select pg_temp.ok(pg_temp.refusal(format($q$select public.exam_save(null,%L,null,'{"kind":"paper","title":"Paper","maxMarks":10,"protectAnswers":true}')$q$,(select id from ft_ids where k='run')))->>'message'
  ='A paper exam has a maximum mark only','a paper exam refuses protectAnswers');
select pg_temp.ok(pg_temp.refusal(format($q$select public.exam_save(%L,null,%s,'{"protectAnswers":"yes"}')$q$,(select id from ft_ids where k='clone'),pg_temp.rv('clone')))->>'code'
  ='23514','protectAnswers must be a boolean');
reset role;

-- 5. The over gate on synthetic rows: the window closed, a try still running past it keeps the exam open; then its deadline passes.
create temp table ft_gate as select e.id exam_id from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=md5('full-time:org')::uuid and e.kind='online' and e.status='published' and e.timing='same_time' limit 1;
select pg_temp.ok(count(*)=1,'a same-time demo exam to move') from ft_gate;
update private.exams set opens_at=now()-interval '2 hours',closes_at=now()-interval '1 minute' where id=(select exam_id from ft_gate);
delete from private.exam_attempts where exam_id=(select exam_id from ft_gate) and status='in_progress';
select pg_temp.ok(private.exam_closed(exam_id) and private.exam_over_at(exam_id)=private.exam_last_close(exam_id),'no try running: over at the window close') from ft_gate;
select pg_temp.ok(not private.exam_writing(exam_id),'and nobody is writing') from ft_gate;
create temp table ft_writer as select r.user_id from ft_gate g join private.exams e on e.id=g.exam_id join public.enrollments r on r.offering_id=e.offering_id
 where not exists(select 1 from private.exam_attempts a where a.exam_id=g.exam_id and a.user_id=r.user_id) limit 1;
select pg_temp.ok(count(*)=1,'a student of the run who has not started') from ft_writer;
insert into private.exam_attempts(exam_id,user_id,number,started_at,deadline_at)
 select g.exam_id,w.user_id,1,now()-interval '20 minutes',now()+interval '40 minutes' from ft_gate g cross join ft_writer w;
select pg_temp.ok(not private.exam_closed(exam_id) and private.exam_writing(exam_id) and private.exam_over_at(exam_id)>now()+interval '39 minutes','a try running past the close: not over, writing, over at its deadline') from ft_gate;
select pg_temp.ok(private.exam_last_close(exam_id)<now(),'the window close itself is unchanged') from ft_gate;
update private.exam_attempts set deadline_at=now()-interval '1 second' where exam_id=(select exam_id from ft_gate) and user_id=(select user_id from ft_writer);
select pg_temp.ok(private.exam_closed(exam_id) and not private.exam_writing(exam_id),'its deadline passed: over (the next read hands it in)') from ft_gate;

select count(*) as full_time_rule_tests from ft_results;
rollback;
