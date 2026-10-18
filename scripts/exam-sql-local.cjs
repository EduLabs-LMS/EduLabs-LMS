// Fresh in-memory PostgreSQL. No network connection or environment credentials.
// Install the pinned optional runtime outside the application dependencies:
// npm install --prefix .local/step03a/runtime --save-exact @electric-sql/pglite@0.5.8
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const runtime = process.env.LMS_SQL_RUNTIME || path.resolve('.local/step03a/runtime/node_modules');

(async () => {
 let db,admin,database,makeClient;
 if(process.argv.includes('--postgres')) {
  const {Client}=require(path.join(runtime,'pg'));
  const port=Number(fs.readFileSync('.local/step03a/pg-port.txt','utf8').trim());
  assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
  const options={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
  admin=new Client(options);await admin.connect();
  database='edulabs_step03a_'+randomUUID().replaceAll('-','');
  assert.match(database,/^edulabs_step03a_[a-f0-9]{32}$/);
  await admin.query(`create database ${database}`);
  makeClient=async()=>{const c=new Client({...options,database});await c.connect();return c;};
  const c=await makeClient();
  db={exec:async sql=>{const r=await c.query(sql);return Array.isArray(r)?r:[r];},query:(...args)=>c.query(...args),close:()=>c.end()};
 } else {
  const {PGlite}=require(path.join(runtime,'@electric-sql/pglite'));
  db=new PGlite();
 }
 try {
  let bootstrap=fs.readFileSync('supabase/tests/local-bootstrap.sql','utf8');
  if(admin) bootstrap=bootstrap.replace(/create role (\w+) ([^;]+);/g,(_,role,flags)=>`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role} ${flags}; end if; end $$;`);
  await db.exec(bootstrap);
  let seeded=false;
  for (const name of fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()) {
   if(name.endsWith('_complete_lesson_workflows.sql')&&!process.argv.includes('--fresh-install')){await db.exec(fs.readFileSync('supabase/seed.sql','utf8'));seeded=true;}
   let preservation;
   if(name.endsWith('_complete_homework_workflows.sql')||name.endsWith('_complete_group_attendance_workflows.sql')||name.endsWith('_complete_notifications_support_workflows.sql')||name.endsWith('_student_administration_workflows.sql')) {
    const tables=(await db.query("select n.nspname schema,c.relname name,c.relrowsecurity rls,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth','storage') and c.relkind='r' order by 1,2")).rows;
    const functions=(await db.query("select n.nspname schema,p.proname name,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1,3")).rows;
    const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
    const rows=[];
    for(const table of tables){const from='"'+table.schema+'"."'+table.name+'"';rows.push((await db.query(`select coalesce(md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text),'empty') digest from ${from} t`)).rows[0].digest);}
    preservation={tables,functions,policies,rows};
   }
   try { await db.exec(fs.readFileSync(path.join('supabase/migrations',name),'utf8')); }
   catch(e) { throw new Error(`Migration ${name}: ${e.message}`,{cause:e}); }
   if(preservation){
    for(let i=0;i<preservation.tables.length;i++) {const table=preservation.tables[i],from='"'+table.schema+'"."'+table.name+'"',where=name.endsWith('_complete_homework_workflows.sql')&&table.schema==='storage'&&table.name==='buckets'?" where t.id<>'lms-homework'":'';const digest=(await db.query(`select coalesce(md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text),'empty') digest from ${from} t${where}`)).rows[0].digest;assert.equal(digest,preservation.rows[i],`${name} preserves ${from} rows`);const current=(await db.query('select relrowsecurity rls,relacl::text acl from pg_class where oid=$1::regclass',[from])).rows[0];assert.equal(current.rls,table.rls);assert.equal(current.acl,table.acl);}
    for(const f of preservation.functions){const current=(await db.query('select pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0];assert.equal(current.definition,f.definition);assert.equal(current.acl,f.acl);}
    const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
    for(const policy of preservation.policies)assert.deepEqual(policies.find(p=>p.schemaname===policy.schemaname&&p.tablename===policy.tablename&&p.policyname===policy.policyname),policy);
    console.log(`PASS ${name} preservation: ${preservation.tables.length} existing tables/data/grants, ${preservation.functions.length} function definitions/grants, ${preservation.policies.length} policies`);
   }
   console.log(`Replayed ${name}`);
  }
  if(!seeded)await db.exec(fs.readFileSync('supabase/seed.sql','utf8'));
  const baseline = (await db.query('select count(*)::int n from public.assessment_attempts')).rows[0].n;
  for (const name of ['authorization','hardening','firebase-identity','organization-owner-cascade','organization-provisioning','teacher-editor','exam-attempts-results','exam-authoring','exam-completion','lessons','homework','groups-attendance','notifications-support','group-notifications','student-administration','lesson-covers']) {
   let sql=fs.readFileSync(`supabase/tests/${name}.sql`,'utf8');
   try {
    const results=await db.exec(sql);
    console.log(`PASS ${name}`,JSON.stringify(results.flatMap(r=>r.rows).filter(r=>r.passed!==undefined || Object.keys(r).some(k=>k.endsWith('_tests')||k.endsWith('_results')))));
   } catch(e) { throw new Error(`Suite ${name}: ${e.message}`,{cause:e}); }
   assert.equal((await db.query('select count(*)::int n from public.assessment_attempts')).rows[0].n,baseline,`${name} rolled back`);
  }
  if(admin) {await require('./exam-concurrency.cjs')(makeClient,db);await require('./lesson-concurrency.cjs')(makeClient,db);await require('./homework-concurrency.cjs')(makeClient,db);await require('./group-concurrency.cjs')(makeClient,db);await require('./communications-concurrency.cjs')(makeClient,db);await require('./group-notification-concurrency.cjs')(makeClient,db);await require('./student-administration-concurrency.cjs')(makeClient,db);}
  if(admin && process.argv.includes('--timers')) await require('./exam-deadline.cjs')(makeClient,db);
  console.log('All local SQL suites passed. No connected Supabase database accessed.');
 } finally {
  await db.close();
  if(admin) {await admin.query(`drop database ${database}`);await admin.end();}
 }
})().catch(e=>{console.error(e.message); if(e.cause?.where) console.error(e.cause.where); process.exitCode=1;});
