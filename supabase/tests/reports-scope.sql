-- Disposable local PostgreSQL only. Synthetic people only; everything rolls back. Fix track 2c (A8-02, A8-04): the reports read only what they show.
-- The ten functions 20261128130000_reports_scope.sql replaces run side by side under *_before names, exactly as 20261117120000_reports.sql
-- defines them (supabase/tests/reports-scope-before.sql; scripts/reports-scope-proof.cjs checks that file against the migration text).
-- Proves, on a demo fill and two synthetic schools (a suspended, a reactivated, a transferred and a mid-term student; students in no Group):
--  1. the fact functions: unscoped, by Group, by several Groups, by student and "active only" return exactly the old rows that match, for
--     every run and every range (Last 4 weeks, this month, last month, Whole course); report_stats the same;
--  2. every report read, as JSON, for every caller (owner, admin, teacher, assistant with and without a Group, course editor and assistant,
--     a student, another space, a platform admin, no space, no token): report_group, report_student and report_course in every range,
--     report_attention for all courses and each run (pages), and the Groups list asked 25 Groups at a time, joined back, equal to the old
--     single read (and the same single call equal too);
--  3. structure: the scoped functions are internal (no grant), plpgsql with force_custom_plan; the five reads keep their grants.
begin;
create temp table rs_results(name text primary key);
create temp table rs_count(kind text primary key, n integer not null default 0);
create temp table rs_diff(kind text, caller text, item text, o text, n text);
grant select,insert,update on rs_results,rs_count,rs_diff to authenticated;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.rs_results values(label);end$$;
-- No difference, or fail naming the first one.
create function pg_temp.nodiff(label text) returns void language plpgsql as $$begin
 if exists(select 1 from pg_temp.rs_diff) then raise exception 'FAILED % FIRST DIFFERENCE %',label,(select left(row_to_json(d)::text,3000) from pg_temp.rs_diff d limit 1); end if;
 insert into pg_temp.rs_results values(label);end$$;
create function pg_temp.cnt(k text) returns void language sql as $$insert into pg_temp.rs_count values(k,1) on conflict (kind) do update set n=pg_temp.rs_count.n+1$$;

-- fixture-begin (scripts/reports-scope-proof.cjs runs this section too)
create function pg_temp.u(label text) returns uuid language sql immutable as $$select md5('my-scope:person:'||label)::uuid$$;
create function pg_temp.k(label text) returns uuid language sql immutable as $$select md5('my-scope:key:'||label)::uuid$$;
create function pg_temp.person(label text,profile_status text default 'active') returns void language sql as $$
 insert into public.profiles(id,display_name,status) values(pg_temp.u(label),'My scope '||label,profile_status);
 insert into private.external_identities(profile_id,provider,issuer,subject,verified_at) values(pg_temp.u(label),'firebase','https://securetoken.google.com/diagonproduction','my-scope-'||label,now());$$;
-- The token a Firebase user of the fixture presents ('none' = no token at all).
create function pg_temp.claims(label text) returns text language sql stable as $$
 select case when label='none' then '' else jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'sub','my-scope-'||label,'auth_time',floor(extract(epoch from now()))::bigint)::text end$$;
