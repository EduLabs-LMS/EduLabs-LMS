-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures. Every change rolls back; no real account exists.
-- Covers migration 20261110120000_lesson_publish.sql: a lesson is never tethered to one of its components (the owner's rule), publish_lesson and unpublish_lesson in
-- edit_course_structure, and the revoked direct update(status) grant. EVERY identity is a Firebase identity (a non-UUID subject, created by onboard_firebase_profile), so a
-- call that cast the subject to uuid (auth.uid()) would fail every check. updated_at is the transaction's time, so inside this one transaction a stale request sends an old
-- stamp; the race with delete_lesson on separate connections is in scripts/lesson-publish-concurrency.cjs.
begin;
create temp table lp_results(name text primary key);
create temp table lp_users(label text primary key,id uuid not null);
create temp table lp_q(k text primary key,id uuid not null);
grant select,insert on lp_results,lp_users,lp_q to authenticated,anon;
select set_config('lp.run',gen_random_uuid()::text,true);
select set_config('lp.'||k,gen_random_uuid()::text,true) from unnest(array['org_a','org_b','course','course_b','arch','off','off_b','ch','ch_b','ch_arch','empty','hwl','other','l_b','l_arch']) k;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.lp_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.lp_results values(label);end$$;
create function pg_temp.detail(statement text) returns jsonb language plpgsql set search_path='' as $$declare d text;begin
 begin execute statement; exception when others then get stacked diagnostics d=pg_exception_detail; return d::jsonb; end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('lp.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','lp-'||current_setting('lp.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('lp.'||k)::uuid$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.lp_users where label=k$$;
create function pg_temp.q(k text) returns uuid language sql as $$select id from pg_temp.lp_q where lp_q.k=$1$$;
-- Read as the database owner, so a check can see what the signed-in person may not.
create function pg_temp.ls(k text) returns timestamptz language sql security definer set search_path='' as $$select updated_at from public.lessons where id=pg_temp.key(k)$$;
create function pg_temp.tid(k text) returns text language sql security definer set search_path='' as $$select ctid::text from public.lessons where id=pg_temp.key(k)$$;
create function pg_temp.status(k text) returns text language sql security definer set search_path='' as $$select status from public.lessons where id=pg_temp.key(k)$$;
create function pg_temp.edit(action text,k text,stamp timestamptz,data jsonb default '{}',course text default 'course') returns uuid language sql as $$
 select public.edit_course_structure(pg_temp.key(course),action,pg_temp.key(k),null,stamp,data)$$;
create function pg_temp.pub(k text,course text default 'course') returns uuid language sql as $$select pg_temp.edit('publish_lesson',k,pg_temp.ls(k),'{}',course)$$;
create function pg_temp.unpub(k text,course text default 'course') returns uuid language sql as $$select pg_temp.edit('unpublish_lesson',k,pg_temp.ls(k),'{}',course)$$;
create function pg_temp.row_of(k text) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.course_structure(pg_temp.key('course'))->'lessons') e where e->>'id'=current_setting('lp.'||k)$$;
-- Everything a student left on the homework: tries, answers, corrections, marks, files and the audit, whole.
create function pg_temp.work() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'submissions',(select jsonb_agg(to_jsonb(x) order by x.id) from public.homework_submissions x where x.assignment_id=pg_temp.key('hw')),
  'responses',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from public.homework_responses x join public.homework_submissions s on s.id=x.submission_id where s.assignment_id=pg_temp.key('hw')),
  'corrections',(select jsonb_agg(to_jsonb(x) order by x.submission_id) from private.homework_corrections x join public.homework_submissions s on s.id=x.submission_id where s.assignment_id=pg_temp.key('hw')),
  'marks',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from private.homework_marks x join public.homework_submissions s on s.id=x.submission_id where s.assignment_id=pg_temp.key('hw')),
  'files',(select jsonb_agg(to_jsonb(x) order by x.id) from private.homework_uploads x where x.assignment_id=pg_temp.key('hw')),
  'audit',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from private.homework_audit x where x.assignment_id=pg_temp.key('hw')))$$;
