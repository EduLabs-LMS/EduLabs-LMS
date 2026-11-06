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
    console.log('PASS course content race: two tabs add a chapter, both land in different positions');
    // What a tab read of the chapters, and the labels as they stand. Every race below ends with the labels proved correct.
    const seenChapters = async () => (await admin.query('select id,title,updated_at::text updated_at from public.course_modules where course_id=$1 order by position', [course])).rows;
    const labels = async () => (await admin.query("select string_agg(title||':'||group_type||':'||chapter_number||':'||position,'|' order by position) l from public.course_modules where course_id=$1", [course])).rows[0].l;
    const at = (list, title) => { const c = list.find(x => x.title === title); return { id: c.id, updated_at: c.updated_at }; };
    const reorderChapters = (c, items) => c.query("select public.edit_learning_content($1,'reorder_modules',null,null,null,$2)", [course, JSON.stringify({ items: items.map(({ id, updated_at }) => ({ id, updated_at })) })]);
    const chapterLabels = titles => titles.map((t, i) => `${t}:Chapter:${i + 1}:${i}`).join('|');
    assert.equal(await labels(), chapterLabels(['One', 'Two', 'Three', 'Four', 'Five']), 'two chapters created at once get the numbers 4 and 5');

    // 7. Two tabs reorder the chapters. The first stands, and the numbers follow it.
    let chapters = await seenChapters();
    await a.claim(); await b.claim();
    await reorderChapters(a, [...chapters].reverse());
    second = stale(reorderChapters(b, [chapters[1], chapters[0], ...chapters.slice(2)]));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    assert.equal(await labels(), chapterLabels(['Five', 'Four', 'Three', 'Two', 'One']));
    console.log('PASS course content race: two tabs reorder chapters, the first stands and the numbers follow it');

    // 8. A chapter delete and a chapter reorder. The reorder still lists the deleted chapter, so it is refused; no gap is left.
    chapters = await seenChapters();
    const five = at(chapters, 'Five');
    await a.claim(); await b.claim();
    await structure(a, 'delete_chapter', five.id, null, five.updated_at, { items: [] });
    second = stale(reorderChapters(b, [...chapters].reverse()));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    assert.equal(await labels(), chapterLabels(['Four', 'Three', 'Two', 'One']));
    console.log('PASS course content race: a chapter delete beats a reorder, and the numbers close up');

    // 9. Two tabs delete chapters. The first renumbers the chapters after it, so the second, holding an old version of a later chapter, must reload. Then it may delete.
    await admin.query("insert into public.course_modules(course_id,title,position) values($1,'Six',4),($1,'Seven',5)", [course]);
    chapters = await seenChapters();
    await a.claim(); await b.claim();
    await structure(a, 'delete_chapter', at(chapters, 'Six').id, null, at(chapters, 'Six').updated_at, { items: [] });
    second = stale(structure(b, 'delete_chapter', at(chapters, 'Seven').id, null, at(chapters, 'Seven').updated_at, { items: [] }));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409', 'the number of the second chapter changed under the tab'); await b.query('rollback');
    assert.equal(await labels(), chapterLabels(['Four', 'Three', 'Two', 'One', 'Seven']));
    chapters = await seenChapters();
    await structure(admin, 'delete_chapter', at(chapters, 'Seven').id, null, at(chapters, 'Seven').updated_at, { items: [] }).then(() => assert.fail('a call with no identity is denied'), e => assert.equal(e.code, '42501'));
    await b.claim(); await structure(b, 'delete_chapter', at(chapters, 'Seven').id, null, at(chapters, 'Seven').updated_at, { items: [] }); await b.query('commit');
    assert.equal(await labels(), chapterLabels(['Four', 'Three', 'Two', 'One']));
    console.log('PASS course content race: two chapter deletes, the second reloads, and no gap is left');

    // 10. A delete and a create at once. The new chapter takes the number after the renumbering.
    await admin.query("insert into public.course_modules(course_id,title,position) values($1,'Eight',4)", [course]);
    chapters = await seenChapters();
    await a.claim(); await b.claim();
    await structure(a, 'delete_chapter', at(chapters, 'Eight').id, null, at(chapters, 'Eight').updated_at, { items: [] });
    second = structure(b, 'create_chapter', null, null, null, { title: 'Nine' });
    await blocked(b); await a.query('commit'); await second; await b.query('commit');
    assert.equal(await labels(), chapterLabels(['Four', 'Three', 'Two', 'One', 'Nine']));
    console.log('PASS course content race: a create waits for a delete and takes the next number');

    // 11. A lesson moves while another tab reorders the chapters. A move changes no chapter's version, so both stand: the lesson stays in its new chapter, whatever its number is now.
    chapters = await seenChapters();
    const one = at(chapters, 'One'), two = at(chapters, 'Two'), runner = (await seen(ch2))[0], into = await seen(ch1);
    assert.equal(two.id, ch2); assert.equal(one.id, ch1);
    await a.claim(); await b.claim();
    await structure(a, 'move_lesson', runner.id, ch1, runner.updated_at, { items: [...into, runner] });
    second = reorderChapters(b, [...chapters].reverse());
    await blocked(b); await a.query('commit'); await second; await b.query('commit');
    assert.equal(await labels(), chapterLabels(['Nine', 'One', 'Two', 'Three', 'Four']));
    assert.equal((await admin.query('select module_id from public.lessons where id=$1', [runner.id])).rows[0].module_id, ch1);
    console.log('PASS course content race: a lesson move and a chapter reorder both stand, and the numbers follow the reorder');

    // 12. A course is archived while a tab adds a chapter: the tab waits on the course, then is refused and adds nothing. The other order keeps the chapter, numbered.
    const before = await labels();
    const archive = (c, status) => c.query('update public.courses set status=$2 where id=$1', [course, status]);
    await a.claim(); await b.claim();
    await archive(a, 'archived');
    second = stale(structure(b, 'create_chapter', null, null, null, { title: 'Too late' }));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    assert.equal(await labels(), before);
    // A direct write takes no course-root lock of its own: the trigger's share lock is what makes it wait and read the new state.
    await admin.query("update public.courses set status='draft' where id=$1", [course]);
    await a.claim(); await b.claim();
    await archive(a, 'archived');
    second = stale(b.query("update public.lessons set title='Too late' where id=$1", [runner.id]));
    await blocked(b); await a.query('commit');
    assert.equal(await second, 'PT409'); await b.query('rollback');
    assert.notEqual((await admin.query('select title from public.lessons where id=$1', [runner.id])).rows[0].title, 'Too late');
    console.log('PASS course content race: archiving beats a create and a direct rename, both wait and are refused');

    // 13. The other order: the create holds the course, the archive waits, both stand.
    await admin.query("update public.courses set status='draft' where id=$1", [course]);
    await a.claim(); await b.claim();
    await structure(a, 'create_chapter', null, null, null, { title: 'In time' });
    second = archive(b, 'archived');
    await blocked(b); await a.query('commit'); await second; await b.query('commit');
    assert.equal(await labels(), before + '|In time:Chapter:6:5');
    assert.equal((await admin.query('select status from public.courses where id=$1', [course])).rows[0].status, 'archived');
    console.log('PASS course content race: a create in time stands, numbered, and the archive follows it');
    console.log('All 13 independent-session course content races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
