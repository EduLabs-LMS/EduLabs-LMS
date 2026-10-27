// Independent PostgreSQL sessions, only in the randomized disposable harness database. Synthetic verified-gateway claims.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
module.exports = async (makeClient, admin) => {
 const clients = [];
 let passed = 0;
 const run = randomUUID().slice(0, 8);
 const hash = secret => createHash('sha256').update(secret).digest('hex');
 const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true,
  email: `${label}.${run}@example.test`, auth_time: Math.floor(Date.now() / 1000), sub: `tic-${run}-${label}` });
 async function actor(label) {
  const c = await makeClient(); clients.push(c);
  c.pid = (await c.query('select pg_backend_pid() id')).rows[0].id;
  c.begin = async () => { await c.query('begin'); await c.query("set local lock_timeout='5s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]); };
  return c;
 }
 async function blocked(c) {
  for (let i = 0; i < 200; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n) return; await new Promise(r => setTimeout(r, 10)); }
  throw Error('Expected invitation lock wait');
 }
 const code = p => p.then(() => null, e => e.code);
 try {
  const setup = await actor('admin');
  const ids = {};
  for (const label of ['admin', 'teacher']) {
   await setup.begin(); await setup.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]);
   ids[label] = (await setup.query('select public.onboard_firebase_profile() id')).rows[0].id; await setup.query('commit');
  }
  await admin.query("insert into private.platform_admins(user_id,note) values($1,'synthetic race admin')", [ids.admin]);
  const request = { teacherEmail: `teacher.${run}@example.test`, systems: [{ label: 'Egyptian National', grades: [{ key: 'g3', label: 'Third Secondary' }] }],
   subjects: [{ key: 'phy', label: 'Physics' }], course: { title: 'Physics - Third Secondary', gradeKey: 'g3', subjectKey: 'phy' } };
  await setup.begin();
  const provisioned = (await setup.query('select public.platform_provision_teacher($1::jsonb,$2) v', [JSON.stringify(request), hash(`race-${run}`)])).rows[0].v;
  await setup.query('commit');

  // Two tabs of the same teacher accept the same single-use link at once: exactly one wins, the other is refused after waiting.
  const a = await actor('teacher'), b = await actor('teacher');
  const accept = c => c.query('select public.accept_teacher_invitation($1) v', [hash(`race-${run}`)]);
  await a.begin(); await b.begin();
  const first = (await accept(a)).rows[0].v;
  const second = code(accept(b)); await blocked(b);
  await a.query('commit');
  assert.equal(await second, 'PT409'); await b.query('rollback'); passed++;
  assert.equal(first.organizationId, provisioned.organizationId); passed++;
  assert.equal((await admin.query("select count(*)::int n from public.organization_memberships where organization_id=$1 and role='owner' and status='active'", [provisioned.organizationId])).rows[0].n, 1); passed++;
  assert.equal((await admin.query("select count(*)::int n from private.teacher_invitations where organization_id=$1 and status='accepted'", [provisioned.organizationId])).rows[0].n, 1); passed++;

  // An administrator's replacement racing the acceptance: whichever commits first wins, and never both.
  await setup.begin(); await setup.query("select set_config('request.jwt.claims',$1,true)", [claims('admin')]);
  const org2 = (await setup.query('select public.platform_provision_teacher($1::jsonb,$2) v', [JSON.stringify({ ...request, teacherEmail: `teacher.${run}@example.test` }), hash(`race2-${run}`)])).rows[0].v;
  await setup.query('commit');
  const t = await actor('teacher'), adm = await actor('admin');
  await t.begin(); await adm.begin();
  await t.query('select public.accept_teacher_invitation($1)', [hash(`race2-${run}`)]);
  const reissue = code(adm.query('select public.platform_reissue_teacher_invitation($1,$2,7)', [org2.organizationId, hash(`race2b-${run}`)])); await blocked(adm);
  await t.query('commit');
  const verdict = await reissue; await adm.query('rollback');
  assert.ok(verdict !== null, 'the replacement cannot supersede an invitation that was just accepted'); passed++;
  assert.equal((await admin.query("select count(*)::int n from private.teacher_invitations where organization_id=$1 and status='pending'", [org2.organizationId])).rows[0].n, 0); passed++;
  console.log(`PASS teacher invitation concurrency: ${passed} cases`);
 } finally {
  for (const c of clients) await c.end().catch(() => {});
 }
};
