-- Homework, the owner's rules (draft; not applied). Audit: docs/ai/HOMEWORK_DB_AUDIT.md. Migration 20261013184915 is unchanged.
--
-- Existing homework keeps working exactly as before: every existing assignment becomes workflow 'legacy' (the column default), with no
-- deadline, no tries limit, the teacher-request path for a new attempt, solutions after the student's own hand-in, up to four files per
-- essay and annotations. Nothing is back-filled and no existing row is rewritten. New homework (created by save_homework with no id) is
-- workflow 'questions': questions only, a deadline before it is published, late hand-ins only when allowed, tries, the solutions rule,
-- one photo per essay unless photos are off, and no image editing.
--
-- Also: assistant rights per course (correct, release; both on by default), Delete images of a closed homework, storage counts, the
-- teacher reads (portal, correcting queue), and demo seed version 5 (homework). The caller is always private.current_app_user_id().
-- Refusals: 42501 denied, 23514 invalid, 23503 in use, PT409 stale or closed, PT413 too large. "Deadline passed" and "No tries left"
-- are stable messages with the JSON detail {"reason":"deadline_passed"} / {"reason":"no_tries_left"}.
--
-- The owner's answers (2026-11-09): the deadline and "allow after the deadline" of a 'questions' homework can change after students
-- started (lifecycle action 'reschedule', no new version), and many corrected tries of one homework can be released in one call
-- (homework_release_many). A student whose solutions were open when the deadline changed never gets another try or hand-in, and their
-- solutions never close again (private.homework_solutions_seen).
begin;

-- ---------------------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------------------
alter table public.homework_assignments
 add column workflow text not null default 'legacy' check(workflow in ('legacy','questions')),
 add column deadline_at timestamptz,
 add column late_allowed boolean not null default false,
 add column tries_mode text check(tries_mode in ('one_time','fix_mistakes','from_zero')),
 add column max_tries integer,
 add column solutions_open text check(solutions_open in ('after_hand_in','after_deadline')),
 add column photos_allowed boolean not null default true;
-- A draft may have no deadline yet (the wizard saves Details before Rules); a published 'questions' homework always has one.
alter table public.homework_assignments add constraint homework_assignments_rules_check check(
 (workflow='legacy' and deadline_at is null and not late_allowed and tries_mode is null and max_tries is null and solutions_open is null and photos_allowed)
 or (workflow='questions' and mode='PLATFORM_QUESTIONS' and tries_mode is not null and solutions_open is not null
  and ((tries_mode='one_time' and max_tries=1) or (tries_mode<>'one_time' and max_tries between 2 and 10))
  and (status='draft' or deadline_at is not null)));
create index homework_assignments_course_status_idx on public.homework_assignments(course_id,status,deadline_at);

-- The first hand-in arrived after the deadline (only possible when late hand-ins are allowed).
alter table public.homework_submissions add column missed_deadline boolean not null default false;

-- Delete images marks the row 'deleted' (the file is removed by the server through the Storage API, never by SQL).
alter table private.homework_uploads drop constraint homework_uploads_status_check;
alter table private.homework_uploads add column deleted_at timestamptz;
alter table private.homework_uploads add constraint homework_uploads_status_check check(status in ('pending','ready','archived','deleted'));
alter table private.homework_uploads add constraint homework_uploads_deleted_check check((status='deleted')=(deleted_at is not null));

