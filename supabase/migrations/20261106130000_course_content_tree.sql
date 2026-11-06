-- Course content tree (Course > Chapter > Lesson) for the teacher's Course page. DRAFT: not applied anywhere.
--
-- What already works and is NOT replaced: public.edit_learning_content stays byte-for-byte as it is. The screen keeps using it for create_lesson,
-- reorder_modules and reorder_lessons (course-root lock, per-row updated_at check, can_edit_course). The triggers below also apply to it.
--
-- What was missing or unsafe, and is added here:
--   * Deleting: edit_learning_content has no delete. A direct delete under RLS takes no course-root lock, checks no version, and removing a chapter would
--     also remove lessons added to it a moment ago in another tab. The client delete grants go too, so a refused delete cannot be walked around.
--   * Moving a lesson to another chapter: lessons.module_id was immutable (prevent_reparenting). It may now change, inside one course only.
--   * Renaming: edit_lesson also writes description and status, and refuses a published lesson with no published part. edit_module wipes the description
--     when it is not sent. Renaming now changes the title and nothing else.
--   * Reading: why a lesson cannot be deleted depends on student work a course editor may not be able to read, so course_structure answers that directly
--     (facts and counts, no student or homework content).
--
-- The owner's decisions (DECISIONS.md, "Course content tree"):
--   * The label. Every chapter has the type 'Chapter', and chapter_number = position + 1, with positions 0, 1, 2 and no gap. A trigger keeps this on every write,
--     so a student and a teacher always read the same "Chapter N". Existing rows are rewritten once, here. edit_module and edit_module_details still accept a type
--     and a number, which are now ignored. This replaces the 2B rule that a number is chosen freely and is independent of the order.
--   * An archived course: create, rename, reorder, move and delete of a chapter or lesson are refused in the database, for every caller and every path: PT409
--     (HTTP 409), so a tab that has not heard about it reloads and shows the content read-only. Deleting the whole course still works. Parts, blocks, covers, a lesson's
--     description and its draft or published state are not structure and are not changed by this rule.
--   * A published lesson no student has started may be deleted. Nothing here looks at the status of a lesson.
--
-- Refused deletes: 23503 (PostgREST: HTTP 409) with the detail {"reasons":[...],"lessonIds":[...],"contentBlocks":n,"covers":n,"parts":n,"homework":n}. Reasons:
-- student_work, homework, student_progress, parts, content (lesson blocks or a cover), in_use (any other reference the database refuses). The counts let the screen say
-- what is inside, in English and Arabic. A stale request is PT409 and nothing changes.
--
-- Demo seed version 4: three chapters with 3, 2 and 0 lessons in the published demo course, as on the board; the draft demo course has none.
-- private.demo_clear_core is not replaced: it starts from the recorded courses, so added, moved or deleted lessons need nothing new.
begin;

-- ---------------------------------------------------------------------------------------
-- A lesson may change chapter inside its course, never leave the course. There is still no client column grant on module_id, so only the function below can
-- write it. The move keeps the lesson id, and homework, progress and parts hang off that id with the same course.
-- ---------------------------------------------------------------------------------------
drop trigger prevent_reparenting on public.lessons;
create trigger prevent_reparenting before update on public.lessons for each row execute function private.reject_reparenting('id');

create function private.keep_lesson_in_course() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.module_id is distinct from old.module_id
  and (select m.course_id from public.course_modules m where m.id=new.module_id) is distinct from (select m.course_id from public.course_modules m where m.id=old.module_id) then
  raise exception 'Immutable identity/link: a lesson stays in its course' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.keep_lesson_in_course() from public,anon,authenticated,service_role;
create trigger keep_lesson_in_course before update of module_id on public.lessons for each row execute function private.keep_lesson_in_course();

-- ---------------------------------------------------------------------------------------
-- The label: type Chapter, number = position + 1, on every write. The two checks at the end say the same, so nothing can leave a row that disagrees.
-- Positions stay 0, 1, 2: a deleted chapter's gap is closed in the same transaction, under the course-root lock, and only rows that actually move are written.
-- The client grants that could write a position directly go, so a gap cannot be made from outside. The app has never used them.
-- ---------------------------------------------------------------------------------------
alter table public.course_modules drop constraint course_modules_chapter_number_check,drop constraint course_modules_group_type_check;
alter table public.course_modules alter column group_type set default 'Chapter',alter column chapter_number drop default;