create function pg_temp.photo(s uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();begin
 insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path,status,size_bytes,sha256,pages)
  values(i,pg_temp.key('hw'),pg_temp.uid('s1'),s,'submission','photo.jpg','image/jpeg',pg_temp.key('hw')::text||'/'||i::text||'/resource.jpg','ready',1500000,repeat('c',64),1);
 return i; end$$;
create function pg_temp.rev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from public.homework_submissions where id=s$$;
create function pg_temp.crev(s uuid) returns bigint language sql security definer set search_path='' as $$select revision from private.homework_corrections where submission_id=s$$;
create function pg_temp.event(k text) returns uuid language sql security definer set search_path='' as $$
 select id from private.notification_events where resource_id=pg_temp.key(k) and event_type='lesson_published' order by created_at limit 1$$;
create function pg_temp.link(k text,who text) returns text language sql security definer set search_path='' as $$select private.notification_link(pg_temp.event(k),pg_temp.uid(who))$$;

-- Everyone signs in with Firebase first, so each has a profile.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','instructor','editor','assistant','memberteacher','outsider','s1','s2','sb'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.lp_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic lessons A','lp-a-'||current_setting('lp.run')),(pg_temp.key('org_b'),'Synthetic lessons B','lp-b-'||current_setting('lp.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('instructor','teacher'),('editor','teacher'),('assistant','assistant'),('memberteacher','teacher')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org_a'),'Synthetic Physics','lp-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('arch'),pg_temp.key('org_a'),'Synthetic archived','lp-archived','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','lp-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('course'),pg_temp.uid('instructor'),'instructor'),(pg_temp.key('course'),pg_temp.uid('editor'),'editor'),(pg_temp.key('course'),pg_temp.uid('assistant'),'assistant');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('assistant'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off'),pg_temp.uid('s1'),'active',now()-interval '1 day'),(pg_temp.key('off'),pg_temp.uid('s2'),'active',now()-interval '1 day'),
 (pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '1 day');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('ch'),pg_temp.key('course'),'Electric current',0),(pg_temp.key('ch_arch'),pg_temp.key('arch'),'Old chapter',0),(pg_temp.key('ch_b'),pg_temp.key('course_b'),'Foreign chapter',0);
-- 'empty' has nothing at all; 'hwl' will have only homework; 'other' is a draft lesson in the same course.
insert into public.lessons(id,module_id,title,position,status) values(pg_temp.key('empty'),pg_temp.key('ch'),'Empty lesson',0,'draft'),(pg_temp.key('hwl'),pg_temp.key('ch'),'Homework only',1,'draft'),
 (pg_temp.key('other'),pg_temp.key('ch'),'Other',2,'draft'),(pg_temp.key('l_arch'),pg_temp.key('ch_arch'),'Archived lesson',0,'draft'),(pg_temp.key('l_b'),pg_temp.key('ch_b'),'Foreign lesson',0,'draft');
update public.courses set status='archived' where id=pg_temp.key('arch');
insert into pg_temp.lp_q select k,gen_random_uuid() from unnest(array['q1','A','B','q2']) k;

-- ---------------------------------------------------------------- 1. The direct grant is gone; the others stay
select pg_temp.ok(not has_column_privilege('authenticated','public.lessons','status','UPDATE'),'a client can no longer update a lesson''s status directly');
select pg_temp.ok(has_column_privilege('authenticated','public.lessons','title','UPDATE') and has_column_privilege('authenticated','public.lessons','position','UPDATE')
 and has_column_privilege('authenticated','public.lessons','description','UPDATE') and has_column_privilege('authenticated','public.lessons','estimated_duration_seconds','UPDATE'),'the other column grants stay');
select pg_temp.ok(not has_function_privilege('anon','public.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb)','execute')
 and has_function_privilege('authenticated','public.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb)','execute')
 and not has_function_privilege('anon','private.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb)','execute'),'the grants of edit_course_structure are kept');
select pg_temp.ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='edit_course_structure')
 and (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='edit_course_structure'),'private definer with an empty search_path, public invoker');
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.denied($s$update public.lessons set status='published' where id=pg_temp.key('empty')$s$,'42501','even the space owner cannot publish by a bare update');
select pg_temp.ok(pg_temp.status('empty')='draft','and nothing changed');

