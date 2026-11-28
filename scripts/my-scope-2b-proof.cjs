#!/usr/bin/env node
// Fix track 2b ("my scope" for Groups, homework, exams and enrollments) proof: OLD rules vs NEW rules on identical rows, the reads compared
// as JSON (with the rows each call writes), and the before -> after timings with the hosted limit (statement_timeout 8 s), a fresh
// connection per timed call (the audit's method) and the helper call counts (pg_stat_xact_user_functions).
//   node scripts/exam-sql-local.cjs --postgres      (once: builds the migrated template)
//   node scripts/my-scope-2b-proof.cjs              (every step; or MY_SCOPE_ONLY=build,apply,groups,space,enrol,rows,explain)
// Steps that reuse the databases: MY_SCOPE_REUSE=1 skips the build; MY_SCOPE_KEEP=1 keeps them; MY_SCOPE_LEVELS=11,31 runs some Group levels. Each step fits the 10-minute foreground limit.
// Disposable local PostgreSQL only (the runner's loopback port). Synthetic people only. It never reads a Supabase URL or a credential.
// How it works:
//  1. ms2b_new = a clone of the template (every migration). Fixtures: the role matrix of supabase/tests/my-scope-2b.sql (2a's people plus
//     Groups, sessions, homework, exams, join requests), a demo fill (demo_fill_core), Part 1's platform from 2a (200 spaces through the
//     real provisioning, a space with 2,000 students in two runs; here also a run instructor and 300 pending join requests), and space X:
//     one owner, one assistant on every run, one course with one run, seven homework on one lesson, a student with a try.
//     ms2b_old = a clone, then supabase/tests/my-scope-2b-before.sql (the five policies and eight functions exactly as before).
//  2. apply: the migration on a clone of the old database (twice): counts unchanged, catalog equal to a full replay.
//  3. groups: the platform grows to 11, 31, 61, 111 and 211 Groups (the big space's 2,000 students in ten Groups, then empty Groups in other
//     spaces) on both databases; at each level the timings, the can_view_group call counts, and at every level group_view old vs new.
//  4. space: space X with 1 course, then with 200 more courses and 400 more runs (a homework and an open exam in each, the student in 25 of
//     them): timings of exam_portal, homework_portal, the student exam list, get_homework and the lesson list; all reads old vs new.
//  5. enrol: a student's count(*) on enrollments and enrollment_requests, the owner and the run instructor reading the 2,000-student run.
//  6. rows: every caller, the five tables, old vs new (count and md5 of every id). 7. explain: the plans of the new reads.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');
const { Client } = require(path.join(runtime, 'pg'));
const port = Number(fs.readFileSync('.local/step03a/pg-port.txt', 'utf8').trim());
const base = { host: '127.0.0.1', port, user: 'postgres' };
const OLD = 'ms2b_old', NEW = 'ms2b_new', APPLY = 'ms2b_apply';
const MIGRATION = 'supabase/migrations/20261128120000_my_scope_groups_work.sql';
const out = path.resolve('.local/my-scope-proof'); fs.mkdirSync(out, { recursive: true });
const only = process.env.MY_SCOPE_ONLY ? process.env.MY_SCOPE_ONLY.split(',') : null;
const result = { checks: [], differences: [], timings: [], counts: {} };
const log = (...a) => console.log(...a);
const check = (ok, label, detail) => { result.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };
async function connect(database) { const c = new Client({ ...base, database }); await c.connect(); return c; }
async function admin(sql) { const c = await connect('postgres'); try { return await c.query(sql); } finally { await c.end(); } }
// Grows the fixture: on the new database, then the old one is cloned again from it (and given the old rules), so their rows stay identical.
async function both(sql) {
  const c = await connect(NEW); try { await c.query(sql); await c.query('analyze'); } finally { await c.end(); }
  await admin(`drop database if exists ${OLD} with (force)`); await admin(`create database ${OLD} template ${NEW}`);
  const o = await connect(OLD); try { await o.query(fs.readFileSync('supabase/tests/my-scope-2b-before.sql', 'utf8')); await o.query('analyze'); } finally { await o.end(); }
}

