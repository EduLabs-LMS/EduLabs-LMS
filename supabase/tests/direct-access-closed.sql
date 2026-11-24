-- Track 1 (fix-01-direct-access): the browser role may READ the tables the app reads and WRITE nothing directly.
-- Synthetic fixtures only. Every change rolls back. Disposable local PostgreSQL only.
-- Proves: A0-02, A2a-02..05, A1-02 (revoke), A1-04, A3-01, A3-06, A0-10, A4-02, A5-01, A6b-01, A6b-03/04/05, A6a-14.
-- Fixture people (supabase/tests/local-bootstrap.sql): 1 = course owner + space owner of space A, 2 = course instructor + teacher of A and
-- admin of space B, 3 = owner of space B and of course 2, 4 = course editor + assistant of A, 5 and 6 = students of A, 7 = student of B.
begin;
create temp table dac_results(name text primary key);
grant select,insert on dac_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.dac_results values(label); end$$;
create function pg_temp.denied(sql text,code text,label text) returns void language plpgsql as $$declare caught text;begin begin execute sql;exception when others then get stacked diagnostics caught=returned_sqlstate;end;if caught is distinct from code then raise exception 'FAILED %, expected %, got %',label,code,coalesce(caught,'no error'); end if; insert into pg_temp.dac_results values(label);end$$;
create function pg_temp.claim(n integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub','10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::text,true)$$;
create function pg_temp.rev(c uuid) returns timestamptz language sql security definer set search_path='' as $$select updated_at from public.courses where id=c$$;
-- Calls course_update as person n with the course's current revision and returns 'ok' or the SQLSTATE.
create function pg_temp.cu(n integer,c uuid,fields jsonb) returns text language plpgsql as $$
begin perform pg_temp.claim(n); perform public.course_update(c,pg_temp.rev(c),fields); return 'ok';
exception when others then return sqlstate; end$$;
create function pg_temp.expect_cu(n integer,c uuid,fields jsonb,want text,label text) returns void language plpgsql as $$
declare got text:=pg_temp.cu(n,c,fields);
begin if got is distinct from want then raise exception 'FAILED %, expected %, got %',label,want,got; end if; insert into pg_temp.dac_results values(label); end$$;

-- ===== 1. Grants: the browser and anonymous roles keep no write privilege on the 13 tables (A0-02, A1-02, A2a-02..04, A3-01, A6b-01) =====
select pg_temp.ok(not exists(
  select 1 from unnest(array['anon','authenticated']) r,
   unnest(array['courses','course_modules','course_staff','lessons','lesson_blocks','lesson_progress','media_assets','organization_memberships','organizations','profiles','enrollments','course_offerings','offering_staff']) t,
   unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r,'public.'||t,p)
 ) and not exists(
  select 1 from unnest(array['anon','authenticated']) r, information_schema.columns c
  where c.table_schema='public' and c.table_name in ('courses','course_modules','course_staff','lessons','lesson_blocks','lesson_progress','media_assets','organization_memberships','organizations','profiles','enrollments','course_offerings','offering_staff')
   and (has_column_privilege(r,'public.'||c.table_name,c.column_name,'INSERT') or has_column_privilege(r,'public.'||c.table_name,c.column_name,'UPDATE'))
 ),'no write privilege, at table or column level, on the 13 tables for anon and authenticated');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE')
  and tablename in ('courses','course_modules','course_staff','lessons','lesson_blocks','lesson_progress','media_assets','organization_memberships','organizations','profiles','enrollments','course_offerings','offering_staff')),
 'no write policy is left on the 13 tables (the restrictive trusted_identity policy stays)');
select pg_temp.ok(exists(select 1 from pg_policies where schemaname='public' and tablename='courses' and policyname='trusted_identity' and permissive='RESTRICTIVE'),'the restrictive trusted_identity policy is kept');
-- The reads the app does are untouched.
select pg_temp.ok(bool_and(has_table_privilege('authenticated','public.'||t,'SELECT')),'the browser role can still read the tables the app reads')
 from unnest(array['courses','course_modules','course_staff','lessons','lesson_blocks','lesson_progress','media_assets','organization_memberships','organizations','profiles','enrollments','course_offerings','offering_staff']) t;
