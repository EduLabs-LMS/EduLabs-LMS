-- Reports, spread into the pages teachers already use (V1). READ-ONLY: no table, no column, no write. Applied after 20261116120000, which is not edited.
-- Resolves the caller with private.current_app_user_id(), never auth.uid(). Every function is private (definer, search_path='') with a public invoker wrapper
-- granted to authenticated only. The rules and where each number comes from are in docs/ai/REPORTS_AUDIT.md.
--
-- Everything is counted in Africa/Cairo (the zone every Group and session already uses: study_groups.timezone is checked to be Africa/Cairo).
-- A month is a Cairo calendar month; 'all' is the whole course. The Groups list and the Needs attention list always use this month.
--
--   report_groups(groups)                  numbers for the Groups on one page of the Groups list, this month
--   report_group(group, month)             the Report tab of one Group
--   report_attention(offering, page)       the Needs attention list of the Students screen, this month
--   report_student(student, offering, month)  one student's numbers in one course run
--   report_course(course, month)           the Results of the course page (per chapter, per Group)
--
-- Who: owners, instructors and the run's assistants (private.can_support_offering) for Group, student and attention reads, the same people the
-- student administration and the homework and exam queues already allow; the course Results also allow a course editor (the "view" capability of
-- homework_staff and exam_staff). Students, people of other spaces and callers with no profile get 42501.
begin;

-- ---------------------------------------------------------------------------------------
-- Helpers (internal: revoked from everyone)
-- ---------------------------------------------------------------------------------------
create function private.report_caller() returns uuid language plpgsql stable security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return u;
end $$;

-- p_month: null or '' = this month; 'all' = the whole course; 'YYYY-MM' = that Cairo month (not a future one).
create function private.report_bounds(p_month text,out lo timestamptz,out hi timestamptz,out label text) language plpgsql stable security definer set search_path='' as $$
declare cur date:=date_trunc('month',clock_timestamp() at time zone 'Africa/Cairo')::date; m date;
begin
 if p_month is null or p_month='' then m:=cur;
 elsif p_month='all' then lo:='-infinity';hi:='infinity';label:='all';return;
 elsif p_month ~ '^\d{4}-(0[1-9]|1[0-2])$' then m:=(p_month||'-01')::date;
  if m>cur or m<date '2000-01-01' then raise exception 'Invalid month' using errcode='23514'; end if;
 else raise exception 'Invalid month' using errcode='23514'; end if;
 lo:=m::timestamp at time zone 'Africa/Cairo';hi:=(m+interval '1 month')::timestamp at time zone 'Africa/Cairo';label:=to_char(m,'YYYY-MM');
end $$;

-- Needs attention: attendance under 75%, 2 or more homework missing, exam average under 50%, or absent from an exam. Fixed for V1.
create function private.report_reasons(att_total integer,att_present integer,hw_missing integer,ex_max numeric,ex_score numeric,ex_absent integer,titles text[]) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(q.r order by q.o),'[]'::jsonb) from (
  select 1 o,jsonb_build_object('code','missed_sessions','n',att_total-att_present) r where att_total>0 and att_present*100<75*att_total
  union all select 2,jsonb_build_object('code','homework_missing','n',hw_missing) where hw_missing>=2
  union all select 3,jsonb_build_object('code','exams_low','pct',round(100.0*ex_score/ex_max)) where ex_max>0 and ex_score*2<ex_max
  union all select 3+x.i::integer,jsonb_build_object('code','exam_absent','title',x.t) from unnest(titles) with ordinality x(t,i) where ex_absent>0 and x.i<=3
 ) q
$$;
create function private.report_reason_count(att_total integer,att_present integer,hw_missing integer,ex_max numeric,ex_score numeric,ex_absent integer) returns integer language sql immutable set search_path='' as $$
 select (att_total>0 and att_present*100<75*att_total)::integer+(hw_missing>=2)::integer+(ex_max>0 and ex_score*2<ex_max)::integer+least(ex_absent,3)
$$;
create function private.report_pct(a numeric,b numeric) returns integer language sql immutable set search_path='' as $$
 select case when b>0 then round(100.0*a/b)::integer end