// ---------------------------------------------------------------- fixtures
const suite = fs.readFileSync('supabase/tests/my-scope-2b.sql', 'utf8');
const roleFixture = suite.slice(suite.indexOf('-- fixture-begin'), suite.indexOf('-- fixture-2b-end'));
const proof2a = fs.readFileSync('scripts/my-scope-proof.cjs', 'utf8');
const literal = name => { const i = proof2a.indexOf('const ' + name + ' = `') + name.length + 10; return proof2a.slice(i, proof2a.indexOf('`;', i)); };
const demo = literal('demo'), part1 = literal('part1');
// What the growth steps write to BOTH databases uses one fixed time, so the two stay identical (now() differs between them).
const T0 = `'${new Date().toISOString()}'::timestamptz`;
const k = s => `md5('my-scope:key:${s}')::uuid`, u = s => `md5('my-scope:person:${s}')::uuid`;
const SPACE1 = `(select id from public.organizations where name='Space 1')`;
const RUNS1 = `(select array_agg(id order by title) from (select o.id,c.title from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id=${SPACE1} order by c.title limit 2) r)`;
const part1More = `
select pg_temp.person('p1runinstr');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(${SPACE1},pg_temp.u('p1runinstr'),'teacher','active',now());
insert into public.offering_staff(offering_id,user_id,role) values((${RUNS1})[1],pg_temp.u('p1runinstr'),'instructor');
insert into public.profiles(id,display_name) select pg_temp.u('p1req'||n),'Asks '||n from generate_series(1,300) n;
insert into public.enrollment_requests(offering_id,user_id,status) select (${RUNS1})[1],pg_temp.u('p1req'||n),'pending' from generate_series(1,300) n;
`;
// Space X: one owner, one assistant (on every run), course 0 with one run; seven homework on its first lesson; the student xs1 with a try.
const spaceX = `
select pg_temp.person('xo'); select pg_temp.person('xa'); select pg_temp.person('xs1');
insert into public.organizations(id,name,slug,status) values(pg_temp.k('X'),'Space X','my-scope-x','active');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.k('X'),pg_temp.u('xo'),'owner','active',now()),(pg_temp.k('X'),pg_temp.u('xa'),'assistant','active',now());
create or replace function private.ms2b_xcourses(lo int, hi int, runs int, p_now timestamptz) returns void language plpgsql set search_path='' as $$
declare n int; r int; run uuid; ids uuid[]; begin
 insert into private.demo_spaces(organization_id,marked_by) values(md5('my-scope:key:X')::uuid,md5('my-scope:person:padmin')::uuid) on conflict do nothing;
 for n in lo..hi loop
  insert into public.courses(id,organization_id,title,slug,status,created_by) values(md5('my-scope:key:X-c'||n)::uuid,md5('my-scope:key:X')::uuid,'X course '||n,'x-c-'||n,'published',md5('my-scope:person:xo')::uuid);
  insert into public.course_modules(id,course_id,title,position) values(md5('my-scope:key:X-c'||n||'-m')::uuid,md5('my-scope:key:X-c'||n)::uuid,'Chapter',0);
  insert into public.lessons(id,module_id,title,position,status) values(md5('my-scope:key:X-c'||n||'-l')::uuid,md5('my-scope:key:X-c'||n||'-m')::uuid,'Lesson',0,'published');
  insert into public.lesson_segments(id,lesson_id,title,position,status,video_url) values(md5('my-scope:key:X-c'||n||'-p')::uuid,md5('my-scope:key:X-c'||n||'-l')::uuid,'Part',0,'published','https://example.test/v.mp4');
  for r in 1..runs loop
   run:=md5('my-scope:key:X-c'||n||'-r'||r)::uuid;
   insert into public.course_offerings(id,course_id,name,status) values(run,md5('my-scope:key:X-c'||n)::uuid,'Run '||r||' of X course '||n,'active');
   insert into public.offering_staff(offering_id,user_id,role) values(run,md5('my-scope:person:xa')::uuid,'teaching_assistant');
   perform private.demo_homework_make(md5('my-scope:key:X')::uuid,md5('my-scope:person:xo')::uuid,md5('my-scope:key:X-c'||n)::uuid,run,md5('my-scope:key:X-c'||n||'-l')::uuid,'Homework of run '||r||' of course '||n,'published',p_now+interval '7 days',true,'fix_mistakes',2,'after_hand_in');
   ids:=private.demo_exam_make(md5('my-scope:key:X')::uuid,md5('my-scope:person:xo')::uuid,md5('my-scope:key:X-c'||n)::uuid,run,'Exam of run '||r||' of course '||n,30,'one_time',p_now::date,p_now-interval '1 day');
   update private.exams set timing='same_time',starting_from=null,opens_at=p_now-interval '1 hour',closes_at=p_now+interval '2 hours' where id=ids[1];
  end loop;
 end loop;
 delete from private.demo_seed_rows where organization_id=md5('my-scope:key:X')::uuid;
 delete from private.demo_spaces where organization_id=md5('my-scope:key:X')::uuid;
end $$;
select private.ms2b_xcourses(0,0,1,now());
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(${k('X-c0-r1')},pg_temp.u('xs1'),'active',now()-interval '10 days');
insert into public.profiles(id,display_name) select pg_temp.u('xs'||n),'X student '||n from generate_series(2,20) n;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select ${k('X-c0-r1')},pg_temp.u('xs'||n),'active',now()-interval '10 days' from generate_series(2,20) n;
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.k('X'),pg_temp.u('padmin'));
create temp table x_hw as select private.demo_homework_make(pg_temp.k('X'),pg_temp.u('xo'),${k('X-c0')},${k('X-c0-r1')},${k('X-c0-l')},'Lesson homework '||n,'published',now()+interval '7 days',true,'fix_mistakes',2,'after_hand_in') ids, n from generate_series(1,6) n;
select private.demo_homework_try(pg_temp.k('X'),pg_temp.u('xo'),(select ids from x_hw where n=1),pg_temp.u('xs1'),1,now()-interval '1 hour',false,'submitted',1,false);
select private.demo_homework_try(pg_temp.k('X'),pg_temp.u('xo'),(select ids from x_hw where n=2),pg_temp.u('xs1'),1,now()-interval '1 hour',false,'draft',2,false);
delete from private.demo_seed_rows where organization_id=pg_temp.k('X'); delete from private.demo_spaces where organization_id=pg_temp.k('X');
`;
const spaceX200 = `select private.ms2b_xcourses(1,200,2,${T0});
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select md5('my-scope:key:X-c'||n||'-r1')::uuid,${u('xs1')},'active',${T0}-interval '10 days' from generate_series(1,24) n;
-- The student's 24 extra exams are per-Group (as in Part 6a): a Group per run with the student in it, a session, and the Group's window open now.
insert into public.study_groups(id,offering_id,name,mode,created_by) select md5('my-scope-2b:xg:'||n)::uuid,md5('my-scope:key:X-c'||n||'-r1')::uuid,'X group '||n,'online',${u('xo')} from generate_series(1,24) n;
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select md5('my-scope-2b:xg:'||n)::uuid,e.offering_id,e.user_id,e.id,${T0}-interval '9 days',${u('xo')} from generate_series(1,24) n
 join public.enrollments e on e.offering_id=md5('my-scope:key:X-c'||n||'-r1')::uuid and e.user_id=${u('xs1')};
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by)
 select md5('my-scope-2b:xg:'||n)::uuid,'Lesson',${T0}+interval '2 days',${T0}+interval '2 days 1 hour',${T0}+interval '2 days',${T0}+interval '2 days 1 hour','online',${u('xo')},${u('xo')} from generate_series(1,24) n;
update private.exams e set timing='per_group',opens_at=null,closes_at=null,starting_from=current_date from generate_series(1,24) n where e.offering_id=md5('my-scope:key:X-c'||n||'-r1')::uuid;
insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by)
 select e.id,md5('my-scope-2b:xg:'||n)::uuid,'custom',${T0}-interval '1 hour',${T0}+interval '3 hours',${u('xo')} from generate_series(1,24) n join private.exams e on e.offering_id=md5('my-scope:key:X-c'||n||'-r1')::uuid;`;
