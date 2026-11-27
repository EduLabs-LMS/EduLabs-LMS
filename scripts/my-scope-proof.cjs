#!/usr/bin/env node
// Fix track 2a ("my scope") proof: the OLD rules and the NEW rules side by side on identical rows, the server outputs of the OLD code and the
// NEW code compared as JSON, and the before -> after timings with the hosted limit (statement_timeout 8 s for every API statement).
//
//   node scripts/exam-sql-local.cjs --postgres   (once, builds the migrated template)
//   node scripts/my-scope-proof.cjs              (about 10-15 minutes; writes .local/my-scope-proof/result.json)
//
// Disposable local PostgreSQL only (the runner's loopback port). Synthetic people only. It never reads a Supabase URL or a credential.
// How it works:
//  1. myscope_new = a clone of the template (every migration, so the new rules). Fixtures: the role matrix of supabase/tests/my-scope.sql
//     (its fixture section, run as is), a demo fill (demo_fill_core), Part 2a's course (10 chapters x 6 lessons, 10 text items of ~400
//     characters and one published video part each, one active run, seed student 5 enrolled), Part 1's platform (200 spaces made with the
//     real platform_provision_teacher and accepted with the real accept_teacher_invitation, 10 published courses with one run each; one
//     space with 2,000 students in two runs each and 20 staff).
//  2. myscope_old = a clone of myscope_new, then supabase/tests/my-scope-before.sql: the eight policies and save_segment_progress exactly as
//     before the migration. Identical rows; only the rules differ.
//  3. myscope_apply = another clone of myscope_old, then the migration itself (twice): it applies on a filled database, every row count is
//     unchanged, and the result has the same policies and functions as myscope_new.
//  4. For every caller, the ids each of the eight tables returns: OLD database vs NEW database.
//  5. The server: the OLD code (git 059d394: server/services/lessons.ts, website.ts, repositories/website.ts, the old lesson page logic) on
//     the OLD database, and the NEW code on the NEW database, through a PostgREST-shaped client (one transaction per request, the caller's
//     token, role authenticated, max_rows 1000). Page context, Home, every lesson part page and lesson page of every enrolled student, the
//     teacher part-page check: compared as JSON.
//  6. Timings, EXPLAIN, a progress save, the A2a-01 case (a course past 500 items per 50 lessons), and the caller isolation on one connection.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process'), assert = require('node:assert/strict');
const ts = require('typescript');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');
const { Client } = require(path.join(runtime, 'pg'));
const port = Number(fs.readFileSync('.local/step03a/pg-port.txt', 'utf8').trim());
const base = { host: '127.0.0.1', port, user: 'postgres' };
const OLD = 'myscope_old', NEW = 'myscope_new', APPLY = 'myscope_apply';
const BEFORE_COMMIT = '059d394';
const MIGRATION = 'supabase/migrations/20261127140000_my_scope_content.sql';
const out = path.resolve('.local/my-scope-proof'); fs.mkdirSync(out, { recursive: true });
const result = { checks: [], differences: [], timings: {}, notes: [] };
const log = (...a) => console.log(...a);
const check = (ok, label, detail) => { result.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };

async function connect(database) { const c = new Client({ ...base, database }); await c.connect(); return c; }
async function admin(sql) { const c = await connect('postgres'); try { return await c.query(sql); } finally { await c.end(); } }

// ---------------------------------------------------------------- fixtures
const suite = fs.readFileSync('supabase/tests/my-scope.sql', 'utf8');
const roleFixture = suite.slice(suite.indexOf('-- fixture-begin'), suite.indexOf('-- fixture-end'));

const part2a = `
insert into public.courses(id,organization_id,title,slug,status,created_by) values(pg_temp.k('BIG'),'20000000-0000-0000-0000-000000000001','Large course','ms-big','published','10000000-0000-0000-0000-000000000001');
insert into public.course_staff(course_id,user_id,role) values(pg_temp.k('BIG'),'10000000-0000-0000-0000-000000000001','owner') on conflict do nothing;
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.k('BIGa'),pg_temp.k('BIG'),'Large course run','active');
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values(pg_temp.k('BIGa'),'10000000-0000-0000-0000-000000000005','active',now()-interval '10 days');
insert into public.course_modules(id,course_id,title,position) select pg_temp.k('BIG-m'||m),pg_temp.k('BIG'),'Chapter '||(m+1),m from generate_series(0,9) m;
insert into public.lessons(id,module_id,title,position,status) select pg_temp.k('BIG-m'||m||'-l'||l),pg_temp.k('BIG-m'||m),'Lesson '||(m+1)||'.'||(l+1),l,'published' from generate_series(0,9) m, generate_series(0,5) l;
insert into public.lesson_blocks(lesson_id,block_type,position,content) select pg_temp.k('BIG-m'||m||'-l'||l),'text',b,jsonb_build_object('text',repeat('Motion and forces, item '||b||'. ',14))
 from generate_series(0,9) m, generate_series(0,5) l, generate_series(0,9) b;
insert into public.lesson_segments(id,lesson_id,title,position,status,video_url) select pg_temp.k('BIG-m'||m||'-l'||l||'-p0'),pg_temp.k('BIG-m'||m||'-l'||l),'Video',0,'published','https://example.test/video.mp4'
 from generate_series(0,9) m, generate_series(0,5) l;
`;

const demo = `
select pg_temp.person('demo_admin'); select pg_temp.person('demo_owner');
insert into private.platform_admins(user_id,note) values(pg_temp.u('demo_admin'),'my-scope demo admin');
insert into public.organizations(id,name,slug) values(pg_temp.k('DEMO'),'My scope demo','my-scope-demo');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values(pg_temp.k('DEMO'),pg_temp.u('demo_owner'),'owner','active',now());
insert into private.demo_spaces(organization_id,marked_by) values(pg_temp.k('DEMO'),pg_temp.u('demo_admin'));
select private.demo_fill_core(pg_temp.k('DEMO'),pg_temp.u('demo_admin'));
`;

