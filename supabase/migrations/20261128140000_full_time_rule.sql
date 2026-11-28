-- Fix track 3: the full-time rule and Protect answers (A5-12, A6a-01, A6a-02, A6a-03, A6a-10, A6a-15 for exams, A5-03, A6a-04, A8-07, A8-08).
-- Applied after 20261128130000_reports_scope.sql; no earlier migration is edited. Owner decisions of 2026-11-17 and 2026-11-28
-- (docs/ai/DECISIONS.md, "Full-time rule and Protect answers").
--
-- Exams
--  1. Deadline (A6a-02). A try started before the student's window close gets its full time limit: deadline = start + limit (no limit: the
--     window close, as before). A start or retry at or after the close is refused as before (not_open / deadline_passed).
--  2. One "exam is over" gate (A6a-01). private.exam_over_at(exam) = the later of the last window close (private.exam_last_close, unchanged:
--     it stays the window close shown on screen and used by the reports' placement) and the latest deadline of any try still in progress;
--     null while the last close is unknown. private.exam_closed now means "over" (exam_over_at has passed), so exam_review_open,
--     exam_released, exam_settle's auto-release, exam_queue, exam_portal's tabs and exam_student_list follow it without their own copy.
--     exam_settle re-checks it right before it releases, while it holds the exam row against in-flight starts.
--     Manual release (exam_release_check, and the queue's readyToRelease through exam_user_windows): the student's own window has closed, the
--     student has no try in progress, AND no try of that student's Group (same window_group_id; a same-time exam is one Group) is still
--     being written. A released result is final for the student: no new try starts (so exam_mark_try never un-releases or re-notifies it).
--  3. Protect answers (A6a-15, decisions 4 and 6). private.exams.protect_answers boolean not null default true: every existing exam reads ON
--     by the column default. ON: the review (right answers, model answers, the marker's note) opens once the exam is over. OFF: it opens for a
--     student right after their own hand-in, never while that student has a try in progress. Saved by exam_save (a rule, like autoRelease),
--     shown by exam_settings_json (exam_get), copied by clone. The fix-mistakes second try's kept answers are unchanged (decision 6).
--  4. Archive and unpublish (A6a-03, decision 3) are refused with PT409 {"reason":"students_writing"} while a window is open (from the first
--     opening to the last close) or a try is being written (private.exam_writing). There is no exam delete action to guard.
--  5. Settle (A6a-10). A student's read or write settles only that student's overdue try, under the (exam, student) lock their writes take,
--     skipping a try the batch is already finishing. The exam-wide part (every overdue try, then auto-release and its notices) runs as one
--     batch: on a staff read, or on a student's read once the exam is over; it is taken with pg_try_advisory_xact_lock, so every other reader
--     skips it instead of queueing. No worker or cron is involved.
-- Homework
--  6. Grace (A5-12, decision 1). A try started (created_at) at or before the deadline may be saved and handed in until deadline +
--     private.homework_grace() (30 minutes), on time (missed_deadline false). private.homework_is_late(at, deadline, started) is that rule;
--     the two-argument homework_is_late (has the deadline passed) is unchanged. created_at is written once, by homework_work, from the clock the
--     deadline is checked with; the browser cannot write the table. A start or retry after the deadline is refused as before.
--  7. Solutions (decision 5): never while the caller's own try is a draft that can still be handed in (private.homework_draft_open), in
--     homework_solutions_rule and in homework_unlocked (the one gate of every solution read: get_homework, homework_upload get, storage).
--     Nothing else of the 2026-11-27 rule changes; there is no homework Protect setting.
-- Uploads (A5-03, A6a-04)
--  8. At most private.upload_cap() (40) ready unreferenced or pending photos per student per homework and per student per exam; the intent is
--     refused 23514 {"reason":"too_many_uploads"}. private.expired_homework_uploads also lists ready unreferenced files older than a day;
--     private.expired_exam_uploads lists expired pending and ready unreferenced exam files older than a day. Listing only: nothing is deleted.
-- Reports
--  9. report_exams calls private.exam_released (A8-07); report_homework counts a draft inside its grace as open, not missing (A8-08).
begin;

alter table private.exams add column protect_answers boolean not null default true;
comment on column private.exams.protect_answers is 'Protect answers from sharing (owner, 2026-11-17/28): ON = the answer review opens once the exam is over; OFF = right after each student''s own hand-in, never while that student has a try in progress.';

-- The two constants, in one place each.
create function private.homework_grace() returns interval language sql immutable security definer set search_path='' as $$select interval '30 minutes'$$;
create function private.upload_cap() returns integer language sql immutable security definer set search_path='' as $$select 40$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Exams: the gate
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- When the exam is over: the last window close, or the latest deadline of a try still being written if later. Null while the last close is
-- unknown (a Group with no time or a cancelled session), as exam_last_close. Uses exam_attempts_one_open (exam_id, user_id) where in progress.
create function private.exam_over_at(p_exam uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select case when x.lc is null then null else greatest(x.lc,(select max(a.deadline_at) from private.exam_attempts a where a.exam_id=p_exam and a.status='in_progress')) end
 from (select private.exam_last_close(p_exam) lc) x
$$;

create or replace function private.exam_closed(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.exam_over_at(p_exam)<=clock_timestamp(),false)
$$;

-- Students are writing: a window is open (same time: between its open and close; per Group: from the first opening to the last close of the
-- Groups that have times), or a try is in progress with time left.
create function private.exam_writing(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.exams e where e.id=p_exam and e.kind='online' and e.status='published' and (
  exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at>clock_timestamp())
  or case when e.timing='same_time' then coalesce(e.opens_at<=clock_timestamp() and clock_timestamp()<e.closes_at,false)
   else coalesce((select min(w.opens_at)<=clock_timestamp() and clock_timestamp()<max(w.closes_at) from private.exam_windows(e.id) w where w.state='ok'),false) end))
$$;

-- The answer review (keys, model text and picture, the marker's note) for the caller. Staff always. A student needs a handed-in try and no try in
-- progress; Protect answers ON (the default) also needs the exam to be over.
create or replace function private.exam_review_open(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.exam_staff(p_exam) or (private.exam_taker(p_exam)
  and exists(select 1 from private.exam_attempts a where a.exam_id=p_exam and a.user_id=(select private.current_app_user_id()) and a.status='submitted')
  and not exists(select 1 from private.exam_attempts a where a.exam_id=p_exam and a.user_id=(select private.current_app_user_id()) and a.status='in_progress')
  and coalesce((select case when e.protect_answers then private.exam_closed(p_exam) else true end from private.exams e where e.id=p_exam),false))
$$;

-- Manual release of one result: the student's own window closed, no try of theirs in progress, and no try of their Group still being written.
create or replace function private.exam_release_check(p_exam uuid,p_result uuid) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams;r private.exam_results;w record;
begin
 select * into e from private.exams where id=p_exam;
 select * into r from private.exam_results where id=p_result;
 if e.status='draft' then raise exception 'Publish the exam first' using errcode='23514';end if;
 if r.released_at is not null then raise exception 'Already released' using errcode='23514',detail=jsonb_build_object('reason','already_released','resultId',r.id)::text;end if;
 if r.status<>'corrected' then raise exception 'Finish correction before release' using errcode='23514',detail=jsonb_build_object('reason','unfinished','resultId',r.id)::text;end if;
 if e.kind='online' then
  select * into w from private.exam_student_window(e.id,r.user_id);
  if w.closes_at is null or w.closes_at>clock_timestamp() or exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=r.user_id and a.status='in_progress')
   or exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at>clock_timestamp() and a.window_group_id is not distinct from w.group_id) then
   raise exception 'This student''s window is still open' using errcode='PT409',detail=jsonb_build_object('reason','still_open','resultId',r.id)::text;end if;
 end if;
end $$;

-- The queue's per-student "closed" (readyToRelease, releasable): the same rule as exam_release_check, for every student of the run at once.
create or replace function private.exam_user_windows(p_exam uuid) returns table(user_id uuid,closes_at timestamptz,closed boolean,group_ids uuid[]) language sql stable security definer set search_path='' as $$
 with e as (select * from private.exams where id=p_exam),
  ws as materialized (select * from private.exam_windows(p_exam)),
  roster as materialized (select distinct x.user_id from public.enrollments x join e on e.offering_id=x.offering_id where x.status='active' and (x.enrolled_at is null or x.enrolled_at<=clock_timestamp()) and (x.expires_at is null or x.expires_at>clock_timestamp())
   union select r.user_id from private.exam_results r where r.exam_id=p_exam),
  mem as materialized (select m.user_id,m.group_id from public.group_memberships m join public.study_groups g on g.id=m.group_id join e on e.offering_id=m.offering_id
   where g.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())),
  per as (select ro.user_id,array_remove(array_agg(distinct mem.group_id),null) gids from roster ro left join mem on mem.user_id=ro.user_id group by ro.user_id),
  -- The Groups (window_group_id; null = a same-time exam or students in no Group) with a try still being written.
  writing as materialized (select distinct a.window_group_id from private.exam_attempts a where a.exam_id=p_exam and a.status='in_progress' and a.deadline_at>clock_timestamp())
 select p.user_id,
  case when e.timing='same_time' then e.closes_at when cardinality(p.gids)>0 then (select max(ws.closes_at) from ws where ws.group_id=any(p.gids) and ws.state='ok') else (select max(ws.closes_at) from ws where ws.state='ok') end,
  coalesce(case when e.kind<>'online' then true when e.status='draft' then false
   when e.timing='same_time' then e.closes_at<=clock_timestamp()
   when cardinality(p.gids)>0 then exists(select 1 from ws where ws.group_id=any(p.gids) and ws.state='ok') and not exists(select 1 from ws where ws.group_id=any(p.gids) and ws.state='ok' and ws.closes_at>clock_timestamp())
   else (select max(ws.closes_at) from ws where ws.state='ok')<=clock_timestamp() end,false)
  and not exists(select 1 from private.exam_attempts a where a.exam_id=p_exam and a.user_id=p.user_id and a.status='in_progress')
  and (e.kind<>'online' or not exists(select 1 from writing g where case when e.timing='same_time' or cardinality(p.gids)=0 then g.window_group_id is null else g.window_group_id=any(p.gids) end)),
  p.gids
 from per p cross join e
$$;

-- Settle: hand in overdue tries at their deadline and store the auto-release (with its notices) once the exam is over.
create or replace function private.exam_settle(p_exam uuid,p_user uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams;t uuid;n integer;
begin
 select * into e from private.exams where id=p_exam;
 if e.id is null or e.kind<>'online' or e.status='draft' then return;end if;
 -- A student's own read or write settles only that student, under the (exam, student) lock their own writes take (exam_work). A try the batch
 -- below is finishing right now is skipped (its row is locked); the batch hands it in.
 if p_user is not null and exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=p_user and a.status='in_progress' and a.deadline_at<=clock_timestamp()) then
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':'||p_user::text||':exam-student',0));
  for t in select a.id from private.exam_attempts a where a.exam_id=e.id and a.user_id=p_user and a.status='in_progress' and a.deadline_at<=clock_timestamp() order by a.id for update skip locked loop
   perform private.exam_finish(t,true);
  end loop;
 end if;
 -- The exam-wide batch: every overdue try, then the auto-release and its notices. A staff read runs it at any time (as before); a student's read
 -- only once the exam is over. One reader takes it (a TRY lock): every other reader skips it instead of waiting.
 if p_user is null or private.exam_closed(e.id) then
  if exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at<=clock_timestamp())
   or (e.auto_release and exists(select 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null) and private.exam_closed(e.id)) then
   if pg_try_advisory_xact_lock(hashtextextended(e.id::text||':exam-settle',0)) then
    for t in select a.id from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at<=clock_timestamp() order by a.id for update skip locked loop
     perform private.exam_finish(t,true);
    end loop;
    if e.auto_release then
     -- A start that passed its check just before the close holds the exam row (FOR SHARE) until it commits: skip the release this time
     -- rather than release under it; the next reader does it. Holding the row, the gate is re-checked right before the release.
     perform 1 from private.exams x where x.id=e.id for no key update skip locked;
     if found and private.exam_closed(e.id) then
      perform 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null order by r.id for update;
      update private.exam_results set released_at=clock_timestamp(),revision=revision+1 where exam_id=e.id and status='corrected' and released_at is null;
      get diagnostics n=row_count;
      if n>0 then insert into private.exam_audit(exam_id,actor_id,action,after_data) values(e.id,null,'auto_release',jsonb_build_object('released',n));end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 if e.timing='per_group' and e.status='published' then perform private.exam_link(e.id);end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Homework: the grace and the solutions guard
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Late for a try started at p_started: after the deadline, unless it started at or before the deadline and it is still inside the grace.
create function private.homework_is_late(p_at timestamptz,p_deadline timestamptz,p_started timestamptz) returns boolean language sql immutable security definer set search_path='' as $$
 select private.homework_is_late(p_at,p_deadline) and not (p_started is not null and not private.homework_is_late(p_started,p_deadline) and p_at<=p_deadline+private.homework_grace())
