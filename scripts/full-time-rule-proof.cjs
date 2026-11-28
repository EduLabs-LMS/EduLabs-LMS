#!/usr/bin/env node
// Fix track 3 (the full-time rule and Protect answers) proof: the OLD functions (supabase/tests/full-time-rule-before.sql) against the NEW
// (migration 20261128140000_full_time_rule.sql) on identical rows, with the hosted limits (statement and lock timeout 8 s, UTC).
//   node scripts/exam-sql-local.cjs --postgres      (once: builds the migrated template)
//   node scripts/full-time-rule-proof.cjs            (every step; or FTR_ONLY=build,apply,equiv,a6a10,a6a01,time)
// FTR_KEEP=1 keeps the databases. Disposable local PostgreSQL only (the runner's loopback port). Synthetic people only; it never reads a
// Supabase URL or a credential.
//  build  ftr_new = the template + supabase/tests/reports-scope.sql's fixture (a demo fill) and school A (1 run, 3 Groups x 30, 40 homework, 8
//         exams), every person given a synthetic Firebase identity; ftr_old = a copy + full-time-rule-before.sql.
//  apply  the migration on a copy of ftr_old gives exactly ftr_new's functions, views, columns and grants.
//  equiv  every student: exam_student_list, exam_get of every exam of their runs and of each of their tries, get_homework of every published
//         homework and of each of their submissions, homework_submission_json of each submission; and the raw rows of report_exams and
//         report_homework for every run. Each read in its own rolled-back transaction, so no read changes what the next one sees. Compared as
//         JSON without serverNow and the new protectAnswers key.
//  a6a10  Part 6a's scenario: 400 students, 392 tries still open at the close (deadline = close), 8 handed in, auto-release on. The first
//         reader alone (a teacher queue read), then 20 students reading at the same moment, each on a fresh copy, OLD and NEW.
//  a6a01  Part 6a's evidence: s8 on the fix-mistakes try 2 past the close (two others still writing), auto-release on: OLD reveals, NEW hides.
//  time   one student exam read and one homework read, median of 15 on fresh connections, OLD and NEW.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');
const { Client } = require(path.join(runtime, 'pg'));
const port = Number(fs.readFileSync('.local/step03a/pg-port.txt', 'utf8').trim());
const base = { host: '127.0.0.1', port, user: 'postgres' };
const OLD = 'ftr_old', NEW = 'ftr_new', APPLY = 'ftr_apply';
const MIGRATION = 'supabase/migrations/20261128140000_full_time_rule.sql', BEFORE = 'supabase/tests/full-time-rule-before.sql';
const out = path.resolve('.local/full-time-proof'); fs.mkdirSync(out, { recursive: true });
const only = process.env.FTR_ONLY ? process.env.FTR_ONLY.split(',') : null;
const result = { checks: [], differences: [], counts: {}, a6a10: {}, a6a01: {}, timings: {} };
const log = (...a) => console.log(...a);
const check = (ok, label, detail) => { result.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };
async function connect(database) { const c = new Client({ ...base, database }); await c.connect(); await c.query("set timezone='UTC'"); return c; }
async function admin(sql) { const c = await connect('postgres'); try { return await c.query(sql); } finally { await c.end(); } }
const copy = async (to, from) => { await admin(`drop database if exists ${to} with (force)`); await admin(`create database ${to} template ${from}`); };
const claims = sub => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, sub, auth_time: Math.floor(Date.now() / 1000) });
// One read as a person: its own transaction, the hosted limits, rolled back (equiv) or committed (scenarios).
async function as(db, sub, sql, args = [], commit = false) {
  await db.query('begin'); await db.query("set local statement_timeout='8s'"); await db.query("set local lock_timeout='8s'"); await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,true)", [claims(sub)]);
  try { const r = await db.query(sql, args); await db.query(commit ? 'commit' : 'rollback'); return r.rows; } catch (e) { await db.query('rollback'); return [{ error: { code: e.code, message: e.message, detail: e.detail } }]; }
}
// A fixture exam whose auto-release is due but not stored yet is released by the read itself (in both versions), at that read's clock: such a
// releasedAt (later than the start of the comparison) is compared as "released by this read", not as the millisecond.
let since = Infinity;
const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => k !== 'serverNow' && k !== 'protectAnswers')
  .map(k => [k, k === 'releasedAt' && typeof v[k] === 'string' && Date.parse(v[k]) >= since ? 'released by this read' : strip(v[k])])) : v;