-- ---------------------------------------------------------------- 2. A lesson with nothing in it publishes, as the course owner
select pg_temp.ok((select (r->>'parts')::int=0 and (r->>'contentBlocks')::int=0 and not (r->>'hasCover')::boolean and (r->>'homework')::int=0 and (r->>'draftHomework')::int=0 and r->>'status'='draft' from (select pg_temp.row_of('empty') r) x),
 'the empty lesson has no part, no content item, no cover and no homework');
select pg_temp.ok(pg_temp.pub('empty')=pg_temp.key('empty') and pg_temp.status('empty')='published','the space owner publishes a lesson with nothing in it');
select pg_temp.ok(pg_temp.row_of('empty')->>'status'='published','the course read returns the new status');
reset role;
select pg_temp.ok((select count(*)=0 from public.lesson_segments where lesson_id=pg_temp.key('empty')) and (select count(*)=0 from public.lesson_blocks where lesson_id=pg_temp.key('empty'))
 and (select count(*)=1 from public.lessons where module_id=pg_temp.key('ch') and title='Empty lesson'),'nothing was created or copied: no part, no content item, no second lesson');
set local role authenticated;
select pg_temp.denied($s$select pg_temp.edit('unpublish_lesson','empty','2000-01-01')$s$,'PT409','a stale version is refused');
select pg_temp.ok(pg_temp.status('empty')='published','the stale unpublish changed nothing');
select set_config('lp.tid',pg_temp.tid('empty'),true);
select pg_temp.ok(pg_temp.pub('empty')=pg_temp.key('empty') and pg_temp.tid('empty')=current_setting('lp.tid'),'publishing a published lesson again writes nothing');
select pg_temp.ok(pg_temp.unpub('empty')=pg_temp.key('empty') and pg_temp.status('empty')='draft','the space owner unpublishes it');
select pg_temp.denied($s$select pg_temp.edit('publish_lesson','empty',pg_temp.ls('empty'),'{"status":"published"}')$s$,'23514','publish takes no options');
select pg_temp.denied($s$select pg_temp.edit('publish_lesson','empty',null)$s$,'PT409','publish without the version read is refused');
select pg_temp.claim('instructor');
select pg_temp.ok(pg_temp.pub('empty')=pg_temp.key('empty') and pg_temp.unpub('empty')=pg_temp.key('empty'),'the course instructor publishes and unpublishes');
select pg_temp.claim('editor');
select pg_temp.ok(pg_temp.pub('empty')=pg_temp.key('empty') and pg_temp.status('empty')='published','a course editor publishes (can_edit_course)');
-- The old edit_lesson no longer asks for a part either.
select pg_temp.ok(public.edit_learning_content(pg_temp.key('course'),'edit_lesson',pg_temp.key('other'),null,pg_temp.ls('other'),'{"title":"Other","description":"","status":"published"}')=pg_temp.key('other')
 and pg_temp.status('other')='published','the old edit_lesson publishes a lesson with no part');
select pg_temp.unpub('other');

-- ---------------------------------------------------------------- 3. Who may not
select pg_temp.claim('assistant');
select pg_temp.denied($s$select pg_temp.unpub('empty')$s$,'42501','an assistant cannot unpublish');
select pg_temp.denied($s$select pg_temp.pub('other')$s$,'42501','an assistant cannot publish');
select pg_temp.claim('memberteacher');
select pg_temp.denied($s$select pg_temp.pub('other')$s$,'42501','a teacher of the space who does not teach this course cannot publish');
select pg_temp.claim('s1');
select pg_temp.denied($s$select pg_temp.pub('other')$s$,'42501','an enrolled student cannot publish');
select pg_temp.claim('outsider');
select pg_temp.denied($s$select pg_temp.pub('other')$s$,'42501','another space''s teacher cannot publish here');
select pg_temp.denied($s$select pg_temp.pub('other','course_b')$s$,'42501','naming their own course does not reach a lesson of another space');
select pg_temp.ok(pg_temp.pub('l_b','course_b')=pg_temp.key('l_b'),'they publish in their own space');
select pg_temp.ok(pg_temp.status('other')='draft' and pg_temp.status('empty')='published','every refusal changed nothing');
reset role;
set local role anon;
select pg_temp.denied($s$select public.edit_course_structure(pg_temp.key('course'),'publish_lesson',pg_temp.key('other'),null,now(),'{}')$s$,'42501','anonymous cannot publish');
reset role;
-- An archived course refuses both, with the reason.
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.detail($s$select pg_temp.pub('l_arch','arch')$s$)='{"reasons":["archived"]}'::jsonb,'an archived course refuses publish, reason archived');
select pg_temp.denied($s$select pg_temp.pub('l_arch','arch')$s$,'PT409','the archived refusal is PT409');
reset role;
update public.lessons set status='published' where id=pg_temp.key('l_arch');
set local role authenticated;
select pg_temp.denied($s$select pg_temp.unpub('l_arch','arch')$s$,'PT409','an archived course refuses unpublish');
select pg_temp.ok(pg_temp.status('l_arch')='published','the archived lesson is unchanged');