// Part 1: 200 spaces through the real provisioning and acceptance, as the platform admin and each invited teacher.
const part1 = `
create function pg_temp.req(i int) returns jsonb language sql as $$
 select jsonb_build_object('teacherEmail','my-scope-p1t'||i||'@example.test','spaceName','Space '||i,
  'systems',jsonb_build_array(jsonb_build_object('label','Egyptian National','grades',jsonb_build_array(jsonb_build_object('key','g3','label','Third Secondary')))),
  'subjects',jsonb_build_array(jsonb_build_object('key','phy','label','Physics')),
  'course',jsonb_build_object('title','Physics '||i,'gradeKey','g3','subjectKey','phy'))$$;
create temp table p1_spaces(i int primary key, org uuid, teacher uuid);
grant select,insert on p1_spaces to authenticated;
set role authenticated;
do $$ declare i int; r jsonb; t uuid; begin
 for i in 1..200 loop
  perform pg_temp.as_('padmin');
  r:=public.platform_provision_teacher(pg_temp.req(i),encode(sha256(convert_to('my-scope-secret-'||i,'utf8')),'hex'));
  perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated',
   'email_verified',true,'email','my-scope-p1t'||i||'@example.test','sub','my-scope-p1t'||i,'auth_time',floor(extract(epoch from now()))::bigint)::text,true);
  t:=public.onboard_firebase_profile();
  perform public.accept_teacher_invitation(encode(sha256(convert_to('my-scope-secret-'||i,'utf8')),'hex'));
  insert into pg_temp.p1_spaces values(i,(r->>'organizationId')::uuid,t);
 end loop;
end $$;
reset role;
select set_config('request.jwt.claims','',false);
update public.courses c set status='published' from p1_spaces s where c.organization_id=s.org;
insert into public.courses(id,organization_id,title,slug,status,created_by)
 select pg_temp.k('p1c'||s.i||'-'||n),s.org,'Course '||n||' of space '||s.i,'p1-'||s.i||'-'||n,'published',s.teacher from p1_spaces s, generate_series(2,10) n;
insert into public.course_offerings(course_id,name,status) select c.id,'Run of '||c.title,'active' from public.courses c join p1_spaces s on s.org=c.organization_id;
-- The big space (space 1): 2,000 students in the runs of two courses (4,000 enrollments) and 20 staff.
select pg_temp.person('p1student');
insert into public.profiles(id,display_name) select pg_temp.u('p1s'||n),'Student '||n from generate_series(2,2000) n;
create temp table p1_runs as select o.id from public.course_offerings o join public.courses c on c.id=o.course_id join p1_spaces s on s.org=c.organization_id where s.i=1 order by c.title limit 2;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select r.id,p.id,'active',now()-interval '5 days' from p1_runs r,
 (select pg_temp.u('p1student') id union all select pg_temp.u('p1s'||n) from generate_series(2,2000) n) p;
do $$ declare n int; begin for n in 1..20 loop perform pg_temp.person('p1staff'||n); end loop; end $$;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select s.org,pg_temp.u('p1staff'||n),case when n<=10 then 'teacher' else 'assistant' end,'active',now() from p1_spaces s, generate_series(1,20) n where s.i=1;
insert into public.course_staff(course_id,user_id,role)
 select c.id,pg_temp.u('p1staff'||n),case when n<=10 then 'instructor' else 'editor' end from generate_series(1,20) n
 join lateral (select c.id from public.courses c join p1_spaces s on s.org=c.organization_id where s.i=1 order by c.id offset (n-1)%10 limit 1) c on true;
insert into public.offering_staff(offering_id,user_id,role) select r.id,pg_temp.u('p1staff'||n),'teaching_assistant' from p1_runs r, generate_series(11,20) n;
`;

