-- Homework marks show at once, solutions follow the student's own tries, and one lesson-completion rule (owner's decisions, 2026-11-27).
-- Draft; not applied. Replaces the homework release and "after the deadline" rules of 20261109120000 for homework only. Exams do not change.
--
-- A. A self-marked result is released when the student hands in. The submit step of homework_work already corrects every choice question
--    (and copies the marks a fix-mistakes try keeps); when no mark is left empty (no essay waits for a teacher) the correction is stored
--    released at the hand-in instant, with released_by null: "released by the rule, not by a person". Mixed homework keeps released_at null
--    until the teacher releases the essays (unchanged), and homework_submission_json shows the student the marks of the self-marked
--    questions at once (selfMarked) while the essay marks and the total wait. Every reader of released_at (reports, the queue, release
--    many, the notice link, Try again's kept essays) therefore follows the new rule without a change. Existing self-marked tries that are
--    corrected and unreleased are released now (backfill), dated at their hand-in, with an 'auto_released' audit row.
--    No notice for a self-marked release: the notification trigger fires only when a person released (released_by is not null).
-- B. Solutions open once the student can no longer improve: after a hand-in when the deadline has passed or every try is used (one time:
--    the first hand-in), or when the student chose to stop (homework_work 'stop': "I'm done, show me the answers"). Stopping ends the
--    remaining tries (private.homework_solutions_seen, reason 'stopped'). 'after_deadline' is retired: existing rows become
--    'after_hand_in' and the column refuses anything else.
-- C. private.lesson_completion (read) and private.lesson_opened (write, a lesson with no part) give one lesson-completion rule.
-- D. homework_portal rows gain averageScore; homework_students lists each student of the run for one homework (read only).
begin;

-- ---------------------------------------------------------------------------------------
-- Schema and data
-- ---------------------------------------------------------------------------------------
-- A release by the rule has no person: released_by may be null when released_at is set (a person's release always names them).
alter table private.homework_corrections drop constraint homework_corrections_check;
alter table private.homework_corrections add constraint homework_corrections_release_check check(released_by is null or released_at is not null);

-- The notice "marks released" is for a person's release only (an essay correction, or a re-release after an edit).
drop trigger notification_homework on private.homework_corrections;
create trigger notification_homework after insert or update on private.homework_corrections for each row when (new.released_by is not null)
 execute function private.notification_business_event();

-- 'after_deadline' is retired (owner, 2026-11-27). Existing rows open their solutions after the student's own tries, like every homework.
-- The revision moves on, so a wizard that still holds the old rule reloads instead of saving it back.
update public.homework_assignments set solutions_open='after_hand_in',revision=revision+1 where solutions_open='after_deadline';
alter table public.homework_assignments drop constraint homework_assignments_solutions_open_check;
alter table public.homework_assignments add constraint homework_assignments_solutions_open_check check(solutions_open='after_hand_in');

-- Why a student's tries ended for good: the deadline changed while their solutions were open (20261109120000), or they chose to stop.
alter table private.homework_solutions_seen add column reason text not null default 'rescheduled' check(reason in ('rescheduled','stopped'));

-- Backfill: a handed-in try of homework with no essay, corrected by the rule and never released, is released as of its hand-in.
with due as (
 select c.submission_id,s.submitted_at,s.assignment_id,s.user_id from private.homework_corrections c
  join public.homework_submissions s on s.id=c.submission_id and s.status='submitted'
  join public.homework_assignments a on a.id=s.assignment_id and a.mode='PLATFORM_QUESTIONS'
 where c.released_at is null and c.status='corrected'
  and not exists(select 1 from public.homework_questions q where q.assignment_id=a.id and q.type='essay')
  and not exists(select 1 from private.homework_marks m where m.submission_id=c.submission_id and m.points is null)),
 done as (update private.homework_corrections c set released_at=coalesce(d.submitted_at,clock_timestamp()),revision=c.revision+1
  from due d where c.submission_id=d.submission_id returning c.submission_id,c.released_at)
insert into private.homework_audit(assignment_id,submission_id,actor,action,reason,after_value)
 select d.assignment_id,d.submission_id,d.user_id,'auto_released','self-marked marks show at once (owner, 2026-11-27)',jsonb_build_object('releasedAt',x.released_at)
 from done x join due d on d.submission_id=x.submission_id;

-- ---------------------------------------------------------------------------------------
-- B. The solutions rule for one student now: a hand-in, and then the deadline has passed or every try is used (one time: the first
-- hand-in). The student's choice to stop is in private.homework_solutions_seen, which private.homework_unlocked already reads.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_solutions_rule(p_assignment uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_assignments a
  cross join lateral (select count(*) n from public.homework_submissions s where s.assignment_id=a.id and s.user_id=p_user and s.status='submitted') h
  where a.id=p_assignment and h.n>0 and (a.workflow='legacy' or private.homework_is_late(clock_timestamp(),a.deadline_at) or h.n>=a.max_tries))
$$;

-- ---------------------------------------------------------------------------------------
-- Authoring (20261112120000): unchanged except that rules.solutionsOpen accepts only 'after_hand_in'.
-- ---------------------------------------------------------------------------------------
create or replace function private.save_homework(p_assignment uuid,p_offering uuid,p_lesson uuid,p_segment uuid,p_revision bigint,p_definition jsonb,p_confirm_mode_change boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.homework_assignments; o public.course_offerings; q jsonb; opt jsonb; item jsonb; n integer:=0; k integer; qid uuid; oid uuid; keys uuid[]; asset uuid; mode text;
 r jsonb; v_deadline timestamptz; v_late boolean; v_tries text; v_max integer; v_solutions text; v_photos boolean; v_from uuid; moving boolean:=false; model uuid;
begin
 if not private.is_active_user() then raise exception 'Authentication required' using errcode='42501';end if;
 if p_assignment is null then
  select * into o from public.course_offerings where id=p_offering for share;
 else
  -- Both runs, in id order, before the homework: a move and a student's start (homework FOR SHARE) never wait on each other crosswise.
  select h.offering_id into v_from from public.homework_assignments h where h.id=p_assignment;
  if v_from is null then raise exception 'Authoring denied' using errcode='42501';end if;
  perform 1 from public.course_offerings x where x.id in (v_from,p_offering) order by x.id for share;
  select * into o from public.course_offerings where id=p_offering;
 end if;
 -- The target course: the caller must be able to edit it.
 if o.id is null or not private.can_edit_course(o.course_id) then raise exception 'Homework authoring denied' using errcode='42501';end if;
 if p_assignment is null then
  p_assignment:=gen_random_uuid();insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,segment_id,title,mode,workflow,tries_mode,max_tries,solutions_open,created_by)
   values(p_assignment,p_assignment,o.course_id,o.id,p_lesson,p_segment,p_definition->>'title','PLATFORM_QUESTIONS','questions','one_time',1,'after_hand_in',(select private.current_app_user_id()));
 end if;
 select * into a from public.homework_assignments where id=p_assignment for update;
 -- The homework's own course: 'author' is can_edit_course of the course it is in now.
 if a.id is null or a.segment_id is distinct from p_segment or not private.homework_staff(a.id,'author') then raise exception 'Authoring denied' using errcode='42501';end if;
 if v_from is not null and a.offering_id<>v_from then raise exception 'Homework changed; reload' using errcode='PT409';end if;
 if a.revision<>coalesce(p_revision,0) then raise exception 'Homework changed; reload' using errcode='PT409';end if;
 moving:=a.offering_id<>p_offering or a.lesson_id<>p_lesson;
 if moving then
  -- One space: a course in another teaching space is refused even when the caller can edit both.
  if (select c.organization_id from public.courses c where c.id=o.course_id) is distinct from (select c.organization_id from public.courses c where c.id=a.course_id) then
   raise exception 'A homework stays in its teaching space' using errcode='PT409',detail='{"reason":"other_space"}';end if;
  if exists(select 1 from public.homework_submissions where assignment_id=a.id) then raise exception 'Work has started; this homework stays in its lesson' using errcode='PT409',detail='{"reason":"started"}';end if;
  if exists(select 1 from public.homework_assignments v where v.family_id=a.family_id and v.id<>a.id) then raise exception 'A later version stays in its lesson' using errcode='PT409',detail='{"reason":"versioned"}';end if;
 end if;
 if exists(select 1 from public.homework_submissions where assignment_id=a.id) then raise exception 'Work has started; clone a new version' using errcode='PT409';end if;
 if jsonb_typeof(p_definition)<>'object' or octet_length(p_definition::text)>500000 then raise exception 'Invalid definition' using errcode='23514';end if;
 mode:=p_definition->>'mode';
 v_deadline:=a.deadline_at;v_late:=a.late_allowed;v_tries:=a.tries_mode;v_max:=a.max_tries;v_solutions:=a.solutions_open;v_photos:=a.photos_allowed;
 r:=coalesce(nullif(p_definition->'rules','null'::jsonb),'{}'::jsonb);
 if a.workflow='legacy' then
  if r<>'{}'::jsonb then raise exception 'Rules apply to new homework only' using errcode='23514';end if;
 else
  if mode is distinct from 'PLATFORM_QUESTIONS' then raise exception 'New homework is questions only' using errcode='23514';end if;
  if jsonb_typeof(r)<>'object' then raise exception 'Invalid homework rules' using errcode='23514';end if;
  if exists(select 1 from jsonb_object_keys(r) x where x not in ('deadline','lateAllowed','tries','maxTries','solutionsOpen','photosAllowed'))
   or (r ? 'deadline' and not (jsonb_typeof(r->'deadline')='null' or (jsonb_typeof(r->'deadline')='string' and r->>'deadline' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$')))
   or (r ? 'lateAllowed' and jsonb_typeof(r->'lateAllowed')<>'boolean') or (r ? 'photosAllowed' and jsonb_typeof(r->'photosAllowed')<>'boolean')
   or (r ? 'tries' and (jsonb_typeof(r->'tries')<>'string' or r->>'tries' not in ('one_time','fix_mistakes','from_zero')))
   or (r ? 'solutionsOpen' and (jsonb_typeof(r->'solutionsOpen')<>'string' or r->>'solutionsOpen'<>'after_hand_in'))
   or (r ? 'maxTries' and (jsonb_typeof(r->'maxTries')<>'number' or r->>'maxTries' !~ '^\d{1,2}$')) then raise exception 'Invalid homework rules' using errcode='23514';end if;
  if r ? 'deadline' then
   begin v_deadline:=(r->>'deadline')::timestamptz; exception when others then raise exception 'Invalid homework deadline' using errcode='23514'; end;
  end if;
  v_late:=coalesce((r->>'lateAllowed')::boolean,v_late);v_photos:=coalesce((r->>'photosAllowed')::boolean,v_photos);
  v_solutions:=coalesce(r->>'solutionsOpen',v_solutions);v_tries:=coalesce(r->>'tries',v_tries);
  v_max:=case when v_tries='one_time' then 1 when r ? 'maxTries' then (r->>'maxTries')::integer when a.tries_mode='one_time' then 2 else v_max end;
  if (v_tries='one_time' and r ? 'maxTries' and (r->>'maxTries')::integer<>1) or (v_tries<>'one_time' and v_max not between 2 and 10) then raise exception 'Tries must be one, or two to ten' using errcode='23514';end if;
  if coalesce((p_definition->>'published')::boolean,false) and v_deadline is null then raise exception 'Set a deadline before publishing' using errcode='23514';end if;
 end if;
 if mode<>a.mode and exists(select 1 from public.homework_questions where assignment_id=a.id) and not p_confirm_mode_change then raise exception 'Confirm removal of authored questions' using errcode='23514';end if;
 if mode not in ('FILE_UPLOAD','PLATFORM_QUESTIONS') or jsonb_typeof(p_definition->'questions')<>'array' or jsonb_array_length(p_definition->'questions')>100 or
 (mode='FILE_UPLOAD' and jsonb_array_length(p_definition->'questions')<>0) or (mode='PLATFORM_QUESTIONS' and jsonb_array_length(p_definition->'questions')<1) then raise exception 'Invalid mode/question set' using errcode='23514';end if;
 -- This deletes only an explicitly saved, unstarted draft definition; no submitted work is affected.
 delete from public.homework_questions where assignment_id=a.id;
 for q in select value from jsonb_array_elements(p_definition->'questions') loop
  qid:=(q->>'id')::uuid;
  if q->>'type' not in ('single_choice','multiple_choice','essay') or jsonb_typeof(q->'options')<>'array' or jsonb_typeof(q->'correctIds')<>'array' then raise exception 'Invalid question structure' using errcode='23514';end if;
  if a.workflow='questions' and q->>'type'='essay' and not v_photos and q->>'responseMode' is distinct from 'text' then raise exception 'Photo answers are off for this homework' using errcode='23514';end if;
  asset:=(q->>'imageId')::uuid;if asset is not null then perform private.homework_asset(a.id,asset,'question');end if;
  -- The model answer picture: a ready 'solution' upload of this homework (family), and an image.
  model:=(q->>'modelImageId')::uuid;
  if model is not null then
   perform private.homework_asset(a.id,model,'solution');
   if not exists(select 1 from private.homework_uploads where id=model and mime in ('image/png','image/jpeg','image/webp')) then raise exception 'A model answer picture is an image' using errcode='23514';end if;
  end if;
  insert into public.homework_questions(id,assignment_id,position,type,text,image_id,points,response_mode) values(qid,a.id,n,q->>'type',coalesce(q->>'text',''),asset,(q->>'points')::integer,q->>'responseMode');n:=n+1;
  keys:=array(select value::uuid from jsonb_array_elements_text(q->'correctIds'));
  if q->>'type'='essay' then
   if jsonb_array_length(q->'options')<>0 or cardinality(keys)<>0 then raise exception 'Essay cannot contain choices' using errcode='23514';end if;
  else
   if jsonb_array_length(q->'options') not between 2 and 8 or cardinality(keys)>8 or (q->>'type'='single_choice' and cardinality(keys)>1) or ((p_definition->>'published')::boolean and cardinality(keys)=0) or cardinality(keys)<>(select count(distinct v) from unnest(keys) v) then raise exception 'Invalid choice structure/key' using errcode='23514';end if;
   k:=0;for opt in select value from jsonb_array_elements(q->'options') loop
    oid:=(opt->>'id')::uuid;insert into public.homework_options(id,question_id,position,text) values(oid,qid,k,coalesce(opt->>'text',''));k:=k+1;
   end loop;
   if exists(select 1 from unnest(keys) v where not exists(select 1 from public.homework_options where id=v and question_id=qid)) then raise exception 'Foreign answer key' using errcode='23514';end if;
  end if;
  insert into private.homework_keys(question_id,correct_ids,model_answer,model_image_id) values(qid,keys,coalesce(q->>'modelAnswer',''),model);
 end loop;
 asset:=(p_definition->>'solutionVideoId')::uuid;if asset is not null then perform private.homework_asset(a.id,asset,'solution');if not exists(select 1 from private.homework_uploads where id=asset and mime='video/mp4') then raise exception 'Solution video must be MP4' using errcode='23514';end if;end if;
 insert into private.homework_solutions(assignment_id,text,video_url,video_id) values(a.id,coalesce(p_definition->>'modelAnswer',''),coalesce(p_definition->>'solutionVideo',''),asset)
 on conflict(assignment_id) do update set text=excluded.text,video_url=excluded.video_url,video_id=excluded.video_id;
 delete from private.homework_materials where assignment_id=a.id;
 foreach mode in array array['reference','solution'] loop
  if jsonb_typeof(p_definition->case mode when 'reference' then 'referenceIds' else 'solutionIds' end)<>'array' then raise exception 'Invalid resource set' using errcode='23514';end if;
  k:=0;for item in select value from jsonb_array_elements(p_definition->case mode when 'reference' then 'referenceIds' else 'solutionIds' end) loop
   k:=k+1;if k>10 then raise exception 'Too many resources' using errcode='23514';end if;asset:=(item#>>'{}')::uuid;perform private.homework_asset(a.id,asset,mode);
   insert into private.homework_materials(assignment_id,upload_id,purpose) values(a.id,asset,mode);
  end loop;
 end loop;
 update public.homework_assignments set course_id=o.course_id,offering_id=o.id,lesson_id=p_lesson,
  title=p_definition->>'title',instructions=coalesce(p_definition->>'instructions',''),mode=p_definition->>'mode',status=case when (p_definition->>'published')::boolean then 'published' else 'draft' end,uses_marks=(p_definition->>'usesMarks')::boolean,file_points=(p_definition->>'filePoints')::integer,
  deadline_at=v_deadline,late_allowed=v_late,tries_mode=v_tries,max_tries=v_max,solutions_open=v_solutions,photos_allowed=v_photos,revision=revision+1,updated_at=clock_timestamp() where id=a.id;
 if moving then
  insert into private.homework_audit(assignment_id,actor,action,before_value,after_value) values(a.id,(select private.current_app_user_id()),'moved',
   jsonb_build_object('courseId',a.course_id,'offeringId',a.offering_id,'lessonId',a.lesson_id),jsonb_build_object('courseId',o.course_id,'offeringId',o.id,'lessonId',p_lesson));
 end if;
 insert into private.homework_audit(assignment_id,actor,action,before_value,after_value) values(a.id,(select private.current_app_user_id()),'definition',to_jsonb(a),p_definition);
 return a.id;
end $$;

-- ---------------------------------------------------------------------------------------
-- A try as JSON (20261109120000), plus correction.selfMarked for the student while the teacher's part is not released: the marks of the
-- questions that mark themselves (every question but an essay), their sum and their maximum, and how many essays wait. Staff and a
-- released correction are unchanged (everything shows).
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_submission_json(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.homework_submissions;c private.homework_corrections;staff boolean;visible boolean;answer jsonb;self jsonb;
begin
 select * into s from public.homework_submissions where id=p_id;
 if s.id is null or not private.homework_submission_visible(s.id) then raise exception 'Submission unavailable' using errcode='42501';end if;
 staff:=private.homework_staff(s.assignment_id,'grade');select * into c from private.homework_corrections where submission_id=s.id;visible:=staff or c.released_at is not null;
 answer:=jsonb_build_object('id',s.id,'revision',s.revision,'number',s.number,'status',s.status,'submittedAt',s.submitted_at,'missedDeadline',s.missed_deadline,
 'answers',coalesce((select jsonb_agg(jsonb_build_object('questionId',r.question_id,'optionIds',coalesce(r.response->'optionIds','[]'::jsonb),'text',coalesce(r.response->>'text',''),'fileIds',coalesce((select jsonb_agg(f.upload_id order by f.id) from public.homework_submission_files f where f.submission_id=s.id and f.question_id=r.question_id),'[]'::jsonb),
  'kept',exists(select 1 from private.homework_carried k where k.submission_id=s.id and k.question_id=r.question_id)) order by q.position) from public.homework_responses r join public.homework_questions q on q.id=r.question_id where r.submission_id=s.id),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'mime',u.mime,'deleted',u.status='deleted') order by f.id) from public.homework_submission_files f join private.homework_uploads u on u.id=f.upload_id where f.submission_id=s.id),'[]'::jsonb));
 if c.submission_id is not null then answer:=answer||jsonb_build_object('correction',jsonb_build_object('status',case when visible then c.status when exists(select 1 from private.homework_marks where submission_id=s.id and points is null) or (select mode='FILE_UPLOAD' from public.homework_assignments where id=s.assignment_id) then 'under_correction' else 'submitted' end,'revision',case when staff then c.revision else 0 end,'released',c.released_at is not null,'score',case when visible and (select uses_marks from public.homework_assignments where id=s.assignment_id) then c.score end,'feedback',case when visible then c.feedback else '' end,
 'marks',case when visible then coalesce((select jsonb_agg(jsonb_build_object('questionId',m.question_id,'points',case when a.uses_marks then m.points end,'feedback',m.feedback)) from private.homework_marks m join public.homework_assignments a on a.id=s.assignment_id where m.submission_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
 'annotations',case when visible then coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'fileId',n.upload_id,'page',n.page,'x',n.x,'y',n.y,'width',n.width,'height',n.height,'note',n.note,'revision',n.revision,'author',n.author,'updatedAt',n.updated_at) order by n.page,n.updated_at,n.id) from private.homework_annotations n where n.submission_id=s.id),'[]'::jsonb) else '[]'::jsonb end));end if;
 if c.submission_id is not null and not visible and (select mode='PLATFORM_QUESTIONS' and uses_marks from public.homework_assignments where id=s.assignment_id) then
  select jsonb_build_object('score',coalesce(sum(m.points) filter(where q.type<>'essay'),0),'max',coalesce(sum(q.points) filter(where q.type<>'essay'),0),
   'essays',count(*) filter(where q.type='essay'),
   'marks',coalesce(jsonb_agg(jsonb_build_object('questionId',q.id,'points',m.points)) filter(where q.type<>'essay'),'[]'::jsonb))
   into self from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id=s.id;
  answer:=jsonb_set(answer,'{correction,selfMarked}',self);
 end if;
 return answer;
end $$;

-- ---------------------------------------------------------------------------------------
-- Student work and correction (20261109120000), plus:
--   submit - when no mark is left empty, the correction is stored released at the hand-in instant (released_by null: by the rule).
--   stop   - "I'm done, show me the answers": p_submission is the student's latest handed-in try and p_revision its revision. Questions
--            homework only, the student's own try, an active enrollment. Same lock as retry (the student's advisory lock, then the
--            latest try FOR UPDATE). A newer try, a try still being written or another revision: PT409 'Homework changed; reload'.
--            When the solutions are already open it writes nothing. Otherwise the remaining tries end for good
--            (private.homework_solutions_seen, reason 'stopped'), so the solutions open and start, retry, save, submit and the photo
--            upload refuse "No tries left". Audited ('stopped').
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_work(p_assignment uuid,p_action text,p_submission uuid default null,p_revision bigint default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare a public.homework_assignments;s public.homework_submissions;c private.homework_corrections;u uuid:=(select private.current_app_user_id());
 q public.homework_questions;r jsonb;f jsonb;asset uuid;ids uuid[];keys uuid[];points numeric;total numeric;previous jsonb;annotation private.homework_annotations;ordinal integer;
 latest public.homework_submissions;at_ timestamptz;stored jsonb;note text;keep_ boolean;
begin
 if u is null or not private.is_active_user() or octet_length(p_data::text)>500000 then raise exception 'Authentication or payload invalid' using errcode='42501';end if;
 -- Authoring/unpublication take an exclusive root lock. Student work holds a shared
 -- root lock and serializes only the exact student's submission/correction rows.
 select * into a from public.homework_assignments where id=p_assignment for share;
 if a.id is null then raise exception 'Homework unavailable' using errcode='42501';end if;
 if p_action in ('start','retry','save','submit') then perform 1 from public.enrollments e where e.offering_id=a.offering_id and e.user_id=u for share;end if;
 if p_action='start' then
  if not private.homework_enrolled(a.id) then raise exception 'Active enrollment required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text||u::text,0));
  select * into s from public.homework_submissions where assignment_id=a.id and user_id=u order by number desc limit 1 for update;
  if not private.homework_enrolled(a.id) then raise exception 'Enrollment expired during start' using errcode='42501';end if;
  if s.status='draft' then return private.homework_submission_json(s.id);end if;
  if a.workflow='questions' then
   if s.id is not null then return private.homework_submission_json(s.id);end if;
   if exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=u) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
   at_:=clock_timestamp();
   if private.homework_is_late(at_,a.deadline_at) and not a.late_allowed then raise exception 'Deadline passed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
   insert into public.homework_submissions(assignment_id,user_id,number) values(a.id,u,1) returning * into s;
   return private.homework_submission_json(s.id);
  end if;
  if s.id is not null and not exists(select 1 from private.homework_corrections where submission_id=s.id and status='resubmit_required' and released_at is not null) then return private.homework_submission_json(s.id);end if;
  ordinal:=coalesce(s.number,0)+1;
  insert into public.homework_submissions(assignment_id,user_id,number) values(a.id,u,ordinal) returning * into s;
  return private.homework_submission_json(s.id);
 end if;
 if p_action='stop' then
  if a.workflow<>'questions' then raise exception 'Tries are not available for this homework' using errcode='23514';end if;
  if not private.homework_enrolled(a.id) then raise exception 'Active enrollment required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text||u::text,0));
  select * into latest from public.homework_submissions where assignment_id=a.id and user_id=u order by number desc limit 1 for update;
  select * into s from public.homework_submissions where id=p_submission and assignment_id=a.id and user_id=u;
  if s.id is null or latest.id is null then raise exception 'Submission unavailable' using errcode='42501';end if;
  if latest.id<>s.id or s.status<>'submitted' or p_revision is null or s.revision<>p_revision then raise exception 'Homework changed; reload' using errcode='PT409';end if;
  if not private.homework_enrolled(a.id) then raise exception 'Enrollment expired during work' using errcode='42501';end if;
  if private.homework_solutions_rule(a.id,u) or exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=u) then return private.homework_submission_json(s.id);end if;
  insert into private.homework_solutions_seen(assignment_id,user_id,opened_at,deadline_at,reason) values(a.id,u,clock_timestamp(),a.deadline_at,'stopped');
  insert into private.homework_audit(assignment_id,submission_id,actor,action) values(a.id,s.id,u,'stopped');
  return private.homework_submission_json(s.id);
 end if;
 if p_action='retry' then
  if a.workflow<>'questions' then raise exception 'Tries are not available for this homework' using errcode='23514';end if;
  if not private.homework_enrolled(a.id) then raise exception 'Active enrollment required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text||u::text,0));
  select * into latest from public.homework_submissions where assignment_id=a.id and user_id=u order by number desc limit 1 for update;
  select * into s from public.homework_submissions where id=p_submission and assignment_id=a.id and user_id=u;
  if s.id is null or latest.id is null then raise exception 'Submission unavailable' using errcode='42501';end if;
  -- A second tab asking for the same next try gets it.
  if latest.status='draft' and latest.number=s.number+1 then return private.homework_submission_json(latest.id);end if;
  if latest.id<>s.id or s.status<>'submitted' then raise exception 'Homework changed; reload' using errcode='PT409';end if;
  -- The solutions were open for this student when the deadline changed: the tries ended then.
  if exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=u) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
  at_:=clock_timestamp();
  if private.homework_is_late(at_,a.deadline_at) then raise exception 'Deadline passed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  if s.number>=a.max_tries then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
  if not private.homework_enrolled(a.id) then raise exception 'Enrollment expired during retry' using errcode='42501';end if;
  insert into public.homework_submissions(assignment_id,user_id,number) values(a.id,u,s.number+1) returning * into latest;
  if a.tries_mode='fix_mistakes' then
   for q in select * from public.homework_questions where assignment_id=a.id order by position loop
    keep_:=case when q.type='essay' then q.points>0
      and exists(select 1 from private.homework_marks m where m.submission_id=s.id and m.question_id=q.id and m.points is not null and m.points>=q.points)
      and exists(select 1 from private.homework_corrections hc where hc.submission_id=s.id and hc.released_at is not null)
     else exists(select 1 from public.homework_responses hr join private.homework_keys hk on hk.question_id=hr.question_id where hr.submission_id=s.id and hr.question_id=q.id and cardinality(hk.correct_ids)>0
      and array(select x::uuid from jsonb_array_elements_text(hr.response->'optionIds') x order by 1)=array(select y from unnest(hk.correct_ids) y order by 1)) end;
    if keep_ then
     insert into public.homework_responses(submission_id,question_id,response) select latest.id,q.id,hr.response from public.homework_responses hr where hr.submission_id=s.id and hr.question_id=q.id;
     insert into public.homework_submission_files(submission_id,question_id,upload_id) select latest.id,q.id,hf.upload_id from public.homework_submission_files hf where hf.submission_id=s.id and hf.question_id=q.id;
     insert into private.homework_carried(submission_id,question_id,source_submission_id)
      values(latest.id,q.id,coalesce((select k.source_submission_id from private.homework_carried k where k.submission_id=s.id and k.question_id=q.id),s.id));
    end if;
   end loop;
  end if;
  insert into private.homework_audit(assignment_id,submission_id,actor,action) values(a.id,latest.id,u,'retry');
  return private.homework_submission_json(latest.id);
 end if;
 select * into s from public.homework_submissions where id=p_submission and assignment_id=a.id for update;
 if s.id is null then raise exception 'Submission unavailable' using errcode='42501';end if;
 if p_action in ('save','submit') then
  if s.user_id<>u or not private.homework_enrolled(a.id) then raise exception 'Student work denied' using errcode='42501';end if;
  if p_action='submit' and s.status='submitted' then return private.homework_submission_json(s.id);end if;
  if s.status<>'draft' then raise exception 'Submitted work is immutable' using errcode='PT409';end if;
  if p_revision is null or s.revision<>p_revision then raise exception 'Answers changed; reload' using errcode='PT409';end if;
  if a.workflow='questions' and exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=u) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
  at_:=clock_timestamp();
  if a.workflow='questions' and private.homework_is_late(at_,a.deadline_at) and (not a.late_allowed or s.number>1
   or exists(select 1 from public.homework_submissions x where x.assignment_id=a.id and x.user_id=u and x.status='submitted')) then
   raise exception 'Deadline passed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  if p_action='save' then
   if jsonb_typeof(p_data->'answers')<>'array' or jsonb_array_length(p_data->'answers')>100 or jsonb_typeof(p_data->'fileIds')<>'array' or jsonb_array_length(p_data->'fileIds')>10 then raise exception 'Invalid answer snapshot' using errcode='23514';end if;
   if (a.mode='FILE_UPLOAD' and jsonb_array_length(p_data->'answers')<>0) or (a.mode='PLATFORM_QUESTIONS' and jsonb_array_length(p_data->'fileIds')<>0) then raise exception 'Wrong submission mode' using errcode='23514';end if;
   if (select count(distinct value->>'questionId') from jsonb_array_elements(p_data->'answers'))<>jsonb_array_length(p_data->'answers') then raise exception 'Duplicate question' using errcode='23514';end if;
   -- Kept answers stay exactly as they are.
   delete from public.homework_responses x where x.submission_id=s.id and not exists(select 1 from private.homework_carried k where k.submission_id=s.id and k.question_id=x.question_id);
   delete from public.homework_submission_files x where x.submission_id=s.id and (x.question_id is null or not exists(select 1 from private.homework_carried k where k.submission_id=s.id and k.question_id=x.question_id));
   for r in select value from jsonb_array_elements(p_data->'answers') loop
    select * into q from public.homework_questions where id=(r->>'questionId')::uuid and assignment_id=a.id;
    if q.id is null or jsonb_typeof(r->'optionIds')<>'array' or jsonb_typeof(r->'fileIds')<>'array' or jsonb_typeof(r->'text')<>'string' or length(r->>'text')>20000 then raise exception 'Invalid question answer' using errcode='23514';end if;
    ids:=array(select value::uuid from jsonb_array_elements_text(r->'optionIds'));
    if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) or (q.type='single_choice' and cardinality(ids)>1) or exists(select 1 from unnest(ids) v where not exists(select 1 from public.homework_options where id=v and question_id=q.id)) then raise exception 'Invalid answer choices' using errcode='23514';end if;
    if exists(select 1 from private.homework_carried k where k.submission_id=s.id and k.question_id=q.id) then
     select response into stored from public.homework_responses where submission_id=s.id and question_id=q.id;
     if array(select x from unnest(ids) x order by 1) is distinct from array(select y::uuid from jsonb_array_elements_text(stored->'optionIds') y order by 1)
      or (r->>'text') is distinct from coalesce(stored->>'text','')
      or array(select z::uuid from jsonb_array_elements_text(r->'fileIds') z order by 1) is distinct from array(select hf.upload_id from public.homework_submission_files hf where hf.submission_id=s.id and hf.question_id=q.id order by 1) then
      raise exception 'A right answer from your last try cannot change' using errcode='23514';end if;
     continue;
    end if;
    if q.type='essay' then
     ordinal:=case when a.workflow='questions' then 1 else 4 end;
     if cardinality(ids)<>0 or jsonb_array_length(r->'fileIds')>ordinal or (q.response_mode='text' and jsonb_array_length(r->'fileIds')>0) or (q.response_mode='photo' and length(r->>'text')>0) then raise exception 'Wrong written answer format' using errcode='23514';end if;
    elsif jsonb_array_length(r->'fileIds')>0 or length(r->>'text')>0 then raise exception 'Choice answers cannot contain files/text' using errcode='23514';end if;
    insert into public.homework_responses(submission_id,question_id,response) values(s.id,q.id,jsonb_build_object('optionIds',to_jsonb(ids),'text',r->>'text'));
    for f in select value from jsonb_array_elements(r->'fileIds') loop
     asset:=(f#>>'{}')::uuid;perform private.homework_asset(a.id,asset,'submission',s.id);
     if a.workflow='questions' and not exists(select 1 from private.homework_uploads x where x.id=asset and x.mime in ('image/png','image/jpeg','image/webp')) then raise exception 'Photo answers are images only' using errcode='23514';end if;
     insert into public.homework_submission_files(submission_id,question_id,upload_id) values(s.id,q.id,asset);
    end loop;
   end loop;
   for f in select value from jsonb_array_elements(p_data->'fileIds') loop
    asset:=(f#>>'{}')::uuid;perform private.homework_asset(a.id,asset,'submission',s.id);insert into public.homework_submission_files(submission_id,upload_id) values(s.id,asset);
   end loop;
   if (select count(*) from public.homework_submission_files where submission_id=s.id)>10 then raise exception 'Maximum ten files per submission' using errcode='23514';end if;
  else
   if a.mode='FILE_UPLOAD' and not exists(select 1 from public.homework_submission_files where submission_id=s.id) then raise exception 'Upload your completed work before submitting' using errcode='23514';end if;
   -- A completely empty online draft is not a successful submission/unlock event.
   if a.mode='PLATFORM_QUESTIONS' and not exists(select 1 from public.homework_responses where submission_id=s.id and (jsonb_array_length(response->'optionIds')>0 or length(trim(response->>'text'))>0)) and not exists(select 1 from public.homework_submission_files where submission_id=s.id) then raise exception 'Answer at least one question before submitting' using errcode='23514';end if;
   for q in select * from public.homework_questions where assignment_id=a.id order by position loop
    -- A kept answer keeps the mark it earned.
    select m.points,m.feedback into points,note from private.homework_carried k join private.homework_marks m on m.submission_id=k.source_submission_id and m.question_id=k.question_id where k.submission_id=s.id and k.question_id=q.id;
    if found then insert into private.homework_marks(submission_id,question_id,points,feedback) values(s.id,q.id,points,note);continue;end if;
    select response into r from public.homework_responses where submission_id=s.id and question_id=q.id;
    if q.type='essay' then points:=null;else
     ids:=coalesce(array(select value::uuid from jsonb_array_elements_text(r->'optionIds')),'{}');select correct_ids into keys from private.homework_keys where question_id=q.id;
     if cardinality(keys)=0 then raise exception 'Published key is invalid' using errcode='23514';end if;
     points:=case when cardinality(ids)=cardinality(keys) and ids@>keys and keys@>ids then q.points else 0 end;
    end if;
    insert into private.homework_marks(submission_id,question_id,points) values(s.id,q.id,points);
   end loop;
   -- Nothing left for a teacher (every mark is set): the result is released now, by the rule (released_by null, so no notice).
   keep_:=a.mode='PLATFORM_QUESTIONS' and not exists(select 1 from private.homework_marks where submission_id=s.id and points is null);
   insert into private.homework_corrections(submission_id,status,score,released_at) values(s.id,case when keep_ then 'corrected' else 'under_correction' end,
    case when keep_ then (select sum(m.points) from private.homework_marks m where m.submission_id=s.id) end,case when keep_ then at_ end);
   update public.homework_submissions set status='submitted',submitted_at=at_,missed_deadline=private.homework_is_late(at_,a.deadline_at) where id=s.id;
   insert into private.homework_audit(assignment_id,submission_id,actor,action) values(a.id,s.id,u,'submitted');
  end if;
  if not private.homework_enrolled(a.id) then raise exception 'Enrollment expired during work' using errcode='42501';end if;
  update public.homework_submissions set revision=revision+1,updated_at=clock_timestamp() where id=s.id;
  return private.homework_submission_json(s.id);
 end if;
 if p_action not in ('grade','release','annotate') or not private.homework_staff(a.id,case when p_action='release' then 'release' else 'correct' end) or s.status<>'submitted' then raise exception 'Correction denied' using errcode='42501';end if;
 if a.workflow='questions' and p_action='annotate' then raise exception 'Student images are never edited' using errcode='23514';end if;
 if a.workflow='questions' and p_action='release' and p_data->>'status'='resubmit_required' then raise exception 'Tries replace the resubmit request for this homework' using errcode='23514';end if;
 select * into c from private.homework_corrections where submission_id=s.id for update;
 if p_revision is null or c.revision<>p_revision then raise exception 'Correction changed; reload' using errcode='PT409';end if;
 if c.released_at is not null and length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Released correction requires an audit reason' using errcode='23514';end if;
 previous:=to_jsonb(c)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(m)) from private.homework_marks m where m.submission_id=s.id),'annotations',(select jsonb_agg(to_jsonb(n)) from private.homework_annotations n where n.submission_id=s.id));
 if p_action='grade' then
  if a.mode='FILE_UPLOAD' then total:=(p_data->>'score')::numeric;if a.uses_marks and (total is null or total<0 or total>a.file_points) then raise exception 'Invalid file marks' using errcode='23514';end if;
  else
   if jsonb_typeof(p_data->'marks')<>'array' or jsonb_array_length(p_data->'marks')>100 or (select count(distinct value->>'questionId') from jsonb_array_elements(p_data->'marks'))<>jsonb_array_length(p_data->'marks') then raise exception 'Invalid mark set' using errcode='23514';end if;
   for r in select value from jsonb_array_elements(p_data->'marks') loop
    select * into q from public.homework_questions where id=(r->>'questionId')::uuid and assignment_id=a.id and type='essay';points:=(r->>'points')::numeric;
    if q.id is null or points is null or points<0 or points>q.points then raise exception 'Invalid written marks' using errcode='23514';end if;
    update private.homework_marks set points=(r->>'points')::numeric,feedback=coalesce(r->>'feedback','') where submission_id=s.id and question_id=q.id;
   end loop;
   total:=case when not exists(select 1 from private.homework_marks where submission_id=s.id and points is null) then (select sum(m.points) from private.homework_marks m where m.submission_id=s.id) end;
  end if;
  update private.homework_corrections set score=total,feedback=coalesce(p_data->>'feedback',''),status=case when total is null and a.uses_marks then 'under_correction' else 'corrected' end,corrected_by=u,corrected_at=clock_timestamp() where submission_id=s.id;
 elsif p_action='annotate' then
  asset:=(p_data->>'fileId')::uuid;if not exists(select 1 from public.homework_submission_files where submission_id=s.id and upload_id=asset) then raise exception 'Annotation file is not this submission' using errcode='42501';end if;
  if not exists(select 1 from private.homework_uploads where id=asset and (p_data->>'page')::int between 1 and pages) then raise exception 'Annotation page does not exist' using errcode='23514';end if;
  if p_data->>'id' is not null then
   select * into annotation from private.homework_annotations where id=(p_data->>'id')::uuid and submission_id=s.id for update;
   if annotation.id is null or annotation.revision<>(p_data->>'annotationRevision')::bigint then raise exception 'Annotation changed' using errcode='PT409';end if;
   insert into private.homework_audit(assignment_id,submission_id,actor,action,reason,before_value) values(a.id,s.id,u,'annotation_previous',coalesce(p_data->>'reason',''),to_jsonb(annotation));
   update private.homework_annotations set page=(p_data->>'page')::int,x=(p_data->>'x')::numeric,y=(p_data->>'y')::numeric,width=(p_data->>'width')::numeric,height=(p_data->>'height')::numeric,note=p_data->>'note',revision=revision+1,author=u,updated_at=clock_timestamp() where id=annotation.id;
  else
   insert into private.homework_annotations(submission_id,upload_id,page,x,y,width,height,note,author) values(s.id,asset,(p_data->>'page')::int,(p_data->>'x')::numeric,(p_data->>'y')::numeric,(p_data->>'width')::numeric,(p_data->>'height')::numeric,p_data->>'note',u);
  end if;
 else
  if p_data->>'status' not in ('corrected','approved','resubmit_required') or (p_data->>'status'<>'resubmit_required' and ((a.uses_marks and c.score is null) or exists(select 1 from private.homework_marks where submission_id=s.id and points is null))) then raise exception 'Finish correction before release' using errcode='23514';end if;
  update private.homework_corrections set status=p_data->>'status',released_at=clock_timestamp(),released_by=u where submission_id=s.id;
 end if;
 -- Editing an already released correction withdraws it until authorized re-release.
 update private.homework_corrections set revision=revision+1,released_at=case when p_action='release' then released_at end,released_by=case when p_action='release' then released_by end where submission_id=s.id returning * into c;
 insert into private.homework_audit(assignment_id,submission_id,actor,action,reason,before_value,after_value) values(a.id,s.id,u,p_action,coalesce(p_data->>'reason',''),previous,to_jsonb(c)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(m)) from private.homework_marks m where m.submission_id=s.id),'annotations',(select jsonb_agg(to_jsonb(n)) from private.homework_annotations n where n.submission_id=s.id)));
 return private.homework_submission_json(s.id);