// Where two JSON values differ: [path, old, new] for each leaf.
function paths(x, y, at = '', acc = []) {
  if (JSON.stringify(x) === JSON.stringify(y)) return acc;
  if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) paths(x[k], y[k], at + '.' + k, acc); return acc; }
  acc.push([at, x === undefined ? '(none)' : x, y === undefined ? '(none)' : y]); return acc;
}
// ---------------------------------------------------------------- build
const suite = fs.readFileSync('supabase/tests/reports-scope.sql', 'utf8');
const section = (a, b) => suite.slice(suite.indexOf(a), suite.indexOf(b));
async function build() {
  const tmpl = (await admin("select datname from pg_database where datname like 'edulabs_tmpl_%' order by oid desc limit 1")).rows[0]?.datname;
  if (!tmpl) throw new Error('No template: run node scripts/exam-sql-local.cjs --postgres first');
  for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`);
  await admin(`create database ${NEW} template ${tmpl}`);
  const c = await connect(NEW);
  try {
    assert.ok((await c.query("select to_regprocedure('private.exam_over_at(uuid)') is not null ok")).rows[0].ok, 'the template has the migration');
    await c.query(section('-- fixture-begin', '-- fixture-end')); await c.query(section('-- school-begin', '-- school-end'));
    await c.query("select pg_temp.school('A',1,3,30,72,40,8,252)");
    await c.query(`insert into private.external_identities(profile_id,provider,issuer,subject,verified_at)
      select p.id,'firebase','https://securetoken.google.com/diagonproduction','ftr-proof-'||p.id,now() from public.profiles p where not exists(select 1 from private.external_identities x where x.profile_id=p.id)`);
    await c.query('analyze');
    result.fixture = (await c.query(`select (select count(*) from private.exams) exams,(select count(*) from private.exam_attempts) tries,(select count(*) from private.exam_results) results,
      (select count(*) from public.homework_assignments) homework,(select count(*) from public.homework_submissions) submissions,(select count(*) from public.enrollments where status='active') enrollments`)).rows[0];
    log('Fixture', JSON.stringify(result.fixture));
  } finally { await c.end(); }
  await admin(`create database ${OLD} template ${NEW}`);
  const o = await connect(OLD); try { await o.query(fs.readFileSync(BEFORE, 'utf8')); await o.query('analyze'); } finally { await o.end(); }
  check(true, 'built ftr_new (migrated) and ftr_old (the before file)');
}

// ---------------------------------------------------------------- apply
const catalogSql = `select string_agg(x,E'\\n' order by x) v from (
  select 'f '||p.oid::regprocedure::text||' '||md5(pg_get_functiondef(p.oid))||' '||coalesce(p.proacl::text,'') x from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'
  union all select 'v '||c.oid::regclass::text||' '||md5(pg_get_viewdef(c.oid))||' '||coalesce(c.relacl::text,'')||' '||coalesce(c.reloptions::text,'{}') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='v'
  union all select 'c '||a.attrelid::regclass::text||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)||' '||a.attnotnull||' '||coalesce(pg_get_expr(d.adbin,d.adrelid),'') from pg_attribute a
   join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ('public','private') and c.relkind='r' and a.attnum>0 and not a.attisdropped
  union all select 'p '||polrelid::regclass::text||' '||polname||' '||md5(coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')) from pg_policy) q`;
async function applyCheck() {
  await copy(APPLY, OLD);
  const a = await connect(APPLY), n = await connect(NEW), o = await connect(OLD);
  try {
    const before = (await o.query(catalogSql)).rows[0].v;
    await a.query(fs.readFileSync(MIGRATION, 'utf8'));
    const got = (await a.query(catalogSql)).rows[0].v, want = (await n.query(catalogSql)).rows[0].v;
    const diff = got.split('\n').filter(l => !want.includes(l)).concat(want.split('\n').filter(l => !got.includes(l)));
    check(got === want, 'the migration on the old database gives exactly the new functions, views, columns, defaults, grants and policies', diff.length ? diff.slice(0, 10) : undefined);
    const changed = want.split('\n').filter(l => !before.split('\n').includes(l)).map(l => l.split(' ').slice(0, 2).join(' '));
    result.counts.catalogChanged = changed; log('Changed or added by the migration:', changed.length);
    check(changed.every(l => /^(f|v|c) /.test(l)) && !changed.some(l => l.startsWith('p ')), 'no policy is changed');
    // A view the migration replaces keeps every option it had before (create or replace view without WITH drops security_invoker).
    const opts = async db => Object.fromEntries((await db.query("select c.oid::regclass::text v,coalesce(c.reloptions,'{}') o from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='v'")).rows.map(r => [r.v, r.o]));
    const was = await opts(o), now = await opts(n);
    const lost = Object.entries(was).filter(([v, os]) => v in now && os.some(x => !now[v].includes(x))).map(([v, os]) => ({ view: v, before: os, after: now[v] }));
    check(lost.length === 0, 'no view loses an option it had before the migration (security_invoker)', lost.length ? lost : undefined);
    check(Object.entries(now).filter(([v]) => v.startsWith('private.')).every(([, os]) => os.includes('security_invoker=true')), 'every private view has security_invoker=true');
  } finally { await a.end(); await n.end(); await o.end(); }
  if (!process.env.FTR_KEEP) await admin(`drop database if exists ${APPLY} with (force)`);
}

// ---------------------------------------------------------------- equiv
async function equiv() {
  const o = await connect(OLD), n = await connect(NEW);
  let compared = 0; const byKind = {}; since = Date.now() - 1000;
  result.counts.releasedByTheRead = 'a releasedAt later than the start of the comparison is compared as "released by this read"';
  const same = async (kind, sub, sql, args) => {
    const [x, y] = [await as(o, sub, sql, args), await as(n, sub, sql, args)];
    compared++; byKind[kind] = (byKind[kind] || 0) + 1;
    const a = JSON.stringify(strip(x)), b = JSON.stringify(strip(y));
    if (a !== b) result.differences.push({ kind, sub, args, paths: paths(strip(x), strip(y)) });
  };
  try {
    const students = (await n.query(`select distinct x.subject sub,e.user_id from public.enrollments e join private.external_identities x on x.profile_id=e.user_id where e.status='active' order by 1`)).rows;
    for (const s of students) {
      await same('exam_student_list', s.sub, 'select public.exam_student_list() v');
      const exams = (await n.query(`select e.id from private.exams e join public.enrollments r on r.offering_id=e.offering_id and r.user_id=$1 and r.status='active' where e.status<>'draft' order by e.id`, [s.user_id])).rows;
      for (const e of exams) {
        await same('exam_get', s.sub, 'select public.exam_get($1) v', [e.id]);
        for (const t of (await n.query('select id from private.exam_attempts where exam_id=$1 and user_id=$2 order by number', [e.id, s.user_id])).rows) await same('exam_get try', s.sub, 'select public.exam_get($1,$2) v', [e.id, t.id]);
      }
      const hws = (await n.query(`select a.id from public.homework_assignments a join public.enrollments r on r.offering_id=a.offering_id and r.user_id=$1 and r.status='active' where a.status='published' order by a.id`, [s.user_id])).rows;
      for (const h of hws) {
        await same('get_homework', s.sub, 'select public.get_homework($1) v', [h.id]);
        for (const sb of (await n.query('select id from public.homework_submissions where assignment_id=$1 and user_id=$2 order by number', [h.id, s.user_id])).rows) {
          await same('get_homework submission', s.sub, 'select public.get_homework($1,$2) v', [h.id, sb.id]);
          await same('homework_submission_json', s.sub, 'select private.homework_submission_json($1) v', [sb.id]);
        }
      }
    }
    // The report rows: every run, every time, as the definer reads them.
    for (const r of (await n.query('select array_agg(id order by id) ids from public.course_offerings')).rows) {
      for (const f of ['report_exams', 'report_homework']) {
        const sql = `select coalesce(jsonb_agg(to_jsonb(x) order by x.kind,x.offering_id,x.group_id,x.user_id,x.item_id),'[]') v from private.${f}($1,'-infinity','infinity',null,null,false) x`;
        const [x, y] = [(await o.query(sql, [r.ids])).rows, (await n.query(sql, [r.ids])).rows]; compared++; byKind[f] = (byKind[f] || 0) + 1;
        if (JSON.stringify(x) !== JSON.stringify(y)) result.differences.push({ kind: f, old: JSON.stringify(x).slice(0, 600), new: JSON.stringify(y).slice(0, 600) });
        result.counts[f + ' rows'] = x[0].v.length;
      }
    }
  } finally { await o.end(); await n.end(); }
  result.counts.compared = compared; result.counts.byKind = byKind; result.counts.differences = result.differences.length;
  check(result.differences.length === 0, `equivalence: ${compared} reads compared, ${result.differences.length} differences`, result.differences.slice(0, 3));
}

// ---------------------------------------------------------------- scenarios
// A synthetic space with N students (Firebase identities) and a same-time exam of two choice questions, published, auto-release on.
async function scenario(dbName, n, rules) {
  const c = await connect(dbName);
  try {
    const tag = 'ftr-scn-' + Math.random().toString(36).slice(2, 8);
    await c.query(`create temp table ids as select md5($1||':'||g)::uuid id,g from generate_series(0,$2) g`, [tag, n]);
    await c.query(`insert into public.profiles(id,display_name,status) select id,'Scenario '||g,'active' from ids`);
    await c.query(`insert into private.external_identities(profile_id,provider,issuer,subject,verified_at) select id,'firebase','https://securetoken.google.com/diagonproduction',$1||'-'||g,now() from ids`, [tag]);
    const org = (await c.query("select md5($1||':org')::uuid id", [tag])).rows[0].id, crs = (await c.query("select md5($1||':course')::uuid id", [tag])).rows[0].id, off = (await c.query("select md5($1||':run')::uuid id", [tag])).rows[0].id;
    await c.query("insert into public.organizations(id,name,slug) values($1,'Scenario',$2)", [org, tag]);
    await c.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select $1,id,'owner','active',now() from ids where g=0", [org]);
    await c.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) select $1,$2,'Scenario',$3,'published','private',id from ids where g=0", [crs, org, tag]);
    await c.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$2,'Run','scheduled','active')", [off, crs]);
    await c.query("insert into public.enrollments(offering_id,user_id,status) select $1,id,'active' from ids where g>0", [off]);
    const sub = g => `${tag}-${g}`;
    const iso = ms => new Date(Date.now() + ms).toISOString();
    const q = [{ type: 'choice', text: 'Pick B', points: 2, options: ['A', 'B'], correct: [1] }, { type: 'choice', text: 'Pick A', points: 2, options: ['A', 'B'], correct: [0] }];
    const [{ v: ex }] = await as(c, sub(0), 'select public.exam_save(null,$1,null,$2) v', [off, { kind: 'online', title: 'Scenario', timing: 'same_time', opensAt: iso(60000), closesAt: iso(3600000), timeLimitMinutes: 60, autoRelease: true, questions: q, ...rules }], true);
    await as(c, sub(0), "select public.exam_lifecycle($1,'publish',1) v", [ex.id], true);
    await c.query("update private.exams set opens_at=now()-interval '50 minutes',closes_at=now()+interval '1 hour' where id=$1", [ex.id]);
    return { c, sub, exam: ex.id, off, tag };
  } catch (e) { await c.end(); throw e; }
}
const ms = () => Number(process.hrtime.bigint() / 1000000n);
async function timed(dbName, sub, sql, args) { const d = await connect(dbName); try { const t0 = ms(); const r = await as(d, sub, sql, args, true); return { ms: ms() - t0, error: r[0] && r[0].error }; } finally { await d.end(); } }