-- Assistant rights, per assistant per course. No row = both on.
create table private.homework_assistant_permissions (
 course_id uuid not null references public.courses(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 can_correct boolean not null default true,can_release boolean not null default true,
 updated_by uuid references public.profiles(id) on delete set null,updated_at timestamptz not null default now(),
 primary key(course_id,user_id)
);
create index homework_assistant_permissions_user_idx on private.homework_assistant_permissions(user_id);
create index homework_assistant_permissions_updater_idx on private.homework_assistant_permissions(updated_by) where updated_by is not null;

-- Fix mistakes: an answer that was right on the last try is carried into the next try and cannot change there.
create table private.homework_carried (
 submission_id uuid not null references public.homework_submissions(id) on delete restrict,
 question_id uuid not null references public.homework_questions(id) on delete restrict,
 source_submission_id uuid not null references public.homework_submissions(id) on delete restrict,
 primary key(submission_id,question_id)
);
create index homework_carried_question_idx on private.homework_carried(question_id);
create index homework_carried_source_idx on private.homework_carried(source_submission_id);

-- Solutions already open for a student when the deadline was changed (written by the 'reschedule' action, under the authoring lock,
-- from the rules and the deadline in force just before the change). For such a student the tries are over for good (start, retry,
-- save, submit and the photo upload refuse "No tries left"), and the solutions stay open whatever the new deadline. Never deleted
-- while the homework exists; deadline_at is the deadline that was in force.
create table private.homework_solutions_seen (
 assignment_id uuid not null references public.homework_assignments(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 opened_at timestamptz not null default now(),
 deadline_at timestamptz,
 primary key(assignment_id,user_id)
);
create index homework_solutions_seen_user_idx on private.homework_solutions_seen(user_id);
do $$ declare n text;begin
 foreach n in array array['homework_assistant_permissions','homework_carried','homework_solutions_seen'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- Internal helpers (no API role may call them)
-- ---------------------------------------------------------------------------------------
-- A hand-in exactly AT the deadline is on time.
create function private.homework_is_late(p_at timestamptz,p_deadline timestamptz) returns boolean language sql immutable security definer set search_path='' as $$
 select p_deadline is not null and p_at>p_deadline
$$;
-- The teacher's week: Saturday 00:00 to the next Saturday 00:00, Africa/Cairo wall time.
create function private.homework_week_start(p_at timestamptz) returns timestamptz language sql stable security definer set search_path='' as $$
 select ((d-((extract(dow from d)::integer+1)%7))::timestamp) at time zone 'Africa/Cairo' from (select (p_at at time zone 'Africa/Cairo')::date d) x
$$;
-- Who may set assistant rights of a course: the space's owner or admin, or the course's owner or instructor.
create function private.homework_course_manager(p_course uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.courses c where c.id=p_course and (private.has_org_role(c.organization_id,array['owner','admin'])
  or (private.is_org_member(c.organization_id) and exists(select 1 from public.course_staff s where s.course_id=c.id and s.user_id=(select private.current_app_user_id()) and s.role in ('owner','instructor')))))
$$;
-- A new version keeps its family's workflow, and a row never changes workflow.
create function private.homework_workflow_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.workflow<>old.workflow then raise exception 'Homework workflow cannot change' using errcode='23514';end if;
 if tg_op='INSERT' and new.supersedes_id is not null and new.workflow is distinct from (select p.workflow from public.homework_assignments p where p.id=new.supersedes_id) then
  raise exception 'A new version keeps its workflow' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.homework_is_late(timestamptz,timestamptz),private.homework_week_start(timestamptz),private.homework_course_manager(uuid),private.homework_workflow_guard() from public,anon,authenticated,service_role;
create trigger homework_workflow_guard before insert or update on public.homework_assignments for each row execute function private.homework_workflow_guard();

-- ---------------------------------------------------------------------------------------
-- Capabilities. 'grade' (read and see student work) is unchanged. New: 'manage' (the offering's managers), 'correct' and 'release'
-- (managers, or support staff whose right for this course is on; no row = on). Grants are kept by create or replace.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_staff(p_assignment uuid,p_capability text default 'view') returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_assignments a where a.id=p_assignment and case p_capability
 when 'author' then private.can_edit_course(a.course_id)
 when 'grade' then private.can_support_offering(a.offering_id)
 when 'manage' then private.can_manage_offering(a.offering_id)
 when 'correct' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_correct from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 when 'release' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_release from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 else private.can_edit_course(a.course_id) or private.can_support_offering(a.offering_id) end)
$$;

-- Solutions. Legacy: after the student's own hand-in (unchanged). Questions: only a student who handed in, and then
--   * 'after_deadline': once the deadline has passed (a late student sees them right after handing in);
--   * 'after_hand_in': right after the last try (one time = the first hand-in), or at the deadline, whichever comes first.
-- Storage reads of solution files use this function too (private.homework_upload_visible).
-- The rule for one student at this moment (no staff or enrollment check). Internal: the reschedule snapshot uses it for every student.
create function private.homework_solutions_rule(p_assignment uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_assignments a
  cross join lateral (select count(*) n from public.homework_submissions s where s.assignment_id=a.id and s.user_id=p_user and s.status='submitted') h
  where a.id=p_assignment and h.n>0 and (a.workflow='legacy' or private.homework_is_late(clock_timestamp(),a.deadline_at)
   or (a.solutions_open='after_hand_in' and h.n>=a.max_tries)))
$$;
revoke all on function private.homework_solutions_rule(uuid,uuid) from public,anon,authenticated,service_role;
-- A student who could see the solutions before a reschedule keeps them (homework_solutions_seen).
create or replace function private.homework_unlocked(p_assignment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.homework_staff(p_assignment) or (private.homework_enrolled(p_assignment) and (
  private.homework_solutions_rule(p_assignment,(select private.current_app_user_id()))
  or exists(select 1 from private.homework_solutions_seen x where x.assignment_id=p_assignment and x.user_id=(select private.current_app_user_id()))))
$$;

-- Storage: unchanged, plus a manager may remove the object of a student upload that Delete images marked 'deleted'.
create or replace function private.homework_storage(p_bucket text,p_path text,p_action text) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 -- Serialize physical object insertion against exact metadata archival/cleanup.
 if p_action='insert' then perform 1 from private.homework_uploads where path=p_path for share;end if;
 return (select p_bucket='lms-homework' and private.is_active_user() and exists(select 1 from private.homework_uploads u where u.path=p_path and case p_action
 when 'insert' then u.status='pending' and u.expires_at>now() and u.uploaded_by=(select private.current_app_user_id()) and
  case when u.purpose='submission' then private.homework_enrolled(u.assignment_id) and exists(select 1 from public.homework_submissions s where s.id=u.submission_id and s.user_id=u.uploaded_by and s.status='draft') else private.homework_staff(u.assignment_id,'author') end
 when 'delete' then (u.status='archived' and u.uploaded_by=(select private.current_app_user_id()) and not private.homework_upload_referenced(u.id))
  or (u.status='deleted' and u.purpose='submission' and private.homework_staff(u.assignment_id,'manage'))
 when 'read' then (u.status='ready' and private.homework_upload_visible(u.id)) or (u.status in ('pending','archived') and u.uploaded_by=(select private.current_app_user_id()) and
  ((u.status='archived' and not private.homework_upload_referenced(u.id)) or (u.status='pending' and u.expires_at>now() and private.homework_upload_visible(u.id))))
 else false end));
end $$;

-- Deleted student files are listed for the server's Storage API cleanup too.
create or replace view private.expired_homework_uploads with (security_invoker=true) as
 select id,assignment_id,uploaded_by,path,status,expires_at from private.homework_uploads u
 where (((u.status='pending' and u.expires_at<now()) or u.status='archived') and not private.homework_upload_referenced(u.id)) or u.status='deleted';

-- ---------------------------------------------------------------------------------------
-- A try as JSON: unchanged, plus missedDeadline, answers[].kept (carried from the last try) and files[].deleted.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_submission_json(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.homework_submissions;c private.homework_corrections;staff boolean;visible boolean;answer jsonb;
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
 return answer;
end $$;

-- ---------------------------------------------------------------------------------------
-- Authoring. Unchanged for legacy rows. New homework is created as 'questions' (PLATFORM_QUESTIONS, one time, solutions after hand-in,
-- photos on, no deadline yet). The optional definition key "rules" is {deadline, lateAllowed, tries, maxTries, solutionsOpen,
-- photosAllowed}; a missing key keeps the current value. The deadline is ISO 8601 with an explicit offset or Z (the screen converts
-- the teacher's Africa/Cairo time). Publishing needs a deadline. With photos off every essay is text only. A "textbook" question (all
-- option texts blank) is single choice with exactly four options, A to D.
-- ---------------------------------------------------------------------------------------
create or replace function private.save_homework(p_assignment uuid,p_offering uuid,p_lesson uuid,p_segment uuid,p_revision bigint,p_definition jsonb,p_confirm_mode_change boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.homework_assignments; o public.course_offerings; q jsonb; opt jsonb; item jsonb; n integer:=0; k integer; qid uuid; oid uuid; keys uuid[]; asset uuid; mode text;
 r jsonb; v_deadline timestamptz; v_late boolean; v_tries text; v_max integer; v_solutions text; v_photos boolean;
begin
 if not private.is_active_user() then raise exception 'Authentication required' using errcode='42501';end if;
 select * into o from public.course_offerings where id=p_offering for share;
 if o.id is null or not private.can_edit_course(o.course_id) then raise exception 'Homework authoring denied' using errcode='42501';end if;
 if p_assignment is null then
  p_assignment:=gen_random_uuid();insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,segment_id,title,mode,workflow,tries_mode,max_tries,solutions_open,created_by)
   values(p_assignment,p_assignment,o.course_id,o.id,p_lesson,p_segment,p_definition->>'title','PLATFORM_QUESTIONS','questions','one_time',1,'after_hand_in',(select private.current_app_user_id()));
 end if;
 select * into a from public.homework_assignments where id=p_assignment for update;
 if a.id is null or a.offering_id<>p_offering or a.lesson_id<>p_lesson or a.segment_id is distinct from p_segment or not private.homework_staff(a.id,'author') then raise exception 'Authoring denied' using errcode='42501';end if;
 if a.revision<>coalesce(p_revision,0) then raise exception 'Homework changed; reload' using errcode='PT409';end if;
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
   or (r ? 'solutionsOpen' and (jsonb_typeof(r->'solutionsOpen')<>'string' or r->>'solutionsOpen' not in ('after_hand_in','after_deadline')))
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
  if a.workflow='questions' then
   if q->>'type'='essay' and not v_photos and q->>'responseMode' is distinct from 'text' then raise exception 'Photo answers are off for this homework' using errcode='23514';end if;
   if q->>'type'<>'essay' and not exists(select 1 from jsonb_array_elements(q->'options') e where length(trim(coalesce(e->>'text','')))>0)
    and (q->>'type'<>'single_choice' or jsonb_array_length(q->'options')<>4) then raise exception 'A textbook question has the letters A to D and one answer' using errcode='23514';end if;
  end if;
  asset:=(q->>'imageId')::uuid;if asset is not null then perform private.homework_asset(a.id,asset,'question');end if;
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
  insert into private.homework_keys(question_id,correct_ids,model_answer) values(qid,keys,coalesce(q->>'modelAnswer',''));
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
 update public.homework_assignments set title=p_definition->>'title',instructions=coalesce(p_definition->>'instructions',''),mode=p_definition->>'mode',status=case when (p_definition->>'published')::boolean then 'published' else 'draft' end,uses_marks=(p_definition->>'usesMarks')::boolean,file_points=(p_definition->>'filePoints')::integer,
  deadline_at=v_deadline,late_allowed=v_late,tries_mode=v_tries,max_tries=v_max,solutions_open=v_solutions,photos_allowed=v_photos,revision=revision+1,updated_at=clock_timestamp() where id=a.id;
 insert into private.homework_audit(assignment_id,actor,action,before_value,after_value) values(a.id,(select private.current_app_user_id()),'definition',to_jsonb(a),p_definition);
 return a.id;
end $$;

-- ---------------------------------------------------------------------------------------
-- Student work and correction. Legacy rows: unchanged. Questions rows:
--   start  - the student's draft or latest try; otherwise try 1, refused after the deadline unless late hand-ins are allowed.
--   retry  - p_submission is the try the student just finished. Allowed before the deadline while tries are left. Fix mistakes copies
--            each right answer (a choice that matches the key; an essay with full marks in a released correction) and marks it kept.
--   save / submit - after the deadline only a FIRST hand-in, and only when late hand-ins are allowed; it is flagged missed_deadline.
--            Kept answers cannot change. One photo per essay. A finished try is locked (as before).
--   grade / annotate need 'correct', release needs 'release'. Annotate and the teacher's resubmit request are not used for them.
--   A student in private.homework_solutions_seen gets no new try and no further save or hand-in ("No tries left").
-- The time is taken once, after the locks, and the same instant is stored as submitted_at.
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
   insert into private.homework_corrections(submission_id,status,score) values(s.id,case when a.mode='PLATFORM_QUESTIONS' and not exists(select 1 from private.homework_marks where submission_id=s.id and points is null) then 'corrected' else 'under_correction' end,
    case when a.mode='PLATFORM_QUESTIONS' and not exists(select 1 from private.homework_marks where submission_id=s.id and points is null) then (select sum(m.points) from private.homework_marks m where m.submission_id=s.id) end);
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
-- The homework read: unchanged, plus workflow, rules (also inside definition, so a screen can save it back), deadline, deadlinePassed,
-- triesUsed / triesLeft / canStart / canRetry, triesEnded (the solutions were open when the deadline changed), solutionsOpen, canManage.
-- canGrade now means "may correct".
-- ---------------------------------------------------------------------------------------
create or replace function private.get_homework(p_assignment uuid,p_submission uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.homework_assignments;staff boolean;unlocked boolean;solution private.homework_solutions;result jsonb;rules jsonb;passed boolean;used integer;top integer;drafting boolean;ended boolean;
begin
 select * into a from public.homework_assignments where id=p_assignment;
 if a.id is null or not private.homework_visible(a.id) then raise exception 'Homework unavailable' using errcode='42501';end if;
 staff:=private.homework_staff(a.id);unlocked:=private.homework_unlocked(a.id);if unlocked then select * into solution from private.homework_solutions where assignment_id=a.id;end if;
 result:=jsonb_build_object('id',a.id,'offeringId',a.offering_id,'lessonId',a.lesson_id,'segmentId',a.segment_id,'revision',a.revision,'version',a.version,'locked',exists(select 1 from public.homework_submissions where assignment_id=a.id),'staff',staff,'canGrade',private.homework_staff(a.id,'correct'),'canRelease',private.homework_staff(a.id,'release'),
 'mediaCopyPending',staff and exists(select 1 from private.homework_clone_sources c join private.homework_uploads target on target.id=c.upload_id where target.assignment_id=a.id),
 'definition',jsonb_build_object('title',a.title,'instructions',a.instructions,'mode',a.mode,'published',a.status='published','usesMarks',a.uses_marks,'filePoints',a.file_points,
 'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'type',q.type,'text',q.text,'imageId',q.image_id,'points',q.points,'responseMode',q.response_mode,
 'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text) order by o.position) from public.homework_options o where o.question_id=q.id),'[]'::jsonb),
 'correctIds',case when staff then to_jsonb(k.correct_ids) else '[]'::jsonb end,'modelAnswer',case when staff then k.model_answer else '' end) order by q.position) from public.homework_questions q join private.homework_keys k on k.question_id=q.id where q.assignment_id=a.id),'[]'::jsonb),
 'modelAnswer',case when staff then solution.text else '' end,'solutionVideo',case when staff then coalesce(solution.video_url,'') else '' end,'solutionVideoId',case when staff then solution.video_id end,
 'referenceIds',coalesce((select jsonb_agg(m.upload_id) from private.homework_materials m where m.assignment_id=a.id and m.purpose='reference'),'[]'::jsonb),
 'solutionIds',case when staff then coalesce((select jsonb_agg(m.upload_id) from private.homework_materials m where m.assignment_id=a.id and m.purpose='solution'),'[]'::jsonb) else '[]'::jsonb end),
 'references',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'mime',u.mime)) from private.homework_materials m join private.homework_uploads u on u.id=m.upload_id where m.assignment_id=a.id and m.purpose='reference'),'[]'::jsonb),
 'submissions',case when p_submission is not null then jsonb_build_array(private.homework_submission_json(p_submission)) else coalesce((select jsonb_agg(private.homework_submission_json(s.id) order by s.number desc) from (select * from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id()) order by number desc limit 50) s),'[]'::jsonb) end,
 'historyHasMore',(select count(*)>50 from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id())),
 'solutions',case when unlocked then jsonb_build_object('text',coalesce(solution.text,''),'video',coalesce(solution.video_url,''),'videoId',solution.video_id,
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'mime',u.mime)) from private.homework_materials m join private.homework_uploads u on u.id=m.upload_id where m.assignment_id=a.id and m.purpose='solution'),'[]'::jsonb),
 'keys',coalesce((select jsonb_agg(jsonb_build_object('questionId',q.id,'correctIds',k.correct_ids,'modelAnswer',k.model_answer) order by q.position) from public.homework_questions q join private.homework_keys k on k.question_id=q.id where q.assignment_id=a.id),'[]'::jsonb)) end);
 if p_submission is not null and not exists(select 1 from public.homework_submissions where id=p_submission and assignment_id=a.id) then raise exception 'Submission assignment mismatch' using errcode='42501';end if;
 passed:=private.homework_is_late(clock_timestamp(),a.deadline_at);
 select count(*) filter(where status='submitted'),max(number),coalesce(bool_or(status='draft'),false) into used,top,drafting from public.homework_submissions where assignment_id=a.id and user_id=(select private.current_app_user_id());
 ended:=exists(select 1 from private.homework_solutions_seen x where x.assignment_id=a.id and x.user_id=(select private.current_app_user_id()));
 if a.workflow='questions' then
  rules:=jsonb_build_object('deadline',a.deadline_at,'lateAllowed',a.late_allowed,'tries',a.tries_mode,'maxTries',a.max_tries,'solutionsOpen',a.solutions_open,'photosAllowed',a.photos_allowed);
  result:=jsonb_set(result,'{definition,rules}',rules);
 end if;
 return result||jsonb_build_object('workflow',a.workflow,'rules',rules,'deadline',a.deadline_at,'deadlinePassed',passed,'solutionsOpen',unlocked,'canManage',private.homework_staff(a.id,'manage'),
  'triesUsed',used,'triesEnded',ended,
  'triesLeft',case when a.workflow='questions' then case when ended then 0 when passed then case when top is null and a.late_allowed then 1 else 0 end else greatest(a.max_tries-coalesce(top,0)+case when drafting then 1 else 0 end,0) end end,
  'canStart',top is null and not ended and (a.workflow='legacy' or not passed or a.late_allowed),
  'canRetry',a.workflow='questions' and not ended and not passed and not drafting and used>0 and coalesce(top,0)<a.max_tries);