$$;

-- The student has a draft of this (questions) homework that can still be handed in on time: before the deadline, or inside its grace.
create function private.homework_draft_open(p_assignment uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_assignments a join public.homework_submissions s on s.assignment_id=a.id and s.user_id=p_user and s.status='draft'
  where a.id=p_assignment and a.workflow='questions' and not private.homework_is_late(clock_timestamp(),a.deadline_at,s.created_at))
$$;

create or replace function private.homework_solutions_rule(p_assignment uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_assignments a
  cross join lateral (select count(*) n from public.homework_submissions s where s.assignment_id=a.id and s.user_id=p_user and s.status='submitted') h
  where a.id=p_assignment and h.n>0 and (a.workflow='legacy' or private.homework_is_late(clock_timestamp(),a.deadline_at) or h.n>=a.max_tries))
  and not private.homework_draft_open(p_assignment,p_user)
$$;

create or replace function private.homework_unlocked(p_assignment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.homework_staff(p_assignment) or (private.homework_enrolled(p_assignment) and (
  private.homework_solutions_rule(p_assignment,(select private.current_app_user_id()))
  or exists(select 1 from private.homework_solutions_seen x where x.assignment_id=p_assignment and x.user_id=(select private.current_app_user_id())))
  and not private.homework_draft_open(p_assignment,(select private.current_app_user_id())))
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Uploads: what the cleanup may look at (listing only; nothing here deletes)
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Same columns as before; adds ready files that nothing references, older than a day.
create or replace view private.expired_homework_uploads as
 select u.id,u.assignment_id,u.uploaded_by,u.path,u.status,u.expires_at from private.homework_uploads u
 where (u.status='pending' and u.expires_at<now() or u.status='archived') and not private.homework_upload_referenced(u.id) or u.status='deleted'
  or (u.status='ready' and u.created_at<now()-interval '1 day' and not private.homework_upload_referenced(u.id));

create view private.expired_exam_uploads as
 select u.id,u.exam_id,u.uploaded_by,u.path,u.status,u.expires_at from private.exam_uploads u
 where (u.status='pending' and u.expires_at<now())
  or (u.status='ready' and u.created_at<now()-interval '1 day'
   and not exists(select 1 from private.exam_responses r where r.upload_id=u.id)
   and not exists(select 1 from private.exam_questions q where q.image_id=u.id)
   and not exists(select 1 from private.exam_keys k where k.model_image_id=u.id));
revoke all on private.expired_exam_uploads from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- The live definitions, each with only the lines named in its comment changed
-- ---------------------------------------------------------------------------------------------------------------------------------------

-- exam_settings_json: + protectAnswers.
CREATE OR REPLACE FUNCTION private.exam_settings_json(p_exam uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',e.id,'familyId',e.family_id,'version',e.version,'courseId',e.course_id,'offeringId',e.offering_id,'kind',e.kind,'title',e.title,'description',e.description,
  'status',e.status,'publishedAt',e.published_at,'maxMarks',e.max_marks,'heldOn',e.held_on,'timing',e.timing,'startingFrom',e.starting_from,'opensAt',e.opens_at,'closesAt',e.closes_at,
  'timeLimitMinutes',e.time_limit_minutes,'tries',e.tries_mode,'shuffle',e.shuffle,'photosAllowed',e.photos_allowed,'autoRelease',e.auto_release,'coversAllChapters',e.covers_all_chapters,'protectAnswers',e.protect_answers,
  'chapterIds',coalesce((select jsonb_agg(c.module_id order by c.module_id) from private.exam_chapters c where c.exam_id=e.id),'[]'::jsonb),
  'questionCount',(select count(*) from private.exam_questions q where q.exam_id=e.id),
  'totalPoints',case when e.kind='paper' then e.max_marks else (select coalesce(sum(q.points),0) from private.exam_questions q where q.exam_id=e.id) end,
  'hasEssays',exists(select 1 from private.exam_questions q where q.exam_id=e.id and q.type='essay'))
 from private.exams e where e.id=p_exam
$function$;

-- exam_save: accepts protectAnswers (a boolean rule of an online exam; locked once a student started, like autoRelease).
CREATE OR REPLACE FUNCTION private.exam_save(p_exam uuid, p_offering uuid, p_revision bigint, p_definition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());e private.exams;d jsonb:=coalesce(p_definition,'{}'::jsonb);course uuid;started boolean:=false;
 q jsonb;qi integer:=0;qid uuid;o jsonb;oi integer;oid_ uuid;ids uuid[];correct uuid[];qtype text;img uuid;mimg uuid;tolerance numeric;num numeric;before_ jsonb;qo jsonb;qc jsonb;draft_ boolean;nt text;omin integer;cmin integer;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(jsonb_typeof(d),'')<>'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','chapterIds','coversAllChapters','heldOn','maxMarks','timing','startingFrom',
   'opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','protectAnswers','questions'))
  or (d ? 'title' and coalesce(jsonb_typeof(d->'title'),'')<>'string') or (d ? 'description' and coalesce(jsonb_typeof(d->'description'),'')<>'string')
  or exists(select 1 from unnest(array['coversAllChapters','shuffle','photosAllowed','autoRelease','protectAnswers']) k where d ? k and coalesce(jsonb_typeof(d->k),'')<>'boolean')
  or (d ? 'chapterIds' and (coalesce(jsonb_typeof(d->'chapterIds'),'')<>'array' or jsonb_array_length(d->'chapterIds')>200)) or (d ? 'questions' and coalesce(jsonb_typeof(d->'questions'),'')<>'array')
  or (d ? 'maxMarks' and (coalesce(jsonb_typeof(d->'maxMarks'),'')<>'number' or d->>'maxMarks' !~ '^\d{1,4}$'))
  or (d ? 'timeLimitMinutes' and coalesce(jsonb_typeof(d->'timeLimitMinutes'),'')<>'null' and (coalesce(jsonb_typeof(d->'timeLimitMinutes'),'')<>'number' or d->>'timeLimitMinutes' !~ '^\d{1,4}$'))
  or exists(select 1 from unnest(array['heldOn','startingFrom']) k where d ? k and coalesce(jsonb_typeof(d->k),'')<>'null' and (coalesce(jsonb_typeof(d->k),'')<>'string' or d->>k !~ '^\d{4}-\d{2}-\d{2}$'))
  or (d ? 'timing' and d->>'timing' is distinct from 'per_group' and d->>'timing' is distinct from 'same_time')
  or (d ? 'tries' and coalesce(d->>'tries','') not in ('one_time','fix_mistakes','from_zero')) then raise exception 'Invalid exam' using errcode='23514';end if;
 if p_exam is null then
  select o.course_id into course from public.course_offerings o where o.id=p_offering;
  if course is null or not private.can_edit_course(course) then raise exception 'Exam denied' using errcode='42501';end if;
  if coalesce(d->>'kind','') not in ('online','paper') then raise exception 'Choose online or paper' using errcode='23514';end if;
  oid_:=gen_random_uuid();
  insert into private.exams(id,family_id,course_id,offering_id,kind,title,timing,tries_mode,max_marks,created_by)
   values(oid_,oid_,course,p_offering,d->>'kind',coalesce(nullif(btrim(d->>'title'),''),'Exam'),case when d->>'kind'='online' then 'per_group' end,
    case when d->>'kind'='online' then 'one_time' end,case when d->>'kind'='paper' then 100 end,u) returning * into e;
 else
  select * into e from private.exams where id=p_exam for update;
  if e.id is null or not private.exam_staff(e.id,'author') then raise exception 'Exam denied' using errcode='42501';end if;
  if p_offering is not null and p_offering<>e.offering_id then raise exception 'An exam keeps its run' using errcode='23514';end if;
  if p_revision is distinct from e.revision then raise exception 'The exam changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  if e.status='archived' then raise exception 'Archived exams are read only' using errcode='23514';end if;
  if d ? 'kind' and d->>'kind' is distinct from e.kind then raise exception 'An exam keeps its kind' using errcode='23514';end if;
  started:=exists(select 1 from private.exam_attempts where exam_id=e.id) or exists(select 1 from private.exam_results where exam_id=e.id);
  -- Once a student started (or a paper mark exists) only the details change; the times move with Reschedule.
  if started and exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','chapterIds','coversAllChapters','heldOn')) then
   raise exception 'Students have started; only the details can change' using errcode='PT409',detail='{"reason":"started"}';end if;
 end if;
 before_:=private.exam_settings_json(e.id);
 if e.kind='paper' and exists(select 1 from jsonb_object_keys(d) k where k in ('timing','startingFrom','opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','protectAnswers','questions')) then
  raise exception 'A paper exam has a maximum mark only' using errcode='23514';end if;
 if e.kind='online' and (d ? 'maxMarks' or (d ? 'heldOn' and coalesce(jsonb_typeof(d->'heldOn'),'')<>'null')) then raise exception 'An online exam adds up its questions' using errcode='23514';end if;
 update private.exams set
  title=case when d ? 'title' then btrim(d->>'title') else title end,
  description=case when d ? 'description' then d->>'description' else description end,
  covers_all_chapters=case when d ? 'coversAllChapters' then (d->>'coversAllChapters')::boolean else covers_all_chapters end,
  held_on=case when d ? 'heldOn' then (d->>'heldOn')::date else held_on end,
  max_marks=case when d ? 'maxMarks' then (d->>'maxMarks')::integer else max_marks end,
  time_limit_minutes=case when d ? 'timeLimitMinutes' then (d->>'timeLimitMinutes')::integer else time_limit_minutes end,
  tries_mode=case when d ? 'tries' then d->>'tries' else tries_mode end,
  shuffle=case when d ? 'shuffle' then (d->>'shuffle')::boolean else shuffle end,
  photos_allowed=case when d ? 'photosAllowed' then (d->>'photosAllowed')::boolean else photos_allowed end,
  auto_release=case when d ? 'autoRelease' then (d->>'autoRelease')::boolean else auto_release end,
  protect_answers=case when d ? 'protectAnswers' then (d->>'protectAnswers')::boolean else protect_answers end
 where id=e.id returning * into e;
 if e.kind='online' and (d ? 'timing' or d ? 'startingFrom' or d ? 'opensAt' or d ? 'closesAt') then perform private.exam_apply_timing(e.id,d);end if;
 if d ? 'chapterIds' then
  if exists(select 1 from jsonb_array_elements(d->'chapterIds') x where coalesce(jsonb_typeof(x),'')<>'string' or x#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid chapters' using errcode='23514';end if;
  delete from private.exam_chapters where exam_id=e.id;
  insert into private.exam_chapters(exam_id,module_id) select distinct e.id,(x#>>'{}')::uuid from jsonb_array_elements(d->'chapterIds') x;
 end if;
 draft_:=e.status='draft';
 if d ? 'questions' then
  if jsonb_array_length(d->'questions')>100 then raise exception 'At most 100 questions' using errcode='23514';end if;
  delete from private.exam_questions where exam_id=e.id;
  for q in select x from jsonb_array_elements(d->'questions') x loop
   if coalesce(jsonb_typeof(q),'')<>'object' or exists(select 1 from jsonb_object_keys(q) k where k not in ('type','text','imageId','points','options','correct','numberValue','tolerance','responseMode','modelText','modelImageId'))
    or coalesce(q->>'type','') not in ('choice','single_choice','multiple_choice','number','essay') or (q ? 'text' and coalesce(jsonb_typeof(q->'text'),'')<>'string')
    or (q ? 'points' and (coalesce(jsonb_typeof(q->'points'),'')<>'number' or q->>'points' !~ '^\d{1,4}$')) or (q ? 'modelText' and coalesce(jsonb_typeof(q->'modelText'),'')<>'string')
    or (q ? 'responseMode' and coalesce(q->>'responseMode','') not in ('text','photo','both'))
    or exists(select 1 from unnest(array['imageId','modelImageId']) k where q ? k and coalesce(jsonb_typeof(q->k),'')<>'null' and (coalesce(jsonb_typeof(q->k),'')<>'string' or q->>k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
   then raise exception 'Invalid question %',qi+1 using errcode='23514';end if;
   img:=(q->>'imageId')::uuid;mimg:=(q->>'modelImageId')::uuid;
   -- Pictures: ready uploads of an exam of this family, for this use.
   if img is not null and not exists(select 1 from private.exam_uploads x join private.exams s on s.id=x.exam_id where x.id=img and x.purpose='question' and x.status='ready' and s.family_id=e.family_id) then
    raise exception 'Question picture unavailable' using errcode='23503';end if;
   if mimg is not null and not exists(select 1 from private.exam_uploads x join private.exams s on s.id=x.exam_id where x.id=mimg and x.purpose='model' and x.status='ready' and s.family_id=e.family_id) then
    raise exception 'Model answer picture unavailable' using errcode='23503';end if;
   qtype:=case when q->>'type' in ('choice','single_choice','multiple_choice') then 'choice' else q->>'type' end;
   insert into private.exam_questions(exam_id,position,type,text,image_id,points,response_mode)
    values(e.id,qi,case when qtype='choice' then 'single_choice' else qtype end,coalesce(q->>'text',''),img,coalesce((q->>'points')::integer,1),
     case when qtype='essay' then coalesce(q->>'responseMode','text') else 'text' end) returning id into qid;
   correct:='{}';num:=null;tolerance:=0;
   if qtype='choice' then
    -- 2 to 8 options (A to H), one or more right ones: one right answer is single choice, more is multiple choice (the type is derived).
    -- A draft may hold a choice still without options or a right answer; a published exam needs 2 to 8 options and one or more right ones.
    omin:=case when draft_ then 0 else 2 end;cmin:=case when draft_ then 0 else 1 end;
    qo:=case when draft_ and not q ? 'options' then '[]'::jsonb else q->'options' end;qc:=case when draft_ and not q ? 'correct' then '[]'::jsonb else q->'correct' end;
    if coalesce(jsonb_typeof(qo),'')<>'array' or jsonb_array_length(qo) not between omin and 8 or coalesce(jsonb_typeof(qc),'')<>'array' or jsonb_array_length(qc)<cmin
     or exists(select 1 from jsonb_array_elements(qo) x where coalesce(jsonb_typeof(x),'')<>'string')
     or exists(select 1 from jsonb_array_elements(qc) x where coalesce(jsonb_typeof(x),'')<>'number' or x#>>'{}' !~ '^\d$' or (x#>>'{}')::integer>=jsonb_array_length(qo))
     or (select count(distinct x#>>'{}') from jsonb_array_elements(qc) x)<>jsonb_array_length(qc) then raise exception 'Question %: options and right answers',qi+1 using errcode='23514';end if;
    oi:=0;ids:='{}';
    for o in select x from jsonb_array_elements(qo) x loop
     insert into private.exam_options(question_id,position,text) values(qid,oi,o#>>'{}') returning id into oid_;
     ids:=ids||oid_;oi:=oi+1;
    end loop;
    correct:=array(select ids[(x#>>'{}')::integer+1] from jsonb_array_elements(qc) x);
    update private.exam_questions set type=case when cardinality(correct)>1 then 'multiple_choice' else 'single_choice' end where id=qid;
   elsif q ? 'options' or q ? 'correct' then raise exception 'Question %: options are for choice questions',qi+1 using errcode='23514';
   end if;
   if qtype='number' then
    nt:=coalesce(jsonb_typeof(q->'numberValue'),'');
    if (nt<>'number' and not (draft_ and nt in ('','null'))) or (q ? 'tolerance' and coalesce(jsonb_typeof(q->'tolerance'),'')<>'number' and not (draft_ and jsonb_typeof(q->'tolerance')='null')) then raise exception 'Question %: the right number',qi+1 using errcode='23514';end if;
    num:=(q->>'numberValue')::numeric;tolerance:=coalesce((q->>'tolerance')::numeric,0);
   elsif q ? 'numberValue' or q ? 'tolerance' then raise exception 'Question %: a number is for number questions',qi+1 using errcode='23514';
   end if;
   if qtype<>'essay' and q ? 'responseMode' then raise exception 'Question %: photo answers are for essays',qi+1 using errcode='23514';end if;
   insert into private.exam_keys(question_id,correct_option_ids,number_value,number_tolerance,model_text,model_image_id) values(qid,correct,num,tolerance,coalesce(q->>'modelText',''),mimg);
   qi:=qi+1;
  end loop;
 end if;
 if e.status<>'draft' then perform private.exam_check(e.id);end if;
 update private.exams set revision=revision+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 perform private.exam_audit_write(e.id,case when p_exam is null then 'create' else 'save' end,null,null,case when p_exam is not null then before_ end,private.exam_settings_json(e.id));
 return jsonb_build_object('id',e.id,'revision',e.revision,'status',e.status);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 raise exception 'Invalid exam' using errcode='23514';
end $function$;

-- exam_work: deadline = start + limit (no limit: the window close); a start or retry is still refused at or after the close; a student whose
-- result is already released gets no new try, so a hand-in never changes a released result.
CREATE OR REPLACE FUNCTION private.exam_work(p_exam uuid, p_action text, p_revision bigint DEFAULT NULL::bigint, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());e private.exams;a private.exam_attempts;first_ private.exam_attempts;r private.exam_results;q private.exam_questions;
 d jsonb:=coalesce(p_data,'{}'::jsonb);w record;num integer;now_ timestamptz;deadline timestamptz;sess uuid;x private.exam_responses;up private.exam_uploads;
 opts uuid[];m jsonb;pts numeric;total numeric;waiting integer;before_ jsonb;reason_ text;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action is null or p_action not in ('start','retry','save','submit','grade','release') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown action' using errcode='23514';end if;
 if p_action in ('start','retry','save','submit') then
  select * into e from private.exams where id=p_exam for share;
  if e.id is null or e.kind<>'online' or not private.exam_taker(e.id) then raise exception 'Exam unavailable' using errcode='42501';end if;
  if e.status<>'published' then raise exception 'The exam has closed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  -- One student's writes one at a time (two tabs), then the clock.
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':'||u::text||':exam-student',0));
  perform private.exam_settle(e.id,u);
  if p_action in ('start','retry') then
   if exists(select 1 from jsonb_object_keys(d) k) then raise exception 'Invalid start' using errcode='23514';end if;
   select * into a from private.exam_attempts where exam_id=e.id and user_id=u and status='in_progress';
   if a.id is not null then return private.exam_attempt_json(a.id);end if;
   select * into first_ from private.exam_attempts where exam_id=e.id and user_id=u and number=1;
   -- A released result is final for the student: no new try can change it (and so never un-release or notify it again).
   if exists(select 1 from private.exam_results rel where rel.exam_id=e.id and rel.user_id=u and rel.released_at is not null) then
    raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
   if p_action='start' then
    if first_.id is not null then raise exception 'You have taken this exam' using errcode='PT409',detail=jsonb_build_object('reason',case when e.tries_mode='one_time' or exists(select 1 from private.exam_attempts where exam_id=e.id and user_id=u and number=2) then 'no_tries_left' else 'started' end)::text;end if;
    num:=1;
   else
    if first_.id is null then raise exception 'Start the exam first' using errcode='23514';end if;
    if e.tries_mode='one_time' or exists(select 1 from private.exam_attempts where exam_id=e.id and user_id=u and number=2) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
    num:=2;
   end if;
   select * into w from private.exam_student_window(e.id,u);
   if w.state='needs_time' then raise exception 'The exam has no time yet' using errcode='PT409',detail='{"reason":"needs_time"}';end if;
   if w.state<>'ok' then raise exception 'No window for you' using errcode='PT409',detail='{"reason":"no_window"}';end if;
   if w.group_id is not null then
    -- The linked session cannot move while the try starts (a move waits, and then keeps the opened times).
    select wx.session_id into sess from private.exam_windows(e.id) wx where wx.group_id=w.group_id and not wx.frozen and wx.source<>'custom';
    if sess is not null then perform 1 from public.group_sessions s where s.id=sess for share;select * into w from private.exam_student_window(e.id,u);end if;
   end if;
   now_:=clock_timestamp();
   if w.state<>'ok' then raise exception 'No window for you' using errcode='PT409',detail='{"reason":"no_window"}';end if;
   if now_<w.opens_at then raise exception 'The exam has not opened' using errcode='PT409',detail=jsonb_build_object('reason','not_open','opensAt',w.opens_at)::text;end if;
   if now_>=w.closes_at then raise exception 'The exam has closed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
   -- The deadline is fixed now (owner, 2026-11-17, A5-12): a start before the close gets the full time limit, even past the close; no limit is
   -- the window's end, as before.
   deadline:=case when e.time_limit_minutes is not null then now_+make_interval(mins=>e.time_limit_minutes) else w.closes_at end;
   insert into private.exam_attempts(exam_id,user_id,number,window_group_id,started_at,deadline_at) values(e.id,u,num,w.group_id,now_,deadline) returning * into a;
   if num=2 and e.tries_mode='fix_mistakes' then
    insert into private.exam_attempt_items(attempt_id,question_id,position,option_order) select a.id,i.question_id,i.position,i.option_order from private.exam_attempt_items i where i.attempt_id=first_.id;
    insert into private.exam_responses(attempt_id,question_id,option_ids,number_value,text,upload_id,kept)
     select a.id,p.question_id,case when qq.type='essay' then '{}' else p.option_ids end,case when qq.type='essay' then null else p.number_value end,
      case when qq.type='essay' then p.text else '' end,case when qq.type='essay' then p.upload_id end,qq.type<>'essay'
     from private.exam_responses p join private.exam_questions qq on qq.id=p.question_id left join private.exam_marks pm on pm.attempt_id=p.attempt_id and pm.question_id=p.question_id
     where p.attempt_id=first_.id and (qq.type='essay' or (pm.points is not null and pm.points=qq.points and pm.auto and (cardinality(p.option_ids)>0 or p.number_value is not null)));
   else
    perform private.exam_items(a.id,e.id,e.shuffle);
   end if;
   perform private.exam_audit_write(e.id,p_action,u,null,null,jsonb_build_object('attemptId',a.id,'number',num,'deadlineAt',deadline));
   return private.exam_attempt_json(a.id);
  end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','optionIds','numberValue','text','uploadId'))
   or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid answer' using errcode='23514';end if;
  select * into a from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u for update;
  if a.id is null then raise exception 'Try unavailable' using errcode='42501';end if;
  if a.status<>'in_progress' then raise exception 'This try was handed in' using errcode='PT409',detail=jsonb_build_object('reason',case when a.auto_submitted then 'deadline_passed' else 'stale' end)::text;end if;
  if p_revision is distinct from a.revision then raise exception 'The try changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  if a.deadline_at<=clock_timestamp() then raise exception 'Time is up' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  if p_action='submit' then
   if exists(select 1 from jsonb_object_keys(d) k where k<>'attemptId') then raise exception 'Invalid submit' using errcode='23514';end if;
   perform private.exam_finish(a.id,false);
   return private.exam_attempt_json(a.id);
  end if;
  -- save
  if coalesce(jsonb_typeof(d->'questionId'),'')<>'string' or d->>'questionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid answer' using errcode='23514';end if;
  select qq.* into q from private.exam_questions qq join private.exam_attempt_items i on i.question_id=qq.id where i.attempt_id=a.id and qq.id=(d->>'questionId')::uuid;
  if q.id is null then raise exception 'Question unavailable' using errcode='42501';end if;
  select * into x from private.exam_responses where attempt_id=a.id and question_id=q.id;
  if x.kept then raise exception 'This answer is kept from your first try' using errcode='23514';end if;
  if q.type in ('single_choice','multiple_choice') then
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','optionIds')) or coalesce(jsonb_typeof(d->'optionIds'),'')<>'array' or jsonb_array_length(d->'optionIds')>8
    or exists(select 1 from jsonb_array_elements(d->'optionIds') o where coalesce(jsonb_typeof(o),'')<>'string' or o#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid answer' using errcode='23514';end if;
   opts:=array(select distinct (o#>>'{}')::uuid from jsonb_array_elements(d->'optionIds') o);
   if exists(select 1 from unnest(opts) o where not exists(select 1 from private.exam_options eo where eo.id=o and eo.question_id=q.id)) or (q.type='single_choice' and cardinality(opts)>1) then raise exception 'Invalid choice' using errcode='23514';end if;
   insert into private.exam_responses(attempt_id,question_id,option_ids) values(a.id,q.id,opts) on conflict(attempt_id,question_id) do update set option_ids=excluded.option_ids,saved_at=clock_timestamp() returning * into x;
  elsif q.type='number' then
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','numberValue')) or coalesce(jsonb_typeof(d->'numberValue'),'') not in ('number','null') then raise exception 'Invalid answer' using errcode='23514';end if;
   insert into private.exam_responses(attempt_id,question_id,number_value) values(a.id,q.id,(d->>'numberValue')::numeric) on conflict(attempt_id,question_id) do update set number_value=excluded.number_value,saved_at=clock_timestamp() returning * into x;
  else
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','text','uploadId')) or (d ? 'text' and coalesce(jsonb_typeof(d->'text'),'')<>'string')
    or (d ? 'uploadId' and coalesce(jsonb_typeof(d->'uploadId'),'')<>'null' and (coalesce(jsonb_typeof(d->'uploadId'),'')<>'string' or d->>'uploadId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then raise exception 'Invalid answer' using errcode='23514';end if;
   if d ? 'text' and q.response_mode='photo' and coalesce(d->>'text','')<>'' then raise exception 'This question takes a photo' using errcode='23514';end if;
   if d->>'uploadId' is not null then
    if q.response_mode='text' or not e.photos_allowed then raise exception 'This question takes text' using errcode='23514';end if;
    -- A photo of this student for this exam: of this try, or carried from the first try.
    select * into up from private.exam_uploads where id=(d->>'uploadId')::uuid;
    if up.id is null or up.exam_id<>e.id or up.purpose<>'answer' or up.uploaded_by<>u or up.status<>'ready' or not exists(select 1 from private.exam_attempts t where t.id=up.attempt_id and t.user_id=u and t.exam_id=e.id) then
     raise exception 'Photo unavailable' using errcode='23503';end if;
   end if;
   insert into private.exam_responses(attempt_id,question_id,text,upload_id) values(a.id,q.id,coalesce(d->>'text',''),(d->>'uploadId')::uuid)
    on conflict(attempt_id,question_id) do update set text=case when d ? 'text' then excluded.text else private.exam_responses.text end,
     upload_id=case when d ? 'uploadId' then excluded.upload_id else private.exam_responses.upload_id end,saved_at=clock_timestamp() returning * into x;
  end if;
  return jsonb_build_object('attemptId',a.id,'questionId',q.id,'savedAt',x.saved_at,'revision',a.revision,'deadlineAt',a.deadline_at);
 end if;
 -- Teacher: grade, release.
 select * into e from private.exams where id=p_exam for share;
 if e.id is null or not private.exam_staff(e.id,case when p_action='grade' then 'correct' else 'release' end) then raise exception 'Correction denied' using errcode='42501';end if;
 perform private.exam_settle(e.id);
 if p_action='grade' then
  if e.kind<>'online' then raise exception 'A paper exam takes marks on the mark sheet' using errcode='23514';end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','marks','reason')) or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(jsonb_typeof(d->'marks'),'')<>'array' or jsonb_array_length(d->'marks') not between 1 and 100 or (d ? 'reason' and coalesce(jsonb_typeof(d->'reason'),'')<>'string') then raise exception 'Invalid marks' using errcode='23514';end if;
  select * into a from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id for update;
  if a.id is null then raise exception 'Correction denied' using errcode='42501';end if;
  if a.status<>'submitted' then raise exception 'The try is not handed in' using errcode='PT409',detail='{"reason":"unfinished"}';end if;
  select * into r from private.exam_results where exam_id=e.id and user_id=a.user_id for update;
  if r.final_attempt_id is distinct from a.id then raise exception 'Only the latest try is marked' using errcode='23514';end if;
  if p_revision is distinct from r.revision then raise exception 'The result changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  reason_:=nullif(btrim(coalesce(d->>'reason','')),'');
  if r.released_at is not null and reason_ is null then raise exception 'Say why a released mark changes' using errcode='23514',detail='{"reason":"reason_required"}';end if;
  before_:=to_jsonb(r)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(mm) order by mm.question_id) from private.exam_marks mm where mm.attempt_id=a.id));
  for m in select y from jsonb_array_elements(d->'marks') y loop
   if coalesce(jsonb_typeof(m),'')<>'object' or exists(select 1 from jsonb_object_keys(m) k where k not in ('questionId','points','note')) or coalesce(jsonb_typeof(m->'points'),'')<>'number'
    or (m ? 'note' and coalesce(jsonb_typeof(m->'note'),'')<>'string') or coalesce(jsonb_typeof(m->'questionId'),'')<>'string' or m->>'questionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid marks' using errcode='23514';end if;
   select qq.* into q from private.exam_questions qq join private.exam_attempt_items i on i.question_id=qq.id where i.attempt_id=a.id and qq.id=(m->>'questionId')::uuid;
   pts:=(m->>'points')::numeric;
   if q.id is null or pts<0 or pts>q.points or pts*2<>trunc(pts*2) then raise exception 'Marks are 0 to the question''s points, in halves' using errcode='23514';end if;
   insert into private.exam_marks(attempt_id,question_id,points,auto,note) values(a.id,q.id,pts,false,coalesce(m->>'note',''))
    on conflict(attempt_id,question_id) do update set points=excluded.points,auto=false,note=case when m ? 'note' then excluded.note else private.exam_marks.note end;
  end loop;
  select coalesce(sum(mm.points),0),count(*) filter(where mm.points is null) into total,waiting from private.exam_marks mm where mm.attempt_id=a.id;
  update private.exam_results set status=case when waiting=0 then 'corrected' else 'waiting' end,score=case when waiting=0 then total end,revision=revision+1,updated_by=u,updated_at=clock_timestamp()
   where id=r.id returning * into r;
  perform private.exam_audit_write(e.id,'grade',r.user_id,reason_,before_,to_jsonb(r)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(mm) order by mm.question_id) from private.exam_marks mm where mm.attempt_id=a.id)));
  return jsonb_build_object('resultId',r.id,'status',r.status,'score',r.score,'maxScore',r.max_score,'revision',r.revision,'released',r.released_at is not null);
 end if;
 -- release
 if exists(select 1 from jsonb_object_keys(d) k where k<>'resultId') or coalesce(jsonb_typeof(d->'resultId'),'')<>'string' or d->>'resultId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid release' using errcode='23514';end if;
 select * into r from private.exam_results where id=(d->>'resultId')::uuid and exam_id=e.id for update;
 if r.id is null then raise exception 'Correction denied' using errcode='42501';end if;
 if p_revision is distinct from r.revision then raise exception 'The result changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
 perform private.exam_release_check(e.id,r.id);
 update private.exam_results set released_at=clock_timestamp(),released_by=u,revision=revision+1 where id=r.id returning * into r;
 perform private.exam_audit_write(e.id,'release',r.user_id,null,null,jsonb_build_object('resultId',r.id,'score',r.score));
 return jsonb_build_object('resultId',r.id,'revision',r.revision,'releasedAt',r.released_at);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invalid answer' using errcode='23514';
end $function$;

-- exam_get: a result released by the rule (not stored yet) shows the moment the exam was over.
CREATE OR REPLACE FUNCTION private.exam_get(p_exam uuid, p_attempt uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());e private.exams;staff boolean;w record;r private.exam_results;base jsonb;released boolean;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into e from private.exams where id=p_exam;
 if e.id is null then raise exception 'Exam unavailable' using errcode='42501';end if;
 staff:=private.exam_staff(e.id);
 if not staff and not private.exam_taker(e.id) then raise exception 'Exam unavailable' using errcode='42501';end if;
 if p_attempt is not null and not exists(select 1 from private.exam_attempts a where a.id=p_attempt and a.exam_id=e.id) then raise exception 'Try unavailable' using errcode='42501';end if;
 if e.kind='online' and e.status<>'draft' then
  if staff then perform private.exam_settle(e.id);else perform private.exam_settle(e.id,u);end if;
 end if;
 select * into e from private.exams where id=p_exam;
 base:=private.exam_settings_json(e.id)||jsonb_build_object('serverNow',clock_timestamp(),'lastClose',private.exam_last_close(e.id),'closed',private.exam_closed(e.id),'reviewOpen',private.exam_review_open(e.id));
 if staff then
  base:=base||jsonb_build_object('revision',e.revision,'staff',true,
   'can',jsonb_build_object('author',private.exam_staff(e.id,'author'),'correct',private.exam_staff(e.id,'correct'),'release',private.exam_staff(e.id,'release')),
   'started',exists(select 1 from private.exam_attempts a where a.exam_id=e.id) or exists(select 1 from private.exam_results x where x.exam_id=e.id),
   'questions',coalesce((select jsonb_agg(private.exam_question_json(q.id,true) order by q.position) from private.exam_questions q where q.exam_id=e.id),'[]'::jsonb),
   'windows',coalesce((select jsonb_agg(jsonb_build_object('groupId',x.group_id,'groupName',x.group_name,'source',x.source,'sessionId',x.session_id,'opensAt',x.opens_at,'closesAt',x.closes_at,
     'state',x.state,'frozen',x.frozen) order by x.group_name,x.group_id) from private.exam_windows(e.id) x),'[]'::jsonb),
   'holds',coalesce((select jsonb_agg(jsonb_build_object('groupId',x.group_id,'groupName',x.group_name,'state',x.state) order by x.group_name,x.group_id) from private.exam_windows(e.id) x where x.state<>'ok'),'[]'::jsonb));
 else
  select * into w from private.exam_student_window(e.id,u);
  select * into r from private.exam_results where exam_id=e.id and user_id=u;
  released:=r.id is not null and private.exam_released(r.id);
  base:=base-'chapterIds'||jsonb_build_object('staff',false,'rule',e.tries_mode,'courseTitle',(select c.title from public.courses c where c.id=e.course_id),'window',case when e.kind='online' then jsonb_build_object('groupId',w.group_id,'opensAt',w.opens_at,'closesAt',w.closes_at,'state',w.state) end,
   'tries',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'number',a.number,'status',a.status,'startedAt',a.started_at,'deadlineAt',a.deadline_at,'submittedAt',a.submitted_at,
     'autoSubmitted',a.auto_submitted,'revision',a.revision) order by a.number) from private.exam_attempts a where a.exam_id=e.id and a.user_id=u),'[]'::jsonb),
   'result',case when released then jsonb_build_object('score',r.score,'maxScore',r.max_score,'absent',r.absent,'releasedAt',coalesce(r.released_at,private.exam_over_at(e.id)))
    when r.id is not null then jsonb_build_object('waiting',true) end);
 end if;
 if p_attempt is not null then base:=base||jsonb_build_object('attempt',private.exam_attempt_json(p_attempt));end if;
 return base;
end $function$;

-- exam_attempt_json: the marker's note is part of the review (decision 4): shown with a released mark only while the review is open.
CREATE OR REPLACE FUNCTION private.exam_attempt_json(p_attempt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a private.exam_attempts;staff boolean;review boolean;shown boolean;r private.exam_results;
begin
 select * into a from private.exam_attempts where id=p_attempt;
 staff:=private.exam_staff(a.exam_id);
 if a.id is null or not (staff or (a.user_id=(select private.current_app_user_id()) and private.exam_taker(a.exam_id))) then raise exception 'Try unavailable' using errcode='42501';end if;
 review:=staff or (a.status='submitted' and private.exam_review_open(a.exam_id));
 select * into r from private.exam_results where exam_id=a.exam_id and user_id=a.user_id;
 shown:=staff or (r.id is not null and private.exam_released(r.id) and (r.final_attempt_id=a.id or a.number=1));
 return jsonb_build_object('id',a.id,'userId',a.user_id,'number',a.number,'status',a.status,'startedAt',a.started_at,'deadlineAt',a.deadline_at,'submittedAt',a.submitted_at,
  'autoSubmitted',a.auto_submitted,'revision',a.revision,'groupId',a.window_group_id,'serverNow',clock_timestamp(),
  'items',coalesce((select jsonb_agg(private.exam_question_json(i.question_id,review,i.option_order)||jsonb_build_object('position',i.position,
    'answer',case when x.question_id is null then null else jsonb_build_object('optionIds',to_jsonb(x.option_ids),'numberValue',x.number_value,'text',x.text,'uploadId',x.upload_id,'kept',x.kept,'savedAt',x.saved_at) end,
    'mark',case when shown and m.question_id is not null then jsonb_build_object('points',m.points,'auto',m.auto,'note',case when review then m.note else '' end) end) order by i.position)
   from private.exam_attempt_items i left join private.exam_responses x on x.attempt_id=a.id and x.question_id=i.question_id
   left join private.exam_marks m on m.attempt_id=a.id and m.question_id=i.question_id where i.attempt_id=a.id),'[]'::jsonb));
end $function$;

-- exam_lifecycle: archive and unpublish are refused while the exam is not over (decision 3, reason students_writing); clone copies protect_answers.
CREATE OR REPLACE FUNCTION private.exam_lifecycle(p_exam uuid, p_action text, p_revision bigint, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());e private.exams;n private.exams;d jsonb:=coalesce(p_data,'{}'::jsonb);target uuid;q private.exam_questions;nq uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action is null or p_action not in ('publish','unpublish','clone','archive','reschedule') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown action' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for update;
 if e.id is null or not private.exam_staff(e.id,'author') then raise exception 'Exam denied' using errcode='42501';end if;
 if p_revision is distinct from e.revision then raise exception 'The exam changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
 if p_action='publish' then
  if e.status<>'draft' then raise exception 'Only a draft is published' using errcode='23514';end if;
  perform private.exam_check(e.id);
  if e.timing='per_group' then perform private.exam_materialize(e.id);end if;
  update private.exams set status='published',published_at=coalesce(published_at,clock_timestamp()) where id=e.id returning * into e;
  perform private.exam_link(e.id);
 elsif p_action='unpublish' then
  if e.status<>'published' then raise exception 'Only a published exam is unpublished' using errcode='23514';end if;
  if private.exam_writing(e.id) then raise exception 'Students are still writing' using errcode='PT409',detail='{"reason":"students_writing"}';end if;
  if exists(select 1 from private.exam_attempts where exam_id=e.id) or exists(select 1 from private.exam_results where exam_id=e.id) then
   raise exception 'Students have started' using errcode='PT409',detail='{"reason":"started"}';end if;
  delete from private.exam_group_windows where exam_id=e.id and source='auto';
  update private.exam_group_windows set frozen_opens_at=null,frozen_closes_at=null where exam_id=e.id;
  update private.exams set status='draft' where id=e.id returning * into e;
 elsif p_action='archive' then
  if e.status='archived' then raise exception 'Already archived' using errcode='23514';end if;
  perform private.exam_settle(e.id);
  if private.exam_writing(e.id) then raise exception 'Students are still writing' using errcode='PT409',detail='{"reason":"students_writing"}';end if;
  update private.exams set status='archived' where id=e.id returning * into e;
 elsif p_action='reschedule' then
  if e.status<>'published' or e.kind<>'online' then raise exception 'Only a published online exam is rescheduled' using errcode='23514';end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('timing','startingFrom','opensAt','closesAt'))
   or (d ? 'startingFrom' and (coalesce(jsonb_typeof(d->'startingFrom'),'')<>'string' or d->>'startingFrom' !~ '^\d{4}-\d{2}-\d{2}$')) then raise exception 'Invalid times' using errcode='23514';end if;
  perform private.exam_settle(e.id);
  perform private.exam_apply_timing(e.id,d);
  perform private.exam_check(e.id);
 else
  if d ? 'offeringId' and (coalesce(jsonb_typeof(d->'offeringId'),'')<>'string' or d->>'offeringId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Choose a run of this course' using errcode='23514';end if;
  target:=coalesce((d->>'offeringId')::uuid,e.offering_id);
  if not exists(select 1 from public.course_offerings o where o.id=target and o.course_id=e.course_id) then raise exception 'Choose a run of this course' using errcode='23514';end if;
  insert into private.exams(family_id,version,supersedes_id,course_id,offering_id,kind,title,description,max_marks,held_on,timing,starting_from,opens_at,closes_at,time_limit_minutes,
    tries_mode,shuffle,photos_allowed,auto_release,protect_answers,covers_all_chapters,created_by)
   select e.family_id,(select max(x.version)+1 from private.exams x where x.family_id=e.family_id),e.id,e.course_id,target,e.kind,e.title,e.description,e.max_marks,null,e.timing,
    case when e.timing='per_group' then e.starting_from end,null,null,e.time_limit_minutes,e.tries_mode,e.shuffle,e.photos_allowed,e.auto_release,e.protect_answers,e.covers_all_chapters,u returning * into n;
  insert into private.exam_chapters(exam_id,module_id) select n.id,c.module_id from private.exam_chapters c where c.exam_id=e.id;
  for q in select * from private.exam_questions x where x.exam_id=e.id order by x.position loop
   insert into private.exam_questions(exam_id,position,type,text,image_id,points,response_mode) values(n.id,q.position,q.type,q.text,q.image_id,q.points,q.response_mode) returning id into nq;
   insert into private.exam_options(question_id,position,text) select nq,o.position,o.text from private.exam_options o where o.question_id=q.id;
   insert into private.exam_keys(question_id,correct_option_ids,number_value,number_tolerance,model_text,model_image_id)
    select nq,array(select no.id from private.exam_options oo join private.exam_options no on no.question_id=nq and no.position=oo.position where oo.id=any(k.correct_option_ids) order by no.position),
     k.number_value,k.number_tolerance,k.model_text,k.model_image_id from private.exam_keys k where k.question_id=q.id;
  end loop;
  perform private.exam_audit_write(n.id,'clone',null,null,null,jsonb_build_object('from',e.id));
  return jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'version',n.version);
 end if;
 update private.exams set revision=revision+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 perform private.exam_audit_write(e.id,p_action,null,null,null,case when p_action='reschedule' then d end);
 return jsonb_build_object('id',e.id,'revision',e.revision,'status',e.status);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
 raise exception 'Invalid times' using errcode='23514';
end $function$;

-- exam_upload: an answer photo intent is refused once the student has upload_cap() ready unreferenced or pending answer photos in this exam.
CREATE OR REPLACE FUNCTION private.exam_upload(p_exam uuid, p_action text, p_id uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());e private.exams;f private.exam_uploads;d jsonb:=coalesce(p_data,'{}'::jsonb);purpose_ text;mime_ text;att private.exam_attempts;
 proof jsonb;owner_ text;size_ bigint;actual_mime text;new_id uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Upload denied' using errcode='42501';end if;
 if p_action is null or p_action not in ('intent','complete','get') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown upload action' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for share;
 if e.id is null then raise exception 'Upload denied' using errcode='42501';end if;
 if p_action='intent' then
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('purpose','mime','name','attemptId')) or coalesce(d->>'purpose','') not in ('question','model','answer')
   or coalesce(d->>'mime','') not in ('image/png','image/jpeg','image/webp') or (d ? 'name' and coalesce(jsonb_typeof(d->'name'),'')<>'string') then raise exception 'Unsupported upload type' using errcode='23514';end if;
  purpose_:=d->>'purpose';mime_:=d->>'mime';
  if purpose_='answer' then
   if e.kind<>'online' or not private.exam_taker(e.id) or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Upload denied' using errcode='42501';end if;
   select * into att from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u for share;
   if att.id is null then raise exception 'Upload denied' using errcode='42501';end if;
   if not e.photos_allowed then raise exception 'Photo answers are off for this exam' using errcode='23514';end if;
   if att.status<>'in_progress' or att.deadline_at<=clock_timestamp() then raise exception 'Time is up' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  else
   if not private.exam_staff(e.id,'author') or e.kind<>'online' then raise exception 'Upload denied' using errcode='42501';end if;
   if exists(select 1 from private.exam_attempts where exam_id=e.id) then raise exception 'Students have started' using errcode='PT409',detail='{"reason":"started"}';end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':'||u::text||':exam-uploads',0));
  if (select count(*) from private.exam_uploads where exam_id=e.id and uploaded_by=u and status='pending' and expires_at>clock_timestamp())>=20 then raise exception 'Finish the pending uploads first' using errcode='23514';end if;
  if purpose_='answer' and (select count(*) from private.exam_uploads x where x.exam_id=e.id and x.uploaded_by=u and x.purpose='answer'
    and ((x.status='ready' and not exists(select 1 from private.exam_responses r where r.upload_id=x.id)) or (x.status='pending' and x.expires_at>clock_timestamp())))>=private.upload_cap() then
   raise exception 'Too many photos; remove some first' using errcode='23514',detail=jsonb_build_object('reason','too_many_uploads','max',private.upload_cap())::text;end if;
  new_id:=gen_random_uuid();
  insert into private.exam_uploads(id,exam_id,uploaded_by,attempt_id,purpose,name,mime,path) values(new_id,e.id,u,att.id,purpose_,left(coalesce(d->>'name',''),255),mime_,e.id::text||'/'||new_id::text||'/file') returning * into f;
 else
  select * into f from private.exam_uploads where id=p_id for update;
  if f.id is null or not exists(select 1 from private.exams s where s.id=f.exam_id and s.family_id=e.family_id) then raise exception 'Wrong upload' using errcode='42501';end if;
  if p_action='get' then
   if f.status<>'ready' or not private.exam_upload_visible(f.id) then raise exception 'File unavailable' using errcode='42501';end if;
  else
   if f.exam_id<>e.id then raise exception 'Wrong upload' using errcode='42501';end if;
   proof:=auth.jwt()->'exam_upload';
   if f.uploaded_by<>u or proof->>'id' is distinct from f.id::text or coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from now())-90 or coalesce(proof->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(proof->>'size','') !~ '^\d{1,12}$' then raise exception 'Server byte check required' using errcode='42501';end if;
   if f.status='ready' then return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime,'status',f.status);end if;
   if not private.exam_storage('lms-exams',f.path,'insert') then raise exception 'Upload authorization expired' using errcode='42501';end if;
   select o.owner_id,(o.metadata->>'size')::bigint,o.metadata->>'mimetype' into owner_,size_,actual_mime from storage.objects o where o.bucket_id='lms-exams' and o.name=f.path;
   if size_>5242880 then raise exception 'File too large' using errcode='PT413',detail='{"maxBytes":5242880}';end if;
   if owner_ is distinct from auth.jwt()->>'sub' or size_ is null or size_<=0 or size_<>(proof->>'size')::bigint or actual_mime is distinct from f.mime then raise exception 'Invalid stored file' using errcode='23514';end if;
   update private.exam_uploads set status='ready',size_bytes=size_,sha256=proof->>'sha256' where id=f.id returning * into f;
  end if;
 end if;
 return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime,'status',f.status);
