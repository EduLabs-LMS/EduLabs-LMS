// Fresh in-memory PostgreSQL, or the disposable localhost PostgreSQL (--postgres). No network connection or environment credentials.
// Install the pinned optional runtime outside the application dependencies:
// npm install --prefix .local/step03a/runtime --save-exact @electric-sql/pglite@0.5.8
//
// --postgres (the fast runner):
//  - The migrated, seeded database is built ONCE into a template database named by a hash of every input (local-bootstrap.sql, every
//    migration, seed.sql, the course-content rewrite fixtures and this file). The preservation fingerprints and the course-content
//    rewrite checks run only while it is built. It is NOT analyzed: with fresh statistics of the small seeded tables the planner
//    picks per-row plans that listing-performance (the old listing functions it compares) runs ~4x slower once the suite adds its rows;
//    the old sequential run hit the same state after autovacuum analyzed the tables the earlier, rolled-back suites had churned. The
//    check results are kept in the template's comment and printed on later runs. A changed
//    input changes the hash and rebuilds automatically; --rebuild forces it. Older templates are dropped.
//  - Every SQL suite and every race / screen-SQL script runs in its OWN database cloned from the template (CREATE DATABASE ... TEMPLATE),
//    in parallel: LMS_SQL_JOBS (default min(4, CPU cores - 1)), within the server's connection limit (a race script counts its connections).
//    Each suite is still checked to have rolled back. Each job's time and the total are printed at the end.
//  - LMS_SQL_ONLY=a,b selects those SQL suites AND the race and screen-SQL scripts mapped to them (RACE_SUITES below); a script name
//    may also be given directly. LMS_SQL_RACES=0 skips races. With no filter everything runs, as before.
// Benchmarks (--bench, --bench-only, --bench-attendance, --bench-listing) and the in-memory runtime keep the sequential single-database run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');

const SUITES = ['authorization','hardening','firebase-identity','organization-owner-cascade','organization-provisioning','teacher-editor','exam-attempts-results','exam-authoring','exam-completion','lessons','homework','groups-attendance','group-course-run','notifications-support','group-notifications','student-administration','lesson-covers','chapter-metadata','group-presentation-summary','account-profiles','academic-programs-stages','teacher-websites','website-domains','settings','platform-admin-provisioning','teacher-invitation-delivery','demo-clear-robust','demo-students','demo-notifications','demo-students-screen','group-summary-performance','listing-performance','teaching-space-name','course-content-tree','homework-rules','homework-reads','demo-homework','lesson-publish','homework-move','homework-correct','exams','exams-demo','exams-student','demo-seed-8'];
const RACES = ['website-concurrency','domain-concurrency','academic-programs-concurrency','account-concurrency','milestone2-concurrency','group-presentation-concurrency','exam-concurrency','lesson-concurrency','homework-concurrency','homework-rules-concurrency','group-concurrency','communications-concurrency','group-notification-concurrency','student-administration-concurrency','teacher-invitation-concurrency','course-content-concurrency','lesson-publish-concurrency','homework-move-concurrency','exams-concurrency','teacher-homework-sql','course-content-screen-sql'];
// Which SQL suites a race or screen-SQL script belongs to (a trailing * matches a prefix). A filtered run takes a script when any
// selected suite matches.
const RACE_SUITES = {
 'website-concurrency':['teacher-websites'],'domain-concurrency':['website-domains','teacher-websites'],'academic-programs-concurrency':['academic-programs-stages'],
 'account-concurrency':['account-profiles','settings'],'milestone2-concurrency':['lessons','lesson-covers','chapter-metadata','teacher-editor'],
 'group-presentation-concurrency':['group-presentation-summary'],'exam-concurrency':['exam-attempts-results','exam-authoring','exam-completion'],
 'lesson-concurrency':['lessons','lesson-covers','chapter-metadata'],'homework-concurrency':['homework*','demo-homework'],'homework-rules-concurrency':['homework*','demo-homework'],
 'group-concurrency':['groups-attendance','group-course-run','group-summary-performance'],'communications-concurrency':['notifications-support'],
 'group-notification-concurrency':['group-notifications','notifications-support'],'student-administration-concurrency':['student-administration'],
 'teacher-invitation-concurrency':['teacher-invitation-delivery','platform-admin-provisioning'],'course-content-concurrency':['course-content-tree'],
 'lesson-publish-concurrency':['lesson-publish'],'homework-move-concurrency':['homework*'],'exams-concurrency':['exams','exams-demo'],
 'teacher-homework-sql':['homework*'],'course-content-screen-sql':['course-content-tree'],'exam-deadline':['exam-attempts-results','exam-completion'],
};
// A script that needs another script's fixtures runs right after it, in the same clone (one job).
const RACE_AFTER = {'domain-concurrency':'website-concurrency'};
// Peak connections a script opens (measured; unknown scripts count as 14). A SQL suite counts 2 (its clone and the create/drop).
const RACE_CONNECTIONS = {};
const flag = n => process.argv.includes(n);
const BENCH = ['--bench','--bench-only','--bench-attendance','--bench-listing'].some(flag);