-- A demo fill (the demo makers need a demo space), a platform administrator and a signed-in person with no space.
select pg_temp.person('demo_admin'); select pg_temp.person('demo_owner'); select pg_temp.person('padmin'); select pg_temp.person('nospace');
insert into private.platform_admins(user_id,note) values(pg_temp.u('demo_admin'),'reports-scope demo admin'),(pg_temp.u('padmin'),'reports-scope admin');
insert into public.organizations(id,name,slug) values(pg_temp.k('DEMO'),'Reports scope demo','reports-scope-demo');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.k('DEMO'),pg_temp.u('demo_owner'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.k('DEMO'),pg_temp.u('demo_admin'));
select private.demo_fill_core(pg_temp.k('DEMO'),pg_temp.u('demo_admin'));
-- fixture-end
-- school-begin (scripts/reports-scope-proof.cjs runs this section too)
-- A synthetic school: one space, p_runs course runs (teacher i instructs run i), p_groups Groups of p_per students in each run, p_sessions
-- sessions per Group and p_hw homework and p_ex exams per run, spread over the last p_days days (the last two homework, the last exam and two
-- sessions per Group are still ahead). Inserted with triggers off (as Part 8's audit did), deterministic ids, states from hashes.
-- People who sign in (pg_temp.person): <tag>_owner, _admin, _t1.._tN, _asst (assistant of run 1 and staff of its Group 1), _asst2 (assistant
-- of run 1, no Group), _cse (course editor of course 1), _csa (course assistant of course 1), _student (a student of run 1, Group 1).
-- In run 1: a suspended student, a reactivated one (as student_administration('reactivate') writes it: active, enrolled_at = now), one
-- transferred from Group 1 to Group 2 half way, one who joined half way, and three enrolled students in no Group.
create function pg_temp.school(tag text,p_runs integer,p_groups integer,p_per integer,p_sessions integer,p_hw integer,p_ex integer,p_days integer) returns void language plpgsql as $$
#variable_conflict use_column
declare b timestamptz:=now(); span interval:=make_interval(days=>p_days); org uuid:=md5('rp2c:'||tag||':org')::uuid; ow uuid; r integer; i integer; j integer;
 crs uuid; off uuid; m1 uuid; m2 uuid; l1 uuid; l2 uuid; l3 uuid; hw uuid; ex uuid; ref timestamptz; kind_ text; mid timestamptz:=now()-make_interval(days=>p_days/2);
 k text:='rp2c:'||tag||':';
begin
 perform pg_temp.person(tag||'_owner'); perform pg_temp.person(tag||'_admin'); perform pg_temp.person(tag||'_asst'); perform pg_temp.person(tag||'_asst2');
 perform pg_temp.person(tag||'_cse'); perform pg_temp.person(tag||'_csa'); perform pg_temp.person(tag||'_student');
 for r in 1..p_runs loop perform pg_temp.person(tag||'_t'||r); end loop;
 ow:=pg_temp.u(tag||'_owner');
 set local session_replication_role=replica;
 insert into public.organizations(id,name,slug,status) values(org,'School '||tag,'rp2c-'||lower(tag),'active');
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
  select org,pg_temp.u(tag||x.l),x.r,'active',b-span-interval '30 days' from (values('_owner','owner'),('_admin','admin'),('_asst','assistant'),('_asst2','assistant'),('_cse','teacher'),('_csa','assistant')) x(l,r)
  union all select org,pg_temp.u(tag||'_t'||n),'teacher','active',b-span-interval '30 days' from generate_series(1,p_runs) n;
 for r in 1..p_runs loop
  crs:=md5(k||'c'||r)::uuid; off:=md5(k||'o'||r)::uuid; m1:=md5(k||'m1:'||r)::uuid; m2:=md5(k||'m2:'||r)::uuid; l1:=md5(k||'l1:'||r)::uuid; l2:=md5(k||'l2:'||r)::uuid; l3:=md5(k||'l3:'||r)::uuid;
  insert into public.courses(id,organization_id,title,slug,status,visibility,created_by,created_at) values(crs,org,tag||' course '||r,'rp2c-'||lower(tag)||'-'||r,'published','private',ow,b-span-interval '20 days');
  insert into public.course_offerings(id,course_id,name,delivery_mode,status,created_at) values(off,crs,tag||' run '||r,'scheduled','active',b-span-interval '20 days');
  insert into public.offering_staff(offering_id,user_id,role) values(off,pg_temp.u(tag||'_t'||r),'instructor');
  if r=1 then
   insert into public.offering_staff(offering_id,user_id,role) values(off,pg_temp.u(tag||'_asst'),'teaching_assistant'),(off,pg_temp.u(tag||'_asst2'),'teaching_assistant');
   insert into public.course_staff(course_id,user_id,role) values(crs,pg_temp.u(tag||'_cse'),'editor'),(crs,pg_temp.u(tag||'_csa'),'assistant');
  end if;
  insert into public.course_modules(id,course_id,title,position,chapter_number) values(m1,crs,'Chapter one',0,1),(m2,crs,'Chapter two',1,2);
  insert into public.lessons(id,module_id,title,position,status) values(l1,m1,'Lesson one',0,'published'),(l2,m1,'Lesson draft',1,'draft'),(l3,m2,'Lesson three',0,'published');
  -- students: p_groups*p_per in Groups, then 3 in no Group; in run 1 the first student of Group 1 is the signed-in <tag>_student
  insert into public.profiles(id,display_name) select md5(k||'s'||r||':'||n)::uuid,tag||' student '||r||'-'||lpad(n::text,5,'0') from generate_series(case when r=1 then 2 else 1 end,p_groups*p_per+3) n;
  insert into public.enrollments(id,offering_id,user_id,status,enrolled_at)
   select md5(k||'e'||r||':'||n)::uuid,off,case when r=1 and n=1 then pg_temp.u(tag||'_student') else md5(k||'s'||r||':'||n)::uuid end,'active',b-span-interval '10 days' from generate_series(1,p_groups*p_per+3) n;
  for i in 1..p_groups loop
   insert into public.study_groups(id,offering_id,name,mode,location,created_by,created_at) values(md5(k||'g'||r||':'||i)::uuid,off,tag||' group '||r||'-'||lpad(i::text,2,'0'),'center','Room',ow,b-span-interval '10 days');
  end loop;
  if r=1 then insert into public.group_staff(group_id,user_id) values(md5(k||'g1:1')::uuid,pg_temp.u(tag||'_asst')); end if;
  insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
   select md5(k||'gm'||r||':'||n)::uuid,md5(k||'g'||r||':'||((n-1)/p_per+1))::uuid,off,e.user_id,e.id,b-span-interval '9 days',ow
   from generate_series(1,p_groups*p_per) n join public.enrollments e on e.id=md5(k||'e'||r||':'||n)::uuid;
  if r=1 then
   -- student 2 suspended, 3 reactivated, 4 transferred from Group 1 to Group 2 half way, 5 joined half way (enrollment and membership)
   update public.enrollments set status='suspended' where id=md5(k||'e1:2')::uuid;
   update public.enrollments set status='active',enrolled_at=b-interval '2 days' where id=md5(k||'e1:3')::uuid;
   update public.group_memberships set ends_at=mid where id=md5(k||'gm1:4')::uuid;
   insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,created_by) select md5(k||'gm1:4b')::uuid,md5(k||'g1:2')::uuid,off,e.user_id,e.id,mid,ow from public.enrollments e where e.id=md5(k||'e1:4')::uuid;
   update public.enrollments set enrolled_at=mid-interval '1 day' where id=md5(k||'e1:5')::uuid;
   update public.group_memberships set starts_at=mid-interval '1 day' where id=md5(k||'gm1:5')::uuid;
  end if;
  -- sessions: past ones finalized (every 29th left as draft, every 37th cancelled), two ahead per Group
  insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,attendance_state,cancelled,created_by,updated_by,created_at)
   select md5(k||'ss'||r||':'||i||':'||n)::uuid,md5(k||'g'||r||':'||i)::uuid,'Session '||n,t,t+interval '1 hour',t,t+interval '1 hour','center',
    case when n>p_sessions then 'draft' when n%29=0 then 'draft' else 'finalized' end,n%37=0,ow,ow,t-interval '7 days'
   from generate_series(1,p_groups) i cross join generate_series(1,p_sessions+2) n
   cross join lateral (select case when n<=p_sessions then b-span+(n-0.5)*span/p_sessions else b+(n-p_sessions)*interval '1 day' end t) x;
  insert into public.session_attendance(session_id,user_id,membership_id,status)
   select s.id,m.user_id,m.id,case when h<8 then 'not_marked' when h<25 then 'absent' else 'attended' end
   from public.group_sessions s join public.study_groups g on g.id=s.group_id and g.offering_id=off
   join public.group_memberships m on m.group_id=s.group_id and m.starts_at<=s.starts_at and (m.ends_at is null or m.ends_at>s.starts_at)
   cross join lateral (select abs(hashtext(m.user_id::text||s.id::text))%100 h) x
   where s.attendance_state='finalized' or s.starts_at<b;
  -- homework: one essay question of 10 points; kinds by j: 3 on a draft lesson, 4 a draft, 5 has a version 2; j%5=0 no marks
  for j in 1..p_hw loop
   hw:=md5(k||'h'||r||':'||j)::uuid;
   ref:=case when j<=p_hw-2 then b-span+(j-0.5)*span/p_hw else b+(j-p_hw+2)*interval '1 day' end;
   insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by,created_at,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
    values(hw,crs,off,case when j=3 then l2 when j%2=0 then l1 else l3 end,'Homework '||r||'-'||j,case when j=4 then 'draft' else 'published' end,hw,ow,ref-interval '7 days',ref,j%5<>0,'questions','PLATFORM_QUESTIONS','one_time',1,'after_hand_in');
   insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values(md5(k||'hq'||r||':'||j)::uuid,hw,0,'essay','Explain',10,'text');
   if j=5 then
    insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,version,supersedes_id,created_by,created_at,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
     values(md5(k||'h'||r||':5v2')::uuid,crs,off,l3,'Homework '||r||'-5 v2','published',hw,2,hw,ow,ref-interval '6 days',ref,true,'questions','PLATFORM_QUESTIONS','one_time',1,'after_hand_in');
    insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values(md5(k||'hq'||r||':5v2')::uuid,md5(k||'h'||r||':5v2')::uuid,0,'essay','Explain',12,'text');
   end if;
   insert into public.homework_submissions(id,assignment_id,user_id,number,status,submitted_at)
    select md5(k||'hs'||r||':'||j||':'||e.user_id)::uuid,case when j=5 and h%2=0 then md5(k||'h'||r||':5v2')::uuid else hw end,e.user_id,1,'submitted',
     case when ref<b then ref-interval '1 day' else b-interval '1 hour' end
    from public.enrollments e cross join lateral (select abs(hashtext(e.user_id::text||j::text))%100 h) x
    where e.offering_id=off and ((ref<b and h<80) or (ref>=b and h<30));
   insert into private.homework_corrections(submission_id,status,score,released_at,released_by)
    select s.id,'corrected',abs(hashtext(s.id::text))%11,case when j%4=1 then s.submitted_at when j%4=2 then s.submitted_at+interval '1 day' end,case when j%4=2 then ow end
    from public.homework_submissions s where (s.assignment_id=hw or (j=5 and s.assignment_id=md5(k||'h'||r||':5v2')::uuid)) and j%4<>0 and j%5<>0;
  end loop;
  -- exams: by j%4 paper, same time, per Group, per Group with auto release; every 7th archived; the last one ahead (same time, not open yet)
  for j in 1..p_ex loop
   ex:=md5(k||'x'||r||':'||j)::uuid;
   ref:=case when j<p_ex then b-span+(j-0.5)*span/p_ex else b+interval '3 days' end;
   kind_:=case when j=p_ex then 'same' when j%4=0 then 'paper' when j%4=1 then 'same' when j%4=2 then 'group' else 'auto' end;
   if kind_='paper' then
    insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,covers_all_chapters,created_by)
     values(ex,ex,crs,off,'paper','Exam '||r||'-'||j,case when j%7=6 then 'archived' else 'published' end,ref-interval '7 days',40,(ref at time zone 'Africa/Cairo')::date,j%2=0,ow);
    insert into private.exam_results(exam_id,user_id,paper_mark,absent,status,score,max_score,released_at,released_by)
     select ex,e.user_id,case when h%20=0 then null else (h%81)/2.0 end,h%20=0,'corrected',case when h%20=0 then null else (h%81)/2.0 end,40,case when j%8<>0 then ref+interval '1 day' end,case when j%8<>0 then ow end
     from public.enrollments e cross join lateral (select abs(hashtext(e.user_id::text||'x'||j))%1000 h) x where e.offering_id=off and h%10<>9;
   else
    insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,timing,starting_from,opens_at,closes_at,time_limit_minutes,tries_mode,auto_release,covers_all_chapters,created_by)
     values(ex,ex,crs,off,'online','Exam '||r||'-'||j,case when j%7=6 then 'archived' else 'published' end,ref-interval '7 days',case when kind_='same' then 'same_time' else 'per_group' end,
      case when kind_<>'same' then (ref at time zone 'Africa/Cairo')::date-1 end,case when kind_='same' then ref-interval '2 hours' end,case when kind_='same' then ref end,60,'one_time',kind_='auto',j%2=0,ow);
    if kind_<>'same' then
     insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by)
      select ex,g.id,'custom',ref-interval '2 hours'-(i-1)*interval '1 hour',ref-(i-1)*interval '1 hour',ow from generate_series(1,p_groups) i join public.study_groups g on g.id=md5(k||'g'||r||':'||i)::uuid;
    end if;
    if ref<b then
     insert into private.exam_attempts(id,exam_id,user_id,number,window_group_id,started_at,deadline_at,submitted_at,status)
      select md5(k||'xa'||r||':'||j||':'||e.user_id)::uuid,ex,e.user_id,1,gm.group_id,ref-interval '100 minutes',ref-interval '40 minutes',ref-interval '50 minutes','submitted'
      from public.enrollments e cross join lateral (select abs(hashtext(e.user_id::text||'x'||j))%1000 h) x
      left join lateral (select m.group_id from public.group_memberships m where kind_<>'same' and m.offering_id=off and m.user_id=e.user_id and m.starts_at<=ref and (m.ends_at is null or m.ends_at>ref) order by m.starts_at desc limit 1) gm on true
      where e.offering_id=off and h%100<85;
     insert into private.exam_results(exam_id,user_id,final_attempt_id,status,score,max_score,released_at,released_by)
      select ex,a.user_id,a.id,case when h%13=0 then 'waiting' else 'corrected' end,case when h%13=0 then null else h%21 end,20,
       case when kind_<>'auto' and h%13<>0 and ref+interval '1 day'<b then ref+interval '1 day' end,case when kind_<>'auto' and h%13<>0 and ref+interval '1 day'<b then ow end
      from private.exam_attempts a cross join lateral (select abs(hashtext(a.user_id::text||'r'||j))%1000 h) x where a.exam_id=ex;
    end if;
   end if;
   if not (j%2=0) then insert into private.exam_chapters(exam_id,module_id) values(ex,m1); end if;
  end loop;
 end loop;
 set local session_replication_role=origin;
