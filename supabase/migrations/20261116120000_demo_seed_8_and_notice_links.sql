-- Demo seed version 8 and the homework notice link. Applied after 20261115120000_exams_drafts_and_demo_v7.sql, which is not edited.
-- Resolves the caller with private.current_app_user_id(), never auth.uid(). create or replace keeps the existing grants.
--   (a) demo_fill_core: `v_day` was a timestamptz that held a Cairo WALL time, so the later `... at time zone 'Africa/Cairo'` turned a
--       timestamp into the wrong instant whenever the database session was not already on Cairo time. On the hosted database (UTC) Demo Group 2's
--       20:00 became 00:00 the next day in Cairo, Group 1's 18:00 became 22:00, and the homework deadlines moved the same way. A local server that
--       runs on Cairo time hid it. `v_day` is now a plain timestamp (a wall time), so every `at time zone 'Africa/Cairo'` yields the instant meant,
--       in any session time zone. Nothing else in the body changed; the seed version is 8. A filled space is not upgraded in place (Clear, then Fill).
--   (b) notification_link: a homework_released notice for homework in a lesson with no published part linked to nothing. It now opens the student
--       lesson page by lesson id, /courses/<course>/lessons/<lesson>?offering=<offering>. Every other case, including the link to a part, is unchanged.
begin;

-- ---------------------------------------------------------------------------------------
-- (a) Fill, seed version 8 = version 7 (20261115120000) with the one time-zone fix above.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamp; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
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

 update private.demo_spaces set seed_version=8,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',8,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5,'homework',5,'exams',n_exams));
 return jsonb_build_object('seedVersion',8,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'homework',5,'exams',n_exams);
end $$;

-- ---------------------------------------------------------------------------------------
-- Status: the latest seed version is now 8.
-- ---------------------------------------------------------------------------------------
create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',8) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',8));
end $$;

-- ---------------------------------------------------------------------------------------
-- (b) notification_link: the same function as 20261115120000 with one added line (marked below).
-- ---------------------------------------------------------------------------------------
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
  -- (b) NEW: homework in a lesson with no published part opens the lesson page by its id (a published lesson only: the page refuses any other).
  if part is null and off is not null and e.event_type='homework_released' and exists(select 1 from public.lessons x where x.id=l.id and x.status='published') then
   return '/courses/'||course||'/lessons/'||l.id||'?offering='||off;end if;
 end if;return null;
end $$;

commit;
