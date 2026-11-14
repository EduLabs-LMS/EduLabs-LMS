-- Exams, part 2 (student side): drafts keep unfinished questions, and the demo seed grows to version 7. Applied after 20261114120000_exams.sql, which is not edited.
-- Resolves the caller with private.current_app_user_id(), never auth.uid(). create or replace keeps the existing grants.
begin;

-- Drafts keep unfinished questions (a choice without a right answer or enough options, a number without a value); publishing refuses them with a list.
create or replace function private.exam_check(p_exam uuid) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams;unfinished jsonb;
begin
 select * into e from private.exams where id=p_exam;
 if e.kind='online' then
  if not exists(select 1 from private.exam_questions where exam_id=e.id) then raise exception 'Add a question first' using errcode='23514';end if;
  -- A draft keeps unfinished questions; publishing refuses them and lists which (1-based question numbers).
  select coalesce(jsonb_agg(x.n order by x.n),'[]'::jsonb) into unfinished from (select q.position+1 n from private.exam_questions q left join private.exam_keys k on k.question_id=q.id
   where q.exam_id=e.id and ((q.type in ('single_choice','multiple_choice') and (cardinality(coalesce(k.correct_option_ids,'{}'))=0 or (select count(*) from private.exam_options o where o.question_id=q.id)<2))
    or (q.type='number' and k.number_value is null))) x;
  if jsonb_array_length(unfinished)>0 then raise exception 'Some questions are unfinished' using errcode='23514',detail=jsonb_build_object('reason','unfinished_questions','questions',unfinished)::text;end if;
  if e.auto_release and exists(select 1 from private.exam_questions where exam_id=e.id and type='essay') then raise exception 'Auto-release needs an exam without essays' using errcode='23514';end if;
  if not e.photos_allowed and exists(select 1 from private.exam_questions where exam_id=e.id and response_mode<>'text') then raise exception 'Photo answers are off for this exam' using errcode='23514';end if;
  if e.timing='same_time' and (e.opens_at is null or e.closes_at is null) then raise exception 'Choose when the exam opens and closes' using errcode='23514';end if;
  if e.timing='per_group' and e.starting_from is null then raise exception 'Choose the starting day' using errcode='23514';end if;
 end if;
end $$;

create or replace function private.exam_save(p_exam uuid,p_offering uuid,p_revision bigint,p_definition jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;d jsonb:=coalesce(p_definition,'{}'::jsonb);course uuid;started boolean:=false;
 q jsonb;qi integer:=0;qid uuid;o jsonb;oi integer;oid_ uuid;ids uuid[];correct uuid[];qtype text;img uuid;mimg uuid;tolerance numeric;num numeric;before_ jsonb;qo jsonb;qc jsonb;draft_ boolean;nt text;omin integer;cmin integer;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(jsonb_typeof(d),'')<>'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','chapterIds','coversAllChapters','heldOn','maxMarks','timing','startingFrom',
   'opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','questions'))
  or (d ? 'title' and coalesce(jsonb_typeof(d->'title'),'')<>'string') or (d ? 'description' and coalesce(jsonb_typeof(d->'description'),'')<>'string')
  or exists(select 1 from unnest(array['coversAllChapters','shuffle','photosAllowed','autoRelease']) k where d ? k and coalesce(jsonb_typeof(d->k),'')<>'boolean')
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
 if e.kind='paper' and exists(select 1 from jsonb_object_keys(d) k where k in ('timing','startingFrom','opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','questions')) then
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
  auto_release=case when d ? 'autoRelease' then (d->>'autoRelease')::boolean else auto_release end
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
end $$;

-- exam_get for a student: the rule for tries (one time, fix mistakes, from zero) and the course title, which the settings' own 'tries' key lost to the list of the
-- student's tries. Copied from 20261114120000 with those two keys added; nothing else changes (same signature, same grants).
create or replace function private.exam_get(p_exam uuid,p_attempt uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
   'result',case when released then jsonb_build_object('score',r.score,'maxScore',r.max_score,'absent',r.absent,'releasedAt',coalesce(r.released_at,private.exam_last_close(e.id)))
    when r.id is not null then jsonb_build_object('waiting',true) end);
 end if;
 if p_attempt is not null then base:=base||jsonb_build_object('attempt',private.exam_attempt_json(p_attempt));end if;
 return base;
end $$;