async function buildFixture() {
  const tmpl = (await admin("select datname from pg_database where datname like 'edulabs_tmpl_%' order by oid desc limit 1")).rows[0]?.datname;
  if (!tmpl) throw new Error('No template: run node scripts/exam-sql-local.cjs --postgres first');
  for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`);
  await admin(`create database ${NEW} template ${tmpl}`);
  const c = await connect(NEW);
  try {
    assert.ok((await c.query("select to_regprocedure('private.my_scope()') is not null ok")).rows[0].ok, 'the template has the migration');
    const t0 = Date.now();
    await c.query(roleFixture);
    await c.query(demo);
    await c.query(part2a);
    await c.query(part1);
    await c.query('analyze');
    const counts = (await c.query(`select (select count(*) from public.organizations) spaces,(select count(*) from public.courses) courses,(select count(*) from public.profiles) profiles,
      (select count(*) from public.enrollments) enrollments,(select count(*) from public.lessons) lessons,(select count(*) from public.lesson_blocks) blocks`)).rows[0];
    result.fixture = { ...counts, seconds: Math.round((Date.now() - t0) / 1000) };
    log('Fixture', JSON.stringify(result.fixture));
  } finally { await c.end(); }
  await admin(`create database ${OLD} template ${NEW}`);
  const o = await connect(OLD); try { await o.query(fs.readFileSync('supabase/tests/my-scope-before.sql', 'utf8')); await o.query('analyze'); } finally { await o.end(); }
}

// ---------------------------------------------------------------- 3. the migration on a filled database
async function applyCheck() {
  await admin(`create database ${APPLY} template ${OLD}`);
  const c = await connect(APPLY), n = await connect(NEW);
  const countsSql = `select string_agg(format('%s.%s=%s',n.nspname,c.relname,(xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text),',' order by n.nspname,c.relname) v
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind='r'`;
  const catalogSql = `select md5(coalesce((select string_agg(schemaname||tablename||policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,''),'|' order by schemaname,tablename,policyname) from pg_policies),'')) policies,
    md5((select string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('public','private') and p.prokind='f')) functions`;
  try {
    const before = (await c.query(countsSql)).rows[0].v;
    const migration = fs.readFileSync(MIGRATION, 'utf8');
    await c.query(migration);
    const after = (await c.query(countsSql)).rows[0].v;
    check(before === after, 'the migration applies on a database with the demo fill and both large fixtures; every table keeps its row count', { tables: before.split(',').length });
    await c.query(migration);
    check((await c.query(countsSql)).rows[0].v === before, 'it applies a second time without error, counts unchanged');
    const a = (await c.query(catalogSql)).rows[0], b = (await n.query(catalogSql)).rows[0];
    check(a.policies === b.policies && a.functions === b.functions, 'the result has exactly the policies and functions of a full replay');
  } finally { await c.end(); await n.end(); }
  await admin(`drop database ${APPLY} with (force)`);
}

// ---------------------------------------------------------------- callers
const fixtureCallers = ['owner', 'admin', 'teacher', 'asst_run', 'asst_norun', 'cs_owner', 'cs_instructor', 'cs_editor', 'cs_assistant', 'ta_nomember',
  'st_active', 'st_suspended', 'st_cancelled', 'st_expired', 'st_future', 'st_invited', 'st_completed', 'st_archived_run', 'st_draft_course', 'st_other', 'st_two',
  'nospace', 'padmin', 'prof_suspended', 'mem_suspended', 'mem_invited', 's2_teacher', 's2_student', 'staff_student', 'revoked', 'unmapped', 'none',
  'seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6', 'seed7', 'demo_owner', 'demo_admin', 'p1student', 'p1t1', 'p1t2', 'p1staff1', 'p1staff15'];
function claims(label) {
  if (label === 'none') return '';
  if (label.startsWith('seed')) return JSON.stringify({ iss: 'https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated', sub: '10000000-0000-0000-0000-00000000000' + label.slice(4) });
  return JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, sub: 'my-scope-' + label, auth_time: Math.floor(Date.now() / 1000) });
}

// A PostgREST-shaped client: one transaction per request, role authenticated (or anon), the caller's token, the hosted 8 s limit, max_rows 1000.
function restClient(db, label, timings) {
  let queue = Promise.resolve();
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  async function tx(sql, params, name) {
    return serial(async () => {
      const t = process.hrtime.bigint();
      try {
        await db.query('begin');
        await db.query(`set local role ${label === 'anon' ? 'anon' : 'authenticated'}`);
        await db.query("select set_config('request.jwt.claims',$1,true)", [label === 'anon' ? '' : claims(label)]);
        await db.query("set local statement_timeout='8s'");
        const r = await db.query(sql, params);
        await db.query('commit');
        return r;
      } catch (e) { await db.query('rollback').catch(() => {}); throw e; }
      finally { timings?.push({ name, ms: Number(process.hrtime.bigint() - t) / 1e6 }); }
    });
  }
  const ident = s => { if (!/^[a-z_]+$/.test(s)) throw new Error('bad identifier ' + s); return '"' + s + '"'; };
  function from(table) {
    const st = { cols: '*', where: [], params: [], order: [], limit: null, range: null, single: null, count: null, head: false };
    const p = v => { st.params.push(v); return '$' + st.params.length; };
    const b = {
      select(cols = '*', opts = {}) { st.cols = cols; st.count = opts.count || null; st.head = !!opts.head; return b; },
      eq(c, v) { st.where.push(`${ident(c)}=${p(v)}`); return b; },
      // PostgREST sends untyped values that PostgreSQL types from the column (uuid = uuid, leakproof, so an index is used first).
      in(c, vs) { st.where.push(`${ident(c)}=any(${p(vs)})`); return b; },
      ilike(c, v) { st.where.push(`${ident(c)} ilike ${p(v)}`); return b; },
      order(c, o = {}) { st.order.push(`${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`); return b; },
      limit(n) { st.limit = n; return b; }, range(a, z) { st.range = [a, z]; return b; },
      maybeSingle() { st.single = 'maybe'; return b; }, single() { st.single = 'one'; return b; },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      const cols = st.cols === '*' ? 't.*' : st.cols.split(',').map(s => 't.' + ident(s.trim())).join(',');
      const where = st.where.length ? ' where ' + st.where.join(' and ') : '';
      const offset = st.range ? st.range[0] : 0, wanted = st.range ? st.range[1] - st.range[0] + 1 : st.limit ?? 1000;
      const sql = `select coalesce(jsonb_agg(x),'[]') v from (select ${cols} from public.${ident(table)} t${where}${st.order.length ? ' order by ' + st.order.join(',') : ''} limit ${Math.min(wanted, 1000)} offset ${offset}) x`;
      try {
        const data = (await tx(sql, st.params, table)).rows[0].v;
        const count = st.count ? Number((await tx(`select count(*) n from public.${ident(table)} t${where}`, st.params, table + ' count')).rows[0].n) : null;
        if (st.single === 'one' && data.length !== 1) return { data: null, error: { code: 'PGRST116' }, count };
        if (st.single === 'maybe' && data.length > 1) return { data: null, error: { code: 'PGRST116' }, count };
        return { data: st.head ? null : st.single ? data[0] ?? null : data, error: null, count };
      } catch (e) { return { data: null, error: { code: e.code, message: e.message }, count: null }; }
    }
    return b;
  }
  const signed = (bucket, p, ttl) => `https://signed.test/${bucket}/${p}?ttl=${ttl}`;
  return {
    from,
    rpc(name, args = {}) {
      const keys = Object.keys(args);
      const sql = `select to_jsonb(public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(',')})) v`;
      return { then(res, rej) { return tx(sql, keys.map(k => typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]), 'rpc ' + name).then(r => ({ data: r.rows[0].v, error: null }), e => ({ data: null, error: { code: e.code, message: e.message } })).then(res, rej); } };
    },
    storage: { from: bucket => ({
      createSignedUrl: async (p, ttl) => ({ data: { signedUrl: signed(bucket, p, ttl) }, error: null }),
      createSignedUrls: async (ps, ttl) => ({ data: ps.map(p => ({ path: p, signedUrl: signed(bucket, p, ttl), error: null })), error: null }),
    }) },
  };
}