end $$;
-- school-end
select pg_temp.school('S',2,3,8,14,9,6,120);
select pg_temp.school('S2',1,2,5,6,6,4,60);
-- 30 Groups in one space: the owner's Groups list takes two pages of 25.
select pg_temp.school('S3',3,10,1,4,3,2,60);
analyze;

-- The old functions, side by side.
-- Fix track 2c proof only: the ten functions 20261128130000_reports_scope.sql replaces, exactly as 20261117120000_reports.sql defines them
-- (only "create" -> "create or replace"). scripts/reports-scope-proof.cjs applies it to the old database and checks it against the migration file.

create or replace function private.report_sessions_before(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 select 'session'::text,g.offering_id,s.group_id,a.user_id,s.id,s.title,s.starts_at,case when a.status='attended' then 'present' else 'absent' end,
  null::numeric,null::numeric,null::text,null::uuid
 from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.session_attendance a on a.session_id=s.id and a.status in ('attended','absent')
 where g.offering_id=any(p_offerings) and s.attendance_state='finalized' and not s.cancelled and s.ends_at<=clock_timestamp()
  and s.starts_at>=p_lo and s.starts_at<p_hi
$$;

create or replace function private.report_homework_before(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 with hw as materialized (
   select x.* from (select distinct on (a.family_id) a.id,a.family_id,a.offering_id,a.title,a.lesson_id,a.deadline_at,coalesce(a.deadline_at,a.created_at) ref
     from public.homework_assignments a join public.lessons l on l.id=a.lesson_id and l.status='published' join public.courses c on c.id=a.course_id and c.status='published'
      left join public.lesson_segments sg on sg.id=a.segment_id
      where a.offering_id=any(p_offerings) and a.status='published' and (a.segment_id is null or sg.status='published') order by a.family_id,a.version desc) x
   where x.ref>=p_lo and x.ref<p_hi),
  fam as materialized (select a.id,a.family_id,a.mode,a.file_points,a.uses_marks from public.homework_assignments a where a.family_id in (select family_id from hw)),
  subs as materialized (
   select distinct on (f.family_id,s.user_id) f.family_id,s.user_id,s.id sub_id,f.uses_marks,c.released_at,c.score,
    case when f.mode='PLATFORM_QUESTIONS' then (select coalesce(sum(q.points),0) from public.homework_questions q where q.assignment_id=f.id) else f.file_points end tot
   from fam f join public.homework_submissions s on s.assignment_id=f.id and s.status='submitted'
   left join private.homework_corrections c on c.submission_id=s.id
   order by f.family_id,s.user_id,s.submitted_at desc,s.id),
  stu as materialized (
   select h.id hw_id,h.family_id,h.offering_id,h.title,h.lesson_id,h.deadline_at,h.ref,e.user_id,
    (select m.group_id from public.group_memberships m where m.offering_id=h.offering_id and m.user_id=e.user_id and m.starts_at<=h.ref and (m.ends_at is null or m.ends_at>h.ref) order by m.starts_at desc limit 1) gid
   from hw h join public.enrollments e on e.offering_id=h.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=h.ref))
 select 'homework'::text,st.offering_id,st.gid,st.user_id,st.hw_id,st.title,st.ref,
  case when sb.sub_id is not null then 'done' when st.deadline_at is not null and st.deadline_at<=clock_timestamp() then 'missing' else 'open' end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.score end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.tot end,
  case when sb.released_at is not null then 'released' when sb.sub_id is not null then 'waiting' end,
  st.lesson_id
 from stu st left join subs sb on sb.family_id=st.family_id and sb.user_id=st.user_id
$$;

create or replace function private.report_exams_before(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 with ex as materialized (
   select e.id,e.kind,e.timing,e.offering_id,e.title,e.auto_release,e.opens_at,e.closes_at,e.held_on,e.published_at,
    case when e.kind='online' then private.exam_last_close(e.id) end lastclose
   from private.exams e where e.offering_id=any(p_offerings) and e.status in ('published','archived') and e.published_at is not null),
  win as materialized (
   select x.id exam_id,w.group_id wgid,w.closes_at ref from ex x cross join lateral private.exam_windows(x.id) w where x.kind='online' and x.timing='per_group' and w.state='ok'
   union all select x.id,null::uuid,x.closes_at from ex x where x.kind='online' and x.timing='same_time' and x.closes_at is not null
   union all select x.id,null::uuid,coalesce(x.held_on::timestamp at time zone 'Africa/Cairo',x.published_at) from ex x where x.kind='paper'),
  w2 as materialized (select w.exam_id,w.wgid,w.ref,x.kind,x.offering_id from win w join ex x on x.id=w.exam_id where w.ref>=p_lo and w.ref<p_hi),
  res as materialized (
   select r.id rid,r.exam_id,r.user_id,r.status,r.score,r.max_score,r.absent,r.released_at,a.window_group_id wg
   from private.exam_results r left join private.exam_attempts a on a.id=r.final_attempt_id where r.exam_id in (select exam_id from win)),
  lastw as materialized (select w.exam_id,max(w.ref) ref from win w group by w.exam_id),
  cand as (
   select w.exam_id,w.wgid,w.ref,r.user_id,1 pr from w2 w join res r on r.exam_id=w.exam_id and (w.kind='paper' or w.wgid is null or r.wg=w.wgid)
   union all
   -- A per-Group result whose final attempt is missing, or names no window: it stays in the numbers, at the exam's last window.
   select l.exam_id,null::uuid,l.ref,r.user_id,1 from lastw l join ex x on x.id=l.exam_id and x.kind='online' and x.timing='per_group' join res r on r.exam_id=l.exam_id
    where l.ref>=p_lo and l.ref<p_hi and (r.wg is null or not exists(select 1 from win w where w.exam_id=r.exam_id and w.wgid=r.wg))
   union all
   select w.exam_id,w.wgid,w.ref,e.user_id,2 from w2 w join public.enrollments e on e.offering_id=w.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=w.ref)
   where not exists(select 1 from res r where r.exam_id=w.exam_id and r.user_id=e.user_id)
    and (w.wgid is null or exists(select 1 from public.group_memberships m where m.group_id=w.wgid and m.user_id=e.user_id and m.starts_at<=least(w.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(w.ref,clock_timestamp()))))
   union all
   -- A student in no Group can take a per-Group exam between the earliest opening and the last closing (private.exam_student_window): a no-show counts as Absent after the last close.
   select l.exam_id,null::uuid,l.ref,e.user_id,3 from lastw l join ex x on x.id=l.exam_id and x.kind='online' and x.timing='per_group'
    join public.enrollments e on e.offering_id=x.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=l.ref)
   where l.ref>=p_lo and l.ref<p_hi and not exists(select 1 from res r where r.exam_id=l.exam_id and r.user_id=e.user_id)
    and not exists(select 1 from public.group_memberships m join public.study_groups sg on sg.id=m.group_id and sg.status='active'
     where m.offering_id=x.offering_id and m.user_id=e.user_id and m.starts_at<=least(l.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(l.ref,clock_timestamp())))),
  one as (select distinct on (c.exam_id,c.user_id) c.* from cand c order by c.exam_id,c.user_id,c.pr,c.ref desc),
  st as (
   select o.exam_id,o.user_id,o.ref,x.kind,x.offering_id,x.title,r.score,r.max_score,
    coalesce(o.wgid,(select m.group_id from public.group_memberships m where m.offering_id=x.offering_id and m.user_id=o.user_id and m.starts_at<=least(o.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(o.ref,clock_timestamp())) order by m.starts_at desc limit 1)) gid,
    case when r.absent then 'absent'
     when r.rid is null then case when x.kind='online' and o.ref<=clock_timestamp()
       and not exists(select 1 from private.exam_attempts a where a.exam_id=o.exam_id and a.user_id=o.user_id and a.status='in_progress') then 'absent' else 'pending' end
     when r.status='corrected' and r.score is not null and (r.released_at is not null or (x.auto_release and x.lastclose<=clock_timestamp())) then 'marked'
     else 'waiting' end state
   from one o join ex x on x.id=o.exam_id left join res r on r.exam_id=o.exam_id and r.user_id=o.user_id)
 select 'exam'::text,s.offering_id,s.gid,s.user_id,s.exam_id,s.title,s.ref,s.state,case when s.state='marked' then s.score end,case when s.state='marked' then s.max_score end,s.kind,null::uuid
 from st s