$$;

-- ---------------------------------------------------------------------------------------
-- Facts: one row per counted thing per student, always in the Group the student was in AT THE TIME (group_id null = in no Group).
--   kind session : state present | absent; ref_at = the session start
--   kind homework: state done | missing | due; ref_at = the deadline (no deadline: when the homework was created);
--                  score/maxv only when the grade is released; detail = released | waiting (handed in, no released grade)
--   kind exam    : state marked (released score) | waiting | absent | pending (not counted: window open, or a paper not marked yet);
--                  ref_at = the closing of the student's window (a paper: its date, else when it was published); detail = online | paper
-- ---------------------------------------------------------------------------------------
create function private.report_sessions(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 select 'session'::text,g.offering_id,s.group_id,a.user_id,s.id,s.title,s.starts_at,case when a.status='attended' then 'present' else 'absent' end,
  null::numeric,null::numeric,null::text,null::uuid
 from public.group_sessions s join public.study_groups g on g.id=s.group_id join public.session_attendance a on a.session_id=s.id
 where g.offering_id=any(p_offerings) and s.attendance_state='finalized' and not s.cancelled and s.ends_at<=clock_timestamp()
  and s.starts_at>=p_lo and s.starts_at<p_hi
$$;

create function private.report_homework(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 with hw as materialized (
   select x.* from (select distinct on (a.family_id) a.id,a.family_id,a.offering_id,a.title,a.lesson_id,a.deadline_at,coalesce(a.deadline_at,a.created_at) ref
     from public.homework_assignments a where a.offering_id=any(p_offerings) and a.status='published' order by a.family_id,a.version desc) x
   where x.ref>=p_lo and x.ref<p_hi),
  fam as materialized (select a.id,a.family_id,a.mode,a.file_points,a.uses_marks from public.homework_assignments a where a.family_id in (select family_id from hw)),
  subs as materialized (
   select distinct on (f.family_id,s.user_id) f.family_id,s.user_id,s.id sub_id,f.uses_marks,c.released_at,c.score,
    case when f.mode='PLATFORM_QUESTIONS' then (select coalesce(sum(q.points),0) from public.homework_questions q where q.assignment_id=f.id) else f.file_points end tot
   from fam f join public.homework_submissions s on s.assignment_id=f.id and s.status='submitted'
   left join private.homework_corrections c on c.submission_id=s.id
   order by f.family_id,s.user_id,s.submitted_at desc,s.id),
  stu as materialized (
   select h.id hw_id,h.family_id,h.offering_id,h.title,h.lesson_id,h.deadline_at,h.ref,e.user_id,
    (select m.group_id from public.group_memberships m where m.offering_id=h.offering_id and m.user_id=e.user_id and m.starts_at<=h.ref and (m.ends_at is null or m.ends_at>h.ref) order by m.starts_at desc limit 1) gid
   from hw h join public.enrollments e on e.offering_id=h.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=h.ref))
 select 'homework'::text,st.offering_id,st.gid,st.user_id,st.hw_id,st.title,st.ref,
  case when sb.sub_id is not null then 'done' when st.deadline_at is not null and st.deadline_at<=clock_timestamp() then 'missing' else 'due' end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.score end,
  case when sb.released_at is not null and sb.uses_marks and sb.score is not null then sb.tot end,
  case when sb.released_at is not null then 'released' when sb.sub_id is not null then 'waiting' end,
  st.lesson_id
 from stu st left join subs sb on sb.family_id=st.family_id and sb.user_id=st.user_id
$$;

create function private.report_exams(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 with ex as materialized (
   select e.id,e.kind,e.timing,e.offering_id,e.title,e.auto_release,e.opens_at,e.closes_at,e.held_on,e.published_at,
    case when e.kind='online' then private.exam_last_close(e.id) end lastclose
   from private.exams e where e.offering_id=any(p_offerings) and e.status in ('published','archived') and e.published_at is not null),
  win as materialized (
   select x.id exam_id,w.group_id wgid,w.closes_at ref from ex x cross join lateral private.exam_windows(x.id) w where x.kind='online' and x.timing='per_group' and w.state='ok'
   union all select x.id,null::uuid,x.closes_at from ex x where x.kind='online' and x.timing='same_time' and x.closes_at is not null
   union all select x.id,null::uuid,coalesce(x.held_on::timestamp at time zone 'Africa/Cairo',x.published_at) from ex x where x.kind='paper'),
  w2 as materialized (select w.exam_id,w.wgid,w.ref,x.kind,x.offering_id from win w join ex x on x.id=w.exam_id where w.ref>=p_lo and w.ref<p_hi),
  res as materialized (
   select r.id rid,r.exam_id,r.user_id,r.status,r.score,r.max_score,r.absent,r.released_at,a.window_group_id wg
   from private.exam_results r left join private.exam_attempts a on a.id=r.final_attempt_id where r.exam_id in (select exam_id from w2)),
  cand as (
   select w.exam_id,w.wgid,w.ref,r.user_id,1 pr from w2 w join res r on r.exam_id=w.exam_id and (w.kind='paper' or w.wgid is null or r.wg=w.wgid)
   union all
   select w.exam_id,w.wgid,w.ref,e.user_id,2 from w2 w join public.enrollments e on e.offering_id=w.offering_id and e.status in ('active','completed','suspended') and (e.enrolled_at is null or e.enrolled_at<=w.ref)
   where not exists(select 1 from res r where r.exam_id=w.exam_id and r.user_id=e.user_id)
    and (w.wgid is null or exists(select 1 from public.group_memberships m where m.group_id=w.wgid and m.user_id=e.user_id and m.starts_at<=least(w.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(w.ref,clock_timestamp()))))),
  one as (select distinct on (c.exam_id,c.user_id) c.* from cand c order by c.exam_id,c.user_id,c.pr,c.ref desc),
  st as (
   select o.exam_id,o.user_id,o.ref,x.kind,x.offering_id,x.title,r.score,r.max_score,
    coalesce(o.wgid,(select m.group_id from public.group_memberships m where m.offering_id=x.offering_id and m.user_id=o.user_id and m.starts_at<=least(o.ref,clock_timestamp()) and (m.ends_at is null or m.ends_at>least(o.ref,clock_timestamp())) order by m.starts_at desc limit 1)) gid,
    case when r.absent then 'absent'
     when r.rid is null then case when x.kind='online' and o.ref<=clock_timestamp()
       and not exists(select 1 from private.exam_attempts a where a.exam_id=o.exam_id and a.user_id=o.user_id and a.status='in_progress') then 'absent' else 'pending' end
     when r.status='corrected' and r.score is not null and (r.released_at is not null or (x.auto_release and x.lastclose<=clock_timestamp())) then 'marked'
     else 'waiting' end state
   from one o join ex x on x.id=o.exam_id left join res r on r.exam_id=o.exam_id and r.user_id=o.user_id)
 select 'exam'::text,s.offering_id,s.gid,s.user_id,s.exam_id,s.title,s.ref,s.state,case when s.state='marked' then s.score end,case when s.state='marked' then s.max_score end,s.kind,null::uuid
 from st s
$$;

create function private.report_facts(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz)
returns table(kind text,offering_id uuid,group_id uuid,user_id uuid,item_id uuid,title text,ref_at timestamptz,state text,score numeric,maxv numeric,detail text,lesson_id uuid)
language sql stable security definer set search_path='' as $$
 select * from private.report_sessions(p_offerings,p_lo,p_hi)
 union all select * from private.report_homework(p_offerings,p_lo,p_hi)
 union all select * from private.report_exams(p_offerings,p_lo,p_hi)
$$;

-- One row per student (and per Group when p_by_group), with the numbers of every kind. active = the student's enrollment is active now.
create function private.report_stats(p_offerings uuid[],p_lo timestamptz,p_hi timestamptz,p_by_group boolean)
returns table(offering_id uuid,group_id uuid,user_id uuid,active boolean,att_total integer,att_present integer,hw_given integer,hw_done integer,hw_missing integer,hw_score numeric,hw_max numeric,
 ex_count integer,ex_score numeric,ex_max numeric,ex_absent integer,absent_titles text[])
language sql stable security definer set search_path='' as $$
 with f as materialized (select * from private.report_facts(p_offerings,p_lo,p_hi))
 select f.offering_id,case when p_by_group then f.group_id end,f.user_id,coalesce(bool_or(e.status='active'),false),
  (count(*) filter(where f.kind='session'))::integer,(count(*) filter(where f.kind='session' and f.state='present'))::integer,
  (count(*) filter(where f.kind='homework'))::integer,(count(*) filter(where f.kind='homework' and f.state='done'))::integer,(count(*) filter(where f.kind='homework' and f.state='missing'))::integer,
  coalesce(sum(f.score) filter(where f.kind='homework'),0),coalesce(sum(f.maxv) filter(where f.kind='homework'),0),
  (count(*) filter(where f.kind='exam' and f.state='marked'))::integer,coalesce(sum(f.score) filter(where f.kind='exam' and f.state='marked'),0),coalesce(sum(f.maxv) filter(where f.kind='exam' and f.state='marked'),0),
  (count(*) filter(where f.kind='exam' and f.state='absent'))::integer,coalesce(array_agg(f.title order by f.ref_at,f.item_id) filter(where f.kind='exam' and f.state='absent'),'{}')
 from f left join public.enrollments e on e.offering_id=f.offering_id and e.user_id=f.user_id
 group by f.offering_id,case when p_by_group then f.group_id end,f.user_id
$$;

-- ---------------------------------------------------------------------------------------
-- report_groups: the Groups list. One call per page of the list (the Group ids of the page), this month.
-- ---------------------------------------------------------------------------------------
create function private.report_groups(p_groups uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];n integer;res jsonb;
begin
 if p_groups is null or cardinality(p_groups) not between 1 and 100 then raise exception 'Send 1 to 100 Groups' using errcode='23514'; end if;
 select count(*),array_agg(distinct g.offering_id) into n,offs from public.study_groups g where g.id=any(p_groups);
 if n<>(select count(distinct x) from unnest(p_groups) x) or exists(select 1 from public.study_groups g where g.id=any(p_groups) and not private.can_support_offering(g.offering_id)) then
  raise exception 'Groups unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(null);
 with f as materialized (select * from private.report_facts(offs,b.lo,b.hi) where group_id=any(p_groups)),
  st as materialized (select * from private.report_stats(offs,b.lo,b.hi,true) where group_id=any(p_groups))
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'groups',coalesce(jsonb_agg(jsonb_build_object(
   'groupId',x.gid,'hasNumbers',x.sessions+x.hw+x.exams>0,
   'attendance',jsonb_build_object('pct',private.report_pct(x.present,x.att_total),'present',x.present,'total',x.att_total),
   'homework',jsonb_build_object('pct',private.report_pct(x.hw_done,x.hw_given),'done',x.hw_done,'given',x.hw_given),
   'exams',jsonb_build_object('pct',private.report_pct(x.ex_score,x.ex_max),'count',x.exams),
   'attention',x.attention) order by x.gid),'[]'::jsonb)) into res
 from (select gid,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='session') sessions,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='homework') hw,
   (select count(distinct f.item_id) from f where f.group_id=gid and f.kind='exam' and f.state<>'pending') exams,
   coalesce((select sum(s.att_present) from st s where s.group_id=gid),0)::integer present,coalesce((select sum(s.att_total) from st s where s.group_id=gid),0)::integer att_total,
   coalesce((select sum(s.hw_done) from st s where s.group_id=gid),0)::integer hw_done,coalesce((select sum(s.hw_given) from st s where s.group_id=gid),0)::integer hw_given,
   coalesce((select sum(s.ex_score) from st s where s.group_id=gid),0) ex_score,coalesce((select sum(s.ex_max) from st s where s.group_id=gid),0) ex_max,
   (select count(*) from st s where s.group_id=gid and s.active and private.report_reason_count(s.att_total,s.att_present,s.hw_missing,s.ex_max,s.ex_score,s.ex_absent)>0)::integer attention
  from (select distinct unnest(p_groups) gid) ids) x;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------