// ---------------------------------------------------------------- loading the OLD and the NEW server code
const oldSource = file => cp.execFileSync('git', ['show', `${BEFORE_COMMIT}:${file}`], { encoding: 'utf8' });
function loadTs(source, file, deps) {
  const m = { exports: {} };
  const code = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module: m, exports: m.exports, console, URL, Date, Set, Map, Promise, Buffer, process, setTimeout,
    require: n => { if (n in deps) return deps[n]; if (n === 'server-only') return {}; if (n.startsWith('@/') || n.startsWith('.')) throw new Error(file + ' needs ' + n); return require(n); } });
  return m.exports;
}
function codeFor(version, client, viewer) {
  const src = f => version === 'old' ? oldSource(f) : fs.readFileSync(f, 'utf8');
  const contracts = loadTs(src('shared/contracts/lessons.ts'), 'shared/contracts/lessons.ts', {});
  const lessonMedia = loadTs(src('server/services/lesson-media.ts'), 'lesson-media.ts', {});
  const supabase = { getSupabaseServerClient: async () => client };
  const auth = { getApplicationViewer: async () => viewer };
  const teacherCourse = { editableTeacherCourse: async (_u, id) => (await client.from('courses').select('id,organization_id,title,status').eq('id', id).maybeSingle()).data };
  const lessons = loadTs(src('server/services/lessons.ts'), 'lessons.ts', { './lesson-image-validation': {}, '@/server/integrations/supabase': supabase, '@/server/services/application-auth': auth,
    '@/server/services/teacher-course': teacherCourse, '@/shared/contracts/lessons': contracts, '@/server/services/lesson-media': lessonMedia });
  const blocks = loadTs(src('server/services/lesson-blocks.ts'), 'lesson-blocks.ts', {});
  const repo = loadTs(src('server/repositories/website.ts'), 'repositories/website.ts', {});
  const website = loadTs(src('server/services/website.ts'), 'website.ts', { react: { cache: f => f }, 'node:crypto': { randomUUID: () => 'read-id' }, '@/server/services/application-auth': auth,
    '@/server/integrations/supabase': supabase, '@/server/services/firebase-auth': { getFirebaseSession: async () => ({ identity: { role: 'authenticated', email_verified: true } }) },
    '@/server/repositories/website': repo, '@/shared/auth-config': { isFirebaseStaging: () => true }, '@/server/services/lesson-media': lessonMedia });
  const overview = loadTs(fs.readFileSync('shared/student-lesson.ts', 'utf8'), 'student-lesson.ts', { '@/shared/contracts/lessons': contracts });
  const page = version === 'new' ? loadTs(src('server/services/student-lesson-page.ts'), 'student-lesson-page.ts', { '@/shared/contracts/lessons': contracts, '@/server/services/lesson-blocks': blocks }) : null;
  return { contracts, lessons, blocks, website, overview, page };
}

// The OLD student part page (app/(dashboard)/_components/secure-lesson-page.tsx at 059d394, LessonContent), line for line, returning the props
// it rendered in the same shape as the new studentLessonPage.
async function oldLessonPage(code, service, courseId, segmentId, offeringId) {
  const { continuePart, lessonPartHref, lessonPlayback } = code.contracts;
  await service.offering(offeringId);
  const [tree, progress] = await Promise.all([service.tree(), service.progress(offeringId)]);
  const segment = tree.segments.find(s => s.id === segmentId); if (!segment) return { kind: 'unavailable' };
  const lesson = tree.lessons.find(l => l.id === segment.lesson_id);
  const courseModule = tree.modules.find(m => m.id === lesson.module_id);
  const parts = tree.segments.filter(s => s.lesson_id === lesson.id).sort((a, b) => a.position - b.position);
  const state = progress.find(p => p.segment_id === segment.id);
  const thumbnails = await service.thumbnails(parts.flatMap(s => s.thumbnail_asset_id ? [s.thumbnail_asset_id] : []));
  const ordered = tree.lessons.filter(l => tree.segments.some(s => s.lesson_id === l.id)).sort((a, b) => tree.modules.findIndex(m => m.id === a.module_id) - tree.modules.findIndex(m => m.id === b.module_id) || a.position - b.position);
  const index = ordered.findIndex(l => l.id === lesson.id);
  const adjacent = offset => { const l = ordered[index + offset]; if (!l) return undefined; const part = continuePart(tree.segments.filter(s => s.lesson_id === l.id), progress, offeringId); return part ? { title: l.title, href: lessonPartHref(courseId, part.id, offeringId) } : undefined; };
  let videoUrl = segment.video_asset_id ? await service.media(segment.video_asset_id) : segment.video_url;
  const attachments = await Promise.all(tree.resources.filter(r => r.segment_id === segmentId).map(async r => ({ id: r.id, name: r.name, url: `/api/learning/${courseId}/resources/${r.id}` })));
  const blocks = await code.blocks.lessonBlockViews(tree, lesson.id, courseId, service.media);
  const blockVideo = !videoUrl ? blocks.find(b => ['video', 'embed'].includes(b.type) && lessonPlayback(b.mediaUrl)) : undefined;
  if (blockVideo) videoUrl = blockVideo.mediaUrl;
  const videoAssetId = segment.video_asset_id ?? (blockVideo ? tree.blocks.find(b => b.id === blockVideo.id)?.media_asset_id : null) ?? null;
  return { kind: 'page', key: `${segment.id}:${state?.revision ?? 0}`, tabs: { courseId, chapterId: segment.id, title: segment.title,
    chapterNumber: tree.modules.indexOf(courseModule) + 1, chapterType: courseModule.group_type, courseTitle: lesson.title, description: segment.description,
    previousLesson: adjacent(-1), nextLesson: adjacent(1), lessonBlocks: blocks.filter(b => b.id !== blockVideo?.id),
    playbackId: null, videoUrl, solutionVideoUrl: null, contentType: 'VIDEO_EXPLANATION', completeOnEnd: false, isCompleted: state?.status === 'completed',
    isWatched: state?.status === 'completed', userId: '', hasSubmission: false, attachments,
    secure: { offeringId, revision: state?.revision ?? 0, position: state?.video_position_seconds ?? 0, assetId: videoAssetId, thumbnailUrl: segment.thumbnail_asset_id ? thumbnails[segment.thumbnail_asset_id] : null, status: state?.status ?? 'not_started' },
    segments: parts.map(s => ({ ...s, thumbnailUrl: s.thumbnail_asset_id ? thumbnails[s.thumbnail_asset_id] : null, contentType: 'VIDEO_EXPLANATION', isCompleted: progress.some(p => p.segment_id === s.id && p.status === 'completed') })) },
    homework: { courseId, lessonId: lesson.id, segmentId: segment.id, offeringId } };
}