-- A4-02 and A5-01: eleven tables nothing reads are closed for reading.
select pg_temp.ok(not exists(
  select 1 from unnest(array['anon','authenticated']) r,
   unnest(array['study_groups','group_staff','group_memberships','group_schedules','group_sessions','session_attendance','homework_questions','homework_options','homework_submissions','homework_responses','homework_submission_files']) t,
   unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r,'public.'||t,p)),'the 11 group and homework tables have no privilege for anon or authenticated');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public' and tablename in ('study_groups','group_staff','group_memberships','group_schedules','group_sessions','session_attendance','homework_questions','homework_options','homework_submissions','homework_responses','homework_submission_files') and cmd in ('SELECT','ALL') and policyname<>'trusted_identity'),
 'no read policy is left on the 11 group and homework tables');
-- A6b-03/04/05: six legacy tables and 24 legacy RPCs.
select pg_temp.ok(not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) r,
   unnest(array['assessments','offering_assessments','assessment_questions','assessment_options','assessment_attempts','assessment_responses']) t,
   unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege(r,'public.'||t,p)),'the six legacy exam tables have no privilege for anon, authenticated or service_role');
select pg_temp.ok(not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) r,
   unnest(array['clone_assessment(uuid,text)','decide_exam_retry(uuid,text,bigint)','finalize_assessment_grade(uuid)','get_assessment_answer_keys(uuid)','get_assessment_results(uuid)','get_exam_attempt_content(uuid)','get_exam_definition(uuid)','get_exam_definition_v2(uuid)','get_exam_grade_changes(uuid)','get_exam_grading_detail(uuid)','get_exam_review(uuid)','get_exam_submission_page(uuid,uuid,integer)','get_exam_summaries(uuid[])','grade_assessment_response(uuid,numeric,text)','grade_exam_paper(uuid,bigint,jsonb,text,text,uuid)','release_exam_result(uuid,uuid,bigint)','release_exam_review(uuid,uuid,bigint)','save_assessment_response(uuid,uuid,jsonb,uuid)','save_exam_answers(uuid,bigint,jsonb)','save_exam_response(uuid,uuid,jsonb,uuid,bigint)','set_assessment_answer_key(uuid,jsonb)','start_assessment_attempt(uuid)','submit_assessment_attempt(uuid)','sync_exam_participation(uuid)']) f
  where has_function_privilege(r,'public.'||f,'EXECUTE')),'the 24 legacy exam RPCs have no EXECUTE for anon, authenticated or service_role');
-- The new functions: signed-in people only.
select pg_temp.ok(has_function_privilege('authenticated','public.course_update(uuid,timestamptz,jsonb)','EXECUTE') and not has_function_privilege('anon','public.course_update(uuid,timestamptz,jsonb)','EXECUTE')
  and has_function_privilege('authenticated','public.course_run(uuid)','EXECUTE') and not has_function_privilege('anon','public.course_run(uuid)','EXECUTE'),'course_update and course_run are for signed-in people only');
select pg_temp.ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('private.course_update(uuid,timestamptz,jsonb)'::regprocedure,'private.course_run(uuid)'::regprocedure)),'the private functions are definer with an empty search_path');
select pg_temp.ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.course_update(uuid,timestamptz,jsonb)'::regprocedure),'the public wrapper is invoker');

