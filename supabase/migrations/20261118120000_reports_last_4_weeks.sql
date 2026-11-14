-- Reports tweak (owner decisions). Replaces three functions of 20261117120000_reports.sql (applied, not edited). READ-ONLY: no table, no column, no write.
--
-- 1. The default range is "Last 4 weeks": the last 28 Cairo calendar days up to now (today and the 27 days before it), rolling. A month ('YYYY-MM', not a future one) and
--    'all' (the whole course) still work as before. Why: on the 1st of a month the "this month" views were empty and flagged everyone after one session.
--    private.report_bounds(null) is what the Groups list (report_groups) and the Needs attention list (report_attention) call, so both follow it with no change of their own;
--    report_group, report_student and report_course follow it when no month is sent.
--    The range ends at the start of tomorrow (Cairo), so homework due later today is still listed (as Open) and nothing of the future is counted.
-- 2. Needs attention, attendance: "missed 2 or more sessions in the range" replaces "attendance under 75%" (most Groups meet once a week). The other rules stay:
--    2 or more homework missing, exam average under 50%, absent from an exam. The reason is still { code: 'missed_sessions', n } ("Missed N sessions").
begin;

create or replace function private.report_bounds(p_month text,out lo timestamptz,out hi timestamptz,out label text) language plpgsql stable security definer set search_path='' as $$
declare cur date:=date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo')::date; today date:=(clock_timestamp() at time zone 'Africa/Cairo')::date; m date;
begin
 if p_month is null or p_month='' then
  lo:=(today-27)::timestamp at time zone 'Africa/Cairo';hi:=(today+1)::timestamp at time zone 'Africa/Cairo';label:='last4weeks';return;
 elsif p_month='all' then lo:='-infinity';hi:='infinity';label:='all';return;
 elsif p_month ~ '^\d{4}-(0[1-9]|1[0-2])$' then m:=(p_month||'-01')::date;
  if m>cur or m<date '2000-01-01' then raise exception 'Invalid month' using errcode='23514'; end if;
 else raise exception 'Invalid month' using errcode='23514'; end if;
 lo:=m::timestamp at time zone 'Africa/Cairo';hi:=(m+interval '1 month')::timestamp at time zone 'Africa/Cairo';label:=to_char(m,'YYYY-MM');
end $$;

create or replace function private.report_reasons(att_total integer,att_present integer,hw_missing integer,ex_max numeric,ex_score numeric,ex_absent integer,titles text[]) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(q.r order by q.o),'[]'::jsonb) from (
  select 1 o,jsonb_build_object('code','missed_sessions','n',att_total-att_present) r where att_total-att_present>=2
  union all select 2,jsonb_build_object('code','homework_missing','n',hw_missing) where hw_missing>=2
  union all select 3,jsonb_build_object('code','exams_low','pct',round(100.0*ex_score/ex_max)) where ex_max>0 and ex_score*2<ex_max
  union all select 3+x.i::integer,jsonb_build_object('code','exam_absent','title',x.t) from unnest(titles) with ordinality x(t,i) where ex_absent>0 and x.i<=3
 ) q
$$;

create or replace function private.report_reason_count(att_total integer,att_present integer,hw_missing integer,ex_max numeric,ex_score numeric,ex_absent integer) returns integer language sql immutable set search_path='' as $$
 select (att_total-att_present>=2)::integer+(hw_missing>=2)::integer+(ex_max>0 and ex_score*2<ex_max)::integer+least(ex_absent,3)
$$;

commit;
