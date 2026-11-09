-- Disposable local PostgreSQL only. Synthetic verified-gateway claims; every change rolls back; no real account exists.
-- Covers the teacher reads of migration 20261109120000_homework_teacher_rules.sql: public.homework_portal and public.homework_queue give exactly what a
-- naive query gives that authorizes EVERY homework of the whole database one by one (private.homework_staff), on a few hundred synthetic rows in two
-- spaces, for five Firebase callers: a space owner, an assistant of one offering, a course editor who is not support staff, a teacher of two spaces,
-- and the owner of the other space.
begin;
create temp table rd_results(name text primary key);
create temp table rd_users(label text primary key,id uuid not null);
grant select,insert on rd_results,rd_users to authenticated;
select set_config('rd.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.rd_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('rd.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','rd-'||current_setting('rd.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.rd_users where label=k$$;

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner_a','ta','editor','multi','owner_b'] loop
  perform pg_temp.claim(label); insert into pg_temp.rd_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;

-- ---------------------------------------------------------------- A few hundred rows in two spaces (deterministic)
select setseed(0.4242);
do $$
declare org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid(); courses uuid[]; offs uuid[]; lessons uuid[]; studs uuid[]:='{}';
 c uuid; m uuid; l uuid; o uuid; p uuid; hw uuid; prev uuid; q_e uuid; q_c uuid; opt uuid; s uuid; i integer; j integer; k integer; n integer; t integer; tries integer;
 dl timestamptz; st text; wf text; late boolean; essay numeric; at_ timestamptz; up uuid; run text:=current_setting('rd.run');
begin
 insert into public.organizations(id,name,slug) values(org_a,'Reads A','rd-a-'||run),(org_b,'Reads B','rd-b-'||run);
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values
  (org_a,pg_temp.uid('owner_a'),'owner','active',now()),(org_a,pg_temp.uid('ta'),'assistant','active',now()),(org_a,pg_temp.uid('editor'),'teacher','active',now()),
  (org_a,pg_temp.uid('multi'),'teacher','active',now()),(org_b,pg_temp.uid('owner_b'),'owner','active',now()),(org_b,pg_temp.uid('multi'),'teacher','active',now());
 courses:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
  (courses[1],org_a,'Reads course one','rd-one','published','private',pg_temp.uid('owner_a')),(courses[2],org_a,'Reads course two','rd-two','published','private',pg_temp.uid('owner_a')),
  (courses[3],org_b,'Reads course three','rd-three','published','private',pg_temp.uid('owner_b'));
 insert into public.course_staff(course_id,user_id,role) values(courses[1],pg_temp.uid('editor'),'editor'),(courses[2],pg_temp.uid('multi'),'instructor');
 lessons:='{}';
 foreach c in array courses loop
  insert into public.course_modules(id,course_id,title,position) values(gen_random_uuid(),c,'Chapter',0) returning id into m;
  insert into public.lessons(id,module_id,title,position,status) values(gen_random_uuid(),m,'Lesson of '||c::text,0,'published') returning id into l;
  lessons:=lessons||l;
 end loop;
 offs:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(offs[1],courses[1],'Run 1a','scheduled','active'),(offs[2],courses[1],'Run 1b','scheduled','active'),
  (offs[3],courses[2],'Run 2','scheduled','active'),(offs[4],courses[3],'Run 3','scheduled','active');
 insert into public.offering_staff(offering_id,user_id,role) values(offs[1],pg_temp.uid('ta'),'teaching_assistant'),(offs[4],pg_temp.uid('multi'),'instructor');
 for i in 1..48 loop
  insert into public.profiles(id,display_name) values(gen_random_uuid(),'Reader student '||lpad(i::text,2,'0')) returning id into p; studs:=studs||p;
  -- Every student in one offering, every third also in a second one; a few enrollments have expired.
  insert into public.enrollments(offering_id,user_id,status,enrolled_at,expires_at) values(offs[1+(i%4)],p,'active',now()-interval '30 days',case when i%11=0 then now()-interval '2 days' end);
  if i%3=0 then insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(offs[1+((i+1)%4)],p,'active',now()-interval '30 days'); end if;
 end loop;
 for k in 1..4 loop
  o:=offs[k]; c:=case k when 1 then courses[1] when 2 then courses[1] when 3 then courses[2] else courses[3] end; l:=lessons[case k when 4 then 3 when 3 then 2 else 1 end];
  for j in 1..7 loop
   hw:=gen_random_uuid(); wf:=case when j=7 then 'legacy' else 'questions' end;
   st:=case when j=1 then 'draft' else 'published' end;
   dl:=case when wf='legacy' then null when j in (2,3) then now()+make_interval(days=>2+j) else now()-make_interval(days=>j) end;
   late:=wf='questions' and j%2=0;
   insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,mode,status,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,created_by,updated_at)
    values(hw,hw,c,o,l,'Homework '||k||'.'||j,case when wf='legacy' then 'FILE_UPLOAD' else 'PLATFORM_QUESTIONS' end,st,wf,dl,late,
     case when wf='questions' then (array['one_time','fix_mistakes','from_zero'])[1+j%3] end,case when wf='questions' then case when j%3=0 then 1 else 3 end end,
     case when wf='questions' then (array['after_hand_in','after_deadline'])[1+j%2] end,pg_temp.uid('owner_a'),now()-make_interval(hours=>j*k));
   -- A second version: in offering 1, homework 4 gets v2 (no work in it), so v1 (with work) and v2 are both listed; homework 2 gets v2 and its v1 (no work) is hidden.
   if k=1 and j in (2,4) then prev:=hw; hw:=gen_random_uuid();
    insert into public.homework_assignments(id,family_id,course_id,offering_id,lesson_id,title,mode,status,workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,created_by,version,supersedes_id)
     select hw,prev,course_id,offering_id,lesson_id,title||' v2',mode,'draft',workflow,deadline_at,late_allowed,tries_mode,max_tries,solutions_open,created_by,2,prev from public.homework_assignments where id=prev;
    if j=4 then hw:=prev; else continue; end if;
   end if;
   if wf='questions' then
    q_e:=gen_random_uuid(); q_c:=gen_random_uuid(); opt:=gen_random_uuid();
    insert into public.homework_questions(id,assignment_id,position,type,text,points,response_mode) values(q_e,hw,0,'essay','Explain',6,'both'),(q_c,hw,1,'single_choice','Pick',2,'text');
    insert into public.homework_options(id,question_id,position,text) values(opt,q_c,0,'Yes'),(gen_random_uuid(),q_c,1,'No');
    insert into private.homework_keys(question_id,correct_ids) values(q_e,'{}'),(q_c,array[opt]);
   end if;
   if st='draft' then continue; end if;
   foreach p in array studs loop
    continue when not exists(select 1 from public.enrollments e where e.offering_id=o and e.user_id=p) or random()<0.3;
    tries:=case when wf='legacy' then 1 else 1+floor(random()*2)::integer end;
    for t in 1..tries loop
     at_:=now()-make_interval(hours=>floor(random()*400)::integer);
     if t=tries and random()<0.15 then
      insert into public.homework_submissions(assignment_id,user_id,number,status) values(hw,p,t,'draft'); exit;
     end if;
     insert into public.homework_submissions(assignment_id,user_id,number,status,submitted_at,missed_deadline) values(hw,p,t,'submitted',at_,late and t=1 and random()<0.3) returning id into s;
     if wf='questions' then
      essay:=case when random()<0.4 then null else floor(random()*7) end;
      insert into private.homework_marks(submission_id,question_id,points) values(s,q_e,essay),(s,q_c,case when random()<0.5 then 2 else 0 end);
      insert into private.homework_corrections(submission_id,status,score,corrected_by,corrected_at,released_at,released_by)
       select s,case when essay is null then 'under_correction' else 'corrected' end,case when essay is not null then essay end,case when essay is not null then pg_temp.uid('owner_a') end,
        case when essay is not null then now()-make_interval(hours=>floor(random()*300)::integer) end,r,case when r is not null then pg_temp.uid('owner_a') end
       from (select case when essay is not null and random()<0.3 then now() end r) x;
     else
      insert into private.homework_corrections(submission_id,status,corrected_at,corrected_by) select s,v,case when v='corrected' then now()-interval '1 day' end,case when v='corrected' then pg_temp.uid('owner_a') end
       from (select case when random()<0.5 then 'under_correction' else 'corrected' end v) x;
     end if;
     if random()<0.5 then
      up:=gen_random_uuid();
      insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path,status,size_bytes,sha256,pages,deleted_at)
       select up,hw,p,s,'submission','p.jpg','image/jpeg',hw::text||'/'||up::text||'/resource.jpg',v,1000+floor(random()*4000000)::bigint,repeat('e',64),1,case when v='deleted' then now() end
       from (select case when random()<0.2 then 'deleted' else 'ready' end v) x;
     end if;
    end loop;
   end loop;
  end loop;
 end loop;