create function private.pin_chapter_label() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.group_type:='Chapter';
 new.chapter_number:=new.position+1;
 return new;
end $$;
revoke all on function private.pin_chapter_label() from public,anon,authenticated,service_role;
create trigger pin_chapter_label before insert or update on public.course_modules for each row execute function private.pin_chapter_label();

create function private.close_chapter_gaps(p_course uuid) returns void language plpgsql security definer set search_path='' as $$
declare top integer;
begin
 perform 1 from public.courses c where c.id=p_course for update;
 if not found then return; end if;
 -- Shift first, above every position in use, so the immediate unique index on (course_id,position) is never hit.
 select coalesce(max(m.position),-1)+1 into top from public.course_modules m where m.course_id=p_course;
 update public.course_modules m set position=m.position+top from (select x.id,row_number() over (order by x.position,x.id)-1 rn from public.course_modules x where x.course_id=p_course) w where w.id=m.id and m.position<>w.rn;
 update public.course_modules m set position=w.rn from (select x.id,row_number() over (order by x.position,x.id)-1 rn from public.course_modules x where x.course_id=p_course) w where w.id=m.id and m.position<>w.rn;
end $$;
revoke all on function private.close_chapter_gaps(uuid) from public,anon,authenticated,service_role;

create function private.close_chapter_gaps_after_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 for c in select distinct g.course_id from gone g order by 1 loop perform private.close_chapter_gaps(c); end loop;
 return null;
end $$;
revoke all on function private.close_chapter_gaps_after_delete() from public,anon,authenticated,service_role;
create trigger close_chapter_gaps after delete on public.course_modules referencing old table as gone for each statement execute function private.close_chapter_gaps_after_delete();

-- Existing rows, once. Dev data only, by the owner's decision; the lessons of a chapter and every chapter id stay.
do $$ declare c uuid; begin for c in select distinct m.course_id from public.course_modules m order by 1 loop perform private.close_chapter_gaps(c); end loop; end $$;
update public.course_modules set chapter_number=position+1,group_type='Chapter' where chapter_number is distinct from position+1 or group_type<>'Chapter';
alter table public.course_modules alter column chapter_number set not null,
 add constraint course_modules_chapter_number_is_position check (chapter_number=position+1),
 add constraint course_modules_group_type_is_chapter check (group_type='Chapter');

revoke insert,delete on public.course_modules from authenticated;
revoke update(position) on public.course_modules from authenticated;
revoke delete on public.lessons from authenticated;

-- ---------------------------------------------------------------------------------------
-- An archived course: its tree does not change, for any caller. Only a real change counts, so a save that repeats the same title and position passes. The share lock waits
-- for a course being archived in another transaction, then reads the new status. A course being deleted is already gone when the cascade arrives here, so it passes.
-- ---------------------------------------------------------------------------------------
create function private.refuse_archived_structure() returns trigger language plpgsql security definer set search_path='' as $$
declare course uuid; state text;
begin
 if tg_table_name='course_modules' then
  if tg_op='UPDATE' and new.title is not distinct from old.title and new.position is not distinct from old.position then return new; end if;
  course:=case when tg_op='DELETE' then old.course_id else new.course_id end;
 else
  if tg_op='UPDATE' and new.title is not distinct from old.title and new.position is not distinct from old.position and new.module_id is not distinct from old.module_id then return new; end if;
  select m.course_id into course from public.course_modules m where m.id=case when tg_op='DELETE' then old.module_id else new.module_id end;
 end if;
 select c.status into state from public.courses c where c.id=course for share;
 if state='archived' then raise exception 'Course archived' using errcode='PT409',detail='{"reasons":["archived"]}'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.refuse_archived_structure() from public,anon,authenticated,service_role;
create trigger refuse_archived_structure before insert or update or delete on public.course_modules for each row execute function private.refuse_archived_structure();
create trigger refuse_archived_structure before insert or update or delete on public.lessons for each row execute function private.refuse_archived_structure();

