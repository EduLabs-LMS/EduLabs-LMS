-- A lesson is never tethered to one of its components (the owner's rule, 2026-11-10): "A lesson should never be tethered to one of its
-- components." Some teachers don't want videos, some don't want homework, some don't want exams, so a lesson may be published with no
-- parts, no videos, no content items, no cover and no homework. Draft; not applied anywhere. Migrations 20261018092002 and 20261106130000
-- are unchanged; their functions are replaced here.
--
-- * edit_learning_content, action edit_lesson: the "Publish a part first" refusal is removed. It was the only place the rule lived (no
--   trigger, check or policy asks for a part). Every other rule of the function is kept, including the part-level rule that a part
--   needs a video, notes, a resource or a content item before it is published.
-- * edit_course_structure gains publish_lesson and unpublish_lesson: can_edit_course, the course-root lock, the updated_at the teacher
--   read (stale: PT409), an archived course refused (PT409, reasons archived), as for every other structure change.
-- * The direct client grant update(status) on lessons is revoked, so a client publishes or unpublishes only through the function above
--   (or the old edit_lesson), never by a bare update with no lock, no version check and no archived check. title, position and
--   estimated_duration_seconds and description keep their grants. Definer functions are unaffected.
-- * course_structure already returns each lesson's status and is unchanged. No demo seed change.
begin;

create or replace function private.edit_learning_content(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; stamp timestamptz; parent uuid; item jsonb; n integer; i integer; tbl text; parent_col text;
begin
 perform 1 from public.courses c where c.id=p_course_id for update;
 if not private.can_edit_course(p_course_id) then raise exception 'Content editing denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid content' using errcode='23514'; end if;

 if p_action='edit_module_details' then
  select m.updated_at into stamp from public.course_modules m where m.id=p_id and m.course_id=p_course_id for update;
  if stamp is null then raise exception 'Module unavailable' using errcode='42501'; end if;
  if p_updated_at is null or stamp is distinct from p_updated_at then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
  if (p_data-array['title','group_type','chapter_number','summary','description'])<>'{}'::jsonb
   or length(trim(coalesce(p_data->>'title',''))) not between 1 and 120
   or length(trim(coalesce(p_data->>'group_type',''))) not between 1 and 24
   or (p_data->>'group_type') ~ '[[:cntrl:]]'
   or coalesce(p_data->>'chapter_number','') !~ '^[0-9]{1,2}$'
   or (p_data->>'chapter_number')::integer not between 1 and 99
   or length(coalesce(p_data->>'summary',''))>200 or length(coalesce(p_data->>'description',''))>2000 then
   raise exception 'Invalid chapter details' using errcode='23514';
  end if;
  update public.course_modules set title=trim(p_data->>'title'),group_type=trim(p_data->>'group_type'),chapter_number=(p_data->>'chapter_number')::integer,
   summary=coalesce(p_data->>'summary',''),description=coalesce(p_data->>'description','') where id=p_id;
  return p_id;
 end if;
 if p_action='set_lesson_cover' then
  select l.updated_at,l.cover_asset_id into stamp,target from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=p_id and m.course_id=p_course_id for update of l;
  if stamp is null then raise exception 'Lesson unavailable' using errcode='42501'; end if;
  if p_updated_at is null or stamp is distinct from p_updated_at then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
  if not (p_data ? 'cover_asset_id') or (p_data-'cover_asset_id')<>'{}'::jsonb then raise exception 'Invalid cover input' using errcode='23514'; end if;
  update public.lessons set cover_asset_id=(p_data->>'cover_asset_id')::uuid where id=p_id;
  return p_id;
 end if;

 if p_action in ('create_module','edit_module','reorder_modules') then tbl:='course_modules'; parent_col:='course_id'; parent:=p_course_id;
 elsif p_action in ('create_lesson','edit_lesson','reorder_lessons') then
  tbl:='lessons'; parent_col:='module_id';
  if p_action='edit_lesson' then select l.module_id into parent from public.lessons l where l.id=p_id; else parent:=p_parent_id; end if;
  if not exists(select 1 from public.course_modules m where m.id=parent and m.course_id=p_course_id) then raise exception 'Module unavailable' using errcode='42501'; end if;
 elsif p_action='edit_block' then
  tbl:='lesson_blocks'; parent_col:='lesson_id';select b.lesson_id into parent from public.lesson_blocks b where b.id=p_id;
  if not exists(select 1 from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=parent and m.course_id=p_course_id) then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 elsif p_action in ('create_segment','edit_segment','reorder_segments','attach_resource','remove_resource') then
  tbl:='lesson_segments'; parent_col:='lesson_id';
  if p_action in ('edit_segment','attach_resource','remove_resource') then select s.lesson_id into parent from public.lesson_segments s where s.id=p_id; else parent:=p_parent_id; end if;
  if not exists(select 1 from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=parent and m.course_id=p_course_id) then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 else raise exception 'Unknown content action' using errcode='23514'; end if;
 if p_action like 'create_%' then
  if length(trim(coalesce(p_data->>'title',''))) not between 1 and 200 then raise exception 'Title required' using errcode='23514'; end if;
  execute format('select coalesce(max(position),-1)+1 from public.%I where %I=$1',tbl,parent_col) into n using parent;
  if n>=500 then raise exception 'Content limit reached' using errcode='23514'; end if;
  execute format('insert into public.%I(%I,title,position) values($1,$2,$3) returning id',tbl,parent_col) into target using parent,trim(p_data->>'title'),n;
  return target;
 end if;
 if p_action like 'reorder_%' then
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items')>500 then raise exception 'Invalid order' using errcode='23514'; end if;
  execute format('select count(*) from public.%I where %I=$1',tbl,parent_col) into n using parent;
  if n<>jsonb_array_length(p_data->'items') or n<>(select count(distinct x->>'id') from jsonb_array_elements(p_data->'items') x) then raise exception 'Order changed. Reload.' using errcode='PT409'; end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   execute format('select updated_at from public.%I where id=$1 and %I=$2',tbl,parent_col) into stamp using (item->>'id')::uuid,parent;
   if stamp is null or stamp is distinct from (item->>'updated_at')::timestamptz then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
  end loop;
  -- Temporarily shift above the current maximum to satisfy immediate UNIQUE indexes.
  execute format('select coalesce(max(position),0)+1 from public.%I where %I=$1',tbl,parent_col) into i using parent;
  execute format('update public.%I set position=position+$2 where %I=$1',tbl,parent_col) using parent,i;
  i:=0;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   execute format('update public.%I set position=$2 where id=$1',tbl) using (item->>'id')::uuid,i; i:=i+1;
  end loop;
  return parent;
 end if;
 execute format('select updated_at from public.%I where id=$1 and %I=$2',tbl,parent_col) into stamp using p_id,parent;
 if stamp is null then raise exception 'Content unavailable' using errcode='42501'; end if;
 if p_updated_at is null or stamp is distinct from p_updated_at then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;
 if p_action='edit_block' then
  if jsonb_typeof(p_data->'text') is distinct from 'string' or length(p_data->>'text')>100000 or not exists(select 1 from public.lesson_blocks b where b.id=p_id and b.block_type in ('text','heading','callout')) then raise exception 'Invalid text block' using errcode='23514'; end if;
  update public.lesson_blocks set content=(content-'html')||jsonb_build_object('text',p_data->>'text') where id=p_id;return p_id;
 end if;
 if p_action='attach_resource' then
  insert into public.lesson_resources(segment_id,name,media_asset_id) values(p_id,p_data->>'name',(p_data->>'asset_id')::uuid) returning id into target;
  update public.lesson_segments set title=title where id=p_id; return target;
 elsif p_action='remove_resource' then
  delete from public.lesson_resources where id=(p_data->>'resource_id')::uuid and segment_id=p_id;
  update public.lesson_segments set title=title where id=p_id; return p_id;
 end if;
 if length(trim(coalesce(p_data->>'title',''))) not between 1 and 200 or length(coalesce(p_data->>'description',''))>100000 then raise exception 'Invalid title/description' using errcode='23514'; end if;
 if p_action='edit_module' then update public.course_modules set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),group_type=coalesce(p_data->>'group_type',group_type) where id=p_id;
 elsif p_action='edit_lesson' then
  update public.lessons set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),status=p_data->>'status' where id=p_id;
 else
  if p_data->>'status'='published' and nullif(trim(p_data->>'description'),'') is null and nullif(p_data->>'video_url','') is null and nullif(p_data->>'video_asset_id','') is null and not exists(select 1 from public.lesson_resources r where r.segment_id=p_id) and not exists(select 1 from public.lesson_blocks b where b.lesson_id=parent) then raise exception 'Add video, notes or a resource first' using errcode='23514'; end if;
  update public.lesson_segments set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),status=p_data->>'status',video_url=nullif(p_data->>'video_url',''),video_asset_id=nullif(p_data->>'video_asset_id','')::uuid,thumbnail_asset_id=nullif(p_data->>'thumbnail_asset_id','')::uuid where id=p_id;
 end if;
 return p_id;