end $$;

-- ---------------------------------------------------------------------------------------
-- Read one homework (20261112120000), plus stopped (the student chose to see the answers), canStop (the "I'm done" button: a handed-in
-- latest try, tries left, the deadline ahead), and triesEnded now means only "ended when the deadline changed".
-- ---------------------------------------------------------------------------------------
create or replace function private.get_homework(p_assignment uuid,p_submission uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.homework_assignments;staff boolean;unlocked boolean;solution private.homework_solutions;result jsonb;rules jsonb;passed boolean;used integer;top integer;drafting boolean;ended boolean;stopped boolean;
begin
 select * into a from public.homework_assignments where id=p_assignment;
 if a.id is null or not private.homework_visible(a.id) then raise exception 'Homework unavailable' using errcode='42501';end if;
 staff:=private.homework_staff(a.id);unlocked:=private.homework_unlocked(a.id);if unlocked then select * into solution from private.homework_solutions where assignment_id=a.id;end if;
 result:=jsonb_build_object('id',a.id,'offeringId',a.offering_id,'lessonId',a.lesson_id,'segmentId',a.segment_id,'revision',a.revision,'version',a.version,'locked',exists(select 1 from public.homework_submissions where assignment_id=a.id),'staff',staff,'canGrade',private.homework_staff(a.id,'correct'),'canRelease',private.homework_staff(a.id,'release'),
 'mediaCopyPending',staff and exists(select 1 from private.homework_clone_sources c join private.homework_uploads target on target.id=c.upload_id where target.assignment_id=a.id),
 'definition',jsonb_build_object('title',a.title,'instructions',a.instructions,'mode',a.mode,'published',a.status='published','usesMarks',a.uses_marks,'filePoints',a.file_points,
 'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'type',q.type,'text',q.text,'imageId',q.image_id,'points',q.points,'responseMode',q.response_mode,
 'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text) order by o.position) from public.homework_options o where o.question_id=q.id),'[]'::jsonb),
 'correctIds',case when staff then to_jsonb(k.correct_ids) else '[]'::jsonb end,'modelAnswer',case when staff then k.model_answer else '' end,'modelImageId',case when staff then k.model_image_id end) order by q.position) from public.homework_questions q join private.homework_keys k on k.question_id=q.id where q.assignment_id=a.id),'[]'::jsonb),
 'modelAnswer',case when staff then solution.text else '' end,'solutionVideo',case when staff then coalesce(solution.video_url,'') else '' end,'solutionVideoId',case when staff then solution.video_id end,
 'referenceIds',coalesce((select jsonb_agg(m.upload_id) from private.homework_materials m where m.assignment_id=a.id and m.purpose='reference'),'[]'::jsonb),
 'solutionIds',case when staff then coalesce((select jsonb_agg(m.upload_id) from private.homework_materials m where m.assignment_id=a.id and m.purpose='solution'),'[]'::jsonb) else '[]'::jsonb end),
 'references',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'mime',u.mime)) from private.homework_materials m join private.homework_uploads u on u.id=m.upload_id where m.assignment_id=a.id and m.purpose='reference'),'[]'::jsonb),
 'submissions',case when p_submission is not null then jsonb_build_array(private.homework_submission_json(p_submission)) else coalesce((select jsonb_agg(private.homework_submission_json(s.id) order by s.number desc) from (select * from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id()) order by number desc limit 50) s),'[]'::jsonb) end,
 'historyHasMore',(select count(*)>50 from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id())),
 'solutions',case when unlocked then jsonb_build_object('text',coalesce(solution.text,''),'video',coalesce(solution.video_url,''),'videoId',solution.video_id,
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'mime',u.mime)) from private.homework_materials m join private.homework_uploads u on u.id=m.upload_id where m.assignment_id=a.id and m.purpose='solution'),'[]'::jsonb),
 'keys',coalesce((select jsonb_agg(jsonb_build_object('questionId',q.id,'correctIds',k.correct_ids,'modelAnswer',k.model_answer,'modelImageId',k.model_image_id) order by q.position) from public.homework_questions q join private.homework_keys k on k.question_id=q.id where q.assignment_id=a.id),'[]'::jsonb)) end);
 if p_submission is not null and not exists(select 1 from public.homework_submissions where id=p_submission and assignment_id=a.id) then raise exception 'Submission assignment mismatch' using errcode='42501';end if;
 passed:=private.homework_is_late(clock_timestamp(),a.deadline_at);
 select count(*) filter(where status='submitted'),max(number),coalesce(bool_or(status='draft'),false) into used,top,drafting from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id());
 ended:=exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=(select private.current_app_user_id()));
 stopped:=exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=(select private.current_app_user_id()) and x.reason='stopped');
 if a.workflow='questions' then
  rules:=jsonb_build_object('deadline',a.deadline_at,'lateAllowed',a.late_allowed,'tries',a.tries_mode,'maxTries',a.max_tries,'solutionsOpen',a.solutions_open,'photosAllowed',a.photos_allowed);
  result:=jsonb_set(result,'{definition,rules}',rules);
 end if;
 return result||jsonb_build_object('workflow',a.workflow,'rules',rules,'deadline',a.deadline_at,'deadlinePassed',passed,'solutionsOpen',unlocked,'canManage',private.homework_staff(a.id,'manage'),
  'triesUsed',used,'triesEnded',ended and not stopped,'stopped',stopped,
  'triesLeft',case when a.workflow='questions' then case when ended then 0 when passed then case when top is null and a.late_allowed then 1 else 0 end else greatest(a.max_tries-coalesce(top,0)+case when drafting then 1 else 0 end,0) end end,
  'canStart',top is null and not ended and (a.workflow='legacy' or not passed or a.late_allowed),
  'canRetry',a.workflow='questions' and not ended and not passed and not drafting and used>0 and coalesce(top,0)<a.max_tries,
  'canStop',a.workflow='questions' and not staff and not ended and not passed and not drafting and used>0 and coalesce(top,0)<a.max_tries);
