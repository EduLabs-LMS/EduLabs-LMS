-- Disposable local PostgreSQL only. Synthetic verified-gateway claims (Firebase identities, non-UUID subjects); every change rolls back; no real account.
-- Covers migration 20261119120000_live_class.sql (the EduLabs class): who may open or start a class (owner, the Group's assistant, an assistant of the
-- run who is not on the Group, the Group's students, a student of another Group, another space, anon), the window (15 minutes before to 30 minutes
-- after), cancelled Sessions and archived Groups, Own link and centre Sessions refused, one start and one "Your class has started" however often
-- Start is pressed, the join log (never attendance), who opened it (staff only), the notices of an EduLabs class Session (the per-Session notice,
-- the "starts soon" reminder, "has started", their links, no Group-level joining notice), the privileges of the new objects, and demo seed 9.
begin;
create temp table lc_results(name text primary key);
create temp table lc_users(label text primary key,id uuid not null);
create temp table lc_ids(label text primary key,id uuid not null);
grant select,insert,update on lc_results,lc_users,lc_ids to authenticated,anon,service_role;
select set_config('lc.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.lc_results values(label);end$$;
create function pg_temp.refusal(statement text) returns text language plpgsql set search_path='' as $$declare c text;begin
 begin execute statement; exception when others then get stacked diagnostics c=returned_sqlstate; return c; end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare r text;begin
 r:=pg_temp.refusal(statement);
 if r is distinct from code then raise exception 'FAILED % expected % got %',label,code,r; end if;
 insert into pg_temp.lc_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('lc.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','lc-'||current_setting('lc.run')||'-'||label)::text,true);end$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.lc_users where label=k$$;
create function pg_temp.key(k text) returns uuid language sql as $$select id from pg_temp.lc_ids where label=k$$;
create function pg_temp.put(k text,v uuid) returns uuid language sql as $$insert into pg_temp.lc_ids values(k,v) on conflict(label) do update set id=excluded.id returning id$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.refusal(text),pg_temp.denied(text,text,text),pg_temp.claim(text),pg_temp.uid(text),pg_temp.key(text),pg_temp.put(text,uuid) to authenticated,anon,service_role;
-- Open a class as someone: the reply.
create function pg_temp.open_as(who text,s text,start boolean default false) returns jsonb language plpgsql set search_path='' as $$declare r jsonb;begin
 perform pg_temp.claim(who); set local role authenticated; r:=public.live_class_open(pg_temp.key(s),start); reset role; return r;end$$;
-- The current notifications of a person, as notification_command('list') gives them (the RLS-bound path the app uses).
create function pg_temp.list_as(who text) returns jsonb language plpgsql set search_path='' as $$declare r jsonb;begin
 perform pg_temp.claim(who); set local role authenticated; r:=public.notification_command('list','{}'::jsonb)->'rows'; reset role; return r;end$$;

-- Privileges of the new objects.
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.live_class_rooms'::regclass,'private.live_class_joins'::regclass)),'both tables have row level security');
select pg_temp.ok(not has_table_privilege('authenticated','private.live_class_rooms','select') and not has_table_privilege('authenticated','private.live_class_joins','select')
 and not has_table_privilege('authenticated','private.live_class_joins','insert') and not has_table_privilege('anon','private.live_class_rooms','select'),'no role reads or writes the tables directly');
select pg_temp.ok(not has_function_privilege('authenticated','private.emit_class_started(uuid)','execute') and not has_function_privilege('anon','private.emit_class_started(uuid)','execute'),'nobody may send "class started" by hand');
select pg_temp.ok(has_function_privilege('authenticated','public.live_class_open(uuid,boolean)','execute') and not has_function_privilege('anon','public.live_class_open(uuid,boolean)','execute')
 and has_function_privilege('authenticated','public.live_class_joined(uuid)','execute') and not has_function_privilege('anon','public.live_class_joined(uuid)','execute'),'the two doors: signed-in only');
