-- The rules BEFORE fix track 2a (20261127140000_my_scope_content.sql), for comparison only: the eight read policies with their old
-- per-row helpers (the exact expressions of pg_policies before the migration) and the old save_segment_progress (20261013141230). Applied
-- only to a disposable clone by scripts/my-scope-proof.cjs, so old and new rules run on identical rows. Never a migration.
begin;
alter policy courses_select on public.courses using (private.can_view_course(id));
alter policy organizations_select on public.organizations using (private.is_org_member(id) or exists(select 1 from public.courses c where c.organization_id=organizations.id and private.can_view_course(c.id)));
alter policy profiles_select on public.profiles using (private.can_view_profile(id));
alter policy course_modules_select on public.course_modules using (private.can_view_course(course_id));
alter policy lessons_select on public.lessons using (private.can_view_lesson(id));
alter policy lesson_blocks_select on public.lesson_blocks using (private.can_view_lesson(lesson_id));
alter policy segments_read on public.lesson_segments using (private.can_view_segment(id));
alter policy resources_read on public.lesson_resources using (private.can_view_segment(segment_id));
CREATE OR REPLACE FUNCTION private.save_segment_progress(p_offering_id uuid, p_segment_id uuid, p_position integer, p_complete boolean, p_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.lesson_segments; p public.lesson_segment_progress; c uuid; total integer; done integer;
begin
 select x.* into s from public.lesson_segments x where x.id=p_segment_id for share;
 select m.course_id into c from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=s.lesson_id;
 -- Enrollment lock serializes saves for this student/offering, including different parts.
 perform 1 from public.enrollments e where e.offering_id=p_offering_id and e.user_id=(select private.current_app_user_id()) for share;
 if s.id is null or s.status<>'published' or not private.can_view_segment(s.id) or not private.is_enrolled(p_offering_id)
 or not exists(select 1 from public.course_offerings o where o.id=p_offering_id and o.course_id=c) then raise exception 'Lesson access denied' using errcode='42501'; end if;
 if p_position is null or p_position not between 0 and 604800 or p_complete is null or p_revision is null then raise exception 'Invalid progress' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_offering_id::text||':'||(select private.current_app_user_id())::text,0));
 select * into p from public.lesson_segment_progress x where x.offering_id=p_offering_id and x.segment_id=s.id and x.user_id=(select private.current_app_user_id()) for update;
 if coalesce(p.revision,0)<>p_revision then raise exception 'Progress changed. Reload.' using errcode='PT409'; end if;
 insert into public.lesson_segment_progress(offering_id,user_id,segment_id,lesson_id,status,video_position_seconds,completed_at,revision)
 values(p_offering_id,(select private.current_app_user_id()),s.id,s.lesson_id,case when p_complete then 'completed' else 'in_progress' end,p_position,case when p_complete then now() end,1)
 on conflict(offering_id,user_id,segment_id) do update set video_position_seconds=excluded.video_position_seconds,
 status=case when lesson_segment_progress.status='completed' or p_complete then 'completed' else 'in_progress' end,
 completed_at=coalesce(lesson_segment_progress.completed_at,excluded.completed_at),revision=lesson_segment_progress.revision+1 returning * into p;
 select count(*),count(*) filter(where x.status='completed') into total,done from public.lesson_segments sg left join public.lesson_segment_progress x on x.segment_id=sg.id and x.offering_id=p_offering_id and x.user_id=(select private.current_app_user_id()) where sg.lesson_id=s.lesson_id and sg.status='published';
 insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at,completed_at,last_accessed_at,video_position_seconds)
 values(p_offering_id,s.lesson_id,(select private.current_app_user_id()),case when total>0 and total=done then 'completed' else 'in_progress' end,now(),case when total>0 and total=done then now() end,now(),p_position)
 on conflict(offering_id,lesson_id,user_id) do update set status=excluded.status,completed_at=excluded.completed_at,last_accessed_at=now(),video_position_seconds=excluded.video_position_seconds;
 return jsonb_build_object('revision',p.revision,'status',p.status,'position',p.video_position_seconds);
end $function$

;
commit;
