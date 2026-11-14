-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities); every change rolls back; no real account exists.
-- Covers migration 20261113120000_homework_correct_demo.sql (demo seed version 7) and what the correcting screen relies on:
--   1. Fill at seed version 7: "Magnetism review", a published lesson with no parts, and its homework with tries in every state;
--   2. the correcting reads on it (homework_queue, get_homework for one try: answers, the deleted photo, kept answers, the rights);
--   3. a single release and a bulk release notify the student the same way (the existing row trigger), once per released try;
--   4. Clear still refuses, removing nothing, while a real person's try is there, and otherwise removes the new lesson with everything else.
begin;
create temp table hc_results(name text primary key);
create temp table hc_users(label text primary key,id uuid not null);
create temp table hc_ids(label text primary key,id uuid not null);
grant select,insert on hc_results,hc_users,hc_ids to authenticated,anon;
select set_config('hc.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.hc_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare msg text;code text;detail text;begin
 begin execute statement; exception when others then get stacked diagnostics msg=message_text,code=returned_sqlstate,detail=pg_exception_detail; return code||' '||msg||coalesce(' '||nullif(detail,''),''); end;
 raise exception 'FAILED nothing was refused: %',statement; end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('hc.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','hc-'||current_setting('hc.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.hc_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.hc_ids where label=k$$;
-- The demo student N of the space (Demo Student N is a recorded profile).
create function pg_temp.student(n integer) returns uuid language sql security definer set search_path='' as $$
 select p.id from public.profiles p join private.demo_seed_rows d on d.row_id=p.id and d.table_name='profiles' where d.organization_id=pg_temp.key('org') and p.display_name='Demo Student '||n$$;
create function pg_temp.try_of(n integer) returns uuid language sql security definer set search_path='' as $$
 select s.id from public.homework_submissions s where s.assignment_id=pg_temp.key('hw') and s.user_id=pg_temp.student(n) order by s.number desc limit 1$$;
-- Notifications of a released try, as the trigger writes them: event type, recipient, resource and key.
create function pg_temp.released_notices(p_sub uuid) returns text language sql security definer set search_path='' as $$
 select coalesce(string_agg(e.event_type||'|'||(n.recipient_id=s.user_id)::text||'|'||(e.resource_id=s.id)::text||'|'||(e.event_key='homework:'||s.id||':'||c.released_at)::text,',' order by n.id),'none')
 from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id
 left join private.notification_events e on e.resource_id=s.id and e.event_type='homework_released' left join public.notifications n on n.event_id=e.id where s.id=p_sub$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','assistant','outsider','real'] loop
  perform pg_temp.claim(label); insert into pg_temp.hc_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from hc_users where label='admin';
insert into hc_ids values('org',gen_random_uuid()),('org_other',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic demo','hc-'||current_setting('hc.run')),(pg_temp.key('org_other'),'Synthetic other','hc-o-'||current_setting('hc.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values
 (pg_temp.key('org'),pg_temp.uid('teacher'),'owner','active',now()),(pg_temp.key('org'),pg_temp.uid('assistant'),'assistant','active',now()),
 (pg_temp.key('org_other'),pg_temp.uid('outsider'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org'),pg_temp.uid('admin'));

-- 1. Fill: seed version 8.
select pg_temp.ok(private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))=jsonb_build_object('seedVersion',9,'courses',2,'lessons',6,'groups',2,'sessions',10,'students',28,'homework',5,'exams',5),
 'fill reports seed version 7: six lessons and five homework');
select pg_temp.ok((select seed_version=9 from private.demo_spaces where organization_id=pg_temp.key('org')),'the space stores seed version 9');
select pg_temp.ok((select (detail->>'seedVersion')::int=9 and (detail->>'homework')::int=5 from private.platform_audit where organization_id=pg_temp.key('org') and action='demo.fill' order by id desc limit 1),'the audit row says seed version 9');
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_demo_status(pg_temp.key('org'))->>'latestSeedVersion')::int=9 and (public.platform_demo_status(pg_temp.key('org'))->>'seedVersion')::int=9,'the status reports seed version 9 as the latest and as filled');
reset role;
insert into hc_ids select 'course',id from public.courses where organization_id=pg_temp.key('org') and status='published';
insert into hc_ids select 'off',o.id from public.course_offerings o where o.course_id=pg_temp.key('course');
insert into hc_ids select 'lesson',l.id from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=pg_temp.key('course') and l.title='Magnetism review';
insert into hc_ids select 'hw',a.id from public.homework_assignments a where a.lesson_id=pg_temp.key('lesson');

-- The lesson: published, third in Magnetism, no part, no content item, no cover, and recorded.
select pg_temp.ok((select l.status='published' and l.position=2 and m.title='Magnetism' and m.position=1 and l.cover_asset_id is null
 from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=pg_temp.key('lesson')),'Magnetism review is a published lesson, third in Magnetism');
select pg_temp.ok(not exists(select 1 from public.lesson_segments where lesson_id=pg_temp.key('lesson')) and not exists(select 1 from public.lesson_blocks where lesson_id=pg_temp.key('lesson')),'it has no part and no content item');
select pg_temp.ok(exists(select 1 from private.demo_seed_rows where organization_id=pg_temp.key('org') and module='courses' and table_name='lessons' and row_id=pg_temp.key('lesson')),'the lesson is recorded under the courses module');
select pg_temp.ok((select array_agg(c order by p)=array[3,3,0]::bigint[] from (select m.position p,(select count(*) from public.lessons l where l.module_id=m.id) c from public.course_modules m where m.course_id=pg_temp.key('course')) x),
 'the Physics tree is now 3, 3 and 0 lessons (the empty chapter stays empty)');
select pg_temp.ok((select count(*)=1 from public.homework_assignments where lesson_id=pg_temp.key('lesson')),'the lesson has one homework');

-- The homework: published, closed yesterday at 20:00 Cairo, late allowed, one time, solutions after hand-in; a blank-answer question, a choice and an essay.
select pg_temp.ok((select a.status='published' and a.workflow='questions' and a.offering_id=pg_temp.key('off') and a.late_allowed and a.tries_mode='one_time' and a.max_tries=1 and a.solutions_open='after_hand_in'
 and a.deadline_at<now() and a.deadline_at>now()-interval '3 days' and extract(hour from a.deadline_at at time zone 'Africa/Cairo')=20 from public.homework_assignments a where a.id=pg_temp.key('hw')),
 'the homework closed at 20:00 Cairo, late allowed, one time');
select pg_temp.ok((select string_agg(q.type||':'||q.points,',' order by q.position)='single_choice:2,single_choice:2,essay:6' from public.homework_questions q where q.assignment_id=pg_temp.key('hw')),'two choice questions and an essay');
create function pg_temp.states(p_hw uuid) returns text language sql security definer set search_path='' as $$
 select (select count(*) from public.homework_submissions where assignment_id=p_hw and status='submitted')||' handed in/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.status='under_correction')||' waiting/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.status='corrected' and c.released_at is null)||' corrected/'||
  (select count(*) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id where s.assignment_id=p_hw and c.released_at is not null)||' released/'||
  (select count(*) from public.homework_submissions where assignment_id=p_hw and missed_deadline)||' late/'||
  (select count(*) from private.homework_uploads where assignment_id=p_hw and purpose='submission' and status='ready')||' photos/'||
  (select count(*) from private.homework_uploads where assignment_id=p_hw and purpose='submission' and status='deleted')||' deleted'
$$;
select pg_temp.ok(pg_temp.states(pg_temp.key('hw'))='14 handed in/7 waiting/4 corrected/3 released/2 late/2 photos/1 deleted',
 'students 1-14 handed in: 7 waiting (2 late), 4 corrected and not released, 3 released; two photos and one deleted to free space');
select pg_temp.ok((select bool_and(s.submitted_at>a.deadline_at)=true from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where s.assignment_id=pg_temp.key('hw') and s.missed_deadline)
 and (select bool_and(s.submitted_at<=a.deadline_at) from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where s.assignment_id=pg_temp.key('hw') and not s.missed_deadline),
 'the late tries came after the deadline, the others before it');
select pg_temp.ok((select u.deleted_at is not null and u.uploaded_by=pg_temp.student(1) from private.homework_uploads u where u.assignment_id=pg_temp.key('hw') and u.status='deleted'),'the deleted photo is student 1''s, with its time');
select pg_temp.ok(not exists(select 1 from storage.objects o where o.bucket_id='lms-homework' and split_part(o.name,'/',1)=pg_temp.key('hw')::text),'no file is stored for it');
-- Every new row is recorded: the lesson under courses, every homework row under homework.
select pg_temp.ok((select count(*) from private.demo_seed_rows d where d.organization_id=pg_temp.key('org') and d.module='homework' and (
  (d.table_name='homework_assignments' and d.row_id=pg_temp.key('hw'))
  or (d.table_name in ('homework_questions','homework_keys') and d.row_id in (select id from public.homework_questions where assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_options' and d.row_id in (select o.id from public.homework_options o join public.homework_questions q on q.id=o.question_id where q.assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_solutions' and d.row_id=pg_temp.key('hw'))
  or (d.table_name in ('homework_submissions','homework_corrections') and d.row_id in (select id from public.homework_submissions where assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_responses' and d.row_id in (select r.id from public.homework_responses r join public.homework_submissions s on s.id=r.submission_id where s.assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_marks' and d.row_id in (select m.id from private.homework_marks m join public.homework_submissions s on s.id=m.submission_id where s.assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_uploads' and d.row_id in (select id from private.homework_uploads where assignment_id=pg_temp.key('hw')))
  or (d.table_name='homework_submission_files' and d.row_id in (select f.id from public.homework_submission_files f join public.homework_submissions s on s.id=f.submission_id where s.assignment_id=pg_temp.key('hw')))))
 =1+3+7+3+1+14+14+42+42+3+3,'every row of the new homework is recorded once: 133 rows');
-- Released tries notified their demo students, through the trigger, once each.
select pg_temp.ok((select bool_and(pg_temp.released_notices(s.id)='homework_released|true|true|true') from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id
 where s.assignment_id=pg_temp.key('hw') and c.released_at is not null),'each released demo try notified its student once');

-- 2. The correcting reads on it.
set local role authenticated; select pg_temp.claim('teacher');
select set_config('hc.queue',public.homework_queue(pg_temp.key('hw'),'to_correct',0)::text,true);
select pg_temp.ok(current_setting('hc.queue')::jsonb->'counts'=jsonb_build_object('toCorrect',7,'done',7,'missing',14,'handedIn',14,'total',28,'late',2),'the queue: 7 to correct, 7 done, 14 missing, 2 late');
select pg_temp.ok((current_setting('hc.queue')::jsonb->>'readyToRelease')::int=4 and jsonb_array_length(current_setting('hc.queue')::jsonb->'releasable')=4,'four corrected tries are ready to release together');
reset role;
select pg_temp.ok((select array_agg(e->>'submissionId'||'@'||(e->>'revision') order by e->>'submissionId') from jsonb_array_elements(current_setting('hc.queue')::jsonb->'releasable') e)
 =(select array_agg(s.id::text||'@'||c.revision order by s.id::text) from public.homework_submissions s join private.homework_corrections c on c.submission_id=s.id
   where s.assignment_id=pg_temp.key('hw') and c.status='corrected' and c.released_at is null),
 'the releasable list is exactly the corrected, unreleased tries with their revisions (a naive query)');
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((select count(*)=2 from jsonb_array_elements(current_setting('hc.queue')::jsonb->'rows') e where (e->>'late')::boolean) and
 (select bool_and((e->>'try')::int=1 and (e->>'waiting')::int=1) from jsonb_array_elements(current_setting('hc.queue')::jsonb->'rows') e),'To correct shows try 1, one essay waiting each, and the two late ones');
select pg_temp.ok((public.homework_queue(pg_temp.key('hw'),'missing',0)->'counts'->>'missing')::int=14 and jsonb_array_length(public.homework_queue(pg_temp.key('hw'),'missing',0)->'rows')=14,'Missing lists the 14 who did not hand in');
-- One try, as the correcting screen reads it: the homework with its keys (staff) and the try with answers, files and the correction.
select set_config('hc.view',public.get_homework(pg_temp.key('hw'),pg_temp.try_of(1))::text,true);
select pg_temp.ok((current_setting('hc.view')::jsonb->>'staff')::boolean and (current_setting('hc.view')::jsonb->>'canGrade')::boolean and (current_setting('hc.view')::jsonb->>'canRelease')::boolean,'the owner may correct and release');
select pg_temp.ok((select bool_and(jsonb_array_length(q->'correctIds')=1) from jsonb_array_elements(current_setting('hc.view')::jsonb->'definition'->'questions') q where q->>'type'<>'essay'),'staff read the right answers of the choice questions');
select pg_temp.ok(jsonb_array_length(current_setting('hc.view')::jsonb->'submissions')=1 and current_setting('hc.view')::jsonb->'submissions'->0->>'id'=pg_temp.try_of(1)::text,'the read holds that one try');
select pg_temp.ok((current_setting('hc.view')::jsonb->'submissions'->0->'files'->0->>'deleted')::boolean and jsonb_array_length(current_setting('hc.view')::jsonb->'submissions'->0->'files')=1,'student 1''s photo reads as deleted');
select pg_temp.ok((select (a->'fileIds'->>0) from jsonb_array_elements(current_setting('hc.view')::jsonb->'submissions'->0->'answers') a where a->>'questionId'=(select id::text from public.homework_questions where assignment_id=pg_temp.key('hw') and type='essay'))
 =(current_setting('hc.view')::jsonb->'submissions'->0->'files'->0->>'id'),'the essay answer points at that photo');
select pg_temp.ok((public.get_homework(pg_temp.key('hw'),pg_temp.try_of(2))->'submissions'->0->'files'->0->>'deleted')::boolean=false,'student 2''s photo is there');
select pg_temp.ok((current_setting('hc.view')::jsonb->'submissions'->0->'correction'->>'status')='under_correction' and (current_setting('hc.view')::jsonb->'submissions'->0->'correction'->>'revision')::int=0,
 'the waiting try reads as under correction at revision 0');
select pg_temp.ok((public.get_homework(pg_temp.key('hw'),pg_temp.try_of(13))->'submissions'->0->>'missedDeadline')::boolean,'a late try says it missed the deadline');
reset role;
-- Another space's teacher reads nothing of it.
set local role authenticated; select pg_temp.claim('outsider');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_queue(%L)',pg_temp.key('hw'))) like '42501 %','another space''s teacher cannot read the queue');
select pg_temp.ok(pg_temp.refusal(format('select public.get_homework(%L,%L)',pg_temp.key('hw'),pg_temp.try_of(1))) like '42501 %','nor a try');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.key('hw'),current_setting('hc.queue')::jsonb->'releasable')) like '42501 %','nor release them');
reset role;
-- An assistant (offering staff) with correct and release turned off reads, but get_homework says no to both, and the database refuses both.
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('assistant'),'teaching_assistant');
insert into private.homework_assistant_permissions(course_id,user_id,can_correct,can_release) values(pg_temp.key('course'),pg_temp.uid('assistant'),false,false);
set local role authenticated; select pg_temp.claim('assistant');
select pg_temp.ok((public.get_homework(pg_temp.key('hw'),pg_temp.try_of(1))->>'canGrade')::boolean=false and (public.get_homework(pg_temp.key('hw'),pg_temp.try_of(1))->>'canRelease')::boolean=false,'the assistant reads canGrade and canRelease off');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_work(%L,''grade'',%L,0,%L)',pg_temp.key('hw'),pg_temp.try_of(1),jsonb_build_object('score',null,'feedback','','reason','','marks','[]'::jsonb))) like '42501 %','the database refuses their grade');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.key('hw'),current_setting('hc.queue')::jsonb->'releasable')) like '42501 %','and their bulk release');
reset role;

-- 3. Release: one by one and many at once notify the same way.
set local role authenticated; select pg_temp.claim('teacher');
-- Correct student 3 (waiting) and release it alone.
select set_config('hc.graded',public.homework_work(pg_temp.key('hw'),'grade',pg_temp.try_of(3),0,jsonb_build_object('score',null,'feedback','Well done.','reason','',
 'marks',jsonb_build_array(jsonb_build_object('questionId',(select id from public.homework_questions where assignment_id=pg_temp.key('hw') and type='essay'),'points',5,'feedback','Write the unit.'))))::text,true);
select pg_temp.ok(current_setting('hc.graded')::jsonb->'correction'->>'status'='corrected' and (current_setting('hc.graded')::jsonb->'correction'->>'revision')::int=1,'a grade saves at revision 1');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_work(%L,''grade'',%L,0,%L)',pg_temp.key('hw'),pg_temp.try_of(3),jsonb_build_object('score',null,'feedback','','reason','','marks','[]'::jsonb))) like 'PT409 %','grading with the old revision is stale');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_work(%L,''grade'',%L,1,%L)',pg_temp.key('hw'),pg_temp.try_of(3),jsonb_build_object('score',null,'feedback','','reason','',
 'marks',jsonb_build_array(jsonb_build_object('questionId',(select id from public.homework_questions where assignment_id=pg_temp.key('hw') and type='essay'),'points',7,'feedback',''))))) like '23514 Invalid written marks%','more than the question''s marks is refused');