end $$;
select pg_temp.ok((select count(*) between 200 and 900 from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id where a.title like 'Homework %'),'a few hundred synthetic tries exist');

-- ---------------------------------------------------------------- The naive answers: every homework of the database, authorized one by one
create function pg_temp.naive_rows() returns table(id uuid,tab text,counted boolean,j jsonb) language sql security definer set search_path='' as $$
 with v as (select a.*,private.homework_staff(a.id,'grade') counted,case when a.status='draft' then 'drafts' when a.deadline_at is not null and a.deadline_at<=clock_timestamp() then 'closed' else 'open' end tab
  from public.homework_assignments a where private.homework_staff(a.id)
   and (not exists(select 1 from public.homework_assignments n where n.family_id=a.family_id and n.version>a.version) or exists(select 1 from public.homework_submissions s where s.assignment_id=a.id and s.status='submitted'))),
 latest as (select s.* from public.homework_submissions s where s.status='submitted' and s.number=(select max(x.number) from public.homework_submissions x where x.assignment_id=s.assignment_id and x.user_id=s.user_id and x.status='submitted'))
 select v.id,v.tab,v.counted,jsonb_build_object('id',v.id,'title',v.title,'courseId',v.course_id,'courseTitle',(select title from public.courses where id=v.course_id),'offeringId',v.offering_id,
  'lessonId',v.lesson_id,'lessonTitle',(select title from public.lessons where id=v.lesson_id),'version',v.version,'workflow',v.workflow,'mode',v.mode,'status',v.status,'deadline',v.deadline_at,
  'lateAllowed',v.late_allowed,'tries',v.tries_mode,'maxTries',v.max_tries,'solutionsOpen',v.solutions_open,'photosAllowed',v.photos_allowed,'updatedAt',v.updated_at,
  'handedIn',case when v.counted then (select count(*) from latest l where l.assignment_id=v.id) end,
  'total',case when v.counted then (select count(distinct e.user_id) from public.enrollments e where e.offering_id=v.offering_id and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp())) end,
  'late',case when v.counted then (select count(distinct s.user_id) from public.homework_submissions s where s.assignment_id=v.id and s.status='submitted' and s.missed_deadline) end,
  'waiting',case when v.counted then (select coalesce(sum((select count(*) from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id=l.id and m.points is null and q.type='essay')
    +case when v.mode='FILE_UPLOAD' and (select c.status from private.homework_corrections c where c.submission_id=l.id)='under_correction' then 1 else 0 end),0) from latest l where l.assignment_id=v.id) end,
  'imageBytes',case when v.counted and v.tab='closed' then (select coalesce(sum(u.size_bytes),0) from private.homework_uploads u where u.assignment_id=v.id and u.purpose='submission' and u.status='ready') end)
 from v