-- ---------------------------------------------------------------- 4. A lesson with only homework: students see it while it is published, and their work is kept
select pg_temp.claim('instructor');
select set_config('lp.hw',public.save_homework(null,pg_temp.key('off'),pg_temp.key('hwl'),null,null,jsonb_build_object('title','Synthetic homework','instructions','','mode','PLATFORM_QUESTIONS','published',true,'usesMarks',true,'filePoints',10,
 'modelAnswer','','solutionVideo','','solutionVideoId',null,'referenceIds','[]'::jsonb,'solutionIds','[]'::jsonb,'rules',jsonb_build_object('deadline',to_jsonb(clock_timestamp()+interval '2 days')#>>'{}'),
 'questions',jsonb_build_array(
  jsonb_build_object('id',pg_temp.q('q1'),'type','single_choice','text','Pick','imageId',null,'points',2,'responseMode','text','modelAnswer','','options',jsonb_build_array(jsonb_build_object('id',pg_temp.q('A'),'text','Yes'),jsonb_build_object('id',pg_temp.q('B'),'text','No')),'correctIds',jsonb_build_array(pg_temp.q('B'))),
  jsonb_build_object('id',pg_temp.q('q2'),'type','essay','text','Explain','imageId',null,'points',6,'responseMode','both','modelAnswer','','options','[]'::jsonb,'correctIds','[]'::jsonb))))::text,true);
select pg_temp.ok((select count(*)=1 from public.homework_assignments where id=current_setting('lp.hw')::uuid and lesson_id=pg_temp.key('hwl') and status='published'),'published homework is added to a lesson with no part');
reset role;
create function pg_temp.hw() returns uuid language sql as $$select current_setting('lp.hw')::uuid$$;
set local role authenticated;
select pg_temp.claim('s1');
select pg_temp.ok((select count(*)=0 from public.lessons where id=pg_temp.key('hwl')) and (select count(*)=0 from public.homework_assignments where lesson_id=pg_temp.key('hwl')),'while the lesson is a draft the student sees neither it nor its homework');
select pg_temp.denied($s$select public.get_homework(pg_temp.hw())$s$,'42501','and cannot open the homework of a draft lesson');
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.pub('hwl')=pg_temp.key('hwl'),'the owner publishes the lesson that has only homework');
select pg_temp.claim('s1');
select pg_temp.ok((select count(*)=1 from public.lessons where id=pg_temp.key('hwl') and status='published') and (select count(*)=1 from public.homework_assignments where lesson_id=pg_temp.key('hwl') and status='published'),
 'an enrolled student sees the published lesson and its published homework');
select pg_temp.ok((select count(*)=0 from public.lesson_segments where lesson_id=pg_temp.key('hwl')),'it has no part');
select pg_temp.ok(public.get_homework(pg_temp.hw())->>'id'=pg_temp.hw()::text,'the student opens the homework');
select set_config('lp.s',(public.homework_work(pg_temp.hw(),'start')->>'id'),true);
select set_config('lp.photo',pg_temp.photo(current_setting('lp.s')::uuid)::text,true);
select public.homework_work(pg_temp.hw(),'save',current_setting('lp.s')::uuid,pg_temp.rev(current_setting('lp.s')::uuid),jsonb_build_object('fileIds','[]'::jsonb,'answers',jsonb_build_array(
 jsonb_build_object('questionId',pg_temp.q('q1'),'optionIds',jsonb_build_array(pg_temp.q('B')),'text','','fileIds','[]'::jsonb),
 jsonb_build_object('questionId',pg_temp.q('q2'),'optionIds','[]'::jsonb,'text','My answer','fileIds',jsonb_build_array(current_setting('lp.photo')::uuid)))));
