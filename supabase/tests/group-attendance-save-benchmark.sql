-- Benchmark tail, not part of the default suite (run: node scripts/exam-sql-local.cjs --postgres --bench). Disposable local PostgreSQL only; rolls back.
-- The runner puts the fixture of groups-attendance.sql (28 synthetic learners in one Group, one past class) in front of this file, then this times, inside the
-- database, the two calls an attendance save makes: group_command('attendance') and group_view of the class. It says nothing about network, Vercel or the
-- connected Supabase project; those are not measured here.
create temp table gas_times(label text, ms numeric);
grant insert on gas_times to authenticated;
do $$declare t timestamptz; v integer; i integer; r jsonb;
begin
 select version into v from public.group_sessions where id=current_setting('ga.bulk_session')::uuid;
 for i in 1..5 loop
  t:=clock_timestamp(); perform public.group_view(current_setting('ga.bulk')::uuid,current_setting('ga.bulk_session')); insert into gas_times values('view (first page, 25 rows)',extract(epoch from clock_timestamp()-t)*1000);
 end loop;
 t:=clock_timestamp();
 r:=public.group_command(current_setting('ga.bulk')::uuid,'attendance',null,jsonb_build_object('sessionId',current_setting('ga.bulk_session'),'sessionVersion',v,
  'marks',(select jsonb_agg(jsonb_build_object('userId',user_id,'status','attended')) from ga_bulk)));
 insert into gas_times values('attendance save, 28 marks (first save)',extract(epoch from clock_timestamp()-t)*1000);
 for i in 1..5 loop
  v:=(r->>'version')::integer;
  t:=clock_timestamp();
  r:=public.group_command(current_setting('ga.bulk')::uuid,'attendance',null,jsonb_build_object('sessionId',current_setting('ga.bulk_session'),'sessionVersion',v,
   'marks',(select jsonb_agg(jsonb_build_object('userId',user_id,'status',case when n%2=0 then 'absent' else 'attended' end)) from ga_bulk)));
  insert into gas_times values('attendance save, 28 marks (re-save)',extract(epoch from clock_timestamp()-t)*1000);
  v:=(r->>'version')::integer;
  t:=clock_timestamp();
  r:=public.group_command(current_setting('ga.bulk')::uuid,'attendance',null,jsonb_build_object('sessionId',current_setting('ga.bulk_session'),'sessionVersion',v,
   'marks',(select jsonb_agg(jsonb_build_object('userId',user_id,'status','attended')) from ga_bulk where n=1)));
  insert into gas_times values('attendance save, 1 mark',extract(epoch from clock_timestamp()-t)*1000);
 end loop;
end$$;
reset role;
select label as gas_label, count(*) as gas_runs, round(min(ms),1) as gas_min_ms, round(max(ms),1) as gas_max_ms from gas_times group by label order by label;
rollback;