-- Release notices open the student's exam page (the link was null until the student screen existed). Same function as 20261015185510 with the exam_released
-- branch extended; the legacy branch is kept. A link is generated and checked again when read, and only once the result counts as released.
create or replace function private.notification_link(p_event uuid,p_user uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare e private.notification_events; l public.lessons; course uuid; part uuid; off uuid; exam_ uuid;
begin
 if p_user is distinct from private.current_app_user_id() then return null;end if;
 select * into e from private.notification_events where id=p_event;
 if e.event_type='account_approved' then return null;
 elsif e.event_type='support_reply' then if private.support_access(e.resource_id) then return '/support?ticket='||e.resource_id;end if;
 elsif e.event_type in ('session_starting','session_details') then
  if private.notification_current(e.id,p_user) then return '/groups';end if;
 elsif e.event_type='exam_released' then
  if exists(select 1 from private.assessment_participations p where p.schedule_id=e.resource_id and p.user_id=p_user and p.released_at is not null)  then return '/exams/'||e.resource_id;end if;
  -- A result of the new exams (20261114120000): the resource is the result; the link opens that exam once the student may see the result.
  select r.exam_id into exam_ from private.exam_results r where r.id=e.resource_id and r.user_id=p_user and private.exam_released(r.id);
  if exam_ is not null then return '/exams/'||exam_;end if;
 elsif e.event_type='homework_released' then
  select a.lesson_id,a.offering_id,a.segment_id into l.id,off,part from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id join private.homework_corrections c on c.submission_id=s.id where s.id=e.resource_id and s.user_id=p_user and c.released_at is not null and private.homework_enrolled(a.id);
 elsif e.event_type='lesson_published' then
  select x.* into l from public.lessons x where x.id=e.resource_id and x.status='published' and private.can_view_lesson(x.id);
 end if;
 if l.id is not null then
  select m.course_id into course from public.course_modules m join public.lessons x on x.module_id=m.id where x.id=l.id;
  if part is null then select s.id into part from public.lesson_segments s where s.lesson_id=l.id and s.status='published' order by s.position limit 1;
  elsif not exists(select 1 from public.lesson_segments s where s.id=part and s.lesson_id=l.id and s.status='published') then return null;end if;
  if off is null then select o.id into off from public.course_offerings o where o.course_id=course and private.is_enrolled(o.id) order by o.id limit 1;end if;
  if part is not null and off is not null then return '/courses/'||course||'/chapters/'||part||'?offering='||off;end if;
 end if;return null;
end $$;

-- ---------------------------------------------------------------------------------------
-- Demo seed version 7: exams. Registry: the exam tables with a row id may be recorded (the keys by their question; windows, items, answers and
-- marks have composite keys and are removed with their exam by demo_clear_core, which already removes exams). No stored file: nothing is
-- uploaded, so Clear never meets "exam files" from the seed.
-- ---------------------------------------------------------------------------------------
alter table private.demo_seed_rows drop constraint demo_seed_rows_table_name_check;
alter table private.demo_seed_rows add constraint demo_seed_rows_table_name_check check (table_name in
 ('courses','course_modules','lessons','course_offerings','study_groups','group_staff','group_sessions','profiles','enrollments','group_memberships',
  'homework_assignments','homework_questions','homework_options','homework_keys','homework_solutions','homework_submissions','homework_responses',
  'homework_marks','homework_corrections','homework_uploads','homework_submission_files',
  'exams','exam_questions','exam_options','exam_keys','exam_attempts','exam_results'));

-- One published online exam (per Group, starting from p_start). Returns {exam, q1..q4, q1 right, q1 wrong, q2 a (right), q2 b, q2 c (right), q2 d}.
create function private.demo_exam_make(p_org uuid,p_owner uuid,p_course uuid,p_offering uuid,p_title text,p_limit integer,p_tries text,p_start date,p_published timestamptz) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare ex uuid:=gen_random_uuid(); q uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; o uuid; ids uuid[]:='{}'; i integer;
begin
 insert into private.exams(id,family_id,course_id,offering_id,kind,title,description,status,published_at,timing,starting_from,time_limit_minutes,tries_mode,shuffle,photos_allowed,auto_release,created_by,revision)
  values(ex,ex,p_course,p_offering,'online',p_title,'Demo exam. Answer every question, then hand in.','published',p_published,'per_group',p_start,p_limit,p_tries,false,true,false,p_owner,1);
 perform private.demo_track(p_org,'exams','exams',ex);
 insert into private.exam_questions(id,exam_id,position,type,text,points,response_mode) values
  (q[1],ex,0,'single_choice','Which unit measures electric current?',3,'text'),
  (q[2],ex,1,'multiple_choice','Choose every good conductor.',3,'text'),
  (q[3],ex,2,'number','A 12 V source drives 1.2 A through a resistor. What is its resistance in ohms?',2,'text'),
  (q[4],ex,3,'essay','Explain why a fuse protects a circuit.',4,'both');
 for i in 1..4 loop perform private.demo_track(p_org,'exams','exam_questions',q[i]); end loop;
 for i in 0..3 loop
  insert into private.exam_options(question_id,position,text) values(q[1],i,(array['Ampere','Volt','Ohm','Watt'])[i+1]) returning id into o;
  perform private.demo_track(p_org,'exams','exam_options',o); ids:=ids||o;
 end loop;
 for i in 0..3 loop
  insert into private.exam_options(question_id,position,text) values(q[2],i,(array['Copper','Rubber','Silver','Glass'])[i+1]) returning id into o;
  perform private.demo_track(p_org,'exams','exam_options',o); ids:=ids||o;
 end loop;
 insert into private.exam_keys(question_id,correct_option_ids,number_value,number_tolerance,model_text) values
  (q[1],array[ids[1]],null,0,''),(q[2],array[ids[5],ids[7]],null,0,''),(q[3],'{}',10,0,''),
  (q[4],'{}',null,0,'A fuse melts when the current is too high, which opens the circuit before the wires overheat.');
 for i in 1..4 loop perform private.demo_track(p_org,'exams','exam_keys',q[i]); end loop;
 return array[ex,q[1],q[2],q[3],q[4],ids[1],ids[2],ids[5],ids[6],ids[7],ids[8]];
end $$;

-- One demo try (p_submit false: still working, with the first two answers saved). p_variant decides which answers are right.
create function private.demo_exam_try(p_org uuid,p_ex uuid[],p_user uuid,p_group uuid,p_number integer,p_started timestamptz,p_limit integer,p_submit boolean,p_variant integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid:=gen_random_uuid(); r uuid; qi integer; qid uuid; opts uuid[];
begin
 insert into private.exam_attempts(id,exam_id,user_id,number,window_group_id,started_at,deadline_at,submitted_at,status,revision)
  values(a,p_ex[1],p_user,p_number,p_group,p_started,p_started+make_interval(mins => p_limit),case when p_submit then p_started+interval '20 minutes' end,case when p_submit then 'submitted' else 'in_progress' end,case when p_submit then 2 else 1 end);
 perform private.demo_track(p_org,'exams','exam_attempts',a);
 for qi in 1..4 loop
  qid := p_ex[qi+1];
  select coalesce(array_agg(o.id order by o.position),'{}') into opts from private.exam_options o where o.question_id=qid;
  insert into private.exam_attempt_items(attempt_id,question_id,position,option_order) values(a,qid,qi-1,opts);
 end loop;
 insert into private.exam_responses(attempt_id,question_id,option_ids) values(a,p_ex[2],array[case when p_variant%3<>0 then p_ex[6] else p_ex[7] end]);
 insert into private.exam_responses(attempt_id,question_id,option_ids) values(a,p_ex[3],case when p_variant%2=0 then array[p_ex[8],p_ex[10]] else array[p_ex[8]] end);
 if p_submit then
  insert into private.exam_responses(attempt_id,question_id,number_value) values(a,p_ex[4],case when p_variant%4=0 then 12 else 10 end);
  insert into private.exam_responses(attempt_id,question_id,text) values(a,p_ex[5],'Demo answer: the fuse melts when the current is too high and opens the circuit.');
  perform private.exam_mark_try(a);
  select id into r from private.exam_results where exam_id=p_ex[1] and user_id=p_user;
  perform private.demo_track(p_org,'exams','exam_results',r);
 end if;
 return a;
end $$;

-- Correct the essay of a handed-in try (the result becomes corrected, not released).
create function private.demo_exam_correct(p_attempt uuid,p_points numeric) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.exam_marks m set points=p_points,auto=false from private.exam_questions q where m.attempt_id=p_attempt and q.id=m.question_id and q.type='essay';
 perform private.exam_mark_try(p_attempt);
end $$;
revoke all on function private.demo_exam_make(uuid,uuid,uuid,uuid,text,integer,text,date,timestamptz),private.demo_exam_try(uuid,uuid[],uuid,uuid,integer,timestamptz,integer,boolean,integer),
 private.demo_exam_correct(uuid,numeric) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------
-- Fill, seed version 7 = version 6 (20261113120000) copied unchanged, plus the exams module just before the version is stored. Same signature
-- and grants (create or replace keeps them). demo_clear_core already removes exams and still refuses real people's work and exam files.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamptz; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 groups_ uuid[]; fin_ uuid[] := '{}'; dra_ uuid[] := '{}'; g uuid; gi integer; n integer; sn integer := 0; st timestamptz; dur interval;
 pid uuid; eid uuid; mid uuid; a_status text; a_marked boolean; les_pub uuid; ev uuid; k integer; titles_ text[];
 n_courses integer := 0; n_lessons integer := 0; n_groups integer := 0; n_sessions integer := 0; n_students integer := 0;
 les_ uuid[] := '{}'; studs_ uuid[] := '{}'; hw_ uuid[]; hw_at timestamptz; dl timestamptz; sub_ uuid; nxt uuid; hw_row uuid; st_ text;
 mag_ uuid; les_review uuid;
 ex_ uuid[]; ex_day date; at_ uuid; n_exams integer := 5; win_open timestamptz; win_close timestamptz; gx uuid; sx uuid; rr uuid;
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

 -- Seed version 6, a lesson with homework and no parts (DECISIONS.md, "A lesson is never tethered to one of its components"), so the student
 -- lesson page addressed by the lesson id and correcting can be tried. "Magnetism review" is the third lesson of Magnetism, published, with no
 -- part, video, content item or cover. Its homework (a blank-answer question, a choice question and an essay) closed yesterday at 20:00 Cairo,
 -- late hand-ins allowed, one time, solutions after hand-in. Students 1-14 handed in, 15-28 are missing:
 --   1-5 waiting (1, 2 and 4 with a photo; student 1's photo deleted to free space), 6-9 corrected and not released (for "Release N grades"),
 --   10-12 released, 13-14 handed in late and waiting ("Missed the deadline").
 select m.id into mag_ from public.course_modules m where m.course_id=crs_a and m.position=1;
 insert into public.lessons(module_id,title,position,status) values(mag_,'Magnetism review',2,'published') returning id into les_review;
 perform private.demo_track(p_org,'courses','lessons',les_review); n_lessons := n_lessons+1; les_ := les_||les_review;
 dl := ((v_day-interval '1 day'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_review,'Magnetism review homework','published',dl,true,'one_time',1,'after_hand_in');
 for i in 1..14 loop
  st_ := case when i<=5 or i>=13 then 'waiting' when i<=9 then 'corrected' else 'released' end;
  hw_at := case when i>=13 then dl+make_interval(hours => i-11) else dl-make_interval(hours => 1+i) end;
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,i>=13,st_,i,i in (1,2,4));
 end loop;
 -- Student 1's photo was removed to free space: the row stays 'deleted' (as Delete images leaves it); the answer and marks are kept.
 update private.homework_uploads u set status='deleted',deleted_at=now()-interval '1 hour'
  where u.assignment_id=hw_[1] and u.uploaded_by=studs_[1] and u.purpose='submission';


 -- Seed version 7, exams, in the published Physics course (the whole course gets them). Online: 4 questions (a choice, several choices, a number, an
 -- essay with text and a photo allowed), 12 points, 30 minutes. Paper: out of 50. Students 1-14 are in Demo Group 1, 15-28 in Demo Group 2.
 --   1. "Electric current: quiz (open now)": Group 1's window runs from an hour before the fill to three hours after it (students 1-3 handed in,
 --      4 and 5 are still working, 6-14 have not started); Group 2's window is its next session. Fix mistakes (a second try inside the window).
 --   2. "Electric current: mid-term (closed)": both windows closed (3 and 2 days ago); students 1-12 and 15-26 handed in; essays are waiting for
 --      most, every third one is corrected and not released.
 --   3. "Magnetism: unit test (released)": both windows closed 9 days ago; students 1-20 handed in, all corrected and released, so answer review is open.
 --   4. "Electromagnetic induction: quiz (upcoming)": each Group's window is its next session.
 --   5. "Electricity: paper exam": out of 50, held two days ago: students 1-9 and 15-22 have a mark (1-4 released), student 10 is Absent, the rest are missing.
 ex_day := (now() at time zone 'Africa/Cairo')::date;
 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electric current: quiz (open now)',30,'fix_mistakes',ex_day,now()-interval '2 hours');
 win_open := now()-interval '1 hour'; win_close := now()+interval '3 hours';
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values(ex_[1],g1,'custom',win_open,win_close,v_owner);
 select x.id into sx from public.group_sessions x where x.group_id=g2 and not x.cancelled and x.starts_at>=now() order by x.starts_at,x.id limit 1;
 insert into private.exam_group_windows(exam_id,group_id,source,session_id,updated_by) values(ex_[1],g2,'auto',sx,v_owner);
 for i in 1..5 loop
  at_ := private.demo_exam_try(p_org,ex_,studs_[i],g1,1,case when i<=3 then now()-make_interval(mins => 50-i) else now()-make_interval(mins => 15-i) end,30,i<=3,i);
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electric current: mid-term (closed)',30,'one_time',ex_day-3,now()-interval '4 days');
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values
  (ex_[1],g1,'custom',now()-interval '3 days 2 hours',now()-interval '3 days',v_owner),(ex_[1],g2,'custom',now()-interval '2 days 2 hours',now()-interval '2 days',v_owner);
 for i in 1..28 loop
  if (i<=12) or (i>=15 and i<=26) then
   at_ := private.demo_exam_try(p_org,ex_,studs_[i],case when i<=14 then g1 else g2 end,1,
    case when i<=14 then now()-interval '3 days 90 minutes'+make_interval(mins => i) else now()-interval '2 days 90 minutes'+make_interval(mins => i-14) end,30,true,i);
   if i%3=0 then perform private.demo_exam_correct(at_,(i%9)::numeric/2); end if;
  end if;
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Magnetism: unit test (released)',30,'one_time',ex_day-10,now()-interval '11 days');
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values
  (ex_[1],g1,'custom',now()-interval '9 days 2 hours',now()-interval '9 days',v_owner),(ex_[1],g2,'custom',now()-interval '9 days 2 hours',now()-interval '9 days',v_owner);
 for i in 1..20 loop
  at_ := private.demo_exam_try(p_org,ex_,studs_[i],case when i<=14 then g1 else g2 end,1,now()-interval '9 days 90 minutes'+make_interval(mins => i),30,true,i);
  perform private.demo_exam_correct(at_,((i*3)%9)::numeric/2);
  update private.exam_results set released_at=now()-interval '8 days',released_by=v_owner where exam_id=ex_[1] and user_id=studs_[i];
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electromagnetic induction: quiz (upcoming)',30,'one_time',ex_day,now()-interval '1 hour');
 foreach gx in array groups_ loop
  select x.id into sx from public.group_sessions x where x.group_id=gx and not x.cancelled and x.starts_at>=now() order by x.starts_at,x.id limit 1;
  insert into private.exam_group_windows(exam_id,group_id,source,session_id,updated_by) values(ex_[1],gx,'auto',sx,v_owner);
 end loop;

 -- The paper exam: no windows, no tries; a result row per student with a mark (the mark is also the score), Absent, or none.
 at_ := gen_random_uuid();
 insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,created_by,revision)
  values(at_,at_,crs_a,off_id,'paper','Electricity: paper exam','published',now()-interval '1 day',50,ex_day-2,v_owner,1);
 perform private.demo_track(p_org,'exams','exams',at_);
 for i in 1..22 loop
  if i<=9 or i>=15 then
   insert into private.exam_results(exam_id,user_id,paper_mark,status,score,max_score,released_at,released_by,updated_by)
    values(at_,studs_[i],20+((i*7)%25)+case when i%2=0 then 0.5 else 0 end,'corrected',20+((i*7)%25)+case when i%2=0 then 0.5 else 0 end,50,
     case when i<=4 then now()-interval '1 day' end,case when i<=4 then v_owner end,v_owner) returning id into rr;
  elsif i=10 then
   insert into private.exam_results(exam_id,user_id,absent,status,max_score,updated_by) values(at_,studs_[i],true,'corrected',50,v_owner) returning id into rr;
  else rr := null;
  end if;
  if rr is not null then perform private.demo_track(p_org,'exams','exam_results',rr); end if;
 end loop;

 update private.demo_spaces set seed_version=7,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',7,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5,'homework',5,'exams',n_exams));
 return jsonb_build_object('seedVersion',7,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'homework',5,'exams',n_exams);
end $$;

-- ---------------------------------------------------------------------------------------
-- Status: the latest seed version is now 7.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',7) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',7));
end $$;

commit;