end $$;

-- ---------------------------------------------------------------------------------------
-- Lifecycle: unchanged, plus publish needs a deadline (questions), a clone copies the rules, and 'reschedule'.
-- 'reschedule' (questions homework only, the 'author' capability, the revision the screen read, the same exclusive root lock as
-- authoring): p_data is {deadline, lateAllowed}, either or both. The deadline is ISO 8601 with an explicit offset or Z and must be in
-- the future, so a reschedule never opens solutions for anyone. It makes no new version, even after work started, and never rewrites
-- a stored missed_deadline. Before the change, every student whose solutions are open under the rules in force is recorded in
-- private.homework_solutions_seen: their tries are over and their solutions stay open. Audited with before and after.
-- The function gains p_data (default '{}'), so it is dropped and created again with the same grants; three-argument calls still work.
-- ---------------------------------------------------------------------------------------
drop function public.homework_lifecycle(uuid,text,bigint);
drop function private.homework_lifecycle(uuid,text,bigint);
create function private.homework_lifecycle(p_assignment uuid,p_action text,p_revision bigint,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare a public.homework_assignments;cloned_id uuid;q public.homework_questions;opt public.homework_options;qid uuid;oid uuid;ids uuid[];k private.homework_keys;source_upload private.homework_uploads;copied_id uuid;next_version integer;
 v_deadline timestamptz;v_late boolean;n integer;
begin
 if not private.is_active_user() then raise exception 'Authentication required' using errcode='42501';end if;
 select * into a from public.homework_assignments where id=p_assignment for update;
 if a.id is null or not private.homework_staff(a.id,'author') then raise exception 'Authoring denied' using errcode='42501';end if;
 if p_revision is null or a.revision<>p_revision then raise exception 'Homework changed' using errcode='PT409';end if;
 if p_action='reschedule' then
  if a.workflow<>'questions' then raise exception 'Only new homework has a deadline to change' using errcode='23514';end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or not (p_data ? 'deadline' or p_data ? 'lateAllowed')
   or exists(select 1 from jsonb_object_keys(p_data) x where x not in ('deadline','lateAllowed'))
   or (p_data ? 'deadline' and (jsonb_typeof(p_data->'deadline')<>'string' or p_data->>'deadline' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'))
   or (p_data ? 'lateAllowed' and jsonb_typeof(p_data->'lateAllowed')<>'boolean') then raise exception 'Invalid new deadline' using errcode='23514';end if;
  v_deadline:=a.deadline_at;v_late:=coalesce((p_data->>'lateAllowed')::boolean,a.late_allowed);
  if p_data ? 'deadline' then
   begin v_deadline:=(p_data->>'deadline')::timestamptz; exception when others then raise exception 'Invalid new deadline' using errcode='23514'; end;
   if v_deadline<=clock_timestamp() then raise exception 'The new deadline must be in the future' using errcode='23514';end if;
  end if;
  if v_deadline is null then raise exception 'Set a deadline' using errcode='23514';end if;
  insert into private.homework_solutions_seen(assignment_id,user_id,opened_at,deadline_at)
   select a.id,x.user_id,clock_timestamp(),a.deadline_at from (select distinct s.user_id from public.homework_submissions s where s.assignment_id=a.id and s.status='submitted') x
   where private.homework_solutions_rule(a.id,x.user_id) on conflict(assignment_id,user_id) do nothing;
  get diagnostics n=row_count;
  update public.homework_assignments set deadline_at=v_deadline,late_allowed=v_late,revision=revision+1,updated_at=clock_timestamp() where id=a.id;
  insert into private.homework_audit(assignment_id,actor,action,before_value,after_value) values(a.id,(select private.current_app_user_id()),'rescheduled',
   jsonb_build_object('deadline',a.deadline_at,'lateAllowed',a.late_allowed,'revision',a.revision),
   jsonb_build_object('deadline',v_deadline,'lateAllowed',v_late,'revision',a.revision+1,'triesEnded',n));
  return a.id;
 elsif p_action='unpublish' then update public.homework_assignments set status='draft',revision=revision+1,updated_at=clock_timestamp() where id=a.id;return a.id;
 elsif p_action='publish' then
  if a.workflow='questions' and a.deadline_at is null then raise exception 'Set a deadline before publishing' using errcode='23514';end if;
  if a.mode='PLATFORM_QUESTIONS' and (not exists(select 1 from public.homework_questions where assignment_id=a.id) or exists(select 1 from public.homework_questions question_row join private.homework_keys key_row on key_row.question_id=question_row.id where question_row.assignment_id=a.id and question_row.type<>'essay' and cardinality(key_row.correct_ids)=0)) then raise exception 'Complete question keys' using errcode='23514';end if;
  if exists(select 1 from private.homework_materials m join private.homework_uploads asset on asset.id=m.upload_id where m.assignment_id=a.id and asset.status<>'ready') or exists(select 1 from private.homework_solutions solution join private.homework_uploads asset on asset.id=solution.video_id where solution.assignment_id=a.id and asset.status<>'ready') then raise exception 'Finish cloned media before publishing' using errcode='23514';end if;
  update public.homework_assignments set status='published',revision=revision+1,updated_at=clock_timestamp() where id=a.id;return a.id;
 elsif p_action<>'clone' then raise exception 'Unknown lifecycle action' using errcode='23514';end if;
 if exists(select 1 from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where target.assignment_id=a.id) then raise exception 'Finish this version media before cloning again' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.family_id::text||'homework-version',0));
 select coalesce(max(version),0)+1 into next_version from public.homework_assignments where family_id=a.family_id;
 cloned_id:=gen_random_uuid();insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,segment_id,title,instructions,mode,status,uses_marks,file_points,version,supersedes_id,created_by,
  workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed)
 values(cloned_id,a.family_id,a.course_id,a.offering_id,a.lesson_id,a.segment_id,a.title,a.instructions,a.mode,'draft',a.uses_marks,a.file_points,next_version,a.id,(select private.current_app_user_id()),
  a.workflow,a.deadline_at,a.late_allowed,a.tries_mode,a.max_tries,a.solutions_open,a.photos_allowed);
 for q in select * from public.homework_questions where assignment_id=a.id order by position loop
  qid:=gen_random_uuid();insert into public.homework_questions values(qid,cloned_id,q.position,q.type,q.text,q.image_id,q.points,q.response_mode);
  select * into k from private.homework_keys where question_id=q.id;ids:='{}';
  for opt in select * from public.homework_options where question_id=q.id order by position loop
   oid:=gen_random_uuid();insert into public.homework_options values(oid,qid,opt.position,opt.text);if opt.id=any(k.correct_ids) then ids:=array_append(ids,oid);end if;
  end loop;insert into private.homework_keys values(qid,ids,k.model_answer);
 end loop;
 -- Solution objects receive new private paths per version: a prior submission
 -- cannot authorize signing the new version's files via the Storage API.
 for source_upload in select asset.* from private.homework_uploads asset where asset.id in
 (select m.upload_id from private.homework_materials m where m.assignment_id=a.id and m.purpose='solution'
 union select solution.video_id from private.homework_solutions solution where solution.assignment_id=a.id and solution.video_id is not null) loop
  if source_upload.status<>'ready' then raise exception 'Finish original solution uploads before cloning' using errcode='23514';end if;
  copied_id:=gen_random_uuid();insert into private.homework_uploads(id,assignment_id,uploaded_by,purpose,name,mime,path)
  values(copied_id,cloned_id,(select private.current_app_user_id()),'solution',source_upload.name,source_upload.mime,cloned_id::text||'/'||copied_id::text||'/'||split_part(source_upload.path,'/',3));
  insert into private.homework_clone_sources(upload_id,source_id) values(copied_id,source_upload.id);
 end loop;
 insert into private.homework_solutions select cloned_id,solution.text,solution.video_url,(select copy.upload_id from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where copy.source_id=solution.video_id and target.assignment_id=cloned_id) from private.homework_solutions solution where solution.assignment_id=a.id;
 insert into private.homework_materials(assignment_id,upload_id,purpose) select cloned_id,case when m.purpose='reference' then m.upload_id else (select copy.upload_id from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where copy.source_id=m.upload_id and target.assignment_id=cloned_id) end,m.purpose from private.homework_materials m where m.assignment_id=a.id;
 insert into private.homework_audit(assignment_id,actor,action,before_value) values(cloned_id,(select private.current_app_user_id()),'cloned',to_jsonb(a));return cloned_id;