end $function$;

-- homework_work: save and hand-in of a try started before the deadline are on time until deadline + homework_grace(); created_at is written
-- from the clock the deadline is checked with. A start or retry after the deadline is refused exactly as before.
CREATE OR REPLACE FUNCTION private.homework_work(p_assignment uuid, p_action text, p_submission uuid DEFAULT NULL::uuid, p_revision bigint DEFAULT NULL::bigint, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   insert into public.homework_submissions(assignment_id,user_id,number,created_at) values(a.id,u,1,at_) returning * into s;
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
  insert into public.homework_submissions(assignment_id,user_id,number,created_at) values(a.id,u,s.number+1,at_) returning * into latest;
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
  if a.workflow='questions' and private.homework_is_late(at_,a.deadline_at,s.created_at) and (not a.late_allowed or s.number>1
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
   update public.homework_submissions set status='submitted',submitted_at=at_,missed_deadline=case when a.workflow='questions' then private.homework_is_late(at_,a.deadline_at,s.created_at) else private.homework_is_late(at_,a.deadline_at) end where id=s.id;
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
end $function$;

-- homework_upload: a photo for a draft in its grace is accepted; at most upload_cap() ready unreferenced or pending photos per student and homework.
CREATE OR REPLACE FUNCTION private.homework_upload(p_assignment uuid, p_action text, p_id uuid DEFAULT NULL::uuid, p_submission uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.homework_assignments;f private.homework_uploads;u uuid:=(select private.current_app_user_id());purpose text;mime text;ext text;size bigint;owner text;actual_mime text;proof jsonb;
begin
 select * into a from public.homework_assignments where id=p_assignment for share;
 if a.id is null or u is null or not private.is_active_user() then raise exception 'Upload denied' using errcode='42501';end if;
 if p_action='intent' then
  purpose:=p_data->>'purpose';mime:=p_data->>'mime';
  if purpose not in ('question','reference','solution','submission') or mime not in ('application/pdf','image/png','image/jpeg','image/webp','video/mp4') or (mime='video/mp4' and purpose<>'solution') or (purpose='question' and mime not in ('image/png','image/jpeg','image/webp')) then raise exception 'Unsupported upload type' using errcode='23514';end if;
  if purpose='submission' then
   perform 1 from public.enrollments e where e.offering_id=a.offering_id and e.user_id=u for share;
   perform 1 from public.homework_submissions s where s.id=p_submission and s.assignment_id=a.id and s.user_id=u and s.status='draft' for share;
   if not private.homework_enrolled(a.id) or not exists(select 1 from public.homework_submissions s where s.id=p_submission and s.assignment_id=a.id and s.user_id=u and s.status='draft') then raise exception 'Submission upload denied' using errcode='42501';end if;
   if a.workflow='questions' then
    if mime not in ('image/png','image/jpeg','image/webp') then raise exception 'Photo answers are images only' using errcode='23514';end if;
    if not a.photos_allowed then raise exception 'Photo answers are off for this homework' using errcode='23514';end if;
    if exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=u) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
    if private.homework_is_late(clock_timestamp(),a.deadline_at,(select s.created_at from public.homework_submissions s where s.id=p_submission)) and (not a.late_allowed or exists(select 1 from public.homework_submissions s where s.assignment_id=a.id and s.user_id=u and s.status='submitted')) then
     raise exception 'Deadline passed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
   end if;
  elsif not private.homework_staff(a.id,'author') or exists(select 1 from public.homework_submissions where assignment_id=a.id) then raise exception 'Author upload denied; clone started work' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text||u::text||'uploads',0));
  if (select count(*) from private.homework_uploads where assignment_id=a.id and uploaded_by=u and status='pending' and expires_at>now())>=20 then raise exception 'Finish or clean pending uploads first' using errcode='23514';end if;
  if purpose='submission' and (select count(*) from private.homework_uploads x where x.assignment_id=a.id and x.uploaded_by=u and x.purpose='submission'
    and ((x.status='ready' and not private.homework_upload_referenced(x.id)) or (x.status='pending' and x.expires_at>now())))>=private.upload_cap() then
   raise exception 'Too many photos; remove some first' using errcode='23514',detail=jsonb_build_object('reason','too_many_uploads','max',private.upload_cap())::text;end if;
  ext:=case mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else 'mp4' end;p_id:=gen_random_uuid();
  insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path) values(p_id,a.id,u,case when purpose='submission' then p_submission end,purpose,p_data->>'name',mime,a.id::text||'/'||p_id::text||'/resource.'||ext) returning * into f;
 elsif p_action='clone-tasks' then
  if not private.homework_staff(a.id,'author') or exists(select 1 from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where target.assignment_id=a.id and target.uploaded_by<>u) then raise exception 'Only the authorized clone creator can finish its copied media' using errcode='42501';end if;
  -- Retrying an owned, unfinished clone renews only its pending copy intents.
  update private.homework_uploads target set expires_at=clock_timestamp()+interval '30 minutes' where target.assignment_id=a.id and target.status='pending' and exists(select 1 from private.homework_clone_sources copy where copy.upload_id=target.id);
  return coalesce((select jsonb_agg(jsonb_build_object('id',target.id,'path',target.path,'sourcePath',source.path,'mime',target.mime)) from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id join private.homework_uploads source on source.id=copy.source_id where target.assignment_id=a.id and target.status='pending'),'[]'::jsonb);
 else
  select * into f from private.homework_uploads where id=p_id for update;
  if f.id is null or (f.assignment_id<>a.id and (p_action<>'get' or not exists(select 1 from public.homework_assignments source where source.id=f.assignment_id and source.family_id=a.family_id and source.course_id=a.course_id and source.offering_id=a.offering_id))) then raise exception 'Wrong upload' using errcode='42501';end if;
  if p_action='get' then
   if f.status<>'ready' or not private.homework_upload_visible(f.id) then raise exception 'File locked or unavailable' using errcode='42501';end if;
   if not private.homework_staff(a.id) and not (
    (f.purpose='submission' and f.assignment_id=a.id and f.uploaded_by=u and private.homework_enrolled(a.id)) or
    (f.purpose='question' and private.homework_enrolled(a.id) and exists(select 1 from public.homework_questions where assignment_id=a.id and image_id=f.id)) or
    (f.purpose='reference' and private.homework_enrolled(a.id) and exists(select 1 from private.homework_materials m where m.assignment_id=a.id and m.upload_id=f.id and m.purpose='reference')) or
    (f.purpose='solution' and private.homework_unlocked(a.id) and (exists(select 1 from private.homework_materials m where m.assignment_id=a.id and m.upload_id=f.id and m.purpose='solution') or exists(select 1 from private.homework_solutions where assignment_id=a.id and video_id=f.id)
     or exists(select 1 from private.homework_keys key_row join public.homework_questions question_row on question_row.id=key_row.question_id where question_row.assignment_id=a.id and key_row.model_image_id=f.id)))) then raise exception 'File is not available through this assignment' using errcode='42501';end if;
  elsif p_action='pending' then
   if f.uploaded_by<>u or not private.homework_storage('lms-homework',f.path,'read') then raise exception 'Pending file unavailable' using errcode='42501';end if;
  elsif p_action='archive' then
   if f.uploaded_by<>u or private.homework_upload_referenced(f.id) then raise exception 'Referenced or foreign upload cannot be cleaned' using errcode='42501';end if;
   update private.homework_uploads set status='archived' where id=f.id returning * into f;
   delete from private.homework_clone_sources where upload_id=f.id;
  elsif p_action='complete' then
   proof:=auth.jwt()->'hw_upload';
   if f.uploaded_by<>u or proof->>'id' is distinct from f.id::text or coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from now())-90 or (proof->>'sha256') is null or proof->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Server byte-verification attestation required' using errcode='42501';end if;
   if f.status='ready' then return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime);end if;
   if not private.homework_storage('lms-homework',f.path,'insert') then raise exception 'Upload authorization expired' using errcode='42501';end if;
   select o.owner_id,(o.metadata->>'size')::bigint,o.metadata->>'mimetype' into owner,size,actual_mime from storage.objects o where o.bucket_id='lms-homework' and o.name=f.path;
   if a.workflow='questions' and f.purpose='submission' and size>5242880 then raise exception 'File too large' using errcode='PT413',detail='{"maxBytes":5242880}';end if;
   if owner is distinct from auth.jwt()->>'sub' or size is null or size<=0 or size<>(proof->>'size')::bigint or actual_mime<>f.mime or size>(case when f.mime='video/mp4' then 50000000 when f.mime='application/pdf' then 20971520 else 5242880 end) then raise exception 'Invalid stored file metadata' using errcode='23514';end if;
   if f.mime<>'video/mp4' and ((proof->>'pages') is null or (proof->>'pages')::int not between 1 and 1000) then raise exception 'Verified page count missing' using errcode='23514';end if;
   update private.homework_uploads set status='ready',size_bytes=size,sha256=proof->>'sha256',pages=(proof->>'pages')::int where id=f.id returning * into f;
   delete from private.homework_clone_sources where upload_id=f.id;
  else raise exception 'Unknown upload action' using errcode='23514';end if;
 end if;
 return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime,'status',f.status);