select pg_temp.ok(bool_and(proconfig=array['search_path=""']) and count(*)=7,'every new or replaced function has the empty search path')
 from pg_proc where (pronamespace='private'::regnamespace and proname in ('live_class_open','live_class_joined','emit_class_started','notification_current','emit_session_notice','notification_link'))
  or (pronamespace='public'::regnamespace and proname='live_class_open');
select pg_temp.ok((select bool_and(prosecdef) from pg_proc where pronamespace='private'::regnamespace and proname in ('live_class_open','live_class_joined','emit_class_started'))
 and (select bool_and(not prosecdef) from pg_proc where pronamespace='public'::regnamespace and proname in ('live_class_open','live_class_joined')),'private definer functions behind invoker wrappers');
select pg_temp.ok((select count(*)=0 from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'live_class%' and pg_get_functiondef(p.oid) like '%auth.uid()%'),'the caller is private.current_app_user_id(), never auth.uid()');

-- Fixture: one space, one run, three Groups (EduLabs class, Own link, centre), another space.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner','ta','tano','a','b','c','outsider','sb'] loop
  perform pg_temp.claim(label); insert into pg_temp.lc_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
update public.profiles p set display_name=initcap(u.label)||' Student' from pg_temp.lc_users u where u.id=p.id and u.label in ('a','b','c','sb');
update public.profiles set display_name='Synthetic Assistant' where id=pg_temp.uid('ta');
select pg_temp.put(k,gen_random_uuid()) from unnest(array['org','org_b','course','course_b','off','off_b','g','gl','gc','gb']) k;
insert into public.organizations(id,name,slug) values(pg_temp.key('org'),'Synthetic live class','lc-'||current_setting('lc.run')),(pg_temp.key('org_b'),'Synthetic other','lc-b-'||current_setting('lc.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('ta','assistant'),('tano','assistant')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('outsider'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org'),'Synthetic Physics','lc-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','lc-foreign','published','private',pg_temp.uid('outsider'));
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),
 (pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.offering_staff(offering_id,user_id,role) values(pg_temp.key('off'),pg_temp.uid('ta'),'teaching_assistant'),(pg_temp.key('off'),pg_temp.uid('tano'),'teaching_assistant');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select pg_temp.key('off'),pg_temp.uid(l),'active',now()-interval '30 days' from unnest(array['a','b','c']) l;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off_b'),pg_temp.uid('sb'),'active',now()-interval '30 days');
insert into public.study_groups(id,offering_id,name,mode,location,join_url,created_by) values
 (pg_temp.key('g'),pg_temp.key('off'),'Online class group','online','','',pg_temp.uid('owner')),
 (pg_temp.key('gl'),pg_temp.key('off'),'Own link group','online','','https://meet.example.com/own-room',pg_temp.uid('owner')),
 (pg_temp.key('gc'),pg_temp.key('off'),'Centre group','center','Room 1','',pg_temp.uid('owner')),
 (pg_temp.key('gb'),pg_temp.key('off_b'),'Foreign group','online','','',pg_temp.uid('outsider'));
insert into public.group_staff(group_id,user_id) values(pg_temp.key('g'),pg_temp.uid('ta'));
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select pg_temp.key(v.gk),e.offering_id,e.user_id,e.id,now()-interval '30 days',pg_temp.uid('owner')
 from (values('a','g'),('b','g'),('c','gl'),('sb','gb')) v(l,gk) join public.enrollments e on e.user_id=pg_temp.uid(v.l);
-- Sessions, added the way a one-off is (no schedule), after the members, so the per-Session notice has recipients.
create function pg_temp.session(k text,grp text,starts interval,minutes integer,cancelled boolean default false) returns uuid language sql set search_path='' as $$
 insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,join_url,exception,cancelled,created_by,updated_by)
 select pg_temp.put(k,gen_random_uuid()),g.id,'Synthetic '||k,now()+starts,now()+starts+make_interval(mins=>minutes),now()+starts,now()+starts+make_interval(mins=>minutes),
  g.mode,g.location,g.join_url,true,cancelled,g.created_by,g.created_by from public.study_groups g where g.id=pg_temp.key(grp)
 returning id$$;