end $$;
revoke all on function private.homework_lifecycle(uuid,text,bigint,jsonb) from public,anon;
grant execute on function private.homework_lifecycle(uuid,text,bigint,jsonb) to authenticated;
create function public.homework_lifecycle(p_assignment uuid,p_action text,p_revision bigint,p_data jsonb default '{}') returns uuid language sql security invoker set search_path='' as $$select private.homework_lifecycle(p_assignment,p_action,p_revision,p_data)$$;
revoke all on function public.homework_lifecycle(uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.homework_lifecycle(uuid,text,bigint,jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Uploads: unchanged, plus for a 'questions' student photo: images only, refused when photos are off or after the deadline (unless it
-- is a late first hand-in that is allowed), and PT413 above 5 MB.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_upload(p_assignment uuid,p_action text,p_id uuid default null,p_submission uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
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
    if private.homework_is_late(clock_timestamp(),a.deadline_at) and (not a.late_allowed or exists(select 1 from public.homework_submissions s where s.assignment_id=a.id and s.user_id=u and s.status='submitted')) then
     raise exception 'Deadline passed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
   end if;
  elsif not private.homework_staff(a.id,'author') or exists(select 1 from public.homework_submissions where assignment_id=a.id) then raise exception 'Author upload denied; clone started work' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text||u::text||'uploads',0));
  if (select count(*) from private.homework_uploads where assignment_id=a.id and uploaded_by=u and status='pending' and expires_at>now())>=20 then raise exception 'Finish or clean pending uploads first' using errcode='23514';end if;
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
    (f.purpose='solution' and private.homework_unlocked(a.id) and (exists(select 1 from private.homework_materials m where m.assignment_id=a.id and m.upload_id=f.id and m.purpose='solution') or exists(select 1 from private.homework_solutions where assignment_id=a.id and video_id=f.id)))) then raise exception 'File is not available through this assignment' using errcode='42501';end if;
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
end $$;

-- ---------------------------------------------------------------------------------------
-- Delete images of a closed homework: the offering's managers only, after the deadline only, never an exam (an exam id is simply not
-- a homework). Student photo uploads of handed-in tries become 'deleted'; grades, marks, notes and answers stay. Audited. Returns the
-- bytes freed and the paths the server then removes through the Storage API (SQL never deletes a storage object).
-- ---------------------------------------------------------------------------------------
create function private.homework_delete_images(p_assignment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.homework_assignments;u uuid:=(select private.current_app_user_id());at_ timestamptz;files integer;bytes bigint;paths jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.homework_assignments where id=p_assignment for update;
 if a.id is null or not private.homework_staff(a.id,'manage') then raise exception 'Homework unavailable' using errcode='42501';end if;
 at_:=clock_timestamp();
 if not private.homework_is_late(at_,a.deadline_at) then raise exception 'Homework is still open' using errcode='PT409',detail='{"reason":"still_open"}';end if;
 with gone as (update private.homework_uploads x set status='deleted',deleted_at=at_ where x.assignment_id=a.id and x.purpose='submission' and x.status='ready'
   and exists(select 1 from public.homework_submissions s where s.id=x.submission_id and s.status='submitted') returning x.path,x.size_bytes)
 select count(*),coalesce(sum(size_bytes),0),coalesce(jsonb_agg(path order by path),'[]'::jsonb) into files,bytes,paths from gone;
 insert into private.homework_audit(assignment_id,actor,action,after_value) values(a.id,u,'images_deleted',jsonb_build_object('deletedFiles',files,'bytesFreed',bytes,'at',at_));
 return jsonb_build_object('deletedFiles',files,'bytesFreed',bytes,'paths',paths);
end $$;

-- Storage per space and per homework (ready files only), for the space's owner and admins.
create function private.homework_storage_usage(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.has_org_role(p_space,array['owner','admin']) then raise exception 'Storage usage denied' using errcode='42501';end if;
 return (with h as materialized (select a.id,a.title,a.course_id,a.version from public.homework_assignments a join public.courses c on c.id=a.course_id where c.organization_id=p_space),
  f as materialized (select x.assignment_id,x.purpose,x.size_bytes from private.homework_uploads x where x.assignment_id in (select id from h) and x.status='ready'),
  per as materialized (select h.id,h.title,h.course_id,h.version,
    coalesce(sum(f.size_bytes) filter(where f.purpose='submission'),0) student_bytes,count(f.assignment_id) filter(where f.purpose='submission') student_files,
    coalesce(sum(f.size_bytes) filter(where f.purpose<>'submission'),0) teacher_bytes,count(f.assignment_id) filter(where f.purpose<>'submission') teacher_files
   from h left join f on f.assignment_id=h.id group by h.id,h.title,h.course_id,h.version)
  select jsonb_build_object('studentBytes',coalesce(sum(student_bytes),0),'studentFiles',coalesce(sum(student_files),0),'teacherBytes',coalesce(sum(teacher_bytes),0),'teacherFiles',coalesce(sum(teacher_files),0),
   'homeworkCount',count(*),
   'homework',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'courseId',p.course_id,'version',p.version,'studentBytes',p.student_bytes,'studentFiles',p.student_files,'teacherBytes',p.teacher_bytes,'teacherFiles',p.teacher_files) order by p.student_bytes+p.teacher_bytes desc,p.id)
    from (select * from per where student_files+teacher_files>0 order by student_bytes+teacher_bytes desc,id limit 100) p),'[]'::jsonb)) from per);
end $$;

-- Assistant rights of a course: read (the course's managers).
create function private.homework_assistants(p_course uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.homework_course_manager(p_course) then raise exception 'Assistant rights denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',p.display_name,'canCorrect',coalesce(r.can_correct,true),'canRelease',coalesce(r.can_release,true),'updatedAt',r.updated_at) order by p.display_name nulls last,x.user_id)
  from (select distinct s.user_id from public.offering_staff s join public.course_offerings o on o.id=s.offering_id where o.course_id=p_course and s.role<>'instructor') x
  join public.profiles p on p.id=x.user_id left join private.homework_assistant_permissions r on r.course_id=p_course and r.user_id=x.user_id),'[]'::jsonb);
end $$;

-- Assistant rights of a course: set. p_updated_at is what the screen read (null when it read the defaults); anything else is PT409.
create function private.set_homework_assistant(p_course uuid,p_user uuid,p_can_correct boolean,p_can_release boolean,p_updated_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());cur private.homework_assistant_permissions;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_course::text||'homework-assistants',0));
 if not private.homework_course_manager(p_course) then raise exception 'Assistant rights denied' using errcode='42501';end if;
 if p_can_correct is null or p_can_release is null then raise exception 'Both rights are required' using errcode='23514';end if;
 if not exists(select 1 from public.offering_staff s join public.course_offerings o on o.id=s.offering_id where o.course_id=p_course and s.user_id=p_user and s.role<>'instructor') then raise exception 'Not an assistant of this course' using errcode='23514';end if;
 select * into cur from private.homework_assistant_permissions where course_id=p_course and user_id=p_user for update;
 if cur.updated_at is distinct from p_updated_at then raise exception 'Assistant rights changed; reload' using errcode='PT409';end if;
 insert into private.homework_assistant_permissions(course_id,user_id,can_correct,can_release,updated_by,updated_at) values(p_course,p_user,p_can_correct,p_can_release,u,clock_timestamp())
 on conflict(course_id,user_id) do update set can_correct=excluded.can_correct,can_release=excluded.can_release,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into cur;
 return jsonb_build_object('userId',cur.user_id,'canCorrect',cur.can_correct,'canRelease',cur.can_release,'updatedAt',cur.updated_at);
end $$;

