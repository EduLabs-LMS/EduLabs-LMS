-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures. Every change rolls back; no real account exists.
-- Covers migration 20261106130000_course_content_tree.sql. EVERY identity here is a Firebase identity (a non-UUID subject, created by onboard_firebase_profile), so a call that
-- cast the subject to uuid (auth.uid()) would fail every check. updated_at is the transaction's time, so inside this one transaction a stale request sends an old stamp; real
-- two-tab races, on separate connections, are in scripts/course-content-concurrency.cjs.
begin;
create temp table ccs_results(name text primary key);
create temp table ccs_users(label text primary key,id uuid not null);
grant select,insert on ccs_results,ccs_users to authenticated,anon;
select set_config('ccs.run',gen_random_uuid()::text,true);
select set_config('ccs.'||k,gen_random_uuid()::text,true) from unnest(array['org_a','org_b','org_d','course','course2','course_b','off','off_b','ch1','ch2','ch3','ch_b','l11','l12','l13','l21','l22','l_b','hw','hw2','course3','archive','arch1','arch2','arch_l1','arch_l2','part2','pub']) k;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.ccs_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.ccs_results values(label);end$$;
-- A refused delete: 23503 with the reasons (and optionally the lessons) in the detail.
create function pg_temp.refused(statement text,reasons jsonb,label text,lessons jsonb default null) returns void language plpgsql set search_path='' as $$declare caught text;detail text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate,detail=pg_exception_detail; end;
 if caught is distinct from '23503' then raise exception 'FAILED % expected 23503 got %',label,caught; end if;
 if (detail::jsonb->'reasons') is distinct from reasons then raise exception 'FAILED % reasons %',label,detail; end if;
 if lessons is not null and (detail::jsonb->'lessonIds') is distinct from lessons then raise exception 'FAILED % lessons %',label,detail; end if;
 insert into pg_temp.ccs_results values(label);end$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',label||'.'||current_setting('ccs.run')||'@example.test','auth_time',floor(extract(epoch from now()))::bigint,'sub','ccs-'||current_setting('ccs.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('ccs.'||k)::uuid$$;
create function pg_temp.uid(k text) returns uuid language sql as $$select id from pg_temp.ccs_users where label=k$$;
-- Read as the database owner, so a check can see what the signed-in person may not.
create function pg_temp.ls(k text) returns timestamptz language sql security definer set search_path='' as $$select updated_at from public.lessons where id=pg_temp.key(k)$$;
create function pg_temp.cs(k text) returns timestamptz language sql security definer set search_path='' as $$select updated_at from public.course_modules where id=pg_temp.key(k)$$;
create function pg_temp.items(chapter uuid) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by position),'[]'::jsonb) from public.lessons where module_id=chapter$$;
create function pg_temp.tree(k text) returns text language sql security definer set search_path='' as $$
 select coalesce(string_agg(title,'|' order by position),'') from public.lessons where module_id=pg_temp.key(k)$$;
create function pg_temp.lesson(k text) returns public.lessons language sql security definer set search_path='' as $$select l from public.lessons l where l.id=pg_temp.key(k)$$;
create function pg_temp.has_lesson(i uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.lessons where id=i)$$;
create function pg_temp.has_chapter(i uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.course_modules where id=i)$$;
create function pg_temp.row_of(k text) returns jsonb language sql as $$select e from jsonb_array_elements(current_setting('ccs.tree')::jsonb->'lessons') e where e->>'id'=current_setting('ccs.'||k)$$;
-- The detail of a refusal, for the counts in it.
create function pg_temp.refusal(statement text) returns jsonb language plpgsql set search_path='' as $$declare detail text;msg text;code text;begin
 begin execute statement; exception when others then get stacked diagnostics detail=pg_exception_detail,msg=message_text,code=returned_sqlstate;
  if coalesce(detail,'')='' then raise exception 'FAILED refused with no detail: % % in %',code,msg,statement; end if;
  return detail::jsonb; end;
 raise exception 'FAILED nothing was refused: %',statement;end$$;
-- A course's chapters as title:type:number:position, in order.
create function pg_temp.labels(k text) returns text language sql security definer set search_path='' as $$
 select coalesce(string_agg(title||':'||group_type||':'||chapter_number||':'||position,'|' order by position),'') from public.course_modules where course_id=pg_temp.key(k)$$;
-- Every row that hangs off a lesson, whole.
create function pg_temp.refs(k text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'homework',(select jsonb_agg(to_jsonb(x) order by x.id) from public.homework_assignments x where x.lesson_id=pg_temp.key(k)),
  'submissions',(select jsonb_agg(to_jsonb(x) order by x.id) from public.homework_submissions x join public.homework_assignments a on a.id=x.assignment_id where a.lesson_id=pg_temp.key(k)),
  'progress',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from public.lesson_progress x where x.lesson_id=pg_temp.key(k)),
  'partProgress',(select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from public.lesson_segment_progress x where x.lesson_id=pg_temp.key(k)),
  'parts',(select jsonb_agg(to_jsonb(x) order by x.id) from public.lesson_segments x where x.lesson_id=pg_temp.key(k)),
  'blocks',(select jsonb_agg(to_jsonb(x) order by x.id) from public.lesson_blocks x where x.lesson_id=pg_temp.key(k)))$$;
-- The call the screen makes, on the main course unless another is named.
create function pg_temp.edit(action text,id uuid,parent uuid,stamp timestamptz,data jsonb,course text default 'course') returns uuid language sql as $$
 select public.edit_course_structure(pg_temp.key(course),action,id,parent,stamp,data)$$;

-- Everyone signs in with Firebase first, so each has a profile.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','owner','orgadmin','instructor','editor','assistant','memberteacher','student','stranger','suspended','demoteacher'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.ccs_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from ccs_users where label='admin';