select pg_temp.session('s_now','g',interval '-10 minutes',60);
select pg_temp.session('s_soon','g',interval '5 minutes',60);
select pg_temp.session('s_early','g',interval '2 hours',60);
select pg_temp.session('s_past','g',interval '-3 hours',60);
select pg_temp.session('s_cancel','g',interval '5 minutes',60,true);
select pg_temp.session('s_end','g',interval '-80 minutes',60);
select pg_temp.session('s_link','gl',interval '-10 minutes',60);
select pg_temp.session('s_centre','gc',interval '-10 minutes',60);
select pg_temp.session('s_foreign','gb',interval '-10 minutes',60);

-- An EduLabs class Session gets the per-Session notice when it is added (before: only Sessions with a link). No Group-level joining notice.
select pg_temp.ok((select count(distinct n.recipient_id)=2 from public.notifications n join private.notification_events e on e.id=n.event_id
 where e.session_id=pg_temp.key('s_soon') and e.event_type='session_details' and n.recipient_id in (pg_temp.uid('a'),pg_temp.uid('b'))),'a new EduLabs class Session sends its per-Session notice to the Group''s two students');
select pg_temp.ok((select count(*)=0 from private.notification_events where event_key like 'group-details:'||pg_temp.key('g')||':%'),'no Group-level "joining details" notice for an EduLabs class Group (there is no link)');
select pg_temp.ok((select count(*)=0 from public.notifications n join private.notification_events e on e.id=n.event_id where e.session_id=pg_temp.key('s_soon') and n.recipient_id=pg_temp.uid('c')),'a student of another Group gets none');

