-- Exams, the owner's rules (draft; not applied anywhere). Audit and plan: docs/ai/EXAMS_DB_AUDIT.md; the owner's answers: DECISIONS.md.
--
-- New exam tables beside the legacy assessment tables. The legacy tables, functions and student runner are unchanged, except that the
-- legacy builder's save and clone are closed to clients (owner's answer 2): no new legacy-style exam can be created.
--
-- Two kinds. ONLINE: questions (choice A-H with one or more right answers, number with a tolerance, essay with text and/or one photo),
-- a window per Group linked to that Group's session (or one window for all), an optional time limit, tries, a mixed order stored per try,
-- releases, auto-release (no essays) and answer review after the LAST window. PAPER: a maximum mark only; each student's mark (halves)
-- or Absent.
--
-- Every table is private with RLS on and no client grant. Reads and writes go through definer functions (private) with invoker wrappers
-- (public), executable by authenticated only. The caller is always private.current_app_user_id(), never auth.uid().
-- Refusals: 42501 denied, 23514 invalid, 23503 in use, PT409 stale or closed (JSON detail {"reason":...}), PT413 too large.
--
-- Also: Demo Clear removes exams a teacher added in a demo space and still refuses real people's work (owner's answer 13). No demo seed.
begin;

-- ---------------------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------------------
create table private.exams (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null,
 version integer not null default 1 check(version between 1 and 1000),
 supersedes_id uuid references private.exams(id) on delete restrict,
 revision bigint not null default 0 check(revision>=0),
 course_id uuid not null references public.courses(id) on delete restrict,
 offering_id uuid not null references public.course_offerings(id) on delete restrict,
 kind text not null check(kind in ('online','paper')),
 title text not null check(length(btrim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=8000),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 published_at timestamptz,
 -- Paper: the maximum mark (a whole number) and an optional display-only date.
 max_marks integer check(max_marks between 1 and 1000),
 held_on date,
 -- Online: when, and the rules.
 timing text check(timing in ('per_group','same_time')),
 starting_from date,
 opens_at timestamptz,
 closes_at timestamptz,
 time_limit_minutes integer check(time_limit_minutes between 1 and 1440),
 tries_mode text check(tries_mode in ('one_time','fix_mistakes','from_zero')),
 shuffle boolean not null default false,
 photos_allowed boolean not null default true,
 auto_release boolean not null default false,
 covers_all_chapters boolean not null default false,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(family_id,version),
 constraint exams_shape_check check(
  (kind='paper' and max_marks is not null and timing is null and starting_from is null and opens_at is null and closes_at is null
   and time_limit_minutes is null and tries_mode is null and not shuffle and not auto_release)
  or (kind='online' and max_marks is null and held_on is null and timing is not null and tries_mode is not null
   and (timing='same_time' or (opens_at is null and closes_at is null))
   and (timing='per_group' or starting_from is null)
   and (opens_at is null or closes_at is null or closes_at>opens_at)
   and (status='draft' or (timing='same_time' and opens_at is not null and closes_at is not null) or (timing='per_group' and starting_from is not null))))
);
create index exams_offering_idx on private.exams(offering_id,status);
create index exams_course_idx on private.exams(course_id,status);
create index exams_supersedes_idx on private.exams(supersedes_id) where supersedes_id is not null;
create index exams_creator_idx on private.exams(created_by);

-- Chapters it covers (for Reports). covers_all_chapters means every chapter, including chapters added later.
create table private.exam_chapters (
 exam_id uuid not null references private.exams(id) on delete cascade,
 module_id uuid not null references public.course_modules(id) on delete cascade,
 primary key(exam_id,module_id)
);
create index exam_chapters_module_idx on private.exam_chapters(module_id);

-- Uploads: question pictures, model answer pictures, student photo answers. Kept: no exam function ever deletes one (owner's rule 9).
create table private.exam_uploads (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references private.exams(id) on delete restrict,
 uploaded_by uuid not null references public.profiles(id) on delete restrict,
 attempt_id uuid,
 purpose text not null check(purpose in ('question','model','answer')),
 name text not null default '' check(length(name)<=255),
 mime text not null check(mime in ('image/png','image/jpeg','image/webp')),
 path text not null unique check(path !~ '(^|/)\.\.(/|$)' and length(path)<=512),
 status text not null default 'pending' check(status in ('pending','ready')),
 size_bytes bigint check(size_bytes between 1 and 5242880),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 created_at timestamptz not null default clock_timestamp(),
 check((status='ready')=(size_bytes is not null)),
 check((purpose='answer')=(attempt_id is not null))
);
create index exam_uploads_exam_idx on private.exam_uploads(exam_id,status);
create index exam_uploads_uploader_idx on private.exam_uploads(uploaded_by);
create index exam_uploads_attempt_idx on private.exam_uploads(attempt_id) where attempt_id is not null;

create table private.exam_questions (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references private.exams(id) on delete restrict,
 position integer not null check(position between 0 and 99),
 type text not null check(type in ('single_choice','multiple_choice','number','essay')),
 text text not null default '' check(length(text)<=10000),
 image_id uuid references private.exam_uploads(id) on delete restrict,
 points integer not null check(points between 0 and 1000),
 response_mode text not null default 'text' check(response_mode in ('text','photo','both')),
 unique(exam_id,position),
 check(type='essay' or response_mode='text')
);
create index exam_questions_image_idx on private.exam_questions(image_id) where image_id is not null;
create table private.exam_options (
 id uuid primary key default gen_random_uuid(),
 question_id uuid not null references private.exam_questions(id) on delete cascade,
 position integer not null check(position between 0 and 7),
 text text not null default '' check(length(text)<=500),
 unique(question_id,position)
);
-- Never returned to a student before answer review.
create table private.exam_keys (
 question_id uuid primary key references private.exam_questions(id) on delete cascade,
 correct_option_ids uuid[] not null default '{}',
 number_value numeric check(number_value is null or number_value<>'NaN'::numeric),
 number_tolerance numeric not null default 0 check(number_tolerance>=0 and number_tolerance<>'NaN'::numeric),
 model_text text not null default '' check(length(model_text)<=10000),
 model_image_id uuid references private.exam_uploads(id) on delete restrict
);
create index exam_keys_model_image_idx on private.exam_keys(model_image_id) where model_image_id is not null;

-- A Group's window: a LINK to one of its sessions (auto: the first session on or after "starting from"; picked: another one), or a
-- custom pair for a Group with no session. The times are read live from the session until the window has opened; from then on the
-- times it opened with are stored (frozen_*) and later moves of that session change nothing (owner's answer 5).
create table private.exam_group_windows (
 exam_id uuid not null references private.exams(id) on delete restrict,
 group_id uuid not null references public.study_groups(id) on delete restrict,
 source text not null check(source in ('auto','picked','custom')),
 session_id uuid references public.group_sessions(id) on delete restrict,
 custom_opens_at timestamptz,
 custom_closes_at timestamptz,
 frozen_opens_at timestamptz,
 frozen_closes_at timestamptz,
 updated_by uuid references public.profiles(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(exam_id,group_id),
 check((source='custom')=(session_id is null)),
 check((source='custom')=(custom_opens_at is not null and custom_closes_at is not null)),
 check(source='custom' or (custom_opens_at is null and custom_closes_at is null)),
 check(custom_closes_at is null or custom_closes_at>custom_opens_at),
 check((frozen_opens_at is null)=(frozen_closes_at is null))
);
create index exam_group_windows_group_idx on private.exam_group_windows(group_id);
create index exam_group_windows_session_idx on private.exam_group_windows(session_id) where session_id is not null;
create index exam_group_windows_updater_idx on private.exam_group_windows(updated_by) where updated_by is not null;

-- One row per try. The deadline is fixed when the try starts (owner's answer 5).
create table private.exam_attempts (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references private.exams(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 number integer not null check(number in (1,2)),
 window_group_id uuid references public.study_groups(id) on delete restrict,
 started_at timestamptz not null,
 deadline_at timestamptz not null,
 submitted_at timestamptz,
 status text not null default 'in_progress' check(status in ('in_progress','submitted')),
 auto_submitted boolean not null default false,
 revision bigint not null default 0 check(revision>=0),
 unique(exam_id,user_id,number),
 check(deadline_at>started_at),
 check((status='submitted')=(submitted_at is not null))
);
create unique index exam_attempts_one_open on private.exam_attempts(exam_id,user_id) where status='in_progress';
create index exam_attempts_user_idx on private.exam_attempts(user_id);
create index exam_attempts_group_idx on private.exam_attempts(window_group_id) where window_group_id is not null;
alter table private.exam_uploads add constraint exam_uploads_attempt_fk foreign key(attempt_id) references private.exam_attempts(id) on delete restrict;

-- The paper as this student sees it on this try: question order and each choice's option order (stored, so a refresh keeps it).
create table private.exam_attempt_items (
 attempt_id uuid not null references private.exam_attempts(id) on delete restrict,
 question_id uuid not null references private.exam_questions(id) on delete restrict,
 position integer not null check(position between 0 and 99),
 option_order uuid[] not null default '{}',
 primary key(attempt_id,question_id),
 unique(attempt_id,position)
);
create index exam_attempt_items_question_idx on private.exam_attempt_items(question_id);
create table private.exam_responses (
 attempt_id uuid not null references private.exam_attempts(id) on delete restrict,
 question_id uuid not null references private.exam_questions(id) on delete restrict,
 option_ids uuid[] not null default '{}',
 number_value numeric check(number_value is null or number_value<>'NaN'::numeric),
 text text not null default '' check(length(text)<=10000),
 upload_id uuid references private.exam_uploads(id) on delete restrict,
 kept boolean not null default false,
 saved_at timestamptz not null default clock_timestamp(),
 primary key(attempt_id,question_id)
);
create index exam_responses_question_idx on private.exam_responses(question_id);
create index exam_responses_upload_idx on private.exam_responses(upload_id) where upload_id is not null;
-- Points per question per try, in steps of 0.5 (null = an essay waiting for a mark).
create table private.exam_marks (
 attempt_id uuid not null references private.exam_attempts(id) on delete restrict,
 question_id uuid not null references private.exam_questions(id) on delete restrict,
 points numeric(7,1) check(points>=0 and points*2=trunc(points*2)),
 auto boolean not null default false,
 note text not null default '' check(length(note)<=2000),
 primary key(attempt_id,question_id)
);
create index exam_marks_question_idx on private.exam_marks(question_id);

-- One result per exam and student, for both kinds: the latest handed-in try (online), or the typed mark or Absent (paper). Absent is
-- not 0. A release, a notice and Reports look at this row.
create table private.exam_results (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references private.exams(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 final_attempt_id uuid references private.exam_attempts(id) on delete restrict,
 paper_mark numeric(6,1) check(paper_mark>=0 and paper_mark*2=trunc(paper_mark*2)),
 absent boolean not null default false,
 status text not null default 'waiting' check(status in ('waiting','corrected')),
 score numeric(7,1),
 max_score numeric(7,1),
 released_at timestamptz,
 released_by uuid references public.profiles(id) on delete restrict,
 revision bigint not null default 0 check(revision>=0),
 updated_by uuid references public.profiles(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 unique(exam_id,user_id),
 check(not (absent and paper_mark is not null)),
 check(final_attempt_id is null or (paper_mark is null and not absent)),
 check(released_at is null or status='corrected'),
 check(released_by is null or released_at is not null)
);
create index exam_results_user_idx on private.exam_results(user_id);
create index exam_results_attempt_idx on private.exam_results(final_attempt_id) where final_attempt_id is not null;
create index exam_results_releaser_idx on private.exam_results(released_by) where released_by is not null;
create index exam_results_updater_idx on private.exam_results(updated_by) where updated_by is not null;

create table private.exam_audit (
 id bigint generated always as identity primary key,
 exam_id uuid not null references private.exams(id) on delete restrict,
 actor_id uuid references public.profiles(id) on delete restrict,
 action text not null,
 user_id uuid references public.profiles(id) on delete restrict,
 reason text,
 before_data jsonb,
 after_data jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index exam_audit_exam_idx on private.exam_audit(exam_id,created_at);
create index exam_audit_actor_idx on private.exam_audit(actor_id);
create index exam_audit_user_idx on private.exam_audit(user_id) where user_id is not null;

do $$ declare n text;begin
 foreach n in array array['exams','exam_chapters','exam_uploads','exam_questions','exam_options','exam_keys','exam_group_windows','exam_attempts','exam_attempt_items','exam_responses','exam_marks','exam_results','exam_audit'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

-- Storage: one private bucket, images up to 5 MB. Policies go through private.exam_storage only; there is no delete policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lms-exams','lms-exams',false,5242880,array['image/png','image/jpeg','image/webp'])
 on conflict(id) do nothing;

-- ---------------------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------------------
-- An exam's run is a run of its course and the pair never changes; kind, family and version never change.
create function private.exam_row_integrity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='exams' then
  if not exists(select 1 from public.course_offerings o where o.id=new.offering_id and o.course_id=new.course_id) then
   raise exception 'The run is not a run of this course' using errcode='23514';end if;
  if tg_op='UPDATE' and (new.course_id,new.offering_id,new.kind,new.family_id,new.version,new.supersedes_id,new.created_by) is distinct from (old.course_id,old.offering_id,old.kind,old.family_id,old.version,old.supersedes_id,old.created_by) then
   raise exception 'An exam keeps its course, run, kind and version' using errcode='23514';end if;
 elsif tg_table_name='exam_chapters' then
  if not exists(select 1 from public.course_modules m join private.exams e on e.course_id=m.course_id where m.id=new.module_id and e.id=new.exam_id) then
   raise exception 'The chapter is not in this course' using errcode='23514';end if;
 elsif tg_table_name='exam_group_windows' then
  if not exists(select 1 from public.study_groups g join private.exams e on e.offering_id=g.offering_id where g.id=new.group_id and e.id=new.exam_id) then
   raise exception 'The Group is not in this run' using errcode='23514';end if;
  if new.session_id is not null and not exists(select 1 from public.group_sessions s where s.id=new.session_id and s.group_id=new.group_id) then
   raise exception 'The session is not a session of this Group' using errcode='23514';end if;
 end if;
 return new;
end $$;
create trigger exam_row_integrity before insert or update on private.exams for each row execute function private.exam_row_integrity();
create trigger exam_row_integrity before insert or update on private.exam_chapters for each row execute function private.exam_row_integrity();
create trigger exam_row_integrity before insert or update on private.exam_group_windows for each row execute function private.exam_row_integrity();

-- A session that is moved or cancelled after its window opened: every exam window linked to it keeps the times it had before the change
-- (owner's answer 5). That covers a stored link and a Group whose 'auto' link is not stored yet but whose rule (first session on or after
-- "starting from") pointed at this session before the change: its link is stored then, frozen. Before it opened, nothing is stored and the
-- exam follows the session. Freezing never waits for a read. Runs inside the existing session commands.
create function private.exam_window_freeze() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.starts_at,old.ends_at,old.cancelled) is not distinct from (new.starts_at,new.ends_at,new.cancelled) or old.cancelled or old.starts_at>clock_timestamp() then return new;end if;
 update private.exam_group_windows w set frozen_opens_at=old.starts_at,frozen_closes_at=old.ends_at
  from private.exams e where w.session_id=new.id and w.frozen_opens_at is null and e.id=w.exam_id and e.status<>'draft';
 insert into private.exam_group_windows(exam_id,group_id,source,session_id,frozen_opens_at,frozen_closes_at)
  select e.id,g.id,'auto',new.id,old.starts_at,old.ends_at
  from public.study_groups g join private.exams e on e.offering_id=g.offering_id
  where g.id=new.group_id and g.status='active' and e.status='published' and e.kind='online' and e.timing='per_group' and e.starting_from is not null
   and old.starts_at>=private.exam_day_start(e.starting_from)
   and not exists(select 1 from private.exam_group_windows w where w.exam_id=e.id and w.group_id=g.id)
   and not exists(select 1 from public.group_sessions x where x.group_id=g.id and x.id<>new.id and not x.cancelled and x.starts_at>=private.exam_day_start(e.starting_from)
    and (x.starts_at,x.id)<(old.starts_at,old.id))
  on conflict(exam_id,group_id) do nothing;
 return new;
end $$;
create trigger exam_window_freeze after update on public.group_sessions for each row execute function private.exam_window_freeze();

-- A Group created in a run with published, unclosed per-Group exams is linked when it is created (owner's answer 4, by the same rule,
-- source 'auto'); so is a Group that gets its first session later. Constraint triggers deferred to the end of the transaction: the Group
-- command creates the Group, then its weekly times, then its sessions, so the rule sees every session the command made.
-- "Unclosed" is judged without the new Group: every other Group has a window and the latest of them has not closed.
-- Locks: a new Group waits for an exam being written (it is invisible to that writer, so no cycle). A new session skips an exam row that
-- is locked for writing: that writer (publish, reschedule, a window change) materializes and links this Group itself after this commit,
-- and the freeze above covers a link that is not stored yet.
create function private.exam_link_group() returns trigger language plpgsql security definer set search_path='' as $$
declare grp public.study_groups; ex uuid;
begin
 if tg_table_name='study_groups' then select * into grp from public.study_groups where id=new.id;
 else select * into grp from public.study_groups where id=new.group_id;end if;
 if grp.id is null or grp.status<>'active' then return null;end if;
 if not exists(select 1 from private.exams e where e.offering_id=grp.offering_id and e.status='published' and e.kind='online' and e.timing='per_group'
  and not exists(select 1 from private.exam_group_windows w where w.exam_id=e.id and w.group_id=grp.id)) then return null;end if;
 for ex in select e.id from private.exams e where e.offering_id=grp.offering_id and e.status='published' and e.kind='online' and e.timing='per_group' order by e.id loop
  if tg_table_name='study_groups' then perform 1 from private.exams where id=ex and status='published' for key share;
  else perform 1 from private.exams where id=ex and status='published' for key share skip locked;
  end if;
  if not found then continue;end if;
  if exists(select 1 from private.exam_group_windows w where w.exam_id=ex and w.group_id=grp.id) then continue;end if;
  if exists(select 1 from private.exam_windows(ex) w where w.group_id<>grp.id) and not exists(select 1 from private.exam_windows(ex) w where w.group_id<>grp.id and w.state<>'ok')
   and (select max(w.closes_at) from private.exam_windows(ex) w where w.group_id<>grp.id)<=clock_timestamp() then continue;end if;
  insert into private.exam_group_windows(exam_id,group_id,source,session_id)
   select ex,w.group_id,'auto',w.session_id from private.exam_windows(ex) w where w.group_id=grp.id and not w.stored and w.session_id is not null
   on conflict(exam_id,group_id) do nothing;
 end loop;
 return null;
end $$;
create constraint trigger exam_link_new_group after insert on public.study_groups deferrable initially deferred for each row execute function private.exam_link_group();
create constraint trigger exam_link_new_session after insert on public.group_sessions deferrable initially deferred for each row execute function private.exam_link_group();

-- ---------------------------------------------------------------------------------------
-- Internal helpers (no API role may call them)
-- ---------------------------------------------------------------------------------------
create function private.exam_day_start(p_day date) returns timestamptz language sql immutable security definer set search_path='' as $$
 select (p_day::timestamp) at time zone 'Africa/Cairo'
$$;
create function private.exam_iso(p_value jsonb) returns timestamptz language plpgsql immutable security definer set search_path='' as $$
begin
 if p_value is null or jsonb_typeof(p_value)='null' then return null;end if;
 if jsonb_typeof(p_value)<>'string' or p_value#>>'{}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
  raise exception 'Times need an explicit offset' using errcode='23514';end if;
 return (p_value#>>'{}')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid time' using errcode='23514';
end $$;

-- The assistant rights shared by homework and exams (owner's answer 6): the run's managers always; its support staff when their
-- right for this course is on in private.homework_assistant_permissions (no row = on). homework_staff is not changed.
create function private.course_assistant_right(p_offering uuid,p_course uuid,p_right text) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_offering(p_offering) or (private.can_support_offering(p_offering) and coalesce((select case p_right when 'correct' then p.can_correct when 'release' then p.can_release end
  from private.homework_assistant_permissions p where p.course_id=p_course and p.user_id=(select private.current_app_user_id())),true) and p_right in ('correct','release'))
$$;
-- author = course edit rights (owner's answer 12); grade = the run's staff (read student work); manage; correct; release; view.
create function private.exam_staff(p_exam uuid,p_capability text default 'view') returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.exams e where e.id=p_exam and case p_capability
  when 'author' then private.can_edit_course(e.course_id)
  when 'grade' then private.can_support_offering(e.offering_id)
  when 'manage' then private.can_manage_offering(e.offering_id)
  when 'correct' then private.course_assistant_right(e.offering_id,e.course_id,'correct')
  when 'release' then private.course_assistant_right(e.offering_id,e.course_id,'release')
  else private.can_edit_course(e.course_id) or private.can_support_offering(e.offering_id) end)
$$;
-- An active, current enrollment in the exam's run (any person, no caller check).
create function private.exam_enrolled_user(p_exam uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.exams e join public.enrollments x on x.offering_id=e.offering_id
  where e.id=p_exam and x.user_id=p_user and x.status='active' and (x.enrolled_at is null or x.enrolled_at<=clock_timestamp()) and (x.expires_at is null or clock_timestamp()<x.expires_at))
$$;
-- The caller may take (or see) this exam as a student: published (or archived after it), active run, published course, enrolled.
create function private.exam_taker(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from private.exams e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=e.course_id
  where e.id=p_exam and e.status in ('published','archived') and e.published_at is not null and o.status='active' and c.status='published')
  and private.exam_enrolled_user(p_exam,(select private.current_app_user_id()))
$$;

-- Every active Group of an online per-Group exam with its window. state: ok, cancelled (linked session cancelled before it opened),
-- needs_time (no session on or after "starting from" and no custom time). stored=false means the Group has no row yet (no session yet, or
-- inside the transaction that created it); its link is the same rule, stored when its sessions are created (exam_link_group) or at the next
-- write or read. A session move after opening freezes it either way (exam_window_freeze).
create function private.exam_windows(p_exam uuid) returns table(group_id uuid,group_name text,source text,session_id uuid,opens_at timestamptz,closes_at timestamptz,state text,frozen boolean,stored boolean)
language sql stable security definer set search_path='' as $$
 select g.id,g.name,coalesce(w.source,'auto'),coalesce(w.session_id,nxt.id),
  case when w.frozen_opens_at is not null then w.frozen_opens_at when w.source='custom' then w.custom_opens_at when w.session_id is not null then case when s.cancelled then null else s.starts_at end else nxt.starts_at end,
  case when w.frozen_opens_at is not null then w.frozen_closes_at when w.source='custom' then w.custom_closes_at when w.session_id is not null then case when s.cancelled then null else s.ends_at end else nxt.ends_at end,
  case when w.frozen_opens_at is not null or w.source='custom' then 'ok' when w.session_id is not null then case when s.cancelled then 'cancelled' else 'ok' end when nxt.id is not null then 'ok' else 'needs_time' end,
  w.frozen_opens_at is not null,w.group_id is not null
 from private.exams e join public.study_groups g on g.offering_id=e.offering_id and g.status='active'
 left join private.exam_group_windows w on w.exam_id=e.id and w.group_id=g.id
 left join public.group_sessions s on s.id=w.session_id
 left join lateral (select x.id,x.starts_at,x.ends_at from public.group_sessions x where w.group_id is null and e.starting_from is not null and x.group_id=g.id and not x.cancelled
  and x.starts_at>=private.exam_day_start(e.starting_from) order by x.starts_at,x.id limit 1) nxt on true
 where e.id=p_exam and e.kind='online' and e.timing='per_group'
$$;

-- One student's window. Same time: the exam's. Per Group: of their Groups, the first window that has not closed (else the last one
-- that closed); in no Group: from the earliest Group start to the latest Group end. state: ok, cancelled, needs_time, none.
create function private.exam_student_window(p_exam uuid,p_user uuid,out group_id uuid,out opens_at timestamptz,out closes_at timestamptz,out state text)
language plpgsql stable security definer set search_path='' as $$
declare e private.exams; mine uuid[]; now_ timestamptz:=clock_timestamp();
begin
 select * into e from private.exams where id=p_exam;
 if e.id is null or e.kind<>'online' then state:='none';return;end if;
 if e.timing='same_time' then opens_at:=e.opens_at;closes_at:=e.closes_at;state:=case when e.opens_at is null then 'needs_time' else 'ok' end;return;end if;
 mine:=array(select m.group_id from public.group_memberships m join public.study_groups g on g.id=m.group_id
  where m.offering_id=e.offering_id and m.user_id=p_user and g.status='active' and m.starts_at<=now_ and (m.ends_at is null or m.ends_at>now_));
 if cardinality(mine)>0 then
  select w.group_id,w.opens_at,w.closes_at,'ok' into group_id,opens_at,closes_at,state from private.exam_windows(p_exam) w
   where w.group_id=any(mine) and w.state='ok' order by (w.closes_at>now_) desc,case when w.closes_at>now_ then w.opens_at end,w.closes_at desc,w.group_id limit 1;
  if state is null then
   select w.state into state from private.exam_windows(p_exam) w where w.group_id=any(mine) order by w.state='cancelled' desc,w.group_id limit 1;
   state:=coalesce(state,'none');
  end if;
  return;
 end if;
 select min(w.opens_at),max(w.closes_at) into opens_at,closes_at from private.exam_windows(p_exam) w where w.state='ok';
 state:=case when opens_at is null then 'none' else 'ok' end;
end $$;

-- The LAST close: every Group's window (and so the no-Group window inside it), or the one window for all. Null while any Group has no
-- window (cancelled or needs a time: answer review and auto-release wait, owner's answer 3) or the exam is a draft.
create function private.exam_last_close(p_exam uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select case when e.kind<>'online' or e.status='draft' or e.published_at is null then null
  when e.timing='same_time' then e.closes_at
  when not exists(select 1 from private.exam_windows(e.id) w) or exists(select 1 from private.exam_windows(e.id) w where w.state<>'ok') then null
  else (select max(w.closes_at) from private.exam_windows(e.id) w) end
 from private.exams e where e.id=p_exam
$$;
create function private.exam_closed(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.exam_last_close(p_exam)<=clock_timestamp(),false)
$$;
-- Answer review for the caller: staff of the exam, or a student who handed in a try, once the LAST window has closed.
create function private.exam_review_open(p_exam uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.exam_staff(p_exam) or (private.exam_closed(p_exam) and private.exam_taker(p_exam)
  and exists(select 1 from private.exam_attempts a where a.exam_id=p_exam and a.user_id=(select private.current_app_user_id()) and a.status='submitted'))
$$;
-- A result counts as released when it was released, or the exam releases by itself (no essays) and the LAST window has closed.
create function private.exam_released(p_result uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.exam_results r join private.exams e on e.id=r.exam_id where r.id=p_result and r.status='corrected'
  and (r.released_at is not null or (e.auto_release and private.exam_closed(e.id))))
$$;

-- Store the 'auto' link of every active Group that has none yet (a Group added after publishing, owner's answer 4).
create function private.exam_link(p_exam uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.exam_group_windows(exam_id,group_id,source,session_id)
  select p_exam,w.group_id,'auto',w.session_id from private.exam_windows(p_exam) w where not w.stored and w.session_id is not null
  on conflict(exam_id,group_id) do nothing;
end $$;
-- Sessions exist only 90 days ahead until something reads a Group: create them before linking. Teacher writes only.
create function private.exam_materialize(p_exam uuid) returns void language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 for g in select s.id from public.study_groups s join private.exams e on e.offering_id=s.offering_id where e.id=p_exam and s.status='active' order by s.id limit 100 loop
  perform private.materialize_group(g);
 end loop;
end $$;

create function private.exam_audit_write(p_exam uuid,p_action text,p_user uuid,p_reason text,p_before jsonb,p_after jsonb) returns void language sql security definer set search_path='' as $$
 insert into private.exam_audit(exam_id,actor_id,action,user_id,reason,before_data,after_data) values(p_exam,(select private.current_app_user_id()),p_action,p_user,p_reason,p_before,p_after)
$$;

-- Marks of a handed-in try, and the student's result. Choice: the exact set of right answers; number: within the tolerance; an empty
-- essay is 0; another essay waits for a mark, unless it is unchanged from the first try and that try's mark exists (fix mistakes).
create function private.exam_mark_try(p_attempt uuid) returns void language plpgsql security definer set search_path='' as $$
declare a private.exam_attempts; first_try uuid; total numeric; maximum numeric; waiting integer; res private.exam_results;
begin
 select * into a from private.exam_attempts where id=p_attempt;
 if a.status<>'submitted' then return;end if;
 if a.number=2 then select id into first_try from private.exam_attempts where exam_id=a.exam_id and user_id=a.user_id and number=1;end if;
 delete from private.exam_marks where attempt_id=a.id and auto;
 insert into private.exam_marks(attempt_id,question_id,points,auto)
 select a.id,q.id,
  case when q.type in ('single_choice','multiple_choice') then case when coalesce(cardinality(r.option_ids),0)>0
     and (select array_agg(x order by x) from unnest(r.option_ids) x)=(select array_agg(x order by x) from unnest(k.correct_option_ids) x) then q.points else 0 end
   when q.type='number' then case when r.number_value is not null and k.number_value is not null and abs(r.number_value-k.number_value)<=k.number_tolerance then q.points else 0 end
   when coalesce(btrim(r.text),'')='' and r.upload_id is null then 0
   when first_try is not null and exists(select 1 from private.exam_responses p join private.exam_marks pm on pm.attempt_id=p.attempt_id and pm.question_id=p.question_id
     where p.attempt_id=first_try and p.question_id=q.id and p.text=r.text and p.upload_id is not distinct from r.upload_id and pm.points is not null)
    then (select pm.points from private.exam_marks pm where pm.attempt_id=first_try and pm.question_id=q.id)
   else null end,
  q.type<>'essay' or (coalesce(btrim(r.text),'')='' and r.upload_id is null) or first_try is not null
 from private.exam_attempt_items i join private.exam_questions q on q.id=i.question_id left join private.exam_keys k on k.question_id=q.id
 left join private.exam_responses r on r.attempt_id=a.id and r.question_id=q.id
 where i.attempt_id=a.id and not exists(select 1 from private.exam_marks m where m.attempt_id=a.id and m.question_id=q.id);
 -- An essay mark that was not carried stays for the teacher (auto=false and null).
 update private.exam_marks m set auto=false where m.attempt_id=a.id and m.points is null;
 select coalesce(sum(m.points),0),count(*) filter(where m.points is null) into total,waiting from private.exam_marks m where m.attempt_id=a.id;
 select coalesce(sum(q.points),0) into maximum from private.exam_attempt_items i join private.exam_questions q on q.id=i.question_id where i.attempt_id=a.id;
 select * into res from private.exam_results where exam_id=a.exam_id and user_id=a.user_id for update;
 if res.id is null then
  insert into private.exam_results(exam_id,user_id,final_attempt_id,status,score,max_score,updated_at)
  values(a.exam_id,a.user_id,a.id,case when waiting=0 then 'corrected' else 'waiting' end,case when waiting=0 then total end,maximum,clock_timestamp());
 else
  update private.exam_results set final_attempt_id=a.id,status=case when waiting=0 then 'corrected' else 'waiting' end,score=case when waiting=0 then total end,
   max_score=maximum,released_at=null,released_by=null,revision=revision+1,updated_at=clock_timestamp() where id=res.id;
 end if;
end $$;

-- Hand in an unfinished try whose deadline passed, as it stood (answers saved before the deadline count).
create function private.exam_finish(p_attempt uuid,p_auto boolean) returns void language plpgsql security definer set search_path='' as $$
declare a private.exam_attempts;
begin
 select * into a from private.exam_attempts where id=p_attempt for update;
 if a.status<>'in_progress' then return;end if;
 update private.exam_attempts set status='submitted',submitted_at=case when p_auto then a.deadline_at else least(clock_timestamp(),a.deadline_at) end,auto_submitted=p_auto,revision=revision+1 where id=a.id;
 perform private.exam_mark_try(a.id);
 perform private.exam_audit_write(a.exam_id,case when p_auto then 'auto_submit' else 'submit' end,a.user_id,null,null,jsonb_build_object('attemptId',a.id,'number',a.number));
end $$;

-- Settle what the clock decided since the last action: hand in expired tries (one student, or all), store auto-release (with its
-- notices) once the LAST window closed, and store the links of Groups added after publishing. Idempotent.
create function private.exam_settle(p_exam uuid,p_user uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams; t uuid; n integer;
begin
 select * into e from private.exams where id=p_exam;
 if e.id is null or e.kind<>'online' or e.status='draft' then return;end if;
 -- Only one settle of an exam at a time when there is something to settle. Every caller settles BEFORE it locks a try or a result.
 if exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at<=clock_timestamp() and (p_user is null or a.user_id=p_user))
  or (e.auto_release and exists(select 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null) and private.exam_closed(e.id)) then
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':exam-settle',0));
 end if;
 for t in select a.id from private.exam_attempts a where a.exam_id=e.id and a.status='in_progress' and a.deadline_at<=clock_timestamp() and (p_user is null or a.user_id=p_user) order by a.id loop
  perform private.exam_finish(t,true);
 end loop;
 if e.auto_release and private.exam_closed(e.id) and exists(select 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null) then
  perform 1 from private.exam_results r where r.exam_id=e.id and r.status='corrected' and r.released_at is null order by r.id for update;
  update private.exam_results set released_at=clock_timestamp(),revision=revision+1 where exam_id=e.id and status='corrected' and released_at is null;
  get diagnostics n=row_count;
  if n>0 then insert into private.exam_audit(exam_id,actor_id,action,after_data) values(e.id,null,'auto_release',jsonb_build_object('released',n));end if;
 end if;
 if e.timing='per_group' and e.status='published' then perform private.exam_link(e.id);end if;
end $$;

-- The new order of a try: questions and each choice's options, mixed when the exam says so.
create function private.exam_items(p_attempt uuid,p_exam uuid,p_shuffle boolean) returns void language sql security definer set search_path='' as $$
 insert into private.exam_attempt_items(attempt_id,question_id,position,option_order)
 select p_attempt,q.id,(row_number() over(order by case when p_shuffle then random() end,q.position)-1)::integer,
  coalesce((select array_agg(o.id order by case when p_shuffle then random() end,o.position) from private.exam_options o where o.question_id=q.id),'{}'::uuid[])
 from private.exam_questions q where q.exam_id=p_exam
$$;

do $$ declare f text;begin
 foreach f in array array['exam_row_integrity()','exam_window_freeze()','exam_link_group()','exam_day_start(date)','exam_iso(jsonb)','course_assistant_right(uuid,uuid,text)','exam_staff(uuid,text)',
  'exam_enrolled_user(uuid,uuid)','exam_taker(uuid)','exam_windows(uuid)','exam_student_window(uuid,uuid)','exam_last_close(uuid)','exam_closed(uuid)','exam_review_open(uuid)',
  'exam_released(uuid)','exam_link(uuid)','exam_materialize(uuid)','exam_audit_write(uuid,text,uuid,text,jsonb,jsonb)','exam_mark_try(uuid)','exam_finish(uuid,boolean)',
  'exam_settle(uuid,uuid)','exam_items(uuid,uuid,boolean)'] loop
  execute format('revoke all on function private.%s from public,anon,authenticated,service_role',f);
 end loop;
end $$;

-- Visibility of a ready upload: the exam's staff; its student uploader; a question picture to a student whose try holds that question;
-- a model answer picture during answer review only (after the LAST window, to staff and to a student who handed in).
create function private.exam_upload_visible(p_upload uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.exam_uploads x where x.id=p_upload and x.status='ready' and (
  private.exam_staff(x.exam_id)
  or exists(select 1 from private.exam_questions q where q.image_id=x.id and private.exam_staff(q.exam_id))
  or exists(select 1 from private.exam_keys k join private.exam_questions q on q.id=k.question_id where k.model_image_id=x.id and private.exam_staff(q.exam_id))
  or (x.purpose='answer' and x.uploaded_by=(select private.current_app_user_id()) and private.exam_taker(x.exam_id))
  or (x.purpose='question' and exists(select 1 from private.exam_questions q join private.exam_attempt_items i on i.question_id=q.id join private.exam_attempts a on a.id=i.attempt_id
   where q.image_id=x.id and a.user_id=(select private.current_app_user_id()) and private.exam_taker(a.exam_id)))
  or (x.purpose='model' and exists(select 1 from private.exam_keys k join private.exam_questions q on q.id=k.question_id where k.model_image_id=x.id and private.exam_review_open(q.exam_id)))))
$$;
-- The storage policies of lms-exams. Insert: the uploader's own pending upload (an author's picture, or a photo answer of the caller's
-- open try before its deadline). Read: a visible ready upload, or the uploader's own pending one. Nothing else; no update, no delete.
create function private.exam_storage(p_bucket text,p_path text,p_action text) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if p_bucket is distinct from 'lms-exams' then return false;end if;
 if p_action='insert' then perform 1 from private.exam_uploads where path=p_path for share;end if;
 return (select private.is_active_user() and exists(select 1 from private.exam_uploads u where u.path=p_path and case p_action
  when 'insert' then u.status='pending' and u.expires_at>clock_timestamp() and u.uploaded_by=(select private.current_app_user_id()) and case when u.purpose='answer'
   then exists(select 1 from private.exam_attempts a where a.id=u.attempt_id and a.user_id=u.uploaded_by and a.status='in_progress' and a.deadline_at>clock_timestamp()) and private.exam_taker(u.exam_id)
   else private.exam_staff(u.exam_id,'author') end
  when 'read' then (u.status='ready' and private.exam_upload_visible(u.id)) or (u.status='pending' and u.uploaded_by=(select private.current_app_user_id()) and u.expires_at>clock_timestamp())
  else false end));
end $$;
revoke all on function private.exam_upload_visible(uuid),private.exam_storage(text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.exam_storage(text,text,text) to authenticated;
create policy exam_objects_insert on storage.objects for insert to authenticated with check(private.exam_storage(bucket_id,name,'insert'));
create policy exam_objects_read on storage.objects for select to authenticated using(private.exam_storage(bucket_id,name,'read'));

-- ---------------------------------------------------------------------------------------
-- Notices: one per release of a result (key: the result and its release time). Auto-release stores its release at the next action after
-- the LAST window closed (owner's answer 9); that write sends them. The link is decided with the student screens (null until then).
-- ---------------------------------------------------------------------------------------
create function private.exam_result_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if new.released_at is null or new.released_at is not distinct from old.released_at then return new;end if;
 select c.organization_id into org from private.exams e join public.courses c on c.id=e.course_id where e.id=new.exam_id;
 perform private.emit_notification('exam:'||new.id||':'||new.released_at,'exam_released',org,new.id,array[new.user_id]);
 return new;
end $$;
create trigger exam_result_notice after update of released_at on private.exam_results for each row execute function private.exam_result_notice();
revoke all on function private.exam_result_notice() from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------
-- JSON
-- ---------------------------------------------------------------------------------------
-- A question as shown. Keys only when p_key. Options in p_order (the try's stored order), else as authored.
create function private.exam_question_json(p_question uuid,p_key boolean,p_order uuid[] default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',q.id,'position',q.position,'type',q.type,'text',q.text,'imageId',q.image_id,'points',q.points,'responseMode',q.response_mode,
  'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text) order by coalesce(array_position(p_order,o.id),o.position),o.position) from private.exam_options o where o.question_id=q.id),'[]'::jsonb))
  ||case when p_key then jsonb_build_object('correctOptionIds',to_jsonb(coalesce(k.correct_option_ids,'{}'::uuid[])),'numberValue',k.number_value,'tolerance',coalesce(k.number_tolerance,0),
   'modelText',coalesce(k.model_text,''),'modelImageId',k.model_image_id) else '{}'::jsonb end
 from private.exam_questions q left join private.exam_keys k on k.question_id=q.id where q.id=p_question
$$;
create function private.exam_settings_json(p_exam uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',e.id,'familyId',e.family_id,'version',e.version,'courseId',e.course_id,'offeringId',e.offering_id,'kind',e.kind,'title',e.title,'description',e.description,
  'status',e.status,'publishedAt',e.published_at,'maxMarks',e.max_marks,'heldOn',e.held_on,'timing',e.timing,'startingFrom',e.starting_from,'opensAt',e.opens_at,'closesAt',e.closes_at,
  'timeLimitMinutes',e.time_limit_minutes,'tries',e.tries_mode,'shuffle',e.shuffle,'photosAllowed',e.photos_allowed,'autoRelease',e.auto_release,'coversAllChapters',e.covers_all_chapters,
  'chapterIds',coalesce((select jsonb_agg(c.module_id order by c.module_id) from private.exam_chapters c where c.exam_id=e.id),'[]'::jsonb),
  'questionCount',(select count(*) from private.exam_questions q where q.exam_id=e.id),
  'totalPoints',case when e.kind='paper' then e.max_marks else (select coalesce(sum(q.points),0) from private.exam_questions q where q.exam_id=e.id) end,
  'hasEssays',exists(select 1 from private.exam_questions q where q.exam_id=e.id and q.type='essay'))
 from private.exams e where e.id=p_exam
$$;

-- ---------------------------------------------------------------------------------------
-- Authoring (course edit rights, owner's answer 12)
-- ---------------------------------------------------------------------------------------
-- Ready to publish (checked again when a published exam without work is edited): an online exam has questions; auto-release needs no
-- essay; photo answers need photos on; the times are set.
create function private.exam_check(p_exam uuid) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams;
begin
 select * into e from private.exams where id=p_exam;
 if e.kind='online' then
  if not exists(select 1 from private.exam_questions where exam_id=e.id) then raise exception 'Add a question first' using errcode='23514';end if;
  if e.auto_release and exists(select 1 from private.exam_questions where exam_id=e.id and type='essay') then raise exception 'Auto-release needs an exam without essays' using errcode='23514';end if;
  if not e.photos_allowed and exists(select 1 from private.exam_questions where exam_id=e.id and response_mode<>'text') then raise exception 'Photo answers are off for this exam' using errcode='23514';end if;
  if e.timing='same_time' and (e.opens_at is null or e.closes_at is null) then raise exception 'Choose when the exam opens and closes' using errcode='23514';end if;
  if e.timing='per_group' and e.starting_from is null then raise exception 'Choose the starting day' using errcode='23514';end if;
 end if;
end $$;

-- Times of an online exam (Save before work starts, Reschedule after). Once the one window (same time) opened it keeps its times
-- (PT409 window_open); per Group, only Groups whose window has not opened follow the new day.
create function private.exam_apply_timing(p_exam uuid,d jsonb) returns void language plpgsql security definer set search_path='' as $$
declare o private.exams; e private.exams; t text; sf date; oa timestamptz; ca timestamptz; now_ timestamptz:=clock_timestamp();
begin
 select * into o from private.exams where id=p_exam;
 t:=case when d ? 'timing' then d->>'timing' else o.timing end;
 if t is null or t not in ('per_group','same_time') then raise exception 'Invalid timing' using errcode='23514';end if;
 sf:=case when d ? 'startingFrom' then (d->>'startingFrom')::date else o.starting_from end;
 oa:=case when d ? 'opensAt' then private.exam_iso(d->'opensAt') else o.opens_at end;
 ca:=case when d ? 'closesAt' then private.exam_iso(d->'closesAt') else o.closes_at end;
 if t='per_group' then oa:=null;ca:=null;else sf:=null;end if;
 if (t,sf,oa,ca) is not distinct from (o.timing,o.starting_from,o.opens_at,o.closes_at) then return;end if;
 if o.status<>'draft' then
  if (o.timing='same_time' and o.opens_at<=now_) or (o.timing='per_group' and t<>'per_group' and exists(select 1 from private.exam_windows(o.id) w where w.state='ok' and w.opens_at<=now_)) then
   raise exception 'The exam has opened; its times are kept' using errcode='PT409',detail='{"reason":"window_open"}';end if;
  if t='same_time' and ca<=now_ then raise exception 'The new time has passed' using errcode='23514';end if;
 end if;
 update private.exams set timing=t,starting_from=sf,opens_at=oa,closes_at=ca where id=o.id returning * into e;
 if e.status<>'draft' and e.timing='per_group' then
  -- Follow the new day: auto links that have not opened are relinked; picked, custom and opened windows stay.
  delete from private.exam_group_windows w using public.group_sessions s where w.exam_id=e.id and w.source='auto' and w.frozen_opens_at is null and s.id=w.session_id and s.starts_at>now_;
  perform private.exam_materialize(e.id);
  perform private.exam_link(e.id);
 end if;
end $$;

create function private.exam_save(p_exam uuid,p_offering uuid,p_revision bigint,p_definition jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;d jsonb:=coalesce(p_definition,'{}'::jsonb);course uuid;started boolean:=false;
 q jsonb;qi integer:=0;qid uuid;o jsonb;oi integer;oid_ uuid;ids uuid[];correct uuid[];qtype text;img uuid;mimg uuid;tolerance numeric;num numeric;before_ jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if coalesce(jsonb_typeof(d),'')<>'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','chapterIds','coversAllChapters','heldOn','maxMarks','timing','startingFrom',
   'opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','questions'))
  or (d ? 'title' and coalesce(jsonb_typeof(d->'title'),'')<>'string') or (d ? 'description' and coalesce(jsonb_typeof(d->'description'),'')<>'string')
  or exists(select 1 from unnest(array['coversAllChapters','shuffle','photosAllowed','autoRelease']) k where d ? k and coalesce(jsonb_typeof(d->k),'')<>'boolean')
  or (d ? 'chapterIds' and (coalesce(jsonb_typeof(d->'chapterIds'),'')<>'array' or jsonb_array_length(d->'chapterIds')>200)) or (d ? 'questions' and coalesce(jsonb_typeof(d->'questions'),'')<>'array')
  or (d ? 'maxMarks' and (coalesce(jsonb_typeof(d->'maxMarks'),'')<>'number' or d->>'maxMarks' !~ '^\d{1,4}$'))
  or (d ? 'timeLimitMinutes' and coalesce(jsonb_typeof(d->'timeLimitMinutes'),'')<>'null' and (coalesce(jsonb_typeof(d->'timeLimitMinutes'),'')<>'number' or d->>'timeLimitMinutes' !~ '^\d{1,4}$'))
  or exists(select 1 from unnest(array['heldOn','startingFrom']) k where d ? k and coalesce(jsonb_typeof(d->k),'')<>'null' and (coalesce(jsonb_typeof(d->k),'')<>'string' or d->>k !~ '^\d{4}-\d{2}-\d{2}$'))
  or (d ? 'timing' and d->>'timing' is distinct from 'per_group' and d->>'timing' is distinct from 'same_time')
  or (d ? 'tries' and coalesce(d->>'tries','') not in ('one_time','fix_mistakes','from_zero')) then raise exception 'Invalid exam' using errcode='23514';end if;
 if p_exam is null then
  select o.course_id into course from public.course_offerings o where o.id=p_offering;
  if course is null or not private.can_edit_course(course) then raise exception 'Exam denied' using errcode='42501';end if;
  if coalesce(d->>'kind','') not in ('online','paper') then raise exception 'Choose online or paper' using errcode='23514';end if;
  oid_:=gen_random_uuid();
  insert into private.exams(id,family_id,course_id,offering_id,kind,title,timing,tries_mode,max_marks,created_by)
   values(oid_,oid_,course,p_offering,d->>'kind',coalesce(nullif(btrim(d->>'title'),''),'Exam'),case when d->>'kind'='online' then 'per_group' end,
    case when d->>'kind'='online' then 'one_time' end,case when d->>'kind'='paper' then 100 end,u) returning * into e;
 else
  select * into e from private.exams where id=p_exam for update;
  if e.id is null or not private.exam_staff(e.id,'author') then raise exception 'Exam denied' using errcode='42501';end if;
  if p_offering is not null and p_offering<>e.offering_id then raise exception 'An exam keeps its run' using errcode='23514';end if;
  if p_revision is distinct from e.revision then raise exception 'The exam changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  if e.status='archived' then raise exception 'Archived exams are read only' using errcode='23514';end if;
  if d ? 'kind' and d->>'kind' is distinct from e.kind then raise exception 'An exam keeps its kind' using errcode='23514';end if;
  started:=exists(select 1 from private.exam_attempts where exam_id=e.id) or exists(select 1 from private.exam_results where exam_id=e.id);
  -- Once a student started (or a paper mark exists) only the details change; the times move with Reschedule.
  if started and exists(select 1 from jsonb_object_keys(d) k where k not in ('kind','title','description','chapterIds','coversAllChapters','heldOn')) then
   raise exception 'Students have started; only the details can change' using errcode='PT409',detail='{"reason":"started"}';end if;
 end if;
 before_:=private.exam_settings_json(e.id);
 if e.kind='paper' and exists(select 1 from jsonb_object_keys(d) k where k in ('timing','startingFrom','opensAt','closesAt','timeLimitMinutes','tries','shuffle','photosAllowed','autoRelease','questions')) then
  raise exception 'A paper exam has a maximum mark only' using errcode='23514';end if;
 if e.kind='online' and (d ? 'maxMarks' or (d ? 'heldOn' and coalesce(jsonb_typeof(d->'heldOn'),'')<>'null')) then raise exception 'An online exam adds up its questions' using errcode='23514';end if;
 update private.exams set
  title=case when d ? 'title' then btrim(d->>'title') else title end,
  description=case when d ? 'description' then d->>'description' else description end,
  covers_all_chapters=case when d ? 'coversAllChapters' then (d->>'coversAllChapters')::boolean else covers_all_chapters end,
  held_on=case when d ? 'heldOn' then (d->>'heldOn')::date else held_on end,
  max_marks=case when d ? 'maxMarks' then (d->>'maxMarks')::integer else max_marks end,
  time_limit_minutes=case when d ? 'timeLimitMinutes' then (d->>'timeLimitMinutes')::integer else time_limit_minutes end,
  tries_mode=case when d ? 'tries' then d->>'tries' else tries_mode end,
  shuffle=case when d ? 'shuffle' then (d->>'shuffle')::boolean else shuffle end,
  photos_allowed=case when d ? 'photosAllowed' then (d->>'photosAllowed')::boolean else photos_allowed end,
  auto_release=case when d ? 'autoRelease' then (d->>'autoRelease')::boolean else auto_release end
 where id=e.id returning * into e;
 if e.kind='online' and (d ? 'timing' or d ? 'startingFrom' or d ? 'opensAt' or d ? 'closesAt') then perform private.exam_apply_timing(e.id,d);end if;
 if d ? 'chapterIds' then
  if exists(select 1 from jsonb_array_elements(d->'chapterIds') x where coalesce(jsonb_typeof(x),'')<>'string' or x#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid chapters' using errcode='23514';end if;
  delete from private.exam_chapters where exam_id=e.id;
  insert into private.exam_chapters(exam_id,module_id) select distinct e.id,(x#>>'{}')::uuid from jsonb_array_elements(d->'chapterIds') x;
 end if;
 if d ? 'questions' then
  if jsonb_array_length(d->'questions')>100 then raise exception 'At most 100 questions' using errcode='23514';end if;
  delete from private.exam_questions where exam_id=e.id;
  for q in select x from jsonb_array_elements(d->'questions') x loop
   if coalesce(jsonb_typeof(q),'')<>'object' or exists(select 1 from jsonb_object_keys(q) k where k not in ('type','text','imageId','points','options','correct','numberValue','tolerance','responseMode','modelText','modelImageId'))
    or coalesce(q->>'type','') not in ('choice','single_choice','multiple_choice','number','essay') or (q ? 'text' and coalesce(jsonb_typeof(q->'text'),'')<>'string')
    or (q ? 'points' and (coalesce(jsonb_typeof(q->'points'),'')<>'number' or q->>'points' !~ '^\d{1,4}$')) or (q ? 'modelText' and coalesce(jsonb_typeof(q->'modelText'),'')<>'string')
    or (q ? 'responseMode' and coalesce(q->>'responseMode','') not in ('text','photo','both'))
    or exists(select 1 from unnest(array['imageId','modelImageId']) k where q ? k and coalesce(jsonb_typeof(q->k),'')<>'null' and (coalesce(jsonb_typeof(q->k),'')<>'string' or q->>k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
   then raise exception 'Invalid question %',qi+1 using errcode='23514';end if;
   img:=(q->>'imageId')::uuid;mimg:=(q->>'modelImageId')::uuid;
   -- Pictures: ready uploads of an exam of this family, for this use.
   if img is not null and not exists(select 1 from private.exam_uploads x join private.exams s on s.id=x.exam_id where x.id=img and x.purpose='question' and x.status='ready' and s.family_id=e.family_id) then
    raise exception 'Question picture unavailable' using errcode='23503';end if;
   if mimg is not null and not exists(select 1 from private.exam_uploads x join private.exams s on s.id=x.exam_id where x.id=mimg and x.purpose='model' and x.status='ready' and s.family_id=e.family_id) then
    raise exception 'Model answer picture unavailable' using errcode='23503';end if;
   qtype:=case when q->>'type' in ('choice','single_choice','multiple_choice') then 'choice' else q->>'type' end;
   insert into private.exam_questions(exam_id,position,type,text,image_id,points,response_mode)
    values(e.id,qi,case when qtype='choice' then 'single_choice' else qtype end,coalesce(q->>'text',''),img,coalesce((q->>'points')::integer,1),
     case when qtype='essay' then coalesce(q->>'responseMode','text') else 'text' end) returning id into qid;
   correct:='{}';num:=null;tolerance:=0;
   if qtype='choice' then
    -- 2 to 8 options (A to H), one or more right ones: one right answer is single choice, more is multiple choice (the type is derived).
    if coalesce(jsonb_typeof(q->'options'),'')<>'array' or jsonb_array_length(q->'options') not between 2 and 8 or coalesce(jsonb_typeof(q->'correct'),'')<>'array' or jsonb_array_length(q->'correct')<1
     or exists(select 1 from jsonb_array_elements(q->'options') x where coalesce(jsonb_typeof(x),'')<>'string')
     or exists(select 1 from jsonb_array_elements(q->'correct') x where coalesce(jsonb_typeof(x),'')<>'number' or x#>>'{}' !~ '^\d$' or (x#>>'{}')::integer>=jsonb_array_length(q->'options'))
     or (select count(distinct x#>>'{}') from jsonb_array_elements(q->'correct') x)<>jsonb_array_length(q->'correct') then raise exception 'Question %: options and right answers',qi+1 using errcode='23514';end if;
    oi:=0;ids:='{}';
    for o in select x from jsonb_array_elements(q->'options') x loop
     insert into private.exam_options(question_id,position,text) values(qid,oi,o#>>'{}') returning id into oid_;
     ids:=ids||oid_;oi:=oi+1;
    end loop;
    correct:=array(select ids[(x#>>'{}')::integer+1] from jsonb_array_elements(q->'correct') x);
    update private.exam_questions set type=case when cardinality(correct)>1 then 'multiple_choice' else 'single_choice' end where id=qid;
   elsif q ? 'options' or q ? 'correct' then raise exception 'Question %: options are for choice questions',qi+1 using errcode='23514';
   end if;
   if qtype='number' then
    if coalesce(jsonb_typeof(q->'numberValue'),'')<>'number' or (q ? 'tolerance' and coalesce(jsonb_typeof(q->'tolerance'),'')<>'number') then raise exception 'Question %: the right number',qi+1 using errcode='23514';end if;
    num:=(q->>'numberValue')::numeric;tolerance:=coalesce((q->>'tolerance')::numeric,0);
   elsif q ? 'numberValue' or q ? 'tolerance' then raise exception 'Question %: a number is for number questions',qi+1 using errcode='23514';
   end if;
   if qtype<>'essay' and q ? 'responseMode' then raise exception 'Question %: photo answers are for essays',qi+1 using errcode='23514';end if;
   insert into private.exam_keys(question_id,correct_option_ids,number_value,number_tolerance,model_text,model_image_id) values(qid,correct,num,tolerance,coalesce(q->>'modelText',''),mimg);
   qi:=qi+1;
  end loop;
 end if;
 if e.status<>'draft' then perform private.exam_check(e.id);end if;
 update private.exams set revision=revision+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 perform private.exam_audit_write(e.id,case when p_exam is null then 'create' else 'save' end,null,null,case when p_exam is not null then before_ end,private.exam_settings_json(e.id));
 return jsonb_build_object('id',e.id,'revision',e.revision,'status',e.status);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 raise exception 'Invalid exam' using errcode='23514';
end $$;

-- Publish (draft -> published; links every Group), unpublish (only before any work), clone (a new draft version of the family, in this
-- or another run of the course), archive, reschedule (the times only; allowed after work started, kept once opened).
create function private.exam_lifecycle(p_exam uuid,p_action text,p_revision bigint,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;n private.exams;d jsonb:=coalesce(p_data,'{}'::jsonb);target uuid;q private.exam_questions;nq uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action is null or p_action not in ('publish','unpublish','clone','archive','reschedule') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown action' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for update;
 if e.id is null or not private.exam_staff(e.id,'author') then raise exception 'Exam denied' using errcode='42501';end if;
 if p_revision is distinct from e.revision then raise exception 'The exam changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
 if p_action='publish' then
  if e.status<>'draft' then raise exception 'Only a draft is published' using errcode='23514';end if;
  perform private.exam_check(e.id);
  if e.timing='per_group' then perform private.exam_materialize(e.id);end if;
  update private.exams set status='published',published_at=coalesce(published_at,clock_timestamp()) where id=e.id returning * into e;
  perform private.exam_link(e.id);
 elsif p_action='unpublish' then
  if e.status<>'published' then raise exception 'Only a published exam is unpublished' using errcode='23514';end if;
  if exists(select 1 from private.exam_attempts where exam_id=e.id) or exists(select 1 from private.exam_results where exam_id=e.id) then
   raise exception 'Students have started' using errcode='PT409',detail='{"reason":"started"}';end if;
  delete from private.exam_group_windows where exam_id=e.id and source='auto';
  update private.exam_group_windows set frozen_opens_at=null,frozen_closes_at=null where exam_id=e.id;
  update private.exams set status='draft' where id=e.id returning * into e;
 elsif p_action='archive' then
  if e.status='archived' then raise exception 'Already archived' using errcode='23514';end if;
  perform private.exam_settle(e.id);
  update private.exams set status='archived' where id=e.id returning * into e;
 elsif p_action='reschedule' then
  if e.status<>'published' or e.kind<>'online' then raise exception 'Only a published online exam is rescheduled' using errcode='23514';end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('timing','startingFrom','opensAt','closesAt'))
   or (d ? 'startingFrom' and (coalesce(jsonb_typeof(d->'startingFrom'),'')<>'string' or d->>'startingFrom' !~ '^\d{4}-\d{2}-\d{2}$')) then raise exception 'Invalid times' using errcode='23514';end if;
  perform private.exam_settle(e.id);
  perform private.exam_apply_timing(e.id,d);
  perform private.exam_check(e.id);
 else
  if d ? 'offeringId' and (coalesce(jsonb_typeof(d->'offeringId'),'')<>'string' or d->>'offeringId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Choose a run of this course' using errcode='23514';end if;
  target:=coalesce((d->>'offeringId')::uuid,e.offering_id);
  if not exists(select 1 from public.course_offerings o where o.id=target and o.course_id=e.course_id) then raise exception 'Choose a run of this course' using errcode='23514';end if;
  insert into private.exams(family_id,version,supersedes_id,course_id,offering_id,kind,title,description,max_marks,held_on,timing,starting_from,opens_at,closes_at,time_limit_minutes,
    tries_mode,shuffle,photos_allowed,auto_release,covers_all_chapters,created_by)
   select e.family_id,(select max(x.version)+1 from private.exams x where x.family_id=e.family_id),e.id,e.course_id,target,e.kind,e.title,e.description,e.max_marks,null,e.timing,
    case when e.timing='per_group' then e.starting_from end,null,null,e.time_limit_minutes,e.tries_mode,e.shuffle,e.photos_allowed,e.auto_release,e.covers_all_chapters,u returning * into n;
  insert into private.exam_chapters(exam_id,module_id) select n.id,c.module_id from private.exam_chapters c where c.exam_id=e.id;
  for q in select * from private.exam_questions x where x.exam_id=e.id order by x.position loop
   insert into private.exam_questions(exam_id,position,type,text,image_id,points,response_mode) values(n.id,q.position,q.type,q.text,q.image_id,q.points,q.response_mode) returning id into nq;
   insert into private.exam_options(question_id,position,text) select nq,o.position,o.text from private.exam_options o where o.question_id=q.id;
   insert into private.exam_keys(question_id,correct_option_ids,number_value,number_tolerance,model_text,model_image_id)
    select nq,array(select no.id from private.exam_options oo join private.exam_options no on no.question_id=nq and no.position=oo.position where oo.id=any(k.correct_option_ids) order by no.position),
     k.number_value,k.number_tolerance,k.model_text,k.model_image_id from private.exam_keys k where k.question_id=q.id;
  end loop;
  perform private.exam_audit_write(n.id,'clone',null,null,null,jsonb_build_object('from',e.id));
  return jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'version',n.version);
 end if;
 update private.exams set revision=revision+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 perform private.exam_audit_write(e.id,p_action,null,null,null,case when p_action='reschedule' then d end);
 return jsonb_build_object('id',e.id,'revision',e.revision,'status',e.status);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
 raise exception 'Invalid times' using errcode='23514';
end $$;

-- A Group's window: back to the rule (auto), another of its sessions (picked), or a custom pair (for a Group with no session). Refused
-- once that Group's window opened (PT409 window_open). The exam's revision is the stale check.
create function private.exam_set_window(p_exam uuid,p_group uuid,p_revision bigint,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;d jsonb:=coalesce(p_data,'{}'::jsonb);w record;src text;sess uuid;oa timestamptz;ca timestamptz;before_ jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into e from private.exams where id=p_exam for update;
 if e.id is null or not private.exam_staff(e.id,'author') then raise exception 'Exam denied' using errcode='42501';end if;
 if p_revision is distinct from e.revision then raise exception 'The exam changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
 if e.kind<>'online' or e.timing<>'per_group' or e.status='archived' then raise exception 'This exam has no Group windows' using errcode='23514';end if;
 if not exists(select 1 from public.study_groups g where g.id=p_group and g.offering_id=e.offering_id and g.status='active') then raise exception 'Group unavailable' using errcode='42501';end if;
 if coalesce(jsonb_typeof(d),'')<>'object' or exists(select 1 from jsonb_object_keys(d) k where k not in ('source','sessionId','opensAt','closesAt')) or coalesce(d->>'source','') not in ('auto','picked','custom') then
  raise exception 'Invalid window' using errcode='23514';end if;
 perform private.materialize_group(p_group);
 select * into w from private.exam_windows(e.id) x where x.group_id=p_group;
 if e.status='published' and (w.frozen or (w.state='ok' and w.opens_at<=clock_timestamp())) then raise exception 'This Group''s window has opened' using errcode='PT409',detail='{"reason":"window_open"}';end if;
 select to_jsonb(x) into before_ from private.exam_group_windows x where x.exam_id=e.id and x.group_id=p_group;
 src:=d->>'source';
 if src='picked' then
  if coalesce(jsonb_typeof(d->'sessionId'),'')<>'string' or d->>'sessionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Choose a session' using errcode='23514';end if;
  sess:=(d->>'sessionId')::uuid;
  if not exists(select 1 from public.group_sessions s where s.id=sess and s.group_id=p_group and not s.cancelled and s.starts_at>clock_timestamp()) then raise exception 'Choose a coming session of this Group' using errcode='23514';end if;
 elsif src='custom' then
  oa:=private.exam_iso(d->'opensAt');ca:=private.exam_iso(d->'closesAt');
  if oa is null or ca is null or ca<=oa or oa<=clock_timestamp() then raise exception 'Choose a coming time' using errcode='23514';end if;
 end if;
 delete from private.exam_group_windows where exam_id=e.id and group_id=p_group;
 if src<>'auto' then
  insert into private.exam_group_windows(exam_id,group_id,source,session_id,custom_opens_at,custom_closes_at,updated_by) values(e.id,p_group,src,sess,oa,ca,u);
 elsif e.status='published' then perform private.exam_link(e.id);
 end if;
 update private.exams set revision=revision+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 perform private.exam_audit_write(e.id,'window',null,null,before_,jsonb_build_object('groupId',p_group,'source',src,'sessionId',sess,'opensAt',oa,'closesAt',ca));
 return jsonb_build_object('id',e.id,'revision',e.revision);
end $$;

-- ---------------------------------------------------------------------------------------
-- Student work and correction
-- ---------------------------------------------------------------------------------------
-- A try as JSON, for its student or the exam's staff. Keys and model answers only during answer review (staff always); marks and the
-- score only once released (staff always).
create function private.exam_attempt_json(p_attempt uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a private.exam_attempts;staff boolean;review boolean;shown boolean;r private.exam_results;
begin
 select * into a from private.exam_attempts where id=p_attempt;
 staff:=private.exam_staff(a.exam_id);
 if a.id is null or not (staff or (a.user_id=(select private.current_app_user_id()) and private.exam_taker(a.exam_id))) then raise exception 'Try unavailable' using errcode='42501';end if;
 review:=staff or (a.status='submitted' and private.exam_review_open(a.exam_id));
 select * into r from private.exam_results where exam_id=a.exam_id and user_id=a.user_id;
 shown:=staff or (r.id is not null and private.exam_released(r.id) and (r.final_attempt_id=a.id or a.number=1));
 return jsonb_build_object('id',a.id,'userId',a.user_id,'number',a.number,'status',a.status,'startedAt',a.started_at,'deadlineAt',a.deadline_at,'submittedAt',a.submitted_at,
  'autoSubmitted',a.auto_submitted,'revision',a.revision,'groupId',a.window_group_id,'serverNow',clock_timestamp(),
  'items',coalesce((select jsonb_agg(private.exam_question_json(i.question_id,review,i.option_order)||jsonb_build_object('position',i.position,
    'answer',case when x.question_id is null then null else jsonb_build_object('optionIds',to_jsonb(x.option_ids),'numberValue',x.number_value,'text',x.text,'uploadId',x.upload_id,'kept',x.kept,'savedAt',x.saved_at) end,
    'mark',case when shown and m.question_id is not null then jsonb_build_object('points',m.points,'auto',m.auto,'note',m.note) end) order by i.position)
   from private.exam_attempt_items i left join private.exam_responses x on x.attempt_id=a.id and x.question_id=i.question_id
   left join private.exam_marks m on m.attempt_id=a.id and m.question_id=i.question_id where i.attempt_id=a.id),'[]'::jsonb));
end $$;

-- start (try 1) | retry (try 2: fix mistakes keeps the first try's order, its right choice and number answers locked as "kept", its essays
-- editable; from zero is a new paper) | save (one answer) | submit | grade (marks of the latest try) | release (one result).
create function private.exam_work(p_exam uuid,p_action text,p_revision bigint default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;a private.exam_attempts;first_ private.exam_attempts;r private.exam_results;q private.exam_questions;
 d jsonb:=coalesce(p_data,'{}'::jsonb);w record;num integer;now_ timestamptz;deadline timestamptz;sess uuid;x private.exam_responses;up private.exam_uploads;
 opts uuid[];m jsonb;pts numeric;total numeric;waiting integer;before_ jsonb;reason_ text;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action is null or p_action not in ('start','retry','save','submit','grade','release') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown action' using errcode='23514';end if;
 if p_action in ('start','retry','save','submit') then
  select * into e from private.exams where id=p_exam for share;
  if e.id is null or e.kind<>'online' or not private.exam_taker(e.id) then raise exception 'Exam unavailable' using errcode='42501';end if;
  if e.status<>'published' then raise exception 'The exam has closed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  -- One student's writes one at a time (two tabs), then the clock.
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':'||u::text||':exam-student',0));
  perform private.exam_settle(e.id,u);
  if p_action in ('start','retry') then
   if exists(select 1 from jsonb_object_keys(d) k) then raise exception 'Invalid start' using errcode='23514';end if;
   select * into a from private.exam_attempts where exam_id=e.id and user_id=u and status='in_progress';
   if a.id is not null then return private.exam_attempt_json(a.id);end if;
   select * into first_ from private.exam_attempts where exam_id=e.id and user_id=u and number=1;
   if p_action='start' then
    if first_.id is not null then raise exception 'You have taken this exam' using errcode='PT409',detail=jsonb_build_object('reason',case when e.tries_mode='one_time' or exists(select 1 from private.exam_attempts where exam_id=e.id and user_id=u and number=2) then 'no_tries_left' else 'started' end)::text;end if;
    num:=1;
   else
    if first_.id is null then raise exception 'Start the exam first' using errcode='23514';end if;
    if e.tries_mode='one_time' or exists(select 1 from private.exam_attempts where exam_id=e.id and user_id=u and number=2) then raise exception 'No tries left' using errcode='PT409',detail='{"reason":"no_tries_left"}';end if;
    num:=2;
   end if;
   select * into w from private.exam_student_window(e.id,u);
   if w.state='needs_time' then raise exception 'The exam has no time yet' using errcode='PT409',detail='{"reason":"needs_time"}';end if;
   if w.state<>'ok' then raise exception 'No window for you' using errcode='PT409',detail='{"reason":"no_window"}';end if;
   if w.group_id is not null then
    -- The linked session cannot move while the try starts (a move waits, and then keeps the opened times).
    select wx.session_id into sess from private.exam_windows(e.id) wx where wx.group_id=w.group_id and not wx.frozen and wx.source<>'custom';
    if sess is not null then perform 1 from public.group_sessions s where s.id=sess for share;select * into w from private.exam_student_window(e.id,u);end if;
   end if;
   now_:=clock_timestamp();
   if w.state<>'ok' then raise exception 'No window for you' using errcode='PT409',detail='{"reason":"no_window"}';end if;
   if now_<w.opens_at then raise exception 'The exam has not opened' using errcode='PT409',detail=jsonb_build_object('reason','not_open','opensAt',w.opens_at)::text;end if;
   if now_>=w.closes_at then raise exception 'The exam has closed' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
   -- The deadline is fixed now: the time limit, cut at the window's end (owner's answer 5).
   deadline:=least(w.closes_at,case when e.time_limit_minutes is not null then now_+make_interval(mins=>e.time_limit_minutes) end);
   insert into private.exam_attempts(exam_id,user_id,number,window_group_id,started_at,deadline_at) values(e.id,u,num,w.group_id,now_,deadline) returning * into a;
   if num=2 and e.tries_mode='fix_mistakes' then
    insert into private.exam_attempt_items(attempt_id,question_id,position,option_order) select a.id,i.question_id,i.position,i.option_order from private.exam_attempt_items i where i.attempt_id=first_.id;
    insert into private.exam_responses(attempt_id,question_id,option_ids,number_value,text,upload_id,kept)
     select a.id,p.question_id,case when qq.type='essay' then '{}' else p.option_ids end,case when qq.type='essay' then null else p.number_value end,
      case when qq.type='essay' then p.text else '' end,case when qq.type='essay' then p.upload_id end,qq.type<>'essay'
     from private.exam_responses p join private.exam_questions qq on qq.id=p.question_id left join private.exam_marks pm on pm.attempt_id=p.attempt_id and pm.question_id=p.question_id
     where p.attempt_id=first_.id and (qq.type='essay' or (pm.points is not null and pm.points=qq.points and pm.auto and (cardinality(p.option_ids)>0 or p.number_value is not null)));
   else
    perform private.exam_items(a.id,e.id,e.shuffle);
   end if;
   perform private.exam_audit_write(e.id,p_action,u,null,null,jsonb_build_object('attemptId',a.id,'number',num,'deadlineAt',deadline));
   return private.exam_attempt_json(a.id);
  end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','optionIds','numberValue','text','uploadId'))
   or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid answer' using errcode='23514';end if;
  select * into a from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u for update;
  if a.id is null then raise exception 'Try unavailable' using errcode='42501';end if;
  if a.status<>'in_progress' then raise exception 'This try was handed in' using errcode='PT409',detail=jsonb_build_object('reason',case when a.auto_submitted then 'deadline_passed' else 'stale' end)::text;end if;
  if p_revision is distinct from a.revision then raise exception 'The try changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  if a.deadline_at<=clock_timestamp() then raise exception 'Time is up' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  if p_action='submit' then
   if exists(select 1 from jsonb_object_keys(d) k where k<>'attemptId') then raise exception 'Invalid submit' using errcode='23514';end if;
   perform private.exam_finish(a.id,false);
   return private.exam_attempt_json(a.id);
  end if;
  -- save
  if coalesce(jsonb_typeof(d->'questionId'),'')<>'string' or d->>'questionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid answer' using errcode='23514';end if;
  select qq.* into q from private.exam_questions qq join private.exam_attempt_items i on i.question_id=qq.id where i.attempt_id=a.id and qq.id=(d->>'questionId')::uuid;
  if q.id is null then raise exception 'Question unavailable' using errcode='42501';end if;
  select * into x from private.exam_responses where attempt_id=a.id and question_id=q.id;
  if x.kept then raise exception 'This answer is kept from your first try' using errcode='23514';end if;
  if q.type in ('single_choice','multiple_choice') then
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','optionIds')) or coalesce(jsonb_typeof(d->'optionIds'),'')<>'array' or jsonb_array_length(d->'optionIds')>8
    or exists(select 1 from jsonb_array_elements(d->'optionIds') o where coalesce(jsonb_typeof(o),'')<>'string' or o#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid answer' using errcode='23514';end if;
   opts:=array(select distinct (o#>>'{}')::uuid from jsonb_array_elements(d->'optionIds') o);
   if exists(select 1 from unnest(opts) o where not exists(select 1 from private.exam_options eo where eo.id=o and eo.question_id=q.id)) or (q.type='single_choice' and cardinality(opts)>1) then raise exception 'Invalid choice' using errcode='23514';end if;
   insert into private.exam_responses(attempt_id,question_id,option_ids) values(a.id,q.id,opts) on conflict(attempt_id,question_id) do update set option_ids=excluded.option_ids,saved_at=clock_timestamp() returning * into x;
  elsif q.type='number' then
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','numberValue')) or coalesce(jsonb_typeof(d->'numberValue'),'') not in ('number','null') then raise exception 'Invalid answer' using errcode='23514';end if;
   insert into private.exam_responses(attempt_id,question_id,number_value) values(a.id,q.id,(d->>'numberValue')::numeric) on conflict(attempt_id,question_id) do update set number_value=excluded.number_value,saved_at=clock_timestamp() returning * into x;
  else
   if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','questionId','text','uploadId')) or (d ? 'text' and coalesce(jsonb_typeof(d->'text'),'')<>'string')
    or (d ? 'uploadId' and coalesce(jsonb_typeof(d->'uploadId'),'')<>'null' and (coalesce(jsonb_typeof(d->'uploadId'),'')<>'string' or d->>'uploadId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then raise exception 'Invalid answer' using errcode='23514';end if;
   if d ? 'text' and q.response_mode='photo' and coalesce(d->>'text','')<>'' then raise exception 'This question takes a photo' using errcode='23514';end if;
   if d->>'uploadId' is not null then
    if q.response_mode='text' or not e.photos_allowed then raise exception 'This question takes text' using errcode='23514';end if;
    -- A photo of this student for this exam: of this try, or carried from the first try.
    select * into up from private.exam_uploads where id=(d->>'uploadId')::uuid;
    if up.id is null or up.exam_id<>e.id or up.purpose<>'answer' or up.uploaded_by<>u or up.status<>'ready' or not exists(select 1 from private.exam_attempts t where t.id=up.attempt_id and t.user_id=u and t.exam_id=e.id) then
     raise exception 'Photo unavailable' using errcode='23503';end if;
   end if;
   insert into private.exam_responses(attempt_id,question_id,text,upload_id) values(a.id,q.id,coalesce(d->>'text',''),(d->>'uploadId')::uuid)
    on conflict(attempt_id,question_id) do update set text=case when d ? 'text' then excluded.text else private.exam_responses.text end,
     upload_id=case when d ? 'uploadId' then excluded.upload_id else private.exam_responses.upload_id end,saved_at=clock_timestamp() returning * into x;
  end if;
  return jsonb_build_object('attemptId',a.id,'questionId',q.id,'savedAt',x.saved_at,'revision',a.revision,'deadlineAt',a.deadline_at);
 end if;
 -- Teacher: grade, release.
 select * into e from private.exams where id=p_exam for share;
 if e.id is null or not private.exam_staff(e.id,case when p_action='grade' then 'correct' else 'release' end) then raise exception 'Correction denied' using errcode='42501';end if;
 perform private.exam_settle(e.id);
 if p_action='grade' then
  if e.kind<>'online' then raise exception 'A paper exam takes marks on the mark sheet' using errcode='23514';end if;
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('attemptId','marks','reason')) or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(jsonb_typeof(d->'marks'),'')<>'array' or jsonb_array_length(d->'marks') not between 1 and 100 or (d ? 'reason' and coalesce(jsonb_typeof(d->'reason'),'')<>'string') then raise exception 'Invalid marks' using errcode='23514';end if;
  select * into a from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id for update;
  if a.id is null then raise exception 'Correction denied' using errcode='42501';end if;
  if a.status<>'submitted' then raise exception 'The try is not handed in' using errcode='PT409',detail='{"reason":"unfinished"}';end if;
  select * into r from private.exam_results where exam_id=e.id and user_id=a.user_id for update;
  if r.final_attempt_id is distinct from a.id then raise exception 'Only the latest try is marked' using errcode='23514';end if;
  if p_revision is distinct from r.revision then raise exception 'The result changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
  reason_:=nullif(btrim(coalesce(d->>'reason','')),'');
  if r.released_at is not null and reason_ is null then raise exception 'Say why a released mark changes' using errcode='23514',detail='{"reason":"reason_required"}';end if;
  before_:=to_jsonb(r)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(mm) order by mm.question_id) from private.exam_marks mm where mm.attempt_id=a.id));
  for m in select y from jsonb_array_elements(d->'marks') y loop
   if coalesce(jsonb_typeof(m),'')<>'object' or exists(select 1 from jsonb_object_keys(m) k where k not in ('questionId','points','note')) or coalesce(jsonb_typeof(m->'points'),'')<>'number'
    or (m ? 'note' and coalesce(jsonb_typeof(m->'note'),'')<>'string') or coalesce(jsonb_typeof(m->'questionId'),'')<>'string' or m->>'questionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid marks' using errcode='23514';end if;
   select qq.* into q from private.exam_questions qq join private.exam_attempt_items i on i.question_id=qq.id where i.attempt_id=a.id and qq.id=(m->>'questionId')::uuid;
   pts:=(m->>'points')::numeric;
   if q.id is null or pts<0 or pts>q.points or pts*2<>trunc(pts*2) then raise exception 'Marks are 0 to the question''s points, in halves' using errcode='23514';end if;
   insert into private.exam_marks(attempt_id,question_id,points,auto,note) values(a.id,q.id,pts,false,coalesce(m->>'note',''))
    on conflict(attempt_id,question_id) do update set points=excluded.points,auto=false,note=case when m ? 'note' then excluded.note else private.exam_marks.note end;
  end loop;
  select coalesce(sum(mm.points),0),count(*) filter(where mm.points is null) into total,waiting from private.exam_marks mm where mm.attempt_id=a.id;
  update private.exam_results set status=case when waiting=0 then 'corrected' else 'waiting' end,score=case when waiting=0 then total end,revision=revision+1,updated_by=u,updated_at=clock_timestamp()
   where id=r.id returning * into r;
  perform private.exam_audit_write(e.id,'grade',r.user_id,reason_,before_,to_jsonb(r)||jsonb_build_object('marks',(select jsonb_agg(to_jsonb(mm) order by mm.question_id) from private.exam_marks mm where mm.attempt_id=a.id)));
  return jsonb_build_object('resultId',r.id,'status',r.status,'score',r.score,'maxScore',r.max_score,'revision',r.revision,'released',r.released_at is not null);
 end if;
 -- release
 if exists(select 1 from jsonb_object_keys(d) k where k<>'resultId') or coalesce(jsonb_typeof(d->'resultId'),'')<>'string' or d->>'resultId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid release' using errcode='23514';end if;
 select * into r from private.exam_results where id=(d->>'resultId')::uuid and exam_id=e.id for update;
 if r.id is null then raise exception 'Correction denied' using errcode='42501';end if;
 if p_revision is distinct from r.revision then raise exception 'The result changed; reload' using errcode='PT409',detail='{"reason":"stale"}';end if;
 perform private.exam_release_check(e.id,r.id);
 update private.exam_results set released_at=clock_timestamp(),released_by=u,revision=revision+1 where id=r.id returning * into r;
 perform private.exam_audit_write(e.id,'release',r.user_id,null,null,jsonb_build_object('resultId',r.id,'score',r.score));
 return jsonb_build_object('resultId',r.id,'revision',r.revision,'releasedAt',r.released_at);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invalid answer' using errcode='23514';
end $$;

-- A result may be released when: published (or archived), corrected, not released yet, and (online) that student's window has closed
-- (owner's answer 10; scores only, answer review waits for the LAST window).
create function private.exam_release_check(p_exam uuid,p_result uuid) returns void language plpgsql security definer set search_path='' as $$
declare e private.exams;r private.exam_results;w record;
begin
 select * into e from private.exams where id=p_exam;
 select * into r from private.exam_results where id=p_result;
 if e.status='draft' then raise exception 'Publish the exam first' using errcode='23514';end if;
 if r.released_at is not null then raise exception 'Already released' using errcode='23514',detail=jsonb_build_object('reason','already_released','resultId',r.id)::text;end if;
 if r.status<>'corrected' then raise exception 'Finish correction before release' using errcode='23514',detail=jsonb_build_object('reason','unfinished','resultId',r.id)::text;end if;
 if e.kind='online' then
  select * into w from private.exam_student_window(e.id,r.user_id);
  if w.closes_at is null or w.closes_at>clock_timestamp() or exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=r.user_id and a.status='in_progress') then
   raise exception 'This student''s window is still open' using errcode='PT409',detail=jsonb_build_object('reason','still_open','resultId',r.id)::text;end if;
 end if;
end $$;

-- Release many results of ONE exam, all or nothing: [{resultId, revision}], 1 to 500, no duplicates; each passes the single release's
-- checks. Locks: the exam shared, then the results in id order (as a grade, a single release, a paper mark sheet and another bulk release).
create function private.exam_release_many(p_exam uuid,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;ids uuid[];r private.exam_results;want bigint;n integer:=0;out_ jsonb:='[]'::jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_items is null or coalesce(jsonb_typeof(p_items),'')<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Choose the grades to release' using errcode='23514';end if;
 if jsonb_array_length(p_items)>500 then raise exception 'At most 500 grades at once' using errcode='23514',detail='{"max":500}';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where coalesce(jsonb_typeof(x),'')<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('resultId','revision'))
   or coalesce(jsonb_typeof(x->'resultId'),'')<>'string' or x->>'resultId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(jsonb_typeof(x->'revision'),'')<>'number' or x->>'revision' !~ '^\d{1,15}$') then raise exception 'Invalid grade list' using errcode='23514';end if;
 ids:=array(select (x->>'resultId')::uuid from jsonb_array_elements(p_items) x);
 if cardinality(ids)<>(select count(distinct y) from unnest(ids) y) then raise exception 'A grade is listed twice' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for share;
 if e.id is null or not private.exam_staff(e.id,'release') then raise exception 'Correction denied' using errcode='42501';end if;
 perform private.exam_settle(e.id);
 perform 1 from private.exam_results x where x.id=any(ids) order by x.id for update;
 if (select count(*) from private.exam_results x where x.id=any(ids) and x.exam_id=e.id)<>cardinality(ids) then raise exception 'Correction denied' using errcode='42501';end if;
 for r in select * from private.exam_results x where x.id=any(ids) order by x.id loop
  want:=(select (y->>'revision')::bigint from jsonb_array_elements(p_items) y where (y->>'resultId')::uuid=r.id);
  if r.revision<>want then raise exception 'A result changed; reload' using errcode='PT409',detail=jsonb_build_object('reason','stale','resultId',r.id)::text;end if;
  perform private.exam_release_check(e.id,r.id);
 end loop;
 for r in select * from private.exam_results x where x.id=any(ids) order by x.id loop
  update private.exam_results set released_at=clock_timestamp(),released_by=u,revision=revision+1 where id=r.id returning * into r;
  perform private.exam_audit_write(e.id,'release',r.user_id,'bulk release',null,jsonb_build_object('resultId',r.id,'score',r.score));
  n:=n+1;out_:=out_||jsonb_build_array(jsonb_build_object('resultId',r.id,'revision',r.revision));
 end loop;
 return jsonb_build_object('released',n,'items',out_);
end $$;

-- Paper marks, all or nothing: [{userId, mark, absent, revision, reason}], 1 to 500. A mark is 0 to the maximum in halves; Absent is not 0;
-- mark null and not absent clears a mark that is not released. revision: the result's (null for a student with no result yet). A
-- released mark changes only with a reason, stays released and is audited.
create function private.exam_paper_mark(p_exam uuid,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;users_ uuid[];it jsonb;r private.exam_results;mark numeric;absent_ boolean;reason_ text;out_ jsonb:='[]'::jsonb;before_ jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_items is null or coalesce(jsonb_typeof(p_items),'')<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'Send 1 to 500 marks' using errcode='23514',detail='{"max":500}';end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where coalesce(jsonb_typeof(x),'')<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('userId','mark','absent','revision','reason'))
   or coalesce(jsonb_typeof(x->'userId'),'')<>'string' or x->>'userId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or coalesce(jsonb_typeof(x->'mark'),'null') not in ('number','null') or coalesce(jsonb_typeof(x->'absent'),'boolean')<>'boolean'
   or coalesce(jsonb_typeof(x->'revision'),'null') not in ('number','null') or (jsonb_typeof(x->'revision')='number' and x->>'revision' !~ '^\d{1,15}$')
   or coalesce(jsonb_typeof(x->'reason'),'string')<>'string' or (coalesce((x->>'absent')::boolean,false) and jsonb_typeof(x->'mark')='number')) then raise exception 'Invalid marks' using errcode='23514';end if;
 users_:=array(select (x->>'userId')::uuid from jsonb_array_elements(p_items) x);
 if cardinality(users_)<>(select count(distinct y) from unnest(users_) y) then raise exception 'A student is listed twice' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for share;
 if e.id is null or not private.exam_staff(e.id,'correct') then raise exception 'Correction denied' using errcode='42501';end if;
 if e.kind<>'paper' then raise exception 'Online exams are marked per question' using errcode='23514';end if;
 if e.status='archived' then raise exception 'Archived exams are read only' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':exam-paper',0));
 perform 1 from private.exam_results x where x.exam_id=e.id and x.user_id=any(users_) order by x.id for update;
 for it in select x from jsonb_array_elements(p_items) x loop
  select * into r from private.exam_results where exam_id=e.id and user_id=(it->>'userId')::uuid;
  if r.id is null and not private.exam_enrolled_user(e.id,(it->>'userId')::uuid) then raise exception 'Student unavailable' using errcode='42501';end if;
  if (it->>'revision')::bigint is distinct from r.revision then raise exception 'A mark changed; reload' using errcode='PT409',detail=jsonb_build_object('reason','stale','userId',it->>'userId')::text;end if;
  mark:=(it->>'mark')::numeric;absent_:=coalesce((it->>'absent')::boolean,false);reason_:=nullif(btrim(coalesce(it->>'reason','')),'');
  if mark is not null and (mark<0 or mark>e.max_marks or mark*2<>trunc(mark*2)) then raise exception 'A mark is 0 to %, in halves',e.max_marks using errcode='23514';end if;
  if r.released_at is not null and (mark,absent_) is distinct from (r.paper_mark,r.absent) then
   if mark is null and not absent_ then raise exception 'A released mark cannot be cleared' using errcode='23514';end if;
   if reason_ is null then raise exception 'Say why a released mark changes' using errcode='23514',detail=jsonb_build_object('reason','reason_required','userId',it->>'userId')::text;end if;
  end if;
  if r.id is not null and (mark,absent_) is not distinct from (r.paper_mark,r.absent) then out_:=out_||jsonb_build_array(jsonb_build_object('userId',r.user_id,'resultId',r.id,'revision',r.revision));continue;end if;
  if r.id is null and mark is null and not absent_ then continue;end if;
  before_:=to_jsonb(r);
  if r.id is null then
   insert into private.exam_results(exam_id,user_id,paper_mark,absent,status,score,max_score,updated_by)
    values(e.id,(it->>'userId')::uuid,mark,absent_,'corrected',mark,e.max_marks,u) returning * into r;
  else
   update private.exam_results set paper_mark=mark,absent=absent_,status=case when mark is null and not absent_ then 'waiting' else 'corrected' end,score=mark,max_score=e.max_marks,
    revision=revision+1,updated_by=u,updated_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  perform private.exam_audit_write(e.id,'paper_mark',r.user_id,reason_,before_,to_jsonb(r));
  out_:=out_||jsonb_build_array(jsonb_build_object('userId',r.user_id,'resultId',r.id,'revision',r.revision));
 end loop;
 return jsonb_build_object('items',out_);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'Invalid marks' using errcode='23514';
end $$;

-- Uploads. intent: a pending row and its storage path (author pictures before work starts; a student's photo answer on an open try).
-- complete: the server's byte check (JWT claim exam_upload {id,size,sha256}, at most 90 s old) and the stored object (owner, size,
-- type); over 5 MB is PT413. get: a ready upload this exam (or its family) shows to the caller.
create function private.exam_upload(p_exam uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;f private.exam_uploads;d jsonb:=coalesce(p_data,'{}'::jsonb);purpose_ text;mime_ text;att private.exam_attempts;
 proof jsonb;owner_ text;size_ bigint;actual_mime text;new_id uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Upload denied' using errcode='42501';end if;
 if p_action is null or p_action not in ('intent','complete','get') or coalesce(jsonb_typeof(d),'')<>'object' then raise exception 'Unknown upload action' using errcode='23514';end if;
 select * into e from private.exams where id=p_exam for share;
 if e.id is null then raise exception 'Upload denied' using errcode='42501';end if;
 if p_action='intent' then
  if exists(select 1 from jsonb_object_keys(d) k where k not in ('purpose','mime','name','attemptId')) or coalesce(d->>'purpose','') not in ('question','model','answer')
   or coalesce(d->>'mime','') not in ('image/png','image/jpeg','image/webp') or (d ? 'name' and coalesce(jsonb_typeof(d->'name'),'')<>'string') then raise exception 'Unsupported upload type' using errcode='23514';end if;
  purpose_:=d->>'purpose';mime_:=d->>'mime';
  if purpose_='answer' then
   if e.kind<>'online' or not private.exam_taker(e.id) or coalesce(jsonb_typeof(d->'attemptId'),'')<>'string' or d->>'attemptId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Upload denied' using errcode='42501';end if;
   select * into att from private.exam_attempts where id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u for share;
   if att.id is null then raise exception 'Upload denied' using errcode='42501';end if;
   if not e.photos_allowed then raise exception 'Photo answers are off for this exam' using errcode='23514';end if;
   if att.status<>'in_progress' or att.deadline_at<=clock_timestamp() then raise exception 'Time is up' using errcode='PT409',detail='{"reason":"deadline_passed"}';end if;
  else
   if not private.exam_staff(e.id,'author') or e.kind<>'online' then raise exception 'Upload denied' using errcode='42501';end if;
   if exists(select 1 from private.exam_attempts where exam_id=e.id) then raise exception 'Students have started' using errcode='PT409',detail='{"reason":"started"}';end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||':'||u::text||':exam-uploads',0));
  if (select count(*) from private.exam_uploads where exam_id=e.id and uploaded_by=u and status='pending' and expires_at>clock_timestamp())>=20 then raise exception 'Finish the pending uploads first' using errcode='23514';end if;
  new_id:=gen_random_uuid();
  insert into private.exam_uploads(id,exam_id,uploaded_by,attempt_id,purpose,name,mime,path) values(new_id,e.id,u,att.id,purpose_,left(coalesce(d->>'name',''),255),mime_,e.id::text||'/'||new_id::text||'/file') returning * into f;
 else
  select * into f from private.exam_uploads where id=p_id for update;
  if f.id is null or not exists(select 1 from private.exams s where s.id=f.exam_id and s.family_id=e.family_id) then raise exception 'Wrong upload' using errcode='42501';end if;
  if p_action='get' then
   if f.status<>'ready' or not private.exam_upload_visible(f.id) then raise exception 'File unavailable' using errcode='42501';end if;
  else
   if f.exam_id<>e.id then raise exception 'Wrong upload' using errcode='42501';end if;
   proof:=auth.jwt()->'exam_upload';
   if f.uploaded_by<>u or proof->>'id' is distinct from f.id::text or coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from now())-90 or coalesce(proof->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(proof->>'size','') !~ '^\d{1,12}$' then raise exception 'Server byte check required' using errcode='42501';end if;
   if f.status='ready' then return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime,'status',f.status);end if;
   if not private.exam_storage('lms-exams',f.path,'insert') then raise exception 'Upload authorization expired' using errcode='42501';end if;
   select o.owner_id,(o.metadata->>'size')::bigint,o.metadata->>'mimetype' into owner_,size_,actual_mime from storage.objects o where o.bucket_id='lms-exams' and o.name=f.path;
   if size_>5242880 then raise exception 'File too large' using errcode='PT413',detail='{"maxBytes":5242880}';end if;
   if owner_ is distinct from auth.jwt()->>'sub' or size_ is null or size_<=0 or size_<>(proof->>'size')::bigint or actual_mime is distinct from f.mime then raise exception 'Invalid stored file' using errcode='23514';end if;
   update private.exam_uploads set status='ready',size_bytes=size_,sha256=proof->>'sha256' where id=f.id returning * into f;
  end if;
 end if;
 return jsonb_build_object('id',f.id,'path',f.path,'name',f.name,'mime',f.mime,'status',f.status);
end $$;

-- ---------------------------------------------------------------------------------------
-- Reads. exam_get, exam_student_list and exam_queue settle the clock first, so they are volatile.
-- ---------------------------------------------------------------------------------------
-- Per student of the run: is their window closed (owner's answer 10)? In Groups: every window of their Groups that has times has closed
-- (and at least one has); in no Group: the latest window has closed. Same time: the one window. No open try in either case.
create function private.exam_user_windows(p_exam uuid) returns table(user_id uuid,closes_at timestamptz,closed boolean,group_ids uuid[]) language sql stable security definer set search_path='' as $$
 with e as (select * from private.exams where id=p_exam),
  ws as materialized (select * from private.exam_windows(p_exam)),
  roster as materialized (select distinct x.user_id from public.enrollments x join e on e.offering_id=x.offering_id where x.status='active' and (x.enrolled_at is null or x.enrolled_at<=clock_timestamp()) and (x.expires_at is null or x.expires_at>clock_timestamp())
   union select r.user_id from private.exam_results r where r.exam_id=p_exam),
  mem as materialized (select m.user_id,m.group_id from public.group_memberships m join public.study_groups g on g.id=m.group_id join e on e.offering_id=m.offering_id
   where g.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())),
  per as (select ro.user_id,array_remove(array_agg(distinct mem.group_id),null) gids from roster ro left join mem on mem.user_id=ro.user_id group by ro.user_id)
 select p.user_id,
  case when e.timing='same_time' then e.closes_at when cardinality(p.gids)>0 then (select max(ws.closes_at) from ws where ws.group_id=any(p.gids) and ws.state='ok') else (select max(ws.closes_at) from ws where ws.state='ok') end,
  coalesce(case when e.kind<>'online' then true when e.status='draft' then false
   when e.timing='same_time' then e.closes_at<=clock_timestamp()
   when cardinality(p.gids)>0 then exists(select 1 from ws where ws.group_id=any(p.gids) and ws.state='ok') and not exists(select 1 from ws where ws.group_id=any(p.gids) and ws.state='ok' and ws.closes_at>clock_timestamp())
   else (select max(ws.closes_at) from ws where ws.state='ok')<=clock_timestamp() end,false)
  and not exists(select 1 from private.exam_attempts a where a.exam_id=p_exam and a.user_id=p.user_id and a.status='in_progress'),
  p.gids
 from per p cross join e
$$;

-- One exam for its staff (everything, with keys and every Group's window) or its student (their window, tries and released result).
-- With p_attempt: that try too.
create function private.exam_get(p_exam uuid,p_attempt uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());e private.exams;staff boolean;w record;r private.exam_results;base jsonb;released boolean;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into e from private.exams where id=p_exam;
 if e.id is null then raise exception 'Exam unavailable' using errcode='42501';end if;
 staff:=private.exam_staff(e.id);
 if not staff and not private.exam_taker(e.id) then raise exception 'Exam unavailable' using errcode='42501';end if;
 if p_attempt is not null and not exists(select 1 from private.exam_attempts a where a.id=p_attempt and a.exam_id=e.id) then raise exception 'Try unavailable' using errcode='42501';end if;
 if e.kind='online' and e.status<>'draft' then
  if staff then perform private.exam_settle(e.id);else perform private.exam_settle(e.id,u);end if;
 end if;
 select * into e from private.exams where id=p_exam;
 base:=private.exam_settings_json(e.id)||jsonb_build_object('serverNow',clock_timestamp(),'lastClose',private.exam_last_close(e.id),'closed',private.exam_closed(e.id),'reviewOpen',private.exam_review_open(e.id));
 if staff then
  base:=base||jsonb_build_object('revision',e.revision,'staff',true,
   'can',jsonb_build_object('author',private.exam_staff(e.id,'author'),'correct',private.exam_staff(e.id,'correct'),'release',private.exam_staff(e.id,'release')),
   'started',exists(select 1 from private.exam_attempts a where a.exam_id=e.id) or exists(select 1 from private.exam_results x where x.exam_id=e.id),
   'questions',coalesce((select jsonb_agg(private.exam_question_json(q.id,true) order by q.position) from private.exam_questions q where q.exam_id=e.id),'[]'::jsonb),
   'windows',coalesce((select jsonb_agg(jsonb_build_object('groupId',x.group_id,'groupName',x.group_name,'source',x.source,'sessionId',x.session_id,'opensAt',x.opens_at,'closesAt',x.closes_at,
     'state',x.state,'frozen',x.frozen) order by x.group_name,x.group_id) from private.exam_windows(e.id) x),'[]'::jsonb),
   'holds',coalesce((select jsonb_agg(jsonb_build_object('groupId',x.group_id,'groupName',x.group_name,'state',x.state) order by x.group_name,x.group_id) from private.exam_windows(e.id) x where x.state<>'ok'),'[]'::jsonb));
 else
  select * into w from private.exam_student_window(e.id,u);
  select * into r from private.exam_results where exam_id=e.id and user_id=u;
  released:=r.id is not null and private.exam_released(r.id);
  base:=base-'chapterIds'||jsonb_build_object('staff',false,'window',case when e.kind='online' then jsonb_build_object('groupId',w.group_id,'opensAt',w.opens_at,'closesAt',w.closes_at,'state',w.state) end,
   'tries',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'number',a.number,'status',a.status,'startedAt',a.started_at,'deadlineAt',a.deadline_at,'submittedAt',a.submitted_at,
     'autoSubmitted',a.auto_submitted,'revision',a.revision) order by a.number) from private.exam_attempts a where a.exam_id=e.id and a.user_id=u),'[]'::jsonb),
   'result',case when released then jsonb_build_object('score',r.score,'maxScore',r.max_score,'absent',r.absent,'releasedAt',coalesce(r.released_at,private.exam_last_close(e.id)))
    when r.id is not null then jsonb_build_object('waiting',true) end);
 end if;
 if p_attempt is not null then base:=base||jsonb_build_object('attempt',private.exam_attempt_json(p_attempt));end if;
 return base;
end $$;

-- The student's exams (every run they are enrolled in): published and archived ones, with their window, try state and released result.
create function private.exam_student_list() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());ids uuid[];x uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 ids:=array(select e.id from private.exams e join public.enrollments n on n.offering_id=e.offering_id and n.user_id=u and n.status='active' and (n.enrolled_at is null or n.enrolled_at<=clock_timestamp()) and (n.expires_at is null or n.expires_at>clock_timestamp())
  join public.course_offerings o on o.id=e.offering_id and o.status='active' join public.courses c on c.id=e.course_id and c.status='published'
  where e.status in ('published','archived') and e.published_at is not null order by e.published_at desc,e.id limit 200);
 foreach x in array ids loop perform private.exam_settle(x,u);end loop;
 return jsonb_build_object('serverNow',clock_timestamp(),'rows',coalesce((select jsonb_agg(j order by sort_at nulls last,id) from (
  select e.id,coalesce(w.opens_at,e.published_at) sort_at,jsonb_build_object('id',e.id,'title',e.title,'kind',e.kind,'status',e.status,'courseId',e.course_id,'courseTitle',c.title,'offeringId',e.offering_id,
   'heldOn',e.held_on,'timeLimitMinutes',e.time_limit_minutes,'tries',e.tries_mode,
   'window',case when e.kind='online' then jsonb_build_object('opensAt',w.opens_at,'closesAt',w.closes_at,'state',w.state) end,
   'tryState',case when exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=u and a.status='in_progress') then 'in_progress'
    when exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=u) then 'submitted' else 'not_started' end,
   'result',case when r.id is not null and private.exam_released(r.id) then jsonb_build_object('score',r.score,'maxScore',r.max_score,'absent',r.absent) end) j
  from private.exams e join public.courses c on c.id=e.course_id left join lateral private.exam_student_window(e.id,u) w on true
  left join private.exam_results r on r.exam_id=e.id and r.user_id=u where e.id=any(ids)) z),'[]'::jsonb));
end $$;

-- The Exams page of a teacher (homework_portal's scope): tab open (published, last window not closed, or held), closed, drafts, archived.
-- Open online rows also carry each Group's window with started / total and secondsLeft (server clock), and the students in no Group.
create function private.exam_portal(p_course uuid default null,p_tab text default 'open',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());courses_ uuid[];eds uuid[];sups uuid[];at_ timestamptz:=clock_timestamp();
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('open','closed','drafts','archived') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 courses_:=array(select c.id from public.courses c where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and (p_course is null or c.id=p_course));
 eds:=array(select y from unnest(courses_) y where private.can_edit_course(y));
 sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));
 if p_course is not null and cardinality(eds)=0 and cardinality(sups)=0 then raise exception 'Exams unavailable' using errcode='42501';end if;
 return (with ex as materialized (select e.*,e.offering_id=any(sups) counted,
    case when e.status='draft' then 'drafts' when e.status='archived' then 'archived' when e.kind='paper' then 'closed' when private.exam_closed(e.id) then 'closed' else 'open' end tab
   from private.exams e where e.course_id=any(courses_) and (e.offering_id=any(sups) or e.course_id=any(eds))),
  listed as materialized (select * from ex where tab=p_tab order by case when p_tab='drafts' then updated_at end desc,coalesce(opens_at,published_at,updated_at) desc,id limit 25 offset p_page*25),
  qs as materialized (select q.exam_id,count(*) n,coalesce(sum(q.points),0) m,bool_or(q.type='essay') essays from private.exam_questions q where q.exam_id in (select id from listed) group by q.exam_id),
  roster as materialized (select x.offering_id,count(distinct x.user_id) n from public.enrollments x where x.offering_id in (select offering_id from listed where counted) and x.status='active' and (x.enrolled_at is null or x.enrolled_at<=at_) and (x.expires_at is null or x.expires_at>at_) group by x.offering_id),
  res as materialized (select r.exam_id,count(*) filter(where r.final_attempt_id is not null or r.paper_mark is not null or r.absent) handed,count(*) filter(where r.status='waiting') waiting,
    count(*) filter(where r.status='corrected' and r.released_at is null) unreleased,count(*) filter(where r.released_at is not null) released from private.exam_results r where r.exam_id in (select id from listed where counted) group by r.exam_id),
  -- Open online exams the caller counts for: every active Group's window with started / total and the time left (server clock), and the
  -- students in no Group (their window spans the Groups'). A student in two Groups counts in both.
  live as materialized (select l.id,l.offering_id,l.timing,l.opens_at,l.closes_at from listed l where l.tab='open' and l.counted and l.kind='online'),
  gw as materialized (select v.id exam_id,w.group_id,w.group_name,w.opens_at,w.closes_at,w.state from live v cross join lateral private.exam_windows(v.id) w where v.timing='per_group'
   union all select v.id,g.id,g.name,v.opens_at,v.closes_at,'ok' from live v join public.study_groups g on g.offering_id=v.offering_id and g.status='active' where v.timing='same_time'),
  enr as materialized (select x.offering_id,x.user_id from public.enrollments x where x.offering_id in (select offering_id from live) and x.status='active'
   and (x.enrolled_at is null or x.enrolled_at<=at_) and (x.expires_at is null or x.expires_at>at_) group by x.offering_id,x.user_id),
  mem as materialized (select m.group_id,m.offering_id,m.user_id from public.group_memberships m join enr on enr.offering_id=m.offering_id and enr.user_id=m.user_id
   join public.study_groups g on g.id=m.group_id and g.status='active' where m.starts_at<=at_ and (m.ends_at is null or m.ends_at>at_) group by m.group_id,m.offering_id,m.user_id),
  took as materialized (select a.exam_id,a.user_id from private.exam_attempts a where a.exam_id in (select id from live) group by a.exam_id,a.user_id),
  per_group as materialized (select gw.exam_id,jsonb_agg(jsonb_build_object('groupId',gw.group_id,'name',gw.group_name,'state',gw.state,'opensAt',gw.opens_at,'closesAt',gw.closes_at,
    'window',case when gw.state<>'ok' then gw.state when at_<gw.opens_at then 'upcoming' when at_<gw.closes_at then 'open' else 'closed' end,
    'secondsLeft',case when gw.state='ok' and gw.opens_at<=at_ and at_<gw.closes_at then floor(extract(epoch from gw.closes_at-at_))::bigint end,
    'total',(select count(*) from mem where mem.group_id=gw.group_id),
    'started',(select count(*) from mem join took on took.user_id=mem.user_id and took.exam_id=gw.exam_id where mem.group_id=gw.group_id))
    order by gw.group_name,gw.group_id) groups from gw group by gw.exam_id),
  no_group as materialized (select v.id exam_id,count(*) total,count(*) filter(where exists(select 1 from took where took.exam_id=v.id and took.user_id=enr.user_id)) started
   from live v join enr on enr.offering_id=v.offering_id where not exists(select 1 from mem where mem.offering_id=v.offering_id and mem.user_id=enr.user_id) group by v.id)
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',25,'serverNow',at_,
  'counts',(select jsonb_build_object('open',count(*) filter(where tab='open'),'closed',count(*) filter(where tab='closed'),'drafts',count(*) filter(where tab='drafts'),'archived',count(*) filter(where tab='archived')) from ex),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'kind',l.kind,'status',l.status,'courseId',l.course_id,'courseTitle',c.title,'offeringId',l.offering_id,'version',l.version,
    'timing',l.timing,'startingFrom',l.starting_from,'opensAt',l.opens_at,'closesAt',l.closes_at,'heldOn',l.held_on,'timeLimitMinutes',l.time_limit_minutes,'updatedAt',l.updated_at,
    'lastClose',case when l.kind='online' and l.status<>'draft' then private.exam_last_close(l.id) end,
    'held',l.kind='online' and l.timing='per_group' and l.status='published' and exists(select 1 from private.exam_windows(l.id) w where w.state<>'ok'),
    'questionCount',coalesce(qs.n,0),'totalMarks',case when l.kind='paper' then l.max_marks else coalesce(qs.m,0) end,'hasEssays',coalesce(qs.essays,false),
    'total',case when l.counted then coalesce(ro.n,0) end,'handedIn',case when l.counted then coalesce(rs.handed,0) end,'waiting',case when l.counted then coalesce(rs.waiting,0) end,
    'toRelease',case when l.counted then coalesce(rs.unreleased,0) end,'released',case when l.counted then coalesce(rs.released,0) end,
    'groups',case when lv.id is not null then coalesce(pg.groups,'[]'::jsonb) end,
    'noGroup',case when lv.id is not null then jsonb_build_object('total',coalesce(ng.total,0),'started',coalesce(ng.started,0)) end)
    order by case when p_tab='drafts' then l.updated_at end desc,coalesce(l.opens_at,l.published_at,l.updated_at) desc,l.id)
   from listed l join public.courses c on c.id=l.course_id left join qs on qs.exam_id=l.id left join roster ro on ro.offering_id=l.offering_id left join res rs on rs.exam_id=l.id
   left join live lv on lv.id=l.id left join per_group pg on pg.exam_id=l.id left join no_group ng on ng.exam_id=l.id),'[]'::jsonb)));
end $$;

-- Correction queue of an online exam (homework_queue's shape): tab to_correct (a mark waits) | corrected | missing (no try handed in).
-- readyToRelease / releasable: corrected, not released, that student's window closed (at most 500 {resultId, revision}).
create function private.exam_queue(p_exam uuid,p_tab text default 'to_correct',p_page integer default 0) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare e private.exams;
begin
 if private.current_app_user_id() is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into e from private.exams where id=p_exam;
 if e.id is null or not private.exam_staff(e.id,'grade') then raise exception 'Correction denied' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('to_correct','corrected','missing') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 if e.kind<>'online' then raise exception 'A paper exam uses the mark sheet' using errcode='23514';end if;
 perform private.exam_settle(e.id);
 return (with uw as materialized (select * from private.exam_user_windows(e.id)),
  rs as materialized (select r.*,a.number,a.submitted_at,a.auto_submitted,(select count(*) from private.exam_marks m where m.attempt_id=a.id and m.points is null) waiting_marks
   from private.exam_results r join private.exam_attempts a on a.id=r.final_attempt_id where r.exam_id=e.id),
  rows_ as materialized (select uw.user_id,uw.closed,uw.group_ids,uw.closes_at,rs.id result_id,rs.final_attempt_id,rs.number,rs.submitted_at,rs.auto_submitted,rs.status,rs.score,rs.max_score,rs.released_at,rs.revision,rs.waiting_marks,
    p.display_name,case when rs.id is null then 'missing' when rs.status='waiting' then 'to_correct' else 'corrected' end tab,
    exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=uw.user_id and a.status='in_progress') in_progress
   from uw left join rs on rs.user_id=uw.user_id join public.profiles p on p.id=uw.user_id),
  rel as materialized (select result_id,revision from rows_ where status='corrected' and released_at is null and closed order by result_id limit 500)
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',50,'serverNow',clock_timestamp(),'lastClose',private.exam_last_close(e.id),'closed',private.exam_closed(e.id),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('groupId',w.group_id,'groupName',w.group_name,'state',w.state) order by w.group_name,w.group_id) from private.exam_windows(e.id) w where w.state<>'ok'),'[]'::jsonb),
  'counts',(select jsonb_build_object('to_correct',count(*) filter(where tab='to_correct'),'corrected',count(*) filter(where tab='corrected'),'missing',count(*) filter(where tab='missing'),
    'released',count(*) filter(where released_at is not null),'inProgress',count(*) filter(where in_progress)) from rows_),
  'readyToRelease',(select count(*) from rows_ where status='corrected' and released_at is null and closed),
  'releasable',coalesce((select jsonb_agg(jsonb_build_object('resultId',result_id,'revision',revision) order by result_id) from rel),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',x.display_name,'groupIds',to_jsonb(x.group_ids),'resultId',x.result_id,'attemptId',x.final_attempt_id,'number',x.number,
    'submittedAt',x.submitted_at,'autoSubmitted',x.auto_submitted,'status',x.status,'score',x.score,'maxScore',x.max_score,'waitingMarks',x.waiting_marks,'released',x.released_at is not null,
    'releasedAt',x.released_at,'revision',x.revision,'windowClosed',x.closed,'windowClosesAt',x.closes_at,'inProgress',x.in_progress) order by x.o)
   from (select r.*,row_number() over(order by case when p_tab='to_correct' then r.submitted_at end,r.display_name nulls last,r.user_id) o from rows_ r where r.tab=p_tab order by o limit 50 offset p_page*50) x),'[]'::jsonb)));
end $$;

-- The mark sheet of a paper exam: every student of the run (or of one Group, or 'none' = in no Group), with their mark, Absent and revision.
create function private.exam_paper_sheet(p_exam uuid,p_group text default null,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.exams;g uuid;
begin
 if private.current_app_user_id() is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 select * into e from private.exams where id=p_exam;
 if e.id is null or not private.exam_staff(e.id,'grade') then raise exception 'Mark sheet denied' using errcode='42501';end if;
 if e.kind<>'paper' then raise exception 'Online exams use the correction queue' using errcode='23514';end if;
 if p_page is null or p_page not between 0 and 100000 or (p_group is not null and p_group<>'none' and p_group !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'Invalid Group or page' using errcode='23514';end if;
 if p_group is not null and p_group<>'none' then
  g:=p_group::uuid;
  if not exists(select 1 from public.study_groups s where s.id=g and s.offering_id=e.offering_id) then raise exception 'Group unavailable' using errcode='42501';end if;
 end if;
 return (with uw as materialized (select * from private.exam_user_windows(e.id)),
  sel as materialized (select uw.user_id,uw.group_ids,p.display_name from uw join public.profiles p on p.id=uw.user_id
   where p_group is null or (p_group='none' and cardinality(uw.group_ids)=0) or g=any(uw.group_ids)),
  rows_ as materialized (select s.*,r.id result_id,r.paper_mark,r.absent,r.status,r.released_at,r.revision from sel s left join private.exam_results r on r.exam_id=e.id and r.user_id=s.user_id)
 select jsonb_build_object('page',p_page,'pageSize',100,'maxMarks',e.max_marks,'heldOn',e.held_on,'status',e.status,'serverNow',clock_timestamp(),
  'counts',(select jsonb_build_object('total',count(*),'marked',count(*) filter(where paper_mark is not null),'absent',count(*) filter(where absent),'released',count(*) filter(where released_at is not null)) from rows_),
  'releasable',coalesce((select jsonb_agg(jsonb_build_object('resultId',result_id,'revision',revision) order by result_id) from (select * from rows_ where status='corrected' and released_at is null order by result_id limit 500) z),'[]'::jsonb),
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id) from public.study_groups s where s.offering_id=e.offering_id and s.status='active'),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'name',x.display_name,'groupIds',to_jsonb(x.group_ids),'resultId',x.result_id,'mark',x.paper_mark,'absent',coalesce(x.absent,false),
    'released',x.released_at is not null,'releasedAt',x.released_at,'revision',x.revision) order by x.display_name nulls last,x.user_id)
   from (select * from rows_ order by display_name nulls last,user_id limit 100 offset p_page*100) x),'[]'::jsonb)));
end $$;

-- Storage used by the exams of a teaching space (its owners and admins), as homework_storage_usage.
create function private.exam_storage_usage(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.has_org_role(p_space,array['owner','admin']) then raise exception 'Storage usage denied' using errcode='42501';end if;
 return (with ex as materialized (select e.id,e.title,e.course_id,e.version from private.exams e join public.courses c on c.id=e.course_id where c.organization_id=p_space),
  f as materialized (select x.exam_id,x.purpose,x.size_bytes from private.exam_uploads x where x.exam_id in (select id from ex) and x.status='ready'),
  per as materialized (select ex.id,ex.title,ex.course_id,ex.version,
    coalesce(sum(f.size_bytes) filter(where f.purpose='answer'),0) student_bytes,count(f.exam_id) filter(where f.purpose='answer') student_files,
    coalesce(sum(f.size_bytes) filter(where f.purpose<>'answer'),0) teacher_bytes,count(f.exam_id) filter(where f.purpose<>'answer') teacher_files
   from ex left join f on f.exam_id=ex.id group by ex.id,ex.title,ex.course_id,ex.version)
  select jsonb_build_object('studentBytes',coalesce(sum(student_bytes),0),'studentFiles',coalesce(sum(student_files),0),'teacherBytes',coalesce(sum(teacher_bytes),0),'teacherFiles',coalesce(sum(teacher_files),0),
   'examCount',count(*),
   'exams',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'courseId',p.course_id,'version',p.version,'studentBytes',p.student_bytes,'studentFiles',p.student_files,'teacherBytes',p.teacher_bytes,'teacherFiles',p.teacher_files) order by p.student_bytes+p.teacher_bytes desc,p.id)
    from (select * from per where student_files+teacher_files>0 order by student_bytes+teacher_bytes desc,id limit 100) p),'[]'::jsonb)) from per);
end $$;

-- ---------------------------------------------------------------------------------------
-- Grants: internal helpers to nobody; the API definers to authenticated (the public wrappers run as the caller).
-- ---------------------------------------------------------------------------------------
do $$ declare f text;begin
 foreach f in array array['exam_question_json(uuid,boolean,uuid[])','exam_settings_json(uuid)','exam_check(uuid)','exam_apply_timing(uuid,jsonb)','exam_attempt_json(uuid)',
  'exam_release_check(uuid,uuid)','exam_user_windows(uuid)'] loop
  execute format('revoke all on function private.%s from public,anon,authenticated,service_role',f);
 end loop;
 foreach f in array array['exam_save(uuid,uuid,bigint,jsonb)','exam_lifecycle(uuid,text,bigint,jsonb)','exam_set_window(uuid,uuid,bigint,jsonb)','exam_work(uuid,text,bigint,jsonb)',
  'exam_release_many(uuid,jsonb)','exam_paper_mark(uuid,jsonb)','exam_upload(uuid,text,uuid,jsonb)','exam_get(uuid,uuid)','exam_student_list()','exam_portal(uuid,text,integer)',
  'exam_queue(uuid,text,integer)','exam_paper_sheet(uuid,text,integer)','exam_storage_usage(uuid)'] loop
  execute format('revoke all on function private.%s from public,anon,service_role',f);
  execute format('grant execute on function private.%s to authenticated',f);
 end loop;
end $$;
create function public.exam_save(p_exam uuid,p_offering uuid,p_revision bigint,p_definition jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.exam_save(p_exam,p_offering,p_revision,p_definition)$$;
create function public.exam_lifecycle(p_exam uuid,p_action text,p_revision bigint,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.exam_lifecycle(p_exam,p_action,p_revision,p_data)$$;
create function public.exam_set_window(p_exam uuid,p_group uuid,p_revision bigint,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.exam_set_window(p_exam,p_group,p_revision,p_data)$$;
create function public.exam_work(p_exam uuid,p_action text,p_revision bigint default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.exam_work(p_exam,p_action,p_revision,p_data)$$;
create function public.exam_release_many(p_exam uuid,p_items jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.exam_release_many(p_exam,p_items)$$;
create function public.exam_paper_mark(p_exam uuid,p_items jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.exam_paper_mark(p_exam,p_items)$$;
create function public.exam_upload(p_exam uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.exam_upload(p_exam,p_action,p_id,p_data)$$;
create function public.exam_get(p_exam uuid,p_attempt uuid default null) returns jsonb language sql volatile security invoker set search_path='' as $$select private.exam_get(p_exam,p_attempt)$$;
create function public.exam_student_list() returns jsonb language sql volatile security invoker set search_path='' as $$select private.exam_student_list()$$;
create function public.exam_portal(p_course uuid default null,p_tab text default 'open',p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.exam_portal(p_course,p_tab,p_page)$$;
create function public.exam_queue(p_exam uuid,p_tab text default 'to_correct',p_page integer default 0) returns jsonb language sql volatile security invoker set search_path='' as $$select private.exam_queue(p_exam,p_tab,p_page)$$;
create function public.exam_paper_sheet(p_exam uuid,p_group text default null,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select private.exam_paper_sheet(p_exam,p_group,p_page)$$;
create function public.exam_storage_usage(p_space uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.exam_storage_usage(p_space)$$;
do $$ declare f text;begin
 foreach f in array array['exam_save(uuid,uuid,bigint,jsonb)','exam_lifecycle(uuid,text,bigint,jsonb)','exam_set_window(uuid,uuid,bigint,jsonb)','exam_work(uuid,text,bigint,jsonb)',
  'exam_release_many(uuid,jsonb)','exam_paper_mark(uuid,jsonb)','exam_upload(uuid,text,uuid,jsonb)','exam_get(uuid,uuid)','exam_student_list()','exam_portal(uuid,text,integer)',
  'exam_queue(uuid,text,integer)','exam_paper_sheet(uuid,text,integer)','exam_storage_usage(uuid)'] loop
  execute format('revoke all on function public.%s from public,anon,service_role',f);
  execute format('grant execute on function public.%s to authenticated',f);
 end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- The legacy builder is closed (owner's answer 2): no client can save or clone a legacy exam. The legacy runner keeps reading and
-- writing the old tables; the definitions stay for it and for history.
-- ---------------------------------------------------------------------------------------
revoke execute on function private.save_exam_definition(uuid,uuid,timestamptz,jsonb),public.save_exam_definition(uuid,uuid,timestamptz,jsonb),
 private.save_exam_definition_v2(uuid,uuid,timestamptz,jsonb),public.save_exam_definition_v2(uuid,uuid,timestamptz,jsonb),
 private.clone_exam_schedule(uuid),public.clone_exam_schedule(uuid) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- Demo Clear (owner's answer 13): as 20261109120000, plus exams. Two blockers name what Clear never removes: "exams from real people"
-- (a try or a result of anyone who is not a recorded demo student) and "exam files" (a stored object under an exam of the space). Otherwise
-- the exams of the space's courses and offerings are removed before the Groups, profiles, offerings and courses they reference. Every line
-- that is not about exams is copied unchanged.
-- ---------------------------------------------------------------------------------------
create or replace function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 courses_ uuid[]; offerings_ uuid[]; groups_ uuid[]; sessions_ uuid[]; events_ uuid[]; lessons_ uuid[]; profiles_ uuid[]; enrollments_ uuid[]; blockers_ text[] := '{}';
 n_tracked integer := 0; n_added integer := 0; n_support integer := 0; cnt integer;
 added jsonb := '{}'::jsonb; hws_ uuid[]; subs_ uuid[]; n_hw integer := 0; exams_ uuid[]; results_ uuid[]; attempts_ uuid[]; n_ex integer := 0;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;

 select coalesce(array_agg(row_id) filter (where table_name='courses'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='profiles'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='enrollments'),'{}')
  into courses_,profiles_,enrollments_ from private.demo_seed_rows where organization_id=p_org;
 if exists(select 1 from public.courses where id=any(courses_) and organization_id<>p_org) then
  raise exception 'Demo records do not match this space' using errcode='PT409'; end if;
 select coalesce(array_agg(distinct o.id),'{}') into offerings_ from public.course_offerings o
  where o.course_id=any(courses_)
     or o.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='course_offerings');
 select coalesce(array_agg(distinct g.id),'{}') into groups_ from public.study_groups g
  where g.offering_id=any(offerings_)
     or g.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='study_groups');
 select coalesce(array_agg(s.id),'{}') into sessions_ from public.group_sessions s where s.group_id=any(groups_);
 select coalesce(array_agg(l.id),'{}') into lessons_ from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=any(courses_);
 select coalesce(array_agg(h.id),'{}') into hws_ from public.homework_assignments h where h.course_id=any(courses_) or h.offering_id=any(offerings_);
 select coalesce(array_agg(s.id),'{}') into subs_ from public.homework_submissions s where s.assignment_id=any(hws_);
 select coalesce(array_agg(e.id),'{}') into exams_ from private.exams e where e.course_id=any(courses_) or e.offering_id=any(offerings_);
 select coalesce(array_agg(r.id),'{}') into results_ from private.exam_results r where r.exam_id=any(exams_);
 select coalesce(array_agg(a.id),'{}') into attempts_ from private.exam_attempts a where a.exam_id=any(exams_);

 -- A real student (any enrollment that is not recorded as a demo enrollment), and content this function does not remove. Refuse, naming it.
 if private.space_has_real_students(p_org) then blockers_ := array_append(blockers_,'enrolled students'::text); end if;
 if exists(select 1 from public.homework_submissions where id=any(subs_) and not (user_id=any(profiles_))) then blockers_ := array_append(blockers_,'homework from real people'::text); end if;
 if exists(select 1 from storage.objects o where o.bucket_id='lms-homework' and split_part(o.name,'/',1)=any(array(select x::text from unnest(hws_) x))) then blockers_ := array_append(blockers_,'homework files'::text); end if;
 if exists(select 1 from private.exam_attempts where id=any(attempts_) and not (user_id=any(profiles_))) or exists(select 1 from private.exam_results where id=any(results_) and not (user_id=any(profiles_))) then
  blockers_ := array_append(blockers_,'exams from real people'::text); end if;
 if exists(select 1 from storage.objects o where o.bucket_id='lms-exams' and split_part(o.name,'/',1)=any(array(select x::text from unnest(exams_) x))) then blockers_ := array_append(blockers_,'exam files'::text); end if;
 if exists(select 1 from public.assessments where course_id=any(courses_)) or exists(select 1 from public.offering_assessments where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'exams'::text); end if;
 if exists(select 1 from public.media_assets where offering_id=any(offerings_)) or exists(select 1 from private.lesson_upload_scopes where course_id=any(courses_)) then blockers_ := array_append(blockers_,'media'::text); end if;
 if exists(select 1 from public.lesson_segments where lesson_id=any(lessons_)) then blockers_ := array_append(blockers_,'lesson segments'::text); end if;
 if exists(select 1 from public.lesson_progress where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'student progress'::text); end if;
 if exists(select 1 from public.website_catalog_entries where course_id=any(courses_)) or exists(select 1 from private.website_publication_courses where course_id=any(courses_)) then blockers_ := array_append(blockers_,'website courses'::text); end if;
 -- The Students screen: a teacher's own use (a join link, a suspension) is removed below. What a REAL person did is never touched: Clear stops and says so.
 if exists(select 1 from public.enrollment_requests where offering_id=any(offerings_) and not (user_id=any(profiles_)))
   or exists(select 1 from private.student_access_links where offering_id=any(offerings_)
     and ((recipient_id is not null and not (recipient_id=any(profiles_))) or (claimed_by is not null and not (claimed_by=any(profiles_))))) then
  blockers_ := array_append(blockers_,'join requests or invitations from real people'::text); end if;
 if exists(select 1 from private.student_admin_audit where offering_id=any(offerings_) and subject_id is not null and not (subject_id=any(profiles_))) then
  blockers_ := array_append(blockers_,'student administration records of real people'::text); end if;
 if cardinality(blockers_)>0 then
  raise exception 'This demo space holds content that Clear does not remove: %. Remove it first.',array_to_string(blockers_,', ') using errcode='PT409'; end if;

 -- Notifications that belong to the Groups, Sessions and demo students (by event key prefix, session, group, enrollment or recipient).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id=any(sessions_) or resource_id=any(groups_) or resource_id=any(sessions_) or resource_id=any(enrollments_)
     or resource_id=any(subs_) or resource_id=any(results_)
     or id in (select event_id from public.notifications where recipient_id=any(profiles_));
 delete from private.notification_deliveries where notification_id in (select id from public.notifications where event_id=any(events_) or recipient_id=any(profiles_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.notifications where event_id=any(events_) or recipient_id=any(profiles_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.notification_events where id=any(events_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_notification_state where group_id=any(groups_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_audit where group_id=any(groups_) or session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.session_attendance where session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;

 -- Homework of the space's courses and offerings, in foreign-key order: correction rows, tries and their answers, the homework's own rows
 -- and upload rows, then the versions, newest first (a version is removed once nothing supersedes it).
 delete from private.homework_annotations where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_marks where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_corrections where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_carried where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_solutions_seen where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.homework_responses where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_submission_files where submission_id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_audit where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_clone_sources where upload_id in (select id from private.homework_uploads where assignment_id=any(hws_)) or source_id in (select id from private.homework_uploads where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.homework_materials where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_solutions where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 -- Keys and options first (they would also go by ON DELETE CASCADE), so every removed row is counted.
 delete from private.homework_keys where question_id in (select id from public.homework_questions where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_options where question_id in (select id from public.homework_questions where assignment_id=any(hws_));
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_questions where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from private.homework_uploads where assignment_id=any(hws_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 delete from public.homework_submissions where id=any(subs_);
 get diagnostics cnt = row_count; n_hw := n_hw+cnt;
 loop
  delete from public.homework_assignments h where h.id=any(hws_) and not exists(select 1 from public.homework_assignments c where c.supersedes_id=h.id or (c.family_id=h.id and c.id<>h.id));
  get diagnostics cnt = row_count; n_hw := n_hw+cnt;
  exit when cnt=0;
 end loop;
 n_added := n_added+n_hw; added := added||jsonb_build_object('homework',n_hw);

 -- Exams of the space's courses and offerings (20261114120000): what the teacher added and demo students' work (real people's work and
 -- stored files were refused above), in foreign-key order, then the versions, newest first.
 delete from private.exam_audit where exam_id=any(exams_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.exam_marks where attempt_id=any(attempts_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_responses where attempt_id=any(attempts_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_attempt_items where attempt_id=any(attempts_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_results where id=any(results_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_group_windows where exam_id=any(exams_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_keys where question_id in (select id from private.exam_questions where exam_id=any(exams_));
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_options where question_id in (select id from private.exam_questions where exam_id=any(exams_));
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_questions where exam_id=any(exams_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_uploads where exam_id=any(exams_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_attempts where id=any(attempts_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 delete from private.exam_chapters where exam_id=any(exams_);
 get diagnostics cnt = row_count; n_ex := n_ex+cnt;
 loop
  delete from private.exams e where e.id=any(exams_) and not exists(select 1 from private.exams c where c.supersedes_id=e.id);
  get diagnostics cnt = row_count; n_ex := n_ex+cnt;
  exit when cnt=0;
 end loop;
 n_added := n_added+n_ex; added := added||jsonb_build_object('exams',n_ex);

 -- What the teacher's own use of the Students screen left behind in this space, found by the space's recorded offerings only:
 -- join links (the teacher's, or for a demo student), requests of demo students, and the student-administration audit rows about demo students
 -- or about no student at all (links). Real people's rows were refused above, so none of these is a real person's. The audit table is not
 -- append-only in the database; removing these rows is recorded in the platform audit row written at the end (removedByTable).
 delete from private.student_access_links where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('student_access_links',cnt);
 delete from public.enrollment_requests where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollment_requests',cnt);
 delete from private.student_admin_audit where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_support := n_support+cnt; added := added||jsonb_build_object('student_admin_audit',cnt);

 -- Everything that hangs off the Groups, recorded or added by the teacher.
 delete from public.group_sessions where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_sessions',cnt);
 delete from public.group_schedules where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_schedules',cnt);
 delete from public.group_memberships where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_memberships',cnt);
 delete from public.group_staff where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_staff',cnt);
 delete from public.study_groups where id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('study_groups',cnt);
 -- The demo students: enrollments (the per-enrollment administration version goes by ON DELETE CASCADE), then the fake profiles.
 delete from public.enrollments where id=any(enrollments_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollments',cnt);
 delete from public.profiles where id=any(profiles_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('profiles',cnt);
 -- Course-level rows that block the course itself.
 delete from public.course_stage_assignments where course_id=any(courses_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_stage_assignments',cnt);
 delete from private.course_stage_versions where course_id=any(courses_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.course_offerings where id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_offerings',cnt);
 -- The recorded courses. Chapters, lessons and lesson blocks (recorded or added by the teacher), course staff and offering staff are removed
 -- by the existing ON DELETE CASCADE chain (courses -> course_modules -> lessons -> lesson_blocks). Chapters and lessons are counted first; lesson blocks and
 -- course/offering staff rows (a trigger adds the course owner) cascade and are not counted.
 select count(*) into cnt from public.course_modules where course_id=any(courses_);
 n_tracked := cnt+cardinality(lessons_); added := added||jsonb_build_object('course_modules',cnt,'lessons',cardinality(lessons_));
 delete from public.courses where id=any(courses_);
 get diagnostics cnt = row_count; n_tracked := n_tracked+cnt; added := added||jsonb_build_object('courses',cnt);
 delete from private.demo_seed_rows where organization_id=p_org;
 update private.demo_spaces set seed_version=null,filled_at=null where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.clear','organization',p_org,p_org,
  jsonb_build_object('rows',n_tracked+n_added,'removedRows',n_tracked+n_added,'removedSupportRows',n_support,'removedByTable',added,
   'removedCourseTree',n_tracked));
 return jsonb_build_object('removedRows',n_tracked+n_added,'removedSupportRows',n_support);
end $$;

notify pgrst,'reload schema';

commit;
