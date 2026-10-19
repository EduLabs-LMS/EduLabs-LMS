// Native local PostgreSQL only; invoked after existing website-concurrency fixtures.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
module.exports=async(makeClient,admin)=>{
 const clients=[],org='20000000-0000-0000-0000-000000000001';
 async function actor(role){const c=await makeClient();clients.push(c);c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;c.begin=async()=>{await c.query("begin;set local lock_timeout='5s';set local role "+role);if(role==='authenticated')await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({iss:'https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1',aud:'authenticated',role,sub:'10000000-0000-0000-0000-000000000001'})]);};return c;}
 const rev=async()=>(await admin.query('select revision from public.organization_websites where organization_id=$1',[org])).rows[0].revision;
 const cmd=async(c,action,revision,data={})=>(await c.query('select public.teacher_website_command($1,$2,$3,$4) value',[action,org,revision,data])).rows[0].value;
 const error=p=>p.then(()=>null,e=>e.code);
 async function blocked(c){for(let n=0;n<300;n++){if((await admin.query('select cardinality(pg_blocking_pids($1)) n',[c.pid])).rows[0].n)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected domain lock wait');}
 const review=(worker,d,certificateReady)=>worker.query('select public.review_website_resource($1,$2,$3,true,$4,$5)',['domain',d.id,d.revision,'synthetic-domain-race',{challenge:d.challenge,certificateReady}]);
 const read=async id=>{const d=(await admin.query('select * from public.organization_website_domains where id=$1',[id])).rows[0];return {...d,revision:Number(d.revision)};};
 try{
  const a=await actor('authenticated'),b=await actor('authenticated'),worker=await actor('service_role');let r=await rev();
  await a.begin();await b.begin();const d=(await cmd(a,'domain.claim',r,{hostname:'domain-race-'+randomUUID().replaceAll('-','')+'.org'})).domain;
  let pending=error(cmd(b,'domain.claim',r,{hostname:'second-race-'+randomUUID().replaceAll('-','')+'.org'}));await blocked(b);await a.query('commit');assert.equal(await pending,'PT409');await b.query('rollback');console.log('PASS domain concurrency: simultaneous owner claims preserve site revision');
  await a.begin();await worker.begin();await cmd(a,'domain.disable',await rev(),{id:d.id,revision:d.revision});pending=error(review(worker,d,true));await blocked(worker);await a.query('commit');assert.equal(await pending,'PT409');await worker.query('rollback');assert.equal((await read(d.id)).state,'disabled');console.log('PASS domain concurrency: disable defeats stale trusted review');
  await a.begin();await cmd(a,'domain.rotate',await rev(),{id:d.id,revision:(await read(d.id)).revision});await a.query('commit');let current=await read(d.id);
  await worker.begin();await review(worker,current,true);await worker.query('commit');current=await read(d.id);
  await a.begin();await b.begin();await cmd(a,'domain.activate',await rev(),{id:d.id,revision:current.revision});pending=error(cmd(b,'domain.rotate',await rev(),{id:d.id,revision:current.revision}));await blocked(b);await a.query('commit');assert.equal(await pending,'PT409');await b.query('rollback');assert.equal((await read(d.id)).state,'active');console.log('PASS domain concurrency: activate versus stale rotation cannot overwrite winner');
  await a.begin();await cmd(a,'publish',await rev());await a.query('commit');assert.ok((await admin.query('select public.resolve_teacher_website($1) value',[d.hostname])).rows[0].value);
  current=await read(d.id);await worker.begin();await a.begin();await review(worker,current,false);pending=error(cmd(a,'domain.activate',await rev(),{id:d.id,revision:current.revision}));await blocked(a);await worker.query('commit');assert.equal(await pending,'PT409');await a.query('rollback');assert.equal((await admin.query('select public.resolve_teacher_website($1) value',[d.hostname])).rows[0].value,null);console.log('PASS domain concurrency: revalidation invalidates stale activation and routing');
  await a.begin();await cmd(a,'domain.rotate',await rev(),{id:d.id,revision:(await read(d.id)).revision});await a.query('commit');current=await read(d.id);await worker.begin();await review(worker,current,true);await worker.query('commit');current=await read(d.id);await a.begin();await cmd(a,'domain.activate',await rev(),{id:d.id,revision:current.revision});await a.query('commit');
  await a.begin();await cmd(a,'unpublish',await rev());assert.ok((await admin.query('select public.resolve_teacher_website($1) value',[d.hostname])).rows[0].value);await a.query('commit');assert.equal((await admin.query('select public.resolve_teacher_website($1) value',[d.hostname])).rows[0].value,null);console.log('PASS domain concurrency: publication visibility is committed atomically; unpublish stops resolver');
 }finally{for(const c of clients){try{await c.query('rollback');}catch{}await c.end();}}
};
