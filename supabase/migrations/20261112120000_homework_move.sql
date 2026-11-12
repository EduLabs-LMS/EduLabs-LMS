-- Homework: move before any student starts, question counts on the page, the relaxed choice rule, and a model answer picture per
-- question (draft; not applied). Migrations up to 20261110120000 are unchanged; the functions below are replaced whole.
--
-- 1. Move. save_homework may now change a homework's lesson and/or its course run (offering, and with it the course) when no student
--    has a try of any status AND it is the only version of its family (it supersedes nothing and nothing supersedes it). Otherwise the
--    move is refused: PT409 "Work has started; this homework stays in its lesson" {"reason":"started"} or PT409 "A later version stays in
--    its lesson" {"reason":"versioned"}. The caller must be able to edit BOTH courses (the target offering's course before any lock, the
--    homework's own course through homework_staff 'author'). Both offerings are locked FOR SHARE in id order, then the homework FOR
--    UPDATE, the order a student's start takes them in (the homework FOR SHARE); a start and a move therefore serialize, and whichever
--    comes second sees the other. The move is audited ('moved', before and after course, offering and lesson). homework_integrity still
--    checks that the lesson belongs to the course and the offering to the course; it now lets course, offering and lesson change only for
--    a homework without tries and without other versions (for every writer, the database owner included). The segment, the family, the
--    version and supersedes still never change.
-- 2. homework_portal rows (and the To correct rows) gain questionCount and totalMarks, read only for the homework already listed.
-- 3. A choice question may have blank answer texts with any number of answers from 2 to 8 and one or more right answers: the rule "A
--    textbook question has the letters A to D and one answer" is gone. Kept: 2 to 8 options, a right answer before publishing, no
--    duplicate key, single choice has one right answer.
-- 4. private.homework_keys.model_image_id: an optional picture beside a question's model answer. It is a 'solution' upload of this
--    homework, an image (PNG, JPEG or WebP; the 5 MB image limit of the upload flow applies). Students see it, the Storage object
--    included, only while the solutions are open for them (private.homework_unlocked, which includes private.homework_solutions_seen).
--    A clone copies it to a new private path like the other solution media.
-- The caller is always private.current_app_user_id(). No grant changes: every function keeps its grants (restated below).
begin;

-- ---------------------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------------------
alter table private.homework_keys add column model_image_id uuid references private.homework_uploads(id) on delete restrict;
create index homework_keys_model_image_idx on private.homework_keys(model_image_id) where model_image_id is not null;

-- ---------------------------------------------------------------------------------------
-- Integrity: unchanged, except that course, offering and lesson may change while the homework has no try and no other version.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_integrity() returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.homework_assignments;
begin
 if not exists(select 1 from public.course_offerings o join public.lessons l on l.id=new.lesson_id join public.course_modules m on m.id=l.module_id
 where o.id=new.offering_id and o.course_id=new.course_id and m.course_id=new.course_id) or
 (new.segment_id is not null and not exists(select 1 from public.lesson_segments s where s.id=new.segment_id and s.lesson_id=new.lesson_id)) then raise exception 'Homework curriculum/offering mismatch' using errcode='23514';end if;
 if new.supersedes_id is null then if new.family_id<>new.id or new.version<>1 then raise exception 'Invalid initial version' using errcode='23514';end if;
 else select * into parent from public.homework_assignments where id=new.supersedes_id;
  if parent.id is null or parent.family_id<>new.family_id or parent.course_id<>new.course_id or parent.offering_id<>new.offering_id or parent.lesson_id<>new.lesson_id or parent.segment_id is distinct from new.segment_id or new.version<=parent.version then raise exception 'Invalid homework version lineage' using errcode='23514';end if;
 end if;
 if tg_op='UPDATE' and (new.segment_id is distinct from old.segment_id or new.family_id<>old.family_id or new.supersedes_id is distinct from old.supersedes_id or new.version<>old.version) then raise exception 'Homework cannot be reparented' using errcode='23514';end if;
 if tg_op='UPDATE' and (new.course_id<>old.course_id or new.offering_id<>old.offering_id or new.lesson_id<>old.lesson_id)
  and (exists(select 1 from public.homework_submissions s where s.assignment_id=old.id) or exists(select 1 from public.homework_assignments v where v.family_id=old.family_id and v.id<>old.id)) then
  raise exception 'Homework cannot be reparented' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.homework_integrity() from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- Upload visibility and references: unchanged, plus a question's model answer picture (a 'solution' upload) for a student whose