-- Who may open: anon and strangers are refused, with no hint that the Session exists.
set local role anon;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,true)',pg_temp.key('s_now')),'42501','anon cannot open a class');
reset role;
select pg_temp.claim('outsider'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,true)',pg_temp.key('s_now')),'42501','the owner of another space cannot start it');
select pg_temp.denied(format('select public.live_class_open(%L::uuid,false)',gen_random_uuid()),'42501','an unknown Session gives the same refusal');
reset role;
select pg_temp.claim('sb'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,false)',pg_temp.key('s_now')),'42501','a student of another space cannot open it');
reset role;
select pg_temp.claim('c'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,false)',pg_temp.key('s_now')),'42501','a student of another Group of the same run cannot open it');
reset role;
select pg_temp.claim('tano'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,true)',pg_temp.key('s_now')),'42501','an assistant of the run who is not on the Group cannot start it');
select pg_temp.denied(format('select public.live_class_joined(%L::uuid)',pg_temp.key('s_now')),'42501','nor read who joined');
reset role;
-- Own link and centre Sessions are not EduLabs classes.
select pg_temp.claim('owner'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_open(%L::uuid,true)',pg_temp.key('s_link')),'23514','an Own link Session is refused');
select pg_temp.denied(format('select public.live_class_open(%L::uuid,true)',pg_temp.key('s_centre')),'23514','a centre Session is refused');
reset role;

-- Before anyone starts it: the student waits (no room), the teacher may start (no room until Start is pressed).
select pg_temp.ok(pg_temp.open_as('a','s_now')->>'state'='waiting' and not (pg_temp.open_as('a','s_now') ? 'room'),'a student waits until staff start the class, and gets no room');
select pg_temp.ok(pg_temp.open_as('a','s_now',true)->>'state'='waiting','a student pressing "start" still waits: only staff start');
select pg_temp.ok(pg_temp.open_as('owner','s_now')->>'state'='ready' and (pg_temp.open_as('owner','s_now')->>'staff')::boolean,'the teacher sees "ready" before pressing Start');
select pg_temp.ok((select count(*)=0 from private.live_class_rooms where session_id=pg_temp.key('s_now')) and (select count(*)=0 from private.live_class_joins where session_id=pg_temp.key('s_now')),'opening without starting creates no room and logs no join');

-- The Group's assistant starts it: one room, one "Your class has started" to the Group's students, an audit row.
select set_config('lc.start',pg_temp.open_as('ta','s_now',true)::text,true);
select pg_temp.ok(current_setting('lc.start')::jsonb->>'state'='open' and (current_setting('lc.start')::jsonb->>'moderator')::boolean and (current_setting('lc.start')::jsonb->>'startedNow')::boolean
 and current_setting('lc.start')::jsonb->>'room' ~ '^[0-9a-f]{64}$' and current_setting('lc.start')::jsonb->>'displayName'='Synthetic Assistant','the Group''s assistant starts the class: moderator, a 64-hex room, their own name');
select pg_temp.ok(not (current_setting('lc.start')::jsonb::text like '%@%'),'no e-mail address in the reply');
select pg_temp.ok((select started_by=pg_temp.uid('ta') from private.live_class_rooms where session_id=pg_temp.key('s_now')),'the room records who started it');
select pg_temp.ok((select count(*)=1 from private.group_audit where session_id=pg_temp.key('s_now') and action='live_class_start' and actor_id=pg_temp.uid('ta')),'the start is in the Group audit');
select pg_temp.ok((select count(*)=1 from private.notification_events where event_type='class_started' and session_id=pg_temp.key('s_now') and resource_id=pg_temp.key('g')),'one "class started" event, tied to the Session and the Group');
select pg_temp.ok((select count(*)=2 and bool_and(n.recipient_id in (pg_temp.uid('a'),pg_temp.uid('b'))) from public.notifications n join private.notification_events e on e.id=n.event_id where e.event_type='class_started' and e.session_id=pg_temp.key('s_now')),'both students of the Group are told, nobody else');
-- Pressing Start again (the owner, then the assistant) changes nothing.
select set_config('lc.again',pg_temp.open_as('owner','s_now',true)::text,true);
select pg_temp.ok(current_setting('lc.again')::jsonb->>'room'=current_setting('lc.start')::jsonb->>'room' and not (current_setting('lc.again')::jsonb->>'startedNow')::boolean and (current_setting('lc.again')::jsonb->>'moderator')::boolean,'Start again: the same room, not a new start, the owner is a moderator');
select pg_temp.open_as('ta','s_now',true);
select pg_temp.ok((select count(*)=1 from private.notification_events where event_type='class_started' and session_id=pg_temp.key('s_now')) and (select count(*)=2 from public.notifications n join private.notification_events e on e.id=n.event_id where e.event_type='class_started' and e.session_id=pg_temp.key('s_now')),'still one event and two notifications');
select pg_temp.ok((select count(*)=1 from private.group_audit where session_id=pg_temp.key('s_now') and action='live_class_start'),'still one audit row');

-- The student joins: the same room, not a moderator, logged, and attendance is never written.
select set_config('lc.join',pg_temp.open_as('a','s_now')::text,true);
select pg_temp.ok(current_setting('lc.join')::jsonb->>'state'='open' and current_setting('lc.join')::jsonb->>'room'=current_setting('lc.start')::jsonb->>'room' and not (current_setting('lc.join')::jsonb->>'moderator')::boolean
 and current_setting('lc.join')::jsonb->>'displayName'='A Student','the student joins the same room as a plain member, under their own name');
select pg_temp.open_as('a','s_now');
select pg_temp.ok((select joins=2 and not staff and last_at>=first_at from private.live_class_joins where session_id=pg_temp.key('s_now') and user_id=pg_temp.uid('a')),'one join row per person, counted');
select pg_temp.ok((select count(*)=0 from public.session_attendance where session_id=pg_temp.key('s_now')) and (select roster_at is null from public.group_sessions where id=pg_temp.key('s_now')),'joining never writes attendance (not even the list of students)');

-- Who opened it: staff only; students' ids only.
select pg_temp.claim('owner'); set local role authenticated;
select set_config('lc.joined',public.live_class_joined(pg_temp.key('s_now'))::text,true);
reset role;
select pg_temp.ok(current_setting('lc.joined')::jsonb->'joined'=jsonb_build_array(pg_temp.uid('a')) and (current_setting('lc.joined')::jsonb->>'liveClass')::boolean and current_setting('lc.joined')::jsonb->>'startedAt' is not null,'the teacher sees that student a opened the class (staff who opened it are not listed)');
select pg_temp.claim('a'); set local role authenticated;
select pg_temp.denied(format('select public.live_class_joined(%L::uuid)',pg_temp.key('s_now')),'42501','a student cannot read who joined');
reset role;
select pg_temp.claim('ta'); set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.live_class_joined(pg_temp.key('s_now'))->'joined')=1,'the Group''s assistant can read it');
select pg_temp.denied(format('select public.live_class_joined(%L::uuid)',pg_temp.key('s_link')),'42501','but not for a Group they are not on');
reset role;
select pg_temp.claim('owner'); set local role authenticated;
select pg_temp.ok(public.live_class_joined(pg_temp.key('s_link'))->>'liveClass'='false','an Own link Session says it is not an EduLabs class');
reset role;

