-- Synthetic fixtures only. Every change below rolls back. Disposable local PostgreSQL only.
-- Create a Group from a teacher's own new course: the course has no run, so the app inserts one as the signed-in teacher
-- (server/services/group-course-run.ts). This proves the existing rules on course_offerings decide who may, and that the whole
-- Create, Edit, add and remove chain then works on that run through the unchanged group_command.
begin;
create temp table gcr_results(name text primary key);grant select,insert on gcr_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAILED %',label;end if;insert into pg_temp.gcr_results values(label);end$$;
create function pg_temp.denied(sql text,code text,label text) returns void language plpgsql as $$declare caught text;begin begin execute sql;exception when others then get stacked diagnostics caught=returned_sqlstate;end;if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught;end if;insert into pg_temp.gcr_results values(label);end$$;
create function pg_temp.claim(n integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub','10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::text,true)::void$$;
create function pg_temp.g() returns uuid language sql as $$select current_setting('gcr.group')::uuid$$;
create function pg_temp.v() returns integer language sql as $$select version from public.study_groups where id=current_setting('gcr.group')::uuid$$;

-- A new course, made the way Settings > Courses makes it: it has a Course and no run.
set local role authenticated;
select pg_temp.claim(2);
select set_config('gcr.org',(select c.organization_id::text from public.courses c where c.id='30000000-0000-0000-0000-000000000001'),true);
select set_config('gcr.course',public.create_teacher_course(current_setting('gcr.org')::uuid,'Synthetic new course','synthetic-new-course')::text,true);
select pg_temp.ok(not exists(select 1 from public.course_offerings where course_id=current_setting('gcr.course')::uuid),'a new course has no run');

-- Who may add the run: the existing insert rule, with no new grant.
select pg_temp.claim(5);
select pg_temp.denied($q$insert into public.course_offerings(course_id,name,delivery_mode,status) values(current_setting('gcr.course')::uuid,'x','scheduled','active')$q$,'42501','student cannot add a run');
select pg_temp.claim(4);
select pg_temp.denied($q$insert into public.course_offerings(course_id,name,delivery_mode,status) values(current_setting('gcr.course')::uuid,'x','scheduled','active')$q$,'42501','assistant cannot add a run');
select pg_temp.claim(2);
-- The read rule cannot see a row its own statement is adding, so the app must not ask for the row back (no .select() on the insert).
select pg_temp.denied($q$insert into public.course_offerings(course_id,name,delivery_mode,status) values(current_setting('gcr.course')::uuid,'x','scheduled','active') returning id$q$,'42501','reading a new run back in the same statement is refused');
-- So the app sets the id. PostgREST sends a plain insert with no columns returned, which is the "returning 1" here.
select set_config('gcr.run',gen_random_uuid()::text,true);
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(current_setting('gcr.run')::uuid,current_setting('gcr.course')::uuid,'Synthetic new course','scheduled','active') returning 1;
select pg_temp.ok((select status='active' from public.course_offerings where id=current_setting('gcr.run')::uuid),'the course owner adds an active run and reads it back');

-- Create on that run.
select set_config('gcr.group',public.group_command(null,'create',null,jsonb_build_object('offeringId',current_setting('gcr.run'),'name','Synthetic Group','description','','mode','center','location','Synthetic centre','joinUrl','','instructions','','capacity',2,'schedules',jsonb_build_array(jsonb_build_object('weekday',0,'time','17:00','durationMinutes',90))))->>'id',true);
select pg_temp.ok((public.group_view(pg_temp.g(),'detail')->'group'->>'instructor')::boolean,'the owner is the instructor of the new Group');
select pg_temp.ok(jsonb_array_length(public.group_view(pg_temp.g(),'detail')->'schedules')=1,'its weekly time is saved');
select pg_temp.ok((select count(*)>0 from public.group_sessions where group_id=pg_temp.g()),'its Sessions exist');

-- Edit, as the form sends it: unchanged weekly times are left out and keep their Sessions.
select set_config('gcr.sessions',(select count(*)::text from public.group_sessions where group_id=pg_temp.g() and not cancelled),true);
select public.group_command(pg_temp.g(),'edit',pg_temp.v(),'{"name":"Synthetic Group renamed","mode":"center","location":"Another centre","joinUrl":"","capacity":3,"applyMeetingDefaults":true}');
select pg_temp.ok((select name='Synthetic Group renamed' and location='Another centre' and capacity=3 from public.study_groups where id=pg_temp.g()),'edit saves name, place and capacity');
select pg_temp.ok((select count(*)::text=current_setting('gcr.sessions') from public.group_sessions where group_id=pg_temp.g() and not cancelled),'leaving weekly times out keeps the Sessions');
select pg_temp.ok((select bool_and(location='Another centre') from public.group_sessions where group_id=pg_temp.g() and starts_at>clock_timestamp() and not cancelled),'upcoming weekly Sessions move to the new place');
select pg_temp.denied($q$select public.group_command(pg_temp.g(),'edit',pg_temp.v()-1,'{"name":"Stale"}')$q$,'PT409','a stale edit is refused');
select pg_temp.denied($q$select public.group_command(pg_temp.g(),'edit',pg_temp.v(),'{"mode":"center","location":" "}')$q$,'23514','a centre needs a location');
-- A removed time cancels its upcoming Sessions; a new one adds Sessions.
select public.group_command(pg_temp.g(),'edit',pg_temp.v(),'{"schedules":[{"weekday":2,"time":"18:00","durationMinutes":60}]}');
select pg_temp.ok((select bool_and(cancelled) from public.group_sessions s join public.group_schedules r on r.id=s.schedule_id where s.group_id=pg_temp.g() and r.weekday=0 and s.starts_at>clock_timestamp()),'upcoming Sessions at a removed time are cancelled');
select pg_temp.ok(jsonb_array_length(public.group_view(pg_temp.g(),'detail')->'schedules')=1,'only the new weekly time is active');

