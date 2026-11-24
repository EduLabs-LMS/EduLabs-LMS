// Only called by the localhost disposable database harness. No development access.
// Migration 20261124120000_close_direct_table_access.sql (A3-06): public.course_run returns a course's current run or makes it under a
// lock on the course row, so two calls at once make ONE run. Real sessions under a Firebase identity, not a mocked claim.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], sub = 'crc-' + randomUUID();
  const claims = JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, email: sub + '@example.test', auth_time: Math.floor(Date.now() / 1000), sub });
  async function tab() {
    const c = await makeClient(); clients.push(c);
    c.pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    c.claim = async () => { await c.query('begin'); await c.query("set local lock_timeout='5s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims]); };
    return c;
  }
  async function blocked(c) {
    for (let i = 0; i < 100; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n > 0) return; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Expected a real wait on the course row');
  }
  const a = await tab(), b = await tab();
  try {
    await a.claim();
    const owner = (await a.query('select public.onboard_firebase_profile() id')).rows[0].id;
    await a.query('commit');
    const org = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic course run races',$2)", [org, 'crc-' + org]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, owner]);
    const course = async slug => {
      const id = randomUUID();
      await admin.query("insert into public.courses(id,organization_id,title,slug,status,created_by) values($1,$2,$3,$4,'published',$5)", [id, org, 'Synthetic ' + slug, slug, owner]);
      await admin.query("insert into public.course_staff(course_id,user_id,role) values($1,$2,'owner') on conflict do nothing", [id, owner]);
      return id;
    };
    const runs = async id => (await admin.query('select id from public.course_offerings where course_id=$1', [id])).rows.map(r => r.id);

    // 1. Two calls, the first still open: the second waits on the course row, then returns the first call's run.
    const c1 = await course('crc-one');
    await a.claim(); await b.claim();
    const first = (await a.query('select public.course_run($1) id', [c1])).rows[0].id;
    const second = b.query('select public.course_run($1) id', [c1]).then(r => r.rows[0].id);
    await blocked(b);
    await a.query('commit');
    assert.equal(await second, first, 'the second call returns the run the first one made');
    await b.query('commit');
    assert.deepEqual(await runs(c1), [first]);
    console.log('PASS course run race: two calls at once make one run, and both get it');

    // 2. Six calls from six sessions started together: still one run.
    const c2 = await course('crc-two');
    const many = await Promise.all(Array.from({ length: 6 }, tab));
    const ids = await Promise.all(many.map(async c => { await c.claim(); const id = (await c.query('select public.course_run($1) id', [c2])).rows[0].id; await c.query('commit'); return id; }));
    assert.equal(new Set(ids).size, 1, 'six callers received one run');
    assert.deepEqual(await runs(c2), [ids[0]]);
    console.log('PASS course run race: six simultaneous calls make one run');

    // 3. The old read-then-insert, replayed by hand, is what made two runs: prove the table cannot be written that way from the browser.
    await a.claim();
    await assert.rejects(a.query("insert into public.course_offerings(course_id,name,delivery_mode,status) values($1,'Direct','scheduled','active')", [c2]), e => e.code === '42501');
    await a.query('rollback');
    assert.equal((await runs(c2)).length, 1);
    console.log('PASS course run race: a direct insert of a run is refused');
    console.log('All 3 independent-session course run races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