$$;

create or replace function private.report_facts_before(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 select * from private.report_sessions_before(p_offerings,p_lo,p_hi)
 union all select * from private.report_homework_before(p_offerings,p_lo,p_hi)
 union all select * from private.report_exams_before(p_offerings,p_lo,p_hi)
$$;

create or replace function private.report_stats_before(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz,p_by_group boolean)
returns table(offering_id uuid,group_id uuid,user_id uuid,active boolean,att_total integer,att_present integer,hw_given integer,hw_done integer,hw_missing integer,hw_score numeric,hw_max numeric,
 ex_count integer,ex_score numeric,ex_max numeric,ex_absent integer,absent_titles text[])
language sql stable security definer set search_path='' as $$
 with f as materialized (select * from private.report_facts_before(p_offerings,p_lo,p_hi))
 select f.offering_id,case when p_by_group then f.group_id end,f.user_id,coalesce(bool_or(e.status='active'),false),
  (count(*) filter(where f.kind='session'))::integer,(count(*) filter(where f.kind='session' and f.state='present'))::integer,
  (count(*) filter(where f.kind='homework' and f.state in ('done','missing')))::integer,(count(*) filter(where f.kind='homework' and f.state='done'))::integer,(count(*) filter(where f.kind='homework' and f.state='missing'))::integer,
  coalesce(sum(f.score) filter(where f.kind='homework'),0),coalesce(sum(f.maxv) filter(where f.kind='homework'),0),
  (count(*) filter(where f.kind='exam' and f.state='marked'))::integer,coalesce(sum(f.score) filter(where f.kind='exam' and f.state='marked'),0),coalesce(sum(f.maxv) filter(where f.kind='exam' and f.state='marked'),0),
  (count(*) filter(where f.kind='exam' and f.state='absent'))::integer,coalesce(array_agg(f.title order by f.ref_at,f.item_id) filter(where f.kind='exam' and f.state='absent'),'{}')
 from f left join public.enrollments e on e.offering_id=f.offering_id and e.user_id=f.user_id
 group by f.offering_id,case when p_by_group then f.group_id end,f.user_id
$$;

create or replace function private.report_groups_before(p_groups uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];n integer;res jsonb;
begin
 if p_groups is null or cardinality(p_groups) not between 1 and 100 then raise exception 'Send 1 to 100 Groups' using errcode='23514'; end if;
 select count(*),array_agg(distinct g.offering_id) into n,offs from public.study_groups g where g.id=any(p_groups);
 if n<>(select count(distinct x) from unnest(p_groups) x) or exists(select 1 from public.study_groups g where g.id=any(p_groups) and not private.can_support_offering(g.offering_id)) then
  raise exception 'Groups unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(null);
 with f as materialized (select * from private.report_facts_before(offs,b.lo,b.hi) where group_id=any(p_groups)),
  st as materialized (select * from private.report_stats_before(offs,b.lo,b.hi,true) where group_id=any(p_groups))
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'groups',coalesce(jsonb_agg(jsonb_build_object(
   'groupId',x.gid,'hasNumbers',x.sessions+x.hw+x.exams>0,
   'attendance',jsonb_build_object('pct',private.report_pct(x.present,x.att_total),'present',x.present,'total',x.att_total),
   'homework',jsonb_build_object('pct',private.report_pct(x.hw_done,x.hw_given),'done',x.hw_done,'given',x.hw_given),
   'exams',jsonb_build_object('pct',private.report_pct(x.ex_score,x.ex_max),'count',x.exams),
   'attention',x.attention) order by x.gid),'[]'::jsonb)) into res
 from (select gid,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='session') sessions,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='homework' and f.state<>'open') hw,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='exam' and f.state<>'pending') exams,
   coalesce((select sum(s.att_present) from st s where s.group_id=gid),0)::integer present,coalesce((select sum(s.att_total) from st s where s.group_id=gid),0)::integer att_total,
   coalesce((select sum(s.hw_done) from st s where s.group_id=gid),0)::integer hw_done,coalesce((select sum(s.hw_given) from st s where s.group_id=gid),0)::integer hw_given,
   coalesce((select sum(s.ex_score) from st s where s.group_id=gid),0) ex_score,coalesce((select sum(s.ex_max) from st s where s.group_id=gid),0) ex_max,
   (select count(*) from st s where s.group_id=gid and s.active and private.report_reason_count(s.att_total,s.att_present,s.hw_missing,s.ex_max,s.ex_score,s.ex_absent)>0)::integer attention
  from (select distinct unnest(p_groups) gid) ids) x;
 return res;