-- Space A with a published course and every kind of staff; space B belongs to someone else.
insert into public.organizations(id,name,slug) values(pg_temp.key('org_a'),'Synthetic A','ccs-a-'||current_setting('ccs.run')),(pg_temp.key('org_b'),'Synthetic B','ccs-b-'||current_setting('ccs.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('org_a'),pg_temp.uid(l),r,'active',now() from (values('owner','owner'),('orgadmin','admin'),('instructor','teacher'),('editor','teacher'),('assistant','assistant'),('memberteacher','teacher'),('suspended','teacher')) x(l,r)
 union all select pg_temp.key('org_b'),pg_temp.uid('stranger'),'owner','active',now();
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values
 (pg_temp.key('course'),pg_temp.key('org_a'),'Synthetic Physics','ccs-physics','published','private',pg_temp.uid('owner')),
 (pg_temp.key('course2'),pg_temp.key('org_a'),'Synthetic other course','ccs-other','draft','private',pg_temp.uid('owner')),
 (pg_temp.key('course_b'),pg_temp.key('org_b'),'Foreign course','ccs-foreign','draft','private',pg_temp.uid('stranger'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('course'),pg_temp.uid('instructor'),'instructor'),(pg_temp.key('course'),pg_temp.uid('editor'),'editor'),(pg_temp.key('course'),pg_temp.uid('assistant'),'assistant'),(pg_temp.key('course'),pg_temp.uid('suspended'),'editor');
insert into public.course_offerings(id,course_id,name,delivery_mode,status) values(pg_temp.key('off'),pg_temp.key('course'),'Synthetic run','scheduled','active'),(pg_temp.key('off_b'),pg_temp.key('course_b'),'Foreign run','scheduled','active');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.key('off'),pg_temp.uid('student'),'active',now());
insert into public.course_modules(id,course_id,title,position,description) values(pg_temp.key('ch1'),pg_temp.key('course'),'Electric current',0,'Keep this description'),(pg_temp.key('ch2'),pg_temp.key('course'),'Magnetism',1,''),(pg_temp.key('ch3'),pg_temp.key('course'),'Empty chapter',2,''),(pg_temp.key('ch_b'),pg_temp.key('course_b'),'Foreign chapter',0,'');
insert into public.lessons(id,module_id,title,position,status,description) values
 (pg_temp.key('l11'),pg_temp.key('ch1'),'Ohm',0,'published','Keep this text'),(pg_temp.key('l12'),pg_temp.key('ch1'),'Resistors',1,'draft',''),(pg_temp.key('l13'),pg_temp.key('ch1'),'Kirchhoff',2,'draft',''),
 (pg_temp.key('l21'),pg_temp.key('ch2'),'Field',0,'draft',''),(pg_temp.key('l22'),pg_temp.key('ch2'),'Force',1,'draft',''),(pg_temp.key('l_b'),pg_temp.key('ch_b'),'Foreign lesson',0,'draft','');
update public.profiles set status='suspended' where id=pg_temp.uid('suspended');
select set_config('ccs.events',(select count(*)::text from private.notification_events),true);

-- ---------------------------------------------------------------- who may write
set local role authenticated;
select pg_temp.claim('assistant');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','an assistant cannot add a chapter');
select pg_temp.denied($s$select pg_temp.edit('rename_lesson',pg_temp.key('l12'),null,pg_temp.ls('l12'),'{"title":"x"}')$s$,'42501','an assistant cannot rename a lesson');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l12'),null,pg_temp.ls('l12'),'{}')$s$,'42501','an assistant cannot delete a lesson');
select pg_temp.claim('memberteacher');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','a teacher of the space who does not teach this course cannot add a chapter');
select pg_temp.claim('student');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','an enrolled student cannot add a chapter');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l12'),null,pg_temp.ls('l12'),'{}')$s$,'42501','an enrolled student cannot delete a lesson');
select pg_temp.claim('stranger');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','the owner of another space cannot add a chapter here');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch3'),null,pg_temp.cs('ch3'),'{"items":[]}')$s$,'42501','the owner of another space cannot delete a chapter here');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l12'),null,pg_temp.ls('l12'),'{}','course_b')$s$,'42501','naming their own course does not reach a lesson of another space');
select pg_temp.denied($s$select pg_temp.edit('rename_chapter',pg_temp.key('ch1'),null,pg_temp.cs('ch1'),'{"title":"x"}','course_b')$s$,'42501','naming their own course does not reach a chapter of another space');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l12'),pg_temp.key('ch_b'),pg_temp.ls('l12'),'{"items":[]}','course_b')$s$,'42501','naming their own course does not take a lesson from another space');
select pg_temp.claim('suspended');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','a suspended person cannot add a chapter');
select set_config('request.jwt.claims','{}',true);
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','no identity cannot add a chapter');
reset role;
set local role anon;
select pg_temp.denied($s$select public.edit_course_structure(current_setting('ccs.course')::uuid,'create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','anon cannot call the write');
select pg_temp.denied($s$select public.course_structure(current_setting('ccs.course')::uuid)$s$,'42501','anon cannot call the read');
reset role;
select pg_temp.ok((select count(*)=3 from public.course_modules where course_id=pg_temp.key('course')) and pg_temp.tree('ch1')='Ohm|Resistors|Kirchhoff','nothing refused above changed anything');

-- The same people who may edit the course today may do this.
set local role authenticated;
do $$ declare who text; added uuid; begin
 foreach who in array array['owner','orgadmin','instructor','editor'] loop
  perform pg_temp.claim(who);
  perform pg_temp.ok(private.can_edit_course(pg_temp.key('course')),who||' may edit the course today');
  added:=pg_temp.edit('create_chapter',null,null,null,jsonb_build_object('title','by '||who));
  perform pg_temp.ok(pg_temp.has_chapter(added),who||' may add a chapter');
  perform pg_temp.edit('delete_chapter',added,null,now(),'{"items":[]}');
  perform pg_temp.ok(not pg_temp.has_chapter(added),who||' may delete a chapter');
 end loop;
end $$;

-- ---------------------------------------------------------------- create and rename
select pg_temp.claim('owner');
select set_config('ccs.ch4',pg_temp.edit('create_chapter',null,null,null,'{"title":"  Waves  "}')::text,true);
reset role;
select pg_temp.ok((select title='Waves' and group_type='Chapter' and chapter_number=position+1 and position=(select max(position) from public.course_modules where course_id=pg_temp.key('course')) from public.course_modules where id=pg_temp.key('ch4')),'a new chapter is trimmed, last, of type Chapter, numbered by its position');
set local role authenticated;
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"   "}')$s$,'23514','a blank chapter name is refused');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,jsonb_build_object('title',repeat('x',121)))$s$,'23514','a chapter name over 120 is refused');
select pg_temp.ok(pg_temp.edit('create_chapter',null,null,null,jsonb_build_object('title',repeat('x',120))) is not null,'a chapter name of exactly 120 is accepted');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":42}')$s$,'23514','a name that is not text is refused');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,jsonb_build_object('title','Bell'||chr(7)))$s$,'23514','a name with a control character is refused');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x","position":0}')$s$,'23514','an unknown key is refused');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,null)$s$,'23514','no data is refused');
-- publish_lesson became a real action in 20261110120000_lesson_publish.sql, so the unknown action here is another name.
select pg_temp.denied($s$select pg_temp.edit('archive_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),'{}')$s$,'23514','an unknown action is refused');
select pg_temp.denied($s$select pg_temp.edit('rename_chapter',pg_temp.key('ch1'),null,'2000-01-01','{"title":"Stale"}')$s$,'PT409','a stale chapter rename changes nothing');
select pg_temp.denied($s$select pg_temp.edit('rename_chapter',pg_temp.key('ch1'),null,null,'{"title":"No version"}')$s$,'PT409','a rename with no version is refused');
select pg_temp.denied($s$select pg_temp.edit('rename_lesson',pg_temp.key('l11'),null,'2000-01-01','{"title":"Stale"}')$s$,'PT409','a stale lesson rename changes nothing');
select pg_temp.denied($s$select pg_temp.edit('rename_chapter',pg_temp.key('ch_b'),null,now(),'{"title":"x"}')$s$,'42501','a chapter of another space is not found from this course');
select pg_temp.denied($s$select pg_temp.edit('rename_lesson',pg_temp.key('l_b'),null,now(),'{"title":"x"}')$s$,'42501','a lesson of another space is not found from this course');
select pg_temp.denied($s$select pg_temp.edit('rename_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),jsonb_build_object('title',repeat('x',201)))$s$,'23514','a lesson name over 200 is refused');
-- Why rename exists: the old edit_lesson must be sent the status and description. It no longer refuses a published lesson with no published part
-- (changed by 20261110120000_lesson_publish.sql, the owner's rule: a lesson is never tethered to one of its components).
select pg_temp.ok(public.edit_learning_content(pg_temp.key('course'),'edit_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),'{"title":"Ohm","status":"published","description":"Keep this text"}')=pg_temp.key('l11'),'the old edit keeps a published lesson with no published part published');
select pg_temp.ok(pg_temp.edit('rename_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),'{"title":" Ohm''s law "}')=pg_temp.key('l11'),'rename works on that lesson');
select pg_temp.ok((pg_temp.lesson('l11')).title='Ohm''s law' and (pg_temp.lesson('l11')).status='published' and (pg_temp.lesson('l11')).description='Keep this text','rename changes the title only: status and description stay');
select pg_temp.edit('rename_chapter',pg_temp.key('ch1'),null,pg_temp.cs('ch1'),'{"title":"Current"}');
reset role;
select pg_temp.ok((select title='Current' and description='Keep this description' and group_type='Chapter' from public.course_modules where id=pg_temp.key('ch1')),'a chapter rename leaves its description and type');
select pg_temp.ok((select count(*)::text=current_setting('ccs.events') from private.notification_events),'renaming a published lesson sends no notification');

-- ---------------------------------------------------------------- the existing operations still serve the tree, under a Firebase identity
set local role authenticated;
select pg_temp.claim('editor');
select set_config('ccs.l14',public.edit_learning_content(pg_temp.key('course'),'create_lesson',null,pg_temp.key('ch1'),null,'{"title":"Added"}')::text,true);
select pg_temp.ok(pg_temp.tree('ch1')='Ohm''s law|Resistors|Kirchhoff|Added','create_lesson adds at the end');
select public.edit_learning_content(pg_temp.key('course'),'reorder_lessons',null,pg_temp.key('ch1'),null,jsonb_build_object('items',(select jsonb_agg(e order by ord desc) from jsonb_array_elements(pg_temp.items(pg_temp.key('ch1'))) with ordinality x(e,ord))));
select pg_temp.ok(pg_temp.tree('ch1')='Added|Kirchhoff|Resistors|Ohm''s law','reorder_lessons reverses the chapter');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('course'),'reorder_lessons',null,pg_temp.key('ch1'),null,'{"items":[]}')$s$,'PT409','an incomplete reorder is refused');
select public.edit_learning_content(pg_temp.key('course'),'reorder_lessons',null,pg_temp.key('ch1'),null,jsonb_build_object('items',(select jsonb_agg(e order by ord desc) from jsonb_array_elements(pg_temp.items(pg_temp.key('ch1'))) with ordinality x(e,ord))));
reset role;
set local role authenticated;
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('course'),'reorder_modules',null,null,null,'{"items":[]}')$s$,'PT409','an incomplete chapter reorder is refused');
select public.edit_learning_content(pg_temp.key('course'),'reorder_modules',null,null,null,jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by position desc) from public.course_modules where course_id=pg_temp.key('course'))));
select pg_temp.ok((public.course_structure(pg_temp.key('course'))->'chapters'->0->>'id') is distinct from current_setting('ccs.ch1'),'reorder_modules changes the order the read gives');

-- ---------------------------------------------------------------- moving a lesson to another chapter
select pg_temp.claim('owner');
-- To the middle of Chapter 2, keeping the others in their order.
select pg_temp.ok(pg_temp.edit('move_lesson',pg_temp.key('l12'),pg_temp.key('ch2'),pg_temp.ls('l12'),jsonb_build_object('items',jsonb_build_array(pg_temp.items(pg_temp.key('ch2'))->0,jsonb_build_object('id',pg_temp.key('l12'),'updated_at',pg_temp.ls('l12')),pg_temp.items(pg_temp.key('ch2'))->1)))=pg_temp.key('l12'),'a lesson moves to another chapter');
select pg_temp.ok(pg_temp.tree('ch2')='Field|Resistors|Force','it lands where it was dropped');
select pg_temp.ok((select array_agg(position order by position)=array[0,1,2] from (select (pg_temp.lesson(k)).position from unnest(array['l21','l12','l22']) k) x),'the target chapter is numbered 0, 1, 2 with no gap');
select pg_temp.ok(pg_temp.tree('ch1')='Ohm''s law|Kirchhoff|Added','it leaves the source chapter, whose order holds');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch2'),'2000-01-01',jsonb_build_object('items',pg_temp.items(pg_temp.key('ch2'))||jsonb_build_object('id',pg_temp.key('l13'),'updated_at','2000-01-01')))$s$,'PT409','a stale lesson does not move');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch2'),pg_temp.ls('l13'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('l13'),'updated_at',pg_temp.ls('l13')))))$s$,'PT409','a target order that misses lessons is refused');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch2'),pg_temp.ls('l13'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('l21'),'updated_at','2000-01-01'),jsonb_build_object('id',pg_temp.key('l12'),'updated_at',pg_temp.ls('l12')),jsonb_build_object('id',pg_temp.key('l22'),'updated_at',pg_temp.ls('l22')),jsonb_build_object('id',pg_temp.key('l13'),'updated_at',pg_temp.ls('l13')))))$s$,'PT409','a target whose lessons changed elsewhere is refused');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch2'),pg_temp.ls('l13'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch2'))||jsonb_build_object('id',pg_temp.key('l_b'),'updated_at',now())))$s$,'PT409','a target order cannot name a lesson of another chapter');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch_b'),pg_temp.ls('l13'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('l13'),'updated_at',pg_temp.ls('l13')))))$s$,'42501','a lesson cannot move to a chapter of another space');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),null,pg_temp.ls('l13'),'{"items":[]}')$s$,'42501','a move needs a target chapter');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch1'),pg_temp.ls('l13'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch1'))))$s$,'23514','a move inside one chapter is a reorder');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('l13'),pg_temp.key('ch2'),pg_temp.ls('l13'),'{"items":"none"}')$s$,'23514','a move needs a list');
select pg_temp.ok(pg_temp.tree('ch2')='Field|Resistors|Force' and pg_temp.tree('ch1')='Ohm''s law|Kirchhoff|Added','refused moves changed nothing');
-- Into an empty chapter, and a published lesson on the move sends no notification.
select pg_temp.edit('move_lesson',pg_temp.key('l11'),pg_temp.key('ch3'),pg_temp.ls('l11'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('l11'),'updated_at',pg_temp.ls('l11')))));
select pg_temp.ok(pg_temp.tree('ch3')='Ohm''s law','a lesson moves into an empty chapter');
select pg_temp.ok((pg_temp.lesson('l11')).status='published' and (pg_temp.lesson('l11')).position=0,'it stays published');
reset role;
select pg_temp.ok((select count(*)::text=current_setting('ccs.events') from private.notification_events),'moving a published lesson sends no notification');
-- Only the function can write module_id, and nothing can take a lesson out of its course.
set local role authenticated;
select pg_temp.denied($s$update public.lessons set module_id=current_setting('ccs.ch1')::uuid where id=current_setting('ccs.l13')::uuid$s$,'42501','a teacher cannot write the chapter directly');
reset role;
insert into public.course_modules(id,course_id,title,position) select gen_random_uuid(),pg_temp.key('course2'),'Other course chapter',0;
select pg_temp.denied($s$update public.lessons set module_id=(select id from public.course_modules where course_id=current_setting('ccs.course2')::uuid),position=99 where id=current_setting('ccs.l13')::uuid$s$,'23514','not even the database owner can take a lesson to another course of the same space');
select pg_temp.denied($s$update public.lessons set module_id=current_setting('ccs.ch_b')::uuid,position=99 where id=current_setting('ccs.l13')::uuid$s$,'23514','not even the database owner can take a lesson to another space');
select pg_temp.denied($s$update public.lessons set id=gen_random_uuid() where id=current_setting('ccs.l13')::uuid$s$,'23514','a lesson id still never changes');
select pg_temp.denied($s$update public.course_modules set course_id=current_setting('ccs.course2')::uuid where id=current_setting('ccs.ch2')::uuid$s$,'23514','a chapter still never changes course');

