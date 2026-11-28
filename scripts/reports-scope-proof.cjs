#!/usr/bin/env node
// Fix track 2c (reports read only what they show: A8-02, A8-04) proof: OLD report functions vs NEW on identical rows, every read compared as
// JSON, and the before -> after timings with the hosted limit (statement_timeout 8 s), a fresh connection per call, median of 3 (Part 8's method).
//   node scripts/exam-sql-local.cjs --postgres        (once: builds the migrated template)
//   node scripts/reports-scope-proof.cjs               (every step; or REPORTS_ONLY=build,apply,equiv,time)
// REPORTS_REUSE=1 skips the build; REPORTS_KEEP=1 keeps the databases; REPORTS_SCHOOLS=A,B limits equiv to those schools; REPORTS_PART=k/n
// takes a slice of the callers in equiv. Each step fits the 10-minute foreground limit when equiv is run one school (or one part) at a time.
// Disposable local PostgreSQL only (the runner's loopback port). Synthetic people only. It never reads a Supabase URL or a credential.
//  1. build: rs2c_new = a clone of the template (every migration). Fixtures: supabase/tests/reports-scope.sql's fixture (a demo fill, a platform
//     administrator, a person with no space) and its school builder at Part 8's sizes:
//       A   1 teacher, 3 Groups x 30, 72 sessions, 40 homework, 8 exams, one year (the stated size)
//       T20 20 teachers, each with that (Part 8's "20 teachers", 130k attendance rows);  T50 50 teachers
//       B   1 run, 10 Groups x 200, 72 / 40 / 8 (the big school);  C the same with 3 years: 216 / 120 / 24 (the big old school)
//     rs2c_old = a clone, then supabase/tests/reports-scope-before.sql (the ten functions exactly as 20261117120000 defines them; checked here).
//  2. apply: the migration on a clone of the old database (twice): counts unchanged, catalog equal to a full replay.
//  3. equiv: report_group (4 ranges), report_student (4 ranges), report_course (4 ranges), report_attention (all courses and run 1, pages),
//     report_groups (25 per call joined back vs the old single read of up to 100) for owner, admin, teacher, assistant with and without a Group,
//     course editor, course assistant, a student and another space's owner.  4. time: the before -> after table.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');
const { Client } = require(path.join(runtime, 'pg'));
const port = Number(fs.readFileSync('.local/step03a/pg-port.txt', 'utf8').trim());
const base = { host: '127.0.0.1', port, user: 'postgres' };
const OLD = 'rs2c_old', NEW = 'rs2c_new', APPLY = 'rs2c_apply';
const MIGRATION = 'supabase/migrations/20261128130000_reports_scope.sql', BEFORE = 'supabase/tests/reports-scope-before.sql';
const out = path.resolve('.local/reports-proof'); fs.mkdirSync(out, { recursive: true });
const only = process.env.REPORTS_ONLY ? process.env.REPORTS_ONLY.split(',') : null;
const result = { checks: [], differences: [], timings: [], counts: {} };
const log = (...a) => console.log(...a);
const check = (ok, label, detail) => { result.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); if (!ok) process.exitCode = 1; };
async function connect(database) { const c = new Client({ ...base, database }); await c.connect(); return c; }
async function admin(sql) { const c = await connect('postgres'); try { return await c.query(sql); } finally { await c.end(); } }

// ---------------------------------------------------------------- fixtures
const suite = fs.readFileSync('supabase/tests/reports-scope.sql', 'utf8');
const section = (a, b) => suite.slice(suite.indexOf(a), suite.indexOf(b));
const fixture = section('-- fixture-begin', '-- fixture-end'), school = section('-- school-begin', '-- school-end');
const SCHOOLS = { A: [1, 3, 30, 72, 40, 8, 252], T20: [20, 3, 30, 72, 40, 8, 252], T50: [50, 3, 30, 72, 40, 8, 252], B: [1, 10, 200, 72, 40, 8, 252], C: [1, 10, 200, 216, 120, 24, 1095] };

