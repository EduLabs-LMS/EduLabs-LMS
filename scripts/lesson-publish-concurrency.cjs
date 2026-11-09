// Only called by the localhost disposable database harness. No development access.
// Migration 20261110120000_lesson_publish.sql: publish_lesson against delete_lesson of the same lesson, on separate connections, under a Firebase identity.
// Both take the course root, so the second waits; whichever commits first stands, the other is refused, and nothing is half-done.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], sub = 'lpc-' + randomUUID();
  const claims = JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, email: sub + '@example.test', auth_time: Math.floor(Date.now() / 1000), sub });
  async function tab() {
    const c = await makeClient(); clients.push(c);
    c.pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    c.claim = async () => { await c.query('begin'); await c.query("set local lock_timeout='5s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims]); };
    return c;
  }
  async function blocked(c) {
    for (let i = 0; i < 100; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n > 0) return; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Expected a real wait on the course root');
  }
  const a = await tab(), b = await tab();
  try {
    await a.claim();
    const owner = (await a.query('select public.onboard_firebase_profile() id')).rows[0].id;
    await a.query('commit');
    const org = randomUUID(), course = randomUUID(), chapter = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic lesson publish races',$2)", [org, 'lpc-' + org]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, owner]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,created_by) values($1,$2,'Synthetic lesson publish races','lpc-races','published',$3)", [course, org, owner]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$2,'One',0)", [chapter, course]);
    const lesson = async (title, position) => { const id = randomUUID(); await admin.query("insert into public.lessons(id,module_id,title,position) values($1,$2,$3,$4)", [id, chapter, title, position]); return id; };
    const stamp = async id => (await admin.query('select updated_at::text t from public.lessons where id=$1', [id])).rows[0].t;
    const row = async id => (await admin.query('select status from public.lessons where id=$1', [id])).rows[0];
    const structure = (c, action, id, read) => c.query('select public.edit_course_structure($1,$2,$3,null,$4,$5)', [course, action, id, read, '{}']);
    const refused = p => p.then(() => null, e => ({ code: e.code, message: e.message }));

    // 1. Publish first: the delete, sent with the version it read, waits and is then stale.
    const l1 = await lesson('Published first', 0);
    let read = await stamp(l1);
    await a.claim(); await b.claim();
    await structure(a, 'publish_lesson', l1, read);
    let second = refused(structure(b, 'delete_lesson', l1, read));
    await blocked(b); await a.query('commit');
    assert.equal((await second).code, 'PT409'); await b.query('rollback');
    assert.deepEqual(await row(l1), { status: 'published' });
    console.log('PASS lesson publish race: a publish beats a delete of the same lesson, which is refused as stale');

    // 2. Delete first: the publish waits and then finds no lesson.
    const l2 = await lesson('Deleted first', 1);
    read = await stamp(l2);
    await a.claim(); await b.claim();
    await structure(a, 'delete_lesson', l2, read);
    second = refused(structure(b, 'publish_lesson', l2, read));
    await blocked(b); await a.query('commit');
    assert.deepEqual(await second, { code: '42501', message: 'Lesson unavailable' }); await b.query('rollback');
    assert.equal(await row(l2), undefined);
    console.log('PASS lesson publish race: a delete beats a publish of the same lesson, which finds it gone');
    console.log('All 2 independent-session lesson publish races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
