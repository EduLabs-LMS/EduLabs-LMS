-- Demo seed version 6: a published lesson with homework and no parts (draft; not applied). Docs: docs/ai/DEMO_DATA.md, "Demo lesson with no
-- parts (seed version 6)".
--
-- Correcting, the Home card "Homework to correct" and the student side need no new read: correcting uses homework_queue, get_homework (the
-- homework and one try, for staff), homework_work (grade, release) and homework_release_many; the Home card uses homework_portal; the student
-- lesson page uses the existing RLS reads. This migration only replaces private.demo_fill_core and private.platform_demo_status.
--
-- demo_fill_core is version 5 (20261109120000) copied unchanged, plus the seed version 6 module just before the version is stored. Same
-- signature and grants (create or replace keeps them). demo_clear_core is not replaced: it starts from the recorded courses and already
-- removes every lesson, homework, try, photo row and notification under them, and it still refuses (removing nothing) while a try by a real
-- person or a stored file under one of those homework exists. No table, column or allowed-table list changes.
--
-- Release notifications are not touched here: a single release (homework_work 'release') and a bulk release (homework_release_many) both set
-- private.homework_corrections.released_at, and the row trigger notification_homework (20261015185510, replaced in 20261018100132) emits one
-- homework_released notification per released try. supabase/tests/homework-correct.sql proves the two paths notify the same way.
begin;

-- ---------------------------------------------------------------------------------------
-- Fill, seed version 6 = version 5 plus "Magnetism review", a published lesson with no parts and one homework with tries in every state.
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

 update private.demo_spaces set seed_version=6,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',6,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5,'homework',5));
 return jsonb_build_object('seedVersion',6,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'homework',5);
end $$;

-- ---------------------------------------------------------------------------------------
-- Status: the latest seed version is now 6.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',6) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',6));
end $$;

commit;