-- The teacher's Take attendance saves joined, not-marked students as Present with the EXISTING save, recorded as the teacher, never finishing.
select pg_temp.claim('owner'); set local role authenticated;
select public.group_command(pg_temp.key('g'),'attendance',null,jsonb_build_object('sessionId',pg_temp.key('s_now'),'sessionVersion',(select version from public.group_sessions where id=pg_temp.key('s_now')),'marks',jsonb_build_array(jsonb_build_object('userId',pg_temp.uid('a'),'status','attended'))));
reset role;
select pg_temp.ok((select status='attended' and updated_by=pg_temp.uid('owner') from public.session_attendance where session_id=pg_temp.key('s_now') and user_id=pg_temp.uid('a'))
 and (select status='not_marked' from public.session_attendance where session_id=pg_temp.key('s_now') and user_id=pg_temp.uid('b'))
 and (select attendance_state='draft' from public.group_sessions where id=pg_temp.key('s_now')),'the existing save marks the joined student Present as the teacher; the other stays not marked; the sheet is not finished');

-- The window: 15 minutes before the start to 30 minutes after the end. Cancelled Sessions and archived Groups are closed.
select pg_temp.ok(pg_temp.open_as('owner','s_soon',true)->>'state'='open','a class that starts in 5 minutes can be started now (15 minutes before)');
select pg_temp.ok(pg_temp.open_as('owner','s_early',true)->>'state'='early' and (select count(*)=0 from private.live_class_rooms where session_id=pg_temp.key('s_early')),'two hours early: "early", and no room is made');
select pg_temp.ok(pg_temp.open_as('a','s_early')->>'state'='early','the student is told it is early too');
select pg_temp.ok(pg_temp.open_as('owner','s_past',true)->>'state'='ended' and pg_temp.open_as('a','s_past')->>'state'='ended','ended two hours ago: closed for everyone');
select pg_temp.ok(pg_temp.open_as('owner','s_end',true)->>'state'='open','ended 20 minutes ago: still open (30 minutes after the end)');
select pg_temp.ok(pg_temp.open_as('owner','s_cancel',true)->>'state'='cancelled' and (select count(*)=0 from private.live_class_rooms where session_id=pg_temp.key('s_cancel')),'a cancelled Session cannot be started');

