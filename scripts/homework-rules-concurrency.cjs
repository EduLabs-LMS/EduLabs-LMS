// Only called by the localhost disposable database harness. No development access.
// The owner's homework rules (migration 20261109120000_homework_teacher_rules.sql) under real waits, on separate connections, with Firebase
// identities: two graders, a release against a grade, two tabs handing in the same try, two tabs asking for the next try, and a hand-in that
// waits past the deadline (refused when late hand-ins are off, flagged late when they are on). The owner's answers 1 and 2: a bulk release
// against a grade (both orders), two bulk releases sharing a try, and a reschedule against a hand-in at the old deadline (both orders).
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], run = randomUUID();
  const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true,
    email: `hrc-${label}-${run}@example.test`, auth_time: Math.floor(Date.now() / 1000), sub: `hrc-${run}-${label}` });
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
  const work = (c, id, action, sub = null, revision = null, data = {}) => c.query('select public.homework_work($1,$2,$3,$4,$5) value', [id, action, sub, revision, data]);
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const teacher = await tab('teacher'), ta = await tab('ta'), s1 = await tab('s1'), s1b = await tab('s1'), s2 = await tab('s2'), s3 = await tab('s3');
  try {
    const ids = {};
    for (const [label, c] of [['teacher', teacher], ['ta', ta], ['s1', s1], ['s2', s2], ['s3', s3]]) { await c.claim(); ids[label] = (await c.query('select public.onboard_firebase_profile() id')).rows[0].id; await c.query('commit'); }
    const org = randomUUID(), course = randomUUID(), chapter = randomUUID(), lesson = randomUUID(), off = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic homework races',$2)", [org, 'hrc-' + run]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now()),($1,$3,'assistant','active',now())", [org, ids.teacher, ids.ta]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values($1,$2,'Synthetic homework races','hrc-races','published','private',$3)", [course, org, ids.teacher]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$2,'Chapter',0)", [chapter, course]);
    await admin.query("insert into public.lessons(id,module_id,title,position,status) values($1,$2,'Lesson',0,'published')", [lesson, chapter]);
    await admin.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$2,'Run','scheduled','active')", [off, course]);
    await admin.query("insert into public.offering_staff(offering_id,user_id,role) values($1,$2,'teaching_assistant')", [off, ids.ta]);
    await admin.query("insert into public.enrollments(offering_id,user_id,status) values($1,$2,'active'),($1,$3,'active'),($1,$4,'active')", [off, ids.s1, ids.s2, ids.s3]);

    // One questions-only homework: a textbook question (A to D, B right) and an essay.
    const make = async rules => {
      const q = { q1: randomUUID(), A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID(), q2: randomUUID() };
      const definition = { title: 'Synthetic race homework', instructions: '', mode: 'PLATFORM_QUESTIONS', published: true, usesMarks: true, filePoints: 10, modelAnswer: '', solutionVideo: '', solutionVideoId: null,
        referenceIds: [], solutionIds: [], rules: { deadline: new Date(Date.now() + 86400000).toISOString(), ...rules },
        questions: [
          { id: q.q1, type: 'single_choice', text: '', imageId: null, points: 2, responseMode: 'text', modelAnswer: '', options: ['A', 'B', 'C', 'D'].map(k => ({ id: q[k], text: '' })), correctIds: [q.B] },
          { id: q.q2, type: 'essay', text: 'Explain', imageId: null, points: 6, responseMode: 'text', modelAnswer: '', options: [], correctIds: [] }] };
      await teacher.claim();
      const id = value(await teacher.query('select public.save_homework(null,$1,$2,null,null,$3) value', [off, lesson, definition]));
      await teacher.query('commit');
      return { id, q };
    };
    const answer = (q, letter, text) => ({ fileIds: [], answers: [{ questionId: q.q1, optionIds: [q[letter]], text: '', fileIds: [] }, { questionId: q.q2, optionIds: [], text, fileIds: [] }] });
    const rev = async s => Number((await one('select revision from public.homework_submissions where id=$1', [s])).revision);
    const crev = async s => Number((await one('select revision from private.homework_corrections where submission_id=$1', [s])).revision);
    // A student hands in one try, committed.
    const hand = async (c, hw, letter = 'B', text = 'An answer', retryOf = null) => {
      await c.claim();
      const draft = value(await (retryOf ? work(c, hw.id, 'retry', retryOf) : work(c, hw.id, 'start')));
      const saved = value(await work(c, hw.id, 'save', draft.id, draft.revision, answer(hw.q, letter, text)));
      await work(c, hw.id, 'submit', draft.id, saved.revision);
      await c.query('commit');
      return draft.id;
    };
    const grading = (hw, points) => ({ marks: [{ questionId: hw.q.q2, points, feedback: 'Checked' }], feedback: 'Checked' });

    // 1. Two graders (the teacher and an assistant) correct the same try from the same revision: one stands, the other is stale.
    const hw = await make({ tries: 'fix_mistakes', maxTries: 3, solutionsOpen: 'after_deadline' });
    const try1 = await hand(s1, hw, 'B', 'First try');
    let r0 = await crev(try1);
    await teacher.claim(); await ta.claim();
    await work(teacher, hw.id, 'grade', try1, r0, grading(hw, 4));
    let second = refused(work(ta, hw.id, 'grade', try1, r0, grading(hw, 5)));
    await blocked(ta); await teacher.query('commit');
    assert.equal((await second).code, 'PT409'); await ta.query('rollback');
    let mark = await one('select points::int p from private.homework_marks where submission_id=$1 and question_id=$2', [try1, hw.q.q2]);
    assert.equal(mark.p, 4);
    assert.equal(Number((await one("select count(*) n from private.homework_audit where submission_id=$1 and action='grade'", [try1])).n), 1);
    console.log('PASS homework rules race: two graders on one try, the first grade stands and the second is stale');

    // 2. A release (by the assistant, who has the release right by default) against a regrade by the teacher from the same revision.
    r0 = await crev(try1);
    await ta.claim(); await teacher.claim();
    await work(ta, hw.id, 'release', try1, r0, { status: 'approved' });
    second = refused(work(teacher, hw.id, 'grade', try1, r0, grading(hw, 6)));
    await blocked(teacher); await ta.query('commit');
    assert.equal((await second).code, 'PT409'); await teacher.query('rollback');
    let corr = await one('select released_at is not null released,score::int score from private.homework_corrections where submission_id=$1', [try1]);
    assert.equal(corr.released, true); assert.equal(corr.score, 6); // 4 for the essay + 2 for the right textbook answer
    // The other order: the grade waits for nobody, then the release from the old revision is stale.
    r0 = await crev(try1);
    await teacher.claim(); await ta.claim();
    await work(teacher, hw.id, 'grade', try1, r0, { ...grading(hw, 5), reason: 'Second look' });
    second = refused(work(ta, hw.id, 'release', try1, r0, { status: 'approved' }));
    await blocked(ta); await teacher.query('commit');
    assert.equal((await second).code, 'PT409'); await ta.query('rollback');
    corr = await one('select released_at is null unreleased,score::int score from private.homework_corrections where submission_id=$1', [try1]);
    assert.equal(corr.unreleased, true); assert.equal(corr.score, 7);
    console.log('PASS homework rules race: a release and a grade from the same revision, whichever commits first stands, both orders');
    await teacher.claim(); await work(teacher, hw.id, 'release', try1, await crev(try1), { status: 'approved' }); await teacher.query('commit');

    // 3. Two tabs of the same student ask for the next try: one try 2, with the right textbook answer kept once.
    await s1.claim(); await s1b.claim();
    const next = value(await work(s1, hw.id, 'retry', try1));
    const nextPending = work(s1b, hw.id, 'retry', try1);
    await blocked(s1b); await s1.query('commit');
    assert.equal(value(await nextPending).id, next.id); await s1b.query('commit');
    assert.equal(next.number, 2);
    assert.equal(Number((await one('select count(*) n from public.homework_submissions where assignment_id=$1 and user_id=$2', [hw.id, ids.s1])).n), 2);
    assert.equal(Number((await one('select count(*) n from private.homework_carried where submission_id=$1', [next.id])).n), 1);
    console.log('PASS homework rules race: two tabs ask for the next try, one try 2 exists, the right answer kept once');

    // 4. Two tabs hand in the same try: one hand-in, one correction row, kept marks copied once.
    await s1.claim();
    await work(s1, hw.id, 'save', next.id, await rev(next.id), answer(hw.q, 'B', 'Second try'));
    await s1.query('commit');
    const r2 = await rev(next.id);
    await s1.claim(); await s1b.claim();
    await work(s1, hw.id, 'submit', next.id, r2);
    const doubleSubmit = work(s1b, hw.id, 'submit', next.id, r2);
    await blocked(s1b); await s1.query('commit');
    assert.equal(value(await doubleSubmit).id, next.id); await s1b.query('commit');
    assert.equal(Number((await one('select count(*) n from private.homework_corrections where submission_id=$1', [next.id])).n), 1);
    assert.equal(Number((await one("select count(*) n from private.homework_audit where submission_id=$1 and action='submitted'", [next.id])).n), 1);
    assert.equal(Number((await one('select count(*) n from private.homework_marks where submission_id=$1 and question_id=$2 and points=2', [next.id, hw.q.q1])).n), 1);
    console.log('PASS homework rules race: two tabs hand in the same try, it is handed in once');

    // 5. A hand-in that waits past the deadline, late hand-ins off: refused with the stable message, nothing handed in.
    const closing = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: false });
    await s2.claim();
    const started = value(await work(s2, closing.id, 'start')), draft = started.id;
    await work(s2, closing.id, 'save', draft, started.revision, answer(closing.q, 'A', 'Just in time'));
    await s2.query('commit');
    await admin.query("update public.homework_assignments set deadline_at=clock_timestamp()+interval '1.5 seconds' where id=$1", [closing.id]);
    const dr = await rev(draft);
    const holder = await makeClient(); clients.push(holder);
    await holder.query('begin'); await holder.query('select id from public.homework_submissions where id=$1 for update', [draft]);
    await s2.claim();
    let late = refused(work(s2, closing.id, 'submit', draft, dr));
    await blocked(s2);
    await new Promise(r => setTimeout(r, 1800));
    await holder.query('commit');
    late = await late;
    assert.equal(late.code, 'PT409'); assert.equal(late.message, 'Deadline passed'); assert.deepEqual(JSON.parse(late.detail), { reason: 'deadline_passed' });
    await s2.query('rollback');
    assert.equal((await one('select status from public.homework_submissions where id=$1', [draft])).status, 'draft');
    console.log('PASS homework rules race: a hand-in that waits past the deadline is refused, "Deadline passed"');

    // 6. The same with late hand-ins on: it is handed in, flagged late.
    const lateOk = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: true });
    await s2.claim();
    const started2 = value(await work(s2, lateOk.id, 'start')), draft2 = started2.id;
    await work(s2, lateOk.id, 'save', draft2, started2.revision, answer(lateOk.q, 'B', 'A little late'));
    await s2.query('commit');
    await admin.query("update public.homework_assignments set deadline_at=clock_timestamp()+interval '1.5 seconds' where id=$1", [lateOk.id]);
    const dr2 = await rev(draft2);
    await holder.query('begin'); await holder.query('select id from public.homework_submissions where id=$1 for update', [draft2]);
    await s2.claim();
    const handedLate = work(s2, lateOk.id, 'submit', draft2, dr2);
    await blocked(s2);
    await new Promise(r => setTimeout(r, 1800));
    await holder.query('commit');
    assert.equal(value(await handedLate).missedDeadline, true); await s2.query('commit');
    const row = await one('select status,missed_deadline,submitted_at>(select deadline_at from public.homework_assignments where id=$2) after from public.homework_submissions where id=$1', [draft2, lateOk.id]);
    assert.deepEqual(row, { status: 'submitted', missed_deadline: true, after: true });
    console.log('PASS homework rules race: with late hand-ins on, a hand-in that waits past the deadline is handed in, flagged late');

    // 7. Its next try is refused: the deadline passed and late covers the first hand-in only (a one-time homework has no tries left anyway).
    await s2.claim();
    const noMore = await refused(work(s2, lateOk.id, 'retry', draft2));
    await s2.query('rollback');
    assert.equal(noMore.code, 'PT409'); assert.equal(noMore.message, 'Deadline passed');
    console.log('PASS homework rules race: after a late hand-in no further try opens');
    // The owner's answers 1 and 2: bulk release and reschedule, under real waits.
    const bulk = (c, hw, items) => c.query('select public.homework_release_many($1,$2) value', [hw.id, JSON.stringify(items)]);
    const item = async s => ({ submissionId: s, revision: await crev(s) });
    const released = async list => (await admin.query('select submission_id from private.homework_corrections where submission_id=any($1::uuid[]) and released_at is not null', [list])).rows.map(r => r.submission_id).sort();
    // Three students hand in and the teacher grades them, unreleased.
    const corrected = async () => {
      const h = await make({ tries: 'fix_mistakes', maxTries: 3, solutionsOpen: 'after_deadline' });
      const t = [await hand(s1, h, 'B', 'Bulk one'), await hand(s2, h, 'B', 'Bulk two'), await hand(s3, h, 'B', 'Bulk three')];
      for (const s of t) { await teacher.claim(); await work(teacher, h.id, 'grade', s, await crev(s), grading(h, 3)); await teacher.query('commit'); }
      return { h, t: [...t].sort() };
    };

    // 8. A bulk release against a grade of one of its tries, both orders: whichever commits first stands, nothing is half-applied.
    let b = await corrected();
    let [t1, t2, t3] = b.t;
    let items = [await item(t1), await item(t3)];
    await teacher.claim(); await ta.claim();
    await work(teacher, b.h.id, 'grade', t3, items[1].revision, grading(b.h, 5));
    let pending = refused(bulk(ta, b.h, items));
    await blocked(ta); await teacher.query('commit');
    let failed = await pending; await ta.query('rollback');
    assert.equal(failed.code, 'PT409'); assert.equal(JSON.parse(failed.detail).reason, 'stale');
    assert.deepEqual(await released(b.t), [], 'the grade stands and the bulk release released nothing, not even its other try');
    assert.equal((await one('select score::int s from private.homework_corrections where submission_id=$1', [t3])).s, 7);
    items = [await item(t1), await item(t2)];
    await ta.claim(); await teacher.claim();
    const done = value(await bulk(ta, b.h, items));
    pending = refused(work(teacher, b.h.id, 'grade', t2, items[1].revision, grading(b.h, 6)));
    await blocked(teacher); await ta.query('commit');
    failed = await pending; await teacher.query('rollback');
    assert.equal(done.released, 2); assert.equal(failed.code, 'PT409');
    assert.deepEqual(await released(b.t), [t1, t2].sort());
    assert.equal((await one('select score::int s from private.homework_corrections where submission_id=$1', [t2])).s, 5, 'the stale grade changed nothing');
    console.log('PASS homework rules race: a bulk release and a grade of the same try, whichever commits first stands, both orders');

    // 9. Two bulk releases sharing a try, the second listing them in the other order: no deadlock, the second is refused whole.
    b = await corrected();
    [t1, t2, t3] = b.t;
    const first = [await item(t1), await item(t2)], other = [await item(t3), await item(t2)];
    await ta.claim(); await teacher.claim();
    assert.equal(value(await bulk(ta, b.h, first)).released, 2);
    pending = refused(bulk(teacher, b.h, other));
    await blocked(teacher); await ta.query('commit');
    failed = await pending; await teacher.query('rollback');
    assert.equal(failed.code, 'PT409');
    assert.deepEqual(await released(b.t), [t1, t2].sort(), 'the third try stays unreleased');
    assert.equal(Number((await one("select count(*) n from private.homework_audit where assignment_id=$1 and action='release' and reason='bulk release'", [b.h.id])).n), 2);
    console.log('PASS homework rules race: two bulk releases sharing a try, the first stands and the second releases nothing');

    // 10. A reschedule holds the homework while the old deadline passes; the waiting hand-in counts under the new deadline (late off).
    const resched = (hw, deadline) => one('select revision from public.homework_assignments where id=$1', [hw.id])
      .then(r => teacher.query("select public.homework_lifecycle($1,'reschedule',$2,$3) value", [hw.id, r.revision, { deadline }]));
    const moved = await make({ tries: 'fix_mistakes', maxTries: 3, solutionsOpen: 'after_deadline', lateAllowed: false });
    await s2.claim();
    const st = value(await work(s2, moved.id, 'start'));
    await work(s2, moved.id, 'save', st.id, st.revision, answer(moved.q, 'B', 'At the old deadline'));
    await s2.query('commit');
    await admin.query("update public.homework_assignments set deadline_at=clock_timestamp()+interval '1.5 seconds' where id=$1", [moved.id]);
    const sr = await rev(st.id);
    await teacher.claim();
    await resched(moved, new Date(Date.now() + 86400000).toISOString());
    await s2.claim();
    const waiting = work(s2, moved.id, 'submit', st.id, sr);
    await blocked(s2);
    await new Promise(r => setTimeout(r, 1800));
    await teacher.query('commit');
    assert.equal(value(await waiting).missedDeadline, false); await s2.query('commit');
    assert.deepEqual(await one('select status,missed_deadline from public.homework_submissions where id=$1', [st.id]), { status: 'submitted', missed_deadline: false });
    console.log('PASS homework rules race: a hand-in waiting on a reschedule past the old deadline is on time under the new one');

    // 11. The other order: a hand-in holds the homework past the old deadline, the reschedule waits, then records that student
    // (solutions opened at the old deadline), so the extension gives them no further try.
    const held = await make({ tries: 'fix_mistakes', maxTries: 3, solutionsOpen: 'after_deadline', lateAllowed: false });
    await s3.claim();
    const st3 = value(await work(s3, held.id, 'start'));
    await work(s3, held.id, 'save', st3.id, st3.revision, answer(held.q, 'A', 'Just before'));
    await s3.query('commit');
    await admin.query("update public.homework_assignments set deadline_at=clock_timestamp()+interval '1.5 seconds' where id=$1", [held.id]);
    await s3.claim();
    await work(s3, held.id, 'submit', st3.id, await rev(st3.id));
    await new Promise(r => setTimeout(r, 1800));
    await teacher.claim();
    pending = resched(held, new Date(Date.now() + 86400000).toISOString());
    await blocked(teacher); await s3.query('commit');
    await pending; await teacher.query('commit');
    assert.equal(Number((await one('select count(*) n from private.homework_solutions_seen where assignment_id=$1 and user_id=$2', [held.id, ids.s3])).n), 1);
    await s3.claim();
    const ended = await refused(work(s3, held.id, 'retry', st3.id));
    await s3.query('rollback');
    assert.equal(ended.code, 'PT409'); assert.deepEqual(JSON.parse(ended.detail), { reason: 'no_tries_left' });
    assert.equal((await one('select missed_deadline from public.homework_submissions where id=$1', [st3.id])).missed_deadline, false);
    console.log('PASS homework rules race: a reschedule waiting on a hand-in past the old deadline ends that student\'s tries');
    console.log('All 11 independent-session homework rules races passed.');
  } finally {
    await Promise.all(clients.map(async c => { try { await c.query('rollback'); } finally { await c.end(); } }));
  }
};