async function a6a10() {
  for (const [label, db] of [['old', OLD], ['new', NEW]]) {
    const s = await scenario(db, 400, {});
    try {
      // Every student starts; 8 hand in; then the close has passed and the 392 open tries' deadlines are the close (the old cap).
      for (let g = 1; g <= 400; g++) { const [{ v: t }] = await as(s.c, s.sub(g), "select public.exam_work($1,'start') v", [s.exam], true); if (g <= 8) await as(s.c, s.sub(g), "select public.exam_work($1,'submit',$2,$3) v", [s.exam, t.revision, { attemptId: t.id }], true); }
      await s.c.query("update private.exams set closes_at=now()-interval '1 second' where id=$1", [s.exam]);
      await s.c.query("update private.exam_attempts set started_at=now()-interval '30 minutes',deadline_at=now()-interval '1 second' where exam_id=$1 and status='in_progress'", [s.exam]);
    } finally { await s.c.end(); }
    const snap = `ftr_a6a10_${label}`; await copy(snap, db);
    // The first reader alone.
    await copy(snap + '_1', snap);
    const first = await timed(snap + '_1', s.sub(0), "select public.exam_queue($1,'corrected') v", [s.exam]);
    const c1 = await connect(snap + '_1');
    const after = (await c1.query(`select (select count(*) from private.exam_attempts where exam_id=$1 and status='in_progress') open,(select count(*) from private.exam_results where exam_id=$1 and released_at is not null) released,
      (select count(*) from private.notification_events v join private.exam_results r on r.id=v.resource_id where r.exam_id=$1 and v.event_type='exam_released') notices`, [s.exam])).rows[0];
    await c1.end();
    // 20 students at the same moment, connections and claims ready first.
    await copy(snap + '_20', snap);
    const conns = []; for (let g = 1; g <= 20; g++) conns.push(await connect(snap + '_20'));
    for (const [i, d] of conns.entries()) { await d.query('begin'); await d.query("set local statement_timeout='8s'"); await d.query("set local lock_timeout='8s'"); await d.query('set local role authenticated'); await d.query("select set_config('request.jwt.claims',$1,true)", [claims(s.sub(i + 100))]); }
    const t0 = ms();
    const ends = await Promise.all(conns.map(d => d.query('select public.exam_get($1) v', [s.exam]).then(() => d.query('commit')).then(() => ms() - t0, e => 'error ' + e.code)));
    for (const d of conns) await d.end();
    const c20 = await connect(snap + '_20');
    const after20 = (await c20.query(`select (select count(*) from private.exam_attempts where exam_id=$1 and status='in_progress') open,(select count(*) from private.exam_results where exam_id=$1 and released_at is not null) released,
      (select count(*) from private.notification_events v join private.exam_results r on r.id=v.resource_id where r.exam_id=$1 and v.event_type='exam_released') notices,
      (select count(*) from private.exam_audit where exam_id=$1 and action='auto_release') audits`, [s.exam])).rows[0];
    await c20.end();
    result.a6a10[label] = { firstReaderMs: first.ms, firstReaderError: first.error || null, afterFirst: after, twentyMs: ends.slice().sort((a, b) => a - b), afterTwenty: after20 };
    log(label, JSON.stringify(result.a6a10[label]));
    if (!process.env.FTR_KEEP) for (const d of [snap, snap + '_1', snap + '_20']) await admin(`drop database if exists ${d} with (force)`);
  }
  const nw = result.a6a10.new, old = result.a6a10.old;
  check(Number(nw.afterTwenty.released) === 400 && Number(nw.afterTwenty.audits) === 1 && Number(nw.afterTwenty.notices) === 400 && Number(nw.afterTwenty.open) === 0, 'A6a-10 new: 20 readers settle all 392 tries and release 400 results once, 400 notices', nw.afterTwenty);
  check(Math.max(...nw.twentyMs) <= Math.max(...old.twentyMs), 'A6a-10: the slowest of 20 parallel students is no slower than before', { old: Math.max(...old.twentyMs), new: Math.max(...nw.twentyMs) });
}

