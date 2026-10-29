-- Demo seed version 2: fake students and past Sessions with attendance, so Take attendance (and later the Students, Homework and Reports
-- screens) can be tried in a demo space without real people. Migration 34 (20261027120000_demo_spaces.sql) and the clear-robust follow-up
-- (20261029120000_demo_clear_robust.sql) are unchanged; this replaces four of their functions (same signatures, same grants) and adds one helper.
--
-- A demo student is a plain public.profiles row with a random id and the name "Demo Student N". There is no auth.users row (the profiles
-- foreign key to auth.users was removed by 20261010123515), no private.external_identities row, no e-mail anywhere and no organization
-- membership, so nobody can sign in as one and none can match a real account. Every profile, enrollment and Group membership the fill creates
-- is recorded in private.demo_seed_rows, and Clear removes exactly those.
--
-- The guards "a space with enrolled students cannot become a demo space / receive demo data / be cleared" now count only enrollments that
-- are NOT recorded as demo seed rows. A space with a real student is still refused by all three.
--
-- Existing demo spaces filled at seed version 1 are not upgraded in place: Clear, then Fill, gives them version 2.
begin;

-- ---------------------------------------------------------------------------------------
-- Registry: three more tables may be recorded. (Attendance rows have a composite key; they are removed with the Sessions they belong to.)
-- ---------------------------------------------------------------------------------------
alter table private.demo_seed_rows drop constraint demo_seed_rows_table_name_check;
alter table private.demo_seed_rows add constraint demo_seed_rows_table_name_check check (table_name in
 ('courses','course_modules','lessons','course_offerings','study_groups','group_staff','group_sessions','profiles','enrollments','group_memberships'));

-- ---------------------------------------------------------------------------------------
-- Helper: does the space have a student who is not a demo student?
-- ---------------------------------------------------------------------------------------
create function private.space_has_real_students(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id
  where c.organization_id=p_org
  and not exists(select 1 from private.demo_seed_rows d where d.organization_id=p_org and d.table_name='enrollments' and d.row_id=e.id))