select pg_temp.ok(pg_temp.released_notices(pg_temp.try_of(3))='none','nothing is sent before release');
select set_config('hc.single',public.homework_work(pg_temp.key('hw'),'release',pg_temp.try_of(3),1,jsonb_build_object('status','approved','reason',''))::text,true);
select pg_temp.ok((current_setting('hc.single')::jsonb->'correction'->>'released')::boolean,'a single release');
select pg_temp.ok(pg_temp.released_notices(pg_temp.try_of(3))='homework_released|true|true|true','a single release notifies the student once');
-- Editing a released correction needs a short reason and takes the grade back until it is released again.
select pg_temp.ok(pg_temp.refusal(format('select public.homework_work(%L,''grade'',%L,2,%L)',pg_temp.key('hw'),pg_temp.try_of(3),jsonb_build_object('score',null,'feedback','','reason','no',
 'marks',jsonb_build_array(jsonb_build_object('questionId',(select id from public.homework_questions where assignment_id=pg_temp.key('hw') and type='essay'),'points',6,'feedback',''))))) like '23514 Released correction requires an audit reason%','a released grade changes only with a reason of three or more characters');
select pg_temp.ok((public.homework_work(pg_temp.key('hw'),'grade',pg_temp.try_of(3),2,jsonb_build_object('score',null,'feedback','','reason','Marked the unit',
 'marks',jsonb_build_array(jsonb_build_object('questionId',(select id from public.homework_questions where assignment_id=pg_temp.key('hw') and type='essay'),'points',6,'feedback',''))))->'correction'->>'released')::boolean=false,
 'with a reason it saves, and the grade is withdrawn until released again');