end $$;

create or replace function private.report_group_before(p_group uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();g public.study_groups;b record;res jsonb;
begin
 select * into g from public.study_groups where id=p_group;
 if g.id is null or not private.can_support_offering(g.offering_id) then raise exception 'Group unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 with f as materialized (select * from private.report_facts_before(array[g.offering_id],b.lo,b.hi) where group_id=p_group),
  st as materialized (select * from private.report_stats_before(array[g.offering_id],b.lo,b.hi,true) where group_id=p_group),
  roster as materialized (
   select s.user_id from st s
   union select m.user_id from public.group_memberships m join public.enrollments e on e.offering_id=m.offering_id and e.user_id=m.user_id and e.status='active'
    where m.group_id=p_group and m.starts_at<b.hi and (m.ends_at is null or m.ends_at>b.lo)),
  per as materialized (
   select r.user_id,p.display_name,coalesce(s.active,exists(select 1 from public.enrollments e where e.offering_id=g.offering_id and e.user_id=r.user_id and e.status='active')) active,
    coalesce(s.att_total,0) att_total,coalesce(s.att_present,0) att_present,coalesce(s.hw_given,0) hw_given,coalesce(s.hw_done,0) hw_done,coalesce(s.hw_missing,0) hw_missing,
    coalesce(s.hw_score,0) hw_score,coalesce(s.hw_max,0) hw_max,coalesce(s.ex_count,0) ex_count,coalesce(s.ex_score,0) ex_score,coalesce(s.ex_max,0) ex_max,coalesce(s.ex_absent,0) ex_absent,
    coalesce(s.absent_titles,'{}') titles
   from roster r join public.profiles p on p.id=r.user_id left join st s on s.user_id=r.user_id),
  ranked as materialized (
   select pr.*,private.report_reason_count(pr.att_total,pr.att_present,pr.hw_missing,pr.ex_max,pr.ex_score,pr.ex_absent) n,
    coalesce(least(private.report_pct(pr.att_present,pr.att_total),private.report_pct(pr.ex_score,pr.ex_max),private.report_pct(pr.hw_done,pr.hw_given)),100) worst
   from per pr),
  one as (select jsonb_build_object('userId',r.user_id,'name',r.display_name,
     'attendance',jsonb_build_object('pct',private.report_pct(r.att_present,r.att_total),'present',r.att_present,'total',r.att_total),
     'homework',jsonb_build_object('done',r.hw_done,'given',r.hw_given,'missing',r.hw_missing),
     'exams',jsonb_build_object('pct',private.report_pct(r.ex_score,r.ex_max),'count',r.ex_count,'absent',r.ex_absent),
     'reasons',private.report_reasons(r.att_total,r.att_present,r.hw_missing,r.ex_max,r.ex_score,r.ex_absent,r.titles)) j,r.n,r.worst,r.display_name,r.user_id,r.active
   from ranked r)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'firstMonth',to_char(g.created_at at time zone 'Africa/Cairo','YYYY-MM'),
   'group',jsonb_build_object('id',g.id,'name',g.name),
   'summary',jsonb_build_object(
    'attendance',jsonb_build_object('pct',private.report_pct((select coalesce(sum(att_present),0) from per),(select coalesce(sum(att_total),0) from per)),'sessions',(select count(distinct item_id) from f where kind='session')),
    'homework',jsonb_build_object('pct',private.report_pct((select coalesce(sum(hw_done),0) from per),(select coalesce(sum(hw_given),0) from per)),'given',(select count(distinct item_id) from f where kind='homework' and state<>'open')),
    'exams',jsonb_build_object('pct',private.report_pct((select coalesce(sum(ex_score),0) from per),(select coalesce(sum(ex_max),0) from per)),'count',(select count(distinct item_id) from f where kind='exam' and state<>'pending'))),
   'attentionTotal',(select count(*) from one where active and n>0),
   'attention',coalesce((select jsonb_agg(x.j order by x.n desc,x.worst,x.display_name,x.user_id) from (select * from one where active and n>0 order by n desc,worst,display_name,user_id limit 200) x),'[]'::jsonb),
   'everyoneTotal',(select count(*) from one where not (active and n>0)),
   'everyone',coalesce((select jsonb_agg(x.j order by x.display_name,x.user_id) from (select * from one where not (active and n>0) order by display_name,user_id limit 300) x),'[]'::jsonb)) into res;
 return res;
end $$;

create or replace function private.report_attention_before(p_offering uuid default null,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];res jsonb;
begin
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid page' using errcode='23514'; end if;
 if p_offering is not null then
  if not private.can_support_offering(p_offering) then raise exception 'Course unavailable' using errcode='42501'; end if;
  offs:=array[p_offering];
 else
  offs:=array(select o.id from public.course_offerings o join public.courses c on c.id=o.course_id
   where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and private.can_support_offering(o.id));
  if cardinality(offs)=0 then raise exception 'Students unavailable' using errcode='42501'; end if;
 end if;
 select * into b from private.report_bounds(null);
 with st as materialized (select * from private.report_stats_before(offs,b.lo,b.hi,false) s where s.active),
  flagged as materialized (
   select s.*,private.report_reason_count(s.att_total,s.att_present,s.hw_missing,s.ex_max,s.ex_score,s.ex_absent) n,
    coalesce(least(private.report_pct(s.att_present,s.att_total),private.report_pct(s.ex_score,s.ex_max),private.report_pct(s.hw_done,s.hw_given)),100) worst
   from st s),
  hit as materialized (select f.*,p.display_name from flagged f join public.profiles p on p.id=f.user_id where f.n>0),
  pg as materialized (select h.* from hit h order by h.n desc,h.worst,h.display_name,h.user_id limit 25 offset p_page*25)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'page',p_page,'pageSize',25,'total',(select count(*) from hit),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('userId',h.user_id,'name',h.display_name,'offeringId',h.offering_id,'courseTitle',c.title,
     'group',(select jsonb_build_object('id',g.id,'name',g.name) from public.group_memberships m join public.study_groups g on g.id=m.group_id
        where m.offering_id=h.offering_id and m.user_id=h.user_id and (m.ends_at is null or m.ends_at>b.lo) and m.starts_at<b.hi order by (m.ends_at is null) desc,m.starts_at desc limit 1),
     'reasons',private.report_reasons(h.att_total,h.att_present,h.hw_missing,h.ex_max,h.ex_score,h.ex_absent,h.absent_titles)) order by h.n desc,h.worst,h.display_name,h.user_id)
    from pg h join public.course_offerings o on o.id=h.offering_id join public.courses c on c.id=o.course_id),'[]'::jsonb)) into res;
 return res;