-- ---------------------------------------------------------------------------------------
-- Teacher reads. Candidates come from the caller's ACTIVE memberships only (as in 20261106120000_listing_performance.sql): courses of
-- those spaces, each decided once by private.can_edit_course, and their offerings, each decided once by private.can_support_offering.
-- Nothing is authorized per row over the whole database, and each view is one call. Numbers that come from student work (hand-ins,
-- late, waiting, image bytes) are given only for offerings the caller supports; a course editor who is not support staff gets null.
-- "Waiting" = essay marks still empty on a student's latest handed-in try (+1 for a legacy file homework still under correction).
-- A homework version is listed when it is its family's newest version or students have handed work in it.
-- ---------------------------------------------------------------------------------------
create function private.homework_portal(p_course uuid default null,p_tab text default 'open',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  roster as materialized (select e.offering_id,count(distinct e.user_id) n from public.enrollments e where e.offering_id=any(sups) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_) group by e.offering_id),
  subs as materialized (select s.id,s.assignment_id,s.user_id,s.number,s.submitted_at,s.missed_deadline from public.homework_submissions s where s.assignment_id in (select id from h where counted) and s.status='submitted'),
  latest as materialized (select distinct on (s.assignment_id,s.user_id) s.id,s.assignment_id,s.user_id from subs s order by s.assignment_id,s.user_id,s.number desc),
  empties as materialized (select m.submission_id,count(*) n from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id in (select id from latest) and m.points is null and q.type='essay' group by m.submission_id),
  files_waiting as materialized (select c.submission_id from private.homework_corrections c join latest l on l.id=c.submission_id join h on h.id=l.assignment_id where h.mode='FILE_UPLOAD' and c.status='under_correction'),
  waiting as materialized (select l.assignment_id,sum(coalesce(e.n,0)+case when w.submission_id is null then 0 else 1 end) n from latest l left join empties e on e.submission_id=l.id left join files_waiting w on w.submission_id=l.id group by l.assignment_id),
  handed as materialized (select assignment_id,count(*) n from latest group by assignment_id),
  late as materialized (select assignment_id,count(distinct user_id) n from subs where missed_deadline group by assignment_id),
  bytes as materialized (select x.assignment_id,sum(x.size_bytes) n from private.homework_uploads x where x.assignment_id in (select id from h where counted and tab='closed') and x.purpose='submission' and x.status='ready' group by x.assignment_id),
  listed as materialized (select h.id,h.tab,h.deadline_at,h.updated_at,h.title,(coalesce(w.n,0)) waiting_n,h.counted,
   jsonb_build_object('id',h.id,'title',h.title,'courseId',h.course_id,'courseTitle',c.title,'offeringId',h.offering_id,'lessonId',h.lesson_id,'lessonTitle',l.title,'version',h.version,
    'workflow',h.workflow,'mode',h.mode,'status',h.status,'deadline',h.deadline_at,'lateAllowed',h.late_allowed,'tries',h.tries_mode,'maxTries',h.max_tries,'solutionsOpen',h.solutions_open,'photosAllowed',h.photos_allowed,'updatedAt',h.updated_at,
    'handedIn',case when h.counted then coalesce(hd.n,0) end,'total',case when h.counted then coalesce(r.n,0) end,'late',case when h.counted then coalesce(lt.n,0) end,
    'waiting',case when h.counted then coalesce(w.n,0) end,'imageBytes',case when h.counted and h.tab='closed' then coalesce(b.n,0) end) j
   from h join public.courses c on c.id=h.course_id join public.lessons l on l.id=h.lesson_id
   left join roster r on r.offering_id=h.offering_id left join handed hd on hd.assignment_id=h.id left join late lt on lt.assignment_id=h.id left join waiting w on w.assignment_id=h.id left join bytes b on b.assignment_id=h.id)
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

-- The correcting queue of one homework: To correct / Done / Missing, by each student's latest handed-in try. Support staff of the offering.
-- readyToRelease and releasable (at most 500 {submissionId, revision}, by submission id) feed 'Release 12 grades' without another read.
create function private.homework_queue(p_assignment uuid,p_tab text default 'to_correct',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.homework_assignments;at_ timestamptz:=clock_timestamp();result jsonb;
begin
 if private.current_app_user_id() is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.homework_assignments where id=p_assignment;
 if a.id is null or not private.homework_staff(a.id,'grade') then raise exception 'Homework unavailable' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('to_correct','done','missing') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 with roster as materialized (select distinct e.user_id from public.enrollments e where e.offering_id=a.offering_id and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_)),
  latest as materialized (select distinct on (s.user_id) s.id,s.user_id,s.number,s.submitted_at from public.homework_submissions s where s.assignment_id=a.id and s.status='submitted' order by s.user_id,s.number desc),
  late as materialized (select distinct s.user_id from public.homework_submissions s where s.assignment_id=a.id and s.missed_deadline),
  empties as materialized (select m.submission_id,count(*) n from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id in (select id from latest) and m.points is null and q.type='essay' group by m.submission_id),
  done as materialized (select l.*,p.display_name,c.status,c.released_at is not null as released,c.score,c.revision,lt.user_id is not null as is_late,
    coalesce(e.n,0)+case when a.mode='FILE_UPLOAD' and c.status='under_correction' then 1 else 0 end as waiting
   from latest l join private.homework_corrections c on c.submission_id=l.id join public.profiles p on p.id=l.user_id left join empties e on e.submission_id=l.id left join late lt on lt.user_id=l.user_id),
  missing as materialized (select r.user_id,p.display_name from roster r join public.profiles p on p.id=r.user_id where not exists(select 1 from latest l where l.user_id=r.user_id)),
  -- Ready to release together: a latest try whose correction is finished and not released (what homework_release_many accepts).
  ready as materialized (select d.id,d.revision from done d where d.status='corrected' and not d.released and d.waiting=0 and (not a.uses_marks or d.score is not null)
   and not exists(select 1 from private.homework_marks m where m.submission_id=d.id and m.points is null))
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',50,'serverNow',at_,
  'readyToRelease',(select count(*) from ready),
  'releasable',coalesce((select jsonb_agg(jsonb_build_object('submissionId',x.id,'revision',x.revision) order by x.id) from (select * from ready order by id limit 500) x),'[]'::jsonb),
  'homework',jsonb_build_object('id',a.id,'title',a.title,'courseId',a.course_id,'offeringId',a.offering_id,'lessonId',a.lesson_id,'version',a.version,'workflow',a.workflow,'mode',a.mode,'status',a.status,
   'deadline',a.deadline_at,'lateAllowed',a.late_allowed,'tries',a.tries_mode,'maxTries',a.max_tries,'solutionsOpen',a.solutions_open,'photosAllowed',a.photos_allowed,
   'canCorrect',private.homework_staff(a.id,'correct'),'canRelease',private.homework_staff(a.id,'release')),
  'counts',jsonb_build_object('toCorrect',(select count(*) from done where waiting>0),'done',(select count(*) from done where waiting=0),'missing',(select count(*) from missing),
   'handedIn',(select count(*) from done),'total',(select count(*) from roster),'late',(select count(*) from done where is_late)),
  'rows',case when p_tab='missing' then coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',x.display_name) order by x.display_name nulls last,x.user_id)
    from (select * from missing order by display_name nulls last,user_id limit 50 offset p_page*50) x),'[]'::jsonb)
   else coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',x.display_name,'submissionId',x.id,'try',x.number,'submittedAt',x.submitted_at,'late',x.is_late,'waiting',x.waiting,
     'status',x.status,'released',x.released,'score',x.score,'revision',x.revision) order by x.o)
    from (select d.*,row_number() over(order by case when p_tab='to_correct' then d.submitted_at end,d.display_name nulls last,d.user_id) o from done d where (d.waiting>0)=(p_tab='to_correct') order by o limit 50 offset p_page*50) x),'[]'::jsonb) end) into result;
 return result;
end $$;

-- Release many corrected tries of ONE homework, all or nothing. p_items is the [{submissionId, revision}] the screen read: 1 to 500
-- items, no duplicates. Every item passes the checks of a single release (the 'release' capability, a handed-in try of this homework,
-- the correction finished) and must not be released yet: re-releasing an edited correction stays a single release with its reason.
-- Released as 'approved' (the resubmit request is never part of it). Any stale revision (PT409) or failed check refuses the whole call
-- and nothing is released. Locks: the homework shared (as student work and single corrections), then the tries and then their
-- corrections, each in submission id order, so it cannot deadlock with a grade, a single release or another bulk release.
-- One audit row per released try. Returns the released count and each try's new correction revision.
create function private.homework_release_many(p_assignment uuid,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.homework_assignments;u uuid:=(select private.current_app_user_id());ids uuid[];c private.homework_corrections;want bigint;n integer:=0;out_ jsonb:='[]'::jsonb;previous jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Choose the grades to release' using errcode='23514';end if;
 if jsonb_array_length(p_items)>500 then raise exception 'At most 500 grades at once' using errcode='23514',detail='{"max":500}';end if;
 if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in ('submissionId','revision'))
   or jsonb_typeof(e->'submissionId')<>'string' or e->>'submissionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(e->'revision')<>'number' or e->>'revision' !~ '^\d{1,15}$') then raise exception 'Invalid grade list' using errcode='23514';end if;
 ids:=array(select (e->>'submissionId')::uuid from jsonb_array_elements(p_items) e);
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'A grade is listed twice' using errcode='23514';end if;
 select * into a from public.homework_assignments where id=p_assignment for share;
 if a.id is null or not private.homework_staff(a.id,'release') then raise exception 'Correction denied' using errcode='42501';end if;
 perform 1 from public.homework_submissions s where s.id=any(ids) order by s.id for update;
 if (select count(*) from public.homework_submissions s where s.id=any(ids) and s.assignment_id=a.id and s.status='submitted')<>cardinality(ids) then raise exception 'Correction denied' using errcode='42501';end if;
 perform 1 from private.homework_corrections x where x.submission_id=any(ids) order by x.submission_id for update;
 if (select count(*) from private.homework_corrections x where x.submission_id=any(ids))<>cardinality(ids) then raise exception 'Finish correction before release' using errcode='23514';end if;
 -- Every check first; nothing is written until all pass.
 for c in select * from private.homework_corrections x where x.submission_id=any(ids) order by x.submission_id loop
  want:=(select (e->>'revision')::bigint from jsonb_array_elements(p_items) e where (e->>'submissionId')::uuid=c.submission_id);
  if c.revision<>want then raise exception 'Correction changed; reload' using errcode='PT409',detail=jsonb_build_object('reason','stale','submissionId',c.submission_id)::text;end if;
  if c.released_at is not null then raise exception 'Only corrected grades that are not released yet can be released together' using errcode='23514',detail=jsonb_build_object('reason','already_released','submissionId',c.submission_id)::text;end if;
  if c.status<>'corrected' or (a.uses_marks and c.score is null) or exists(select 1 from private.homework_marks m where m.submission_id=c.submission_id and m.points is null) then
   raise exception 'Finish correction before release' using errcode='23514',detail=jsonb_build_object('reason','unfinished','submissionId',c.submission_id)::text;end if;
 end loop;
 for c in select * from private.homework_corrections x where x.submission_id=any(ids) order by x.submission_id loop
  previous:=to_jsonb(c)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(m)) from private.homework_marks m where m.submission_id=c.submission_id));
  update private.homework_corrections set status='approved',released_at=clock_timestamp(),released_by=u,revision=revision+1 where submission_id=c.submission_id returning * into c;
  insert into private.homework_audit(assignment_id,submission_id,actor,action,reason,before_value,after_value) values(a.id,c.submission_id,u,'release','bulk release',previous,
   to_jsonb(c)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(m)) from private.homework_marks m where m.submission_id=c.submission_id)));
  n:=n+1;out_:=out_||jsonb_build_array(jsonb_build_object('submissionId',c.submission_id,'revision',c.revision));
 end loop;
 return jsonb_build_object('released',n,'items',out_);