-- ---------------------------------------------------------------------------------------
-- Why a lesson cannot be deleted. One definition, so the screen's answer and the delete agree. lesson_blocks and a cover are not restrict references, but the
-- teacher cannot see them on this page, so a delete must not remove them silently.
-- ---------------------------------------------------------------------------------------
create function private.lesson_delete_blockers(p_lesson uuid) returns text[] language sql stable security definer set search_path='' as $$
 select array_remove(array[
  case when exists(select 1 from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where a.lesson_id=p_lesson) then 'student_work' end,
  case when exists(select 1 from public.homework_assignments a where a.lesson_id=p_lesson) then 'homework' end,
  case when exists(select 1 from public.lesson_progress p where p.lesson_id=p_lesson) or exists(select 1 from public.lesson_segment_progress p where p.lesson_id=p_lesson) then 'student_progress' end,
  case when exists(select 1 from public.lesson_segments s where s.lesson_id=p_lesson) then 'parts' end,
  case when exists(select 1 from public.lesson_blocks b where b.lesson_id=p_lesson) or exists(select 1 from public.lessons l where l.id=p_lesson and l.cover_asset_id is not null) then 'content' end
 ]::text[],null)
$$;
revoke all on function private.lesson_delete_blockers(uuid) from public,anon,authenticated,service_role;

-- What is inside, so a refusal can say "This lesson has 2 content blocks and a cover". A homework counts once, however many versions it has.
create function private.lesson_delete_counts(p_lessons uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'contentBlocks',(select count(*) from public.lesson_blocks b where b.lesson_id=any(p_lessons)),
  'covers',(select count(*) from public.lessons l where l.id=any(p_lessons) and l.cover_asset_id is not null),
  'parts',(select count(*) from public.lesson_segments s where s.lesson_id=any(p_lessons)),
  'homework',(select count(distinct a.family_id) from public.homework_assignments a where a.lesson_id=any(p_lessons)))