async function a6a01() {
  for (const [label, db] of [['old', OLD], ['new', NEW]]) {
    const s = await scenario(db, 10, { tries: 'fix_mistakes' });
    try {
      const q = (await s.c.query('select q.id,q.position,o.id oid,o.position op from private.exam_questions q join private.exam_options o on o.question_id=q.id where q.exam_id=$1 order by 2,4', [s.exam])).rows;
      const handIn = async (g, right) => {
        const [{ v: t }] = await as(s.c, s.sub(g), "select public.exam_work($1,'start') v", [s.exam], true); const tid = t.id; let rev = t.revision;
        for (const [p, pick] of [[0, right ? 1 : 0], [1, right ? 0 : 1]]) {
          const [row] = await as(s.c, s.sub(g), "select public.exam_work($1,'save',$2,$3) v", [s.exam, rev, { attemptId: tid, questionId: q.find(x => x.position === p).id, optionIds: [q.find(x => x.position === p && x.op === pick).oid] }], true);
          if (!row.v) throw new Error('save refused: ' + JSON.stringify(row)); rev = row.v.revision;
        }
        await as(s.c, s.sub(g), "select public.exam_work($1,'submit',$2,$3) v", [s.exam, rev, { attemptId: tid }], true); return tid;
      };
      for (let g = 1; g <= 5; g++) await handIn(g, g % 2 === 0);
      const s8first = await handIn(8, false);
      await as(s.c, s.sub(8), "select public.exam_work($1,'retry') v", [s.exam], true);
      for (const g of [9, 10]) await as(s.c, s.sub(g), "select public.exam_work($1,'start') v", [s.exam], true);
      // The audit's simulation: the window closed a minute ago while s8 (try 2) and two others write until 50 minutes from now.
      await s.c.query("update private.exams set closes_at=now()-interval '1 minute' where id=$1", [s.exam]);
      await s.c.query("update private.exam_attempts set deadline_at=now()+interval '50 minutes' where exam_id=$1 and status='in_progress'", [s.exam]);
      const [{ v: s8 }] = await as(s.c, s.sub(8), 'select public.exam_get($1,$2) v', [s.exam, s8first], true);
      const [{ v: s2 }] = await as(s.c, s.sub(2), 'select public.exam_get($1) v', [s.exam], true);
      const counts = (await s.c.query(`select (select count(*) from private.exam_results where exam_id=$1 and released_at is not null) released,(select count(*) from private.exam_attempts where exam_id=$1 and status='in_progress') writing`, [s.exam])).rows[0];
      result.a6a01[label] = { s8TryOne: { reviewOpen: s8.reviewOpen, closed: s8.closed, rightAnswers: s8.attempt.items.some(i => 'correctOptionIds' in i), modelText: s8.attempt.items.some(i => 'modelText' in i) },
        classmateResult: s2.result, storedReleased: Number(counts.released), stillWriting: Number(counts.writing) };
      log(label, JSON.stringify(result.a6a01[label]));
    } finally { await s.c.end(); }
  }
  const o = result.a6a01.old, nw = result.a6a01.new;
  check(o.s8TryOne.reviewOpen === true && o.storedReleased > 0, 'A6a-01 before: s8 on try 2 reads try 1\'s review and the results are released while three write', o);
  check(nw.s8TryOne.reviewOpen === false && !nw.s8TryOne.rightAnswers && nw.storedReleased === 0 && nw.classmateResult && nw.classmateResult.waiting === true, 'A6a-01 after: hidden and not released', nw);
}