-- ===== 2. A0-02: the editor's direct writes on the course tree are refused (42501) =====
set local role authenticated;
select pg_temp.claim(4);
select pg_temp.denied($q$delete from public.lessons where id='50000000-0000-0000-0000-000000000001'$q$,'42501','an editor cannot delete a lesson directly');
select pg_temp.denied($q$update public.courses set title='Direct' where id='30000000-0000-0000-0000-000000000001'$q$,'42501','an editor cannot update a course directly');
select pg_temp.denied($q$insert into public.course_modules(course_id,title,position) values('30000000-0000-0000-0000-000000000001','Direct',9)$q$,'42501','an editor cannot insert a module directly');
select pg_temp.denied($q$delete from public.course_modules where course_id='30000000-0000-0000-0000-000000000001'$q$,'42501','an editor cannot delete modules directly');
select pg_temp.denied($q$insert into public.lesson_blocks(lesson_id,block_type,position,content) values('50000000-0000-0000-0000-000000000001','text',90,'{}')$q$,'42501','an editor cannot insert a block directly');
select pg_temp.denied($q$delete from public.course_staff where course_id='30000000-0000-0000-0000-000000000001'$q$,'42501','an editor cannot delete course staff directly');
select pg_temp.claim(1);
select pg_temp.denied($q$delete from public.lessons where id='50000000-0000-0000-0000-000000000001'$q$,'42501','even the course owner cannot delete a lesson directly');
select pg_temp.denied($q$update public.courses set status='archived' where id='30000000-0000-0000-0000-000000000001'$q$,'42501','even the course owner cannot archive directly');
select pg_temp.denied($q$insert into public.courses(organization_id,title,slug) values('20000000-0000-0000-0000-000000000001','Direct','direct-course')$q$,'42501','even the space owner cannot insert a course directly');
select pg_temp.denied($q$insert into public.course_staff(course_id,user_id,role) values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','owner')$q$,'42501','nobody can add course staff directly');
select pg_temp.claim(5);
select pg_temp.denied($q$insert into public.lesson_progress(offering_id,lesson_id,user_id,status) values('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','completed')$q$,'42501','a student cannot write progress directly');
select pg_temp.denied($q$update public.lesson_progress set status='completed'$q$,'42501','a student cannot update progress directly');
-- Still readable: the editor and the owner read the course through RLS.
select pg_temp.claim(1);
select pg_temp.ok((select count(*)=1 from public.courses where id='30000000-0000-0000-0000-000000000001'),'the owner still reads the course');

-- ===== 3. A0-02 + A2a-05: course_update and its role matrix on course 1 (published), space A has no admin =====
reset role;
set local role authenticated;
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"description":"Edited by the assigned editor"}','ok','editor edits the description');
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"title":"Editor title","slug":"editor-slug","visibility":"unlisted"}','ok','editor edits title, slug and visibility');
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"status":"draft"}','42501','editor cannot unpublish');
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"status":"archived"}','42501','editor cannot archive');
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"status":"published"}','ok','a save that leaves the status as it is stays allowed for the editor');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000001','{"status":"draft"}','ok','instructor unpublishes');
select pg_temp.expect_cu(4,'30000000-0000-0000-0000-000000000001','{"status":"published"}','42501','editor cannot publish');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000001','{"status":"published"}','ok','instructor publishes');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000001','{"status":"archived"}','ok','instructor archives');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000001','{"status":"draft"}','42501','instructor cannot un-archive');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000001','{"status":"published"}','42501','instructor cannot un-archive straight to published either');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"status":"draft"}','ok','course owner who is also space owner un-archives');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"status":"published","title":"Course owner title"}','ok','course owner publishes');
select pg_temp.expect_cu(5,'30000000-0000-0000-0000-000000000001','{"title":"Student"}','42501','a student cannot edit');
select pg_temp.expect_cu(6,'30000000-0000-0000-0000-000000000001','{"status":"archived"}','42501','another student cannot archive');
select pg_temp.expect_cu(3,'30000000-0000-0000-0000-000000000001','{"title":"Other space"}','42501','the owner of another space cannot edit');
select pg_temp.expect_cu(7,'30000000-0000-0000-0000-000000000001','{"title":"Other space student"}','42501','a student of another space cannot edit');
-- Space B: person 2 is only a space admin there (no course staff row), person 3 is the owner.
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000002','{"status":"draft"}','ok','space admin unpublishes a course they are not staff of');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000002','{"status":"archived"}','ok','space admin archives');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000002','{"status":"draft"}','ok','space admin un-archives');
select pg_temp.expect_cu(2,'30000000-0000-0000-0000-000000000002','{"status":"published"}','ok','space admin publishes');
select pg_temp.expect_cu(3,'30000000-0000-0000-0000-000000000002','{"status":"archived"}','ok','space owner archives');
select pg_temp.expect_cu(3,'30000000-0000-0000-0000-000000000002','{"status":"published"}','ok','space owner un-archives');
-- Same text rules as the rename functions; bad input is refused without a write.
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"title":"   "}','22023','blank title refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001',jsonb_build_object('title',repeat('t',201)),'22023','201-character title refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001',jsonb_build_object('title','Bad'||chr(7)||'title'),'22023','control character in title refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"slug":"Not A Slug"}','22023','bad slug refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"visibility":"everyone"}','22023','unknown visibility refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"status":"deleted"}','22023','unknown status refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"organization_id":"20000000-0000-0000-0000-000000000002"}','22023','moving a course to another space is refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{}','22023','an empty change is refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001',jsonb_build_object('description',repeat('d',20001)),'22023','a 20,001-character description is refused');
select pg_temp.expect_cu(1,'30000000-0000-0000-0000-000000000001','{"description":null}','ok','the description can be cleared');
select pg_temp.claim(1);
select pg_temp.denied($q$select public.course_update(gen_random_uuid(),now(),'{"title":"x"}')$q$,'42501','a course that does not exist is refused');
-- A stale revision is refused with PT409; the lock keeps one writer at a time.
select pg_temp.claim(1);
select pg_temp.denied($q$select public.course_update('30000000-0000-0000-0000-000000000001',pg_temp.rev('30000000-0000-0000-0000-000000000001')-interval '1 second','{"title":"Stale"}')$q$,'PT409','a stale revision is refused (PT409)');
-- A duplicate slug in the same space is refused with 23505 (the server maps it to "This slug is already in use").
select set_config('dac.other',public.create_teacher_course('20000000-0000-0000-0000-000000000001','Second course','second-course-slug')::text,true);
select pg_temp.denied($q$select public.course_update(current_setting('dac.other')::uuid,pg_temp.rev(current_setting('dac.other')::uuid),jsonb_build_object('slug',(select slug from public.courses where id='30000000-0000-0000-0000-000000000001')))$q$,'23505','a duplicate slug is refused (23505)');
select pg_temp.ok((select title='Course owner title' from public.courses where id='30000000-0000-0000-0000-000000000001'),'the refused edits changed nothing');
select pg_temp.ok((select (public.course_update(id,updated_at,'{"title":"Round trip"}')->>'id')=id::text from public.courses where id='30000000-0000-0000-0000-000000000001'),'the function returns the course id and the new revision');
select pg_temp.ok((select title='Round trip' and updated_at>now()-interval '1 minute' from public.courses where id='30000000-0000-0000-0000-000000000001'),'the revision moves on save');
reset role;
set local role anon;
select pg_temp.denied($q$select public.course_update('30000000-0000-0000-0000-000000000001',now(),'{"title":"Anon"}')$q$,'42501','anonymous cannot call course_update');
select pg_temp.denied($q$select public.course_run('30000000-0000-0000-0000-000000000001')$q$,'42501','anonymous cannot call course_run');
reset role;

