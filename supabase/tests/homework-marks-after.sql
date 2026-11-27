-- Disposable local PostgreSQL only. Runs just after migration 20261127130000 (see homework-marks-before.sql), then removes its rows.
create temp table hmb_results(name text primary key);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.hmb_results values(label);end$$;
select pg_temp.ok((select string_agg(title||':'||solutions_open||':'||revision,'|' order by title) from public.homework_assignments where course_id='7d000000-0000-0000-0000-000000000004')
 ='Faraday homework 1:after_hand_in:4|Faraday mixed:after_hand_in:4|Faraday open:after_hand_in:3','after_deadline rows became after_hand_in (revision moved on); an after_hand_in row is untouched');
select pg_temp.ok(not exists(select 1 from public.homework_assignments where solutions_open='after_deadline'),'no after_deadline row is left anywhere');
select pg_temp.ok((select c.released_at=s.submitted_at and c.released_by is null and c.revision=1 and c.status='corrected' and c.score=1
 from private.homework_corrections c join public.homework_submissions s on s.id=c.submission_id where c.submission_id='7d000000-0000-0000-0000-0000000000a9'),
 'the Faraday try is released as of its hand-in, by the rule (no person), revision moved on');
select pg_temp.ok((select count(*)=1 from private.homework_audit where submission_id='7d000000-0000-0000-0000-0000000000a9' and action='auto_released' and actor='7d000000-0000-0000-0000-000000000003'),
 'one auto_released audit row, in the student''s name');
select pg_temp.ok((select released_at is null and revision=1 from private.homework_corrections where submission_id='7d000000-0000-0000-0000-0000000000b9'),'a marked essay waits for the teacher''s release');
select pg_temp.ok((select released_at is null and revision=0 from private.homework_corrections where submission_id='7d000000-0000-0000-0000-0000000000c9'),'a try still under correction is left alone');
select pg_temp.ok(not exists(select 1 from private.notification_events where resource_id in ('7d000000-0000-0000-0000-0000000000a9','7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000c9')),
 'the backfill sends no notice');
select count(*) as homework_marks_backfill_tests from hmb_results;
delete from private.homework_audit where assignment_id in (select id from public.homework_assignments where course_id='7d000000-0000-0000-0000-000000000004');
delete from private.homework_corrections where submission_id in ('7d000000-0000-0000-0000-0000000000a9','7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000c9');
delete from private.homework_marks where submission_id in ('7d000000-0000-0000-0000-0000000000a9','7d000000-0000-0000-0000-0000000000b9','7d000000-0000-0000-0000-0000000000c9');
delete from public.homework_submissions where assignment_id in (select id from public.homework_assignments where course_id='7d000000-0000-0000-0000-000000000004');
delete from private.homework_keys where question_id in (select q.id from public.homework_questions q join public.homework_assignments a on a.id=q.assignment_id where a.course_id='7d000000-0000-0000-0000-000000000004');
delete from public.homework_options where question_id in (select q.id from public.homework_questions q join public.homework_assignments a on a.id=q.assignment_id where a.course_id='7d000000-0000-0000-0000-000000000004');
delete from public.homework_questions where assignment_id in (select id from public.homework_assignments where course_id='7d000000-0000-0000-0000-000000000004');
delete from public.homework_assignments where course_id='7d000000-0000-0000-0000-000000000004';
delete from public.enrollments where offering_id='7d000000-0000-0000-0000-000000000007';
delete from public.course_offerings where id='7d000000-0000-0000-0000-000000000007';
delete from public.lessons where id='7d000000-0000-0000-0000-000000000006';
delete from public.course_modules where id='7d000000-0000-0000-0000-000000000005';
delete from public.course_staff where course_id='7d000000-0000-0000-0000-000000000004';
delete from public.courses where id='7d000000-0000-0000-0000-000000000004';
delete from public.notifications where recipient_id in ('7d000000-0000-0000-0000-000000000002','7d000000-0000-0000-0000-000000000003');
delete from private.notification_events where organization_id='7d000000-0000-0000-0000-000000000001';
delete from public.organizations where id='7d000000-0000-0000-0000-000000000001';
delete from public.profiles where id in ('7d000000-0000-0000-0000-000000000002','7d000000-0000-0000-0000-000000000003');
drop table hmb_results;
drop function pg_temp.ok(boolean,text);