-- Students: only someone with access to this course is listed or can be added.
select pg_temp.ok(jsonb_array_length(public.group_view(pg_temp.g(),'eligible')->'rows')=0,'nobody has access to a brand-new course yet');
select pg_temp.denied($q$select public.group_command(pg_temp.g(),'add',pg_temp.v(),'{"userId":"10000000-0000-0000-0000-000000000005"}')$q$,'23514','a student without access cannot be added');
reset role;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(current_setting('gcr.run')::uuid,'10000000-0000-0000-0000-000000000005','active',now());
set local role authenticated;
select pg_temp.claim(2);
select pg_temp.ok(public.group_view(pg_temp.g(),'eligible')->'rows'->0->>'user_id'='10000000-0000-0000-0000-000000000005','a student with access is listed');
select pg_temp.ok((public.group_command(pg_temp.g(),'add',pg_temp.v(),'{"userId":"10000000-0000-0000-0000-000000000005"}')->>'version')::int=pg_temp.v(),'add returns the new version, so a second change needs no reload');
select pg_temp.ok((select count(*)=1 from public.group_memberships where group_id=pg_temp.g() and ends_at is null),'the student is in the Group');
select pg_temp.ok((public.group_command(pg_temp.g(),'remove',pg_temp.v(),'{"userId":"10000000-0000-0000-0000-000000000005"}')->>'version')::int=pg_temp.v(),'remove returns the new version');
select pg_temp.ok((select count(*)=0 from public.group_memberships where group_id=pg_temp.g() and ends_at is null),'the student has left the Group');
select pg_temp.ok((select count(*)=1 from public.group_memberships where group_id=pg_temp.g() and ends_at is not null),'the membership stays as history');
select pg_temp.ok((select status='active' from public.enrollments where offering_id=current_setting('gcr.run')::uuid and user_id='10000000-0000-0000-0000-000000000005'),'removal leaves course access untouched');
select pg_temp.denied($q$select public.group_command(pg_temp.g(),'remove',pg_temp.v(),'{"userId":"10000000-0000-0000-0000-000000000005"}')$q$,'PT409','removing someone already gone says it changed');

-- The same chain under a Firebase sign-in, whose subject is not a UUID: the rules resolve the person, not the token.
select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,'email','gcr.teacher@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','gcr-firebase-teacher')::text,true);
select set_config('gcr.fb',public.onboard_firebase_profile()::text,true);
select set_config('gcr.fb_run',gen_random_uuid()::text,true);
select pg_temp.denied($q$insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(current_setting('gcr.fb_run')::uuid,current_setting('gcr.course')::uuid,'x','scheduled','active')$q$,'42501','a Firebase teacher with no role in this space cannot add a run');
reset role;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(current_setting('gcr.org')::uuid,current_setting('gcr.fb')::uuid,'teacher','active',now());
set local role authenticated;
select pg_temp.denied($q$insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(current_setting('gcr.fb_run')::uuid,current_setting('gcr.course')::uuid,'x','scheduled','active')$q$,'42501','a Firebase teacher who does not teach this course cannot add a run');
select set_config('gcr.fb_course',public.create_teacher_course(current_setting('gcr.org')::uuid,'Synthetic Firebase course','synthetic-firebase-course')::text,true);
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(current_setting('gcr.fb_run')::uuid,current_setting('gcr.fb_course')::uuid,'Synthetic Firebase course','scheduled','active') returning 1;
select pg_temp.ok((select count(*)=1 from public.course_offerings where id=current_setting('gcr.fb_run')::uuid),'a Firebase teacher adds a run to their own course and reads it');
select set_config('gcr.group',public.group_command(null,'create',null,jsonb_build_object('offeringId',current_setting('gcr.fb_run'),'name','Synthetic Firebase Group','description','','mode','online','location','','joinUrl','','instructions','','capacity',null,'schedules',jsonb_build_array(jsonb_build_object('weekday',1,'time','10:00','durationMinutes',60))))->>'id',true);
select pg_temp.ok((public.group_view(pg_temp.g(),'detail')->'group'->>'instructor')::boolean,'a Firebase teacher creates a Group on it and is its instructor');
select pg_temp.ok((public.group_command(pg_temp.g(),'edit',pg_temp.v(),'{"name":"Synthetic Firebase renamed"}')->>'version')::int=pg_temp.v(),'and edits it');

select count(*) as group_course_run_tests from gcr_results;
rollback;