-- ---------------------------------------------------------------- deleting a lesson: what the database refuses, in reasons
set local role authenticated;
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l13'),null,'2000-01-01','{}')$s$,'PT409','a stale delete removes nothing');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l13'),null,null,'{}')$s$,'PT409','a delete with no version removes nothing');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l_b'),null,now(),'{}')$s$,'42501','a lesson of another space is not found');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('l13'),null,pg_temp.ls('l13'),'{"force":true}')$s$,'23514','a delete takes no options, so nothing can be forced');
reset role;
-- Homework, still a draft, nobody started.
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by) values(pg_temp.key('hw'),pg_temp.key('course'),pg_temp.key('off'),pg_temp.key('l21'),'Synthetic homework','draft',pg_temp.key('hw'),pg_temp.uid('owner'));
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l21'),null,pg_temp.ls('l21'),'{}')$s$,'["homework"]','a lesson with homework is refused, naming the homework',jsonb_build_array(pg_temp.key('l21')));
reset role;
-- A student started it. The newest version is published, and a homework counts once.
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,version,supersedes_id,created_by) values(pg_temp.key('hw2'),pg_temp.key('course'),pg_temp.key('off'),pg_temp.key('l21'),'Synthetic homework v2','published',pg_temp.key('hw'),2,pg_temp.key('hw'),pg_temp.uid('owner'));
insert into public.homework_submissions(assignment_id,user_id,number,status) values(pg_temp.key('hw2'),pg_temp.uid('student'),1,'draft');
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l21'),null,pg_temp.ls('l21'),'{}')$s$,'["student_work", "homework"]','a lesson whose homework a student started is refused, naming the student work');
select pg_temp.ok(pg_temp.has_lesson(pg_temp.key('l21')),'the refused lesson is still there');
reset role;
insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at) values(pg_temp.key('off'),pg_temp.key('l22'),pg_temp.uid('student'),'in_progress',now());
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l22'),null,pg_temp.ls('l22'),'{}')$s$,'["student_progress"]','a lesson a student has started is refused');
reset role;
select set_config('ccs.part',gen_random_uuid()::text,true);
insert into public.lesson_segments(id,lesson_id,title,position) values(pg_temp.key('part'),pg_temp.key('l11'),'Synthetic part',0);
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),'{}')$s$,'["parts"]','a lesson with parts is refused');
reset role;
insert into public.lesson_segment_progress(offering_id,user_id,segment_id,lesson_id,status) values(pg_temp.key('off'),pg_temp.uid('student'),pg_temp.key('part'),pg_temp.key('l11'),'in_progress');
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l11'),null,pg_temp.ls('l11'),'{}')$s$,'["student_progress", "parts"]','progress on a part is named too');
select set_config('ccs.l15',public.edit_learning_content(pg_temp.key('course'),'create_lesson',null,pg_temp.key('ch1'),null,'{"title":"With blocks"}')::text,true);
reset role;
insert into public.lesson_blocks(lesson_id,block_type,position,content) values(pg_temp.key('l15'),'text',0,'{"text":"Synthetic notes"}');
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l15'),null,pg_temp.ls('l15'),'{}')$s$,'["content"]','a lesson with content blocks is refused, though the blocks would cascade');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_lesson',pg_temp.key('l15'),null,pg_temp.ls('l15'),'{}')$s$)@>'{"contentBlocks":1,"covers":0,"parts":0,"homework":0}','the refusal counts what is inside');
-- A restrict reference nobody has named yet: the database refuses, and the reply still says so in a way the screen can word.
reset role;
create table public.ccs_tmp_reference(lesson_id uuid not null references public.lessons(id) on delete restrict);
insert into public.ccs_tmp_reference values(pg_temp.key('l13'));
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l13'),null,pg_temp.ls('l13'),'{}')$s$,'["in_use"]','any other restrict reference is refused as in use');
select pg_temp.ok(pg_temp.has_lesson(pg_temp.key('l13')),'and the lesson stays');
-- A lesson nothing depends on goes, and leaves a gap the order survives.
select pg_temp.ok(pg_temp.edit('delete_lesson',pg_temp.key('l14'),null,pg_temp.ls('l14'),'{}')=pg_temp.key('l14'),'a free lesson can be deleted');
select pg_temp.ok(not pg_temp.has_lesson(pg_temp.key('l14')),'and it is gone');
select pg_temp.ok(pg_temp.tree('ch1')='Kirchhoff|With blocks','the rest keep their order');
select set_config('ccs.l16',public.edit_learning_content(pg_temp.key('course'),'create_lesson',null,pg_temp.key('ch1'),null,'{"title":"After a gap"}')::text,true);
select pg_temp.ok(pg_temp.tree('ch1')='Kirchhoff|With blocks|After a gap','a new lesson after a delete goes last');