$$;
create function pg_temp.naive_stats() returns jsonb language sql security definer set search_path='' as $$
 with w as (select private.homework_week_start(clock_timestamp()) s), we as (select s,((s at time zone 'Africa/Cairo')+interval '7 days') at time zone 'Africa/Cairo' e from w),
 counted as (select r.id,r.j from pg_temp.naive_rows() r where r.counted),
 subs as (select s.* from public.homework_submissions s where s.status='submitted' and s.assignment_id in (select id from counted))
 select jsonb_build_object('weekStart',(select s from we),'weekEnd',(select e from we),
  'essaysWaiting',(select coalesce(sum((j->>'waiting')::numeric),0) from counted),
  'correctedThisWeek',(select count(*) from private.homework_corrections c join subs s on s.id=c.submission_id,we where c.corrected_at>=we.s and c.corrected_at<we.e),
  'handedInThisWeek',(select count(*) from subs,we where submitted_at>=we.s and submitted_at<we.e),
  'onTimePercent',(select case when count(*)=0 then null else round(100.0*count(*) filter(where not missed_deadline)/count(*)) end from subs,we where number=1 and submitted_at>=we.s and submitted_at<we.e))
$$;
-- Every page of a tab of the portal, as one set ordered by id.
create function pg_temp.portal_all(p_tab text) returns jsonb language plpgsql set search_path='' as $$
declare page integer:=0; r jsonb; acc jsonb:='[]'::jsonb; begin
 loop r:=public.homework_portal(null,p_tab,page)->'rows'; exit when jsonb_array_length(r)=0; acc:=acc||r; page:=page+1; end loop;
 return (select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) from jsonb_array_elements(acc) e); end$$;
