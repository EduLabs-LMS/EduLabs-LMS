// Only called by the localhost disposable database harness. No development access.
// What the Content section really sends, against the real functions, under a Firebase identity: the screen's payload builders, the route's contract and call mapping, and its reply mapper.
// The versions make the full round trip (read, contract, write). pg gives the same code, message and detail PostgREST passes on; PostgREST itself is not run here.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module: m, exports: m.exports, require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
  return m.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const shared = load('shared/course-content.ts'), { contentEdit } = load('shared/contracts/course-content.ts', { zod: require('zod') });
const claimsFor = sub => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, email: sub + '@example.test', auth_time: Math.floor(Date.now() / 1000), sub });

module.exports = async function (makeClient, admin) {
  const c = await makeClient();
  const as = sub => async work => {
    await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claimsFor(sub)]);
    try { const result = await work(); await c.query('commit'); return result; } catch (e) { await c.query('rollback'); throw e; }
  };
  const ownerSub = 'ccs-' + randomUUID(), strangerSub = 'ccs-' + randomUUID(), owner = as(ownerSub), stranger = as(strangerSub);
  try {
    const ownerId = (await owner(() => c.query('select public.onboard_firebase_profile() id'))).rows[0].id;
    await stranger(() => c.query('select public.onboard_firebase_profile() id'));
    const org = randomUUID(), course = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic screen',$2)", [org, 'ccs-' + org]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, ownerId]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,created_by) values($1,$2,'Synthetic screen','ccs-screen','draft',$3)", [course, org, ownerId]);

    const read = async (who = owner) => (await who(() => c.query('select public.course_structure($1) s', [course]))).rows[0].s;
    const tree = async () => plain(shared.buildTree(await read()));
    // As the route does it: the contract first, then the call mapping, under the signed-in identity.
    const send = async (edit, who = owner) => {
      const checked = contentEdit.parse(plain(edit)), { fn, args } = shared.contentCall(course, checked);
      assert.match(fn, /^edit_(course_structure|learning_content)$/);
      return (await who(() => c.query(`select public.${fn}($1,$2,$3,$4,$5,$6) id`, [args.p_course_id, args.p_action, args.p_id, args.p_parent_id, args.p_updated_at, JSON.stringify(args.p_data)]))).rows[0].id;
    };
    const refused = (edit, who) => send(edit, who).then(() => assert.fail('should be refused: ' + edit.action), e => { if (!e.code) throw e; return plain(shared.contentReply({ code: e.code, message: e.message, details: e.detail })); });

    // ---- reading and creating
    let s = await read();
    assert.deepEqual([s.archived, s.canEdit, s.chapters.length, s.lessons.length], [false, true, 0, 0]);
    const one = await send({ action: 'create_chapter', title: 'Motion' }), two = await send({ action: 'create_chapter', title: 'Energy' }), three = await send({ action: 'create_chapter', title: 'Waves' });
    const speed = await send({ action: 'create_lesson', parentId: one, title: 'Speed' }), velocity = await send({ action: 'create_lesson', parentId: one, title: 'Velocity' }), acceleration = await send({ action: 'create_lesson', parentId: one, title: 'Acceleration' }), work = await send({ action: 'create_lesson', parentId: two, title: 'Work' });
    let t = await tree();
    assert.deepEqual(t.map(x => [x.title, x.number]), [['Motion', 1], ['Energy', 2], ['Waves', 3]]);
    assert.deepEqual(t[0].lessons.map(l => [l.title, l.label]), [['Speed', '1.1'], ['Velocity', '1.2'], ['Acceleration', '1.3']]);
    assert.ok(contentEdit.safeParse({ action: 'rename_lesson', id: speed, updatedAt: t[0].lessons[0].updatedAt, title: 'x' }).success, 'the contract accepts the version as the database writes it: ' + t[0].lessons[0].updatedAt);
    console.log('PASS screen: read, create chapter and create lesson through the real functions');

    // ---- rename: the version read goes back unchanged
    await send({ action: 'rename_lesson', id: speed, updatedAt: t[0].lessons[0].updatedAt, title: 'Top speed' });
    await send({ action: 'rename_chapter', id: one, updatedAt: t[0].updatedAt, title: 'Moving' });
    const stale = t[0].lessons[0].updatedAt;
    assert.deepEqual(await refused({ action: 'rename_lesson', id: speed, updatedAt: stale, title: 'Late' }), { status: 409, body: { kind: 'changed' } });
    t = await tree(); assert.equal(t[0].title, 'Moving'); assert.equal(t[0].lessons[0].title, 'Top speed');
    console.log('PASS screen: rename takes the exact version read; the old version reads as changed elsewhere');

    // ---- reorder, by the screen's own builders
    await send(shared.reorderLessonsEdit(t[0], 2, 0)); t = await tree();
    assert.deepEqual(t[0].lessons.map(l => [l.title, l.label]), [['Acceleration', '1.1'], ['Top speed', '1.2'], ['Velocity', '1.3']]);
    const before = t;
    await send(shared.reorderChaptersEdit(t, 2, 0)); t = await tree();
    assert.deepEqual(t.map(x => [x.title, x.number, x.position]), [['Waves', 1, 0], ['Moving', 2, 1], ['Energy', 3, 2]]);
    assert.equal(t[1].lessons[0].label, '2.1', 'lesson labels follow the stored number');
    assert.deepEqual(plain(shared.buildTree(shared.withChapterOrder({ archived: false, canEdit: true, chapters: before, lessons: before.flatMap(x => x.lessons) }, 2, 0))).map(x => [x.title, x.number, x.position]), t.map(x => [x.title, x.number, x.position]), 'what the screen shows while waiting is what the database stores');
    assert.deepEqual(await refused(shared.reorderChaptersEdit(before, 1, 0)), { status: 409, body: { kind: 'changed' } }, 'an order built on old versions');
    console.log('PASS screen: reorder of lessons and chapters; the number follows; the on-screen guess matches; a stale order is refused');

    // ---- move: leaves a gap, and the labels do not show it
    const moving = t[1].lessons[1]; // Top speed
    await send(shared.moveLessonEdit(moving, t[2])); t = await tree();
    assert.deepEqual(t[2].lessons.map(l => [l.title, l.label]), [['Work', '3.1'], ['Top speed', '3.2']], 'last in the target');
    assert.deepEqual(t[1].lessons.map(l => [l.title, l.label]), [['Acceleration', '2.1'], ['Velocity', '2.2']]);
    assert.ok(t[1].lessons[1].position - t[1].lessons[0].position > 1, 'the source really has a gap: position ' + t[1].lessons.map(l => l.position));
    assert.deepEqual(await refused(shared.moveLessonEdit({ ...t[1].lessons[0], updatedAt: stale }, t[0])), { status: 409, body: { kind: 'changed' } });
    console.log('PASS screen: move goes last in the target; a gap in positions never shows in the labels; a stale move is refused');

    // ---- a refused delete: the detail the database gives parses into the words' input
    await admin.query("insert into public.lesson_segments(id,lesson_id,title,position) values($1,$2,'Synthetic part',0)", [randomUUID(), work]);
    await admin.query("insert into public.lesson_blocks(lesson_id,block_type,position,content) values($1,'text',0,'{\"text\":\"Synthetic\"}')", [work]);
    t = await tree();
    const blocked = t[2].lessons.find(l => l.id === work);
    assert.deepEqual(blocked.deleteBlockers.slice().sort(), ['content', 'parts']); assert.equal(blocked.contentBlocks, 1); assert.equal(blocked.parts, 1);
    assert.deepEqual(plain(shared.lessonRefusal(blocked)), { reasons: blocked.deleteBlockers, contentBlocks: 1, covers: 0, parts: 1, homework: 0 });
    const lessonReply = await refused({ action: 'delete_lesson', id: work, updatedAt: blocked.updatedAt });
    assert.equal(lessonReply.status, 409); assert.equal(lessonReply.body.kind, 'refused'); assert.deepEqual(lessonReply.body.reasons.slice().sort(), ['content', 'parts']); assert.equal(lessonReply.body.contentBlocks, 1); assert.equal(lessonReply.body.parts, 1);
    assert.deepEqual(plain(shared.contentFailure(lessonReply.status, lessonReply.body)).refusal.reasons.slice().sort(), ['content', 'parts']);
    const chapterReply = await refused(shared.deleteChapterEdit(t[2]));
    assert.equal(chapterReply.body.kind, 'refused'); assert.equal(chapterReply.body.parts, 1, 'a chapter counts the lessons that stop it'); assert.deepEqual(plain(shared.chapterRefusal(t[2])).parts, 1);
    assert.equal((await tree())[2].lessons.length, 2, 'nothing was removed');
    console.log('PASS screen: a refused delete gives reasons and counts; the read says the same before anyone tries');

    // ---- deletes that go through; a row gone since it was read
    const goner = t[1].lessons[1];
    await send({ action: 'delete_lesson', id: goner.id, updatedAt: goner.updatedAt });
    assert.deepEqual(await refused({ action: 'rename_lesson', id: goner.id, updatedAt: goner.updatedAt, title: 'Gone' }), { status: 409, body: { kind: 'changed' } }, 'a row gone elsewhere');
    assert.deepEqual(await refused({ action: 'delete_lesson', id: goner.id, updatedAt: goner.updatedAt }), { status: 409, body: { kind: 'changed' } });
    t = await tree();
    await send(shared.deleteChapterEdit(t[0])); // Waves, empty
    t = await tree();
    assert.deepEqual(t.map(x => [x.title, x.number]), [['Moving', 1], ['Energy', 2]], 'the rest renumber');
    await send(shared.deleteChapterEdit(t[0])); t = await tree(); // Moving, one lesson left, with its versions
    assert.deepEqual(t.map(x => [x.title, x.number]), [['Energy', 1]]);
    assert.deepEqual(t[0].lessons.map(l => l.label), ['1.1', '1.2'], 'labels follow');
    console.log('PASS screen: delete a lesson and a chapter; the rest renumber; a row gone elsewhere reads as changed');

    // ---- someone with no part in this course
    const denied = await read(stranger).then(() => assert.fail('a stranger must not read'), e => plain(shared.contentReply({ code: e.code, message: e.message, details: e.detail })));
    assert.deepEqual(denied, { status: 403, body: { kind: 'denied' } }, '"Course unavailable" is a refusal, not a change elsewhere');
    const strangerWrite = await refused({ action: 'create_chapter', title: 'Intruder' }, stranger); assert.equal(strangerWrite.status, 403);
    console.log('PASS screen: a stranger reads as denied, on read and on write');

    // ---- archived
    await admin.query("update public.courses set status='archived' where id=$1", [course]);
    s = await read(); assert.deepEqual([s.archived, s.canEdit], [true, false]);
    t = await tree();
    assert.deepEqual(await refused({ action: 'create_chapter', title: 'Late' }), { status: 409, body: { kind: 'archived' } });
    assert.deepEqual(await refused({ action: 'rename_lesson', id: t[0].lessons[0].id, updatedAt: t[0].lessons[0].updatedAt, title: 'Late' }), { status: 409, body: { kind: 'archived' } });
    const archivedReorder = await refused(shared.reorderLessonsEdit(t[0], 0, 1)); assert.equal(archivedReorder.status, 409); assert.equal(archivedReorder.body.kind, 'archived');
    console.log('PASS screen: archived reads read-only and every write is told apart from a stale one');
    console.log('All course content screen checks passed against the real functions (no PostgREST).');
  } finally {
    await c.end();
  }
};