// The first place two JSON values differ: its path and both values.
function firstDiff(a, b, at = '') {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], at + '.' + k); if (d) return d; }
    return null;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? null : { path: at, old: a, new: b };
}
const json = v => JSON.stringify(v, (k, x) => x === undefined ? null : x);
const settle = async fn => { try { return { ok: await fn() }; } catch (e) { return { error: e.status ?? e.code ?? 'error', message: String(e.message).slice(0, 120) }; } };
// n workers; each item gets the index of the worker running it, so a worker's connection is never shared with another worker.
async function pool(items, n, fn) { const results = []; let i = 0; await Promise.all(Array.from({ length: n }, async (_, w) => { while (i < items.length) { const k = i++; results[k] = await fn(items[k], w); } })); return results; }

// ---------------------------------------------------------------- 4. row sets per caller and table
const TABLES = ['courses', 'organizations', 'profiles', 'course_modules', 'lessons', 'lesson_blocks', 'lesson_segments', 'lesson_resources'];
async function rowSets() {
  const callers = [...fixtureCallers, 'anon'];
  const pairs = callers.flatMap(c => TABLES.map(t => [c, t]));
  const conns = { old: await Promise.all([0, 1, 2, 3].map(() => connect(OLD))), new: await Promise.all([0, 1, 2, 3].map(() => connect(NEW))) };
  let nonEmpty = 0, rowsSeen = 0;
  // Every row of the table (no max_rows cap): the count and an md5 of all ids in order, read as the caller in one transaction.
  const read = async (db, c, t) => {
    try {
      await db.query('begin'); await db.query(`set local role ${c === 'anon' ? 'anon' : 'authenticated'}`);
      await db.query("select set_config('request.jwt.claims',$1,true)", [c === 'anon' ? '' : claims(c)]);
      const r = (await db.query(`select count(*)::int n, md5(coalesce(string_agg(id::text,',' order by id),'')) h from public.${t}`)).rows[0];
      await db.query('commit'); return r.n ? [r.n, r.h] : [];
    } catch (e) { await db.query('rollback'); return 'error ' + e.code; }
  };
  await pool(pairs, 4, async ([c, t], w) => {
    // No statement limit here: this compares meaning, and the old rules take longer than 8 s on this platform (see the timings).
    const [a, b] = await Promise.all([read(conns.old[w], c, t), read(conns.new[w], c, t)]);
    const same = json(a) === json(b);
    if (!same) result.differences.push({ kind: 'rows', caller: c, table: t, old: a, new: b });
    if (Array.isArray(b) && b.length) { nonEmpty++; rowsSeen += b[0]; }
  });
  for (const list of Object.values(conns)) for (const c of list) await c.end();
  check(!result.differences.some(d => d.kind === 'rows'), `row sets: ${pairs.length} caller x table pairs, old rules vs new rules, every row (${rowsSeen} rows in ${nonEmpty} non-empty pairs)`, { differences: result.differences.filter(d => d.kind === 'rows').length });
  result.rowSets = { callers: callers.length, tables: TABLES.length, pairs: pairs.length, nonEmpty, rowsSeen };
}