create function pg_temp.naive_tab(p_tab text) returns jsonb language sql as $$select coalesce(jsonb_agg(j order by id::text),'[]'::jsonb) from pg_temp.naive_rows() where tab=p_tab$$;
-- The queue, every page of every tab, against the naive answer for one homework.
create function pg_temp.queue_all(hw uuid,p_tab text) returns jsonb language plpgsql set search_path='' as $$
declare page integer:=0; r jsonb; acc jsonb:='[]'::jsonb; begin
 loop r:=public.homework_queue(hw,p_tab,page)->'rows'; exit when jsonb_array_length(r)=0; acc:=acc||r; page:=page+1; end loop;
 return (select coalesce(jsonb_agg(e order by e->>'userId'),'[]'::jsonb) from jsonb_array_elements(acc) e); end$$;
create function pg_temp.naive_queue(hw uuid,p_tab text) returns jsonb language sql security definer set search_path='' as $$
 with a as (select * from public.homework_assignments where id=hw),
 latest as (select s.* from public.homework_submissions s where s.assignment_id=hw and s.status='submitted' and s.number=(select max(x.number) from public.homework_submissions x where x.assignment_id=hw and x.user_id=s.user_id and x.status='submitted')),
 done as (select l.*,(select display_name from public.profiles where id=l.user_id) display_name,c.status cstatus,c.released_at is not null released,c.score,c.revision crev,
   exists(select 1 from public.homework_submissions x where x.assignment_id=hw and x.user_id=l.user_id and x.missed_deadline) is_late,
   (select count(*) from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id=l.id and m.points is null and q.type='essay')+case when (select mode from a)='FILE_UPLOAD' and c.status='under_correction' then 1 else 0 end waiting
  from latest l join private.homework_corrections c on c.submission_id=l.id),
 roster as (select distinct e.user_id from public.enrollments e where e.offering_id=(select offering_id from a) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp()))
 select case when p_tab='counts' then jsonb_build_object('toCorrect',(select count(*) from done where waiting>0),'done',(select count(*) from done where waiting=0),
   'missing',(select count(*) from roster r where not exists(select 1 from latest l where l.user_id=r.user_id)),'handedIn',(select count(*) from done),'total',(select count(*) from roster),'late',(select count(*) from done where is_late))
  when p_tab='missing' then coalesce((select jsonb_agg(jsonb_build_object('userId',r.user_id,'name',(select display_name from public.profiles where id=r.user_id)) order by r.user_id::text) from roster r where not exists(select 1 from latest l where l.user_id=r.user_id)),'[]'::jsonb)
  else coalesce((select jsonb_agg(jsonb_build_object('userId',d.user_id,'name',d.display_name,'submissionId',d.id,'try',d.number,'submittedAt',d.submitted_at,'late',d.is_late,'waiting',d.waiting,
   'status',d.cstatus,'released',d.released,'score',d.score,'revision',d.crev) order by d.user_id::text) from done d where (d.waiting>0)=(p_tab='to_correct')),'[]'::jsonb) end
