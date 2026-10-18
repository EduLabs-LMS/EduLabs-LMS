-- Milestone 2A. Additive lesson cover; no existing asset or academic data backfill.
alter table public.lessons add column cover_asset_id uuid references public.media_assets(id) on delete restrict;
create index lessons_cover_asset_idx on public.lessons(cover_asset_id) where cover_asset_id is not null;
-- Existing lessons RLS and SELECT grants apply. New column has no direct UPDATE grant.
create function private.check_lesson_cover() returns trigger language plpgsql security definer set search_path='' as $$
declare course uuid; org uuid;
begin
 if new.cover_asset_id is null then return new; end if;
 select m.course_id,c.organization_id into course,org from public.course_modules m join public.courses c on c.id=m.course_id where m.id=new.module_id;
 perform 1 from public.media_assets a where a.id=new.cover_asset_id for share;
 if not exists(select 1 from public.media_assets a join private.lesson_upload_scopes s on s.asset_id=a.id
  where a.id=new.cover_asset_id and s.course_id=course and a.organization_id=org and a.bucket='lms-course-media' and a.status='ready'
   and a.kind='image' and a.mime_type in ('image/png','image/jpeg','image/webp') and a.size_bytes between 1 and 5242880)
  or (private.current_app_user_id() is not null and not private.can_edit_course(course)) then
  raise exception 'Invalid lesson cover' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.check_lesson_cover() from public,anon,authenticated,service_role;
create trigger check_lesson_cover before insert or update of cover_asset_id,module_id on public.lessons for each row execute function private.check_lesson_cover();
create or replace function private.edit_learning_content(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; stamp timestamptz; parent uuid; item jsonb; n integer; i integer; tbl text; parent_col text;
begin
 perform 1 from public.courses c where c.id=p_course_id for update;
 if not private.can_edit_course(p_course_id) then raise exception 'Content editing denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid content' using errcode='23514'; end if;
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
  if p_data->>'status'='published' and not exists(select 1 from public.lesson_segments s where s.lesson_id=p_id and s.status='published') then raise exception 'Publish a part first' using errcode='23514'; end if;
  update public.lessons set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),status=p_data->>'status' where id=p_id;
 else
  if p_data->>'status'='published' and nullif(trim(p_data->>'description'),'') is null and nullif(p_data->>'video_url','') is null and nullif(p_data->>'video_asset_id','') is null and not exists(select 1 from public.lesson_resources r where r.segment_id=p_id) and not exists(select 1 from public.lesson_blocks b where b.lesson_id=parent) then raise exception 'Add video, notes or a resource first' using errcode='23514'; end if;
  update public.lesson_segments set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),status=p_data->>'status',video_url=nullif(p_data->>'video_url',''),video_asset_id=nullif(p_data->>'video_asset_id','')::uuid,thumbnail_asset_id=nullif(p_data->>'thumbnail_asset_id','')::uuid where id=p_id;
 end if;
 return p_id;
end $$;

create or replace function private.can_view_media(asset_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.media_assets a where a.id=$1 and
 (a.uploaded_by=(select private.current_app_user_id()) and private.is_active_user() or private.has_org_role(a.organization_id,array['owner','admin'])
 or (a.offering_id is not null and private.can_support_offering(a.offering_id))
 or exists(select 1 from public.lesson_blocks b where b.media_asset_id=a.id and private.can_view_lesson(b.lesson_id))
 or exists(select 1 from public.lesson_segments s where (s.video_asset_id=a.id or s.thumbnail_asset_id=a.id) and private.can_view_segment(s.id))
 or exists(select 1 from public.lessons l where l.cover_asset_id=a.id and private.can_view_lesson(l.id))
 or exists(select 1 from public.lesson_resources r where r.media_asset_id=a.id and private.can_view_segment(r.segment_id))))
$$;

create or replace function private.archive_unused_lesson_upload(p_asset_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.media_assets;
begin
 select * into m from public.media_assets where id=p_asset_id for update;
 if m.id is null or m.bucket<>'lms-course-media' or m.uploaded_by is distinct from (select private.current_app_user_id()) or not private.is_active_user() then raise exception 'Cleanup denied' using errcode='42501'; end if;
 if exists(select 1 from public.lessons l where l.cover_asset_id=m.id) or exists(select 1 from public.lesson_blocks b where b.media_asset_id=m.id) or exists(select 1 from public.assessment_responses r where r.media_asset_id=m.id)
 or exists(select 1 from public.lesson_segments s where s.video_asset_id=m.id or s.thumbnail_asset_id=m.id) or exists(select 1 from public.lesson_resources r where r.media_asset_id=m.id) then raise exception 'Media is referenced' using errcode='23514'; end if;
 update public.media_assets set status='archived' where id=m.id;
end $$;

create or replace function private.can_remove_lesson_upload(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select p_bucket='lms-course-media' and private.is_active_user() and exists(select 1 from public.media_assets m where m.bucket=p_bucket and m.object_path=p_path
 and m.status='archived' and m.uploaded_by=(select private.current_app_user_id())
 and not exists(select 1 from public.lessons l where l.cover_asset_id=m.id)
 and not exists(select 1 from public.lesson_blocks b where b.media_asset_id=m.id)
 and not exists(select 1 from public.assessment_responses r where r.media_asset_id=m.id)
 and not exists(select 1 from public.lesson_segments s where s.video_asset_id=m.id or s.thumbnail_asset_id=m.id)
 and not exists(select 1 from public.lesson_resources r where r.media_asset_id=m.id))
$$;

create or replace view private.expired_media_uploads with (security_invoker=true) as
 select id,organization_id,uploaded_by,storage_provider,bucket,object_path,upload_expires_at
 from public.media_assets m where ((status='pending' and upload_expires_at<now()) or status='archived')
 and not exists(select 1 from public.lessons l where l.cover_asset_id=m.id)
 and not exists(select 1 from public.lesson_blocks b where b.media_asset_id=m.id)
 and not exists(select 1 from public.assessment_responses r where r.media_asset_id=m.id)
 and not exists(select 1 from public.lesson_segments s where s.video_asset_id=m.id or s.thumbnail_asset_id=m.id)
 and not exists(select 1 from public.lesson_resources r where r.media_asset_id=m.id);
