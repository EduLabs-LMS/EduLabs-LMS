-- Run against a seeded DEVELOPMENT database as postgres. Every change rolls back.
-- Uses actual anon/authenticated roles and auth.uid JWT claims, not mocked policies.
begin;
create temp table test_results(name text primary key,passed boolean not null);
grant select,insert on test_results to authenticated,anon;
create function pg_temp.assert_true(value boolean,name text) returns void language plpgsql set search_path = '' as $$
begin
 if value is distinct from true then raise exception 'FAILED: %',name; end if;
 insert into pg_temp.test_results values(name,true);
end $$;
create function pg_temp.expect_error(statement text,state text,name text) returns void language plpgsql set search_path = '' as $$
declare caught text;
begin
 begin execute statement;
 exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from state then raise exception 'FAILED: %, expected %, got %',name,state,caught; end if;
 insert into pg_temp.test_results values(name,true);
end $$;

select pg_temp.assert_true((select count(*)>=19 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),'foundation and additive public tables have RLS');
select pg_temp.assert_true((select count(*)=7 from public.profiles where id between '10000000-0000-0000-0000-000000000001'::uuid and '10000000-0000-0000-0000-000000000007'::uuid),'auth trigger created all seed profiles');
select pg_temp.assert_true(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role'),'no global user role');
select pg_temp.assert_true(not exists(select 1 from storage.buckets where id in ('lms-course-media','lms-submissions') and public),'buckets are private');
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prosecdef and not coalesce(p.proconfig,array[]::text[]) @> array['search_path=""']),'definer functions have fixed empty search path');

-- Another student's records exist, so isolation assertions are non-vacuous.
set local role authenticated;
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}',true);

select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=1 from public.courses),'student sees only enrolled course');
select pg_temp.assert_true((select count(*)=1 from public.course_offerings),'student cannot see sibling cohort');
select pg_temp.assert_true((select count(*)=1 from public.lessons),'student cannot see draft/other tenant lessons');
select pg_temp.assert_true((select count(*)=1 from public.enrollments),'student cannot read peer enrollment');
select pg_temp.assert_true((select count(*)=1 from public.profiles),'student cannot read peer profile/phone');
select pg_temp.assert_true((select count(*)=0 from public.lesson_progress),'student cannot read peer progress');
select pg_temp.expect_error('select count(*) from public.assessment_attempts','42501','legacy attempts are closed to clients');
select pg_temp.expect_error('select count(*) from public.assessment_responses','42501','legacy responses are closed to clients');
select pg_temp.expect_error('select count(*) from public.assessment_options','42501','legacy options are closed to clients');
select pg_temp.expect_error('select is_correct from public.assessment_options','42501','student cannot select correctness');
select pg_temp.expect_error('select * from public.assessment_options','42501','wildcard cannot expose answer keys');
select pg_temp.expect_error('select * from private.assessment_answer_keys','42501','private grading data is inaccessible');
select pg_temp.expect_error($sql$select public.get_assessment_answer_keys('70000000-0000-0000-0000-000000000001')$sql$,'42501','answer key RPC denies student');
select pg_temp.expect_error($sql$update public.profiles set status='active'$sql$,'42501','student cannot change account status');
select pg_temp.expect_error($sql$insert into public.course_modules(course_id,title,position) values('30000000-0000-0000-0000-000000000001','attack',9)$sql$,'42501','student cannot insert teacher content');
select pg_temp.expect_error($sql$update public.lessons set title='attack'$sql$,'42501','student cannot update teacher content');
select pg_temp.expect_error($sql$insert into public.enrollments(offering_id,user_id,status) values('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000005','active')$sql$,'42501','student cannot self enroll');
select pg_temp.expect_error($sql$insert into public.lesson_progress(offering_id,lesson_id,user_id) values('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006')$sql$,'42501','student cannot write peer progress');
select pg_temp.expect_error($sql$insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at) values('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','in_progress',now())$sql$,'42501','a direct progress insert is closed (progress is saved by save_segment_progress)');
select pg_temp.expect_error($sql$update public.lesson_progress set status='completed',completed_at=now() where user_id=auth.uid()$sql$,'42501','a student cannot mark a lesson completed directly');
-- Track 1: every legacy exam RPC refuses a signed-in client, so nothing below can start, answer, grade or read a legacy attempt.
select pg_temp.expect_error($sql$select public.start_assessment_attempt('a0000000-0000-0000-0000-000000000001')$sql$,'42501','legacy start is closed');
select pg_temp.expect_error($sql$select public.save_assessment_response(gen_random_uuid(),gen_random_uuid(),'{}'::jsonb)$sql$,'42501','legacy answer save is closed');
select pg_temp.expect_error($sql$select public.submit_assessment_attempt(gen_random_uuid())$sql$,'42501','legacy submit is closed');
select pg_temp.expect_error($sql$select public.get_assessment_results(gen_random_uuid())$sql$,'42501','legacy results are closed');
select pg_temp.expect_error($sql$select public.grade_assessment_response(gen_random_uuid(),2)$sql$,'42501','legacy grader is closed');
select pg_temp.expect_error($sql$insert into public.assessment_attempts(offering_assessment_id,user_id,attempt_number) values('a0000000-0000-0000-0000-000000000001',auth.uid(),99)$sql$,'42501','legacy attempt insert is closed');
select pg_temp.expect_error($sql$update public.assessment_attempts set score=999,status='graded'$sql$,'42501','legacy attempt update is closed');
-- Managed provisioning: a student cannot bootstrap a tenant through either layer.
select pg_temp.expect_error($sql$select public.create_organization('Temporary test tenant','temporary-rls-test')$sql$,'42501','student cannot create organization through public RPC');
select pg_temp.expect_error($sql$select private.create_organization('Temporary test tenant','temporary-rls-test')$sql$,'42501','student cannot invoke private organization creator');