-- report_group: the Report tab of one Group, for a month (this month by default, an earlier 'YYYY-MM', or 'all').
-- ---------------------------------------------------------------------------------------
create function private.report_group(p_group uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();g public.study_groups;b record;res jsonb;pace jsonb;
begin
 select * into g from public.study_groups where id=p_group;
 if g.id is null or not private.can_support_offering(g.offering_id) then raise exception 'Group unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 select jsonb_build_object('chapter',m.chapter_number,'lesson',l.position+1,'lessonId',l.id,'label',m.chapter_number||'.'||(l.position+1)) into pace
  from public.homework_assignments a join public.lessons l on l.id=a.lesson_id and l.status='published' join public.course_modules m on m.id=l.module_id
  where a.offering_id=g.offering_id and a.status='published' order by m.position desc,l.position desc limit 1;
 with f as materialized (select * from private.report_facts(array[g.offering_id],b.lo,b.hi) where group_id=p_group),
  st as materialized (select * from private.report_stats(array[g.offering_id],b.lo,b.hi,true) where group_id=p_group),
  roster as materialized (
   select s.user_id from st s
   union select m.user_id from public.group_memberships m join public.enrollments e on e.offering_id=m.offering_id and e.user_id=m.user_id and e.status='active'
    where m.group_id=p_group and m.starts_at<b.hi and (m.ends_at is null or m.ends_at>b.lo)),
  per as materialized (
   select r.user_id,p.display_name,coalesce(s.active,exists(select 1 from public.enrollments e where e.offering_id=g.offering_id and e.user_id=r.user_id and e.status='active')) active,
    coalesce(s.att_total,0) att_total,coalesce(s.att_present,0) att_present,coalesce(s.hw_given,0) hw_given,coalesce(s.hw_done,0) hw_done,coalesce(s.hw_missing,0) hw_missing,
    coalesce(s.hw_score,0) hw_score,coalesce(s.hw_max,0) hw_max,coalesce(s.ex_count,0) ex_count,coalesce(s.ex_score,0) ex_score,coalesce(s.ex_max,0) ex_max,coalesce(s.ex_absent,0) ex_absent,
    coalesce(s.absent_titles,'{}') titles
   from roster r join public.profiles p on p.id=r.user_id left join st s on s.user_id=r.user_id),
  ranked as materialized (
   select pr.*,private.report_reason_count(pr.att_total,pr.att_present,pr.hw_missing,pr.ex_max,pr.ex_score,pr.ex_absent) n,
    coalesce(least(private.report_pct(pr.att_present,pr.att_total),private.report_pct(pr.ex_score,pr.ex_max),private.report_pct(pr.hw_done,pr.hw_given)),100) worst
   from per pr),
  one as (select jsonb_build_object('userId',r.user_id,'name',r.display_name,
     'attendance',jsonb_build_object('pct',private.report_pct(r.att_present,r.att_total),'present',r.att_present,'total',r.att_total),
     'homework',jsonb_build_object('done',r.hw_done,'given',r.hw_given,'missing',r.hw_missing),
     'exams',jsonb_build_object('pct',private.report_pct(r.ex_score,r.ex_max),'count',r.ex_count,'absent',r.ex_absent),
     'reasons',private.report_reasons(r.att_total,r.att_present,r.hw_missing,r.ex_max,r.ex_score,r.ex_absent,r.titles)) j,r.n,r.worst,r.display_name,r.user_id,r.active
   from ranked r)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'firstMonth',to_char(g.created_at at time zone 'Africa/Cairo','YYYY-MM'),
   'group',jsonb_build_object('id',g.id,'name',g.name),'pace',jsonb_build_object('reached',pace,'homeworkGiven',(select count(distinct a.family_id) from public.homework_assignments a where a.offering_id=g.offering_id and a.status='published')),
   'summary',jsonb_build_object(
    'attendance',jsonb_build_object('pct',private.report_pct((select coalesce(sum(att_present),0) from per),(select coalesce(sum(att_total),0) from per)),'sessions',(select count(distinct item_id) from f where kind='session')),
    'homework',jsonb_build_object('pct',private.report_pct((select coalesce(sum(hw_done),0) from per),(select coalesce(sum(hw_given),0) from per)),'given',(select count(distinct item_id) from f where kind='homework')),
    'exams',jsonb_build_object('pct',private.report_pct((select coalesce(sum(ex_score),0) from per),(select coalesce(sum(ex_max),0) from per)),'count',(select count(distinct item_id) from f where kind='exam' and state<>'pending'))),
   'attentionTotal',(select count(*) from one where active and n>0),
   'attention',coalesce((select jsonb_agg(x.j order by x.n desc,x.worst,x.display_name,x.user_id) from (select * from one where active and n>0 order by n desc,worst,display_name,user_id limit 200) x),'[]'::jsonb),
   'everyoneTotal',(select count(*) from one where not (active and n>0)),
   'everyone',coalesce((select jsonb_agg(x.j order by x.display_name,x.user_id) from (select * from one where not (active and n>0) order by display_name,user_id limit 300) x),'[]'::jsonb)) into res;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------