reset role;
select pg_temp.ok(exists(select 1 from private.homework_audit where submission_id=pg_temp.try_of(3) and action='grade' and reason='Marked the unit'),'the reason is in the audit');
-- Bulk release of the queue's list: the four corrected tries.
set local role authenticated; select pg_temp.claim('teacher');
select set_config('hc.ready',public.homework_queue(pg_temp.key('hw'))::text,true);
select pg_temp.ok((current_setting('hc.ready')::jsonb->>'readyToRelease')::int=5,'five are ready now: the four corrected and student 3''s withdrawn one');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.key('hw'),
  jsonb_set(current_setting('hc.ready')::jsonb->'releasable','{0,revision}',to_jsonb(((current_setting('hc.ready')::jsonb->'releasable'->0->>'revision')::int)+7))))
 like 'PT409 Correction changed; reload {"reason": "stale"%','one stale item refuses the whole call with its reason');
reset role;
select pg_temp.ok((select count(*)=0 from private.homework_corrections c join public.homework_submissions s on s.id=c.submission_id where s.assignment_id=pg_temp.key('hw') and c.released_at is not null and s.user_id in (pg_temp.student(3),pg_temp.student(6),pg_temp.student(7),pg_temp.student(8),pg_temp.student(9))),
 'and releases nothing');