// Groups: first the big space's ten (its 2,000 students of each run in five Groups of 400; the assistant p1staff15 in two of them), then empty
// Groups in the runs of other spaces, up to the level.
function growGroups(level) {
  return `do $$ declare have int:=(select count(*) from public.study_groups); runs uuid[]:=${RUNS1}; owner uuid:=(select user_id from public.organization_memberships where organization_id=${SPACE1} and role='owner' limit 1); r int; g int; begin
 if have>=${level} then return; end if;
 if not exists(select 1 from public.study_groups where id=md5('my-scope-2b:big:1:1')::uuid) then
  for r in 1..2 loop for g in 1..5 loop
   insert into public.study_groups(id,offering_id,name,mode,created_by,created_at,updated_at) values(md5('my-scope-2b:big:'||r||':'||g)::uuid,runs[r],'Big group '||r||'.'||g,'online',owner,${T0},${T0});
  end loop; end loop;
  insert into public.group_memberships(id,group_id,offering_id,user_id,enrollment_id,starts_at,created_by,created_at)
   select md5('my-scope-2b:member:'||e.id)::uuid,md5('my-scope-2b:big:'||r.n||':'||(1+(row_number() over(partition by e.offering_id order by e.user_id)-1)%5))::uuid,e.offering_id,e.user_id,e.id,${T0}-interval '5 days',owner,${T0}
   from public.enrollments e join unnest(runs) with ordinality r(id,n) on r.id=e.offering_id;
  insert into public.group_staff(group_id,user_id,created_at) values(md5('my-scope-2b:big:1:1')::uuid,${u('p1staff15')},${T0}),(md5('my-scope-2b:big:2:1')::uuid,${u('p1staff15')},${T0});
  insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by,created_at,updated_at)
   select md5('my-scope-2b:session:'||g.id)::uuid,g.id,'Next lesson',${T0}+interval '1 day',${T0}+interval '1 day 1 hour',${T0}+interval '1 day',${T0}+interval '1 day 1 hour','online',owner,owner,${T0},${T0} from public.study_groups g where g.offering_id=any(runs);
  have:=have+10;
 end if;
 insert into public.study_groups(id,offering_id,name,mode,created_by,created_at,updated_at)
  select md5('my-scope-2b:filler:'||x.n)::uuid,x.id,'Group '||x.n,'online',coalesce(x.created_by,owner),${T0},${T0} from (
   select o.id,c.created_by,row_number() over(order by o.id) n from public.course_offerings o join public.courses c on c.id=o.course_id
   join public.organizations s on s.id=c.organization_id where s.name like 'Space %' and s.name<>'Space 1' and s.name<>'Space X') x
  where not exists(select 1 from public.study_groups where id=md5('my-scope-2b:filler:'||x.n)::uuid) order by x.n limit ${level}-have;
end $$;`;
}

