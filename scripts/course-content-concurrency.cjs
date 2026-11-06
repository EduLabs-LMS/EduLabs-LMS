// Only called by the localhost disposable database harness. No development access.
// Two tabs at once, on separate connections, under a Firebase identity: the second writer waits on the course root, then sees it is stale. The order is never corrupted.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], sub = 'ccc-' + randomUUID();
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
    const org = randomUUID(), course = randomUUID(), ch1 = randomUUID(), ch2 = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic races',$2)", [org, 'ccc-' + org]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, owner]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,created_by) values($1,$2,'Synthetic races','ccc-races','draft',$3)", [course, org, owner]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$3,'One',0),($2,$3,'Two',1)", [ch1, ch2, course]);
    const lesson = async (chapter, title, position) => { const id = randomUUID(); await admin.query("insert into public.lessons(id,module_id,title,position) values($1,$2,$3,$4)", [id, chapter, title, position]); return id; };
    const l1 = await lesson(ch1, 'A', 0), l2 = await lesson(ch1, 'B', 1), m1 = (await lesson(ch1, 'C', 2), await lesson(ch2, 'X', 0));
    // What a tab read before anybody changed anything.
    const seen = async chapter => (await admin.query('select id,updated_at::text updated_at from public.lessons where module_id=$1 order by position', [chapter])).rows;
    const titles = async chapter => (await admin.query('select string_agg(title,$2 order by position) t,array_agg(position order by position) p from public.lessons where module_id=$1', [chapter, ''])).rows[0];
    const reorder = (c, chapter, items) => c.query("select public.edit_learning_content($1,'reorder_lessons',null,$2,null,$3)", [course, chapter, JSON.stringify({ items })]);
    const structure = (c, action, id, parent, stamp, data) => c.query('select public.edit_course_structure($1,$2,$3,$4,$5,$6)', [course, action, id, parent, stamp, JSON.stringify(data)]);
    const stale = p => p.then(() => null, e => e.code);

    // 1. Two tabs reorder the same chapter.
    let items = await seen(ch1);
    await a.claim(); await b.claim();
    await reorder(a, ch1, [items[2], items[1], items[0]]);
    let second = stale(reorder(b, ch1, [items[1], items[0], items[2]]));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    let now = await titles(ch1); assert.equal(now.t, 'CBA'); assert.deepEqual(now.p, [0, 1, 2]);
    console.log('PASS course content race: two tabs reorder, the first stands and the order is intact');

    // 2. One tab moves a lesson into a chapter while another reorders that chapter.
    let target = await seen(ch2); items = await seen(ch1);
    const moving = items.find(i => i.id === l2);
    await a.claim(); await b.claim();
    await structure(a, 'move_lesson', l2, ch2, moving.updated_at, { items: [...target, moving] });
    second = stale(reorder(b, ch2, target));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    now = await titles(ch2); assert.equal(now.t, 'XB'); assert.deepEqual(now.p, [0, 1]);
    console.log('PASS course content race: a move beats a reorder of its target, and the reorder is refused');

    // 3. Two tabs move the same lesson to the same chapter. It lands once.
    items = await seen(ch1); target = await seen(ch2);
    const c1 = items.find(i => i.id === l1);
    await a.claim(); await b.claim();
    await structure(a, 'move_lesson', l1, ch2, c1.updated_at, { items: [c1, ...target] });
    second = stale(structure(b, 'move_lesson', l1, ch2, c1.updated_at, { items: [...target, c1] }));
    await blocked(b); await a.query('commit');
    assert.ok(['PT409', '23514'].includes(await second), 'the second move is refused'); await b.query('rollback');
    now = await titles(ch2); assert.equal(now.t, 'AXB'); assert.deepEqual(now.p, [0, 1, 2]);
    console.log('PASS course content race: the same lesson moved twice lands once');

    // 4. A delete and a reorder of the same chapter.
    items = await seen(ch2);
    await a.claim(); await b.claim();
    await structure(a, 'delete_lesson', m1, null, items.find(i => i.id === m1).updated_at, {});
    second = stale(reorder(b, ch2, [...items].reverse()));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    now = await titles(ch2); assert.equal(now.t, 'AB');
    console.log('PASS course content race: a delete beats a reorder that still lists the lesson');

    // 5. A chapter delete while another tab adds a lesson to it: the new lesson is never removed unseen.
    const empty = randomUUID();
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$2,'Three',2)", [empty, course]);
    const chapter = (await admin.query('select updated_at::text u from public.course_modules where id=$1', [empty])).rows[0].u;
    await a.claim(); await b.claim();
    await a.query("select public.edit_learning_content($1,'create_lesson',null,$2,null,'{\"title\":\"Added elsewhere\"}')", [course, empty]);
    second = stale(structure(b, 'delete_chapter', empty, null, chapter, { items: [] }));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    assert.equal((await titles(empty)).t, 'Added elsewhere');
    console.log('PASS course content race: a lesson added in another tab stops the chapter delete');

    // 6. Two tabs add a chapter at once: both land, in different positions.
    await a.claim(); await b.claim();
    await structure(a, 'create_chapter', null, null, null, { title: 'Four' });
    second = structure(b, 'create_chapter', null, null, null, { title: 'Five' });
    await blocked(b); await a.query('commit'); await second; await b.query('commit');
    const positions = (await admin.query('select array_agg(position order by position) p from public.course_modules where course_id=$1', [course])).rows[0].p;
    assert.equal(new Set(positions).size, positions.length); assert.deepEqual(positions, [0, 1, 2, 3, 4]);
    console.log('All 6 independent-session course content races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
