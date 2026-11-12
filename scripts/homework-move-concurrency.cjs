// Only called by the localhost disposable database harness. No development access.
// Migration 20261112120000_homework_move.sql: a teacher moving a homework against a student starting it, on separate connections, with Firebase
// identities. The move takes both runs FOR SHARE and then the homework FOR UPDATE; a start takes the homework FOR SHARE. So the second one waits:
//   1. move first (to another lesson of the same run): the start waits, then starts the homework in its new lesson;
//   2. start first: the move waits, then is refused with {"reason":"started"} and the homework stays where it was;
//   3. move first to another course's run the student is not in: the start waits, then finds no homework it may see, and nothing is half-done.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], run = randomUUID();
  const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true,
    email: `hmc-${label}-${run}@example.test`, auth_time: Math.floor(Date.now() / 1000), sub: `hmc-${run}-${label}` });
  async function tab(label) {
    const c = await makeClient(); clients.push(c);
    c.pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    c.claim = async () => { await c.query('begin'); await c.query("set local lock_timeout='5s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]); };
    return c;
  }
  async function blocked(c) {
    for (let i = 0; i < 200; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n > 0) return; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Expected a real homework lock wait');
  }
  const value = r => r.rows[0].value;
  const refused = p => p.then(() => null, e => ({ code: e.code, message: e.message, detail: e.detail }));
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const teacher = await tab('teacher'), student = await tab('student');
  try {
    const ids = {};
    for (const [label, c] of [['teacher', teacher], ['student', student]]) { await c.claim(); ids[label] = (await c.query('select public.onboard_firebase_profile() id')).rows[0].id; await c.query('commit'); }
    const org = randomUUID(), phys = randomUUID(), chem = randomUUID(), ch1 = randomUUID(), ch2 = randomUUID(), chc = randomUUID(), l1 = randomUUID(), l2 = randomUUID(), lc = randomUUID(), off = randomUUID(), offc = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic homework move races',$2)", [org, 'hmc-' + run]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, ids.teacher]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values($1,$3,'Synthetic move Physics','hmc-phys','published','private',$4),($2,$3,'Synthetic move Chemistry','hmc-chem','published','private',$4)", [phys, chem, org, ids.teacher]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$4,'One',0),($2,$4,'Two',1),($3,$5,'Atoms',0)", [ch1, ch2, chc, phys, chem]);
    await admin.query("insert into public.lessons(id,module_id,title,position,status) values($1,$4,'Ohm',0,'published'),($2,$5,'Field',0,'published'),($3,$6,'Bonds',0,'published')", [l1, l2, lc, ch1, ch2, chc]);
    await admin.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$3,'Run','scheduled','active'),($2,$4,'Chem run','scheduled','active')", [off, offc, phys, chem]);
    await admin.query("insert into public.enrollments(offering_id,user_id,status) values($1,$2,'active')", [off, ids.student]);

    const definition = () => {
      const q = { q1: randomUUID(), A: randomUUID(), B: randomUUID() };
      return { title: 'Synthetic move race', instructions: '', mode: 'PLATFORM_QUESTIONS', published: true, usesMarks: true, filePoints: 0, modelAnswer: '', solutionVideo: '', solutionVideoId: null,
        referenceIds: [], solutionIds: [], rules: { deadline: new Date(Date.now() + 86400000).toISOString() },
        questions: [{ id: q.q1, type: 'single_choice', text: '', imageId: null, points: 1, responseMode: 'text', modelAnswer: '', options: [{ id: q.A, text: '' }, { id: q.B, text: '' }], correctIds: [q.B] }] };
    };
    const make = async () => {
      const d = definition();
      await teacher.claim();
      const id = value(await teacher.query('select public.save_homework(null,$1,$2,null,null,$3) value', [off, l1, d]));
      await teacher.query('commit');
      return { id, d };
    };
    const revision = async id => Number((await one('select revision from public.homework_assignments where id=$1', [id])).revision);
    const place = async id => one('select offering_id,lesson_id,course_id from public.homework_assignments where id=$1', [id]);
    const move = async (hw, offering, lesson) => teacher.query('select public.save_homework($1,$2,$3,null,$4,$5) value', [hw.id, offering, lesson, await revision(hw.id), hw.d]);
    const start = hw => student.query("select public.homework_work($1,'start') value", [hw.id]);
    const tries = async id => Number((await one('select count(*) n from public.homework_submissions where assignment_id=$1', [id])).n);

    // 1. Move first: the student's start waits on the homework and then starts it in its new lesson.
    let hw = await make();
    await teacher.claim(); await student.claim();
    await move(hw, off, l2);
    let second = start(hw).then(r => value(r), e => ({ code: e.code, message: e.message }));
    await blocked(student); await teacher.query('commit');
    const started = await second; await student.query('commit');
    assert.equal(started.status, 'draft');
    assert.deepEqual(await place(hw.id), { offering_id: off, lesson_id: l2, course_id: phys });
    assert.equal(await tries(hw.id), 1);
    console.log('PASS homework move race: a move beats a start; the start waits and then starts the homework in its new lesson');

    // 2. Start first: the move waits on the homework, then sees the try and is refused; nothing moves.
    hw = await make();
    await teacher.claim(); await student.claim();
    await start(hw);
    second = refused(move(hw, off, l2));
    await blocked(teacher); await student.query('commit');
    const refusal = await second; await teacher.query('rollback');
    assert.equal(refusal.code, 'PT409'); assert.deepEqual(JSON.parse(refusal.detail), { reason: 'started' });
    assert.deepEqual(await place(hw.id), { offering_id: off, lesson_id: l1, course_id: phys });
    assert.equal((await one("select count(*) n from private.homework_audit where assignment_id=$1 and action='moved'", [hw.id])).n, '0');
    console.log('PASS homework move race: a start beats a move; the move waits and is refused with {"reason":"started"}, nothing moves');

    // 3. Move first to another course's run the student is not in: the start waits, then finds no homework it may see.
    hw = await make();
    await teacher.claim(); await student.claim();
    await move(hw, offc, lc);
    second = start(hw).then(() => null, e => ({ code: e.code }));
    await blocked(student); await teacher.query('commit');
    assert.deepEqual(await second, { code: '42501' }); await student.query('rollback');
    assert.deepEqual(await place(hw.id), { offering_id: offc, lesson_id: lc, course_id: chem });
    assert.equal(await tries(hw.id), 0);
    console.log('PASS homework move race: a move to another course beats a start; the start is refused and leaves no try');
    console.log('All 3 independent-session homework move races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