async function build() {
  const tmpl = (await admin("select datname from pg_database where datname like 'edulabs_tmpl_%' order by oid desc limit 1")).rows[0]?.datname;
  if (!tmpl) throw new Error('No template: run node scripts/exam-sql-local.cjs --postgres first');
  for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`);
  await admin(`create database ${NEW} template ${tmpl}`);
  const c = await connect(NEW);
  try {
    assert.ok((await c.query("select to_regprocedure('private.caller_visible_groups()') is not null ok")).rows[0].ok, 'the template has the migration');
    const t0 = Date.now();
    for (const sql of [roleFixture, demo, part1, part1More, spaceX]) await c.query(sql);
    await c.query('analyze');
    result.fixture = (await c.query(`select (select count(*) from public.organizations) spaces,(select count(*) from public.courses) courses,(select count(*) from public.course_offerings) runs,
      (select count(*) from public.profiles) profiles,(select count(*) from public.enrollments) enrollments,(select count(*) from public.enrollment_requests) requests,
      (select count(*) from public.study_groups) groups,(select count(*) from public.homework_assignments) homework,(select count(*) from private.exams) exams`)).rows[0];
    result.fixture.seconds = Math.round((Date.now() - t0) / 1000);
    log('Fixture', JSON.stringify(result.fixture));
  } finally { await c.end(); }
  await admin(`create database ${OLD} template ${NEW}`);
  const o = await connect(OLD); try { await o.query(fs.readFileSync('supabase/tests/my-scope-2b-before.sql', 'utf8')); await o.query('analyze'); } finally { await o.end(); }
}

async function applyCheck() {
  await admin(`drop database if exists ${APPLY} with (force)`);
  await admin(`create database ${APPLY} template ${OLD}`);
  const c = await connect(APPLY), n = await connect(NEW);
  const countsSql = `select string_agg(format('%s.%s=%s',n.nspname,c.relname,(xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text),',' order by n.nspname,c.relname) v
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind='r'`;
  const catalogSql = `select md5(coalesce((select string_agg(schemaname||tablename||policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,''),'|' order by schemaname,tablename,policyname) from pg_policies),'')) policies,
    md5((select string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','private') and p.prokind='f')) functions`;
  try {
    const before = (await c.query(countsSql)).rows[0].v, migration = fs.readFileSync(MIGRATION, 'utf8');
    await c.query(migration);
    check((await c.query(countsSql)).rows[0].v === before, 'the migration applies on a database with the demo fill and the large fixtures; every table keeps its row count', { tables: before.split(',').length });
    await c.query(migration);
    check((await c.query(countsSql)).rows[0].v === before, 'it applies a second time without error, counts unchanged');
    const a = (await c.query(catalogSql)).rows[0], b = (await n.query(catalogSql)).rows[0];
    check(a.policies === b.policies && a.functions === b.functions, 'the result has exactly the policies and functions of a full replay');
  } finally { await c.end(); await n.end(); }
  await admin(`drop database ${APPLY} with (force)`);
}

// ---------------------------------------------------------------- callers and calls
const fixtureCallers = ['owner', 'admin', 'teacher', 'asst_run', 'asst_norun', 'cs_owner', 'cs_instructor', 'cs_editor', 'cs_assistant', 'ta_nomember', 'run_instr',
  'st_active', 'st_suspended', 'st_cancelled', 'st_expired', 'st_future', 'st_invited', 'st_completed', 'st_archived_run', 'st_draft_course', 'st_other', 'st_two',
  'st_both', 'st_moved', 'st_grpfuture', 'nospace', 'padmin', 'prof_suspended', 'mem_suspended', 'mem_invited', 's2_teacher', 's2_student', 'staff_student', 'revoked',
  'unmapped', 'none', 'seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6', 'seed7', 'demo_owner', 'demo_admin',
  'p1student', 'p1t1', 'p1t2', 'p1staff1', 'p1staff15', 'p1runinstr', 'xo', 'xa', 'xs1'];
function claims(label) {
  if (label === 'none') return '';
  if (label.startsWith('seed')) return JSON.stringify({ iss: 'https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated', sub: '10000000-0000-0000-0000-00000000000' + label.slice(4) });
  return JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, sub: 'my-scope-' + label, auth_time: Math.floor(Date.now() / 1000) });
}
// What a call wrote (results by exam and student: a result the call creates has a random id).
const WRITTEN = `select md5(concat_ws('|',
  (select string_agg(id||status||coalesce(auto_submitted::text,'')||(submitted_at is null),',' order by id) from private.exam_attempts),
  (select string_agg(exam_id||':'||user_id||status||coalesce(score::text,'')||(released_at is null)||revision,',' order by exam_id,user_id) from private.exam_results),
  (select string_agg(exam_id||':'||group_id||source||coalesce(session_id::text,''),',' order by exam_id,group_id) from private.exam_group_windows),
  (select string_agg(action||n,',' order by action) from (select action,count(*) n from private.exam_audit group by action) a),
  (select count(*) from public.notifications),(select count(*) from private.notification_events),
  (select md5(string_agg(id||':'||group_id||starts_at||cancelled,',' order by id)) from public.group_sessions),
  (select count(*) from public.session_attendance),(select count(*) from private.group_audit))) w`;