-- report_attention: the Needs attention filter of the Students screen. This month, across every Group of the run (and no Group). Worst first.
-- p_offering null = every run the caller supports.
-- ---------------------------------------------------------------------------------------
create function private.report_attention(p_offering uuid default null,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];res jsonb;
begin
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid page' using errcode='23514'; end if;
 if p_offering is not null then
  if not private.can_support_offering(p_offering) then raise exception 'Course unavailable' using errcode='42501'; end if;
  offs:=array[p_offering];
 else
  offs:=array(select o.id from public.course_offerings o join public.courses c on c.id=o.course_id
   where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and private.can_support_offering(o.id));
  if cardinality(offs)=0 then raise exception 'Students unavailable' using errcode='42501'; end if;
 end if;
 select * into b from private.report_bounds(null);
 with st as materialized (select * from private.report_stats(offs,b.lo,b.hi,false) s where s.active),
  flagged as materialized (
   select s.*,private.report_reason_count(s.att_total,s.att_present,s.hw_missing,s.ex_max,s.ex_score,s.ex_absent) n,
    coalesce(least(private.report_pct(s.att_present,s.att_total),private.report_pct(s.ex_score,s.ex_max),private.report_pct(s.hw_done,s.hw_given)),100) worst
   from st s),
  hit as materialized (select f.*,p.display_name from flagged f join public.profiles p on p.id=f.user_id where f.n>0),
  pg as materialized (select h.* from hit h order by h.n desc,h.worst,h.display_name,h.user_id limit 25 offset p_page*25)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,'page',p_page,'pageSize',25,'total',(select count(*) from hit),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('userId',h.user_id,'name',h.display_name,'offeringId',h.offering_id,'courseTitle',c.title,
     'group',(select jsonb_build_object('id',g.id,'name',g.name) from public.group_memberships m join public.study_groups g on g.id=m.group_id
        where m.offering_id=h.offering_id and m.user_id=h.user_id and (m.ends_at is null or m.ends_at>b.lo) and m.starts_at<b.hi order by (m.ends_at is null) desc,m.starts_at desc limit 1),
     'reasons',private.report_reasons(h.att_total,h.att_present,h.hw_missing,h.ex_max,h.ex_score,h.ex_absent,h.absent_titles)) order by h.n desc,h.worst,h.display_name,h.user_id)
    from pg h join public.course_offerings o on o.id=h.offering_id join public.courses c on c.id=o.course_id),'[]'::jsonb)) into res;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------