end $function$;

-- get_homework: graceUntil (only while the caller's draft is inside its grace); triesLeft counts that draft.
CREATE OR REPLACE FUNCTION private.get_homework(p_assignment uuid, p_submission uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.homework_assignments;staff boolean;unlocked boolean;solution private.homework_solutions;result jsonb;rules jsonb;passed boolean;used integer;top integer;drafting boolean;ended boolean;stopped boolean;grace_ timestamptz;
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
 grace_:=(select a.deadline_at+private.homework_grace() from public.homework_submissions s where s.assignment_id=a.id and s.user_id=(select private.current_app_user_id()) and s.status='draft'
  and a.workflow='questions' and passed and not private.homework_is_late(clock_timestamp(),a.deadline_at,s.created_at));
 ended:=exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=(select private.current_app_user_id()));
 stopped:=exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=(select private.current_app_user_id()) and x.reason='stopped');
 if a.workflow='questions' then
  rules:=jsonb_build_object('deadline',a.deadline_at,'lateAllowed',a.late_allowed,'tries',a.tries_mode,'maxTries',a.max_tries,'solutionsOpen',a.solutions_open,'photosAllowed',a.photos_allowed);
  result:=jsonb_set(result,'{definition,rules}',rules);
 end if;
 return result||jsonb_build_object('workflow',a.workflow,'rules',rules,'deadline',a.deadline_at,'deadlinePassed',passed,'solutionsOpen',unlocked,'canManage',private.homework_staff(a.id,'manage'),
  'triesUsed',used,'triesEnded',ended and not stopped,'stopped',stopped,
  'triesLeft',case when a.workflow='questions' then case when ended then 0 when passed then case when (top is null and a.late_allowed) or grace_ is not null then 1 else 0 end else greatest(a.max_tries-coalesce(top,0)+case when drafting then 1 else 0 end,0) end end,
  'canStart',top is null and not ended and (a.workflow='legacy' or not passed or a.late_allowed),
  'canRetry',a.workflow='questions' and not ended and not passed and not drafting and used>0 and coalesce(top,0)<a.max_tries,
  'canStop',a.workflow='questions' and not staff and not ended and not passed and not drafting and used>0 and coalesce(top,0)<a.max_tries)
  ||case when grace_ is not null then jsonb_build_object('graceUntil',grace_) else '{}'::jsonb end;