const strip = (v, extra = []) => Array.isArray(v) ? v.map(x => strip(x, extra)) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([key]) => !['serverNow', 'secondsLeft', ...extra].includes(key)).map(([key, x]) => [key, strip(x, extra)])) : v;
// One call as the caller, in a transaction that is always rolled back: the answer (or SQLSTATE) and what it wrote.
async function call(db, label, sql, params = [], opts = {}) {
  await db.query('begin');
  try {
    await db.query(`set local role ${label === 'anon' ? 'anon' : 'authenticated'}`);
    await db.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]);
    await db.query(`set local statement_timeout='${opts.noLimit ? 0 : '8s'}'`);
    let v; try { v = (await db.query(sql, params)).rows[0]?.v; } catch (e) { await db.query('rollback'); return { error: e.code }; }
    await db.query('reset role');
    const w = opts.written === false ? null : (await db.query(WRITTEN)).rows[0].w;
    return { v: strip(v, opts.extra), w };
  } finally { await db.query('rollback').catch(() => {}); }
}
function firstDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[key], b[key], at + '.' + key); if (d) return d; }
  return { at, old: JSON.stringify(a)?.slice(0, 200), new: JSON.stringify(b)?.slice(0, 200) };
}
async function compareReads(tag, callers, reads) {
  const o = await connect(OLD), n = await connect(NEW); let pairs = 0, answered = 0; const diffs = [], kinds = {};
  try {
    for (const label of callers) for (const r of reads) {
      const a = await call(o, label, r.sql, r.params, r.opts), b = await call(n, label, r.sql, r.params, r.opts);
      pairs++; if (!a.error) answered++; kinds[r.kind] = (kinds[r.kind] || 0) + 1;
      const d = firstDiff(a, b); if (d) diffs.push({ caller: label, read: r.kind, item: r.item, ...d });
    }
  } finally { await o.end(); await n.end(); }
  result.differences.push(...diffs.map(d => ({ tag, ...d })));
  result.counts[tag] = { pairs, answered, kinds };
  if (diffs.length) log('differing fields', JSON.stringify([...new Set(diffs.map(d => d.read + ' ' + d.at.replace(/\.\d+\./g, '.n.')))]));
  check(diffs.length === 0, `${tag}: ${pairs} reads (${answered} answered, the rest refused for both), old vs new as JSON with the rows written`, { differences: diffs.length, first: diffs[0] });
}
const gv = (g, s, extra) => ({ kind: 'group_view ' + (g ? 'group ' : '') + s, item: g, sql: 'select to_jsonb(private.group_view($1,$2,0,$3)) v', params: [g, s, ''], opts: extra ? { extra } : {} });

