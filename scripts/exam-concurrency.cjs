// Called only by the disposable localhost database runner. Independent sessions,
// actual advisory-lock waits, persisted postconditions; no mock concurrency.
const assert=require('node:assert/strict');
module.exports=async function run(makeClient,admin) {
 const clients=[];
 async function actor(n) {
  const c=await makeClient(); clients.push(c);
  c.claim=async()=>{await c.query('begin');await c.query('set local lock_timeout=\'5s\'');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({iss:'https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1',aud:'authenticated',sub:`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`,role:'authenticated'})]);};
  c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;
  return c;
 }
 async function blocked(c) {
  for(let i=0;i<100;i++) {
   const {rows}=await admin.query('select cardinality(pg_blocking_pids($1)) n',[c.pid]);
   if(rows[0].n>0) return;
   await new Promise(r=>setTimeout(r,10));
  }
  throw new Error('Expected a real PostgreSQL lock wait');
 }
 try {
  const a=await actor(5),b=await actor(5);
  const schedule='a0000000-0000-0000-0000-000000000001';
  const first="select public.start_assessment_attempt($1) id";
  await a.claim();await b.claim();
  const id=(await a.query(first,[schedule])).rows[0].id;
  const resume=b.query(first,[schedule]); await blocked(b); await a.query('commit');
  assert.equal((await resume).rows[0].id,id);await b.query('commit');
  console.log('PASS concurrency: simultaneous first starts return one UUID');
  await a.claim();
  await a.query("select public.save_assessment_response($1,'80000000-0000-0000-0000-000000000001','{\"option_ids\":[\"90000000-0000-0000-0000-000000000002\"]}')",[id]);
  await a.query('select public.submit_assessment_attempt($1)',[id]);
  await b.claim();
  const late=b.query("select public.save_assessment_response($1,'80000000-0000-0000-0000-000000000001','{\"option_ids\":[\"90000000-0000-0000-0000-000000000001\"]}')",[id]).then(()=>null,e=>e.code);
  await blocked(b);await a.query('commit');assert.equal(await late,'42501');await b.query('rollback');
  const original=await admin.query('select response from public.assessment_responses where attempt_id=$1',[id]);
  assert.deepEqual(original.rows[0].response.option_ids,['90000000-0000-0000-0000-000000000002']);
  console.log('PASS concurrency: submit freezes answers before blocked save');
  await a.claim();await b.claim();
  const revision=(await a.query('select public.sync_exam_participation($1) s',[schedule])).rows[0].s.revision;
  await a.query("select public.decide_exam_retry($1,'accept',$2)",[schedule,revision]);
  const decline=b.query("select public.decide_exam_retry($1,'decline',$2)",[schedule,revision]).then(()=>null,e=>e.code);
  await blocked(b);await a.query('commit');assert.equal(await decline,'PT409');await b.query('rollback');
  console.log('PASS concurrency: accept/decline has one permanent winner');
  await a.claim();await b.claim();
  const second=(await a.query(first,[schedule])).rows[0].id;
  const duplicate=b.query(first,[schedule]);await blocked(b);await a.query('commit');
  assert.equal((await duplicate).rows[0].id,second);await b.query('commit');
  assert.notEqual(second,id);
  assert.equal((await admin.query('select count(*)::int n from public.assessment_attempts where offering_assessment_id=$1',[schedule])).rows[0].n,2);
  console.log('PASS concurrency: simultaneous second starts create exactly one retry');
  await a.claim();
  await a.query("select public.save_assessment_response($1,'80000000-0000-0000-0000-000000000001','{\"option_ids\":[\"90000000-0000-0000-0000-000000000001\"]}')",[second]);
  await a.query('select public.submit_assessment_attempt($1)',[second]);
  await b.claim();const repeatSubmit=b.query('select public.submit_assessment_attempt($1)',[second]);await blocked(b);await a.query('commit');await repeatSubmit;await b.query('commit');
  const persisted=await admin.query('select p.retry_decision,p.attempts_state,p.released_at,t.score from private.assessment_participations p join public.assessment_attempts t on t.id=p.final_attempt_id where p.schedule_id=$1',[schedule]);
  assert.equal(persisted.rows[0].retry_decision,'accepted');assert.equal(persisted.rows[0].attempts_state,'finalized');assert.ok(persisted.rows[0].released_at);assert.equal(Number(persisted.rows[0].score),2);
  console.log('PASS concurrency: duplicate final submissions commit one released final paper');
  // Subjective grading and release must use the same participation lock.
  const {randomUUID}=require('node:crypto');const assessment=randomUUID(),question=randomUUID(),delivery=randomUUID();
  await admin.query("insert into public.assessments(id,course_id,title,type,status) values($1,'30000000-0000-0000-0000-000000000001','Synthetic concurrency written','exam','published')",[assessment]);
  await admin.query("insert into public.assessment_questions(id,assessment_id,question_type,prompt,points,position) values($1,$2,'essay','Synthetic written',3,0)",[question,assessment]);
  await admin.query("insert into public.offering_assessments(id,offering_id,assessment_id,max_attempts,published) values($1,'60000000-0000-0000-0000-000000000001',$2,1,true)",[delivery,assessment]);
  await a.claim();const paper=(await a.query(first,[delivery])).rows[0].id;
  const response=(await a.query("select public.save_assessment_response($1,$2,'{\"text\":\"Synthetic work\"}') id",[paper,question])).rows[0].id;
  await a.query('select public.submit_assessment_attempt($1)',[paper]);await a.query('commit');
  const teacherA=await actor(2),teacherB=await actor(2);
  await teacherA.claim();await teacherB.claim();
  await teacherA.query('select public.grade_assessment_response($1,2)',[response]);
  const finalization=teacherB.query('select public.finalize_assessment_grade($1)',[paper]);
  await blocked(teacherB);await teacherA.query('commit');await finalization;await teacherB.query('commit');
  const finalState=(await admin.query('select revision,released_at,grading_state from private.assessment_participations where schedule_id=$1',[delivery])).rows[0];
  assert.equal(finalState.grading_state,'complete');assert.equal(finalState.released_at,null);
  console.log('PASS concurrency: finalization waits for grading; release remains separate');
  await teacherA.claim();await teacherB.claim();
  const release='select public.release_exam_result($1,$2,$3) s';const releaseArgs=[delivery,'10000000-0000-0000-0000-000000000005',finalState.revision];
  const released=(await teacherA.query(release,releaseArgs)).rows[0].s;
  const again=teacherB.query(release,releaseArgs);await blocked(teacherB);await teacherA.query('commit');assert.equal((await again).rows[0].s.revision,released.revision);await teacherB.query('commit');
  console.log('PASS concurrency: simultaneous staff releases are idempotent');
  await teacherA.claim();await teacherB.claim();
  const correctionRevision=released.revision,correctionRequest=randomUUID();
  const correctionSql='select public.grade_exam_paper($1,$2,$3,$4,$5,$6) s';
  const correctionArgs=[paper,correctionRevision,JSON.stringify({[question]:3}),'Audited feedback','Synthetic rubric correction',correctionRequest];
  await teacherA.query(correctionSql,correctionArgs);
  const competingCorrection=teacherB.query(correctionSql,[paper,correctionRevision,JSON.stringify({[question]:1}),'Other feedback','Competing correction',randomUUID()]).then(()=>null,e=>e.code);
  await blocked(teacherB);await teacherA.query('commit');assert.equal(await competingCorrection,'PT409');await teacherB.query('rollback');
  await teacherA.claim();await teacherA.query(correctionSql,correctionArgs);await teacherA.query('commit');
  assert.equal(Number((await admin.query('select score from public.assessment_attempts where id=$1',[paper])).rows[0].score),3);
  assert.equal((await admin.query('select count(*)::int n from private.exam_grade_changes where attempt_id=$1',[paper])).rows[0].n,1);
  assert.deepEqual((await admin.query('select response from public.assessment_responses where id=$1',[response])).rows[0].response,{text:'Synthetic work'});
  console.log('PASS concurrency: competing released corrections have one audited winner; duplicate request is idempotent');
  // The legacy builder's clone and save are closed to clients (20261114120000_exams.sql); the fixture runs them as the owner with the
  // teacher's claims, so the legacy runner still gets a cloned, published paper. The definers still check the caller from the claims.
  await teacherA.claim();await teacherA.query('reset role');const cloned=(await teacherA.query('select private.clone_exam_schedule($1) id',[schedule])).rows[0].id;await teacherA.query('commit');
  // The clone is a draft; publish it before its first attempt through normal authoring.
  await teacherA.claim();const definition=(await teacherA.query('select public.get_exam_definition_v2($1) d',[cloned])).rows[0].d;
  const draft={title:definition.title,description:definition.description,durationMinutes:definition.durationMinutes,maxAttempts:definition.maxAttempts,isPublished:true,questions:definition.questions.map(({id,...q})=>q)};
  await teacherA.query('reset role');await teacherA.query('select private.save_exam_definition_v2($1,$2,$3,$4)',[definition.offeringId,cloned,definition.updatedAt,JSON.stringify(draft)]);await teacherA.query('commit');
  await a.claim();const batchedPaper=(await a.query(first,[cloned])).rows[0].id;
  const content=(await a.query('select public.get_exam_attempt_content($1) q',[batchedPaper])).rows[0].q;const current=(await a.query('select public.sync_exam_participation($1) s',[cloned])).rows[0].s;await a.query('commit');
  await a.claim();await b.claim();
  const batchSql='select public.save_exam_answers($1,$2,$3)';
  const snapshot=option=>JSON.stringify([{question_id:content[0].id,response:{option_ids:[content[0].options[option].id]},media_asset_id:null}]);
  await a.query(batchSql,[batchedPaper,current.revision,snapshot(0)]);
  const staleBatch=b.query(batchSql,[batchedPaper,current.revision,snapshot(1)]).then(()=>null,e=>e.code);await blocked(b);await a.query('commit');assert.equal(await staleBatch,'PT409');await b.query('rollback');
  assert.deepEqual((await admin.query('select response from public.assessment_responses where attempt_id=$1',[batchedPaper])).rows[0].response.option_ids,[content[0].options[0].id]);
  console.log('PASS concurrency: atomic answer snapshots reject a competing stale batch');
  const expiredA=await actor(6),expiredB=await actor(6),otherSchedule='a0000000-0000-0000-0000-000000000002';
  await expiredA.claim();const expiryPaper=(await expiredA.query(first,[otherSchedule])).rows[0].id;await expiredA.query('commit');
  await admin.query("update public.enrollments set expires_at=clock_timestamp()+interval '500 milliseconds' where offering_id='60000000-0000-0000-0000-000000000002' and user_id='10000000-0000-0000-0000-000000000006'");
  await expiredA.claim();await expiredB.claim();
  await expiredA.query("select public.save_assessment_response($1,'80000000-0000-0000-0000-000000000001','{\"option_ids\":[\"90000000-0000-0000-0000-000000000002\"]}')",[expiryPaper]);
  const expiredSave=expiredB.query("select public.save_assessment_response($1,'80000000-0000-0000-0000-000000000001','{\"option_ids\":[\"90000000-0000-0000-0000-000000000001\"]}')",[expiryPaper]).then(()=>null,e=>e.code);
  await blocked(expiredB);await new Promise(r=>setTimeout(r,600));await expiredA.query('commit');assert.equal(await expiredSave,'42501');await expiredB.query('rollback');
  console.log('PASS concurrency: enrollment expiry during lock wait rejects save');
 } finally {for(const c of clients) {await c.query('rollback');await c.end();}}
};