-- ---------------------------------------------------------------- the read
select pg_temp.claim('assistant');
select pg_temp.ok((public.course_structure(pg_temp.key('course'))->>'canEdit')::boolean is false,'an assistant reads the tree and is told they cannot edit');
select pg_temp.claim('student');
select pg_temp.denied($s$select public.course_structure(pg_temp.key('course'))$s$,'42501','an enrolled student cannot read the teacher tree');
select pg_temp.claim('memberteacher');
select pg_temp.denied($s$select public.course_structure(pg_temp.key('course'))$s$,'42501','a teacher of the space with no part in this course cannot read it');
select pg_temp.claim('stranger');
select pg_temp.denied($s$select public.course_structure(pg_temp.key('course'))$s$,'42501','the owner of another space cannot read it');
select pg_temp.ok((public.course_structure(pg_temp.key('course_b'))->>'canEdit')::boolean,'and reads their own');
select pg_temp.claim('owner');
select set_config('ccs.tree',public.course_structure(pg_temp.key('course'))::text,true);
select pg_temp.ok((current_setting('ccs.tree')::jsonb->>'canEdit')::boolean,'the owner reads the tree and may edit');
select pg_temp.ok((pg_temp.row_of('l21')->>'homework')::int=1 and (pg_temp.row_of('l21')->>'draftHomework')::int=0,'a homework with two versions counts once, by its newest version');
select pg_temp.ok(pg_temp.row_of('l21')->'deleteBlockers'='["student_work","homework"]'::jsonb,'the read names the same blockers as the delete');
select pg_temp.ok(pg_temp.row_of('l13')->'deleteBlockers'='[]'::jsonb and (pg_temp.row_of('l13')->>'homework')::int=0,'a lesson with nothing on it has no blockers');
select pg_temp.ok((pg_temp.row_of('l15')->>'contentBlocks')::int=1 and (pg_temp.row_of('l15')->>'hasCover')::boolean is false and (pg_temp.row_of('l11')->>'parts')::int=1,'the read counts blocks and parts, and says whether there is a cover');
select pg_temp.ok(current_setting('ccs.tree')::jsonb->>'archived'='false','the read says the course is not archived');
select pg_temp.ok((select bool_and(e->>'type'='Chapter' and (e->>'number')::int=(e->>'position')::int+1) from jsonb_array_elements(current_setting('ccs.tree')::jsonb->'chapters') e),'the read gives the type and number a student reads');
select pg_temp.ok(pg_temp.row_of('l11')->>'status'='published' and pg_temp.row_of('l12')->>'status'='draft','the read gives the draft or published state of a lesson');
select pg_temp.ok(not (current_setting('ccs.tree') like '%Synthetic homework%' or current_setting('ccs.tree') like '%'||pg_temp.uid('student')::text||'%'),'the read holds no homework title and no student id');
select pg_temp.ok(pg_temp.edit('rename_lesson',pg_temp.key('l13'),null,(pg_temp.row_of('l13')->>'updatedAt')::timestamptz,'{"title":"Kirchhoff''s laws"}')=pg_temp.key('l13'),'the version the read gives is the one a write accepts');
-- The whole tree comes in chapter order, then lesson order.
select pg_temp.ok((select array_agg(e->>'title' order by ord) from jsonb_array_elements(public.course_structure(pg_temp.key('course'))->'lessons') with ordinality x(e,ord) where e->>'chapterId'=current_setting('ccs.ch1'))=array['Kirchhoff''s laws','With blocks','After a gap'],'lessons come in their order');