-- Notices and links: "has started" and "starts soon" open the class page; a reminder for an Own link Session still opens Groups.
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.list_as('a')) x where x->>'event_type'='class_started' and x->>'link'='/class/'||pg_temp.key('s_now')),'"Your class has started" opens /class/<session>');
set local role service_role; select public.notification_worker('sweep','{}'::jsonb); reset role;
select pg_temp.ok((select count(distinct n.recipient_id)=2 from public.notifications n join private.notification_events e on e.id=n.event_id where e.event_type='session_starting' and e.session_id=pg_temp.key('s_soon')),'the "starts soon" reminder reaches an EduLabs class Session''s students');
select pg_temp.ok((select count(*)=0 from private.notification_events e where e.event_type='session_starting' and e.session_id=pg_temp.key('s_cancel')),'no reminder for a cancelled Session');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.list_as('b')) x where x->>'event_type'='session_starting' and x->>'link'='/class/'||pg_temp.key('s_soon')),'the reminder opens /class/<session>');
update public.group_sessions set starts_at=now()+interval '5 minutes',ends_at=now()+interval '65 minutes' where id=pg_temp.key('s_link');
set local role service_role; select public.notification_worker('sweep','{}'::jsonb); reset role;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.list_as('c')) x where x->>'event_type'='session_starting' and x->>'link'='/groups'),'an Own link Session''s reminder still opens Groups');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.list_as('c')) x where x->>'event_type'='class_started'),'the other Group''s student has no "class started"');
-- "Has started" goes away once the class can no longer be joined, and when the Session is cancelled.
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.list_as('b')) x where x->>'event_type'='class_started' and x->>'link'='/class/'||pg_temp.key('s_soon')),'starting the second class told the students too');
update public.group_sessions set cancelled=true where id=pg_temp.key('s_soon');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.list_as('b')) x where x->>'event_type'='class_started' and x->>'link'='/class/'||pg_temp.key('s_soon')),'cancelling the Session removes its "class started"');
update public.group_sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=pg_temp.key('s_now');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.list_as('a')) x where x->>'event_type'='class_started' and x->>'link'='/class/'||pg_temp.key('s_now'))
 and exists(select 1 from jsonb_array_elements(pg_temp.list_as('a')) x where x->>'event_type'='class_started' and x->>'link'='/class/'||pg_temp.key('s_end')),'"class started" is gone once the class has closed (the one still open stays)');
-- Preferences: the new type has its own switches.
select pg_temp.claim('b'); set local role authenticated;
select public.notification_command('preference','{"event":"class_started","inApp":false,"push":false}'::jsonb);
reset role;
select pg_temp.ok((select not in_app and not push from public.notification_preferences where user_id=pg_temp.uid('b') and event_type='class_started'),'"class started" has its own In-app and Push switches');
select pg_temp.denied($q$insert into public.notification_preferences(user_id,event_type) values(gen_random_uuid(),'class_finished')$q$,'23514','an unknown type is still refused');
-- An archived Group's class is closed.
update public.study_groups set status='archived' where id=pg_temp.key('g');
select pg_temp.ok(pg_temp.open_as('owner','s_end',true)->>'state'='cancelled','an archived Group''s class is closed');
update public.study_groups set status='active' where id=pg_temp.key('g');

-- Demo seed version 9: Group 2 is an EduLabs class, its draft earlier Session was joined, and a class can be started 5 minutes after the fill.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher'] loop
  perform pg_temp.claim(label); insert into pg_temp.lc_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from lc_users where label='admin';