end $$;

-- ---------------------------------------------------------------------------------------
-- Demo homework (20261109120000): the demo fill (20261119120000) still passes 'after_deadline'; it is stored as 'after_hand_in'.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_homework_make(p_org uuid,p_owner uuid,p_course uuid,p_offering uuid,p_lesson uuid,p_title text,p_status text,p_deadline timestamptz,p_late boolean,p_tries text,p_max integer,p_solutions text) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare hw uuid:=gen_random_uuid(); q1 uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); q3 uuid:=gen_random_uuid(); o uuid; i integer; ids uuid[]:='{}';
begin
 insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,instructions,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed,revision,created_by)
  values(hw,hw,p_course,p_offering,p_lesson,p_title,'Demo homework. Answer every question, then hand in.','PLATFORM_QUESTIONS',p_status,true,'questions',p_deadline,p_late,p_tries,p_max,'after_hand_in',true,1,p_owner);
 perform private.demo_track(p_org,'homework','homework_assignments',hw);
 insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values
  (q1,hw,0,'single_choice','',2,'text'),
  (q2,hw,1,'single_choice','In a series circuit, which quantity is the same in every resistor?',2,'text'),
  (q3,hw,2,'essay','Solve the problem from the lesson and show your working.',6,'both');
 perform private.demo_track(p_org,'homework','homework_questions',q1);
 perform private.demo_track(p_org,'homework','homework_questions',q2);
 perform private.demo_track(p_org,'homework','homework_questions',q3);
 for i in 0..3 loop
  insert into public.homework_options(id,question_id,position,text) values(gen_random_uuid(),q1,i,'') returning id into o;
  perform private.demo_track(p_org,'homework','homework_options',o); ids:=ids||o;
 end loop;
 for i in 0..2 loop
  insert into public.homework_options(id,question_id,position,text) values(gen_random_uuid(),q2,i,(array['Current','Voltage','Resistance'])[i+1]) returning id into o;
  perform private.demo_track(p_org,'homework','homework_options',o); ids:=ids||o;
 end loop;
 insert into private.homework_keys(question_id,correct_ids,model_answer) values(q1,array[ids[2]],''),(q2,array[ids[5]],''),(q3,'{}','Write the law, substitute the values with units, and give the answer to two decimal places.');
 perform private.demo_track(p_org,'homework','homework_keys',q1);
 perform private.demo_track(p_org,'homework','homework_keys',q2);
 perform private.demo_track(p_org,'homework','homework_keys',q3);
 insert into private.homework_solutions(assignment_id,text) values(hw,'Demo worked solution: the textbook answer is B; in series the current is the same; the essay follows the lesson''s example.');
 perform private.demo_track(p_org,'homework','homework_solutions',hw);
 return array[hw,q1,q2,q3,ids[2],ids[1],ids[5],ids[6]];