end $$;

create or replace function private.report_student_before(p_student uuid,p_offering uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;res jsonb;
begin
 if p_student is null or p_offering is null or not private.can_support_offering(p_offering)
  or not exists(select 1 from public.enrollments e where e.offering_id=p_offering and e.user_id=p_student and e.status in ('active','completed','suspended')) then
  raise exception 'Student unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 with f as materialized (select * from private.report_facts_before(array[p_offering],b.lo,b.hi) where user_id=p_student),
  gn as materialized (select g.id,g.name from public.study_groups g where g.id in (select group_id from f where group_id is not null)),
  se as materialized (select * from f where kind='session' order by ref_at,item_id),
  hw as materialized (select * from f where kind='homework' order by ref_at,item_id),
  ex as materialized (select * from f where kind='exam' and state<>'pending' order by ref_at,item_id)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,
  'firstMonth',(select to_char(min(e.created_at) at time zone 'Africa/Cairo','YYYY-MM') from public.enrollments e where e.offering_id=p_offering and e.user_id=p_student),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from gn),'[]'::jsonb),
  'attendance',jsonb_build_object('pct',private.report_pct((select count(*) from se where state='present'),(select count(*) from se)),'present',(select count(*) from se where state='present'),'total',(select count(*) from se)),
  'homework',jsonb_build_object('done',(select count(*) from hw where state='done'),'given',(select count(*) from hw where state<>'open'),'missing',(select count(*) from hw where state='missing'),
    'avgPct',private.report_pct((select coalesce(sum(score),0) from hw),(select coalesce(sum(maxv),0) from hw))),
  'exams',jsonb_build_object('pct',private.report_pct((select coalesce(sum(score),0) from ex where state='marked'),(select coalesce(sum(maxv),0) from ex where state='marked')),
    'count',(select count(*) from ex where state='marked'),'absent',(select count(*) from ex where state='absent')),
  'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'groupId',group_id,'day',extract(day from ref_at at time zone 'Africa/Cairo')::integer,'date',to_char(ref_at at time zone 'Africa/Cairo','YYYY-MM-DD'),'state',state) order by ref_at,item_id) from (select * from se limit 200) x),'[]'::jsonb),
  'homeworkList',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'title',title,'groupId',group_id,'state',state,'score',score,'max',maxv,'detail',detail,'dueAt',ref_at) order by ref_at,item_id) from (select * from hw limit 200) x),'[]'::jsonb),
  'examList',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'title',title,'groupId',group_id,'state',state,'score',score,'max',maxv,'kind',detail,'at',ref_at) order by ref_at,item_id) from (select * from ex limit 200) x),'[]'::jsonb)) into res;
 return res;
end $$;

create or replace function private.report_course_before(p_course uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];res jsonb;editor boolean;
begin
 if p_course is null or not exists(select 1 from public.courses c where c.id=p_course) then raise exception 'Course unavailable' using errcode='42501'; end if;
 editor:=private.can_edit_course(p_course);
 offs:=array(select o.id from public.course_offerings o where o.course_id=p_course and (editor or private.can_support_offering(o.id)));
 if not editor and cardinality(offs)=0 then raise exception 'Course unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 with f as materialized (select * from private.report_facts_before(offs,b.lo,b.hi) where kind='homework' or (kind='exam' and state<>'pending')),
  mods as materialized (select m.id,m.chapter_number,m.title,m.position from public.course_modules m where m.course_id=p_course),
  items as materialized (
   select 'homework'::text kind,f.item_id,f.group_id,f.user_id,f.score,f.maxv,l.module_id from f join public.lessons l on l.id=f.lesson_id where f.kind='homework' and l.module_id in (select id from mods)
   union all
   select 'exam',f.item_id,f.group_id,f.user_id,f.score,f.maxv,m.id from f join private.exams e on e.id=f.item_id
    join mods m on e.covers_all_chapters or exists(select 1 from private.exam_chapters x where x.exam_id=e.id and x.module_id=m.id) where f.kind='exam'),
  per as materialized (select i.module_id,i.group_id,count(*) filter(where i.score is not null)::integer marks,coalesce(sum(i.score),0) sc,coalesce(sum(i.maxv),0) mx from items i group by i.module_id,i.group_id),
  ch as materialized (
   select m.id,m.chapter_number,m.title,m.position,
    (select count(distinct i.item_id) from items i where i.module_id=m.id and i.kind='exam') exams,(select count(distinct i.item_id) from items i where i.module_id=m.id and i.kind='homework') hws,
    (select coalesce(sum(p.sc),0) from per p where p.module_id=m.id) sc,(select coalesce(sum(p.mx),0) from per p where p.module_id=m.id) mx
   from mods m),
  weak as (select c.id from ch c where c.mx>0 and (select count(*) from ch where mx>0)>=2 order by c.sc/c.mx,c.position limit 1)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,
  'firstMonth',(select to_char(min(o.created_at) at time zone 'Africa/Cairo','YYYY-MM') from public.course_offerings o where o.id=any(offs)),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id) from public.study_groups g where g.offering_id=any(offs) and (g.status='active' or g.id in (select group_id from per where group_id is not null))),'[]'::jsonb),
  'chapters',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.chapter_number,'title',c.title,'exams',c.exams,'homework',c.hws,'pct',private.report_pct(c.sc,c.mx),'weakest',c.id in (select id from weak),
     'groups',coalesce((select jsonb_agg(jsonb_build_object('groupId',p.group_id,'pct',private.report_pct(p.sc,p.mx),'marks',p.marks) order by p.group_id nulls last) from per p where p.module_id=c.id and p.mx>0),'[]'::jsonb)) order by c.position,c.id) from ch c),'[]'::jsonb)) into res;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------- 3. structure
select pg_temp.ok((select bool_and(p.prolang=(select oid from pg_language where lanname='plpgsql') and p.prosecdef and p.proconfig @> array['search_path=""','plan_cache_mode=force_custom_plan']
  and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))
 from pg_proc p where p.oid in ('private.report_sessions(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)'::regprocedure,'private.report_homework(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)'::regprocedure,
  'private.report_exams(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)'::regprocedure)),'the scoped fact functions are plpgsql, definer, search_path empty, force_custom_plan, granted to nobody');
select pg_temp.ok((select bool_and(not has_function_privilege(r,p.oid,'execute')) from pg_proc p cross join unnest(array['authenticated','anon','service_role']) r
 where p.oid in ('private.report_facts(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)'::regprocedure,'private.report_stats(uuid[],timestamptz,timestamptz,boolean,uuid[],uuid,boolean)'::regprocedure,
  'private.report_sessions(uuid[],timestamptz,timestamptz)'::regprocedure,'private.report_homework(uuid[],timestamptz,timestamptz)'::regprocedure,'private.report_exams(uuid[],timestamptz,timestamptz)'::regprocedure,
  'private.report_facts(uuid[],timestamptz,timestamptz)'::regprocedure,'private.report_stats(uuid[],timestamptz,timestamptz,boolean)'::regprocedure)),'report_facts and report_stats (both signatures) and the old fact signatures stay internal');