-- solutions are open, and the picture counts as referenced (it cannot be archived or cleaned while a key uses it).
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_upload_visible(p_upload uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.homework_uploads u where u.id=p_upload and private.is_active_user() and
 ((u.purpose<>'submission' and private.homework_staff(u.assignment_id)) or
 (u.purpose='submission' and private.homework_staff(u.assignment_id,'grade') and exists(select 1 from public.homework_submissions s where s.id=u.submission_id and s.status='submitted')) or
 (u.purpose='submission' and u.uploaded_by=(select private.current_app_user_id()) and private.homework_enrolled(u.assignment_id)) or
 (u.status='ready' and u.purpose='question' and exists(select 1 from public.homework_questions q where q.image_id=u.id and private.homework_enrolled(q.assignment_id))) or
 (u.status='ready' and u.purpose='reference' and exists(select 1 from private.homework_materials m where m.upload_id=u.id and m.purpose='reference' and private.homework_enrolled(m.assignment_id))) or
 (u.status='ready' and u.purpose='solution' and (exists(select 1 from private.homework_materials m where m.upload_id=u.id and m.purpose='solution' and private.homework_unlocked(m.assignment_id)) or exists(select 1 from private.homework_solutions s where s.video_id=u.id and private.homework_unlocked(s.assignment_id))
  or exists(select 1 from private.homework_keys k join public.homework_questions q on q.id=k.question_id where k.model_image_id=u.id and private.homework_unlocked(q.assignment_id))))))
$$;
create or replace function private.homework_upload_referenced(p_upload uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.homework_questions where image_id=p_upload) or exists(select 1 from private.homework_solutions where video_id=p_upload)
 or exists(select 1 from private.homework_materials where upload_id=p_upload) or exists(select 1 from public.homework_submission_files where upload_id=p_upload)
 or exists(select 1 from private.homework_annotations where upload_id=p_upload) or exists(select 1 from private.homework_keys where model_image_id=p_upload)
 or exists(select 1 from private.homework_clone_sources c join private.homework_uploads target on target.id=c.upload_id where c.source_id=p_upload and target.status='pending')