-- ===== 4. A2a-02: a block's file must belong to this course, even through a definer path =====
select set_config('dac.mine',gen_random_uuid()::text,true);
select set_config('dac.foreign',gen_random_uuid()::text,true);
select set_config('dac.unscoped',gen_random_uuid()::text,true);
insert into public.media_assets(id,organization_id,uploaded_by,kind,mime_type,original_filename,bucket,object_path,status,size_bytes) values
 (current_setting('dac.mine')::uuid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pdf','application/pdf','Mine.pdf','lms-course-media','20000000-0000-0000-0000-000000000001/'||current_setting('dac.mine')||'/mine.pdf','ready',100),
 (current_setting('dac.foreign')::uuid,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','pdf','application/pdf','Foreign.pdf','lms-course-media','20000000-0000-0000-0000-000000000002/'||current_setting('dac.foreign')||'/foreign.pdf','ready',100),
 (current_setting('dac.unscoped')::uuid,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','pdf','application/pdf','Unscoped.pdf','lms-course-media','20000000-0000-0000-0000-000000000002/'||current_setting('dac.unscoped')||'/unscoped.pdf','ready',100);
insert into private.lesson_upload_scopes(asset_id,course_id) values(current_setting('dac.mine')::uuid,'30000000-0000-0000-0000-000000000001');
-- Space B's course owner uploaded a file for course 2 only.
insert into private.lesson_upload_scopes(asset_id,course_id) values(current_setting('dac.foreign')::uuid,'30000000-0000-0000-0000-000000000002');
create function pg_temp.add_block(asset uuid,pos integer) returns uuid language plpgsql security definer set search_path='' as $$
declare b uuid;
begin insert into public.lesson_blocks(lesson_id,block_type,position,media_asset_id) values('50000000-0000-0000-0000-000000000001','pdf',pos,asset) returning id into b; return b; end$$;
-- The trigger sees the signed-in person even inside a definer function (the claims are still set).
select pg_temp.claim(1);
select pg_temp.denied(format($q$select pg_temp.add_block(%L::uuid,70)$q$,current_setting('dac.foreign')),'23514','a block cannot point at another course''s file (definer path)');
select pg_temp.denied(format($q$select pg_temp.add_block(%L::uuid,71)$q$,current_setting('dac.unscoped')),'23514','a block cannot point at a file nobody uploaded for this course');
select pg_temp.denied(format($q$insert into public.lesson_blocks(lesson_id,block_type,position,media_asset_id) values('50000000-0000-0000-0000-000000000001','pdf',72,%L::uuid)$q$,current_setting('dac.foreign')),'23514','a block cannot point at another course''s file (owner role, trigger only)');
select pg_temp.ok(pg_temp.add_block(current_setting('dac.mine')::uuid,73) is not null,'a block can point at a file uploaded for this course');
select pg_temp.ok(exists(select 1 from public.lesson_blocks where lesson_id='50000000-0000-0000-0000-000000000001' and position=73 and media_asset_id=current_setting('dac.mine')::uuid),'and it is stored');
select pg_temp.ok(not exists(select 1 from public.lesson_blocks where media_asset_id in (current_setting('dac.foreign')::uuid,current_setting('dac.unscoped')::uuid)),'the refused blocks were not stored');
-- With no signed-in person (a migration or seed) the rule is unchanged: ready is still required, ownership is not asked.
select set_config('dac.free',gen_random_uuid()::text,true);
insert into public.media_assets(id,organization_id,uploaded_by,kind,mime_type,original_filename,bucket,object_path,status,size_bytes) values(current_setting('dac.free')::uuid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pdf','application/pdf','Free.pdf','lms-course-media','20000000-0000-0000-0000-000000000001/'||current_setting('dac.free')||'/free.pdf','ready',100);
select set_config('request.jwt.claims','',true);
select pg_temp.ok(pg_temp.add_block(current_setting('dac.free')::uuid,74) is not null,'a trusted path with no signed-in caller still works (no scope asked)');

-- ===== 5. A1-02: no direct write on spaces and staff (the owner included); the owner-only rename still works =====
set local role authenticated;
select pg_temp.claim(1);
select pg_temp.denied($q$update public.organizations set name='Direct rename' where id='20000000-0000-0000-0000-000000000001'$q$,'42501','the space owner cannot rename directly');
select pg_temp.denied($q$insert into public.organization_memberships(organization_id,user_id,role,status) values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','owner','active')$q$,'42501','nobody can add staff directly');
select pg_temp.denied($q$update public.organization_memberships set role='owner' where organization_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000004'$q$,'42501','nobody can change a staff role directly');
select pg_temp.denied($q$update public.organization_memberships set status='suspended' where organization_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000004'$q$,'42501','nobody can suspend staff directly');
select pg_temp.denied($q$delete from public.organization_memberships where organization_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000004'$q$,'42501','nobody can remove staff directly');
select pg_temp.ok((public.rename_my_teaching_space('20000000-0000-0000-0000-000000000001','Renamed through the function')->>'name')='Renamed through the function','the owner-only rename function still works');
select pg_temp.claim(2);
select pg_temp.denied($q$select public.rename_my_teaching_space('20000000-0000-0000-0000-000000000001','Not the owner')$q$,'42501','a teacher cannot rename the space');

-- ===== 6. A1-04: display names =====
select pg_temp.claim(5);
select pg_temp.denied($q$update public.profiles set display_name='Direct' where id='10000000-0000-0000-0000-000000000005'$q$,'42501','a direct profile update is closed');
select pg_temp.denied($q$update public.profiles set status='active' where id='10000000-0000-0000-0000-000000000005'$q$,'42501','a direct profile status update is closed');
select pg_temp.denied($q$update public.profiles set phone='1' where id='10000000-0000-0000-0000-000000000005'$q$,'42501','a direct profile phone update is closed');
select pg_temp.denied($q$select public.account_profile('save',0,jsonb_build_object('firstName',repeat('x',1000000),'lastName','Learner'))$q$,'23514','a 1,000,000-character name is refused through account_profile');
select pg_temp.denied($q$select public.account_profile('save',0,jsonb_build_object('firstName','Abc'||U&'\202E'||'def','lastName','Learner'))$q$,'23514','a right-to-left override in the first name is refused through account_profile');
select pg_temp.denied($q$select public.account_profile('save',0,jsonb_build_object('firstName','Abc','lastName','Lea'||U&'\2067'||'rner'))$q$,'23514','a bidirectional isolate in the last name is refused through account_profile');
select pg_temp.ok((public.account_profile('save',0,'{"firstName":"Synthetic","lastName":"Learner"}')->>'first_name')='Synthetic','a plain name is saved');
select pg_temp.ok((select display_name='Synthetic Learner' from public.profiles where id='10000000-0000-0000-0000-000000000005'),'and reaches the profile display name');
select pg_temp.ok((public.account_profile('save',1,jsonb_build_object('firstName',repeat('x',60),'lastName',repeat('y',60)))->>'revision')::int=2,'the longest name the account screen allows (60 + 1 + 60) is accepted');
reset role;
select pg_temp.denied($q$update public.profiles set display_name='' where id='10000000-0000-0000-0000-000000000005'$q$,'23514','an empty display name is refused by the database');
select pg_temp.denied($q$update public.profiles set display_name='   ' where id='10000000-0000-0000-0000-000000000005'$q$,'23514','a blank display name is refused by the database');
select pg_temp.denied($q$update public.profiles set display_name=repeat('x',129) where id='10000000-0000-0000-0000-000000000005'$q$,'23514','a 129-character display name is refused by the database');
select pg_temp.denied(format($q$update public.profiles set display_name=%L where id='10000000-0000-0000-0000-000000000005'$q$,'A'||chr(0+8)||'B'),'23514','a control character is refused by the database');
select pg_temp.denied(format($q$update public.profiles set display_name=%L where id='10000000-0000-0000-0000-000000000005'$q$,'A'||U&'\202E'||'B'),'23514','U+202E is refused by the database');
select pg_temp.denied(format($q$update public.profiles set display_name=%L where id='10000000-0000-0000-0000-000000000005'$q$,'A'||U&'\2066'||'B'),'23514','U+2066 is refused by the database');
select pg_temp.denied(format($q$update public.profiles set display_name=%L where id='10000000-0000-0000-0000-000000000005'$q$,'A'||U&'\202A'||'B'),'23514','U+202A is refused by the database');
select pg_temp.denied(format($q$update public.profiles set display_name=%L where id='10000000-0000-0000-0000-000000000005'$q$,'A'||U&'\2069'||'B'),'23514','U+2069 is refused by the database');
update public.profiles set display_name='Plain Name' where id='10000000-0000-0000-0000-000000000005';
select pg_temp.ok((select display_name='Plain Name' from public.profiles where id='10000000-0000-0000-0000-000000000005'),'a valid name passes the guard');
update public.profiles set status=status where id='10000000-0000-0000-0000-000000000005';
select pg_temp.ok(true,'an update that does not touch the name never trips the guard');
-- A new profile (sign-in provisioning) never fails on an odd name: it gets a cleaned one.
insert into public.profiles(id,display_name) values('f0000000-0000-0000-0000-000000000001','  '||U&'\202E'||'Odd'||chr(7)||'Name  ');
select pg_temp.ok((select display_name='Odd Name' from public.profiles where id='f0000000-0000-0000-0000-000000000001'),'a new profile with an odd name is cleaned, not refused');
insert into public.profiles(id,display_name) values('f0000000-0000-0000-0000-000000000002',repeat('z',500));
select pg_temp.ok((select length(display_name)=128 from public.profiles where id='f0000000-0000-0000-0000-000000000002'),'a new profile with a 500-character name is cut to 128');
insert into public.profiles(id,display_name) values('f0000000-0000-0000-0000-000000000003',null);
select pg_temp.ok((select display_name is null from public.profiles where id='f0000000-0000-0000-0000-000000000003'),'a new profile with no name stays null');

-- ===== 7. A3-01: enrollments, runs and run staff =====
-- Enrollment 1 is the student's own in run 1; enrollment writes were the mass-suspend and enroll-by-id holes.
set local role authenticated;
select pg_temp.claim(1);
select pg_temp.denied($q$insert into public.enrollments(offering_id,user_id,status) values('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','active')$q$,'42501','a teacher cannot enroll a person by id directly');
select pg_temp.denied($q$update public.enrollments set status='suspended' where offering_id='60000000-0000-0000-0000-000000000001'$q$,'42501','a teacher cannot suspend a whole run directly');
select pg_temp.denied($q$update public.enrollments set status='archived'$q$,'42501','a teacher cannot archive enrollments directly');
select pg_temp.denied($q$insert into public.course_offerings(course_id,name,delivery_mode,status) values('30000000-0000-0000-0000-000000000001','Direct run','scheduled','active')$q$,'42501','a teacher cannot add a run directly');
select pg_temp.denied($q$update public.course_offerings set status='archived' where id='60000000-0000-0000-0000-000000000001'$q$,'42501','a teacher cannot archive a run directly');
select pg_temp.denied($q$insert into public.offering_staff(offering_id,user_id,role) values('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','instructor')$q$,'42501','nobody can add run staff directly');
select pg_temp.denied($q$delete from public.offering_staff where offering_id='60000000-0000-0000-0000-000000000001'$q$,'42501','nobody can remove run staff directly');
select pg_temp.claim(5);
select pg_temp.ok((select count(*)=1 from public.enrollments),'a student still reads their own enrollment');
select pg_temp.denied($q$update public.enrollments set status='active' where user_id=auth.uid()$q$,'42501','a student cannot update their own enrollment');

-- ===== 8. A3-06: the course's current run; one call makes it, the next returns it =====
select pg_temp.claim(1);
select set_config('dac.course',public.create_teacher_course('20000000-0000-0000-0000-000000000001','Run test course','run-test-course')::text,true);
select pg_temp.ok(not exists(select 1 from public.course_offerings where course_id=current_setting('dac.course')::uuid),'a new course has no run');
select set_config('dac.run',public.course_run(current_setting('dac.course')::uuid)::text,true);
select pg_temp.ok(public.course_run(current_setting('dac.course')::uuid)=current_setting('dac.run')::uuid,'the second call returns the same run');
select pg_temp.ok((select count(*)=1 from public.course_offerings where course_id=current_setting('dac.course')::uuid),'two calls made one run');
select pg_temp.claim(5);
select pg_temp.denied(format($q$select public.course_run(%L::uuid)$q$,current_setting('dac.course')),'42501','a student cannot get a run for a course they cannot see');
select pg_temp.claim(1);
-- An existing run is returned to the people who may support it, and the old run order (latest start, then id) is kept.
select pg_temp.ok(public.course_run('30000000-0000-0000-0000-000000000001')='60000000-0000-0000-0000-000000000001','the existing run of the seeded course is returned');
select pg_temp.claim(2);
reset role;

-- ===== 9. A6b-01 and A6a-14: storage. Nothing uploads to lms-submissions; course media still works through its function =====
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000099/old.pdf','10000000-0000-0000-0000-000000000005','{"size":20,"mimetype":"application/pdf"}');
set local role authenticated;
select pg_temp.claim(5);
select pg_temp.denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000098/new.pdf',auth.jwt()->>'sub','{"size":20,"mimetype":"application/pdf"}')$q$,'42501','a student cannot upload to lms-submissions');
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='lms-submissions'),'nobody sees an lms-submissions object any more');
select pg_temp.ok(not private.can_download_media('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000099/old.pdf'),'and nothing is downloadable from it');
select pg_temp.denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-course-media','20000000-0000-0000-0000-000000000001/'||gen_random_uuid()||'/unregistered.png',auth.jwt()->>'sub','{"size":20,"mimetype":"image/png"}')$q$,'42501','an unregistered upload to course media is refused');
select pg_temp.denied($q$select public.register_lesson_upload('30000000-0000-0000-0000-000000000001','image/png','Student.png')$q$,'42501','a student cannot register a lesson upload');
select pg_temp.claim(1);
select set_config('dac.upload',public.register_lesson_upload('30000000-0000-0000-0000-000000000001','image/png','Thumbnail.png')::text,true);
select pg_temp.ok(private.can_upload_media('lms-course-media',current_setting('dac.upload')::jsonb->>'path'),'a teacher registers a lesson upload through the function');
insert into storage.objects(bucket_id,name,owner_id,metadata) values('lms-course-media',current_setting('dac.upload')::jsonb->>'path',auth.jwt()->>'sub','{"size":100,"mimetype":"image/png"}');
select public.complete_media_upload((current_setting('dac.upload')::jsonb->>'id')::uuid);
select pg_temp.ok((select status='ready' from public.media_assets where id=(current_setting('dac.upload')::jsonb->>'id')::uuid),'the upload completes: registered upload, storage insert and completion still work');
select pg_temp.denied($q$insert into public.media_assets(id,organization_id,uploaded_by,kind,mime_type,original_filename,bucket,object_path) values(gen_random_uuid(),'20000000-0000-0000-0000-000000000001',auth.uid(),'image','image/png','x.png','lms-course-media','20000000-0000-0000-0000-000000000001/x/x.png')$q$,'42501','a direct media_assets insert is closed');
select pg_temp.denied($q$insert into public.media_assets(id,organization_id,uploaded_by,kind,mime_type,original_filename,bucket,object_path) values(gen_random_uuid(),'20000000-0000-0000-0000-000000000001',auth.uid(),'submission','application/pdf','x.pdf','lms-submissions','20000000-0000-0000-0000-000000000001/x/x.pdf')$q$,'42501','a direct lms-submissions registration is closed');

-- ===== 10. A4-02 and A5-01: the eleven tables are closed for reading; the app still gets this data through its functions =====
select pg_temp.claim(2);
select pg_temp.denied($q$select count(*) from public.study_groups$q$,'42501','study_groups cannot be read directly');
select pg_temp.denied($q$select count(*) from public.group_staff$q$,'42501','group_staff cannot be read directly');
select pg_temp.denied($q$select count(*) from public.group_memberships$q$,'42501','group_memberships cannot be read directly');
select pg_temp.denied($q$select count(*) from public.group_schedules$q$,'42501','group_schedules cannot be read directly');
select pg_temp.denied($q$select count(*) from public.group_sessions$q$,'42501','group_sessions cannot be read directly');
select pg_temp.denied($q$select count(*) from public.session_attendance$q$,'42501','session_attendance cannot be read directly');
select pg_temp.denied($q$select count(*) from public.homework_questions$q$,'42501','homework_questions cannot be read directly');
select pg_temp.denied($q$select count(*) from public.homework_options$q$,'42501','homework_options cannot be read directly');
select pg_temp.denied($q$select count(*) from public.homework_submissions$q$,'42501','homework_submissions cannot be read directly');
select pg_temp.denied($q$select count(*) from public.homework_responses$q$,'42501','homework_responses cannot be read directly');
select pg_temp.denied($q$select count(*) from public.homework_submission_files$q$,'42501','homework_submission_files cannot be read directly');
select pg_temp.claim(5);
select pg_temp.denied($q$select count(*) from public.homework_submissions$q$,'42501','a student cannot read homework_submissions directly either');
reset role;
set local role anon;
select pg_temp.denied($q$select count(*) from public.study_groups$q$,'42501','anonymous cannot read study_groups');
select pg_temp.denied($q$select count(*) from public.homework_submissions$q$,'42501','anonymous cannot read homework_submissions');
reset role;

-- ===== 11. A6b-03, A6b-04, A6b-05: the legacy exam system answers 42501 to every client role =====
set local role authenticated;
select pg_temp.claim(5);
select pg_temp.denied($q$select count(*) from public.assessments$q$,'42501','legacy assessments cannot be read');
select pg_temp.denied($q$select count(*) from public.assessment_attempts$q$,'42501','legacy attempts cannot be read');
select pg_temp.denied($q$select count(*) from public.assessment_responses$q$,'42501','legacy responses cannot be read');
select pg_temp.denied($q$insert into public.assessment_attempts(offering_assessment_id,user_id,attempt_number) values(gen_random_uuid(),auth.uid(),1)$q$,'42501','a legacy attempt cannot be written');
select pg_temp.denied($q$select public.start_assessment_attempt(gen_random_uuid())$q$,'42501','a legacy RPC cannot be called');
select pg_temp.denied($q$select public.get_exam_summaries(array[gen_random_uuid()])$q$,'42501','a legacy read RPC cannot be called');
select pg_temp.claim(1);
select pg_temp.denied($q$select public.get_assessment_answer_keys(gen_random_uuid())$q$,'42501','legacy answer keys cannot be read by a teacher');
select pg_temp.denied($q$select count(*) from public.assessment_questions$q$,'42501','legacy questions cannot be read by a teacher');
reset role;
-- Closing the legacy tables must not break the clean-up view or the new exams' own functions.
select pg_temp.ok((select count(*)>=0 from private.expired_media_uploads),'the expired-upload clean-up view still works (it reads through a definer helper)');
select pg_temp.ok(not has_function_privilege('authenticated','private.assessment_response_uses_media(uuid)','EXECUTE'),'the helper behind the view is not callable by the browser role');

-- ===== 12. Safety: nothing that other tables or views need was closed under them =====
-- Functions the app calls as the signed-in person still read the revoked tables (they are definer functions); a sample of them.
set local role authenticated;
select pg_temp.claim(2);
select pg_temp.claim(1);
select pg_temp.ok(jsonb_typeof(public.notification_command('list'))='object','Notifications still answer');
reset role;
select jsonb_build_object('passed',count(*)) as direct_access_closed_tests from dac_results;
rollback;