-- ---------------------------------------------------------------- deleting a chapter
reset role;
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch2'),null,pg_temp.cs('ch2'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch2'))))$s$,'["homework", "student_progress", "student_work"]','a chapter is refused for everything its lessons hold');
select pg_temp.ok(pg_temp.has_chapter(pg_temp.key('ch2')) and pg_temp.tree('ch2')='Field|Resistors|Force','the refused chapter and all its lessons stay');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch1'),null,'2000-01-01',jsonb_build_object('items',pg_temp.items(pg_temp.key('ch1'))))$s$,'PT409','a stale chapter delete removes nothing');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch4'),null,pg_temp.cs('ch4'),'{}')$s$,'23514','a chapter delete must say which lessons were seen');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch_b'),null,now(),'{"items":[]}')$s$,'42501','a chapter of another space is not found');
-- A chapter with free lessons: seen list required, and a lesson added elsewhere stops it.
select set_config('ccs.fc',pg_temp.edit('create_chapter',null,null,null,'{"title":"Free"}')::text,true);
select set_config('ccs.fl',public.edit_learning_content(pg_temp.key('course'),'create_lesson',null,pg_temp.key('fc'),null,'{"title":"Free lesson"}')::text,true);
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('fc'),null,pg_temp.cs('fc'),'{"items":[]}')$s$,'PT409','a lesson added in another tab stops the chapter delete');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('fc'),null,pg_temp.cs('fc'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('fl'),'updated_at','2000-01-01'))))$s$,'PT409','so does a lesson that changed');
select pg_temp.ok(pg_temp.has_lesson(pg_temp.key('fl')),'the lesson is still there');
select pg_temp.ok(pg_temp.edit('delete_chapter',pg_temp.key('fc'),null,pg_temp.cs('fc'),jsonb_build_object('items',pg_temp.items(pg_temp.key('fc'))))=pg_temp.key('fc'),'a free chapter can be deleted with the lessons the teacher was shown');
select pg_temp.ok(not pg_temp.has_chapter(pg_temp.key('fc')) and not pg_temp.has_lesson(pg_temp.key('fl')),'and both are gone');
reset role;
insert into public.ccs_tmp_reference values(pg_temp.key('l16'));
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch1'),null,pg_temp.cs('ch1'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch1'))))$s$,'["content"]','a chapter names the lesson that holds content',jsonb_build_array(pg_temp.key('l15')));
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch1'),null,pg_temp.cs('ch1'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch1'))))$s$)@>'{"contentBlocks":1,"covers":0}','and counts what is inside its lessons');
reset role;
delete from public.lesson_blocks where lesson_id=pg_temp.key('l15');
set local role authenticated;
select pg_temp.refused($s$select pg_temp.edit('delete_chapter',pg_temp.key('ch1'),null,pg_temp.cs('ch1'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch1'))))$s$,'["in_use"]','a restrict reference under a chapter is refused as in use');
select pg_temp.ok(pg_temp.has_chapter(pg_temp.key('ch1')) and pg_temp.has_lesson(pg_temp.key('l15')),'nothing went');
reset role;
drop table public.ccs_tmp_reference;

-- ---------------------------------------------------------------- moving a lesson keeps everything attached (the owner's answer 1)
insert into public.lesson_segments(id,lesson_id,title,position) values(pg_temp.key('part2'),pg_temp.key('l21'),'Synthetic part 2',0);
insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at) values(pg_temp.key('off'),pg_temp.key('l21'),pg_temp.uid('student'),'in_progress',now());
insert into public.lesson_segment_progress(offering_id,user_id,segment_id,lesson_id,status) values(pg_temp.key('off'),pg_temp.uid('student'),pg_temp.key('part2'),pg_temp.key('l21'),'in_progress');
insert into public.lesson_blocks(lesson_id,block_type,position,content) values(pg_temp.key('l21'),'text',0,'{"text":"Synthetic notes"}');
select set_config('ccs.refs',pg_temp.refs('l21')::text,true);
select pg_temp.ok((select count(*)=6 and bool_and(jsonb_array_length(v)>0) from jsonb_each(current_setting('ccs.refs')::jsonb) x(k,v)),'the lesson holds homework, a submission, progress, progress on a part, a part and a block');
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.edit('move_lesson',pg_temp.key('l21'),pg_temp.key('ch3'),pg_temp.ls('l21'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ch3'))||jsonb_build_object('id',pg_temp.key('l21'),'updated_at',pg_temp.ls('l21'))));
select pg_temp.ok((pg_temp.lesson('l21')).module_id=pg_temp.key('ch3'),'a lesson holding all of it moves to another chapter');
select pg_temp.ok(pg_temp.refs('l21')=current_setting('ccs.refs')::jsonb,'every row that hangs off it is exactly as it was');
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('l21'),null,pg_temp.ls('l21'),'{}')$s$,'["student_work", "homework", "student_progress", "parts", "content"]','and it is still refused for the same reasons in its new chapter');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_lesson',pg_temp.key('l21'),null,pg_temp.ls('l21'),'{}')$s$)@>'{"contentBlocks":1,"covers":0,"parts":1,"homework":1}','with the counts of what is inside, a homework of two versions counting once');

-- ---------------------------------------------------------------- a published lesson no student has started may be deleted (the owner's answer 4)
select set_config('ccs.pub',public.edit_learning_content(pg_temp.key('course'),'create_lesson',null,pg_temp.key('ch3'),null,'{"title":"Published, not started"}')::text,true);
reset role;
update public.lessons set status='published' where id=pg_temp.key('pub');
select pg_temp.ok((select count(*)=1 from public.notifications n join private.notification_events e on e.id=n.event_id where e.resource_id=pg_temp.key('pub') and n.recipient_id=pg_temp.uid('student')),'publishing it told the enrolled student');
select set_config('ccs.pub_event',(select id::text from private.notification_events where resource_id=pg_temp.key('pub')),true);
set local role authenticated;
select pg_temp.ok((public.course_structure(pg_temp.key('course'))->'lessons')@>jsonb_build_array(jsonb_build_object('id',pg_temp.key('pub'),'status','published','deleteBlockers','[]'::jsonb)),'the read says nothing blocks it');
select pg_temp.ok(pg_temp.edit('delete_lesson',pg_temp.key('pub'),null,pg_temp.ls('pub'),'{}')=pg_temp.key('pub'),'the teacher deletes it');
select pg_temp.ok(not pg_temp.has_lesson(pg_temp.key('pub')),'and the published lesson is gone');
select pg_temp.claim('student');
reset role;
select pg_temp.ok(private.notification_link(pg_temp.key('pub_event'),pg_temp.uid('student')) is null,'the old notification no longer links anywhere, and does not break');

-- ---------------------------------------------------------------- the chapter label (the owner's answer 3)
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values(pg_temp.key('course3'),pg_temp.key('org_a'),'Synthetic numbers','ccs-numbers','draft','private',pg_temp.uid('owner'));
set local role authenticated;
select pg_temp.claim('owner');
-- Create.
select set_config('ccs.na',pg_temp.edit('create_chapter',null,null,null,'{"title":"A"}','course3')::text,true);
select set_config('ccs.nb',pg_temp.edit('create_chapter',null,null,null,'{"title":"B"}','course3')::text,true);
select set_config('ccs.nc',pg_temp.edit('create_chapter',null,null,null,'{"title":"C"}','course3')::text,true);
select pg_temp.ok(pg_temp.labels('course3')='A:Chapter:1:0|B:Chapter:2:1|C:Chapter:3:2','create numbers chapters 1, 2, 3');
select set_config('ccs.nd',public.edit_learning_content(pg_temp.key('course3'),'create_module',null,null,null,'{"title":"D"}')::text,true);
select pg_temp.ok(pg_temp.labels('course3')='A:Chapter:1:0|B:Chapter:2:1|C:Chapter:3:2|D:Chapter:4:3','the old create_module gets the same label, not Module 1');
-- Reorder.
select public.edit_learning_content(pg_temp.key('course3'),'reorder_modules',null,null,null,jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by position desc) from public.course_modules where course_id=pg_temp.key('course3'))));
select pg_temp.ok(pg_temp.labels('course3')='D:Chapter:1:0|C:Chapter:2:1|B:Chapter:3:2|A:Chapter:4:3','reorder renumbers in the same transaction');
-- A type or number that is asked for is not stored.
select public.edit_learning_content(pg_temp.key('course3'),'edit_module_details',pg_temp.key('na'),null,pg_temp.cs('na'),'{"title":"A","group_type":"Special Review","chapter_number":37,"summary":"Kept summary"}');
select public.edit_learning_content(pg_temp.key('course3'),'edit_module',pg_temp.key('nb'),null,pg_temp.cs('nb'),'{"title":"B","description":"Kept description","group_type":"Week"}');
select pg_temp.ok(pg_temp.labels('course3')='D:Chapter:1:0|C:Chapter:2:1|B:Chapter:3:2|A:Chapter:4:3','edit_module_details and edit_module cannot change the type or the number');
select pg_temp.ok((select summary='Kept summary' from public.course_modules where id=pg_temp.key('na')) and (select description='Kept description' from public.course_modules where id=pg_temp.key('nb')),'and save everything else');
-- Moving and deleting a lesson do not touch the numbers.
select set_config('ccs.nl',public.edit_learning_content(pg_temp.key('course3'),'create_lesson',null,pg_temp.key('nd'),null,'{"title":"Traveller"}')::text,true);
select pg_temp.edit('move_lesson',pg_temp.key('nl'),pg_temp.key('nc'),pg_temp.ls('nl'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('nl'),'updated_at',pg_temp.ls('nl')))),'course3');
select pg_temp.ok(pg_temp.labels('course3')='D:Chapter:1:0|C:Chapter:2:1|B:Chapter:3:2|A:Chapter:4:3','moving a lesson leaves the numbers right');
select pg_temp.ok(pg_temp.edit('delete_lesson',pg_temp.key('nl'),null,pg_temp.ls('nl'),'{}','course3')=pg_temp.key('nl') and pg_temp.labels('course3')='D:Chapter:1:0|C:Chapter:2:1|B:Chapter:3:2|A:Chapter:4:3','so does deleting a lesson');
-- Delete closes the gap.
select pg_temp.edit('delete_chapter',pg_temp.key('nc'),null,pg_temp.cs('nc'),'{"items":[]}','course3');
select pg_temp.ok(pg_temp.labels('course3')='D:Chapter:1:0|B:Chapter:2:1|A:Chapter:3:2','deleting a middle chapter renumbers the ones after it');
select pg_temp.edit('delete_chapter',pg_temp.key('nd'),null,pg_temp.cs('nd'),'{"items":[]}','course3');
select pg_temp.ok(pg_temp.labels('course3')='B:Chapter:1:0|A:Chapter:2:1','deleting the first chapter too');
select pg_temp.edit('delete_chapter',pg_temp.key('na'),null,pg_temp.cs('na'),'{"items":[]}','course3');
select pg_temp.ok(pg_temp.labels('course3')='B:Chapter:1:0','deleting the last chapter changes no other');
select set_config('ccs.ne',pg_temp.edit('create_chapter',null,null,null,'{"title":"E"}','course3')::text,true);
select pg_temp.ok(pg_temp.labels('course3')='B:Chapter:1:0|E:Chapter:2:1','a chapter added after a delete takes the next number');
-- From outside, nothing can break it.
select pg_temp.denied($s$insert into public.course_modules(course_id,title,position) values(current_setting('ccs.course3')::uuid,'Direct',9)$s$,'42501','a teacher cannot add a chapter directly');
select pg_temp.denied($s$delete from public.course_modules where id=current_setting('ccs.ne')::uuid$s$,'42501','a teacher cannot delete a chapter directly');
select pg_temp.denied($s$update public.course_modules set position=9 where id=current_setting('ccs.ne')::uuid$s$,'42501','a teacher cannot write a position directly');
select pg_temp.denied($s$update public.course_modules set chapter_number=9 where id=current_setting('ccs.ne')::uuid$s$,'42501','a teacher cannot write a number directly');
select pg_temp.denied($s$delete from public.lessons where id=current_setting('ccs.l13')::uuid$s$,'42501','a teacher cannot delete a lesson directly, so a refused delete cannot be walked around');
update public.course_modules set group_type='Week' where id=pg_temp.key('ne');
select pg_temp.ok(pg_temp.labels('course3')='B:Chapter:1:0|E:Chapter:2:1','a direct write of the type does not stick');
reset role;
update public.course_modules set chapter_number=37,group_type='Week' where id=pg_temp.key('ne');
select pg_temp.ok(pg_temp.labels('course3')='B:Chapter:1:0|E:Chapter:2:1','not even from the database owner');
select pg_temp.ok((select count(*)=2 from pg_constraint where conrelid='public.course_modules'::regclass and conname in ('course_modules_chapter_number_is_position','course_modules_group_type_is_chapter')) and (select attnotnull from pg_attribute where attrelid='public.course_modules'::regclass and attname='chapter_number'),'and two checks and not null say the same in the table itself');
select pg_temp.ok(not exists(select 1 from public.course_modules where chapter_number<>position+1 or group_type<>'Chapter') and not exists(select 1 from (select position,row_number() over (partition by course_id order by position)-1 rn from public.course_modules) x where position<>rn),'after everything above, no chapter anywhere has a wrong label or a gap');