end $$;

-- ---------------------------------------------------------------------------------------
-- The Homework page (20261112120000), plus averageScore on every row: the mean released score of the students' latest handed-in tries
-- (a self-marked try is released at hand-in; an essay waits for the teacher's release). Null when none has a mark. Closed homework is
-- listed newest deadline first, as before.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_portal(p_course uuid default null,p_tab text default 'open',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());at_ timestamptz:=clock_timestamp();wk timestamptz;wk_end timestamptz;courses_ uuid[];eds uuid[];sups uuid[];hws uuid[];result jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('open','closed','drafts') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 wk:=private.homework_week_start(at_);wk_end:=((wk at time zone 'Africa/Cairo')+interval '7 days') at time zone 'Africa/Cairo';
 courses_:=array(select c.id from public.courses c where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and (p_course is null or c.id=p_course));
 eds:=array(select x from unnest(courses_) x where private.can_edit_course(x));
 sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));
 if p_course is not null and cardinality(eds)=0 and cardinality(sups)=0 then raise exception 'Homework unavailable' using errcode='42501';end if;
 hws:=array(select h.id from public.homework_assignments h where h.course_id=any(courses_) and (h.offering_id=any(sups) or h.course_id=any(eds))
  and (not exists(select 1 from public.homework_assignments n where n.family_id=h.family_id and n.version>h.version) or exists(select 1 from public.homework_submissions s where s.assignment_id=h.id and s.status='submitted')));
 with h as materialized (select a.*,a.offering_id=any(sups) as counted,case when a.status='draft' then 'drafts' when a.deadline_at is not null and a.deadline_at<=at_ then 'closed' else 'open' end as tab
   from public.homework_assignments a where a.id=any(hws)),
  qs as materialized (select q.assignment_id,count(*) n,coalesce(sum(q.points),0) m from public.homework_questions q where q.assignment_id in (select id from h) group by q.assignment_id),
  roster as materialized (select e.offering_id,count(distinct e.user_id) n from public.enrollments e where e.offering_id=any(sups) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_) group by e.offering_id),
  subs as materialized (select s.id,s.assignment_id,s.user_id,s.number,s.submitted_at,s.missed_deadline from public.homework_submissions s where s.assignment_id in (select id from h where counted) and s.status='submitted'),
  latest as materialized (select distinct on (s.assignment_id,s.user_id) s.id,s.assignment_id,s.user_id from subs s order by s.assignment_id,s.user_id,s.number desc),
  empties as materialized (select m.submission_id,count(*) n from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id in (select id from latest) and m.points is null and q.type='essay' group by m.submission_id),
  files_waiting as materialized (select c.submission_id from private.homework_corrections c join latest l on l.id=c.submission_id join h on h.id=l.assignment_id where h.mode='FILE_UPLOAD' and c.status='under_correction'),
  waiting as materialized (select l.assignment_id,sum(coalesce(e.n,0)+case when w.submission_id is null then 0 else 1 end) n from latest l left join empties e on e.submission_id=l.id left join files_waiting w on w.submission_id=l.id group by l.assignment_id),
  handed as materialized (select assignment_id,count(*) n from latest group by assignment_id),
  marked as materialized (select l.assignment_id,round(avg(c.score),2) n from latest l join private.homework_corrections c on c.submission_id=l.id where c.released_at is not null and c.score is not null group by l.assignment_id),
  late as materialized (select assignment_id,count(distinct user_id) n from subs where missed_deadline group by assignment_id),
  bytes as materialized (select x.assignment_id,sum(x.size_bytes) n from private.homework_uploads x where x.assignment_id in (select id from h where counted and tab='closed') and x.purpose='submission' and x.status='ready' group by x.assignment_id),
  listed as materialized (select h.id,h.tab,h.deadline_at,h.updated_at,h.title,(coalesce(w.n,0)) waiting_n,h.counted,
   jsonb_build_object('id',h.id,'title',h.title,'courseId',h.course_id,'courseTitle',c.title,'offeringId',h.offering_id,'lessonId',h.lesson_id,'lessonTitle',l.title,'version',h.version,
    'workflow',h.workflow,'mode',h.mode,'status',h.status,'deadline',h.deadline_at,'lateAllowed',h.late_allowed,'tries',h.tries_mode,'maxTries',h.max_tries,'solutionsOpen',h.solutions_open,'photosAllowed',h.photos_allowed,'updatedAt',h.updated_at,
    'questionCount',coalesce(qs.n,0),'totalMarks',case when h.mode='FILE_UPLOAD' then h.file_points else coalesce(qs.m,0) end,
    'handedIn',case when h.counted then coalesce(hd.n,0) end,'total',case when h.counted then coalesce(r.n,0) end,'late',case when h.counted then coalesce(lt.n,0) end,'averageScore',case when h.counted and h.uses_marks then mk.n end,
    'waiting',case when h.counted then coalesce(w.n,0) end,'imageBytes',case when h.counted and h.tab='closed' then coalesce(b.n,0) end) j
   from h join public.courses c on c.id=h.course_id join public.lessons l on l.id=h.lesson_id left join qs on qs.assignment_id=h.id
   left join roster r on r.offering_id=h.offering_id left join handed hd on hd.assignment_id=h.id left join late lt on lt.assignment_id=h.id left join marked mk on mk.assignment_id=h.id left join waiting w on w.assignment_id=h.id left join bytes b on b.assignment_id=h.id)
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',25,'serverNow',at_,
  'stats',jsonb_build_object('weekStart',wk,'weekEnd',wk_end,
   'essaysWaiting',(select coalesce(sum(n),0) from waiting),
   'correctedThisWeek',(select count(*) from private.homework_corrections c join subs s on s.id=c.submission_id where c.corrected_at>=wk and c.corrected_at<wk_end),
   'handedInThisWeek',(select count(*) from subs where submitted_at>=wk and submitted_at<wk_end),
   'onTimePercent',(select case when count(*)=0 then null else round(100.0*count(*) filter(where not missed_deadline)/count(*)) end from subs where number=1 and submitted_at>=wk and submitted_at<wk_end)),
  'counts',jsonb_build_object('open',(select count(*) from listed where tab='open'),'closed',(select count(*) from listed where tab='closed'),'drafts',(select count(*) from listed where tab='drafts')),
  'toCorrect',coalesce((select jsonb_agg(x.j order by x.deadline_at nulls last,x.id) from (select * from listed where counted and waiting_n>0 order by deadline_at nulls last,id limit 50) x),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x.j order by x.o) from (select j,row_number() over(order by
     case when p_tab='open' then deadline_at end asc nulls last,case when p_tab='closed' then deadline_at end desc,case when p_tab='drafts' then updated_at end desc,id) o
    from listed where tab=p_tab order by o limit 25 offset p_page*25) x),'[]'::jsonb)) into result;
 return result;