-- report_student: one student in one run, for a month. The sessions, the homework and the exams of the month, each in the Group of its time.
-- ---------------------------------------------------------------------------------------
create function private.report_student(p_student uuid,p_offering uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;res jsonb;
begin
 if p_student is null or p_offering is null or not private.can_support_offering(p_offering)
  or not exists(select 1 from public.enrollments e where e.offering_id=p_offering and e.user_id=p_student and e.status in ('active','completed','suspended')) then
  raise exception 'Student unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 with f as materialized (select * from private.report_facts(array[p_offering],b.lo,b.hi) where user_id=p_student),
  gn as materialized (select g.id,g.name from public.study_groups g where g.id in (select group_id from f where group_id is not null)),
  se as materialized (select * from f where kind='session' order by ref_at,item_id),
  hw as materialized (select * from f where kind='homework' order by ref_at,item_id),
  ex as materialized (select * from f where kind='exam' and state<>'pending' order by ref_at,item_id)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,
  'firstMonth',(select to_char(min(e.created_at) at time zone 'Africa/Cairo','YYYY-MM') from public.enrollments e where e.offering_id=p_offering and e.user_id=p_student),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from gn),'[]'::jsonb),
  'attendance',jsonb_build_object('pct',private.report_pct((select count(*) from se where state='present'),(select count(*) from se)),'present',(select count(*) from se where state='present'),'total',(select count(*) from se)),
  'homework',jsonb_build_object('done',(select count(*) from hw where state='done'),'given',(select count(*) from hw),'missing',(select count(*) from hw where state='missing'),
    'avgPct',private.report_pct((select coalesce(sum(score),0) from hw),(select coalesce(sum(maxv),0) from hw))),
  'exams',jsonb_build_object('pct',private.report_pct((select coalesce(sum(score),0) from ex where state='marked'),(select coalesce(sum(maxv),0) from ex where state='marked')),
    'count',(select count(*) from ex where state='marked'),'absent',(select count(*) from ex where state='absent')),
  'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'groupId',group_id,'day',extract(day from ref_at at time zone 'Africa/Cairo')::integer,'date',to_char(ref_at at time zone 'Africa/Cairo','YYYY-MM-DD'),'state',state) order by ref_at,item_id) from (select * from se limit 200) x),'[]'::jsonb),
  'homeworkList',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'title',title,'groupId',group_id,'state',state,'score',score,'max',maxv,'detail',detail,'dueAt',ref_at) order by ref_at,item_id) from (select * from hw limit 200) x),'[]'::jsonb),
  'examList',coalesce((select jsonb_agg(jsonb_build_object('id',item_id,'title',title,'groupId',group_id,'state',state,'score',score,'max',maxv,'kind',detail,'at',ref_at) order by ref_at,item_id) from (select * from ex limit 200) x),'[]'::jsonb)) into res;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------