-- ---------------------------------------------------------------- what is inside, in the refusal (the owner's answer 2)
set local role authenticated;
select pg_temp.claim('owner');
select set_config('ccs.il',public.edit_learning_content(pg_temp.key('course3'),'create_lesson',null,pg_temp.key('ne'),null,'{"title":"With a cover"}')::text,true);
select set_config('ccs.cover',public.register_lesson_upload(pg_temp.key('course3'),'image/png','Cover.png')::text,true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-course-media',current_setting('ccs.cover')::jsonb->>'path',auth.jwt()->>'sub','{"size":100,"mimetype":"image/png"}');
select public.complete_media_upload((current_setting('ccs.cover')::jsonb->>'id')::uuid);
select public.edit_learning_content(pg_temp.key('course3'),'set_lesson_cover',pg_temp.key('il'),null,pg_temp.ls('il'),jsonb_build_object('cover_asset_id',current_setting('ccs.cover')::jsonb->>'id'));
select pg_temp.refused($s$select pg_temp.edit('delete_lesson',pg_temp.key('il'),null,pg_temp.ls('il'),'{}','course3')$s$,'["content"]','a lesson with only a cover is refused');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_lesson',pg_temp.key('il'),null,pg_temp.ls('il'),'{}','course3')$s$)@>'{"contentBlocks":0,"covers":1}','and the refusal says a cover and no blocks');
reset role;
insert into public.lesson_blocks(lesson_id,block_type,position,content) values(pg_temp.key('il'),'text',0,'{"text":"One"}'),(pg_temp.key('il'),'text',1,'{"text":"Two"}');
set local role authenticated;
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_lesson',pg_temp.key('il'),null,pg_temp.ls('il'),'{}','course3')$s$)@>'{"reasons":["content"],"contentBlocks":2,"covers":1,"parts":0,"homework":0}','"This lesson has 2 content blocks and a cover": the refusal has the numbers for that sentence');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('delete_chapter',pg_temp.key('ne'),null,pg_temp.cs('ne'),jsonb_build_object('items',pg_temp.items(pg_temp.key('ne'))),'course3')$s$)@>jsonb_build_object('reasons','["content"]'::jsonb,'lessonIds',jsonb_build_array(pg_temp.key('il')),'contentBlocks',2,'covers',1),'so does the chapter''s refusal');
select pg_temp.ok((select (e->>'contentBlocks')::int=2 and (e->>'hasCover')::boolean and (e->>'parts')::int=0 from jsonb_array_elements(public.course_structure(pg_temp.key('course3'))->'lessons') e where e->>'id'=current_setting('ccs.il')),'the read gives the same numbers before any click');
select pg_temp.ok(pg_temp.has_lesson(pg_temp.key('il')),'and the lesson with a cover stays');

-- ---------------------------------------------------------------- an archived course (the owner's answer 4)
reset role;
insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values(pg_temp.key('archive'),pg_temp.key('org_a'),'Synthetic archive','ccs-archive','published','private',pg_temp.uid('owner'));
insert into public.course_staff(course_id,user_id,role) values(pg_temp.key('archive'),pg_temp.uid('assistant'),'assistant');
insert into public.course_modules(id,course_id,title,position) values(pg_temp.key('arch1'),pg_temp.key('archive'),'Kept one',0),(pg_temp.key('arch2'),pg_temp.key('archive'),'Kept two',1);
insert into public.lessons(id,module_id,title,position,status,description) values(pg_temp.key('arch_l1'),pg_temp.key('arch1'),'Kept lesson',0,'draft','Before'),(pg_temp.key('arch_l2'),pg_temp.key('arch1'),'Second lesson',1,'draft','');
set local role authenticated;
select pg_temp.claim('owner');
update public.courses set status='archived' where id=pg_temp.key('archive');
-- The new function.
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}','archive')$s$,'PT409','archived: create chapter is refused');
select pg_temp.denied($s$select pg_temp.edit('rename_chapter',pg_temp.key('arch1'),null,pg_temp.cs('arch1'),'{"title":"x"}','archive')$s$,'PT409','archived: rename chapter is refused');
select pg_temp.denied($s$select pg_temp.edit('rename_lesson',pg_temp.key('arch_l1'),null,pg_temp.ls('arch_l1'),'{"title":"x"}','archive')$s$,'PT409','archived: rename lesson is refused');
select pg_temp.denied($s$select pg_temp.edit('move_lesson',pg_temp.key('arch_l1'),pg_temp.key('arch2'),pg_temp.ls('arch_l1'),jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',pg_temp.key('arch_l1'),'updated_at',pg_temp.ls('arch_l1')))),'archive')$s$,'PT409','archived: move is refused');
select pg_temp.denied($s$select pg_temp.edit('delete_lesson',pg_temp.key('arch_l1'),null,pg_temp.ls('arch_l1'),'{}','archive')$s$,'PT409','archived: delete lesson is refused');
select pg_temp.denied($s$select pg_temp.edit('delete_chapter',pg_temp.key('arch2'),null,pg_temp.cs('arch2'),'{"items":[]}','archive')$s$,'PT409','archived: delete chapter is refused');
select pg_temp.ok(pg_temp.refusal($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}','archive')$s$)='{"reasons":["archived"]}','and the refusal says why');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"   "}','archive')$s$,'PT409','archived: checked before the input, so a screen that has not heard is told to reload, not that a name is wrong');
-- The old function: its create, rename, reorder.
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'create_module',null,null,null,'{"title":"x"}')$s$,'PT409','archived: the old create_module is refused');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'create_lesson',null,pg_temp.key('arch1'),null,'{"title":"x"}')$s$,'PT409','archived: the old create_lesson is refused');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'edit_module',pg_temp.key('arch1'),null,pg_temp.cs('arch1'),'{"title":"x"}')$s$,'PT409','archived: the old edit_module cannot rename');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'edit_module_details',pg_temp.key('arch1'),null,pg_temp.cs('arch1'),'{"title":"x","group_type":"Chapter","chapter_number":1}')$s$,'PT409','archived: the old edit_module_details cannot rename');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'edit_lesson',pg_temp.key('arch_l1'),null,pg_temp.ls('arch_l1'),'{"title":"x","status":"draft"}')$s$,'PT409','archived: the old edit_lesson cannot rename');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'reorder_modules',null,null,null,jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by position desc) from public.course_modules where course_id=pg_temp.key('archive'))))$s$,'PT409','archived: the old reorder_modules is refused');
select pg_temp.denied($s$select public.edit_learning_content(pg_temp.key('archive'),'reorder_lessons',null,pg_temp.key('arch1'),null,jsonb_build_object('items',(select jsonb_agg(e order by ord desc) from jsonb_array_elements(pg_temp.items(pg_temp.key('arch1'))) with ordinality x(e,ord))))$s$,'PT409','archived: the old reorder_lessons is refused');
-- Straight at the tables, as a teacher.
select pg_temp.denied($s$update public.course_modules set title='x' where id=pg_temp.key('arch1')$s$,'PT409','archived: a direct chapter rename is refused');
select pg_temp.denied($s$update public.lessons set title='x' where id=pg_temp.key('arch_l1')$s$,'PT409','archived: a direct lesson rename is refused');
select pg_temp.denied($s$update public.lessons set position=9 where id=pg_temp.key('arch_l1')$s$,'PT409','archived: a direct lesson reorder is refused');
select pg_temp.denied($s$insert into public.lessons(module_id,title,position) values(pg_temp.key('arch1'),'x',9)$s$,'PT409','archived: a direct lesson insert is refused');
-- People with no rights learn nothing about the state of the course.
select pg_temp.claim('stranger');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}','archive')$s$,'42501','archived: another space is still simply denied');
select pg_temp.claim('student');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}','archive')$s$,'42501','archived: a student is still simply denied');
-- Not even the database owner.
reset role;
select pg_temp.denied($s$insert into public.course_modules(course_id,title,position) values(pg_temp.key('archive'),'x',9)$s$,'PT409','archived: the database owner cannot add a chapter');
select pg_temp.denied($s$update public.course_modules set position=9 where id=pg_temp.key('arch2')$s$,'PT409','archived: the database owner cannot reorder chapters');
select pg_temp.denied($s$delete from public.course_modules where id=pg_temp.key('arch2')$s$,'PT409','archived: the database owner cannot delete a chapter');
select pg_temp.denied($s$delete from public.lessons where id=pg_temp.key('arch_l2')$s$,'PT409','archived: the database owner cannot delete a lesson');
select pg_temp.ok(pg_temp.labels('archive')='Kept one:Chapter:1:0|Kept two:Chapter:2:1' and pg_temp.tree('arch1')='Kept lesson|Second lesson','nothing refused changed anything');
-- The read: everything, read-only.
set local role authenticated;
select pg_temp.claim('owner');
select set_config('ccs.atree',public.course_structure(pg_temp.key('archive'))::text,true);
select pg_temp.ok(current_setting('ccs.atree')::jsonb@>'{"archived":true,"canEdit":false}','the owner reads an archived course as archived and not editable');
select pg_temp.ok(jsonb_array_length(current_setting('ccs.atree')::jsonb->'chapters')=2 and jsonb_array_length(current_setting('ccs.atree')::jsonb->'lessons')=2,'and still reads all of it');
select pg_temp.claim('assistant');
select pg_temp.ok(public.course_structure(pg_temp.key('archive'))@>'{"archived":true,"canEdit":false}','an assistant reads it the same way');
-- What is not structure is not refused here. Keeping the same title counts as no change.
select pg_temp.claim('owner');
select public.edit_learning_content(pg_temp.key('archive'),'edit_lesson',pg_temp.key('arch_l1'),null,pg_temp.ls('arch_l1'),'{"title":"Kept lesson","description":"After","status":"draft"}');
select pg_temp.ok((pg_temp.lesson('arch_l1')).description='After','archived: a lesson''s description is not structure and still saves');
-- Taken out of the archive, it works again.
update public.courses set status='published' where id=pg_temp.key('archive');
select pg_temp.ok(pg_temp.edit('rename_chapter',pg_temp.key('arch1'),null,pg_temp.cs('arch1'),'{"title":"Open again"}','archive')=pg_temp.key('arch1'),'out of the archive, editing works again');
select pg_temp.ok(public.course_structure(pg_temp.key('archive'))@>'{"archived":false,"canEdit":true}','and the read says so');
-- Deleting the whole archived course still works: its chapters and lessons go with it.
update public.courses set status='archived' where id=pg_temp.key('archive');
reset role;
delete from public.courses where id=pg_temp.key('archive');
select pg_temp.ok(not pg_temp.has_chapter(pg_temp.key('arch1')) and not pg_temp.has_lesson(pg_temp.key('arch_l1')),'deleting an archived course still removes its tree');

