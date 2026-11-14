-- Disposable local PostgreSQL only. Synthetic data; everything rolls back. The Groups list line and the Needs attention list on a large space:
-- 40 Groups, 1,600 students, 24 finalized sessions a Group this month (about 38,000 marks), 8 homework with about 10,000 hand-ins, 3 exams with their results.
-- Proves (1) the answers agree with each other (the Groups list, the Report tab and the Needs attention list say the same count),
-- (2) each screen is ONE call and finishes inside a generous bound, (3) a second space adds nothing to the first one's answer.
begin;
create temp table rs_results(name text primary key);
create temp table rs_users(label text primary key,id uuid not null);
grant select,insert on rs_results,rs_users to authenticated;
select set_config('rs.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.rs_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('rs.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','rs-'||current_setting('rs.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.rs_users where label=k$$;
create function pg_temp.lo() returns timestamptz language sql as $$select date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'$$;
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','owner_b'] loop
  perform pg_temp.claim(label); insert into pg_temp.rs_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
do $$
declare run text:=current_setting('rs.run'); org uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid(); course uuid:=gen_random_uuid(); course_b uuid:=gen_random_uuid(); off uuid:=gen_random_uuid(); off_b uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); lo timestamptz:=pg_temp.lo(); owner uuid:=pg_temp.uid('owner'); i integer; j integer; g uuid; hw uuid; ex uuid;
begin
 insert into public.organizations(id,name,slug) values(org,'Scale A','rs-a-'||run),(org_b,'Scale B','rs-b-'||run);
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(org,owner,'owner','active',now()),(org_b,pg_temp.uid('owner_b'),'owner','active',now());
 insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values(course,org,'Scale course','rs-c-'||run,'published','private',owner),(course_b,org_b,'Other course','rs-cb-'||run,'published','private',pg_temp.uid('owner_b'));
 insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(off,course,'Run','scheduled','active'),(off_b,course_b,'Other run','scheduled','active');
 insert into public.course_modules(id,course_id,title,position) values(m,course,'Chapter',0);
 insert into public.lessons(id,module_id,title,position,status) values(l,m,'Lesson',0,'published');
 insert into public.profiles(id,display_name) select gen_random_uuid(),'Scale student '||lpad(n::text,4,'0') from generate_series(1,2000) n;
 create temp table sp on commit drop as select id,row_number() over(order by display_name) n from public.profiles where display_name like 'Scale student %';
 insert into public.enrollments(offering_id,user_id,status,enrolled_at) select case when n<=1600 then off else off_b end,id,'active',now()-interval '60 days' from sp;
 for i in 1..40 loop
  g:=gen_random_uuid();
  insert into public.study_groups(id,offering_id,name,mode,location,created_by) values(g,off,'Scale group '||lpad(i::text,2,'0'),'center','Room',owner);
  insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
   select g,off,e.user_id,e.id,now()-interval '50 days',owner from sp join public.enrollments e on e.user_id=sp.id and e.offering_id=off where sp.n>(i-1)*40 and sp.n<=i*40;
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,attendance_state,created_by,updated_by)
   select g,'S'||k,lo+k*interval '1 second',lo+k*interval '1 second'+interval '1 second',lo+k*interval '1 second',lo+k*interval '1 second'+interval '1 second','center','finalized',owner,owner from generate_series(1,24) k;
  insert into public.session_attendance(session_id,user_id,membership_id,status)
   select s.id,m2.user_id,m2.id,case when ((abs(hashtext(m2.user_id::text||s.id::text)) % 100)<(60+(abs(hashtext(m2.user_id::text)) % 41))) then 'attended' else 'absent' end
   from public.group_sessions s join public.group_memberships m2 on m2.group_id=s.group_id where s.group_id=g;
 end loop;
 for j in 1..8 loop
  hw:=gen_random_uuid();
  insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by,deadline_at,uses_marks,workflow,mode,tries_mode,max_tries,solutions_open)
   values(hw,course,off,l,'Scale homework '||j,'published',hw,owner,lo+j*interval '1 second',true,'questions','PLATFORM_QUESTIONS','one_time',1,'after_deadline');
  insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values(gen_random_uuid(),hw,0,'essay','Explain',10,'text');
  insert into public.homework_submissions(id,assignment_id,user_id,number,status,submitted_at)
   select gen_random_uuid(),hw,sp.id,1,'submitted',now()-interval '1 day' from sp where sp.n<=1600 and (abs(hashtext(sp.id::text||j::text)) % 100)<80;
  insert into private.homework_corrections(submission_id,status,score,released_at,released_by) select x.id,'corrected',(abs(hashtext(x.id::text)) % 11),now(),owner from public.homework_submissions x where x.assignment_id=hw;
 end loop;
 for j in 1..3 loop
  ex:=gen_random_uuid();
  insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,created_by) values(ex,ex,course,off,'paper','Scale paper '||j,'published',now()-interval '30 days',40,(lo at time zone 'Africa/Cairo')::date,owner);
  insert into private.exam_results(exam_id,user_id,paper_mark,absent,status,score,max_score,released_at,released_by)
   select ex,sp.id,case when (abs(hashtext(sp.id::text||'e'||j)) % 20)=0 then null else (abs(hashtext(sp.id::text||j)) % 81)/2.0 end,(abs(hashtext(sp.id::text||'e'||j)) % 20)=0,'corrected',
    case when (abs(hashtext(sp.id::text||'e'||j)) % 20)=0 then null else (abs(hashtext(sp.id::text||j)) % 81)/2.0 end,40,now(),owner from sp where sp.n<=1600;
 end loop;