async function timings() {
  const pickSql = `select x.subject sub,e.id exam from private.exams e join private.exam_results r on r.exam_id=e.id and r.released_at is not null join private.external_identities x on x.profile_id=r.user_id
    where e.kind='online' and e.status='published' order by e.id,r.user_id limit 1`;
  const n = await connect(NEW); const ex = (await n.query(pickSql)).rows[0];
  const hw = (await n.query(`select x.subject sub,s.assignment_id hw from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id and a.status='published' and a.workflow='questions'
    join private.external_identities x on x.profile_id=s.user_id where s.status='submitted' order by s.assignment_id,s.user_id limit 1`)).rows[0]
    || (await n.query(`select x.subject sub,s.assignment_id hw from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id and a.status='published' join private.external_identities x on x.profile_id=s.user_id order by 2,1 limit 1`)).rows[0];
  await n.end();
  for (const [label, db] of [['old', OLD], ['new', NEW]]) {
    // One warm-up call, then the median of 15.
    const median = async (sub, sql, args) => { const xs = []; for (let i = 0; i < 16; i++) xs.push((await timed(db, sub, sql, args)).ms); xs.shift(); xs.sort((a, b) => a - b); return xs[7]; };
    result.timings[label] = { examGetMs: await median(ex.sub, 'select public.exam_get($1) v', [ex.exam]), getHomeworkMs: await median(hw.sub, 'select public.get_homework($1) v', [hw.hw]) };
  }
  log('Timings (median of 15, fresh connection):', JSON.stringify(result.timings));
  const o = result.timings.old, nw = result.timings.new, ok = (a, b) => b <= Math.max(a * 1.1, a + 1);
  check(ok(o.examGetMs, nw.examGetMs) && ok(o.getHomeworkMs, nw.getHomeworkMs), 'one student exam read and one homework read: at most +10 % (or +1 ms at this size)', result.timings);
}

(async () => {
  const steps = { build, apply: applyCheck, equiv, a6a10, a6a01, time: timings };
  for (const [k, f] of Object.entries(steps)) if (!only || only.includes(k)) { log('--', k); await f(); }
  const file = path.join(out, 'result-' + (only ? only.join('-') : 'all') + '.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 1)); log('Written', file);
  if (!process.env.FTR_KEEP && (!only || only.includes('time'))) for (const d of [OLD, NEW]) await admin(`drop database if exists ${d} with (force)`);
})().catch(e => { console.error(e); process.exit(1); });