end $$;

create or replace function private.edit_course_structure(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid
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
 elsif p_action in ('rename_lesson','delete_lesson','move_lesson','publish_lesson','unpublish_lesson') then
  select l.updated_at into stamp from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=p_id and m.course_id=p_course_id for update of l;
  if stamp is null then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 else raise exception 'Unknown content action' using errcode='23514'; end if;
 if p_updated_at is null or stamp is distinct from p_updated_at then raise exception 'Content changed. Reload.' using errcode='PT409'; end if;

 if p_action='rename_chapter' then update public.course_modules set title=name_ where id=p_id; return p_id; end if;
 if p_action='rename_lesson' then update public.lessons set title=name_ where id=p_id; return p_id; end if;
 -- Publish or unpublish a lesson: only its status. No part, video, content item, cover or homework is needed (the owner's rule), nothing is copied and no
 -- version is made. Unpublishing keeps every answer, grade and file; students stop seeing the lesson and its homework until it is published again.
 -- Asking for the state it is already in writes nothing.
 if p_action in ('publish_lesson','unpublish_lesson') then
  if p_data<>'{}'::jsonb then raise exception 'Invalid content' using errcode='23514'; end if;
  update public.lessons set status=case when p_action='publish_lesson' then 'published' else 'draft' end
   where id=p_id and status<>case when p_action='publish_lesson' then 'published' else 'draft' end;
  return p_id;
 end if;

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

-- Publishing goes through the functions, never a bare client update.
revoke update(status) on public.lessons from authenticated;

commit;
