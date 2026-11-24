-- Legacy exam completion, grading and release: closed.
-- Track 1 (direct table access closed): the legacy exam system is locked down, not deleted (deletion is Track 10).
-- This suite replaces the old legacy checks. It asserts the new refusal and nothing else; the new exam system is tested by exams, exams-demo and exams-student.
begin;
create temp table completion_checks(name text primary key);
grant select,insert on completion_checks to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.completion_checks values(label); end $$;
create function pg_temp.denied(sql text,code text,label text) returns void language plpgsql as $$ declare caught text; begin begin execute sql; exception when others then get stacked diagnostics caught=returned_sqlstate; end; perform pg_temp.ok(caught=code,label||coalesce(' got '||caught,' no error')); end $$;
create function pg_temp.claim(n integer) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub','10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::text,true) $$;
-- Every legacy RPC: no EXECUTE for the browser, anonymous or service roles (the catalog says so, and a real call is refused).
select pg_temp.ok(not has_function_privilege(r,f,'EXECUTE'),f||' is closed to '||r) from unnest(array['authenticated','anon','service_role']) r, unnest(array['public.clone_assessment(uuid,text)','public.decide_exam_retry(uuid,text,bigint)','public.finalize_assessment_grade(uuid)','public.get_assessment_answer_keys(uuid)','public.get_assessment_results(uuid)','public.get_exam_attempt_content(uuid)','public.get_exam_definition(uuid)','public.get_exam_definition_v2(uuid)','public.get_exam_grade_changes(uuid)','public.get_exam_grading_detail(uuid)','public.get_exam_review(uuid)','public.get_exam_submission_page(uuid,uuid,integer)','public.get_exam_summaries(uuid[])','public.grade_assessment_response(uuid,numeric,text)','public.grade_exam_paper(uuid,bigint,jsonb,text,text,uuid)','public.release_exam_result(uuid,uuid,bigint)','public.release_exam_review(uuid,uuid,bigint)','public.save_assessment_response(uuid,uuid,jsonb,uuid)','public.save_exam_answers(uuid,bigint,jsonb)','public.save_exam_response(uuid,uuid,jsonb,uuid,bigint)','public.set_assessment_answer_key(uuid,jsonb)','public.start_assessment_attempt(uuid)','public.submit_assessment_attempt(uuid)','public.sync_exam_participation(uuid)']) f;
-- Every legacy table: no privilege of any kind for those roles.
select pg_temp.ok(not has_table_privilege(r,t,p),t||' has no '||p||' for '||r)
 from unnest(array['authenticated','anon','service_role']) r, unnest(array['public.assessments','public.offering_assessments','public.assessment_questions','public.assessment_options','public.assessment_attempts','public.assessment_responses']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
set local role authenticated;
select pg_temp.claim(5);
select pg_temp.denied($q$select public.start_assessment_attempt(gen_random_uuid())$q$,'42501','Student: legacy start refused');
select pg_temp.denied($q$select public.save_assessment_response(gen_random_uuid(),gen_random_uuid(),'{}'::jsonb,null)$q$,'42501','Student: legacy answer save refused');
select pg_temp.denied($q$select public.submit_assessment_attempt(gen_random_uuid())$q$,'42501','Student: legacy submit refused');
select pg_temp.denied($q$select public.get_assessment_results(gen_random_uuid())$q$,'42501','Student: legacy results refused');
select pg_temp.denied($q$select public.sync_exam_participation(gen_random_uuid())$q$,'42501','Student: legacy sync refused');
select pg_temp.denied($q$select public.save_exam_answers(gen_random_uuid(),0,'{}'::jsonb)$q$,'42501','Student: legacy answers v2 refused');
select pg_temp.denied($q$select public.get_exam_attempt_content(gen_random_uuid())$q$,'42501','Student: legacy attempt content refused');
select pg_temp.denied($q$select * from public.assessment_attempts$q$,'42501','Student: legacy attempt read refused');
select pg_temp.denied($q$select * from public.assessment_responses$q$,'42501','Student: legacy response read refused');
select pg_temp.denied($q$insert into public.assessments(course_id,title,type) values(gen_random_uuid(),'x','quiz')$q$,'42501','Student: legacy assessment insert refused');
select pg_temp.claim(1);
select pg_temp.denied($q$select public.set_assessment_answer_key(gen_random_uuid(),'{}'::jsonb)$q$,'42501','Teacher: legacy answer key refused');
select pg_temp.denied($q$select public.get_assessment_answer_keys(gen_random_uuid())$q$,'42501','Teacher: legacy answer key read refused');
select pg_temp.denied($q$select public.grade_assessment_response(gen_random_uuid(),1,null)$q$,'42501','Teacher: legacy grade refused');
select pg_temp.denied($q$select public.finalize_assessment_grade(gen_random_uuid())$q$,'42501','Teacher: legacy finalize refused');
select pg_temp.denied($q$select public.get_exam_definition(gen_random_uuid())$q$,'42501','Teacher: legacy definition read refused');
select pg_temp.denied($q$select public.get_exam_definition_v2(gen_random_uuid())$q$,'42501','Teacher: legacy definition v2 read refused');
select pg_temp.denied($q$select public.release_exam_result(gen_random_uuid(),gen_random_uuid(),0)$q$,'42501','Teacher: legacy release refused');
select pg_temp.denied($q$select public.clone_assessment(gen_random_uuid(),null)$q$,'42501','Teacher: legacy clone refused');
reset role;
select jsonb_build_object('legacy_exam_completion_closed',(select count(*) from completion_checks)) as legacy_exam_completion_closed;
rollback;
