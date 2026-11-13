-- Synthetic rollback suite. No Storage writes or customer records. Migration 20.
begin;
create temp table completion_checks(name text primary key);
grant select,insert on completion_checks to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'FAILED %',label; end if; insert into pg_temp.completion_checks values(label); end $$;
create function pg_temp.denied(sql text,code text,label text) returns void language plpgsql as $$ declare caught text; begin begin execute sql; exception when others then get stacked diagnostics caught=returned_sqlstate; end; perform pg_temp.ok(caught=code,label||coalesce(' got '||caught,' no error')); end $$;
create function pg_temp.claim(n integer) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub','10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::text,true) $$;
create function pg_temp.definition() returns jsonb language sql as $$ select '{"title":"Synthetic complete exam","description":null,"durationMinutes":null,"maxAttempts":2,"isPublished":true,"questions":[
 {"type":"MCQ","questionType":"single_choice","text":"Single","imageUrl":null,"choices":["Correct","Wrong"],"correctChoice":0,"points":2},
 {"type":"MCQ","questionType":"multiple_choice","text":"Multiple","imageUrl":null,"choices":["A","B","C"],"correctChoice":0,"correctChoices":[0,2],"points":3},
 {"type":"MCQ","questionType":"true_false","text":"True false","imageUrl":null,"choices":["True","False"],"correctChoice":0,"points":2},
 {"type":"WRITTEN","questionType":"numeric","text":"Numeric","imageUrl":null,"choices":null,"correctChoice":null,"numericValue":12.5,"numericTolerance":0.1,"points":3},
 {"type":"WRITTEN","questionType":"short_text","text":"Short","imageUrl":null,"choices":null,"correctChoice":null,"points":2},
 {"type":"WRITTEN","questionType":"essay","text":"Essay","imageUrl":null,"choices":null,"correctChoice":null,"points":4},
 {"type":"WRITTEN","questionType":"file_upload","text":"Photo","imageUrl":null,"choices":null,"correctChoice":null,"points":4}]}'::jsonb $$;