-- report_course: Results of the course page. One card per chapter: the average of homework and exam marks in that chapter, per Group.
-- Homework reaches a chapter through its lesson; an exam through the chapters it is tagged with ("all" = every chapter of the course).
-- ---------------------------------------------------------------------------------------
create function private.report_course(p_course uuid,p_month text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=private.report_caller();b record;offs uuid[];res jsonb;editor boolean;
begin
 if p_course is null or not exists(select 1 from public.courses c where c.id=p_course) then raise exception 'Course unavailable' using errcode='42501'; end if;
 editor:=private.can_edit_course(p_course);
 offs:=array(select o.id from public.course_offerings o where o.course_id=p_course and (editor or private.can_support_offering(o.id)));
 if cardinality(offs)=0 then raise exception 'Course unavailable' using errcode='42501'; end if;
 select * into b from private.report_bounds(p_month);
 with f as materialized (select * from private.report_facts(offs,b.lo,b.hi) where kind='homework' or (kind='exam' and state<>'pending')),
  mods as materialized (select m.id,m.chapter_number,m.title,m.position from public.course_modules m where m.course_id=p_course),
  items as materialized (
   select 'homework'::text kind,f.item_id,f.group_id,f.user_id,f.score,f.maxv,l.module_id from f join public.lessons l on l.id=f.lesson_id where f.kind='homework' and l.module_id in (select id from mods)
   union all
   select 'exam',f.item_id,f.group_id,f.user_id,f.score,f.maxv,m.id from f join private.exams e on e.id=f.item_id
    join mods m on e.covers_all_chapters or exists(select 1 from private.exam_chapters x where x.exam_id=e.id and x.module_id=m.id) where f.kind='exam'),
  per as materialized (select i.module_id,i.group_id,count(*) filter(where i.score is not null)::integer marks,coalesce(sum(i.score),0) sc,coalesce(sum(i.maxv),0) mx from items i group by i.module_id,i.group_id),
  ch as materialized (
   select m.id,m.chapter_number,m.title,m.position,
    (select count(distinct i.item_id) from items i where i.module_id=m.id and i.kind='exam') exams,(select count(distinct i.item_id) from items i where i.module_id=m.id and i.kind='homework') hws,
    (select coalesce(sum(p.sc),0) from per p where p.module_id=m.id) sc,(select coalesce(sum(p.mx),0) from per p where p.module_id=m.id) mx
   from mods m),
  weak as (select c.id from ch c where c.mx>0 and (select count(*) from ch where mx>0)>=2 order by c.sc/c.mx,c.position limit 1)
 select jsonb_build_object('month',b.label,'timezone','Africa/Cairo','from',b.lo,'to',b.hi,
  'firstMonth',(select to_char(min(o.created_at) at time zone 'Africa/Cairo','YYYY-MM') from public.course_offerings o where o.id=any(offs)),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id) from public.study_groups g where g.offering_id=any(offs) and (g.status='active' or g.id in (select group_id from per where group_id is not null))),'[]'::jsonb),
  'chapters',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.chapter_number,'title',c.title,'exams',c.exams,'homework',c.hws,'pct',private.report_pct(c.sc,c.mx),'weakest',c.id in (select id from weak),
     'groups',coalesce((select jsonb_agg(jsonb_build_object('groupId',p.group_id,'pct',private.report_pct(p.sc,p.mx),'marks',p.marks) order by p.group_id nulls last) from per p where p.module_id=c.id and p.mx>0),'[]'::jsonb)) order by c.position,c.id) from ch c),'[]'::jsonb)) into res;
 return res;
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants: helpers to nobody; the five reads to authenticated; the public wrappers run as the caller.
-- ---------------------------------------------------------------------------------------
do $$ declare f text;begin
 foreach f in array array['report_caller()','report_bounds(text)','report_reasons(integer,integer,integer,numeric,numeric,integer,text[])','report_reason_count(integer,integer,integer,numeric,numeric,integer)',
  'report_pct(numeric,numeric)','report_sessions(uuid[],timestamptz,timestamptz)','report_homework(uuid[],timestamptz,timestamptz)','report_exams(uuid[],timestamptz,timestamptz)',
  'report_facts(uuid[],timestamptz,timestamptz)','report_stats(uuid[],timestamptz,timestamptz,boolean)'] loop
  execute format('revoke all on function private.%s from public,anon,authenticated,service_role',f);
 end loop;
 foreach f in array array['report_groups(uuid[])','report_group(uuid,text)','report_attention(uuid,integer)','report_student(uuid,uuid,text)','report_course(uuid,text)'] loop
  execute format('revoke all on function private.%s from public,anon,service_role',f);
  execute format('grant execute on function private.%s to authenticated',f);
 end loop;
end $$;
create function public.report_groups(p_groups uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$select private.report_groups(p_groups)$$;
create function public.report_group(p_group uuid,p_month text default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.report_group(p_group,p_month)$$;
create function public.report_attention(p_offering uuid default null,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.report_attention(p_offering,p_page)$$;
create function public.report_student(p_student uuid,p_offering uuid,p_month text default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.report_student(p_student,p_offering,p_month)$$;
create function public.report_course(p_course uuid,p_month text default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.report_course(p_course,p_month)$$;
do $$ declare f text;begin
 foreach f in array array['report_groups(uuid[])','report_group(uuid,text)','report_attention(uuid,integer)','report_student(uuid,uuid,text)','report_course(uuid,text)'] loop
  execute format('revoke all on function public.%s from public,anon,service_role',f);
  execute format('grant execute on function public.%s to authenticated',f);
 end loop;
end $$;

commit;