set local role authenticated; select pg_temp.claim('teacher');
select set_config('hc.many',public.homework_release_many(pg_temp.key('hw'),current_setting('hc.ready')::jsonb->'releasable')::text,true);
select pg_temp.ok((current_setting('hc.many')::jsonb->>'released')::int=5,'Release 5 grades releases five');
select pg_temp.ok((select bool_and((i->>'revision')::bigint=(r->>'revision')::bigint+1) from jsonb_array_elements(current_setting('hc.many')::jsonb->'items') i join jsonb_array_elements(current_setting('hc.ready')::jsonb->'releasable') r on r->>'submissionId'=i->>'submissionId'),
 'each comes back with its next revision');
reset role;
select pg_temp.ok((select count(*)=4 and bool_and(pg_temp.released_notices((i->>'submissionId')::uuid)='homework_released|true|true|true') from jsonb_array_elements(current_setting('hc.many')::jsonb->'items') i
  where (i->>'submissionId')::uuid<>pg_temp.try_of(3)),
 'bulk release notifies each student once, exactly as a single release does');
select pg_temp.ok((select count(*)=2 and count(*) filter(where e.event_key='homework:'||c.submission_id||':'||c.released_at)=1 and bool_and(n.recipient_id=pg_temp.student(3))
  from private.notification_events e join public.notifications n on n.event_id=e.id join private.homework_corrections c on c.submission_id=e.resource_id where e.resource_id=pg_temp.try_of(3) and e.event_type='homework_released'),
 'student 3, released alone, withdrawn, then released in the bulk, has two notices (one per release, the newest keyed by the bulk release), as two single releases would');