$$;
revoke all on function private.homework_upload_visible(uuid),private.homework_upload_referenced(uuid) from public,anon,authenticated;
grant execute on function private.homework_upload_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Authoring (20261109120000), plus: the move, the relaxed choice rule and the model answer picture (question key "modelImageId").
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
revoke all on function private.save_homework(uuid,uuid,uuid,uuid,bigint,jsonb,boolean) from public,anon;
grant execute on function private.save_homework(uuid,uuid,uuid,uuid,bigint,jsonb,boolean) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Read one homework (20261109120000), plus questions[].modelImageId for staff and solutions.keys[].modelImageId once they are open.
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
revoke all on function private.get_homework(uuid,uuid) from public,anon;
grant execute on function private.get_homework(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Lifecycle (20261109120000), plus: publishing waits for a copied model answer picture, and a clone copies each model answer picture to
-- a new private path (like the other solution media) and points the new version's key at the copy.
-- ---------------------------------------------------------------------------------------
create or replace function private.homework_lifecycle(p_assignment uuid,p_action text,p_revision bigint,p_data jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from private.homework_materials m join private.homework_uploads asset on asset.id=m.upload_id where m.assignment_id=a.id and asset.status<>'ready') or exists(select 1 from private.homework_solutions solution join private.homework_uploads asset on asset.id=solution.video_id where solution.assignment_id=a.id and asset.status<>'ready')
   or exists(select 1 from public.homework_questions question_row join private.homework_keys key_row on key_row.question_id=question_row.id join private.homework_uploads asset on asset.id=key_row.model_image_id where question_row.assignment_id=a.id and asset.status<>'ready') then raise exception 'Finish cloned media before publishing' using errcode='23514';end if;
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
  end loop;insert into private.homework_keys(question_id,correct_ids,model_answer) values(qid,ids,k.model_answer);
 end loop;
 -- Solution objects receive new private paths per version: a prior submission
 -- cannot authorize signing the new version's files via the Storage API.
 for source_upload in select asset.* from private.homework_uploads asset where asset.id in
 (select m.upload_id from private.homework_materials m where m.assignment_id=a.id and m.purpose='solution'
 union select solution.video_id from private.homework_solutions solution where solution.assignment_id=a.id and solution.video_id is not null
 union select key_row.model_image_id from private.homework_keys key_row join public.homework_questions question_row on question_row.id=key_row.question_id where question_row.assignment_id=a.id and key_row.model_image_id is not null) loop
  if source_upload.status<>'ready' then raise exception 'Finish original solution uploads before cloning' using errcode='23514';end if;
  copied_id:=gen_random_uuid();insert into private.homework_uploads(id,assignment_id,uploaded_by,purpose,name,mime,path)
  values(copied_id,cloned_id,(select private.current_app_user_id()),'solution',source_upload.name,source_upload.mime,cloned_id::text||'/'||copied_id::text||'/'||split_part(source_upload.path,'/',3));
  insert into private.homework_clone_sources(upload_id,source_id) values(copied_id,source_upload.id);
 end loop;
 insert into private.homework_solutions select cloned_id,solution.text,solution.video_url,(select copy.upload_id from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where copy.source_id=solution.video_id and target.assignment_id=cloned_id) from private.homework_solutions solution where solution.assignment_id=a.id;
 insert into private.homework_materials(assignment_id,upload_id,purpose) select cloned_id,case when m.purpose='reference' then m.upload_id else (select copy.upload_id from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where copy.source_id=m.upload_id and target.assignment_id=cloned_id) end,m.purpose from private.homework_materials m where m.assignment_id=a.id;
 -- Each new key points at the copy of its question's model answer picture (questions are matched by position).
 update private.homework_keys new_key set model_image_id=(select copy.upload_id from private.homework_clone_sources copy join private.homework_uploads target on target.id=copy.upload_id where copy.source_id=old_key.model_image_id and target.assignment_id=cloned_id)
  from public.homework_questions new_q,public.homework_questions old_q,private.homework_keys old_key
  where new_key.question_id=new_q.id and new_q.assignment_id=cloned_id and old_q.assignment_id=a.id and old_q.position=new_q.position and old_key.question_id=old_q.id and old_key.model_image_id is not null;
 insert into private.homework_audit(assignment_id,actor,action,before_value) values(cloned_id,(select private.current_app_user_id()),'cloned',to_jsonb(a));return cloned_id;
end $$;
revoke all on function private.homework_lifecycle(uuid,text,bigint,jsonb) from public,anon;
grant execute on function private.homework_lifecycle(uuid,text,bigint,jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Uploads (20261109120000), plus: 'get' of a model answer picture through its homework, for staff or once the solutions are open.
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
end $$;
revoke all on function private.homework_upload(uuid,text,uuid,uuid,jsonb) from public,anon;
grant execute on function private.homework_upload(uuid,text,uuid,uuid,jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------
-- The Homework page (20261109120000), plus questionCount and totalMarks on every row. They are read for the listed homework only (one
-- grouped read of their questions), never by authorizing rows of the whole database. A legacy file homework has no questions; its
-- marks are its file points.
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
  late as materialized (select assignment_id,count(distinct user_id) n from subs where missed_deadline group by assignment_id),
  bytes as materialized (select x.assignment_id,sum(x.size_bytes) n from private.homework_uploads x where x.assignment_id in (select id from h where counted and tab='closed') and x.purpose='submission' and x.status='ready' group by x.assignment_id),
  listed as materialized (select h.id,h.tab,h.deadline_at,h.updated_at,h.title,(coalesce(w.n,0)) waiting_n,h.counted,
   jsonb_build_object('id',h.id,'title',h.title,'courseId',h.course_id,'courseTitle',c.title,'offeringId',h.offering_id,'lessonId',h.lesson_id,'lessonTitle',l.title,'version',h.version,
    'workflow',h.workflow,'mode',h.mode,'status',h.status,'deadline',h.deadline_at,'lateAllowed',h.late_allowed,'tries',h.tries_mode,'maxTries',h.max_tries,'solutionsOpen',h.solutions_open,'photosAllowed',h.photos_allowed,'updatedAt',h.updated_at,
    'questionCount',coalesce(qs.n,0),'totalMarks',case when h.mode='FILE_UPLOAD' then h.file_points else coalesce(qs.m,0) end,
    'handedIn',case when h.counted then coalesce(hd.n,0) end,'total',case when h.counted then coalesce(r.n,0) end,'late',case when h.counted then coalesce(lt.n,0) end,
    'waiting',case when h.counted then coalesce(w.n,0) end,'imageBytes',case when h.counted and h.tab='closed' then coalesce(b.n,0) end) j
   from h join public.courses c on c.id=h.course_id join public.lessons l on l.id=h.lesson_id left join qs on qs.assignment_id=h.id
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
revoke all on function private.homework_portal(uuid,text,integer) from public,anon;
grant execute on function private.homework_portal(uuid,text,integer) to authenticated;

commit;