-- ---------------------------------------------------------------- how the functions are built
select pg_temp.ok((select bool_and(prosecdef and proconfig @> array['search_path=""'] and pg_get_functiondef(oid) not like '%auth.uid%') from pg_proc where oid in ('private.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb)'::regprocedure,'private.course_structure(uuid)'::regprocedure,'private.lesson_delete_blockers(uuid)'::regprocedure,'private.lesson_delete_counts(uuid[])'::regprocedure,'private.keep_lesson_in_course()'::regprocedure,'private.pin_chapter_label()'::regprocedure,'private.close_chapter_gaps(uuid)'::regprocedure,'private.close_chapter_gaps_after_delete()'::regprocedure,'private.refuse_archived_structure()'::regprocedure)),'every private function is SECURITY DEFINER, has an empty search_path and never reads auth.uid()');
select pg_temp.ok((select bool_and(not prosecdef) from pg_proc where oid in ('public.edit_course_structure(uuid,text,uuid,uuid,timestamptz,jsonb)'::regprocedure,'public.course_structure(uuid)'::regprocedure)),'the public wrappers are SECURITY INVOKER');
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.denied($s$select private.lesson_delete_blockers(current_setting('ccs.l13')::uuid)$s$,'42501','the blockers helper is not callable from outside');
select pg_temp.denied($s$select private.lesson_delete_counts(array[current_setting('ccs.l13')::uuid])$s$,'42501','the counts helper is not callable from outside');
select pg_temp.denied($s$select private.close_chapter_gaps(current_setting('ccs.course')::uuid)$s$,'42501','the renumbering helper is not callable from outside');
reset role;