select pg_temp.ok((select bool_and(has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname in ('report_groups','report_group','report_attention','report_student','report_course')
  and p.proname not like '%_before'),'the five reads (private and public) keep their grants: authenticated only');
select pg_temp.ok((select bool_and(regexp_count(pg_get_functiondef(p.oid),'can_support_offering')=case p.proname when 'report_attention' then 1 else 0 end
  and regexp_count(pg_get_functiondef(p.oid),'my_supported_offerings')=1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('report_groups','report_attention','report_course')),
 'report_groups, report_attention (all courses) and report_course check the runs with the once-per-statement set; only report_attention''s one-run check calls can_support_offering, once');

-- ---------------------------------------------------------------------------------------- 1. the facts (as the table owner)
create temp table rs_rng as select m,b.lo,b.hi from unnest(array[null,'all',to_char(now() at time zone 'Africa/Cairo','YYYY-MM'),to_char((now() at time zone 'Africa/Cairo')-interval '1 month','YYYY-MM')]) m
 cross join lateral private.report_bounds(m) b;
create temp table rs_off as select o.id,c.organization_id org from public.course_offerings o join public.courses c on c.id=o.course_id;
create temp table rs_grp as select g.id,g.offering_id,g.name from public.study_groups g;
create temp table rs_enr as select e.offering_id,e.user_id,e.status from public.enrollments e;
create function pg_temp.h(q text) returns text language plpgsql as $$declare r text; begin execute 'select md5(coalesce(string_agg(x::text,''|'' order by x::text),'''')) from ('||q||') x' into r; return r; end$$;
create function pg_temp.same(k text,item text,o text,n text) returns void language plpgsql as $$begin
 perform pg_temp.cnt(k); if pg_temp.h(o) is distinct from pg_temp.h(n) then insert into pg_temp.rs_diff values(k,'',item,o,n); end if; end$$;
do $$ declare o record; r record; f text; g record; e record; a text; offs text; begin
 for o in select * from pg_temp.rs_off loop for r in select * from pg_temp.rs_rng loop
  a:=format('array[%L]::uuid[],%L::timestamptz,%L::timestamptz',o.id,r.lo,r.hi);
  foreach f in array array['report_sessions','report_homework','report_exams','report_facts'] loop
   perform pg_temp.same('facts unscoped (old signature and new, no scope)',f,format('select * from private.%s_before(%s)',f,a),format('select * from private.%s(%s)',f,a));
   perform pg_temp.same('facts unscoped (old signature and new, no scope)',f,format('select * from private.%s_before(%s)',f,a),format('select * from private.%s(%s,null,null,false)',f,a));
   perform pg_temp.same('facts of the run''s students whose enrollment is active',f,
    format('select x.* from private.%s_before(%s) x where exists(select 1 from public.enrollments e where e.offering_id=x.offering_id and e.user_id=x.user_id and e.status=''active'')',f,a),
    format('select * from private.%s(%s,null,null,true)',f,a));
   perform pg_temp.same('facts of all the run''s Groups at once',f,format('select * from private.%s_before(%s) where group_id in (select id from pg_temp.rs_grp where offering_id=%L)',f,a,o.id),
    format('select * from private.%s(%s,array(select id from pg_temp.rs_grp where offering_id=%L),null,false)',f,a,o.id));
   for g in select * from pg_temp.rs_grp where offering_id=o.id loop
    perform pg_temp.same('facts of one Group',f,format('select * from private.%s_before(%s) where group_id=%L',f,a,g.id),format('select * from private.%s(%s,array[%L]::uuid[],null,false)',f,a,g.id));
   end loop;
   for e in select * from pg_temp.rs_enr where offering_id=o.id union all select o.id,pg_temp.u('nospace'),'none' loop
    perform pg_temp.same('facts of one student',f,format('select * from private.%s_before(%s) where user_id=%L',f,a,e.user_id),format('select * from private.%s(%s,null,%L,false)',f,a,e.user_id));
   end loop;
  end loop;
  perform pg_temp.same('report_stats (old signature, by Group and not)','stats',format('select * from private.report_stats_before(%s,true)',a),format('select * from private.report_stats(%s,true)',a));
  perform pg_temp.same('report_stats (old signature, by Group and not)','stats',format('select * from private.report_stats_before(%s,false)',a),format('select * from private.report_stats(%s,false)',a));
  perform pg_temp.same('report_stats, active students only','stats',format('select * from private.report_stats_before(%s,false) where active',a),format('select * from private.report_stats(%s,false,null,null,true) where active',a));
  for g in select * from pg_temp.rs_grp where offering_id=o.id loop
   perform pg_temp.same('report_stats of one Group','stats',format('select * from private.report_stats_before(%s,true) where group_id=%L',a,g.id),format('select * from private.report_stats(%s,true,array[%L]::uuid[],null,false) where group_id=%L',a,g.id,g.id));
  end loop;
 end loop; end loop;
 -- Several runs at once (Needs attention, all courses): every run of each space.
 for o in select org from pg_temp.rs_off group by org loop for r in select * from pg_temp.rs_rng loop
  offs:=format('array(select id from pg_temp.rs_off where org=%L),%L::timestamptz,%L::timestamptz',o.org,r.lo,r.hi);
  perform pg_temp.same('report_stats of every run of a space, active students only','stats',format('select * from private.report_stats_before(%s,false) where active',offs),format('select * from private.report_stats(%s,false,null,null,true) where active',offs));
 end loop; end loop;
end $$;
select pg_temp.nodiff('the fact functions with a scope return exactly the old rows that match it (every run, range, Group, student)');
select pg_temp.ok((select count(*)>=10 from pg_temp.rs_grp) and (select count(*)>=60 from pg_temp.rs_enr) and (select count(*) from pg_temp.rs_rng)=4,'the fixture has the Groups, students and ranges the comparison needs');
select pg_temp.ok((select count(distinct state)=3 from private.report_homework_before(array(select id from pg_temp.rs_off),'-infinity','infinity'))
 and (select count(distinct state)=4 from private.report_exams_before(array(select id from pg_temp.rs_off),'-infinity','infinity'))
 and exists(select 1 from private.report_homework_before(array(select id from pg_temp.rs_off),'-infinity','infinity') where detail='waiting')
 and exists(select 1 from private.report_homework_before(array(select id from pg_temp.rs_off),'-infinity','infinity') where group_id is null),
 'the facts cover every state: homework done, missing and open (waiting for marks too), exams marked, waiting, absent and pending, rows in no Group');

-- ---------------------------------------------------------------------------------------- 2. the reads, as each caller
create temp table rs_crs as select c.id from public.courses c;
-- The student pages read: every student of S run 1 (the suspended, reactivated, transferred, mid-term and no-Group students), of S2 and of the
-- demo, and three of every other run.
create temp table rs_enr_read as select x.offering_id,x.user_id from (select e.*,row_number() over(partition by e.offering_id order by e.user_id) n from pg_temp.rs_enr e) x
 where x.n<=3 or x.offering_id in (md5('rp2c:S:o1')::uuid,md5('rp2c:S2:o1')::uuid) or x.offering_id in (select id from pg_temp.rs_off where org=pg_temp.k('DEMO'));
create temp table rs_callers(label text primary key);
insert into rs_callers values('S_owner'),('S_admin'),('S_t1'),('S_t2'),('S_asst'),('S_asst2'),('S_cse'),('S_csa'),('S_student'),('S2_owner'),('S2_t1'),('S2_student'),('S3_owner'),('S3_t2'),('demo_owner'),('padmin'),('nospace'),('none');
grant select on rs_rng,rs_off,rs_grp,rs_enr,rs_enr_read,rs_crs,rs_callers to authenticated;
create function pg_temp.try(q text) returns jsonb language plpgsql as $$declare r jsonb; begin execute q into r; return r; exception when others then return jsonb_build_object('error',sqlstate); end$$;
-- The Groups list joined back: the pages' Groups in groupId order, with the rest of the first page's answer.
create function pg_temp.pages(ids uuid[]) returns jsonb language plpgsql as $$declare i integer; p jsonb; first jsonb; all_ jsonb:='[]'; begin
 for i in 0..(cardinality(ids)-1)/25 loop
  p:=pg_temp.try(format('select private.report_groups(%L::uuid[])',ids[i*25+1:i*25+25]));
  if p ? 'error' then return p; end if;
  first:=coalesce(first,p); all_:=all_||(p->'groups');
 end loop;
 return first||jsonb_build_object('groups',(select coalesce(jsonb_agg(x order by x->>'groupId'),'[]') from jsonb_array_elements(all_) x));
end$$;
create function pg_temp.sorted(j jsonb) returns jsonb language sql immutable as $$
 select case when j ? 'groups' then j||jsonb_build_object('groups',(select coalesce(jsonb_agg(x order by x->>'groupId'),'[]') from jsonb_array_elements(j->'groups') x)) else j end$$;
do $$ declare c text; k text; item text; o jsonb; n jsonb; r record; g record; e record; ids uuid[]; sup uuid[]; q text;
 reads text[][]; begin
 for c in select label from pg_temp.rs_callers order by label loop
  perform set_config('request.jwt.claims',pg_temp.claims(c),true);
  execute 'set local role authenticated';
  sup:=coalesce(array(select jsonb_array_elements_text(pg_temp.try('select to_jsonb(array(select private.my_supported_offerings()))'))::uuid),'{}');
  for g in select * from pg_temp.rs_grp loop for r in select * from pg_temp.rs_rng loop
   o:=pg_temp.try(format('select private.report_group_before(%L,%L)',g.id,r.m)); n:=pg_temp.try(format('select private.report_group(%L,%L)',g.id,r.m));
   perform pg_temp.cnt('report_group'); if o is distinct from n then insert into pg_temp.rs_diff values('report_group',c,g.name||' '||coalesce(r.m,'4w'),o::text,n::text); end if;
  end loop; end loop;
  -- every range for S run 1; Last 4 weeks and Whole course for the others (every range is compared for every student in the facts above)
  for e in select * from pg_temp.rs_enr_read loop for r in select * from pg_temp.rs_rng where e.offering_id=md5('rp2c:S:o1')::uuid or m is null or m='all' loop
   o:=pg_temp.try(format('select private.report_student_before(%L,%L,%L)',e.user_id,e.offering_id,r.m)); n:=pg_temp.try(format('select private.report_student(%L,%L,%L)',e.user_id,e.offering_id,r.m));
   perform pg_temp.cnt('report_student'); if o is distinct from n then insert into pg_temp.rs_diff values('report_student',c,e.user_id||' '||coalesce(r.m,'4w'),o::text,n::text); end if;
  end loop; end loop;
  for r in select * from pg_temp.rs_rng loop
   for item in select id::text from pg_temp.rs_crs loop
    o:=pg_temp.try(format('select private.report_course_before(%L,%L)',item,r.m)); n:=pg_temp.try(format('select private.report_course(%L,%L)',item,r.m));
    perform pg_temp.cnt('report_course'); if o is distinct from n then insert into pg_temp.rs_diff values('report_course',c,item||' '||coalesce(r.m,'4w'),o::text,n::text); end if;
   end loop;
  end loop;
  for item in select x from unnest(array[null]::text[]) x union all select id::text from pg_temp.rs_off loop
   for i in 0..2 loop
    o:=pg_temp.try(format('select private.report_attention_before(%L,%s)',item,i)); n:=pg_temp.try(format('select private.report_attention(%L,%s)',item,i));
    perform pg_temp.cnt('report_attention'); if o is distinct from n then insert into pg_temp.rs_diff values('report_attention',c,coalesce(item,'all')||' p'||i,o::text,n::text); end if;
   end loop;
  end loop;
  -- The Groups list: the caller's own Groups (what the list shows), else every Group of space S (refused for both). Paged vs one old call, and the same single call.
  for ids in select array_agg(id order by name) from pg_temp.rs_grp where offering_id=any(sup) having count(*)>0
   union all select array_agg(id order by name) from pg_temp.rs_grp where name like 'S group%' and cardinality(sup)=0 having count(*)>0 loop
   for i in 0..(cardinality(ids)-1)/100 loop
    o:=pg_temp.sorted(pg_temp.try(format('select private.report_groups_before(%L::uuid[])',ids[i*100+1:i*100+100]))); n:=pg_temp.pages(ids[i*100+1:i*100+100]);
    perform pg_temp.cnt('report_groups, 25 per call joined back'); if o is distinct from n then insert into pg_temp.rs_diff values('report_groups paged',c,i::text,o::text,n::text); end if;
    n:=pg_temp.sorted(pg_temp.try(format('select private.report_groups(%L::uuid[])',ids[i*100+1:i*100+100])));
    perform pg_temp.cnt('report_groups, the same call'); if o is distinct from n then insert into pg_temp.rs_diff values('report_groups same',c,i::text,o::text,n::text); end if;
   end loop;
  end loop;
  execute 'reset role';
 end loop;
end $$;
select pg_temp.nodiff('every report read is the same JSON (or the same refusal) for every caller, range, Group, student, course and page');
select pg_temp.ok((select count(*) from pg_temp.rs_count where kind like 'report_%' and n>0)>=6
 and (select n from pg_temp.rs_count where kind='report_group')=(select count(*)*4*18 from pg_temp.rs_grp)
 and (select n from pg_temp.rs_count where kind='report_groups, 25 per call joined back')>=18,'every caller read every Group in every range');
-- Some of those were answered and some refused (the comparison is not "both refused" everywhere).
set local role authenticated;
select set_config('request.jwt.claims',pg_temp.claims('S3_owner'),true);
select pg_temp.ok(jsonb_array_length(pg_temp.pages(array(select id from pg_temp.rs_grp where name like 'S3 group%' order by name))->'groups')=30,'the S3 owner''s 30 Groups come back whole from two pages of 25 (and equal the old single read, above)');
select set_config('request.jwt.claims',pg_temp.claims('S_asst2'),true);
select pg_temp.ok((select count(*) filter (where not pg_temp.try(format('select private.report_group(%L,null)',id)) ? 'error')>0
  and count(*) filter (where pg_temp.try(format('select private.report_group(%L,null)',id)) ? 'error')>0 from pg_temp.rs_grp),'an assistant of one run reads its Groups and is refused the others');
select set_config('request.jwt.claims',pg_temp.claims('S_student'),true);
select pg_temp.ok((select bool_and(pg_temp.try(format('select private.report_group(%L,null)',id))->>'error'='42501') from pg_temp.rs_grp),'a student is refused every Group report');
reset role;

select count(*) as reports_scope_passed from pg_temp.rs_results;
select json_build_object('passed',(select count(*) from pg_temp.rs_results),'compared',(select json_object_agg(kind,n) from pg_temp.rs_count),
 'first_difference',(select row_to_json(d) from pg_temp.rs_diff d limit 1)) as reports_scope_tests;
rollback;