// ---------------------------------------------------------------- 5. server outputs
async function profileOf(db, label) {
  if (label === 'none' || label === 'anon') return null;
  await db.query('begin'); await db.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]);
  const id = (await db.query('select private.current_app_user_id() id')).rows[0].id; await db.query('commit'); return id;
}
async function serverOutputs() {
  // MY_SCOPE_PART=k/n compares the k-th of n slices of the callers (so each run fits a 10-minute foreground limit).
  const [part, parts] = (process.env.MY_SCOPE_PART || '1/1').split('/').map(Number);
  const callers = fixtureCallers.filter(c => c !== 'none').filter((_, i) => i % parts === part - 1);
  const meta = await connect(NEW);
  const enrolled = new Map();
  for (const c of callers) {
    const id = await profileOf(meta, c);
    const rows = id ? (await meta.query(`select o.id offering, o.course_id course from public.enrollments e join public.course_offerings o on o.id=e.offering_id where e.user_id=$1`, [id])).rows : [];
    enrolled.set(c, { id, rows });
  }
  const contentOf = async course => ({
    segments: (await meta.query('select s.id from public.lesson_segments s join public.lessons l on l.id=s.lesson_id join public.course_modules m on m.id=l.module_id where m.course_id=$1 order by s.id', [course])).rows.map(r => r.id),
    lessons: (await meta.query('select l.id from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=$1 order by l.id', [course])).rows.map(r => r.id),
  });
  const staffCourses = (await meta.query("select id from public.courses where organization_id in ($1::uuid,$2::uuid) or id=$3::uuid", [md5uuid('my-scope:key:R'), md5uuid('my-scope:key:R2'), md5uuid('my-scope:key:BIG')])).rows.map(r => r.id);
  let pages = 0, overviews = 0, contexts = 0, homes = 0, teacherChecks = 0;
  // What each comparison returned (so equal results are visibly not just equal failures).
  result.outcomes ??= {};
  const diff = (kind, detail, a, b) => {
    const what = b.error !== undefined ? 'error ' + b.error : b.ok === null ? 'null' : Array.isArray(b.ok) ? 'list' : b.ok?.kind ?? 'data';
    result.outcomes[kind] ??= {}; result.outcomes[kind][what] = (result.outcomes[kind][what] ?? 0) + 1;
    if (json(a) !== json(b)) result.differences.push({ kind, ...detail, at: firstDiff(JSON.parse(json(a)), JSON.parse(json(b))) });
  };
  await pool(callers, 4, async c => {
    const dbs = { old: await connect(OLD), new: await connect(NEW) };
    const unlimited = db => ({ query: (q, p) => q.startsWith('set local statement_timeout') ? db.query("set local statement_timeout=0") : db.query(q, p) });
    try {
      const { id, rows } = enrolled.get(c);
      const viewer = id ? { id, backend: 'firebase' } : null;
      const side = v => { const client = restClient(unlimited(dbs[v]), c); return { client, code: codeFor(v, client, viewer) }; };
      const O = side('old'), N = side('new');
      // Page context and Home.
      const ctx = async s => { const r = await s.code.website.getWebsiteContext(); if (!r) return null; const { viewer: _v, repository: _r, ...rest } = r; return rest; };
      const [co, cn] = await Promise.all([settle(() => ctx(O)), settle(() => ctx(N))]);
      diff('context', { caller: c }, co, cn); contexts++;
      if (co.ok && cn.ok) {
        const home = async s => { const context = await s.code.website.getWebsiteContext(); const scope = await s.code.website.loadWebsiteScope(context); return scope; };
        diff('home', { caller: c }, await settle(() => home(O)), await settle(() => home(N))); homes++;
        for (const org of (cn.ok.organizations || []).slice(0, 1)) {
          const scoped = async s => s.code.website.loadWebsiteScope(await s.code.website.getWebsiteContext(), org.id);
          diff('home', { caller: c, organization: org.id }, await settle(() => scoped(O)), await settle(() => scoped(N))); homes++;
        }
      }
      if (!viewer) return;
      // Every part page and lesson page of every course the caller has an enrollment in (any state), and of the R1 course for everyone.
      const courses = [...new Set([...rows.map(r => r.course), md5uuid('my-scope:key:C1')])];
      for (const course of courses) {
        const runs = [...new Set([...rows.filter(r => r.course === course).map(r => r.offering), md5uuid('my-scope:key:C1a')])];
        const { segments, lessons } = await contentOfCached(contentOf, course);
        for (const offering of runs) {
          // The OLD tree is the same for every page of one course and caller (nothing writes in between): read it once (it is the slow part).
          const oldService = await settle(() => O.code.lessons.learningService(course));
          const newService = await settle(() => N.code.lessons.learningService(course));
          if (oldService.error || newService.error) { diff('service', { caller: c, course }, oldService.error ?? null, newService.error ?? null); continue; }
          const memo = oldService.ok, tree = memo.tree; let cached; memo.tree = () => (cached ??= tree());
          const pick = course === md5uuid('my-scope:key:BIG') ? segments.filter((_, i) => i % 6 === 0 || i === segments.length - 1) : segments;
          for (const seg of pick) {
            diff('lesson page', { caller: c, course, offering, segment: seg }, await settle(() => oldLessonPage(O.code, memo, course, seg, offering)), await settle(() => N.code.page.studentLessonPage(newService.ok, course, seg, offering))); pages++;
          }
          for (const lesson of course === md5uuid('my-scope:key:BIG') ? lessons.slice(0, 6) : lessons) {
            const view = async (s, svc, read) => { await svc.offering(offering); const [t, p] = await Promise.all([read(), svc.progress(offering)]); return s.code.overview.lessonOverview(t, p, course, lesson, offering); };
            diff('lesson overview', { caller: c, course, offering, lesson }, await settle(() => view(O, memo, () => memo.tree())), await settle(() => view(N, newService.ok, () => newService.ok.outline()))); overviews++;
          }
        }
      }
      // The teacher part page's check (learning-part-page.tsx): is the part in the course, for the course's staff.
      for (const course of staffCourses) {
        const a = await settle(async () => { const s = await O.code.lessons.learningService(course, true); const t = await s.tree(); return t.segments.map(x => x.id).sort(); });
        const b = await settle(async () => { const s = await N.code.lessons.learningService(course, true); const t = await s.outline(); return t.segments.map(x => x.id).sort(); });
        diff('teacher part check', { caller: c, course }, a, b); teacherChecks++;
      }
    } finally { await dbs.old.end(); await dbs.new.end(); }
  });
  await meta.end();
  const n = result.differences.filter(d => d.kind !== 'rows').length;
  log('outcomes', JSON.stringify(result.outcomes));
  check(n === 0, `server outputs: ${contexts} page contexts, ${homes} Home scopes, ${pages} lesson part pages, ${overviews} lesson pages, ${teacherChecks} teacher part checks, old code on old rules vs new code on new rules`, { differences: n });
  result.server = { contexts, homes, pages, overviews, teacherChecks };
}
const contentCache = new Map();
async function contentOfCached(fn, course) { if (!contentCache.has(course)) contentCache.set(course, await fn(course)); return contentCache.get(course); }
function md5uuid(s) { const h = require('node:crypto').createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }

// ---------------------------------------------------------------- 6. timings (the hosted limit: 8 s per statement)
const BIG = md5uuid('my-scope:key:BIG'), BIGa = md5uuid('my-scope:key:BIGa');
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = x => Math.round(x * 10) / 10;
async function timed(version, label, fn) {
  const db = await connect(version === 'old' ? OLD : NEW); const timings = [];
  try {
    const client = restClient(db, label, timings);
    const { rows: [{ id }] } = await (async () => { await db.query('begin'); await db.query("select set_config('request.jwt.claims',$1,true)", [label === 'anon' ? '' : claims(label)]); const r = await db.query('select private.current_app_user_id() id'); await db.query('commit'); return r; })();
    const code = codeFor(version, client, id ? { id, backend: 'firebase' } : null);
    await settle(() => fn(code, client)); timings.length = 0; // warm (the audit measured warm connections)
    const t = process.hrtime.bigint(); const r = await settle(() => fn(code, client)); const total = Number(process.hrtime.bigint() - t) / 1e6;
    const byName = {}; for (const x of timings) byName[x.name] = round((byName[x.name] ?? 0) + x.ms);
    return { total: round(total), statements: timings.length, slowest: round(Math.max(0, ...timings.map(x => x.ms))), byName, ...(r.error ? { error: r.error, message: r.message } : {}) };
  } finally { await db.end(); }
}
async function timingsAll() {
  const seg = md5uuid('my-scope:key:BIG-m4-l3-p0');
  const T = result.timings;
  for (const v of ['old', 'new']) {
    T[`2a student lesson page (${v})`] = await timed(v, 'seed5', async code => v === 'old' ? oldLessonPage(code, await code.lessons.learningService(BIG), BIG, seg, BIGa) : code.page.studentLessonPage(await code.lessons.learningService(BIG), BIG, seg, BIGa));
    T[`2a owner course read (${v})`] = await timed(v, 'seed1', async code => { const s = await code.lessons.learningService(BIG); if (v === 'old') return s.tree(); const o = await s.outline(); return s.lesson(o, md5uuid('my-scope:key:BIG-m4-l3'), seg); });
    T[`2a student Home context (${v})`] = await timed(v, 'seed5', code => code.website.getWebsiteContext());
    T[`2a student Home scope (${v})`] = await timed(v, 'seed5', async code => code.website.loadWebsiteScope(await code.website.getWebsiteContext()));
    for (const who of ['p1student', 'p1t1', 'p1t2']) {
      T[`1 ${who} page context (${v})`] = await timed(v, who, code => code.website.getWebsiteContext());
      T[`1 ${who} spaces and courses read (${v})`] = await timed(v, who, async (code, client) => v === 'old'
        ? Promise.all([client.from('organizations').select('id,name,status').order('id').limit(101), client.from('courses').select('id,organization_id,title,description,status').order('id').limit(101)])
        : client.rpc('my_scope'));
      T[`1 ${who} unfiltered organizations read (${v})`] = await timed(v, who, (code, client) => client.from('organizations').select('id,name,status').order('id').limit(101));
      T[`1 ${who} unfiltered courses read (${v})`] = await timed(v, who, (code, client) => client.from('courses').select('id,organization_id,title,description,status').order('id').limit(101));
    }
    for (const who of ['p1student', 'nospace']) for (const t of ['courses', 'organizations', 'profiles'])
      T[`1 ${who} direct count(*) ${t} (${v})`] = await timed(v, who, (code, client) => client.from(t).select('id', { count: 'exact', head: true }));
    T[`1 p1t1 own students' names from profiles (${v})`] = await timed(v, 'p1t1', (code, client) => client.from('profiles').select('id,display_name').order('id').range(0, 2999));
  }
  // One progress save (median of 7, warm), as the student of the large course.
  for (const v of ['old', 'new']) {
    const db = await connect(v === 'old' ? OLD : NEW); const ms = [];
    try {
      let revision = 0;
      for (let i = 0; i < 8; i++) {
        await db.query('begin'); await db.query('set local role authenticated'); await db.query("select set_config('request.jwt.claims',$1,true)", [claims('seed5')]);
        const t = process.hrtime.bigint();
        const r = await db.query('select public.save_segment_progress($1,$2,$3,false,$4) v', [BIGa, seg, 10 + i, revision]);
        const took = Number(process.hrtime.bigint() - t) / 1e6; await db.query('commit');
        revision = r.rows[0].v.revision; if (i) ms.push(took);
      }
    } finally { await db.end(); }
    T[`progress save (${v})`] = { median: round(median(ms)), runs: ms.map(round) };
  }
  for (const [k, v] of Object.entries(T)) log('TIME', k, JSON.stringify(v));
}