-- Organization A owner has no role in B.
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.courses where organization_id='20000000-0000-0000-0000-000000000002'),'teacher A cannot read private tenant B course');
select pg_temp.assert_true((select count(*)=0 from public.enrollments where offering_id='60000000-0000-0000-0000-000000000003'),'teacher A cannot read tenant B roster');
select pg_temp.assert_true((select count(*)=0 from public.profiles where id='10000000-0000-0000-0000-000000000007'),'teacher A cannot read tenant B student');
select pg_temp.expect_error($sql$insert into public.course_modules(course_id,title,position) values('30000000-0000-0000-0000-000000000002','attack',8)$sql$,'42501','teacher A cannot write tenant B course');
select pg_temp.expect_error($sql$update public.organization_memberships set status='suspended' where user_id=auth.uid()$sql$,'42501','a direct membership change is closed, even for the last owner (the last-owner trigger is tested in organization-owner-cascade)');
select pg_temp.expect_error($sql$update public.assessment_questions set prompt='changed' where id='80000000-0000-0000-0000-000000000001'$sql$,'42501','attempted assessment questions freeze');
select pg_temp.expect_error($sql$update public.assessment_options set is_correct=false where id='90000000-0000-0000-0000-000000000001'$sql$,'42501','attempted assessment answer keys freeze');
select pg_temp.expect_error($sql$update public.assessments set instructions='changed' where id='70000000-0000-0000-0000-000000000001'$sql$,'42501','attempted assessment metadata freezes');
select pg_temp.expect_error($sql$update public.offering_assessments set max_attempts=99 where id='a0000000-0000-0000-0000-000000000001'$sql$,'42501','attempted assessment delivery config freezes');
select pg_temp.expect_error($sql$select public.clone_assessment('70000000-0000-0000-0000-000000000001')$sql$,'42501','legacy clone is closed');

-- Assigned instructor also has an independent admin role in organization B.
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true(private.has_org_role('20000000-0000-0000-0000-000000000001',array['teacher']) and private.has_org_role('20000000-0000-0000-0000-000000000002',array['admin']),'different tenant roles work');
select pg_temp.assert_true((select count(*)=3 from public.enrollments),'instructor and admin can see authorized rosters');
select public.course_update('30000000-0000-0000-0000-000000000002',(select updated_at from public.courses where id='30000000-0000-0000-0000-000000000002'),'{"title":"Admin updated title"}');
select pg_temp.assert_true((select title='Admin updated title' from public.courses where id='30000000-0000-0000-0000-000000000002'),'tenant admin can manage course');
select pg_temp.expect_error($sql$select public.get_assessment_answer_keys('70000000-0000-0000-0000-000000000001')$sql$,'42501','legacy grading keys are closed, even for an assigned instructor');
select pg_temp.expect_error($sql$select public.finalize_assessment_grade(gen_random_uuid())$sql$,'42501','legacy grade finalization is closed');

select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select pg_temp.assert_true(private.can_edit_course('30000000-0000-0000-0000-000000000001'),'assigned editor can author course');
select pg_temp.assert_true(private.can_support_offering('60000000-0000-0000-0000-000000000001') and not private.can_support_offering('60000000-0000-0000-0000-000000000002'),'teaching assistant roster scope is assigned offering');
select pg_temp.assert_true(not private.can_manage_offering('60000000-0000-0000-0000-000000000001'),'teaching assistant cannot manage offering/enrollment');

select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select pg_temp.expect_error('select awarded_points,feedback from public.assessment_responses','42501','direct grade fields require results RPC');

-- Submission uploads require tenant/owner/enrollment-bound metadata.
select pg_temp.expect_error($sql$insert into public.media_assets(id,organization_id,uploaded_by,offering_id,kind,mime_type,original_filename,bucket,object_path)
values('b0000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',auth.uid(),'60000000-0000-0000-0000-000000000001','submission','application/pdf','homework.pdf','lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/homework.pdf')$sql$,'42501','a student cannot register a legacy submission upload (the lms-submissions path is closed)');
select pg_temp.assert_true(not private.can_upload_media('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/homework.pdf'),'nothing is registered, so nothing can be uploaded');
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.media_assets),'student cannot read peer submission assets');
select pg_temp.assert_true(not private.can_upload_media('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/homework.pdf'),'student cannot upload over peer metadata');

reset role;
update public.enrollments set status='suspended' where offering_id='60000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.courses),'suspended enrollment cannot access private content');
select pg_temp.assert_true(not private.can_upload_media('lms-submissions','20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000001/homework.pdf'),'suspended enrollment cannot upload');
reset role;
update public.organization_memberships set status='suspended' where organization_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"iss":"https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1","aud":"authenticated","sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.courses where organization_id='20000000-0000-0000-0000-000000000001'),'suspended staff membership revokes assigned course access');
select pg_temp.assert_true(private.has_org_role('20000000-0000-0000-0000-000000000002',array['admin']),'suspension in A preserves independent role in B');
select pg_temp.expect_error($sql$select public.get_assessment_answer_keys('70000000-0000-0000-0000-000000000001')$sql$,'42501','suspended course staff loses grading keys');

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.expect_error('select * from public.courses','42501','anonymous cannot read private catalog');
select pg_temp.expect_error('select * from public.profiles','42501','anonymous cannot read profiles');
select pg_temp.expect_error($sql$select public.create_organization('attack','attack')$sql$,'42501','anonymous cannot invoke write RPC');
reset role;
select jsonb_build_object('passed',count(*),'failed',0,'checks',jsonb_agg(name order by name)) as authorization_test_results from test_results;
rollback;