end $function$;

-- report_homework (scoped): a draft started before the deadline and still inside its grace is open, not missing (A8-08).
CREATE OR REPLACE FUNCTION private.report_homework(p_offerings uuid[], p_lo timestamp with time zone, p_hi timestamp with time zone, p_groups uuid[], p_user uuid, p_active_only boolean)
 RETURNS TABLE(kind text, offering_id uuid, group_id uuid, user_id uuid, item_id uuid, title text, ref_at timestamp with time zone, state text, score numeric, maxv numeric, detail text, lesson_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
 return query select x.kind::text,x.offering_id::uuid,x.group_id::uuid,x.user_id::uuid,x.item_id::uuid,x.title::text,x.ref_at::timestamptz,x.state::text,x.score::numeric,x.maxv::numeric,x.detail::text,x.lesson_id::uuid from (
 with who as materialized (select gm.user_id from public.group_memberships gm where gm.group_id=any(p_groups)),
  hw as materialized (
   select x.* from (select distinct on (a.family_id) a.id,a.family_id,a.offering_id,a.title,a.lesson_id,a.deadline_at,coalesce(a.deadline_at,a.created_at) ref
     from public.homework_assignments a join public.lessons l on l.id=a.lesson_id and l.status='published' join public.courses c on c.id=a.course_id and c.status='published'
      left join public.lesson_segments sg on sg.id=a.segment_id
      where a.offering_id=any(p_offerings) and a.status='published' and (a.segment_id is null or sg.status='published') order by a.family_id,a.version desc) x
   where x.ref>=p_lo and x.ref<p_hi),
  -- tot (the homework's points) is worked out once per homework version here, not once per hand-in: the same expression.
  fam as materialized (select a.id,a.family_id,a.mode,a.file_points,a.uses_marks,
    case when a.mode='PLATFORM_QUESTIONS' then (select coalesce(sum(q.points),0) from public.homework_questions q where q.assignment_id=a.id) else a.file_points end tot
   from public.homework_assignments a where a.family_id in (select family_id from hw)),
  subs as materialized (
   select distinct on (f.family_id,s.user_id) f.family_id,s.user_id,s.id sub_id,f.uses_marks,c.released_at,c.score,
    f.tot
   from fam f join public.homework_submissions s on s.assignment_id=f.id and s.status='submitted'
    and (p_user is null or s.user_id=p_user) and (p_groups is null or s.user_id in (select w0.user_id from who w0))
   left join private.homework_corrections c on c.submission_id=s.id
   order by f.family_id,s.user_id,s.submitted_at desc,s.id),
  stu as materialized (
   select h.id hw_id,h.family_id,h.offering_id,h.title,h.lesson_id,h.deadline_at,h.ref,e.user_id,
    (select m.group_id from public.group_memberships m where m.offering_id=h.offering_id and m.user_id=e.user_id and m.starts_at<=h.ref and (m.ends_at is null or m.ends_at>h.ref) order by m.starts_at desc limit 1) gid
   from hw h join public.enrollments e on e.offering_id=h.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=h.ref)
   where (p_user is null or e.user_id=p_user) and (p_groups is null or e.user_id in (select w0.user_id from who w0)) and (p_active_only is not true or e.status='active'))
 select 'homework'::text,st.offering_id,st.gid,st.user_id,st.hw_id,st.title,st.ref,
  case when sb.sub_id is not null then 'done' when st.deadline_at is not null and st.deadline_at<=clock_timestamp()
   and not (clock_timestamp()<=st.deadline_at+private.homework_grace() and exists(select 1 from public.homework_submissions d join fam df on df.id=d.assignment_id
    where df.family_id=st.family_id and d.user_id=st.user_id and d.status='draft' and d.created_at<=st.deadline_at)) then 'missing' else 'open' end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.score end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.tot end,
  case when sb.released_at is not null then 'released' when sb.sub_id is not null then 'waiting' end,
  st.lesson_id
 from stu st left join subs sb on sb.family_id=st.family_id and sb.user_id=st.user_id
 where p_groups is null or st.gid=any(p_groups)
 ) x(kind,offering_id,group_id,user_id,item_id,title,ref_at,state,score,maxv,detail,lesson_id);
end $function$;

-- report_exams (scoped): a mark is shown exactly when private.exam_released says so (A8-07); released_at set is that rule's first case, kept as
-- a fast path so the function runs only for results not stored as released. exam_last_close (lc) is no longer needed here.
CREATE OR REPLACE FUNCTION private.report_exams(p_offerings uuid[], p_lo timestamp with time zone, p_hi timestamp with time zone, p_groups uuid[], p_user uuid, p_active_only boolean)
 RETURNS TABLE(kind text, offering_id uuid, group_id uuid, user_id uuid, item_id uuid, title text, ref_at timestamp with time zone, state text, score numeric, maxv numeric, detail text, lesson_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
begin
 return query select x.kind::text,x.offering_id::uuid,x.group_id::uuid,x.user_id::uuid,x.item_id::uuid,x.title::text,x.ref_at::timestamptz,x.state::text,x.score::numeric,x.maxv::numeric,x.detail::text,x.lesson_id::uuid from (
 with who as materialized (select gm.user_id from public.group_memberships gm where gm.group_id=any(p_groups)
   union select a.user_id from private.exam_attempts a where a.window_group_id=any(p_groups)),
  ex as materialized (
   select e.id,e.kind,e.timing,e.offering_id,e.title,e.auto_release,e.opens_at,e.closes_at,e.held_on,e.published_at
   from private.exams e where e.offering_id=any(p_offerings) and e.status in ('published','archived') and e.published_at is not null),
  win as materialized (
   select x.id exam_id,w.group_id wgid,w.closes_at ref from ex x cross join lateral private.exam_windows(x.id) w where x.kind='online' and x.timing='per_group' and w.state='ok'
   union all select x.id,null::uuid,x.closes_at from ex x where x.kind='online' and x.timing='same_time' and x.closes_at is not null
   union all select x.id,null::uuid,coalesce(x.held_on::timestamp at time zone 'Africa/Cairo',x.published_at) from ex x where x.kind='paper'),
  w2 as materialized (select w.exam_id,w.wgid,w.ref,x.kind,x.offering_id from win w join ex x on x.id=w.exam_id where w.ref>=p_lo and w.ref<p_hi),
  lastw as materialized (select w.exam_id,max(w.ref) ref from win w group by w.exam_id),
  res as materialized (
   select r.id rid,r.exam_id,r.user_id,r.status,r.score,r.max_score,r.absent,r.released_at,a.window_group_id wg
   from private.exam_results r left join private.exam_attempts a on a.id=r.final_attempt_id where r.exam_id in (select w3.exam_id from w2 w3 union select l3.exam_id from lastw l3 where l3.ref>=p_lo and l3.ref<p_hi)
    and (p_user is null or r.user_id=p_user) and (p_groups is null or r.user_id in (select w0.user_id from who w0))
    and (p_active_only is not true or exists(select 1 from ex x0 join public.enrollments e0 on e0.offering_id=x0.offering_id and e0.user_id=r.user_id and e0.status='active' where x0.id=r.exam_id))),
  cand as (
   select w.exam_id,w.wgid,w.ref,r.user_id,1 pr from w2 w join res r on r.exam_id=w.exam_id and (w.kind='paper' or w.wgid is null or r.wg=w.wgid)
   union all
   -- A per-Group result whose final attempt is missing, or names no window: it stays in the numbers, at the exam's last window.
   select l.exam_id,null::uuid,l.ref,r.user_id,1 from lastw l join ex x on x.id=l.exam_id and x.kind='online' and x.timing='per_group' join res r on r.exam_id=l.exam_id
    where l.ref>=p_lo and l.ref<p_hi and (r.wg is null or not exists(select 1 from win w where w.exam_id=r.exam_id and w.wgid=r.wg))
   union all
   select w.exam_id,w.wgid,w.ref,e.user_id,2 from w2 w join public.enrollments e on e.offering_id=w.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=w.ref)
   where (p_user is null or e.user_id=p_user) and (p_groups is null or e.user_id in (select w0.user_id from who w0)) and (p_active_only is not true or e.status='active')
    and not exists(select 1 from res r where r.exam_id=w.exam_id and r.user_id=e.user_id)
    and w.wgid is null
   union all
   -- The same rows for a Group's window (w.wgid set): the Group's members at the time, then their enrollment. One read per window, not one
   -- membership probe per enrolled student. distinct: a student counted twice here would still be one row after "one" below. res holds every
   -- result of this exam for a student who passes the scope (e does), so the table's (exam, student) key answers the same as res.
   select distinct w.exam_id,w.wgid,w.ref,e.user_id,2 from w2 w
    join public.group_memberships m on m.group_id=w.wgid and m.starts_at<=least(w.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(w.ref,clock_timestamp()))
    join public.enrollments e on e.offering_id=w.offering_id and e.user_id=m.user_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=w.ref)
   where (p_user is null or e.user_id=p_user) and (p_groups is null or e.user_id in (select w0.user_id from who w0)) and (p_active_only is not true or e.status='active')
    and not exists(select 1 from private.exam_results r where r.exam_id=w.exam_id and r.user_id=e.user_id)
   union all
   -- A student in no Group can take a per-Group exam between the earliest opening and the last closing (private.exam_student_window): a no-show counts as Absent after the last close.
   select l.exam_id,null::uuid,l.ref,e.user_id,3 from lastw l join ex x on x.id=l.exam_id and x.kind='online' and x.timing='per_group'
    join public.enrollments e on e.offering_id=x.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=l.ref)
   where l.ref>=p_lo and l.ref<p_hi and not exists(select 1 from res r where r.exam_id=l.exam_id and r.user_id=e.user_id)
    and (p_user is null or e.user_id=p_user) and (p_groups is null or e.user_id in (select w0.user_id from who w0)) and (p_active_only is not true or e.status='active')
    and not exists(select 1 from public.group_memberships m join public.study_groups sg on sg.id=m.group_id and sg.status='active'
     where m.offering_id=x.offering_id and m.user_id=e.user_id and m.starts_at<=least(l.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(l.ref,clock_timestamp())))),
  one as materialized (select distinct on (c.exam_id,c.user_id) c.* from cand c order by c.exam_id,c.user_id,c.pr,c.ref desc),
  st as (
   select o.exam_id,o.user_id,o.ref,x.kind,x.offering_id,x.title,r.score,r.max_score,
    coalesce(o.wgid,(select m.group_id from public.group_memberships m where m.offering_id=x.offering_id and m.user_id=o.user_id and m.starts_at<=least(o.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(o.ref,clock_timestamp())) order by m.starts_at desc limit 1)) gid,
    case when r.absent then 'absent'
     when r.rid is null then case when x.kind='online' and o.ref<=clock_timestamp()
       and not exists(select 1 from private.exam_attempts a where a.exam_id=o.exam_id and a.user_id=o.user_id and a.status='in_progress') then 'absent' else 'pending' end
     when r.status='corrected' and r.score is not null and (r.released_at is not null or private.exam_released(r.rid)) then 'marked'
     else 'waiting' end state
   from one o join ex x on x.id=o.exam_id left join res r on r.exam_id=o.exam_id and r.user_id=o.user_id)
 select 'exam'::text,s.offering_id,s.gid,s.user_id,s.exam_id,s.title,s.ref,s.state,case when s.state='marked' then s.score end,case when s.state='marked' then s.max_score end,s.kind,null::uuid
 from st s
 where p_groups is null or s.gid=any(p_groups)
 ) x(kind,offering_id,group_id,user_id,item_id,title,ref_at,state,score,maxv,detail,lesson_id);
end $function$;

-- New private helpers: callable by nobody but their owner (every caller is a definer).
do $$ declare f text; begin
 foreach f in array array['homework_grace()','upload_cap()','exam_over_at(uuid)','exam_writing(uuid)','homework_is_late(timestamptz,timestamptz,timestamptz)','homework_draft_open(uuid,uuid)'] loop
  execute format('revoke all on function private.%s from public,anon,authenticated,service_role',f);
 end loop;
end $$;

commit;