-- ---------------------------------------------------------------- demo seed version 7 (version 4 plus homework, and a lesson with no part)
insert into public.organizations(id,name,slug) values(pg_temp.key('org_d'),'Synthetic demo','ccs-d-'||current_setting('ccs.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.key('org_d'),pg_temp.uid('demoteacher'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.key('org_d'),pg_temp.uid('admin'));
select set_config('ccs.fill',private.demo_fill_core(pg_temp.key('org_d'),pg_temp.uid('admin'))::text,true);
select pg_temp.ok(current_setting('ccs.fill')::jsonb=jsonb_build_object('seedVersion',7,'courses',2,'lessons',6,'groups',2,'sessions',9,'students',28,'homework',5,'exams',5),'fill reports seed version 7, six lessons and five homework');
select pg_temp.ok((select seed_version=7 from private.demo_spaces where organization_id=pg_temp.key('org_d')),'the space stores seed version 7');
select set_config('ccs.demo_course',(select id::text from public.courses where organization_id=pg_temp.key('org_d') and status='published'),true);
select set_config('ccs.demo_draft',(select id::text from public.courses where organization_id=pg_temp.key('org_d') and status='draft'),true);
select pg_temp.ok((select array_agg(m.title order by m.position)=array['Electric current','Magnetism','Electromagnetic induction'] from public.course_modules m where m.course_id=pg_temp.key('demo_course')),'the published demo course has the three chapters of the board');
select pg_temp.ok((select array_agg(c order by p)=array[3,3,0]::bigint[] from (select m.position p,(select count(*) from public.lessons l where l.module_id=m.id) c from public.course_modules m where m.course_id=pg_temp.key('demo_course')) x),'with 3, 3 and 0 lessons');
select pg_temp.ok((select array_agg(l.title order by m.position,l.position)=array['Ohm''s law','Resistors in series and parallel','Kirchhoff''s laws','Magnetic field of a wire','Force on a wire','Magnetism review'] from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=pg_temp.key('demo_course')),'and the lessons of the board, plus the version 6 lesson with no part');
select pg_temp.ok(pg_temp.labels('demo_course')='Electric current:Chapter:1:0|Magnetism:Chapter:2:1|Electromagnetic induction:Chapter:3:2','demo chapters are Chapter 1, 2 and 3, like ones a teacher adds');
select pg_temp.ok((select count(*)=0 from public.course_modules where course_id=pg_temp.key('demo_draft')),'the draft demo course has no chapters, so the empty state can be tried');
select pg_temp.ok((select count(*)=9 from private.demo_seed_rows where organization_id=pg_temp.key('org_d') and table_name in ('course_modules','lessons')),'every chapter and lesson is recorded');
select pg_temp.ok((select array_agg(l.title||':'||(select count(*) from public.homework_assignments h where h.lesson_id=l.id) order by m.position,l.position)=array['Ohm''s law:2','Resistors in series and parallel:0','Kirchhoff''s laws:1','Magnetic field of a wire:1','Force on a wire:0','Magnetism review:1'] from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=pg_temp.key('demo_course')),'seed version 5 puts homework on three lessons of the published demo course (two on Ohm''s law), version 6 one on the lesson with no part');
select pg_temp.ok((select e.resource_id in (select row_id from private.demo_seed_rows where table_name='lessons') from private.notification_events e where e.event_key='demo:'||pg_temp.key('org_d')::text||':notification:2'),'the lesson_published notification points at a recorded lesson');
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok((public.platform_demo_status(pg_temp.key('org_d'))->>'latestSeedVersion')::int=7,'the status reports seed version 7 as the latest');
-- The teacher tries everything in the demo space, then Clear still removes it all.
select pg_temp.claim('demoteacher');
select set_config('ccs.dtree',public.course_structure(pg_temp.key('demo_course'))::text,true);
select pg_temp.ok(jsonb_array_length(current_setting('ccs.dtree')::jsonb->'chapters')=3 and jsonb_array_length(current_setting('ccs.dtree')::jsonb->'lessons')=6,'the demo teacher reads 3 chapters and 6 lessons');
select set_config('ccs.dch',pg_temp.edit('create_chapter',null,null,null,'{"title":"Added by the teacher"}','demo_course')::text,true);
select set_config('ccs.dl',public.edit_learning_content(pg_temp.key('demo_course'),'create_lesson',null,pg_temp.key('dch'),null,'{"title":"Added lesson"}')::text,true);
select pg_temp.edit('rename_lesson',((current_setting('ccs.dtree')::jsonb->'lessons'->0->>'id')::uuid),null,(current_setting('ccs.dtree')::jsonb->'lessons'->0->>'updatedAt')::timestamptz,'{"title":"Renamed in the demo"}','demo_course');
-- Seed version 5: Kirchhoff's laws (a draft homework) is the lesson moved; the lessons deleted are the two with no homework. A lesson with demo
-- homework is refused like any other lesson with homework.
select pg_temp.edit('move_lesson',((current_setting('ccs.dtree')::jsonb->'lessons'->2->>'id')::uuid),pg_temp.key('dch'),(current_setting('ccs.dtree')::jsonb->'lessons'->2->>'updatedAt')::timestamptz,
 jsonb_build_object('items',pg_temp.items(pg_temp.key('dch'))||jsonb_build_object('id',current_setting('ccs.dtree')::jsonb->'lessons'->2->>'id','updated_at',current_setting('ccs.dtree')::jsonb->'lessons'->2->>'updatedAt')),'demo_course');
select pg_temp.edit('delete_lesson',((current_setting('ccs.dtree')::jsonb->'lessons'->1->>'id')::uuid),null,(current_setting('ccs.dtree')::jsonb->'lessons'->1->>'updatedAt')::timestamptz,'{}','demo_course');
select pg_temp.edit('delete_lesson',((current_setting('ccs.dtree')::jsonb->'lessons'->4->>'id')::uuid),null,(current_setting('ccs.dtree')::jsonb->'lessons'->4->>'updatedAt')::timestamptz,'{}','demo_course');
select pg_temp.refused(format($s$select public.edit_course_structure(%L,'delete_lesson',%L,null,%L,'{}')$s$,pg_temp.key('demo_course'),current_setting('ccs.dtree')::jsonb->'lessons'->0->>'id',current_setting('ccs.dtree')::jsonb->'lessons'->0->>'updatedAt'),
 '["student_work", "homework"]','a demo lesson whose homework students handed in is refused, naming the student work');
select pg_temp.ok(pg_temp.labels('demo_course') like '%Added by the teacher:Chapter:4:3','the demo teacher''s new chapter is Chapter 4');
select pg_temp.denied($s$select pg_temp.edit('create_chapter',null,null,null,'{"title":"x"}')$s$,'42501','the demo teacher cannot reach another space');
update public.courses set status='archived' where id=pg_temp.key('demo_course');
reset role;
select pg_temp.ok((private.demo_clear_core(pg_temp.key('org_d'),pg_temp.uid('admin'))->>'removedRows')::int>0,'Clear finishes after chapters and lessons were added, renamed, moved and deleted, and the course archived, with the homework of seed versions 5 and 6');
select pg_temp.ok((select count(*)=0 from public.courses where organization_id=pg_temp.key('org_d')) and not pg_temp.has_chapter(pg_temp.key('dch')) and not pg_temp.has_lesson(pg_temp.key('dl')),'and removes every chapter and lesson');
select pg_temp.ok((select count(*)=0 from private.demo_seed_rows where organization_id=pg_temp.key('org_d')),'nothing stays recorded');
select pg_temp.ok(pg_temp.has_lesson(pg_temp.key('l13')) and pg_temp.has_lesson(pg_temp.key('l_b')) and pg_temp.has_chapter(pg_temp.key('ch_b')),'other spaces keep theirs');
select pg_temp.ok((private.demo_fill_core(pg_temp.key('org_d'),pg_temp.uid('admin'))->>'seedVersion')::int=7,'the space fills again');

select count(*) as course_content_tree_tests from ccs_results;
rollback;
