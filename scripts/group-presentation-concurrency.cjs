// Runs only against the fresh disposable localhost harness database.
const assert=require('node:assert/strict');
module.exports=async(makeClient,admin)=>{
 const clients=[];
 async function actor(){const c=await makeClient();clients.push(c);c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;c.begin=async()=>{await c.query('begin');await c.query("set local lock_timeout='5s'");await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({iss:'https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',sub:'10000000-0000-0000-0000-000000000002'})]);};return c;}
 const command=async(c,id,version,data)=>(await c.query("select public.group_command($1,$2,$3,$4) value",[id,id?'edit':'create',version,data])).rows[0].value;
 async function blocked(c){for(let i=0;i<200;i++){if((await admin.query('select cardinality(pg_blocking_pids($1)) n',[c.pid])).rows[0].n)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected lock wait');}
 try{
  const a=await actor(),b=await actor();await a.begin();const group=await command(a,null,null,{offeringId:'60000000-0000-0000-0000-000000000001',name:'M3 concurrency fixture',mode:'online',joinUrl:'https://meet.jit.si/old',schedules:[{weekday:2,time:'18:00',durationMinutes:60}]});await a.query('commit');
  const digest=async()=>(await admin.query('select md5(jsonb_agg(to_jsonb(s) order by id)::text) digest from public.group_sessions s where group_id=$1',[group.id])).rows[0].digest;
  const before=await digest();await a.begin();await b.begin();await command(a,group.id,1,{streamLabel:'Winner',streamIcon:'radio'});const pending=command(b,group.id,1,{schedules:[]}).then(()=>null,e=>e.code);await blocked(b);await a.query('commit');assert.equal(await pending,'PT409');await b.query('rollback');assert.equal(await digest(),before);console.log('PASS presentation race: bubble winner rejects stale recurrence clear and preserves snapshots');
  await a.begin();await b.begin();await command(a,group.id,2,{joinUrl:'https://meet.jit.si/new',applyMeetingDefaults:true});const pending2=command(b,group.id,2,{streamLabel:'Stale'}).then(()=>null,e=>e.code);await blocked(b);await a.query('commit');assert.equal(await pending2,'PT409');await b.query('rollback');assert.equal((await admin.query("select bool_and(join_url='https://meet.jit.si/new') ok from public.group_sessions where group_id=$1",[group.id])).rows[0].ok,true);console.log('PASS presentation race: explicit future defaults serialize with stale bubble edits');
  const after=await digest();await a.begin();await command(a,group.id,3,{joinUrl:'https://meet.jit.si/new',applyMeetingDefaults:true});await a.query('commit');assert.equal(await digest(),after);console.log('PASS presentation concurrency: repeated unchanged defaults preserve session versions');
 }finally{for(const c of clients)try{await c.query('rollback');await c.end();}catch{}}
};