async function explainBlocks() {
  for (const v of ['old', 'new']) {
    const db = await connect(v === 'old' ? OLD : NEW);
    try {
      await db.query('begin'); await db.query('set local role authenticated'); await db.query("select set_config('request.jwt.claims',$1,true)", [claims('seed5')]);
      const r = await db.query(`explain (analyze, buffers, costs off) select id,lesson_id,block_type,position,content,media_asset_id,updated_at from public.lesson_blocks where lesson_id=$1 order by position, id limit 1000`, [md5uuid('my-scope:key:BIG-m4-l3')]);
      await db.query('rollback');
      const plan = r.rows.map(x => x['QUERY PLAN']).join('\n');
      fs.writeFileSync(path.join(out, `explain-blocks-${v}.txt`), plan + '\n');
      result[`explain_${v}`] = plan;
      if (v === 'new') check(/hashed SubPlan/.test(plan) && !/can_view_lesson/.test(plan) && /SubPlan \d+\n\s+->[^\n]*\(actual[^\n]*loops=1\)/.test(plan), 'EXPLAIN: the new lesson-blocks read evaluates my_visible_lessons once (hashed SubPlan, loops=1), no per-row helper');
    } finally { await db.end(); }
  }
}

// A2a-01: past 500 content items per 50 lessons (11 per lesson) the old page refused the whole course with "unavailable"; the new page shows it.
async function tooLarge() {
  for (const d of [OLD, NEW]) { const c = await connect(d); try { await c.query(`insert into public.lesson_blocks(lesson_id,block_type,position,content) select l.id,'text',10,'{"text":"One more"}' from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=$1`, [BIG]); } finally { await c.end(); } }
  const seg = md5uuid('my-scope:key:BIG-m0-l0-p0');
  const o = await (async () => { const db = await connect(OLD); try { const client = restClient(db, 'seed5'); const code = codeFor('old', client, { id: '10000000-0000-0000-0000-000000000005', backend: 'firebase' }); return settle(async () => oldLessonPage(code, await code.lessons.learningService(BIG), BIG, seg, BIGa)); } finally { await db.end(); } })();
  const n = await (async () => { const db = await connect(NEW); try { const client = restClient(db, 'seed5'); const code = codeFor('new', client, { id: '10000000-0000-0000-0000-000000000005', backend: 'firebase' }); return settle(async () => code.page.studentLessonPage(await code.lessons.learningService(BIG), BIG, seg, BIGa)); } finally { await db.end(); } })();
  check(o.error === 413 && n.ok?.kind === 'page' && n.ok.tabs.lessonBlocks.length === 11, 'A2a-01: with 660 items in 60 lessons the old page failed with 413 (shown as "unpublished or expired"); the new page shows the lesson with its 11 items', { old: o.error ?? 'page', new: n.ok?.tabs?.lessonBlocks?.length ?? n.error });
}

// The caller on one connection: consecutive transactions as different people each get their own rows; nothing carries over.
async function isolation() {
  const db = await connect(NEW);
  try {
    const ids = async (label, extra) => { await db.query('begin'); await db.query('set local role authenticated'); if (label !== 'none') await db.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]);
      if (extra) await db.query(extra); const r = (await db.query('select coalesce(array_agg(id order by id),\'{}\') ids from public.courses')).rows[0].ids; await db.query('commit'); return r; };
    const owner = await ids('owner'), student = await ids('st_active'), none = await ids('none'), owner2 = await ids('owner'), student2 = await ids('st_active');
    check(owner.length === 3 && json(student) === json([md5uuid('my-scope:key:C1')]) && none.length === 0 && json(owner2) === json(owner) && json(student2) === json(student),
      'one connection, consecutive transactions: owner, student, no token, owner, student each get exactly their own rows');
    const leftover = (await db.query("select coalesce(current_setting('request.jwt.claims',true),'') v")).rows[0].v;
    check(leftover === '', 'the token setting is transaction-local: nothing is left on the connection after commit');
    const forged = await ids('st_active', `select set_config('request.jwt.claim.sub','my-scope-owner',true), set_config('my_scope.caller','${md5uuid('my-scope:person:owner')}',true)`);
    check(json(forged) === json(student), 'forged caller settings next to a student token change nothing');
    await db.query(`select set_config('my_scope.caller','${md5uuid('my-scope:person:owner')}',false)`);
    check((await ids('none')).length === 0 && json(await ids('st_active')) === json(student), 'a session-level setting a client might leave behind changes nothing either');
  } finally { await db.end(); }
}

(async () => {
  const t0 = Date.now();
  const only = process.env.MY_SCOPE_ONLY ? process.env.MY_SCOPE_ONLY.split(',') : null;
  const step = async (name, fn) => { if (only && !only.includes(name)) return; const t = Date.now(); log(`--- ${name}`); await fn(); log(`--- ${name} done in ${Math.round((Date.now() - t) / 1000)} s`); };
  if (!process.env.MY_SCOPE_REUSE) await buildFixture();
  await step('apply', applyCheck);
  await step('isolation', isolation);
  await step('rows', rowSets);
  await step('server', serverOutputs);
  await step('explain', explainBlocks);
  await step('timings', timingsAll);
  await step('too-large', tooLarge);
  result.seconds = Math.round((Date.now() - t0) / 1000);
  const file = path.join(out, `result-${only ? only.join('+') : 'all'}${process.env.MY_SCOPE_PART ? '-' + process.env.MY_SCOPE_PART.replace('/', 'of') : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 1) + '\n');
  log(`${result.checks.filter(c => c.ok).length}/${result.checks.length} checks passed, ${result.differences.length} differences, ${result.seconds} s. Result: ${file}`);
  if (result.differences.length) { log(JSON.stringify(result.differences.slice(0, 20), null, 1)); process.exitCode = 1; }
  if (!process.env.MY_SCOPE_KEEP) for (const d of [OLD, NEW]) await admin(`drop database if exists ${d} with (force)`);
})().catch(e => { console.error(e); process.exit(1); });