-- The legacy builder's save and clone are closed to clients (20261114120000_exams.sql, owner's answer 2). These wrappers run the same definers
-- as the owner with the caller's claims, so the fixtures still build legacy papers and every authorization check inside still applies.
create function pg_temp.legacy_save(p_offering uuid,p_schedule uuid,p_at timestamptz,p_def jsonb) returns uuid language sql security definer set search_path='' as $$select private.save_exam_definition(p_offering,p_schedule,p_at,p_def)$$;
create function pg_temp.legacy_save_v2(p_offering uuid,p_schedule uuid,p_at timestamptz,p_def jsonb) returns uuid language sql security definer set search_path='' as $$select private.save_exam_definition_v2(p_offering,p_schedule,p_at,p_def)$$;
create function pg_temp.legacy_clone(p_schedule uuid) returns uuid language sql security definer set search_path='' as $$select private.clone_exam_schedule(p_schedule)$$;
set local role anon;
select pg_temp.denied($q$select pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,pg_temp.definition())$q$,'42501','Anonymous advanced authoring denied');
select pg_temp.denied($q$select public.grade_exam_paper(gen_random_uuid(),0,'{}','',null,gen_random_uuid())$q$,'42501','Anonymous atomic grading denied');
reset role;select pg_temp.claim(5);set local role authenticated;
select pg_temp.denied($q$select pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,pg_temp.definition())$q$,'42501','Student advanced authoring denied');
select pg_temp.denied($q$select public.get_exam_submission_page('a0000000-0000-0000-0000-000000000001')$q$,'42501','Student cannot paginate submissions');
reset role;select pg_temp.claim(3);set local role authenticated;
select pg_temp.denied($q$select pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,pg_temp.definition())$q$,'42501','Cross tenant authoring denied');
reset role;select pg_temp.claim(2);set local role authenticated;
select pg_temp.denied($q$select public.save_exam_definition_v2('60000000-0000-0000-0000-000000000001',null,null,pg_temp.definition())$q$,'42501','The closed legacy builder refuses the assigned instructor');
select pg_temp.denied($q$select public.clone_exam_schedule(gen_random_uuid())$q$,'42501','The closed legacy clone refuses the assigned instructor');
select set_config('complete.schedule',pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,pg_temp.definition())::text,true);
select pg_temp.ok(jsonb_array_length(public.get_exam_definition_v2(current_setting('complete.schedule')::uuid)->'questions')=7,'Assigned instructor authors all seven formats');
select pg_temp.ok(public.get_exam_definition_v2(current_setting('complete.schedule')::uuid)#>>'{questions,3,numericValue}'='12.5','Numeric key is staff retrievable');
select pg_temp.denied($q$select pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,jsonb_set(pg_temp.definition(),'{questions,1,correctChoices}','[0,0]'))$q$,'23514','Duplicate multiple choice key rejected atomically');
select pg_temp.denied($q$select pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,jsonb_set(pg_temp.definition(),'{questions,3,numericTolerance}','-1'))$q$,'23514','Negative numeric tolerance rejected');
select pg_temp.ok((select count(*)=1 from public.assessments where title='Synthetic complete exam'),'Invalid new definitions leave no records');
reset role;select pg_temp.claim(5);set local role authenticated;
select set_config('complete.a1',public.start_assessment_attempt(current_setting('complete.schedule')::uuid)::text,true);
select pg_temp.denied($q$select public.get_exam_definition_v2(current_setting('complete.schedule')::uuid)$q$,'42501','Student cannot retrieve advanced keys');
select pg_temp.ok(public.get_exam_attempt_content(current_setting('complete.a1')::uuid)::text !~ 'numericValue|numericTolerance|correctChoices|is_correct','Safe content excludes advanced keys');
select set_config('complete.bad_batch',(select jsonb_agg(jsonb_build_object('question_id',q->>'id','response',case when q->>'question_type'='essay' then '{"text":"Atomic batch candidate"}'::jsonb when q->>'question_type'='numeric' then '{"value":"not numeric"}'::jsonb else 'null'::jsonb end,'media_asset_id',null))::text from jsonb_array_elements(public.get_exam_attempt_content(current_setting('complete.a1')::uuid)) q),true);
select pg_temp.denied($q$select public.save_exam_answers(current_setting('complete.a1')::uuid,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint,current_setting('complete.bad_batch')::jsonb)$q$,'23514','Invalid batch rolls back every saved answer');
select pg_temp.ok(not exists(select 1 from public.assessment_responses where attempt_id=current_setting('complete.a1')::uuid),'Failed batch leaves zero partial responses');
do $$ declare q record; ids jsonb; begin
 for q in select * from jsonb_array_elements(public.get_exam_attempt_content(current_setting('complete.a1')::uuid)) loop
  if q.value->>'question_type' in('single_choice','true_false') then
   perform public.save_exam_response(current_setting('complete.a1')::uuid,(q.value->>'id')::uuid,jsonb_build_object('option_ids',jsonb_build_array(q.value#>>'{options,0,id}')),null,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
  elsif q.value->>'question_type'='multiple_choice' then
   perform public.save_exam_response(current_setting('complete.a1')::uuid,(q.value->>'id')::uuid,jsonb_build_object('option_ids',jsonb_build_array(q.value#>>'{options,0,id}',q.value#>>'{options,2,id}')),null,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
  elsif q.value->>'question_type'='numeric' then
   perform public.save_exam_response(current_setting('complete.a1')::uuid,(q.value->>'id')::uuid,'{"value":9}',null,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
  elsif q.value->>'question_type'='essay' then
   perform public.save_exam_response(current_setting('complete.a1')::uuid,(q.value->>'id')::uuid,'{"text":"Original first essay"}',null,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
  end if;
 end loop;
end $$;
select set_config('complete.batch',(select jsonb_agg(jsonb_build_object('question_id',q->>'id','response',q->'response','media_asset_id',q->'media_asset_id'))::text from jsonb_array_elements(public.get_exam_attempt_content(current_setting('complete.a1')::uuid)) q),true);
select pg_temp.ok((public.save_exam_answers(current_setting('complete.a1')::uuid,0,current_setting('complete.batch')::jsonb)->>'revision')::bigint=(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint,'Identical stale complete snapshot is idempotent');
select set_config('complete.stale_changed',(select jsonb_agg(case when q->'response'->>'text'='Original first essay' then jsonb_set(q,'{response}','{"text":"Changed stale essay"}') else q end)::text from jsonb_array_elements(current_setting('complete.batch')::jsonb) q),true);
select pg_temp.denied($q$select public.save_exam_answers(current_setting('complete.a1')::uuid,0,current_setting('complete.stale_changed')::jsonb)$q$,'PT409','An unchanged first answer cannot launder a stale changed batch');
select public.submit_assessment_attempt(current_setting('complete.a1')::uuid);
select pg_temp.ok(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'attempts_state'='retry_decision_pending','Wrong numeric answer enables opaque retry');
select pg_temp.denied($q$select public.start_assessment_attempt(current_setting('complete.schedule')::uuid)$q$,'42501','Direct retry bypass denied for all format paper');
select public.decide_exam_retry(current_setting('complete.schedule')::uuid,'accept',(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
select set_config('complete.a2',public.start_assessment_attempt(current_setting('complete.schedule')::uuid)::text,true);
select pg_temp.ok(not exists(select 1 from public.assessment_responses where attempt_id=current_setting('complete.a2')::uuid),'Retry starts with all answers blank');
select public.save_exam_response(current_setting('complete.a2')::uuid,(select (q->>'id')::uuid from jsonb_array_elements(public.get_exam_attempt_content(current_setting('complete.a2')::uuid)) q where q->>'question_type'='essay'),'{"text":"Original second essay"}',null,(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'revision')::bigint);
select public.submit_assessment_attempt(current_setting('complete.a2')::uuid);
select pg_temp.ok(public.sync_exam_participation(current_setting('complete.schedule')::uuid)->>'grading_state'='pending','Written response keeps final paper under correction');
select pg_temp.denied($q$select public.get_assessment_results(current_setting('complete.a2')::uuid)$q$,'42501','Unreleased final total denied');
select pg_temp.denied($q$select public.get_exam_grade_changes(current_setting('complete.a2')::uuid)$q$,'42501','Unreleased grading history denied');
select pg_temp.denied($q$select public.grade_exam_paper(current_setting('complete.a2')::uuid,0,'{}','',null,gen_random_uuid())$q$,'42501','Student cannot grade or correct');
reset role;select pg_temp.claim(3);set local role authenticated;
select pg_temp.denied($q$select public.grade_exam_paper(current_setting('complete.a2')::uuid,0,'{}','',null,gen_random_uuid())$q$,'42501','Other tenant owner cannot grade');
select pg_temp.denied($q$select pg_temp.legacy_clone(current_setting('complete.schedule')::uuid)$q$,'42501','Cross tenant clone denied');
reset role;
select set_config('complete.scores',(select jsonb_object_agg(q.id::text,case when q.question_type='essay' then 3 else 0 end)::text from public.assessment_questions q join public.offering_assessments s on s.assessment_id=q.assessment_id where s.id=current_setting('complete.schedule')::uuid and q.question_type in('short_text','essay','file_upload')),true);
select set_config('complete.original_responses',(select jsonb_agg(jsonb_build_object('id',id,'response',response,'media',media_asset_id) order by id)::text from public.assessment_responses where attempt_id in(current_setting('complete.a1')::uuid,current_setting('complete.a2')::uuid)),true);
select pg_temp.claim(2);set local role authenticated;
select pg_temp.denied($q$select public.grade_exam_paper(current_setting('complete.a2')::uuid,0,current_setting('complete.scores')::jsonb,'',null,gen_random_uuid())$q$,'PT409','Atomic grading stale revision denied');
select set_config('complete.grade_request',gen_random_uuid()::text,true);
select public.grade_exam_paper(current_setting('complete.a2')::uuid,(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,revision}')::bigint,current_setting('complete.scores')::jsonb,'Essay feedback',null,current_setting('complete.grade_request')::uuid);
select pg_temp.ok(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,grading_state}'='complete','Atomic complete marks finalize grading');
select pg_temp.ok(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,result_released}'='false','Manual grading does not release');
select public.grade_exam_paper(current_setting('complete.a2')::uuid,0,current_setting('complete.scores')::jsonb,'Essay feedback',null,current_setting('complete.grade_request')::uuid);
select pg_temp.ok(jsonb_array_length(public.get_exam_grade_changes(current_setting('complete.a2')::uuid))=1,'Lost grading response retry has one audit entry');
select pg_temp.denied($q$select public.grade_exam_paper(current_setting('complete.a2')::uuid,0,current_setting('complete.scores')::jsonb,'Different',null,current_setting('complete.grade_request')::uuid)$q$,'PT409','Reused grading request with changed payload denied');
select public.release_exam_result(current_setting('complete.schedule')::uuid,'10000000-0000-0000-0000-000000000005',(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,revision}')::bigint);
reset role;select pg_temp.claim(5);set local role authenticated;
select pg_temp.ok((public.get_assessment_results(current_setting('complete.a2')::uuid)->>'score')::numeric=3,'Lower second objective score replaces first score');
select pg_temp.ok(jsonb_array_length(public.get_exam_grade_changes(current_setting('complete.a2')::uuid))=1,'Released student sees grading event without question marks');
select pg_temp.denied($q$select public.get_exam_review(current_setting('complete.schedule')::uuid)$q$,'42501','Mark release does not release answer keys');
reset role;
select set_config('complete.corrected',(select jsonb_object_agg(q.id::text,case when q.question_type='essay' then 4 else 0 end)::text from public.assessment_questions q join public.offering_assessments s on s.assessment_id=q.assessment_id where s.id=current_setting('complete.schedule')::uuid),true);
select pg_temp.claim(2);set local role authenticated;
select pg_temp.denied($q$select public.grade_exam_paper(current_setting('complete.a2')::uuid,(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,revision}')::bigint,current_setting('complete.corrected')::jsonb,'',null,gen_random_uuid())$q$,'23514','Released correction requires a reason');
select set_config('complete.correct_request',gen_random_uuid()::text,true);
select public.grade_exam_paper(current_setting('complete.a2')::uuid,(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,revision}')::bigint,current_setting('complete.corrected')::jsonb,'Corrected feedback','Rubric correction',current_setting('complete.correct_request')::uuid);
select pg_temp.ok(jsonb_array_length(public.get_exam_grade_changes(current_setting('complete.a2')::uuid))=2,'Correction appends audit preserving initial grading');
select pg_temp.ok((public.get_assessment_results(current_setting('complete.a2')::uuid)->>'score')::numeric=4,'Corrected total is authoritative');
select public.release_exam_review(current_setting('complete.schedule')::uuid,'10000000-0000-0000-0000-000000000005',(public.get_exam_grading_detail(current_setting('complete.a2')::uuid)#>>'{state,revision}')::bigint);
select set_config('complete.clone',pg_temp.legacy_clone(current_setting('complete.schedule')::uuid)::text,true);
select pg_temp.ok(public.get_exam_definition_v2(current_setting('complete.clone')::uuid)->>'isPublished'='false','Used-paper clone is a new draft');
select pg_temp.ok(public.get_exam_definition_v2(current_setting('complete.clone')::uuid)->>'isLocked'='false','Cloned version is editable');
select pg_temp.ok(jsonb_array_length(public.get_exam_definition_v2(current_setting('complete.clone')::uuid)->'questions')=7,'Clone retains every question format');
select pg_temp.denied($q$select public.get_exam_submission_page(current_setting('complete.schedule')::uuid,null,51)$q$,'23514','Unbounded staff page denied');
reset role;
select pg_temp.ok((select jsonb_agg(jsonb_build_object('id',id,'response',response,'media',media_asset_id) order by id)::text from public.assessment_responses where attempt_id in(current_setting('complete.a1')::uuid,current_setting('complete.a2')::uuid))=current_setting('complete.original_responses'),'Grading and correction never change original response history');
select pg_temp.ok((select max(version)=2 from public.assessments where id=(select assessment_id from public.offering_assessments where id=current_setting('complete.clone')::uuid)),'Clone records version and predecessor');
select pg_temp.denied($q$delete from private.exam_grade_changes where attempt_id=current_setting('complete.a2')::uuid$q$,'42501','Audit entries cannot be deleted');
select pg_temp.claim(5);set local role authenticated;
select pg_temp.ok((public.get_assessment_results(current_setting('complete.a2')::uuid)->>'score')::numeric=4,'Student sees corrected released mark');
select pg_temp.ok(public.get_exam_review(current_setting('complete.schedule')::uuid)#>>'{questions,3,numeric_key,value}'='12.5','Numeric correct answer released only with review');
select pg_temp.ok(jsonb_array_length(public.get_exam_review(current_setting('complete.schedule')::uuid)#>'{questions,1,attempts}')=2,'Review preserves both multiple-choice attempts');
select pg_temp.denied('select * from private.exam_grade_changes','42501','Audit raw records stay private');
reset role;

-- More than 100 distinct finalized students, entirely inside this rollback.
update public.course_offerings set capacity=null where id='60000000-0000-0000-0000-000000000001';
select pg_temp.claim(1);set local role authenticated;
select set_config('complete.large',pg_temp.legacy_save_v2('60000000-0000-0000-0000-000000000001',null,null,jsonb_set(jsonb_set(pg_temp.definition(),'{maxAttempts}','1'),'{questions}',jsonb_build_array(pg_temp.definition()#>'{questions,0}')))::text,true);
reset role;
do $$ declare uid uuid; aid uuid; i integer; begin
 for i in 1..107 loop
  uid:=gen_random_uuid();insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_user_meta_data) values(uid,'authenticated','authenticated','rollback-'||uid||'@example.invalid','','infinity','{"display_name":"Rollback pagination student"}');
  insert into public.enrollments(offering_id,user_id,status,enrolled_at) values('60000000-0000-0000-0000-000000000001',uid,'active',now());
  perform set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub',uid)::text,true);
  aid:=public.start_assessment_attempt(current_setting('complete.large')::uuid);perform public.submit_assessment_attempt(aid);
 end loop;
end $$;
select pg_temp.claim(2);set local role authenticated;
do $$ declare cursor_id uuid; page jsonb; seen uuid[]:='{}'; count_pages integer:=0; begin
 loop
  page:=public.get_exam_submission_page(current_setting('complete.large')::uuid,cursor_id,25);count_pages:=count_pages+1;
  seen:=seen||array(select value::uuid from jsonb_array_elements_text(page->'ids'));
  cursor_id:=(page->>'nextCursor')::uuid;
  exit when cursor_id is null;
  if count_pages>5 then raise exception 'Pagination failed to terminate'; end if;
 end loop;
 perform pg_temp.ok(cardinality(seen)=107,'Pagination reaches every submission beyond 100');
 perform pg_temp.ok((select count(distinct id)=107 from unnest(seen) id),'Cursor pages contain no duplicates');
 perform pg_temp.ok(count_pages=5,'Submission pages are bounded to 25');
end $$;
reset role;
select count(*) as passed from completion_checks;
rollback;