select public.homework_work(pg_temp.hw(),'submit',current_setting('lp.s')::uuid,pg_temp.rev(current_setting('lp.s')::uuid));
select pg_temp.claim('instructor');
select public.homework_work(pg_temp.hw(),'grade',current_setting('lp.s')::uuid,pg_temp.crev(current_setting('lp.s')::uuid),jsonb_build_object('marks',jsonb_build_array(jsonb_build_object('questionId',pg_temp.q('q2'),'points',5,'feedback','Good')),'feedback','Good'));
select public.homework_work(pg_temp.hw(),'release',current_setting('lp.s')::uuid,pg_temp.crev(current_setting('lp.s')::uuid),'{"status":"approved"}');
reset role;
select set_config('lp.before',pg_temp.work()::text,true);
select pg_temp.ok((select (w->'submissions'->0->>'status')='submitted' and jsonb_array_length(w->'marks')>=2 and (w->'corrections'->0->>'released_at') is not null and jsonb_array_length(w->'files')=1
 from (select current_setting('lp.before')::jsonb w) x),'the student handed in, with a mark, a released grade and a photo');
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.unpub('hwl')=pg_temp.key('hwl'),'the owner unpublishes it, although a student has work in it');
select pg_temp.claim('s1');
select pg_temp.ok((select count(*)=0 from public.lessons where id=pg_temp.key('hwl')) and (select count(*)=0 from public.homework_assignments where lesson_id=pg_temp.key('hwl'))
 and (select count(*)=0 from public.homework_submissions where assignment_id=pg_temp.hw()),'after unpublish the student sees neither the lesson, its homework nor their try');
select pg_temp.denied($s$select public.get_homework(pg_temp.hw())$s$,'42501','and cannot open the homework');
select pg_temp.denied($s$select public.homework_work(pg_temp.hw(),'start')$s$,'42501','nor start a new try');
reset role;
select pg_temp.ok(pg_temp.work()=current_setting('lp.before')::jsonb,'every try, answer, correction, mark, file and audit row is kept exactly');
set local role authenticated;
select pg_temp.claim('instructor');
select pg_temp.ok((select count(*)=1 from public.homework_submissions where assignment_id=pg_temp.hw()),'the teacher still sees the student''s try');
select pg_temp.claim('owner');
select pg_temp.pub('hwl');
select pg_temp.claim('s1');
select pg_temp.ok(jsonb_array_length(public.get_homework(pg_temp.hw())->'submissions')=1 and (public.get_homework(pg_temp.hw())->'submissions'->0->'correction'->>'released')::boolean,
 'published again, the student sees their try and released grade as before');
select pg_temp.claim('sb');
select pg_temp.ok((select count(*)=0 from public.lessons where id=pg_temp.key('hwl')) and (select count(*)=0 from public.homework_assignments where lesson_id=pg_temp.key('hwl')),'a student of another space sees nothing');

-- ---------------------------------------------------------------- 5. The notification of a lesson with no part has no link, and no error
-- The link is worked out for the person reading it, so read it signed in as the student.
select pg_temp.claim('s1');
reset role;
select pg_temp.ok(pg_temp.event('hwl') is not null and pg_temp.link('hwl','s1') is null,'publishing a lesson with no part notifies, and its link is empty (no error)');
insert into public.lesson_segments(lesson_id,title,description,position,status) values(pg_temp.key('hwl'),'A part','Notes',0,'published');
select pg_temp.ok(pg_temp.link('hwl','s1') like '/courses/'||pg_temp.key('course')||'/chapters/%?offering='||pg_temp.key('off'),'once a part is published the same notification links to it');
select pg_temp.ok((select count(*)=1 from private.notification_events where resource_id=pg_temp.key('hwl') and event_type='lesson_published'),'no second notification for the part');

select count(*)::integer lesson_publish_tests from lp_results;
rollback;