select pg_temp.put('dorg',gen_random_uuid());
insert into public.organizations(id,name,slug) values(pg_temp.key('dorg'),'Synthetic demo live class','lc-d-'||current_setting('lc.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('dorg'),pg_temp.uid('teacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('dorg'),pg_temp.uid('admin'));
select set_config('lc.fill',private.demo_fill_core(pg_temp.key('dorg'),pg_temp.uid('admin'))::text,true);
select pg_temp.ok(current_setting('lc.fill')::jsonb=jsonb_build_object('seedVersion',9,'courses',2,'lessons',6,'groups',2,'sessions',10,'students',28,'homework',5,'exams',5),'fill reports seed version 9 and one more Session');
select pg_temp.ok((select seed_version=9 from private.demo_spaces where organization_id=pg_temp.key('dorg')),'the space stores seed version 9');
select pg_temp.put('dg2',(select g.id from public.study_groups g join private.demo_seed_rows d on d.row_id=g.id and d.table_name='study_groups' where d.organization_id=pg_temp.key('dorg') and g.name='Demo Group 2'));
select pg_temp.ok((select mode='online' and join_url='' from public.study_groups where id=pg_temp.key('dg2')),'Demo Group 2 is an EduLabs class (online, no link)');
select pg_temp.put('dlive',(select s.id from public.group_sessions s where s.group_id=pg_temp.key('dg2') and s.title='Demo live class'));
select pg_temp.ok((select starts_at between now()+interval '4 minutes' and now()+interval '6 minutes' and ends_at-starts_at=interval '60 minutes' and mode='online' and join_url='' from public.group_sessions where id=pg_temp.key('dlive'))
 and not exists(select 1 from private.live_class_rooms where session_id=pg_temp.key('dlive')),'"Demo live class" starts 5 minutes after the fill, lasts an hour, and is not started');
select pg_temp.put('ddraft',(select s.id from public.group_sessions s where s.group_id=pg_temp.key('dg2') and s.title='Demo earlier session 2'));
select pg_temp.ok((select started_by=pg_temp.uid('teacher') and started_at=(select starts_at from public.group_sessions where id=pg_temp.key('ddraft')) from private.live_class_rooms where session_id=pg_temp.key('ddraft')),'Group 2''s draft earlier Session was started by the teacher at its start');
select pg_temp.claim('teacher'); set local role authenticated;
select set_config('lc.djoined',public.live_class_joined(pg_temp.key('ddraft'))::text,true);
select pg_temp.ok(pg_temp.open_as('teacher','dlive',true)->>'state'='open','the demo teacher can start "Demo live class" right away');
reset role;
select pg_temp.ok(jsonb_array_length(current_setting('lc.djoined')::jsonb->'joined')=10,'ten demo students opened the earlier class');
select pg_temp.ok((select count(*)=4 from public.session_attendance a where a.session_id=pg_temp.key('ddraft') and a.status='not_marked' and a.user_id in (select (x#>>'{}')::uuid from jsonb_array_elements(current_setting('lc.djoined')::jsonb->'joined') x))
 and (select count(*)=2 from public.session_attendance a where a.session_id=pg_temp.key('ddraft') and a.status='absent' and a.user_id in (select (x#>>'{}')::uuid from jsonb_array_elements(current_setting('lc.djoined')::jsonb->'joined') x)),'four joined students are still not marked (Take attendance saves them) and two joined ones stay Absent');
select pg_temp.ok((select count(*)=12 from private.demo_seed_rows where organization_id=pg_temp.key('dorg') and module='live_class' and table_name in ('live_class_rooms','live_class_joins'))
 and (select count(*)=1 from private.demo_seed_rows where organization_id=pg_temp.key('dorg') and module='live_class' and table_name='group_sessions'),'the seed records its rows under module live_class');
select set_config('lc.dsessions',(select jsonb_agg(s.id)::text from public.group_sessions s where s.group_id=pg_temp.key('dg2')),true);
select pg_temp.ok((private.demo_clear_core(pg_temp.key('dorg'),pg_temp.uid('admin'))->>'removedRows')::int=1568,'Clear removes the 1567 rows of seed version 8 plus the new Session');
select pg_temp.ok((select count(*)=0 from private.live_class_rooms where session_id in (select (x#>>'{}')::uuid from jsonb_array_elements(current_setting('lc.dsessions')::jsonb) x))
 and (select count(*)=0 from private.live_class_joins where session_id in (select (x#>>'{}')::uuid from jsonb_array_elements(current_setting('lc.dsessions')::jsonb) x)),'the rooms and joins go with their Sessions');
select pg_temp.ok((select count(*)=0 from private.notification_events where event_type='class_started' and session_id in (select (x#>>'{}')::uuid from jsonb_array_elements(current_setting('lc.dsessions')::jsonb) x)),'and so does "class started"');
select pg_temp.ok((private.demo_fill_core(pg_temp.key('dorg'),pg_temp.uid('admin'))->>'seedVersion')::int=9,'the space fills again');

select count(*)::integer live_class_tests from lc_results;
rollback;