end $$;

-- Grants: the private definers to authenticated (the public wrappers run as the caller), never to public or anon.
do $$ declare f text;begin
 foreach f in array array['homework_delete_images(uuid)','homework_storage_usage(uuid)','homework_assistants(uuid)','set_homework_assistant(uuid,uuid,boolean,boolean,timestamptz)','homework_portal(uuid,text,integer)','homework_queue(uuid,text,integer)','homework_release_many(uuid,jsonb)'] loop
  execute format('revoke all on function private.%s from public,anon',f);
  execute format('grant execute on function private.%s to authenticated',f);
 end loop;
end $$;
create function public.homework_delete_images(p_assignment uuid) returns jsonb language sql security invoker set search_path='' as $$select private.homework_delete_images(p_assignment)$$;
create function public.homework_storage_usage(p_space uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.homework_storage_usage(p_space)$$;
create function public.homework_assistants(p_course uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.homework_assistants(p_course)$$;
create function public.set_homework_assistant(p_course uuid,p_user uuid,p_can_correct boolean,p_can_release boolean,p_updated_at timestamptz) returns jsonb language sql security invoker set search_path='' as $$select private.set_homework_assistant(p_course,p_user,p_can_correct,p_can_release,p_updated_at)$$;
create function public.homework_portal(p_course uuid default null,p_tab text default 'open',p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.homework_portal(p_course,p_tab,p_page)$$;
create function public.homework_queue(p_assignment uuid,p_tab text default 'to_correct',p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.homework_queue(p_assignment,p_tab,p_page)$$;
create function public.homework_release_many(p_assignment uuid,p_items jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.homework_release_many(p_assignment,p_items)$$;
do $$ declare f text;begin
 foreach f in array array['homework_delete_images(uuid)','homework_storage_usage(uuid)','homework_assistants(uuid)','set_homework_assistant(uuid,uuid,boolean,boolean,timestamptz)','homework_portal(uuid,text,integer)','homework_queue(uuid,text,integer)','homework_release_many(uuid,jsonb)'] loop
  execute format('revoke all on function public.%s from public,anon',f);
  execute format('grant execute on function public.%s to authenticated',f);
 end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- Demo seed version 5: homework. Registry: the homework tables may be recorded (homework_carried has a composite key and is removed with
-- its submissions). No real file: the photos are upload rows (1 to 2 MB) that point at NO storage object, so the bytes, the image
-- counts and Delete images can be tried; opening such a photo shows it as unavailable.
-- ---------------------------------------------------------------------------------------
alter table private.demo_seed_rows drop constraint demo_seed_rows_table_name_check;
alter table private.demo_seed_rows add constraint demo_seed_rows_table_name_check check (table_name in
 ('courses','course_modules','lessons','course_offerings','study_groups','group_staff','group_sessions','profiles','enrollments','group_memberships',
  'homework_assignments','homework_questions','homework_options','homework_keys','homework_solutions','homework_submissions','homework_responses',
  'homework_marks','homework_corrections','homework_uploads','homework_submission_files'));

-- One demo homework with three questions: a textbook question (blank A to D, B is right), a choice question, and an essay (text and photo).
-- Returns {homework, q1, q2, q3, right1, wrong1, right2, wrong2}.
create function private.demo_homework_make(p_org uuid,p_owner uuid,p_course uuid,p_offering uuid,p_lesson uuid,p_title text,p_status text,p_deadline timestamptz,p_late boolean,p_tries text,p_max integer,p_solutions text) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare hw uuid:=gen_random_uuid(); q1 uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); q3 uuid:=gen_random_uuid(); o uuid; i integer; ids uuid[]:='{}';
begin
 insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,instructions,mode,status,uses_marks,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,photos_allowed,revision,created_by)
  values(hw,hw,p_course,p_offering,p_lesson,p_title,'Demo homework. Answer every question, then hand in.','PLATFORM_QUESTIONS',p_status,true,'questions',p_deadline,p_late,p_tries,p_max,p_solutions,true,1,p_owner);
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

-- One demo try. p_state: draft, waiting (essay not corrected), corrected (not released), released. p_variant decides which choices are right.
create function private.demo_homework_try(p_org uuid,p_owner uuid,p_hw uuid[],p_user uuid,p_number integer,p_at timestamptz,p_late boolean,p_state text,p_variant integer,p_photo boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s uuid; x uuid; right1 boolean:=p_variant%3<>0; right2 boolean:=p_variant%2=0; essay numeric; up uuid;
begin
 insert into public.homework_submissions(assignment_id,user_id,number,status,revision,submitted_at,missed_deadline,created_at,updated_at)
  values(p_hw[1],p_user,p_number,case when p_state='draft' then 'draft' else 'submitted' end,2,case when p_state<>'draft' then p_at end,p_late,p_at-interval '25 minutes',p_at) returning id into s;
 perform private.demo_track(p_org,'homework','homework_submissions',s);
 insert into public.homework_responses(submission_id,question_id,response) values(s,p_hw[2],jsonb_build_object('optionIds',jsonb_build_array(case when right1 then p_hw[5] else p_hw[6] end),'text','')) returning id into x;
 perform private.demo_track(p_org,'homework','homework_responses',x);
 insert into public.homework_responses(submission_id,question_id,response) values(s,p_hw[3],jsonb_build_object('optionIds',jsonb_build_array(case when right2 then p_hw[7] else p_hw[8] end),'text','')) returning id into x;
 perform private.demo_track(p_org,'homework','homework_responses',x);
 insert into public.homework_responses(submission_id,question_id,response) values(s,p_hw[4],jsonb_build_object('optionIds','[]'::jsonb,'text','Demo answer: R = V / I, so R = 12 / 3 = 4 ohms.')) returning id into x;
 perform private.demo_track(p_org,'homework','homework_responses',x);
 if p_photo then
  up:=gen_random_uuid();
  insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path,status,size_bytes,sha256,pages,expires_at,created_at)
   values(up,p_hw[1],p_user,s,'submission','Demo photo '||p_variant||'.jpg','image/jpeg',p_hw[1]::text||'/'||up::text||'/resource.jpg','ready',1000000+(p_variant*104729)%1000000,md5(up::text)||md5(s::text),1,p_at,p_at-interval '20 minutes');
  perform private.demo_track(p_org,'homework','homework_uploads',up);
  insert into public.homework_submission_files(submission_id,question_id,upload_id) values(s,p_hw[4],up) returning id into x;
  perform private.demo_track(p_org,'homework','homework_submission_files',x);
 end if;
 if p_state='draft' then return s; end if;
 essay:=case when p_state='waiting' then null else 2+p_variant%5 end;
 insert into private.homework_marks(submission_id,question_id,points,feedback) values(s,p_hw[2],case when right1 then 2 else 0 end,'') returning id into x;
 perform private.demo_track(p_org,'homework','homework_marks',x);
 insert into private.homework_marks(submission_id,question_id,points,feedback) values(s,p_hw[3],case when right2 then 2 else 0 end,'') returning id into x;
 perform private.demo_track(p_org,'homework','homework_marks',x);
 insert into private.homework_marks(submission_id,question_id,points,feedback) values(s,p_hw[4],essay,case when essay is null then '' else 'Demo feedback: check your units.' end) returning id into x;
 perform private.demo_track(p_org,'homework','homework_marks',x);
 -- A released correction notifies the demo student (the existing trigger); Clear removes those notifications with the demo students.
 insert into private.homework_corrections(submission_id,status,score,feedback,revision,corrected_by,corrected_at,released_at,released_by)
  values(s,case when p_state='waiting' then 'under_correction' else 'corrected' end,
   case when essay is null then null else essay+case when right1 then 2 else 0 end+case when right2 then 2 else 0 end end,
   case when essay is null then '' else 'Demo feedback.' end,case when p_state='waiting' then 0 else 1 end,
   case when essay is not null then p_owner end,case when essay is not null then least(p_at+interval '1 day',now()) end,
   case when p_state='released' then least(p_at+interval '2 days',now()) end,case when p_state='released' then p_owner end);
 perform private.demo_track(p_org,'homework','homework_corrections',s);
 return s;
end $$;
revoke all on function private.demo_homework_make(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,boolean,text,integer,text),private.demo_homework_try(uuid,uuid,uuid[],uuid,integer,timestamptz,boolean,text,integer,boolean) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------
-- Fill, seed version 5 = version 4 plus the homework module. Same signature and grants. Lines that are not about homework are copied from
-- version 4 (20261106130000), with the lesson and student ids now kept in two arrays.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamptz; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 groups_ uuid[]; fin_ uuid[] := '{}'; dra_ uuid[] := '{}'; g uuid; gi integer; n integer; sn integer := 0; st timestamptz; dur interval;
 pid uuid; eid uuid; mid uuid; a_status text; a_marked boolean; les_pub uuid; ev uuid; k integer; titles_ text[];
 n_courses integer := 0; n_lessons integer := 0; n_groups integer := 0; n_sessions integer := 0; n_students integer := 0;
 les_ uuid[] := '{}'; studs_ uuid[] := '{}'; hw_ uuid[]; hw_at timestamptz; dl timestamptz; sub_ uuid; nxt uuid; hw_row uuid; st_ text;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;
 if exists(select 1 from private.demo_spaces where organization_id=p_org and filled_at is not null) then
  raise exception 'Demo data is already present. Clear it first.' using errcode='PT409'; end if;
 select user_id into v_owner from public.organization_memberships
  where organization_id=p_org and role='owner' and status='active' order by joined_at nulls last limit 1;
 if v_owner is null then raise exception 'The teacher has not accepted the invitation yet' using errcode='PT409'; end if;
 if private.space_has_real_students(p_org) then
  raise exception 'A space with enrolled students cannot receive demo data' using errcode='PT409'; end if;
 v_day := date_trunc('day', now() at time zone 'Africa/Cairo');

 -- Courses: A (published) and B (draft). Seed version 4: A has the board's tree, three chapters with 3, 2 and 0 lessons, the first lesson of a chapter published and
 -- the others draft; B has no chapters, so the empty Content section can be tried. The type and the number come from the trigger, like a chapter a teacher adds.
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Physics, Third Secondary','demo-physics','published','private',v_owner) returning id into crs_a;
 perform private.demo_track(p_org,'courses','courses',crs_a);
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Chemistry, Second Secondary','demo-chemistry','draft','private',v_owner) returning id into crs_b;
 perform private.demo_track(p_org,'courses','courses',crs_b);
 n_courses := 2;
 for i in 0..2 loop
  insert into public.course_modules(course_id,title,position)
   values(crs_a,(array['Electric current','Magnetism','Electromagnetic induction'])[i+1],i) returning id into mod_id;
  perform private.demo_track(p_org,'courses','course_modules',mod_id);
  titles_ := case i when 0 then array['Ohm''s law','Resistors in series and parallel','Kirchhoff''s laws'] when 1 then array['Magnetic field of a wire','Force on a wire'] else '{}'::text[] end;
  for j in 1..cardinality(titles_) loop
   insert into public.lessons(module_id,title,position,status) values(mod_id,titles_[j],j-1,case when j=1 then 'published' else 'draft' end) returning id into s;
   perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1; les_ := les_||s;
   if les_pub is null and j=1 then les_pub := s; end if;
  end loop;
 end loop;
 insert into public.course_offerings(course_id,name,delivery_mode,status)
  values(crs_a,'Demo offering','blended','active') returning id into off_id;
 perform private.demo_track(p_org,'courses','course_offerings',off_id);

 -- Groups with upcoming sessions (Cairo wall time): one at a centre, one online; one session is cancelled.
 insert into public.study_groups(offering_id,name,mode,location,created_by)
  values(off_id,'Demo Group 1','center','Demo centre, room 1',v_owner) returning id into g1;
 perform private.demo_track(p_org,'groups','study_groups',g1);
 insert into public.study_groups(offering_id,name,mode,created_by)
  values(off_id,'Demo Group 2','online',v_owner) returning id into g2;
 perform private.demo_track(p_org,'groups','study_groups',g2);
 n_groups := 2; groups_ := array[g1,g2];
 insert into public.group_staff(group_id,user_id) values(g1,v_owner),(g2,v_owner);
 perform private.demo_track(p_org,'groups','group_staff',g1);
 perform private.demo_track(p_org,'groups','group_staff',g2);
 for i in 1..3 loop
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by,cancelled,cancellation_reason)
   select g1,'Demo session '||i,t,t+interval '90 minutes',t,t+interval '90 minutes','center','Demo centre, room 1',v_owner,v_owner,(i=2),case when i=2 then 'Demo cancellation' else '' end
   from (select ((v_day + make_interval(days => i*2+1) + interval '18 hours') at time zone 'Africa/Cairo') as t) x returning id into s;
  perform private.demo_track(p_org,'groups','group_sessions',s); n_sessions := n_sessions+1;
 end loop;
 for i in 1..2 loop
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
   select g2,'Demo session '||i,t,t+interval '60 minutes',t,t+interval '60 minutes','online','',v_owner,v_owner
   from (select ((v_day + make_interval(days => i*3) + interval '20 hours') at time zone 'Africa/Cairo') as t) x returning id into s;
  perform private.demo_track(p_org,'groups','group_sessions',s); n_sessions := n_sessions+1;
 end loop;

 -- Seed version 2, attendance: per Group one finalized and one draft past Session. Their list of students is saved (roster_at) with the
 -- students below, so Take attendance opens them as they are.
 for gi in 1..2 loop
  g := groups_[gi]; dur := case when gi=1 then interval '90 minutes' else interval '60 minutes' end;
  for j in 1..2 loop
   st := ((v_day - make_interval(days => case when j=1 then 9-gi+1 else 3-gi end) + case when gi=1 then interval '18 hours' else interval '20 hours' end) at time zone 'Africa/Cairo');
   insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by,attendance_state,roster_at)
    values(g,'Demo earlier session '||j,st,st+dur,st,st+dur,case when gi=1 then 'center' else 'online' end,case when gi=1 then 'Demo centre, room 1' else '' end,
     v_owner,v_owner,case when j=1 then 'finalized' else 'draft' end,st+dur) returning id into s;
   perform private.demo_track(p_org,'attendance','group_sessions',s); n_sessions := n_sessions+1;
   if j=1 then fin_ := fin_||s; else dra_ := dra_||s; end if;
  end loop;
 end loop;

 -- Seed version 2, students: 14 per Group, named plainly, enrolled in the one offering, members of their Group, with attendance on the
 -- two past Sessions. Finalized: every student marked (every fourth absent). Draft: the first eight marked, the rest not marked yet.
 for gi in 1..2 loop
  g := groups_[gi];
  for n in 1..14 loop
   sn := sn+1;
   insert into public.profiles(id,display_name) values(gen_random_uuid(),'Demo Student '||sn) returning id into pid;
   perform private.demo_track(p_org,'students','profiles',pid); studs_ := studs_||pid;
   insert into public.enrollments(offering_id,user_id,status,enrolled_at,source,created_by)
    values(off_id,pid,'active',now()-interval '60 days','demo',v_owner) returning id into eid;
   perform private.demo_track(p_org,'students','enrollments',eid);
   insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
    values(g,off_id,pid,eid,now()-interval '60 days',v_owner) returning id into mid;
   perform private.demo_track(p_org,'students','group_memberships',mid);
   n_students := n_students+1;
   a_status := case when n%4=0 then 'absent' else 'attended' end;
   insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by) values(fin_[gi],pid,mid,a_status,v_owner);
   a_marked := n<=8;
   insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by)
    values(dra_[gi],pid,mid,case when a_marked then a_status else 'not_marked' end,case when a_marked then v_owner end);
  end loop;
 end loop;

 -- Seed version 3, notifications: five real notifications for the teacher, one per event type that can reach a teacher's Home. They are
 -- inserted directly (not through private.emit_notification), so no push delivery is ever queued for a demo notification. Every event key
 -- starts with 'demo:<org id>:', which is what Clear already removes. The newest four are unread (Home lists unread ones); the oldest is read.
 -- Not seeded: session_details and session_starting. They are only "current" for a student who is a member of the Group, never for staff.
 for k in 1..5 loop
  insert into private.notification_events(event_key,event_type,organization_id,resource_id)
   values('demo:'||p_org::text||':notification:'||k::text,
    (array['account_approved','lesson_published','support_reply','exam_released','homework_released'])[k],p_org,
    case k when 1 then p_org when 2 then les_pub when 3 then g1 else g2 end) returning id into ev;
  insert into public.notifications(event_id,recipient_id,event_type,in_app,created_at,read_at)
   values(ev,v_owner,(array['account_approved','lesson_published','support_reply','exam_released','homework_released'])[k],true,
    now()-make_interval(hours => k*5),case when k=5 then now()-interval '1 hour' end);
 end loop;

 -- Seed version 5, homework, in the published Physics course (the whole course gets it). Every state the board shows:
 --   1. Kirchhoff's laws (draft lesson): a draft.
 --   2. Ohm's law: open, deadline in 4 days, late allowed, fix mistakes with 2 tries, solutions after the deadline. Students 1-10 handed
 --      in: 1-5 waiting, 6-8 corrected and not released, 9 released and now on try 2 (a draft with one kept answer), 10 handed in try 2.
 --   3. Ohm's law: closed 3 days ago, late allowed, one time, solutions after hand-in. Students 1-26 handed in (25 and 26 late), 27 and
 --      28 missing: 1-9 waiting, 10-21 corrected and not released, 22-26 released.
 --   4. Magnetic field of a wire: closed 10 days ago, from zero with 2 tries, solutions after the deadline. Students 1-20, all released,
 --      each with one photo (an upload row with no file).
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[3],'Kirchhoff''s laws practice','draft',((v_day+interval '7 days'+interval '20 hours') at time zone 'Africa/Cairo'),false,'from_zero',3,'after_deadline');
 dl := ((v_day+interval '4 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[1],'Ohm''s law: practice set','published',dl,true,'fix_mistakes',2,'after_deadline');
 for i in 1..10 loop
  st_ := case when i<=5 then 'waiting' when i<=8 then 'corrected' else 'released' end;
  hw_at := now()-make_interval(hours => 2+i*3);
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,false,case when i=10 then 'corrected' else st_ end,case when i=9 then 1 else i end,false);
  if i=9 then
   -- Try 2 started: the right textbook answer is kept and cannot change.
   insert into public.homework_submissions(assignment_id,user_id,number,status,revision,created_at,updated_at)
    values(hw_[1],studs_[i],2,'draft',1,now()-interval '30 minutes',now()-interval '30 minutes') returning id into nxt;
   perform private.demo_track(p_org,'homework','homework_submissions',nxt);
   insert into public.homework_responses(submission_id,question_id,response) select nxt,r.question_id,r.response from public.homework_responses r where r.submission_id=sub_ and r.question_id=hw_[2] returning id into hw_row;
   perform private.demo_track(p_org,'homework','homework_responses',hw_row);
   insert into private.homework_carried(submission_id,question_id,source_submission_id) values(nxt,hw_[2],sub_);
  elsif i=10 then
   nxt := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],2,now()-interval '1 hour',false,'waiting',2,false);
  end if;
 end loop;
 dl := ((v_day-interval '3 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[1],'Ohm''s law: textbook page 34','published',dl,true,'one_time',1,'after_hand_in');
 for i in 1..26 loop
  st_ := case when i<=9 then 'waiting' when i<=21 then 'corrected' else 'released' end;
  hw_at := case when i>=25 then dl+make_interval(hours => i-23) else dl-make_interval(hours => 2+i*2) end;
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,i>=25,st_,i,false);
 end loop;
 dl := ((v_day-interval '10 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[4],'Magnetic field of a wire','published',dl,false,'from_zero',2,'after_deadline');
 for i in 1..20 loop
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,dl-make_interval(hours => 3+i*2),false,'released',i,true);
 end loop;

 update private.demo_spaces set seed_version=5,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',5,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5,'homework',4));
 return jsonb_build_object('seedVersion',5,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'homework',4);
end $$;

-- ---------------------------------------------------------------------------------------
-- Clear: as 20261104120000, except homework. The blocker "homework" is replaced by two that name what a REAL person or a real file is:
--   * "homework from real people": a try by anyone who is not a recorded demo student;
--   * "homework files": a stored object under a homework of the space (SQL never deletes storage objects).
-- Otherwise the homework of the space's courses and offerings is removed (the seeded rows and what the teacher added there), before the
-- profiles, offerings and courses it references. Every line that is not about homework is copied unchanged.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 courses_ uuid[]; offerings_ uuid[]; groups_ uuid[]; sessions_ uuid[]; events_ uuid[]; lessons_ uuid[]; profiles_ uuid[]; enrollments_ uuid[]; blockers_ text[] := '{}';
 n_tracked integer := 0; n_added integer := 0; n_support integer := 0; cnt integer;
 added jsonb := '{}'::jsonb; hws_ uuid[]; subs_ uuid[]; n_hw integer := 0;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;

 select coalesce(array_agg(row_id) filter (where table_name='courses'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='profiles'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='enrollments'),'{}')
  into courses_,profiles_,enrollments_ from private.demo_seed_rows where organization_id=p_org;
 if exists(select 1 from public.courses where id=any(courses_) and organization_id<>p_org) then
  raise exception 'Demo records do not match this space' using errcode='PT409'; end if;
 select coalesce(array_agg(distinct o.id),'{}') into offerings_ from public.course_offerings o
  where o.course_id=any(courses_)
     or o.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='course_offerings');
 select coalesce(array_agg(distinct g.id),'{}') into groups_ from public.study_groups g
  where g.offering_id=any(offerings_)
     or g.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='study_groups');
 select coalesce(array_agg(s.id),'{}') into sessions_ from public.group_sessions s where s.group_id=any(groups_);
 select coalesce(array_agg(l.id),'{}') into lessons_ from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=any(courses_);
 select coalesce(array_agg(h.id),'{}') into hws_ from public.homework_assignments h where h.course_id=any(courses_) or h.offering_id=any(offerings_);
 select coalesce(array_agg(s.id),'{}') into subs_ from public.homework_submissions s where s.assignment_id=any(hws_);

 -- A real student (any enrollment that is not recorded as a demo enrollment), and content this function does not remove. Refuse, naming it.
 if private.space_has_real_students(p_org) then blockers_ := array_append(blockers_,'enrolled students'::text); end if;
 if exists(select 1 from public.homework_submissions where id=any(subs_) and not (user_id=any(profiles_))) then blockers_ := array_append(blockers_,'homework from real people'::text); end if;
 if exists(select 1 from storage.objects o where o.bucket_id='lms-homework' and split_part(o.name,'/',1)=any(array(select x::text from unnest(hws_) x))) then blockers_ := array_append(blockers_,'homework files'::text); end if;
 if exists(select 1 from public.assessments where course_id=any(courses_)) or exists(select 1 from public.offering_assessments where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'exams'::text); end if;
 if exists(select 1 from public.media_assets where offering_id=any(offerings_)) or exists(select 1 from private.lesson_upload_scopes where course_id=any(courses_)) then blockers_ := array_append(blockers_,'media'::text); end if;
 if exists(select 1 from public.lesson_segments where lesson_id=any(lessons_)) then blockers_ := array_append(blockers_,'lesson segments'::text); end if;
 if exists(select 1 from public.lesson_progress where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'student progress'::text); end if;
 if exists(select 1 from public.website_catalog_entries where course_id=any(courses_)) or exists(select 1 from private.website_publication_courses where course_id=any(courses_)) then blockers_ := array_append(blockers_,'website courses'::text); end if;
 -- The Students screen: a teacher's own use (a join link, a suspension) is removed below. What a REAL person did is never touched: Clear stops and says so.
 if exists(select 1 from public.enrollment_requests where offering_id=any(offerings_) and not (user_id=any(profiles_)))
   or exists(select 1 from private.student_access_links where offering_id=any(offerings_)
     and ((recipient_id is not null and not (recipient_id=any(profiles_))) or (claimed_by is not null and not (claimed_by=any(profiles_))))) then
  blockers_ := array_append(blockers_,'join requests or invitations from real people'::text); end if;
 if exists(select 1 from private.student_admin_audit where offering_id=any(offerings_) and subject_id is not null and not (subject_id=any(profiles_))) then
  blockers_ := array_append(blockers_,'student administration records of real people'::text); end if;
 if cardinality(blockers_)>0 then
  raise exception 'This demo space holds content that Clear does not remove: %. Remove it first.',array_to_string(blockers_,', ') using errcode='PT409'; end if;

 -- Notifications that belong to the Groups, Sessions and demo students (by event key prefix, session, group, enrollment or recipient).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id=any(sessions_) or resource_id=any(groups_) or resource_id=any(sessions_) or resource_id=any(enrollments_)
     or resource_id=any(subs_)
     or id in (select event_id from public.notifications where recipient_id=any(profiles_));
 delete from private.notification_deliveries where notification_id in (select id from public.notifications where event_id=any(events_) or recipient_id=any(profiles_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.notifications where event_id=any(events_) or recipient_id=any(profiles_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.notification_events where id=any(events_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_notification_state where group_id=any(groups_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_audit where group_id=any(groups_) or session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.session_attendance where session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;

 -- Homework of the space's courses and offerings, in foreign-key order: correction rows, tries and their answers, the homework's own rows
 -- and upload rows, then the versions, newest first (a version is removed once nothing supersedes it).
 delete from private.homework_annotations where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_marks where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_corrections where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_carried where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_solutions_seen where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.homework_responses where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_submission_files where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_audit where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_clone_sources where upload_id in (select id from private.homework_uploads where assignment_id=any(hws_)) or source_id in (select id from private.homework_uploads where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_materials where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_solutions where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 -- Keys and options first (they would also go by ON DELETE CASCADE), so every removed row is counted.
 delete from private.homework_keys where question_id in (select id from public.homework_questions where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_options where question_id in (select id from public.homework_questions where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_questions where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_uploads where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_submissions where id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 loop
  delete from public.homework_assignments h where h.id=any(hws_) and not exists(select 1 from public.homework_assignments c where c.supersedes_id=h.id or (c.family_id=h.id and c.id<>h.id));
  get diagnostics cnt = row_count; n_hw := n_hw+cnt;
  exit when cnt=0;
 end loop;
 n_added := n_added+n_hw; added := added||jsonb_build_object('homework',n_hw);

 -- What the teacher's own use of the Students screen left behind in this space, found by the space's recorded offerings only:
 -- join links (the teacher's, or for a demo student), requests of demo students, and the student-administration audit rows about demo students
 -- or about no student at all (links). Real people's rows were refused above, so none of these is a real person's. The audit table is not
 -- append-only in the database; removing these rows is recorded in the platform audit row written at the end (removedByTable).
 delete from private.student_access_links where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('student_access_links',cnt);
 delete from public.enrollment_requests where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollment_requests',cnt);
 delete from private.student_admin_audit where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_support := n_support+cnt; added := added||jsonb_build_object('student_admin_audit',cnt);

 -- Everything that hangs off the Groups, recorded or added by the teacher.
 delete from public.group_sessions where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_sessions',cnt);
 delete from public.group_schedules where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_schedules',cnt);
 delete from public.group_memberships where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_memberships',cnt);
 delete from public.group_staff where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_staff',cnt);
 delete from public.study_groups where id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('study_groups',cnt);
 -- The demo students: enrollments (the per-enrollment administration version goes by ON DELETE CASCADE), then the fake profiles.
 delete from public.enrollments where id=any(enrollments_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollments',cnt);
 delete from public.profiles where id=any(profiles_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('profiles',cnt);
 -- Course-level rows that block the course itself.
 delete from public.course_stage_assignments where course_id=any(courses_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_stage_assignments',cnt);
 delete from private.course_stage_versions where course_id=any(courses_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.course_offerings where id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_offerings',cnt);
 -- The recorded courses. Chapters, lessons and lesson blocks (recorded or added by the teacher), course staff and offering staff are removed
 -- by the existing ON DELETE CASCADE chain (courses -> course_modules -> lessons -> lesson_blocks). Chapters and lessons are counted first; lesson blocks and
 -- course/offering staff rows (a trigger adds the course owner) cascade and are not counted.
 select count(*) into cnt from public.course_modules where course_id=any(courses_);
 n_tracked := cnt+cardinality(lessons_); added := added||jsonb_build_object('course_modules',cnt,'lessons',cardinality(lessons_));
 delete from public.courses where id=any(courses_);
 get diagnostics cnt = row_count; n_tracked := n_tracked+cnt; added := added||jsonb_build_object('courses',cnt);
 delete from private.demo_seed_rows where organization_id=p_org;
 update private.demo_spaces set seed_version=null,filled_at=null where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.clear','organization',p_org,p_org,
  jsonb_build_object('rows',n_tracked+n_added,'removedRows',n_tracked+n_added,'removedSupportRows',n_support,'removedByTable',added,
   'removedCourseTree',n_tracked));
 return jsonb_build_object('removedRows',n_tracked+n_added,'removedSupportRows',n_support);
end $$;

-- ---------------------------------------------------------------------------------------
-- Status: the latest seed version is now 5.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',5) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',5));
end $$;

commit;