end $$;

-- ---------------------------------------------------------------------------------------
-- D. One homework, every student of its run (read only): handed in on time, late, or not handed in; the mark (released, so a self-marked
-- try shows at once and an essay waits for the release); the tries used; the student's current Group. Support staff of the run (the same
-- right as the correcting queue). Students who handed in and left the run are listed too. 100 a page, by Group then name.
-- ---------------------------------------------------------------------------------------
create function private.homework_students(p_assignment uuid,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.homework_assignments;at_ timestamptz:=clock_timestamp();result jsonb;total_marks numeric;
begin
 if private.current_app_user_id() is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.homework_assignments where id=p_assignment;
 if a.id is null or not private.homework_staff(a.id,'grade') then raise exception 'Homework unavailable' using errcode='42501';end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid page' using errcode='23514';end if;
 total_marks:=case when a.mode='FILE_UPLOAD' then a.file_points else (select coalesce(sum(q.points),0) from public.homework_questions q where q.assignment_id=a.id) end;
 with roster as materialized (select distinct e.user_id from public.enrollments e where e.offering_id=a.offering_id and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_)),
  tries as materialized (select s.user_id,count(*) n,bool_or(s.missed_deadline) late,max(s.number) top from public.homework_submissions s where s.assignment_id=a.id and s.status='submitted' group by s.user_id),
  latest as materialized (select distinct on (s.user_id) s.id,s.user_id,s.submitted_at from public.homework_submissions s where s.assignment_id=a.id and s.status='submitted' order by s.user_id,s.number desc),
  people as materialized (select user_id from roster union select user_id from tries),
  rows_ as materialized (select p.user_id,pr.display_name,g.id group_id,g.name group_name,t.n tries,coalesce(t.late,false) late,l.submitted_at,
    case when c.released_at is not null and a.uses_marks then c.score end score,
    l.id is not null and c.released_at is null waiting,
    case when t.n is null then 'not_handed_in' when t.late then 'late' else 'handed_in' end state
   from people p join public.profiles pr on pr.id=p.user_id
   left join tries t on t.user_id=p.user_id left join latest l on l.user_id=p.user_id left join private.homework_corrections c on c.submission_id=l.id
   left join lateral (select sg.id,sg.name from public.group_memberships m join public.study_groups sg on sg.id=m.group_id
     where m.offering_id=a.offering_id and m.user_id=p.user_id and m.starts_at<=at_ and (m.ends_at is null or m.ends_at>at_) order by m.starts_at desc limit 1) g on true)
 select jsonb_build_object('page',p_page,'pageSize',100,'serverNow',at_,
  'homework',jsonb_build_object('id',a.id,'title',a.title,'courseId',a.course_id,'offeringId',a.offering_id,'deadline',a.deadline_at,'lateAllowed',a.late_allowed,
   'tries',a.tries_mode,'maxTries',a.max_tries,'status',a.status,'usesMarks',a.uses_marks,'totalMarks',total_marks),
  'counts',jsonb_build_object('total',(select count(*) from rows_),'handedIn',(select count(*) from rows_ where state<>'not_handed_in'),'late',(select count(*) from rows_ where state='late'),
   'notHandedIn',(select count(*) from rows_ r where state='not_handed_in'),'averageScore',(select round(avg(score),2) from rows_ where score is not null)),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',x.display_name,'groupId',x.group_id,'groupName',x.group_name,'state',x.state,'late',x.late,
    'submittedAt',x.submitted_at,'tries',coalesce(x.tries,0),'score',x.score,'waiting',x.waiting) order by x.o)
   from (select r.*,row_number() over(order by r.group_name nulls last,r.display_name nulls last,r.user_id) o from rows_ r order by o limit 100 offset p_page*100) x),'[]'::jsonb)) into result;
 return result;