select pg_temp.ok((select count(*)=5 from private.homework_audit a where a.assignment_id=pg_temp.key('hw') and a.action='release' and a.reason='bulk release'),'one audit row per released try');
select pg_temp.ok(not exists(select 1 from private.notification_deliveries d join public.notifications n on n.id=d.notification_id join private.notification_events e on e.id=n.event_id where e.resource_id in (select id from public.homework_submissions where assignment_id=pg_temp.key('hw')))
 ,'no push delivery is queued for demo students (no device), on either path');
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((public.homework_queue(pg_temp.key('hw'))->>'readyToRelease')::int=0,'after it, nothing is left to release');
select pg_temp.ok(pg_temp.refusal(format('select public.homework_release_many(%L,%L)',pg_temp.key('hw'),current_setting('hc.many')::jsonb->'items')) like '23514 %already_released%','releasing them again is refused as already released');
reset role;

-- 4. Clear refuses, removing nothing, while a real person's try is there; then removes the new lesson with everything else.
savepoint real_try;
insert into public.homework_submissions(assignment_id,user_id,number,status) values(pg_temp.key('hw'),pg_temp.uid('real'),1,'draft');
select pg_temp.ok(pg_temp.refusal(format('select private.demo_clear_core(%L,%L)',pg_temp.key('org'),pg_temp.uid('admin')))
 ='PT409 This demo space holds content that Clear does not remove: homework from real people. Remove it first.','Clear refuses homework from real people');