$$;
revoke all on function private.space_has_real_students(uuid) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- Marking: only a real student blocks it.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_set_demo_space(p_org uuid,p_on boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id();
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_org is null or p_on is null or not exists(select 1 from private.teacher_invitations where organization_id=p_org) then
  raise exception 'Portal unavailable' using errcode='PT404'; end if;
 perform 1 from public.organizations where id=p_org for update;
 if p_on then
  if private.space_has_real_students(p_org) then
   raise exception 'A space with enrolled students cannot become a demo space' using errcode='PT409'; end if;
  insert into private.demo_spaces(organization_id,marked_by) values(p_org,u) on conflict do nothing;
  perform private.write_platform_audit(u,'demo.mark','organization',p_org,p_org,'{}'::jsonb);
 else
  if exists(select 1 from private.demo_spaces where organization_id=p_org and filled_at is not null) then
   raise exception 'Clear the demo data before turning demo off' using errcode='PT409'; end if;
  delete from private.demo_spaces where organization_id=p_org;
  perform private.write_platform_audit(u,'demo.unmark','organization',p_org,p_org,'{}'::jsonb);
 end if;
 return jsonb_build_object('organizationId',p_org,'demo',p_on);
end $$;

-- ---------------------------------------------------------------------------------------
-- Fill, seed version 2 = version 1 (courses, chapters, lessons, one offering, two Groups with upcoming Sessions) plus, per Group, two past
-- Sessions (one finalized with a mix of present and absent, one draft with some students marked and some not) and 14 fake students.
-- The past Sessions are created before the students, so no notice is sent for them.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamptz; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 groups_ uuid[]; fin_ uuid[] := '{}'; dra_ uuid[] := '{}'; g uuid; gi integer; n integer; sn integer := 0; st timestamptz; dur interval;
 pid uuid; eid uuid; mid uuid; a_status text; a_marked boolean;
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

 -- Courses: A (published) and B (draft), chapters with published and draft lessons.
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Physics, Third Secondary','demo-physics','published','private',v_owner) returning id into crs_a;
 perform private.demo_track(p_org,'courses','courses',crs_a);
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Chemistry, Second Secondary','demo-chemistry','draft','private',v_owner) returning id into crs_b;
 perform private.demo_track(p_org,'courses','courses',crs_b);
 n_courses := 2;
 for i in 0..1 loop
  insert into public.course_modules(course_id,title,position) values(crs_a,'Demo chapter '||(i+1),i) returning id into mod_id;
  perform private.demo_track(p_org,'courses','course_modules',mod_id);
  for j in 0..1 loop
   insert into public.lessons(module_id,title,position,status) values(mod_id,'Demo lesson '||(i*2+j+1),j,case when j=0 then 'published' else 'draft' end) returning id into s;
   perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1;
  end loop;
 end loop;
 insert into public.course_modules(course_id,title,position) values(crs_b,'Demo chapter 1',0) returning id into mod_id;
 perform private.demo_track(p_org,'courses','course_modules',mod_id);
 insert into public.lessons(module_id,title,position,status) values(mod_id,'Demo lesson 1',0,'draft') returning id into s;
 perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1;
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

 update private.demo_spaces set seed_version=2,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',2,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students));
 return jsonb_build_object('seedVersion',2,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students);
end $$;

-- ---------------------------------------------------------------------------------------
-- Clear, replacing the one from 20261029120000_demo_clear_robust.sql. It works from the recorded COURSES, Groups and the demo students of
-- the one space. It removes the demo students (attendance, Group memberships, enrollments, their notices and the fake profiles) together with
-- everything the robust version removed, and it refuses, naming what it found, when the space has an enrollment that is not a demo
-- enrollment or content it does not remove: homework, exams, media, lesson segments, website publications, access links, enrollment
-- requests, student progress. It never matches by name.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 courses_ uuid[]; offerings_ uuid[]; groups_ uuid[]; sessions_ uuid[]; events_ uuid[]; lessons_ uuid[]; profiles_ uuid[]; enrollments_ uuid[]; blockers_ text[] := '{}';
 n_tracked integer := 0; n_added integer := 0; n_support integer := 0; cnt integer;
 added jsonb := '{}'::jsonb;
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

 -- A real student (any enrollment that is not recorded as a demo enrollment), and content this function does not remove. Refuse, naming it.
 if private.space_has_real_students(p_org) then blockers_ := array_append(blockers_,'enrolled students'::text); end if;
 if exists(select 1 from public.homework_assignments where course_id=any(courses_) or offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'homework'::text); end if;
 if exists(select 1 from public.assessments where course_id=any(courses_)) or exists(select 1 from public.offering_assessments where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'exams'::text); end if;
 if exists(select 1 from public.media_assets where offering_id=any(offerings_)) or exists(select 1 from private.lesson_upload_scopes where course_id=any(courses_)) then blockers_ := array_append(blockers_,'media'::text); end if;
 if exists(select 1 from public.lesson_segments where lesson_id=any(lessons_)) then blockers_ := array_append(blockers_,'lesson segments'::text); end if;
 if exists(select 1 from public.lesson_progress where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'student progress'::text); end if;
 if exists(select 1 from public.website_catalog_entries where course_id=any(courses_)) or exists(select 1 from private.website_publication_courses where course_id=any(courses_)) then blockers_ := array_append(blockers_,'website courses'::text); end if;
 if exists(select 1 from private.student_access_links where offering_id=any(offerings_)) or exists(select 1 from public.enrollment_requests where offering_id=any(offerings_))
   or exists(select 1 from private.student_admin_audit where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'student access'::text); end if;
 if cardinality(blockers_)>0 then
  raise exception 'This demo space holds content that Clear does not remove: %. Remove it first.',array_to_string(blockers_,', ') using errcode='PT409'; end if;

 -- Notifications that belong to the Groups, Sessions and demo students (by event key prefix, session, group, enrollment or recipient).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id=any(sessions_) or resource_id=any(groups_) or resource_id=any(sessions_) or resource_id=any(enrollments_)
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
-- Status: the latest seed version is now 2.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',2) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',2));
end $$;

commit;