// ---------------------------------------------------------------- timings: a fresh connection per call, the helper call counts
async function timed(version, label, caller, sql, params = []) {
  const db = await connect(version === 'old' ? OLD : NEW);
  try {
    await db.query('begin'); await db.query("set local track_functions='all'"); await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,true)", [claims(caller)]); await db.query("set local statement_timeout='8s'");
    const t = process.hrtime.bigint(); let error = null;
    try { await db.query(sql, params); } catch (e) { error = e.code; }
    const ms = Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;
    if (error) { await db.query('rollback'); await db.query('begin'); }
    await db.query('reset role');
    const calls = Object.fromEntries((await db.query("select funcname,calls from pg_stat_xact_user_functions where funcname in ('current_app_user_id','can_view_group','can_manage_group','has_org_role','can_support_offering','can_edit_course','homework_staff','exam_settle')")).rows.map(r => [r.funcname, Number(r.calls)]));
    await db.query('rollback');
    const row = { version, label, ms, calls, ...(error ? { error } : {}) };
    result.timings.push(row); log('TIME', version.padEnd(3), label.padEnd(58), String(ms).padStart(8), 'ms', JSON.stringify(calls), error || '');
    return row;
  } finally { await db.end(); }
}
async function timedPair(label, caller, sql, params) { await timed('old', label, caller, sql, params); await timed('new', label, caller, sql, params); }