$$;
create function pg_temp.check_caller(who text) returns void language plpgsql set search_path='' as $$
declare t text; hw uuid; portal jsonb; n integer:=0; begin
 perform pg_temp.claim(who);
 portal:=public.homework_portal(null,'open',0);
 foreach t in array array['open','closed','drafts'] loop
  if pg_temp.portal_all(t) is distinct from pg_temp.naive_tab(t) then raise exception 'FAILED % tab % differs',who,t; end if;
  if (portal->'counts'->>t)::int<>jsonb_array_length(pg_temp.naive_tab(t)) then raise exception 'FAILED % count % differs',who,t; end if;
 end loop;
 if portal->'stats' is distinct from pg_temp.naive_stats() then raise exception 'FAILED % stats % vs %',who,portal->'stats',pg_temp.naive_stats(); end if;
 if (select coalesce(jsonb_agg(e order by e->>'id'),'[]'::jsonb) from jsonb_array_elements(portal->'toCorrect') e) is distinct from
    (select coalesce(jsonb_agg(j order by id::text),'[]'::jsonb) from pg_temp.naive_rows() where counted and (j->>'waiting')::numeric>0) then raise exception 'FAILED % to correct differs',who; end if;
 for hw in select id from pg_temp.naive_rows() where counted loop
  n:=n+1;
  if public.homework_queue(hw)->'counts' is distinct from pg_temp.naive_queue(hw,'counts') then raise exception 'FAILED % queue counts %',who,hw; end if;
  foreach t in array array['to_correct','done','missing'] loop
   if pg_temp.queue_all(hw,t) is distinct from pg_temp.naive_queue(hw,t) then raise exception 'FAILED % queue % %',who,t,hw; end if;
  end loop;
 end loop;
 insert into pg_temp.rd_results values('the portal and the queue equal the naive answers for '||who||' ('||n||' queues)');
end$$;

set local role authenticated;
select pg_temp.check_caller(x) from unnest(array['owner_a','ta','editor','multi','owner_b']) x;
select pg_temp.claim('owner_a');
select pg_temp.ok((select count(*)>=20 from pg_temp.naive_rows()) and (select count(*) filter(where (j->>'handedIn')::int>0)>=10 from pg_temp.naive_rows()),'the owner''s answers are not trivially empty');
select pg_temp.ok((select bool_and(a.d<=b.d) from (select (e->>'deadline')::timestamptz d,row_number() over() i from jsonb_array_elements(public.homework_portal(null,'closed',0)->'rows') e) a
 join (select (e->>'deadline')::timestamptz d,row_number() over() i from jsonb_array_elements(public.homework_portal(null,'closed',0)->'rows') e) b on b.i=a.i-1),'Closed is newest deadline first');
select pg_temp.claim('editor');
select pg_temp.ok((select count(*)>0 and bool_and(not counted) from pg_temp.naive_rows()),'the editor sees homework of the course, with no student numbers');
select pg_temp.claim('ta');
select pg_temp.ok((select count(*)>0 and bool_and(counted) from pg_temp.naive_rows()),'the assistant sees only the offering they support');
select pg_temp.claim('multi');
select pg_temp.ok((select count(distinct j->>'courseId')=2 from pg_temp.naive_rows()),'the teacher of two spaces sees both');
-- One call per view: the portal does not call the per-homework authorization at all.
reset role;
select pg_temp.ok(position('homework_staff' in pg_get_functiondef('private.homework_portal(uuid,text,integer)'::regprocedure))=0,'the portal never authorizes per homework row');
select count(*)::integer homework_reads_tests from rd_results;
rollback;