// The migrations replayed from zero, with the preservation fingerprints and the course-content rewrite checks. Used by the in-memory
// run and the sequential benchmark run, and to build the template.
async function replay(db, log) {
 let bootstrap=fs.readFileSync('supabase/tests/local-bootstrap.sql','utf8');
 if(db.postgres) bootstrap=bootstrap.replace(/create role (\w+) ([^;]+);/g,(_,role,flags)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${flags}; end if; end $$;`);
 await db.exec(bootstrap);
 let seeded=false;
 for (const name of fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()) {
  if(name.endsWith('_complete_lesson_workflows.sql')&&!flag('--fresh-install')){await db.exec(fs.readFileSync('supabase/seed.sql','utf8'));seeded=true;}
  let preservation;
  if(name.endsWith('_complete_homework_workflows.sql')||name.endsWith('_complete_group_attendance_workflows.sql')||name.endsWith('_complete_notifications_support_workflows.sql')||name.endsWith('_student_administration_workflows.sql')||name.endsWith('_group_presentation_and_session_summary.sql')||name.endsWith('_account_profiles_private_avatars.sql')||name.endsWith('_academic_programs_stages.sql')||name.endsWith('_teacher_websites_public_catalogs.sql')) {
   const tables=(await db.query("select n.nspname schema,c.relname name,c.relrowsecurity rls,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage') and c.relkind='r' order by 1,2")).rows;
   const functions=(await db.query("select n.nspname schema,p.proname name,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1,3")).rows;
   const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
   const rows=[];
   for(const table of tables){const from='"'+table.schema+'"."'+table.name+'"';rows.push((await db.query(`select coalesce(md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text),'empty') digest from ${from} t`)).rows[0].digest);}
   preservation={tables,functions,policies,rows};
  }
  const contentRewrite=name.endsWith('_course_content_tree.sql');
  if(contentRewrite)await db.exec(fs.readFileSync('supabase/tests/course-content-rewrite-before.sql','utf8'));
  try { await db.exec(fs.readFileSync(path.join('supabase/migrations',name),'utf8')); }
  catch(e) { throw new Error(`Migration ${name}: ${e.message}`,{cause:e}); }
  if(contentRewrite){const results=await db.exec(fs.readFileSync('supabase/tests/course-content-rewrite-after.sql','utf8'));log('PASS course-content-rewrite '+JSON.stringify(results.flatMap(r=>r.rows).filter(r=>r.course_content_rewrite_tests!==undefined)));}
  if(preservation){
   for(let i=0;i<preservation.tables.length;i++) {const table=preservation.tables[i],from='"'+table.schema+'"."'+table.name+'"',where=name.endsWith('_teacher_websites_public_catalogs.sql')&&table.schema==='storage'&&table.name==='buckets'?" where t.id<>'lms-website-assets'":name.endsWith('_complete_homework_workflows.sql')&&table.schema==='storage'&&table.name==='buckets'?" where t.id<>'lms-homework'":name.endsWith('_account_profiles_private_avatars.sql')&&table.schema==='storage'&&table.name==='buckets'?" where t.id<>'lms-avatars'":'';const digest=(await db.query(`select coalesce(md5(jsonb_agg(${name.endsWith('_group_presentation_and_session_summary.sql')&&table.schema==='public'&&table.name==='study_groups'?"to_jsonb(t)-'stream_label'-'stream_icon'":'to_jsonb(t)'} order by ${name.endsWith('_group_presentation_and_session_summary.sql')&&table.schema==='public'&&table.name==='study_groups'?"to_jsonb(t)-'stream_label'-'stream_icon'":'to_jsonb(t)'}::text)::text),'empty') digest from ${from} t${where}`)).rows[0].digest;assert.equal(digest,preservation.rows[i],`${name} preserves ${from} rows`);const current=(await db.query('select relrowsecurity rls,relacl::text acl from pg_class where oid=$1::regclass',[from])).rows[0];assert.equal(current.rls,table.rls);assert.equal(current.acl,table.acl);}
   for(const f of preservation.functions){const current=(await db.query('select pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0];if(!(name.endsWith('_group_presentation_and_session_summary.sql')&&f.schema==='private'&&['group_command','group_view','notification_business_event'].includes(f.name)))assert.equal(current.definition,f.definition);assert.equal(current.acl,f.acl);}
   const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
   for(const policy of preservation.policies)assert.deepEqual(policies.find(p=>p.schemaname===policy.schemaname&&p.tablename===policy.tablename&&p.policyname===policy.policyname),policy);
   log(`PASS ${name} preservation: ${preservation.tables.length} existing tables/data/grants, ${preservation.functions.length} function definitions/grants, ${preservation.policies.length} policies`);
  }
  log(`Replayed ${name}`);
 }
 if(!seeded)await db.exec(fs.readFileSync('supabase/seed.sql','utf8'));
}

// One SQL suite on db; checks it rolled back.
async function runSuite(db, name, log) {
 const baseline = (await db.query('select count(*)::int n from public.assessment_attempts')).rows[0].n;
 try {
  const results=await db.exec(fs.readFileSync(`supabase/tests/${name}.sql`,'utf8'));
  log(`PASS ${name} `+JSON.stringify(results.flatMap(r=>r.rows).filter(r=>r.passed!==undefined || Object.keys(r).some(k=>k.endsWith('_tests')||k.endsWith('_results')))));
 } catch(e) { throw new Error(`Suite ${name}: ${e.message}`,{cause:e}); }
 assert.equal((await db.query('select count(*)::int n from public.assessment_attempts')).rows[0].n,baseline,`${name} rolled back`);
}

function pgSetup() {
 const {Client}=require(path.join(runtime,'pg'));
 const port=Number(fs.readFileSync('.local/step03a/pg-port.txt','utf8').trim());
 assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
 return {Client,options:{host:'127.0.0.1',port,user:'postgres',database:'postgres'}};
}
const wrap = c => ({postgres:true,exec:async sql=>{const r=await c.query(sql);return Array.isArray(r)?r:[r];},query:(...args)=>c.query(...args),close:()=>c.end()});

// The sequential run: in-memory PGlite, or one localhost database for the benchmarks.
async function sequential() {
 let db,admin,database,makeClient;
 if(flag('--postgres')) {
  const {Client,options}=pgSetup();
  admin=new Client(options);await admin.connect();
  database='edulabs_step03a_'+randomUUID().replaceAll('-','');
  assert.match(database,/^edulabs_step03a_[a-f0-9]{32}$/);
  await admin.query(`create database ${database}`);
  makeClient=async()=>{const c=new Client({...options,database});await c.connect();return c;};
  db=wrap(await makeClient());
 } else {
  const {PGlite}=require(path.join(runtime,'@electric-sql/pglite'));
  db=new PGlite();
 }
 try {
  await replay(db, s=>console.log(s));
  for (const name of flag('--bench-only')||flag('--bench-attendance')||flag('--bench-listing')?[]:SUITES.filter(n=>!process.env.LMS_SQL_ONLY||process.env.LMS_SQL_ONLY.split(',').includes(n))) await runSuite(db,name,s=>console.log(s));
  if((flag('--bench')||flag('--bench-only'))&&!flag('--bench-attendance')){const results=await db.exec(fs.readFileSync('supabase/tests/group-summary-performance-benchmark.sql','utf8'));console.log('BENCH group-summary-performance',JSON.stringify(results.flatMap(r=>r.rows).filter(r=>Object.keys(r).some(k=>k.startsWith('gsp_')))));}
  if((flag('--bench')||flag('--bench-only')||flag('--bench-listing'))&&!flag('--bench-attendance')){const results=await db.exec(fs.readFileSync('supabase/tests/listing-performance-benchmark.sql','utf8'));console.log('BENCH listing-performance',JSON.stringify(results.flatMap(r=>r.rows).filter(r=>Object.keys(r).some(k=>k.startsWith('lpb_')))));}
  if(flag('--bench')||flag('--bench-only')||flag('--bench-attendance')){const base=fs.readFileSync('supabase/tests/groups-attendance.sql','utf8').split('\n'),cut=base.findIndex(l=>l.includes("set_config('ga.bulk_session'"));const results=await db.exec(base.slice(0,cut+1).join('\n')+'\n'+fs.readFileSync('supabase/tests/group-attendance-save-benchmark.sql','utf8'));console.log('BENCH group-attendance-save',JSON.stringify(results.flatMap(r=>r.rows).filter(r=>Object.keys(r).some(k=>k.startsWith('gas_')))));}
  if(admin) for(const script of RACES) await require(`./${script}.cjs`)(makeClient,db);
  if(admin && flag('--timers')) await require('./exam-deadline.cjs')(makeClient,db);
  console.log('All local SQL suites passed. No connected Supabase database accessed.');
 } finally {
  await db.close();
  if(admin) {await admin.query(`drop database ${database}`);await admin.end();}
 }
}

// The template's name: a hash of every input of the migrated, seeded database.
function templateName() {
 const h=createHash('sha256');
 const files=['supabase/tests/local-bootstrap.sql','supabase/seed.sql','supabase/tests/course-content-rewrite-before.sql','supabase/tests/course-content-rewrite-after.sql',__filename,
  ...fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort().map(n=>path.join('supabase/migrations',n))];
 for(const f of files){h.update(path.basename(f)+'\0');h.update(fs.readFileSync(f));h.update('\0');}
 h.update(flag('--fresh-install')?'fresh':'seeded');
 return 'edulabs_tmpl_'+h.digest('hex').slice(0,24);
}

async function ensureTemplate(Client, options, admin) {
 const name=templateName();
 await admin.query("select pg_advisory_lock(hashtextextended('edulabs-sql-template',0))");
 try {
  const exists=(await admin.query('select shobj_description(oid,\'pg_database\') note from pg_database where datname=$1',[name])).rows[0];
  if(exists&&!flag('--rebuild')) return {name,built:false,note:JSON.parse(exists.note||'{}')};
  if(exists) await admin.query(`drop database ${name}`);
  const build='edulabs_tmplbuild_'+randomUUID().replaceAll('-','').slice(0,16);
  await admin.query(`create database ${build}`);
  const lines=[],started=Date.now();
  const c=new Client({...options,database:build});await c.connect();
  try { await replay(wrap(c), s=>{lines.push(s);console.log(s);}); }
  catch(e) { await c.end(); await admin.query(`drop database ${build}`); throw e; }
  await c.end();
  const note={builtAt:new Date().toISOString(),seconds:Math.round((Date.now()-started)/1000),checks:lines.filter(l=>l.startsWith('PASS'))};
  await admin.query(`alter database ${build} rename to ${name}`);
  await admin.query(`comment on database ${name} is ${"'"+JSON.stringify(note).replaceAll("'","''")+"'"}`);
  return {name,built:true,note};
 } finally {
  for(const r of (await admin.query("select datname from pg_database where datname like 'edulabs\\_tmpl\\_%' and datname<>$1",[name])).rows)
   await admin.query(`drop database if exists ${r.datname} with (force)`).catch(()=>{});
  await admin.query("select pg_advisory_unlock(hashtextextended('edulabs-sql-template',0))");
 }
}

// Child process: one suite or script in its own clone of the template.
async function child() {
 const [kind,name]=process.argv[process.argv.indexOf('--job')+1].split(':');
 const template=process.argv[process.argv.indexOf('--template')+1], database=process.argv[process.argv.indexOf('--database')+1];
 assert.match(template,/^edulabs_tmpl_[a-f0-9]{24}$/); assert.match(database,/^edulabs_job_[a-f0-9]{8}_[0-9]+$/);
 const {Client,options}=pgSetup();
 const top=new Client(options);await top.connect();await top.query(`create database ${database} template ${template}`);await top.end();
 let open=1,peak=1;
 const makeClient=async()=>{const c=new Client({...options,database});await c.connect();open++;peak=Math.max(peak,open);const end=c.end.bind(c);c.end=async(...a)=>{open--;return end(...a);};return c;};
 const c=new Client({...options,database});await c.connect();const db=wrap(c);
 try {
  if(kind==='suite') await runSuite(db,name,s=>console.log(s));
  else for(const script of name.split('+')) await require(`./${script}.cjs`)(makeClient,db);
  console.log(`CONNECTIONS ${peak}`);
 } finally {
  await c.end().catch(()=>{});
  const bottom=new Client(options);await bottom.connect();await bottom.query(`drop database if exists ${database} with (force)`);await bottom.end();
 }
}

function matches(script, selected) {
 return (RACE_SUITES[script]||[]).some(p=>p.endsWith('*')?selected.some(s=>s.startsWith(p.slice(0,-1))):selected.includes(p));
}

async function parallel() {
 const started=Date.now();
 const {Client,options}=pgSetup();
 const admin=new Client(options);await admin.connect();
 const run=randomUUID().replaceAll('-','').slice(0,8);
 const only=process.env.LMS_SQL_ONLY?process.env.LMS_SQL_ONLY.split(',').map(s=>s.trim()).filter(Boolean):null;
 const allScripts=[...RACES,...(flag('--timers')?['exam-deadline']:[])];
 if(only){const unknown=only.filter(n=>!SUITES.includes(n)&&!allScripts.includes(n));if(unknown.length)throw new Error('LMS_SQL_ONLY names no suite or script: '+unknown.join(', '));}
 const suites=only?SUITES.filter(n=>only.includes(n)):SUITES;
 const picked=process.env.LMS_SQL_RACES==='0'?[]:only?allScripts.filter(n=>only.includes(n)||matches(n,only)):allScripts;
 // Group a script with the one whose fixtures it needs (that one runs first even when only the later one was selected).
 const scripts=[];
 for(const n of allScripts){
  if(RACE_AFTER[n])continue;
  const chain=[n,...Object.keys(RACE_AFTER).filter(k=>RACE_AFTER[k]===n)];
  const want=chain.filter(x=>picked.includes(x));
  if(want.length)scripts.push(want.length===1&&want[0]===n?n:[n,...want.filter(x=>x!==n)].join('+'));
 }
 const timingsFile='.local/step03a/sql-timings.json';
 let timings={};try{timings=JSON.parse(fs.readFileSync(timingsFile,'utf8'));}catch{}
 const tmpl=await ensureTemplate(Client,options,admin);
 if(!tmpl.built){
  console.log(`Template ${tmpl.name} is current (built ${tmpl.note.builtAt||'earlier'}; --rebuild forces a new one). Checks that passed when it was built:`);
  for(const l of tmpl.note.checks||[]) console.log('  '+l);
 } else console.log(`Built template ${tmpl.name} in ${tmpl.note.seconds}s.`);
 const limits=(await admin.query("select current_setting('max_connections')::int m,current_setting('superuser_reserved_connections')::int r")).rows[0];
 const budget=Math.max(4,limits.m-limits.r-3);
 const jobs=Math.max(1,Number(process.env.LMS_SQL_JOBS)||Math.min(4,os.cpus().length-1));
 const queue=[...suites.map(n=>({kind:'suite',name:n,weight:2})),...scripts.map(n=>({kind:'race',name:n,weight:Math.min(budget,(timings[`race:${n}:connections`]||RACE_CONNECTIONS[n]||14)+1)}))]
  .map(j=>({...j,est:timings[`${j.kind}:${j.name}`]??(j.name==='listing-performance'?240:30)})).sort((a,b)=>b.est-a.est);
 console.log(`Running ${suites.length} SQL suites and ${scripts.length} race/screen scripts, each in its own clone, ${jobs} at a time within ${budget} connections.`);
 const results=[];let running=0,used=0,n=0;
 await new Promise(resolve=>{
  const next=()=>{
   while(running<jobs&&queue.length){
    const i=queue.findIndex(j=>used+j.weight<=budget);
    if(i<0)break;
    const job=queue.splice(i,1)[0];running++;used+=job.weight;
    const database=`edulabs_job_${run}_${n++}`,t0=Date.now();let out='';
    const p=spawn(process.execPath,[__filename,'--job',`${job.kind}:${job.name}`,'--template',tmpl.name,'--database',database],{env:process.env,stdio:['ignore','pipe','pipe']});
    p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);
    p.on('close',code=>{
     running--;used-=job.weight;
     const seconds=(Date.now()-t0)/1000,conn=/CONNECTIONS (\d+)/.exec(out);
     const lines=out.split(/\r?\n/).filter(l=>l&&!l.startsWith('CONNECTIONS '));
     results.push({...job,seconds,ok:code===0,connections:conn?Number(conn[1]):null});
     console.log(`${code===0?'---':'FAIL'} ${job.kind} ${job.name} (${seconds.toFixed(1)}s)`);for(const l of lines)console.log(l);
     if(!queue.length&&!running)resolve();else next();
    });
   }
   if(!queue.length&&!running)resolve();
  };
  next();
 });
 for(const r of (await admin.query("select datname from pg_database where datname like $1",[`edulabs_job_${run}_%`])).rows) await admin.query(`drop database if exists ${r.datname} with (force)`).catch(()=>{});
 await admin.end();
 for(const r of results) if(r.ok){timings[`${r.kind}:${r.name}`]=Math.round(r.seconds);if(r.kind==='race'&&r.connections)timings[`race:${r.name}:connections`]=r.connections;}
 try{fs.writeFileSync(timingsFile,JSON.stringify(timings,null,1));}catch{}
 const total=(Date.now()-started)/1000,failed=results.filter(r=>!r.ok);
 console.log('\nTimes (seconds):');
 for(const r of [...results].sort((a,b)=>b.seconds-a.seconds)) console.log(`  ${r.seconds.toFixed(1).padStart(7)}  ${r.kind==='suite'?'suite':'race '} ${r.name}${r.ok?'':'  FAILED'}`);
 console.log(`Total ${total.toFixed(1)}s wall clock (${results.reduce((a,r)=>a+r.seconds,0).toFixed(0)}s of jobs; template ${tmpl.built?'built':'reused'}).`);
 if(failed.length){console.error(`${failed.length} failed: ${failed.map(r=>r.name).join(', ')}`);process.exitCode=1;return;}
 console.log('All local SQL suites passed. No connected Supabase database accessed.');
}

(flag('--job')?child():flag('--postgres')&&!BENCH?parallel():sequential())
 .catch(e=>{console.error(e.message); if(e.cause?.where) console.error(e.cause.where); process.exitCode=1;});