// ---------------------------------------------------------------- steps
const gid = s => `md5('${s}')::uuid`;
async function groupsStep() {
  for (const level of (process.env.MY_SCOPE_LEVELS || '11,31,61,111,211').split(',').map(Number)) {
    await both(growGroups(level));
    const db = await connect(NEW); const have = Number((await db.query('select count(*) n from public.study_groups')).rows[0].n); await db.end();
    log(`--- ${have} Groups on the platform`); result.counts['groups ' + level] = have;
    for (const [who, caller, s] of [['student Home upcoming (st_active, one Group)', 'st_active', 'upcoming'], ['student Groups list (st_active)', 'st_active', 'list'],
      ['student Home upcoming (p1student, big space)', 'p1student', 'upcoming'], ['owner Groups list (owner of space R)', 'owner', 'list'],
      ['owner Groups list (p1t1, big space)', 'p1t1', 'list'], ['assistant Groups list (p1staff15, two Groups)', 'p1staff15', 'list'], ['assistant Home upcoming (asst_run)', 'asst_run', 'upcoming']])
      await timedPair(`${have} Groups: ${who}`, caller, 'select private.group_view(null,$1,0,$2)', [s, '']);
    const big = (await (async () => { const c = await connect(NEW); try { return (await c.query(`select array_agg(o.id) a from public.course_offerings o where o.id=any((${RUNS1})::uuid[])`)).rows[0].a; } finally { await c.end(); } })());
    const reads = [...['summary', 'upcoming', 'list', 'offerings', 'history'].map(s => gv(null, s)),       ...big.concat([await keyOf('C1a')]).map(r => gv(null, 'offering:' + r)),
      ...[await keyOf('G1'), await keyOf('G2'), have > 11 ? await one(`select ${gid('my-scope-2b:big:1:1')} v`) : null].filter(Boolean).flatMap(g => ['summary', 'detail', 'sessions', 'members', 'history'].map(s => gv(g, s)))];
    const callers = level === 211 || level === 61 || level === 111 ? fixtureCallers : ['st_active', 'owner', 'asst_run', 'p1student', 'p1t1', 'p1staff15', 'st_both', 'none'];
    await compareReads(`group_view at ${have} Groups`, callers, reads);
  }
}
async function one(sql) { const c = await connect(NEW); try { return (await c.query(sql)).rows[0].v; } finally { await c.end(); } }
const keyOf = s => one(`select ${k(s)}::text v`);
async function spaceStep() {
  const hw = await one(`select (array_agg(id order by title))[1]::text v from public.homework_assignments where title='Lesson homework 1'`);
  const lessonList = { sql: `select coalesce(jsonb_agg(to_jsonb(x)),'[]') v from (select id,title,status,mode,offering_id,segment_id,version from public.homework_assignments where course_id=$1 and lesson_id=$2 and offering_id=$3 order by created_at,id limit 25) x`,
    params: [await keyOf('X-c0'), await keyOf('X-c0-l'), await keyOf('X-c0-r1')] };
  const timeAll = async tag => {
    for (const [who, caller] of [['owner', 'xo'], ['assistant', 'xa']]) {
      await timedPair(`${tag}: exam_portal open, ${who}`, caller, `select private.exam_portal(null,'open',0)`);
      await timedPair(`${tag}: homework_portal open, ${who}`, caller, `select private.homework_portal(null,'open',0)`);
    }
    await timedPair(`${tag}: student exam list (xs1)`, 'xs1', 'select private.exam_student_list()');
    await timedPair(`${tag}: get_homework, student (xs1, a handed-in try)`, 'xs1', 'select private.get_homework($1,null)', [hw]);
    await timedPair(`${tag}: lesson homework list (7 homework), student (xs1)`, 'xs1', lessonList.sql, lessonList.params);
    await timedPair(`${tag}: lesson homework list (7 homework), owner (xo)`, 'xo', lessonList.sql, lessonList.params);
    await timedPair(`${tag}: homework_students, assistant (xa)`, 'xa', 'select private.homework_students($1,0)', [hw]);
  };
  const reads = async () => {
    const hws = (await (async () => { const c = await connect(NEW); try { return (await c.query(`select id::text from public.homework_assignments order by id limit 40`)).rows.map(r => r.id); } finally { await c.end(); } })());
    const courses = [null, await keyOf('X-c0'), await keyOf('C1'), await keyOf('X-c7')];
    return [
      ...courses.flatMap(c => ['open', 'closed', 'drafts'].map(t => ({ kind: 'homework_portal ' + t, item: c, sql: 'select to_jsonb(private.homework_portal($1,$2,0)) v', params: [c, t] }))),
      ...courses.flatMap(c => ['open', 'closed', 'drafts', 'archived'].map(t => ({ kind: 'exam_portal ' + t, item: c, sql: 'select to_jsonb(private.exam_portal($1,$2,0)) v', params: [c, t] }))),
      { kind: 'exam_student_list', sql: 'select to_jsonb(private.exam_student_list()) v' },
      ...hws.map(h => ({ kind: 'get_homework', item: h, sql: 'select to_jsonb(private.get_homework($1,null)) v', params: [h] })),
      ...hws.slice(0, 12).map(h => ({ kind: 'homework_students', item: h, sql: 'select to_jsonb(private.homework_students($1,0)) v', params: [h] })),
      { kind: 'lesson homework list', ...lessonList, opts: { written: false } }];
  };
  log('--- space X with 1 course'); await timeAll('1 course');
  await compareReads('portals and homework, space X with 1 course', fixtureCallers, await reads());
  await both(spaceX200);
  log('--- space X with 201 courses and 401 runs'); await timeAll('201 courses');
  await compareReads('portals and homework, space X with 201 courses', fixtureCallers, await reads());
}
async function enrolStep() {
  const run = await one(`select (${RUNS1})[1]::text v`);
  for (const [label, caller, sql, params] of [
    ['student count(*) on enrollments (p1student)', 'p1student', 'select count(*) from public.enrollments'],
    ['student count(*) on enrollment_requests (p1student)', 'p1student', 'select count(*) from public.enrollment_requests'],
    ['signed-in person with no space: count(*) on enrollments', 'nospace', 'select count(*) from public.enrollments'],
    ['owner reads the 2,000-student run (p1t1)', 'p1t1', 'select id,user_id,status from public.enrollments where offering_id=$1 limit 1000', [run]],
    ['run instructor reads the 2,000-student run (p1runinstr)', 'p1runinstr', 'select id,user_id,status from public.enrollments where offering_id=$1 limit 1000', [run]],
    ['owner reads the 300 pending join requests (p1t1)', 'p1t1', `select id from public.enrollment_requests where offering_id=$1 and status='pending'`, [run]],
    ['student reads course_offerings (p1student)', 'p1student', 'select id from public.course_offerings'],
    ['owner reads offering_staff (p1t1)', 'p1t1', 'select offering_id,user_id from public.offering_staff']]) await timedPair(label, caller, sql, params);
}
const TABLES = { enrollments: 'id::text', enrollment_requests: 'id::text', course_offerings: 'id::text', offering_staff: "offering_id||'/'||user_id", homework_assignments: 'id::text' };
async function rowsStep() {
  // No statement limit here: this compares rows, and the old rule takes longer than 8 s for some callers. MY_SCOPE_PART=k/n takes a slice of the callers.
  const [part, parts] = (process.env.MY_SCOPE_PART || '1/1').split('/').map(Number);
  const callers = fixtureCallers.filter((_, i) => i % parts === part - 1);
  const o = await connect(OLD), n = await connect(NEW); let pairs = 0, rows = 0, nonEmpty = 0; const diffs = [];
  try {
    for (const label of callers) for (const [t, idx] of Object.entries(TABLES)) {
      const sql = `select jsonb_build_object('n',count(*),'h',md5(coalesce(string_agg(${idx},',' order by ${idx}),''))) v from public.${t}`;
      const a = await call(o, label, sql, [], { written: false, noLimit: true }), b = await call(n, label, sql, [], { written: false, noLimit: true });
      pairs++; rows += a.v?.n ?? 0; if (a.v?.n) nonEmpty++;
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ caller: label, table: t, old: a, new: b });
    }
  } finally { await o.end(); await n.end(); }
  result.differences.push(...diffs);
  check(diffs.length === 0, `row sets (callers ${part}/${parts}): ${pairs} caller x table pairs, old policies vs new, every row (${rows} rows in ${nonEmpty} non-empty pairs)`, { differences: diffs.length, first: diffs[0] });
}
async function explainStep() {
  const db = await connect(NEW); const plans = {};
  try {
    for (const [name, caller, sql] of [['enrollments count, student', 'p1student', 'select count(*) from public.enrollments'],
      ['enrollment_requests count, student', 'p1student', 'select count(*) from public.enrollment_requests'],
      ['course_offerings, owner of 401 runs', 'xo', 'select count(*) from public.course_offerings'],
      ['offering_staff, assistant', 'xa', 'select count(*) from public.offering_staff'],
      ['lesson homework list, student', 'xs1', `select id from public.homework_assignments where course_id=${k('X-c0')} and lesson_id=${k('X-c0-l')}`],
      ['the visible Groups of the big-space owner', 'p1t1', 'select count(*) from public.study_groups where id in (select private.caller_visible_groups())']]) {
      // study_groups is closed to direct reads (Track 1): that one runs as the table owner, under the caller's token.
      await db.query('begin'); if (!name.startsWith('the visible Groups')) await db.query('set local role authenticated'); await db.query("select set_config('request.jwt.claims',$1,true)", [claims(caller)]);
      plans[name] = (await db.query('explain (analyze, buffers, costs off) ' + sql)).rows.map(r => r['QUERY PLAN']).join('\n'); await db.query('rollback');
    }
  } finally { await db.end(); }
  fs.writeFileSync(path.join(out, 'explain-2b.txt'), Object.entries(plans).map(([k2, v]) => '== ' + k2 + '\n' + v).join('\n\n'));
  check(Object.entries(plans).every(([name, p]) => /hashed SubPlan|Hash Semi Join/.test(p) && /ProjectSet \(actual[^\n]*loops=1\)/.test(p) && !/ProjectSet \(actual[^\n]*loops=(?!1\))/.test(p) && !/can_support_offering|is_enrolled|homework_visible|can_view_group/.test(p)),
    'EXPLAIN: each new read evaluates its set once (hashed SubPlan or hash semi join, the set function loops=1), no per-row helper', { file: '.local/my-scope-proof/explain-2b.txt' });
}