select pg_temp.ok(exists(select 1 from public.lessons where id=pg_temp.key('lesson')) and exists(select 1 from public.homework_assignments where id=pg_temp.key('hw')),'and removes nothing');
rollback to savepoint real_try;
select set_config('hc.clear',private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))::text,true);
select pg_temp.ok(not exists(select 1 from public.lessons where id=pg_temp.key('lesson')) and not exists(select 1 from public.homework_assignments where id=pg_temp.key('hw'))
 and not exists(select 1 from private.homework_uploads where assignment_id=pg_temp.key('hw')) and not exists(select 1 from public.courses where organization_id=pg_temp.key('org')),'Clear removes the lesson, its homework, the photo rows and the courses');
select pg_temp.ok(not exists(select 1 from private.demo_seed_rows where organization_id=pg_temp.key('org')),'nothing recorded is left');
select pg_temp.ok(not exists(select 1 from public.notifications n where n.recipient_id in (select id from public.profiles where display_name like 'Demo Student %')),'no notification of a released demo try remains');
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'seedVersion')::int=9,'the space fills again at seed version 9');
select pg_temp.ok((private.demo_clear_core(pg_temp.key('org'),pg_temp.uid('admin'))->>'removedRows')::int=1568,'a plain Clear removes exactly the 1568 rows (800 recorded before seed version 7, plus the 767 exam rows)');
select count(*)::integer homework_correct_tests from hc_results;
rollback;