$$;
revoke all on function private.lesson_delete_counts(uuid[]) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------
-- The writes. Same authorization as editing the course today (can_edit_course) and the same course-root lock as edit_learning_content, so these and its reorders
-- run one at a time per course. Every change to an existing row sends the updated_at it read.
-- ---------------------------------------------------------------------------------------
create function private.edit_course_structure(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare state text; stamp timestamptz; other timestamptz; target uuid; item jsonb; n integer; i integer; name_ text; reasons text[]; blocked uuid[];
begin
 if private.current_app_user_id() is null or p_course_id is null or not private.can_edit_course(p_course_id) then raise exception 'Content editing denied' using errcode='42501'; end if;
 select c.status into state from public.courses c where c.id=p_course_id for update;
 if not found then raise exception 'Content editing denied' using errcode='42501'; end if;
 if state='archived' then raise exception 'Course archived' using errcode='PT409',detail='{"reasons":["archived"]}'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid content' using errcode='23514'; end if;

 if p_action in ('create_chapter','rename_chapter','rename_lesson') then
  name_:=trim(p_data->>'title');
  i:=case when p_action='rename_lesson' then 200 else 120 end;
  if (p_data-'title')<>'{}'::jsonb or jsonb_typeof(p_data->'title') is distinct from 'string' or name_ ~ '[[:cntrl:]]' or length(name_) not between 1 and i then
   raise exception 'Invalid title' using errcode='23514';
  end if;
 end if;

 if p_action='create_chapter' then
  select count(*),coalesce(max(m.position),-1)+1 into n,i from public.course_modules m where m.course_id=p_course_id;
  if n>=500 then raise exception 'Content limit reached' using errcode='23514'; end if;
  insert into public.course_modules(course_id,title,position) values(p_course_id,name_,i) returning id into target;
  return target;
 end if;

 if p_action in ('rename_chapter','delete_chapter') then
  select m.updated_at into stamp from public.course_modules m where m.id=p_id and m.course_id=p_course_id for update;
  if stamp is null then raise exception 'Module unavailable' using errcode='42501'; end if;
 elsif p_action in ('rename_lesson','delete_lesson','move_lesson') then
  select l.updated_at into stamp from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=p_id and m.course_id=p_course_id for update of l;
  if stamp is null then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 else raise exception 'Unknown content action' using errcode='23514'; end if;
 if p_updated_at is null or stamp is distinct from p_updated_at then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;

 if p_action='rename_chapter' then update public.course_modules set title=name_ where id=p_id; return p_id; end if;
 if p_action='rename_lesson' then update public.lessons set title=name_ where id=p_id; return p_id; end if;

 if p_action='move_lesson' then
  -- items is the new full order of the target chapter, moved lesson included, each with the updated_at the teacher saw. Anything else changed there is a stale request.
  if not exists(select 1 from public.course_modules m where m.id=p_parent_id and m.course_id=p_course_id) then raise exception 'Module unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.lessons l where l.id=p_id and l.module_id=p_parent_id) then raise exception 'The lesson is already in this chapter' using errcode='23514'; end if;
  if (p_data-'items')<>'{}'::jsonb or jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Invalid order' using errcode='23514'; end if;
  select count(*) into n from public.lessons l where l.module_id=p_parent_id;
  if n>=500 then raise exception 'Content limit reached' using errcode='23514'; end if;
  if jsonb_array_length(p_data->'items')<>n+1 or n+1<>(select count(distinct x->>'id') from jsonb_array_elements(p_data->'items') x) then raise exception 'Order changed. Reload.' using errcode='PT409'; end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   if (item->>'id')::uuid=p_id then other:=stamp;
   else select l.updated_at into other from public.lessons l where l.id=(item->>'id')::uuid and l.module_id=p_parent_id for update; end if;
   if other is null or other is distinct from (item->>'updated_at')::timestamptz then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
  end loop;
  -- Shift above every position the loop below will write, so the immediate unique index on (module_id,position) is never hit.
  select coalesce(max(l.position),-1)+2 into i from public.lessons l where l.module_id=p_parent_id;
  update public.lessons set position=position+i where module_id=p_parent_id;
  n:=0;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   update public.lessons set module_id=p_parent_id,position=n where id=(item->>'id')::uuid; n:=n+1;
  end loop;
  return p_id;
 end if;

 if p_action='delete_lesson' then
  if p_data<>'{}'::jsonb then raise exception 'Invalid content' using errcode='23514'; end if;
  reasons:=private.lesson_delete_blockers(p_id);
  if cardinality(reasons)>0 then
   raise exception 'Content is in use' using errcode='23503',detail=(jsonb_build_object('reasons',to_jsonb(reasons),'lessonIds',jsonb_build_array(p_id))||private.lesson_delete_counts(array[p_id]))::text;
  end if;
  begin
   delete from public.lessons where id=p_id;
  exception when foreign_key_violation or restrict_violation then
   raise exception 'Content is in use' using errcode='23503',detail=jsonb_build_object('reasons',jsonb_build_array('in_use'),'lessonIds',jsonb_build_array(p_id))::text;
  end;
  return p_id;
 end if;

 -- delete_chapter. items is every lesson the teacher saw in it (an empty array for an empty chapter), so a lesson added elsewhere is never removed unseen.
 if (p_data-'items')<>'{}'::jsonb or jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Invalid order' using errcode='23514'; end if;
 select count(*) into n from public.lessons l where l.module_id=p_id;
 if jsonb_array_length(p_data->'items')<>n or n<>(select count(distinct x->>'id') from jsonb_array_elements(p_data->'items') x) then raise exception 'Order changed. Reload.' using errcode='PT409'; end if;
 for item in select value from jsonb_array_elements(p_data->'items') loop
  select l.updated_at into other from public.lessons l where l.id=(item->>'id')::uuid and l.module_id=p_id for update;
  if other is null or other is distinct from (item->>'updated_at')::timestamptz then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
 end loop;
 select array_agg(distinct r),array_agg(distinct x.id) into reasons,blocked
  from (select l.id,private.lesson_delete_blockers(l.id) b from public.lessons l where l.module_id=p_id) x cross join lateral unnest(x.b) r;
 if cardinality(reasons)>0 then
  raise exception 'Content is in use' using errcode='23503',detail=(jsonb_build_object('reasons',to_jsonb(reasons),'lessonIds',to_jsonb(blocked))||private.lesson_delete_counts(blocked))::text;
 end if;
 begin
  delete from public.course_modules where id=p_id;
 exception when foreign_key_violation or restrict_violation then
  raise exception 'Content is in use' using errcode='23503',detail=jsonb_build_object('reasons',jsonb_build_array('in_use'),'lessonIds','[]'::jsonb)::text;
 end;
 return p_id;
end $$;
revoke all on function private.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb) from public,anon;
grant execute on function private.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb) to authenticated;
create function public.edit_course_structure(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.edit_course_structure(p_course_id,p_action,p_id,p_parent_id,p_updated_at,p_data) $$;
revoke all on function public.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------
-- The read: chapters and lessons in order, with each chapter's stored label and each lesson's homework counts, delete blockers and what is inside. Course staff who cannot
-- edit (an assistant) may read; canEdit says which, and is false for everybody on an archived course. A homework counts once however many versions it has, by the status of
-- its newest version.
-- ---------------------------------------------------------------------------------------
create function private.course_structure(p_course_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare can_edit boolean; state text; n integer;
begin
 if private.current_app_user_id() is null or p_course_id is null then raise exception 'Course unavailable' using errcode='42501'; end if;
 can_edit:=private.can_edit_course(p_course_id);
 if not can_edit and not private.is_course_staff(p_course_id) then raise exception 'Course unavailable' using errcode='42501'; end if;
 select count(*) into n from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=p_course_id;
 if n>5000 then raise exception 'Content is too large' using errcode='PT413'; end if;
 select c.status into state from public.courses c where c.id=p_course_id;
 return jsonb_build_object('archived',state='archived','canEdit',can_edit and state<>'archived',
  'chapters',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'type',m.group_type,'number',m.chapter_number,'position',m.position,'updatedAt',m.updated_at) order by m.position,m.id) from public.course_modules m where m.course_id=p_course_id),'[]'::jsonb),
  'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'chapterId',l.module_id,'title',l.title,'position',l.position,'status',l.status,'updatedAt',l.updated_at,
    'homework',h.published,'draftHomework',h.draft,'deleteBlockers',to_jsonb(private.lesson_delete_blockers(l.id)),'contentBlocks',(select count(*) from public.lesson_blocks b where b.lesson_id=l.id),'hasCover',l.cover_asset_id is not null,'parts',(select count(*) from public.lesson_segments s where s.lesson_id=l.id)) order by m.position,m.id,l.position,l.id)
   from public.lessons l join public.course_modules m on m.id=l.module_id
   cross join lateral (select count(*) filter (where x.status='published') published,count(*) filter (where x.status='draft') draft
    from (select distinct on (a.family_id) a.status from public.homework_assignments a where a.lesson_id=l.id order by a.family_id,a.version desc) x) h
   where m.course_id=p_course_id),'[]'::jsonb));
end $$;
revoke all on function private.course_structure(uuid) from public,anon;
grant execute on function private.course_structure(uuid) to authenticated;
create function public.course_structure(p_course_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.course_structure(p_course_id) $$;
revoke all on function public.course_structure(uuid) from public,anon;
grant execute on function public.course_structure(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Fill, seed version 4 = version 3 with the content tree of the board. Same signature and grants.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamptz; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 groups_ uuid[]; fin_ uuid[] := '{}'; dra_ uuid[] := '{}'; g uuid; gi integer; n integer; sn integer := 0; st timestamptz; dur interval;
 pid uuid; eid uuid; mid uuid; a_status text; a_marked boolean; les_pub uuid; ev uuid; k integer; titles_ text[];
 n_courses integer := 0; n_lessons integer := 0; n_groups integer := 0; n_sessions integer := 0; n_students integer := 0;
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
   perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1;
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
   perform private.demo_track(p_org,'students','profiles',pid);
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

 update private.demo_spaces set seed_version=4,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',4,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5));
 return jsonb_build_object('seedVersion',4,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students);
end $$;

-- ---------------------------------------------------------------------------------------
-- Status: the latest seed version is now 4.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',4) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',4));
end $$;

commit;