end $$;

-- ---------------------------------------------------------------------------------------
-- C. Lesson completion, one rule for every screen. For the caller's runs among p_offerings (at most 100; a run the caller has no active,
-- current enrollment in, or whose course or run is not live, is left out without a word), every published lesson of the run's course:
--   complete = every published part completed by the caller in that run
--              AND every published homework of the lesson in that run handed in (late counts; any version of the family counts)
--              AND (the lesson has a part or a homework, OR the caller opened it: a lesson with neither is complete once opened).
--   started  = some part touched, some homework started, or the lesson opened.
-- Read only, the caller's own rows only.
-- ---------------------------------------------------------------------------------------
create function private.lesson_completion(p_offerings uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());at_ timestamptz:=clock_timestamp();
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_offerings is null or cardinality(p_offerings)>100 then raise exception 'Invalid runs' using errcode='23514';end if;
 return (with o as materialized (select x.id,x.course_id from public.course_offerings x join public.courses c on c.id=x.course_id and c.status='published'
    where x.id=any(p_offerings) and x.status='active' and exists(select 1 from public.enrollments e where e.offering_id=x.id and e.user_id=u and e.status='active'
     and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_))),
  l as materialized (select o.id offering_id,x.id lesson_id from o join public.course_modules m on m.course_id=o.course_id join public.lessons x on x.module_id=m.id and x.status='published'),
  parts as materialized (select l.offering_id,l.lesson_id,count(*) total,count(*) filter(where p.status='completed') done,count(p.segment_id) touched
    from l join public.lesson_segments sg on sg.lesson_id=l.lesson_id and sg.status='published'
    left join public.lesson_segment_progress p on p.segment_id=sg.id and p.offering_id=l.offering_id and p.user_id=u group by l.offering_id,l.lesson_id),
  fam as materialized (select distinct a.offering_id,a.lesson_id,a.family_id from public.homework_assignments a join l on l.offering_id=a.offering_id and l.lesson_id=a.lesson_id
    left join public.lesson_segments sg on sg.id=a.segment_id where a.status='published' and (a.segment_id is null or sg.status='published')),
  mine as materialized (select v.family_id,bool_or(s.status='submitted') handed from public.homework_submissions s join public.homework_assignments v on v.id=s.assignment_id
    where s.user_id=u and v.family_id in (select family_id from fam) group by v.family_id),
  hw as materialized (select f.offering_id,f.lesson_id,count(*) total,count(*) filter(where m.handed) done,count(m.family_id) touched from fam f left join mine m on m.family_id=f.family_id group by f.offering_id,f.lesson_id),
  opened as materialized (select lp.offering_id,lp.lesson_id from public.lesson_progress lp where lp.user_id=u and lp.offering_id in (select id from o))
  select coalesce(jsonb_agg(jsonb_build_object('offeringId',l.offering_id,'lessonId',l.lesson_id,'parts',coalesce(p.total,0),'partsDone',coalesce(p.done,0),
    'homework',coalesce(h.total,0),'homeworkDone',coalesce(h.done,0),
    'complete',coalesce(p.done,0)=coalesce(p.total,0) and coalesce(h.done,0)=coalesce(h.total,0) and (coalesce(p.total,0)+coalesce(h.total,0)>0 or op.lesson_id is not null),
    'started',coalesce(p.touched,0)>0 or coalesce(h.touched,0)>0 or op.lesson_id is not null) order by l.offering_id,l.lesson_id),'[]'::jsonb)
  from l left join parts p on p.offering_id=l.offering_id and p.lesson_id=l.lesson_id left join hw h on h.offering_id=l.offering_id and h.lesson_id=l.lesson_id
   left join opened op on op.offering_id=l.offering_id and op.lesson_id=l.lesson_id);