// The before file must be the ten functions of 20261117120000 exactly ("create" -> "create or replace").
function beforeMatchesMigration() {
  const src = fs.readFileSync('supabase/migrations/20261117120000_reports.sql', 'utf8'), file = fs.readFileSync(BEFORE, 'utf8');
  const names = ['report_sessions', 'report_homework', 'report_exams', 'report_facts', 'report_stats', 'report_groups', 'report_group', 'report_attention', 'report_student', 'report_course'];
  return names.every(n => {
    const i = src.indexOf('create function private.' + n + '(');
    const ends = [['\n$$;', 4], ['end $$;', 7]].map(([m, l]) => { const j = src.indexOf(m, i); return j === -1 ? Infinity : j + l; });
    return file.includes(src.slice(i, Math.min(...ends)).replace('create function', 'create or replace function'));
  });
}

async function build() {
  const tmpl = (await admin("select datname from pg_database where datname like 'edulabs_tmpl_%' order by oid desc limit 1")).rows[0]?.datname;
  if (!tmpl) throw new Error('No template: run node scripts/exam-sql-local.cjs --postgres first');
  for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`);
  await admin(`create database ${NEW} template ${tmpl}`);
  const c = await connect(NEW);
  try {
    assert.ok((await c.query("select to_regprocedure('private.report_exams(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)') is not null ok")).rows[0].ok, 'the template has the migration');
    const t0 = Date.now();
    await c.query(fixture); await c.query(school);
    for (const [tag, a] of Object.entries(SCHOOLS)) await c.query(`select pg_temp.school('${tag}',${a.join(',')})`);
    await c.query('analyze');
    result.fixture = (await c.query(`select (select count(*) from public.organizations) spaces,(select count(*) from public.course_offerings) runs,(select count(*) from public.study_groups) groups,
      (select count(*) from public.enrollments) enrollments,(select count(*) from public.group_sessions) sessions,(select count(*) from public.session_attendance) attendance,
      (select count(*) from public.homework_assignments) homework,(select count(*) from public.homework_submissions) hand_ins,(select count(*) from private.exams) exams,(select count(*) from private.exam_results) exam_results`)).rows[0];
    result.fixture.perSchool = (await c.query(`select z.name,count(distinct g.id) groups,count(a.*) attendance from public.organizations z join public.courses c on c.organization_id=z.id join public.course_offerings o on o.course_id=c.id
      join public.study_groups g on g.offering_id=o.id left join public.group_sessions s on s.group_id=g.id left join public.session_attendance a on a.session_id=s.id where z.name like 'School %' group by z.name order by z.name`)).rows;
    result.fixture.seconds = Math.round((Date.now() - t0) / 1000);
    log('Fixture', JSON.stringify(result.fixture));
  } finally { await c.end(); }
  await admin(`create database ${OLD} template ${NEW}`);
  const o = await connect(OLD); try { await o.query(fs.readFileSync(BEFORE, 'utf8')); await o.query('analyze'); } finally { await o.end(); }
  check(beforeMatchesMigration(), 'the old database has the ten functions exactly as 20261117120000_reports.sql defines them');
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
    check((await c.query(countsSql)).rows[0].v === before, 'the migration applies on a database with the demo fill and the large schools; every table keeps its row count', { tables: before.split(',').length });
    await c.query(migration);
    check((await c.query(countsSql)).rows[0].v === before, 'it applies a second time without error, counts unchanged');
    const a = (await c.query(catalogSql)).rows[0], b = (await n.query(catalogSql)).rows[0];
    check(a.policies === b.policies && a.functions === b.functions, 'the result has exactly the policies and functions of a full replay');
  } finally { await c.end(); await n.end(); }
  await admin(`drop database ${APPLY} with (force)`);
}

// ---------------------------------------------------------------- callers and calls
const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, sub: 'my-scope-' + label, auth_time: Math.floor(Date.now() / 1000) });
async function call(db, label, sql, params = [], noLimit = false) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]);
    await db.query(`set local statement_timeout='${noLimit ? 0 : '8s'}'`);
    try { return { v: (await db.query(sql, params)).rows[0]?.v }; } catch (e) { return { error: e.code }; }
  } finally { await db.query('rollback').catch(() => {}); }
}
function firstDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[key], b[key], at + '.' + key); if (d) return d; }
  return { at, old: JSON.stringify(a)?.slice(0, 200), new: JSON.stringify(b)?.slice(0, 200) };
}
const byGroupId = v => v && Array.isArray(v.groups) ? { ...v, groups: [...v.groups].sort((x, y) => x.groupId < y.groupId ? -1 : x.groupId > y.groupId ? 1 : 0) } : v;
async function one(db, sql, params) { return (await db.query(sql, params)).rows; }
const cairo = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
const now = new Date(), RANGES = [null, 'all', cairo(now), cairo(new Date(now.getFullYear(), now.getMonth() - 1, 15))];

async function equiv() {
  const schools = process.env.REPORTS_SCHOOLS ? process.env.REPORTS_SCHOOLS.split(',') : Object.keys(SCHOOLS);
  const [part, parts] = (process.env.REPORTS_PART || '1/1').split('/').map(Number);
  const o = await connect(OLD), n = await connect(NEW);
  try {
    for (const tag of schools) {
      const t0 = Date.now(), runs = SCHOOLS[tag][0], k = `rp2c:${tag}:`;
      const groups = (await one(n, `select g.id,g.offering_id from public.study_groups g where g.offering_id in (select md5($1||'o'||r)::uuid from generate_series(1,$2) r) order by g.name`, [k, runs]));
      const pickRuns = runs > 2 ? [1, 2, runs] : [...Array(runs).keys()].map(i => i + 1);
      const runIds = (await one(n, `select r,md5($1||'o'||r)::uuid id from generate_series(1,$2) r`, [k, runs])).reduce((m, x) => (m[x.r] = x.id, m), {});
      const shownGroups = groups.filter(g => pickRuns.some(r => runIds[r] === g.offering_id));
      const per = SCHOOLS[tag][1] * SCHOOLS[tag][2];
      const studentNs = tag === 'A' ? [...Array(per + 3).keys()].map(i => i + 1) : [1, 2, 3, 4, 5, per + 1, per + 2, per + 3, 50, 333, 777, 1234].filter(x => x <= per + 3);
      const students = (await one(n, `select e.user_id from unnest($2::int[]) x join public.enrollments e on e.id=md5($1||'e1:'||x)::uuid`, [k, studentNs])).map(r => r.user_id);
      const course1 = (await one(n, `select md5($1||'c1')::uuid id`, [k]))[0].id;
      const other = tag === 'A' ? 'B_owner' : 'A_owner';
      const callers = ['owner', 'admin', 't1', 'asst', 'asst2', 'cse', 'csa', 'student'].map(x => tag + '_' + x).concat(other).filter((_, i) => i % parts === part - 1);
      const reads = [];
      for (const g of shownGroups) for (const m of RANGES) reads.push({ kind: 'report_group ' + (m ?? '4w'), sql: 'select private.report_group($1,$2) v', params: [g.id, m] });
      for (const s of students) for (const m of RANGES) reads.push({ kind: 'report_student ' + (m ?? '4w'), sql: 'select private.report_student($1,$2,$3) v', params: [s, runIds[1], m] });
      for (const m of RANGES) reads.push({ kind: 'report_course ' + (m ?? '4w'), sql: 'select private.report_course($1,$2) v', params: [course1, m] });
      for (const [off, pages] of [[null, 3], [runIds[1], 2]]) for (let p = 0; p < pages; p++) reads.push({ kind: 'report_attention ' + (off ? 'run' : 'all'), sql: 'select private.report_attention($1,$2) v', params: [off, p] });
      let pairs = 0, answered = 0; const diffs = [], kinds = {};
      for (const label of callers) {
        for (const r of reads) {
          const a = await call(o, label, r.sql, r.params, true), b = await call(n, label, r.sql, r.params);
          pairs++; if (!a.error) answered++; kinds[r.kind] = (kinds[r.kind] || 0) + 1;
          const d = firstDiff(a, b); if (d) diffs.push({ caller: label, read: r.kind, params: r.params, ...d });
        }
        // The Groups list: the caller's own Groups (what the list shows), else every Group of the school. Old: one call of up to 100. New: 25 per call, joined.
        const sup = (await call(n, label, 'select array(select private.my_supported_offerings()) v')).v || [];
        let ids = groups.filter(g => sup.includes(g.offering_id)).map(g => g.id); if (!ids.length) ids = groups.map(g => g.id);
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const a = await call(o, label, 'select private.report_groups($1) v', [chunk], true);
          let b = null;
          for (let j = 0; j < chunk.length; j += 25) {
            const p = await call(n, label, 'select private.report_groups($1) v', [chunk.slice(j, j + 25)]);
            if (p.error) { b = p; break; }
            b = b ? { v: { ...b.v, groups: b.v.groups.concat(p.v.groups) } } : p;
          }
          pairs++; if (!a.error) answered++; kinds['report_groups 25 per call joined'] = (kinds['report_groups 25 per call joined'] || 0) + 1;
          const d = firstDiff(a.error ? a : { v: byGroupId(a.v) }, b.error ? b : { v: byGroupId(b.v) }); if (d) diffs.push({ caller: label, read: 'report_groups paged', ...d });
        }
      }
      result.differences.push(...diffs.map(d => ({ tag, ...d })));
      result.counts['equiv ' + tag + (parts > 1 ? ` ${part}/${parts}` : '')] = { pairs, answered, kinds };
      if (diffs.length) log('differing fields', JSON.stringify([...new Set(diffs.map(d => d.read + ' ' + d.at))]));
      check(diffs.length === 0, `school ${tag}${parts > 1 ? ` (callers ${part}/${parts})` : ''}: ${pairs} reads (${answered} answered, the rest refused for both), old vs new as JSON`, { differences: diffs.length, first: diffs[0], seconds: Math.round((Date.now() - t0) / 1000) });
    }
  } finally { await o.end(); await n.end(); }
}

// ---------------------------------------------------------------- timings: a fresh connection per call, hosted limit, median of 3
async function timed(version, label, caller, sql, params = []) {
  const xs = []; let error = null;
  for (let i = 0; i < 3; i++) {
    const db = await connect(version === 'old' ? OLD : NEW);
    try {
      await db.query('begin'); await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claims',$1,true)", [claims(caller)]); await db.query("set local statement_timeout='8s'");
      const t = process.hrtime.bigint();
      try { await db.query(sql, params); } catch (e) { error = e.code; }
      xs.push(Number(process.hrtime.bigint() - t) / 1e6);
      await db.query('rollback');
    } finally { await db.end(); }
    if (error === '57014') break;
  }
  xs.sort((a, b) => a - b);
  const row = { version, label, ms: Math.round(xs[Math.floor((xs.length - 1) / 2)] * 10) / 10, ...(error ? { error } : {}) };
  result.timings.push(row); log('TIME', version.padEnd(3), label.padEnd(64), String(row.ms).padStart(8), 'ms', error || '');
  return row;
}
async function pair(label, caller, sql, params) { const a = await timed('old', label, caller, sql, params), b = await timed('new', label, caller, sql, params); return [a, b]; }
async function timeStep() {
  const n = await connect(NEW); let ids;
  try {
    ids = async (tag, r) => (await one(n, `select array_agg(g.id order by g.name) v from public.study_groups g where g.offering_id ${r ? `=md5('rp2c:${tag}:o${r}')::uuid` : `in (select md5('rp2c:${tag}:o'||x)::uuid from generate_series(1,${SCHOOLS[tag][0]}) x)`}`))[0].v;
    const g1 = {}; for (const tag of Object.keys(SCHOOLS)) g1[tag] = (await ids(tag, 1))[0];
    // A8-02: one Group, Last 4 weeks and Whole course, at the four sizes; the student page and Results at the big sizes.
    for (const tag of ['A', 'T20', 'B', 'C']) for (const m of [null, 'all']) await pair(`${tag}: report_group ${m ? 'Whole course' : 'Last 4 weeks'} (teacher)`, tag + '_t1', 'select private.report_group($1,$2)', [g1[tag], m]);
    for (const tag of ['B', 'C']) for (const m of [null, 'all']) {
      await pair(`${tag}: report_student ${m ? 'Whole course' : 'Last 4 weeks'} (teacher)`, tag + '_t1', `select private.report_student(md5('rp2c:${tag}:s1:7')::uuid,md5('rp2c:${tag}:o1')::uuid,$1)`, [m]);
      await pair(`${tag}: report_course (Results) ${m ? 'Whole course' : 'Last 4 weeks'} (teacher)`, tag + '_t1', `select private.report_course(md5('rp2c:${tag}:c1')::uuid,$1)`, [m]);
    }
    // A8-04: the owner's Groups list at 60 and 100 Groups: the old single read vs 25 per call (each page and all pages), and Needs attention.
    for (const [tag, count] of [['T20', 60], ['T50', 100]]) {
      const all = (await ids(tag)).slice(0, count);
      await timed('old', `${tag}: owner report_groups, ${count} Groups in one call (old list)`, tag + '_owner', 'select private.report_groups($1)', [all]);
      await timed('new', `${tag}: owner report_groups, ${count} Groups in one call`, tag + '_owner', 'select private.report_groups($1)', [all]);
      let sum = 0; for (let i = 0; i < count; i += 25) sum += (await timed('new', `${tag}: owner report_groups, page ${i / 25 + 1} of 25`, tag + '_owner', 'select private.report_groups($1)', [all.slice(i, i + 25)])).ms;
      result.timings.push({ version: 'new', label: `${tag}: owner report_groups, all ${count} Groups at 25 per call (sum of pages)`, ms: Math.round(sum * 10) / 10 });
      log('TIME', 'new', `${tag}: owner report_groups, all ${count} at 25 per call (sum)`.padEnd(64), String(Math.round(sum)).padStart(8), 'ms');
      await timed('old', `${tag}: owner report_groups, first page of 25 (old)`, tag + '_owner', 'select private.report_groups($1)', [all.slice(0, 25)]);
      for (const who of ['owner', 't1']) await pair(`${tag}: report_attention all courses (${who === 'owner' ? 'owner' : 'teacher'})`, tag + '_' + who, 'select private.report_attention(null,0)');
    }
    // A8-04: group_view for a teacher at 1 / 20 / 50 teachers (after 2b; the same function in both databases).
    for (const tag of ['A', 'T20', 'T50']) for (const s of ['summary', 'upcoming', 'sessions']) await timed('new', `${tag}: teacher group_view(${s})`, tag + '_t1', 'select private.group_view(null,$1,0,$2)', [s, '']);
    for (const tag of ['A', 'T20', 'T50']) await timed('new', `${tag}: owner group_view(sessions)`, tag + '_owner', 'select private.group_view(null,$1,0,$2)', ['sessions', '']);
  } finally { await n.end(); }
}

(async () => {
  const steps = only || ['build', 'apply', 'equiv', 'time'];
  const t0 = Date.now();
  if (steps.includes('build') && !process.env.REPORTS_REUSE) await build();
  if (steps.includes('apply')) await applyCheck();
  if (steps.includes('equiv')) await equiv();
  if (steps.includes('time')) await timeStep();
  if (!process.env.REPORTS_KEEP) for (const d of [OLD, NEW, APPLY]) await admin(`drop database if exists ${d} with (force)`);
  const tagOf = [steps.join('+'), process.env.REPORTS_SCHOOLS, process.env.REPORTS_PART?.replace('/', 'of')].filter(Boolean).join('-');
  const file = path.join(out, `result-2c-${tagOf}.json`); fs.writeFileSync(file, JSON.stringify(result, null, 1));
  const failed = result.checks.filter(c => !c.ok).length;
  log(`${result.checks.length - failed}/${result.checks.length} checks passed, ${result.differences.length} differences, ${Math.round((Date.now() - t0) / 1000)} s. Result: ${file}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