end $$;
analyze;
set local role authenticated;
select pg_temp.claim('owner');
do $$
declare t0 timestamptz; ids uuid[]; r jsonb; ga jsonb; rep jsonb; d1 numeric; d2 numeric; d3 numeric;
begin
 ids:=array(select id from public.study_groups where name like 'Scale group %' order by name limit 40);
 t0:=clock_timestamp(); r:=public.report_groups(ids); d1:=extract(epoch from clock_timestamp()-t0);
 perform pg_temp.ok(jsonb_array_length(r->'groups')=40 and (select sum((x->>'attention')::int) from jsonb_array_elements(r->'groups') x)>100,'the Groups list line for 40 Groups, with Needs attention counts');
 perform pg_temp.ok((select (x->'attendance'->>'total')::int from jsonb_array_elements(r->'groups') x where x->>'groupId'=ids[1]::text)=40*24,'a Group line counts 40 students over 24 sessions');
 t0:=clock_timestamp(); ga:=public.report_attention(null,0); d2:=extract(epoch from clock_timestamp()-t0);
 perform pg_temp.ok((ga->>'total')::int=(select sum((x->>'attention')::int) from jsonb_array_elements(r->'groups') x),'the Needs attention count is the sum of the Groups counts');
 perform pg_temp.ok(jsonb_array_length(ga->'rows')=25,'the first page of Needs attention has 25 rows');
 t0:=clock_timestamp(); rep:=public.report_group(ids[1],null); d3:=extract(epoch from clock_timestamp()-t0);
 perform pg_temp.ok((rep->>'attentionTotal')::int=(select (x->>'attention')::int from jsonb_array_elements(r->'groups') x where x->>'groupId'=ids[1]::text),'the Report tab and the Groups list agree on the count');
 perform pg_temp.ok(jsonb_array_length(rep->'attention')+jsonb_array_length(rep->'everyone')=40,'the Report tab lists all 40 students');
 raise notice 'TIMING reports-scale: groups list % s, attention % s, one Group report % s',round(d1,2),round(d2,2),round(d3,2);
 perform pg_temp.ok(d1<30 and d2<30 and d3<30,'each screen is one call and finishes inside the bound');
end $$;
select pg_temp.claim('owner_b');
select pg_temp.ok((public.report_attention(null,0)->>'total')::int=0,'the other space sees none of the first space students');
reset role;
select count(*)::integer reports_scale_tests from rs_results;
rollback;