end $$;

-- ---------------------------------------------------------------------------------------
-- C. The student opened a lesson that has no published part (the lesson page by id). Records the visit once in lesson_progress, so a
-- lesson with no part and no homework counts as complete. A lesson with a part records nothing here (save_segment_progress does). The
-- student's own active, current enrollment in a live run of a published course, a published lesson of that course; the same locks as
-- save_segment_progress (the enrollment FOR SHARE, then the student's run lock). Never changes an existing row.
-- ---------------------------------------------------------------------------------------
create function private.lesson_opened(p_offering uuid,p_lesson uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());n integer;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 perform 1 from public.enrollments e where e.offering_id=p_offering and e.user_id=u for share;
 if not exists(select 1 from public.course_offerings o join public.courses c on c.id=o.course_id and c.status='published' join public.course_modules m on m.course_id=o.course_id
   join public.lessons l on l.module_id=m.id where o.id=p_offering and o.status='active' and l.id=p_lesson and l.status='published')
  or not exists(select 1 from public.enrollments e where e.offering_id=p_offering and e.user_id=u and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp())) then
  raise exception 'Lesson access denied' using errcode='42501';end if;
 if exists(select 1 from public.lesson_segments s where s.lesson_id=p_lesson and s.status='published') then return jsonb_build_object('recorded',false);end if;
 perform pg_advisory_xact_lock(hashtextextended(p_offering::text||':'||u::text,0));
 insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at,last_accessed_at) values(p_offering,p_lesson,u,'in_progress',clock_timestamp(),clock_timestamp())
  on conflict(offering_id,lesson_id,user_id) do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('recorded',n>0);
end $$;

-- Grants: the private definers to authenticated (the public wrappers run as the caller), never to public or anon.
do $$ declare f text;begin
 foreach f in array array['homework_students(uuid,integer)','lesson_completion(uuid[])','lesson_opened(uuid,uuid)'] loop
  execute format('revoke all on function private.%s from public,anon',f);
  execute format('grant execute on function private.%s to authenticated',f);
 end loop;
end $$;
create function public.homework_students(p_assignment uuid,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.homework_students(p_assignment,p_page)$$;
create function public.lesson_completion(p_offerings uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$select private.lesson_completion(p_offerings)$$;
create function public.lesson_opened(p_offering uuid,p_lesson uuid) returns jsonb language sql security invoker set search_path='' as $$select private.lesson_opened(p_offering,p_lesson)$$;
do $$ declare f text;begin
 foreach f in array array['homework_students(uuid,integer)','lesson_completion(uuid[])','lesson_opened(uuid,uuid)'] loop
  execute format('revoke all on function public.%s from public,anon',f);
  execute format('grant execute on function public.%s to authenticated',f);
 end loop;
end $$;

commit;