(async () => {
  const steps = only || ['build', 'apply', 'groups', 'space', 'enrol', 'rows', 'explain'];
  const t0 = Date.now();
  try {
    if (steps.includes('build') && !process.env.MY_SCOPE_REUSE) await build();
    for (const [name, fn] of [['apply', applyCheck], ['groups', groupsStep], ['space', spaceStep], ['enrol', enrolStep], ['rows', rowsStep], ['explain', explainStep]])
      if (steps.includes(name)) { log('--- ' + name); const t = Date.now(); await fn(); log(`--- ${name} done in ${Math.round((Date.now() - t) / 1000)} s`); }
  } finally {
    if (!process.env.MY_SCOPE_KEEP) for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`).catch(() => {});
    const file = path.join(out, `result-2b-${steps.join('+')}${process.env.MY_SCOPE_LEVELS && steps.includes('groups') ? '-' + process.env.MY_SCOPE_LEVELS.replaceAll(',', '-') : ''}${process.env.MY_SCOPE_PART && steps.includes('rows') ? '-' + process.env.MY_SCOPE_PART.replace('/', 'of') : ''}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 1));
    const passed = result.checks.filter(c => c.ok).length;
    log(`${passed}/${result.checks.length} checks passed, ${result.differences.length} differences, ${Math.round((Date.now() - t0) / 1000)} s. Result: ${file}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
