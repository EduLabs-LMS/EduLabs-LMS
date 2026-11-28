// Only called by the localhost disposable database harness. No development access.
// Fix track 3 (migration 20261128140000_full_time_rule.sql): the full-time rule and Protect answers, on separate connections with Firebase
// identities, as the owner asked (proofs a to g):
//  a. The exam closes while student A writes (started before the close, 60-minute limit): A saves and hands in after the close; B, who handed
//     in earlier, gets no review (Protect ON), no release and no notice until A hands in, or until A's deadline passes; then each happens once,
//     even with two readers at the same moment.
//  b. Protect OFF: B's review opens right after B's own hand-in; A never sees a try-1 review while A's try 2 is in progress.
//  c. The fix-mistakes try 2 shows the kept answers, Protect ON and OFF.
//  d. Archive and unpublish are refused with students_writing while A writes, and accepted after (there is no exam delete action).
//  e. A start or a retry after the close is still refused (deadline_passed); a start before the opening still not_open.
//  f. Homework: the 30-minute grace for a try started before the deadline, the classmate's solutions at the deadline, and no solutions for the
//     student whose own try 2 is a draft in its grace.
//  g. The 41st ready unreferenced photo is refused (homework and exam); the 40 are listed by the expired views once older than a day.
// Times that would take 20 to 60 minutes of waiting are set on synthetic rows (deadline, start); every lock wait is a real one.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], run = randomUUID();
  const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true,
    email: `ftr-${label}-${run}@example.test`, auth_time: Math.floor(Date.now() / 1000), sub: `ftr-${run}-${label}` });
  async function tab(label) {
    const c = await makeClient(); clients.push(c);
    c.pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    c.claim = async () => { await c.query('begin'); await c.query("set local lock_timeout='8s'"); await c.query("set local statement_timeout='8s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]); };
    return c;
  }
  async function blocked(c) {
    for (let i = 0; i < 300; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n > 0) return; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Expected a real lock wait');
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const value = r => r.rows[0].value;
  const refused = p => p.then(() => null, e => ({ code: e.code, reason: e.detail && e.detail.startsWith('{') ? JSON.parse(e.detail).reason : null, message: e.message }));
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const n = async (sql, args) => Number((await one(sql, args)).n);
  const iso = ms => new Date(Date.now() + ms).toISOString();
  const labels = ['teacher', 'A', 'B', 'C', 'D', 'E'];
  const t = {}; for (const l of labels) t[l] = await tab(l);
  // One statement in its own committed transaction, as a browser request is.
  const as = async (who, sql, args) => { const c = t[who]; await c.claim(); try { const r = await c.query(sql, args); await c.query('commit'); return r.rows[0] && r.rows[0].value; } catch (e) { await c.query('rollback'); throw e; } };
  const get = (who, exam, attempt = null) => as(who, 'select public.exam_get($1,$2) value', [exam, attempt]);
  const work = (who, exam, action, revision = null, data = {}) => as(who, 'select public.exam_work($1,$2,$3,$4) value', [exam, action, revision, data]);
  try {
    const ids = {};
    for (const l of labels) { await t[l].claim(); ids[l] = (await t[l].query('select public.onboard_firebase_profile() id')).rows[0].id; await t[l].query('commit'); }
    const org = randomUUID(), course = randomUUID(), chapter = randomUUID(), lesson = randomUUID(), off = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic full-time races',$2)", [org, 'ftr-' + run]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now())", [org, ids.teacher]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values($1,$2,'Synthetic full-time races','ftr-races','published','private',$3)", [course, org, ids.teacher]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$2,'Chapter',0)", [chapter, course]);
    await admin.query("insert into public.lessons(id,module_id,title,position,status) values($1,$2,'Lesson',0,'published')", [lesson, chapter]);
    await admin.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$2,'Run','scheduled','active')", [off, course]);
    await admin.query("insert into public.enrollments(offering_id,user_id,status) select $1,x,'active' from unnest($2::uuid[]) x", [off, [ids.A, ids.B, ids.C, ids.D, ids.E]]);

    // ------------------------------------------------------------------------------------------------------------------------------- exams
    const questions = [{ type: 'choice', text: 'Pick B', points: 2, options: ['A', 'B'], correct: [1] }, { type: 'choice', text: 'Pick A', points: 2, options: ['A', 'B'], correct: [0] }];
    // A same-time exam, published, then its window set on the row (exam_save refuses a past opening).
    const exam = async (rules, opens, closes) => {
      await t.teacher.claim();
      const id = value(await t.teacher.query('select public.exam_save(null,$1,null,$2) value', [off, { kind: 'online', title: 'Full-time race', timing: 'same_time', opensAt: iso(60000), closesAt: iso(3 * 3600000), questions, ...rules }])).id;
      await t.teacher.query("select public.exam_lifecycle($1,'publish',1)", [id]); await t.teacher.query('commit');
      await admin.query('update private.exams set opens_at=$2,closes_at=$3 where id=$1', [id, opens, closes]);
      return id;
    };
    const opts = async id => (await admin.query('select q.position,o.position op,o.id from private.exam_questions q join private.exam_options o on o.question_id=q.id where q.exam_id=$1 order by 1,2', [id])).rows;
    const answerAll = async (who, id, attempt, right = true) => {
      const o = await opts(id); let rev = Number((await one('select revision from private.exam_attempts where id=$1', [attempt])).revision);
      for (const [q, pick] of [[0, right ? 1 : 0], [1, right ? 0 : 1]]) {
        const opt = o.find(x => x.position === q && x.op === pick).id, qid = (await one('select id from private.exam_questions where exam_id=$1 and position=$2', [id, q])).id;
        rev = Number((await work(who, id, 'save', rev, { attemptId: attempt, questionId: qid, optionIds: [opt] })).revision);
      }
      return rev;
    };
    const handIn = async (who, id, retry = false, right = true) => {
      const tr = await work(who, id, retry ? 'retry' : 'start'); const rev = await answerAll(who, id, tr.id, right);
      return work(who, id, 'submit', rev, { attemptId: tr.id });
    };
    const keyed = attempt => attempt.items.some(i => 'correctOptionIds' in i);
    const notices = id => n("select count(*) n from private.notification_events v join private.exam_results r on r.id=v.resource_id where v.event_type='exam_released' and r.exam_id=$1", [id]);
    const audits = id => n("select count(*) n from private.exam_audit where exam_id=$1 and action='auto_release'", [id]);
    const released = id => n('select count(*) n from private.exam_results where exam_id=$1 and released_at is not null', [id]);

    // a. Protect ON (the default), auto-release on. The window closes in 4 seconds; A starts now with 60 minutes, B hands in before the close.
    const ex1 = await exam({ timeLimitMinutes: 60, autoRelease: true }, new Date(Date.now() - 600000), new Date(Date.now() + 4000));
    assert.equal((await one('select protect_answers from private.exams where id=$1', [ex1])).protect_answers, true, 'Protect answers is ON by default');
    const aTry = await work('A', ex1, 'start');
    assert.ok(new Date(aTry.deadlineAt) - new Date((await one('select closes_at from private.exams where id=$1', [ex1])).closes_at) > 55 * 60000, 'A has the full 60 minutes, past the close');
    const bTry = await handIn('B', ex1);
    await sleep(Math.max(0, new Date((await one('select closes_at from private.exams where id=$1', [ex1])).closes_at) - Date.now() + 300));
    let bView = await get('B', ex1, bTry.id);
    assert.equal(bView.closed, false); assert.equal(bView.reviewOpen, false); assert.equal(keyed(bView.attempt), false, 'no right answers for B');
    assert.deepEqual(bView.result, { waiting: true }, 'no released result while A writes');
    await get('teacher', ex1); // a staff read runs the exam-wide settle: still nothing to release
    assert.equal(await released(ex1), 0); assert.equal(await notices(ex1), 0); assert.equal(await audits(ex1), 0);
    // A saves after the close, then hands in on one connection while B reads on another: B's read does not wait and sees no review.
    const aRev = await answerAll('A', ex1, aTry.id);
    await t.A.claim(); await t.A.query('select public.exam_work($1,$2,$3,$4)', [ex1, 'submit', aRev, { attemptId: aTry.id }]);
    bView = await get('B', ex1, bTry.id);
    assert.equal(bView.reviewOpen, false, 'A has not committed the hand-in yet'); assert.equal(await released(ex1), 0);
    await t.A.query('commit');
    // Now the exam is over. B and C read at the same moment: one of them releases, once; one audit row; one notice per result.
    const [rb, rc] = await Promise.all([get('B', ex1, bTry.id), get('C', ex1).catch(e => e)]);
    const relOnce = await released(ex1);
    assert.equal(rb.closed, true); assert.equal(rb.reviewOpen, true); assert.equal(keyed(rb.attempt), true, 'B sees the right answers once A has handed in');
    assert.equal(relOnce, 2); assert.equal(await audits(ex1), 1); assert.equal(await notices(ex1), 2);
    await get('B', ex1); await get('A', ex1); await get('teacher', ex1);
    assert.equal(await audits(ex1), 1); assert.equal(await notices(ex1), 2, 'later reads release and notify nothing again');
    console.log('PASS full-time race a: A writes past the close; B gets no review, release or notice until A hands in; then each happens once');
    void rc;

    // a (second half). The same, but A never hands in: once A's deadline passes, the next read hands A in, then releases, once.
    const ex1b = await exam({ timeLimitMinutes: 60, autoRelease: true }, new Date(Date.now() - 600000), new Date(Date.now() + 3000));
    const a2 = await work('A', ex1b, 'start'); const b2 = await handIn('B', ex1b);
    await sleep(Math.max(0, new Date((await one('select closes_at from private.exams where id=$1', [ex1b])).closes_at) - Date.now() + 300));
    assert.equal((await get('B', ex1b, b2.id)).reviewOpen, false); assert.equal(await released(ex1b), 0);
    // 60 minutes later (set on the try): the deadline has passed.
    await admin.query("update private.exam_attempts set started_at=now()-interval '61 minutes',deadline_at=now()-interval '1 minute' where id=$1", [a2.id]);
    const [x1, x2] = await Promise.all([get('B', ex1b, b2.id), get('C', ex1b).catch(e => e)]); void x2;
    assert.equal(x1.reviewOpen, true); assert.equal((await one('select status,auto_submitted from private.exam_attempts where id=$1', [a2.id])).auto_submitted, true);
    assert.equal(await released(ex1b), 2); assert.equal(await audits(ex1b), 1); assert.equal(await notices(ex1b), 2);
    await get('B', ex1b); assert.equal(await notices(ex1b), 2);
    console.log('PASS full-time race a: when A\'s deadline passes the next read hands A in and releases, once; no second notice');

    // b. Protect OFF, fix-mistakes, the window open for two hours.
    const ex2 = await exam({ timeLimitMinutes: 60, tries: 'fix_mistakes', protectAnswers: false }, new Date(Date.now() - 600000), new Date(Date.now() + 2 * 3600000));
    const b3 = await handIn('B', ex2);
    const bOff = await get('B', ex2, b3.id);
    assert.equal(bOff.protectAnswers, false); assert.equal(bOff.closed, false); assert.equal(bOff.reviewOpen, true); assert.equal(keyed(bOff.attempt), true, 'B\'s review right after B\'s hand-in');
    const a3 = await handIn('A', ex2, false, false);
    assert.equal((await get('A', ex2, a3.id)).reviewOpen, true, 'A\'s review after A\'s own hand-in');
    const a3b = await work('A', ex2, 'retry');
    const aDuring = await get('A', ex2, a3.id);
    assert.equal(aDuring.reviewOpen, false); assert.equal(keyed(aDuring.attempt), false, 'no try-1 review while try 2 is in progress');
    // c (OFF). The kept answers of try 2: A got question 1 wrong and question 2 wrong; B-style right answers are kept, so here hand in try 1
    // half right on a fresh student to see one kept answer.
    const d1 = await work('D', ex2, 'start'); const o2 = await opts(ex2);
    const q0 = (await one('select id from private.exam_questions where exam_id=$1 and position=0', [ex2])).id;
    let dr = Number((await work('D', ex2, 'save', d1.revision, { attemptId: d1.id, questionId: q0, optionIds: [o2.find(x => x.position === 0 && x.op === 1).id] })).revision);
    await work('D', ex2, 'submit', dr, { attemptId: d1.id });
    const d2 = await work('D', ex2, 'retry');
    const kept = d2.items.filter(i => i.answer && i.answer.kept).map(i => i.position);
    assert.deepEqual(kept, [0], 'Protect OFF: try 2 keeps the right answer of try 1'); assert.equal(keyed(d2), false);
    await work('A', ex2, 'submit', a3b.revision, { attemptId: a3b.id });
    console.log('PASS full-time race b: Protect OFF opens B\'s review at B\'s hand-in; A sees no try-1 review while try 2 is in progress');

    // c (ON). The same on a Protect ON exam.
    const ex3 = await exam({ timeLimitMinutes: 60, tries: 'fix_mistakes' }, new Date(Date.now() - 600000), new Date(Date.now() + 2 * 3600000));
    const e1 = await work('E', ex3, 'start'); const o3 = await opts(ex3);
    const q30 = (await one('select id from private.exam_questions where exam_id=$1 and position=0', [ex3])).id;
    dr = Number((await work('E', ex3, 'save', e1.revision, { attemptId: e1.id, questionId: q30, optionIds: [o3.find(x => x.position === 0 && x.op === 1).id] })).revision);
    await work('E', ex3, 'submit', dr, { attemptId: e1.id });
    assert.equal((await get('E', ex3, e1.id)).reviewOpen, false, 'Protect ON: no review while the window is open');
    const e2 = await work('E', ex3, 'retry');
    assert.deepEqual(e2.items.filter(i => i.answer && i.answer.kept).map(i => i.position), [0], 'Protect ON: try 2 keeps the right answer of try 1');
    console.log('PASS full-time race c: the fix-mistakes try 2 shows the kept answers, Protect ON and OFF');

    // d. Archive and unpublish while students write. ex3: E's try 2 is in progress and the window is open.
    const life = async (id, action) => { const r = Number((await one('select revision from private.exams where id=$1', [id])).revision); return as('teacher', 'select public.exam_lifecycle($1,$2,$3) value', [id, action, r]); };
    let no = await refused(life(ex3, 'archive')); assert.equal(no.code, 'PT409'); assert.equal(no.reason, 'students_writing'); assert.equal(no.message, 'Students are still writing');
    no = await refused(life(ex3, 'unpublish')); assert.equal(no.code, 'PT409'); assert.equal(no.reason, 'students_writing');
    // The window closed, E still writing past it (the full time): still refused.
    await admin.query("update private.exams set closes_at=now()-interval '1 second' where id=$1", [ex3]);
    no = await refused(life(ex3, 'archive')); assert.equal(no.reason, 'students_writing', 'refused while E writes past the close');
    // E hands in on one connection; the archive waits for nothing and is still refused until that commits, then accepted.
    await work('E', ex3, 'submit', e2.revision, { attemptId: e2.id });
    assert.equal((await life(ex3, 'archive')).status, 'archived');
    // Unpublish: an exam nobody started, refused while its window is open, accepted once it closed.
    const ex4 = await exam({ timeLimitMinutes: 30 }, new Date(Date.now() - 600000), new Date(Date.now() + 3600000));
    no = await refused(life(ex4, 'unpublish')); assert.equal(no.reason, 'students_writing');
    await admin.query("update private.exams set closes_at=now()-interval '1 second' where id=$1", [ex4]);
    assert.equal((await life(ex4, 'unpublish')).status, 'draft');
    console.log('PASS full-time race d: archive and unpublish are refused with students_writing while students write, accepted after');

    // A teacher's archive and a student's hand-in at the same moment: the archive takes the exam row after the student's FOR SHARE.
    const ex5 = await exam({ timeLimitMinutes: 60 }, new Date(Date.now() - 600000), new Date(Date.now() - 1000 + 4000));
    const c5 = await work('C', ex5, 'start'); await sleep(4200);
    await t.C.claim(); await t.C.query('select public.exam_work($1,$2,$3,$4)', [ex5, 'submit', c5.revision, { attemptId: c5.id }]);
    const r5 = Number((await one('select revision from private.exams where id=$1', [ex5])).revision);
    await t.teacher.claim(); const arch = refused(t.teacher.query("select public.exam_lifecycle($1,'archive',$2) value", [ex5, r5]));
    await blocked(t.teacher); await t.C.query('commit'); const archived = await arch;
    if (archived) { await t.teacher.query('rollback'); throw new Error('archive after the hand-in: ' + JSON.stringify(archived)); } await t.teacher.query('commit');
    assert.equal((await one('select status from private.exams where id=$1', [ex5])).status, 'archived');
    console.log('PASS full-time race d: an archive waiting on the last hand-in is accepted once it commits');

    // e. Starts and retries at or after the close are refused as before; before the opening, not_open.
    const ex6 = await exam({ timeLimitMinutes: 60, tries: 'fix_mistakes' }, new Date(Date.now() - 600000), new Date(Date.now() + 3000));
    const b6 = await handIn('B', ex6); void b6; await sleep(3300);
    no = await refused(work('A', ex6, 'start')); assert.equal(no.code, 'PT409'); assert.equal(no.reason, 'deadline_passed');
    no = await refused(work('B', ex6, 'retry')); assert.equal(no.reason, 'deadline_passed');
    const ex7 = await exam({ timeLimitMinutes: 60 }, new Date(Date.now() + 3600000), new Date(Date.now() + 7200000));
    no = await refused(work('A', ex7, 'start')); assert.equal(no.reason, 'not_open');
    assert.equal(await n('select count(*) n from private.exam_attempts where exam_id=any($1) and user_id=$2', [[ex6, ex7], ids.A]), 0);
    console.log('PASS full-time race e: a start or retry after the close is still deadline_passed; before the opening, not_open');

    // ------------------------------------------------------------------------------------------------------------------------------ homework
    const make = async rules => {
      const q = { q1: randomUUID(), A: randomUUID(), B: randomUUID(), q2: randomUUID() };
      const definition = { title: 'Synthetic grace homework', instructions: '', mode: 'PLATFORM_QUESTIONS', published: true, usesMarks: true, filePoints: 10, modelAnswer: 'The model answer', solutionVideo: '', solutionVideoId: null,
        referenceIds: [], solutionIds: [], rules: { deadline: iso(86400000), ...rules },
        questions: [{ id: q.q1, type: 'single_choice', text: '', imageId: null, points: 2, responseMode: 'text', modelAnswer: '', options: ['A', 'B'].map(k => ({ id: q[k], text: '' })), correctIds: [q.B] },
          { id: q.q2, type: 'essay', text: 'Explain', imageId: null, points: 6, responseMode: 'text', modelAnswer: '', options: [], correctIds: [] }] };
      const id = await as('teacher', 'select public.save_homework(null,$1,$2,null,null,$3) value', [off, lesson, definition]);
      return { id, q };
    };
    const hw = (who, h, action, sub = null, revision = null, data = {}) => as(who, 'select public.homework_work($1,$2,$3,$4,$5) value', [h.id, action, sub, revision, data]);
    const answer = (h, text) => ({ fileIds: [], answers: [{ questionId: h.q.q1, optionIds: [h.q.B], text: '', fileIds: [] }, { questionId: h.q.q2, optionIds: [], text, fileIds: [] }] });
    const hread = (who, h) => as(who, 'select public.get_homework($1) value', [h.id]);
    // "Started at minus S minutes, the deadline minus D minutes": set on the synthetic rows.
    const at = async (h, sub, startedAgo, deadlineAgo) => {
      await admin.query('update public.homework_submissions set created_at=now()-make_interval(mins=>$2) where id=$1', [sub, startedAgo]);
      await admin.query('update public.homework_assignments set deadline_at=now()-make_interval(mins=>$2) where id=$1', [h.id, deadlineAgo]);
    };

    // f1. Started 5 minutes before the deadline, saved and handed in 20 minutes after it: on time. The hand-in waits on a real row lock.
    const h1 = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: false });
    let st = await hw('A', h1, 'start'); await at(h1, st.id, 25, 20);
    const ga = await hread('A', h1); assert.equal(typeof ga.graceUntil, 'string', 'the screen is told until when'); assert.equal(ga.triesLeft, 1);
    assert.equal(Math.round((new Date(ga.graceUntil) - new Date(ga.deadline)) / 60000), 30);
    st = await hw('A', h1, 'save', st.id, st.revision, answer(h1, 'In the grace'));
    const holder = await makeClient(); clients.push(holder);
    await holder.query('begin'); await holder.query('select 1 from public.homework_submissions where id=$1 for update', [st.id]);
    await t.A.claim(); const late = t.A.query('select public.homework_work($1,$2,$3,$4,$5) value', [h1.id, 'submit', st.id, st.revision, {}]);
    await blocked(t.A); await holder.query('commit'); const handed = value(await late); await t.A.query('commit');
    assert.equal(handed.status, 'submitted'); assert.equal(handed.missedDeadline, false);
    assert.deepEqual(await one('select status,missed_deadline from public.homework_submissions where id=$1', [st.id]), { status: 'submitted', missed_deadline: false });
    console.log('PASS full-time race f: a try started 5 minutes before the deadline is saved and handed in 20 minutes after it, on time');

    // f2. At 31 minutes after the deadline: refused (late off); handed in, flagged late (late on).
    const h2 = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: false });
    st = await hw('A', h2, 'start'); st = await hw('A', h2, 'save', st.id, st.revision, answer(h2, 'Too late')); await at(h2, st.id, 36, 31);
    assert.equal((await hread('A', h2)).graceUntil, undefined, 'no grace line after the grace');
    no = await refused(hw('A', h2, 'submit', st.id, st.revision)); assert.equal(no.code, 'PT409'); assert.equal(no.reason, 'deadline_passed');
    no = await refused(hw('A', h2, 'save', st.id, st.revision, answer(h2, 'x'))); assert.equal(no.reason, 'deadline_passed');
    const h3 = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: true });
    st = await hw('A', h3, 'start'); st = await hw('A', h3, 'save', st.id, st.revision, answer(h3, 'Late but allowed')); await at(h3, st.id, 36, 31);
    assert.equal((await hw('A', h3, 'submit', st.id, st.revision)).missedDeadline, true);
    // A start after the deadline stays refused.
    const h4 = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: false });
    await admin.query("update public.homework_assignments set deadline_at=now()-interval '1 minute' where id=$1", [h4.id]);
    no = await refused(hw('A', h4, 'start')); assert.equal(no.reason, 'deadline_passed');
    console.log('PASS full-time race f: 31 minutes after the deadline it is refused (late off) or flagged late (late on); a start after the deadline is refused');

    // f3. Solutions. B handed in before the deadline (1 of 3 tries); A is in the grace with a draft; D handed in try 1 and has try 2 as a draft.
    const h5 = await make({ tries: 'fix_mistakes', maxTries: 3, solutionsOpen: 'after_hand_in', lateAllowed: false });
    let sb = await hw('B', h5, 'start'); sb = await hw('B', h5, 'save', sb.id, sb.revision, answer(h5, 'B early')); await hw('B', h5, 'submit', sb.id, sb.revision);
    const sa = await hw('A', h5, 'start');
    let sd = await hw('D', h5, 'start'); sd = await hw('D', h5, 'save', sd.id, sd.revision, answer(h5, 'D try 1')); sd = await hw('D', h5, 'submit', sd.id, sd.revision);
    const sd2 = await hw('D', h5, 'retry', sd.id);
    assert.equal((await hread('B', h5)).solutionsOpen, false, 'before the deadline: closed');
    await admin.query("update public.homework_submissions set created_at=now()-interval '15 minutes' where id=any($1)", [[sa.id, sd2.id]]);
    await admin.query("update public.homework_assignments set deadline_at=now()-interval '10 minutes' where id=$1", [h5.id]);
    const vb = await hread('B', h5), va = await hread('A', h5), vd = await hread('D', h5);
    assert.equal(vb.solutionsOpen, true); assert.ok(vb.solutions, 'B sees the solutions at the deadline while A is in the grace');
    assert.equal(va.solutionsOpen, false); assert.ok(!va.solutions); assert.equal(typeof va.graceUntil, 'string');
    assert.equal(vd.solutionsOpen, false, 'D: try 1 handed in, try 2 a draft in the grace: no solutions'); assert.ok(!vd.solutions);
    no = await refused(hw('D', h5, 'stop', sd.id, sd.revision)); assert.ok(no, 'D cannot stop to see the solutions while try 2 is a draft');
    // The grace ends (the deadline 31 minutes ago): D's draft can no longer be handed in, the solutions open for D.
    await admin.query("update public.homework_submissions set created_at=now()-interval '40 minutes' where id=any($1)", [[sa.id, sd2.id]]);
    await admin.query("update public.homework_assignments set deadline_at=now()-interval '31 minutes' where id=$1", [h5.id]);
    assert.equal((await hread('D', h5)).solutionsOpen, true, 'D sees the solutions once the draft ends');
    console.log('PASS full-time race f: a classmate sees the solutions at the deadline during another\'s grace; a student with try 2 in the grace sees none until it ends');

    // ------------------------------------------------------------------------------------------------------------------------------- uploads
    // g. 40 ready photos nothing references (synthetic rows), then the 41st intent is refused; the pending ones count too.
    const h6 = await make({ tries: 'one_time', maxTries: 1, solutionsOpen: 'after_hand_in', lateAllowed: false, photosAllowed: true });
    const s6 = await hw('C', h6, 'start');
    await admin.query(`insert into private.homework_uploads(id,assignment_id,uploaded_by,submission_id,purpose,name,mime,path,status,size_bytes,sha256)
      select x,$1::uuid,$2,$3,'submission','p.png','image/png',$1::uuid::text||'/'||x::text||'/file','ready',10,repeat('a',64) from (select gen_random_uuid() x from generate_series(1,40)) g`, [h6.id, ids.C, s6.id]);
    no = await refused(as('C', 'select public.homework_upload($1,$2,null,$3,$4) value', [h6.id, 'intent', s6.id, { purpose: 'submission', mime: 'image/png', name: 'p41.png' }]));
    assert.equal(no.code, '23514'); assert.equal(no.reason, 'too_many_uploads');
    await admin.query("delete from private.homework_uploads where id=(select id from private.homework_uploads where assignment_id=$1 and uploaded_by=$2 limit 1)", [h6.id, ids.C]);
    const ok41 = await as('C', 'select public.homework_upload($1,$2,null,$3,$4) value', [h6.id, 'intent', s6.id, { purpose: 'submission', mime: 'image/png', name: 'p40.png' }]);
    assert.ok(ok41.id, 'the 40th (39 ready + this pending) is accepted');
    no = await refused(as('C', 'select public.homework_upload($1,$2,null,$3,$4) value', [h6.id, 'intent', s6.id, { purpose: 'submission', mime: 'image/png', name: 'p41.png' }]));
    assert.equal(no.reason, 'too_many_uploads', 'a pending photo counts');
    assert.equal(await n('select count(*) n from private.expired_homework_uploads where assignment_id=$1', [h6.id]), 0, 'new files are not listed');
    await admin.query("update private.homework_uploads set created_at=now()-interval '25 hours' where assignment_id=$1 and status='ready'", [h6.id]);
    assert.equal(await n('select count(*) n from private.expired_homework_uploads where assignment_id=$1 and status=$2', [h6.id, 'ready']), 39);
    const ex8 = await exam({ timeLimitMinutes: 60, photosAllowed: true }, new Date(Date.now() - 600000), new Date(Date.now() + 3600000));
    const c8 = await work('C', ex8, 'start');
    await admin.query(`insert into private.exam_uploads(id,exam_id,uploaded_by,attempt_id,purpose,name,mime,path,status,size_bytes,sha256)
      select x,$1::uuid,$2,$3,'answer','p.png','image/png',$1::uuid::text||'/'||x::text||'/file','ready',10,repeat('a',64) from (select gen_random_uuid() x from generate_series(1,40)) g`, [ex8, ids.C, c8.id]);
    no = await refused(as('C', 'select public.exam_upload($1,$2,null,$3) value', [ex8, 'intent', { purpose: 'answer', mime: 'image/png', attemptId: c8.id }]));
    assert.equal(no.code, '23514'); assert.equal(no.reason, 'too_many_uploads');
    assert.equal(await n('select count(*) n from private.expired_exam_uploads where exam_id=$1', [ex8]), 0);
    await admin.query("update private.exam_uploads set created_at=now()-interval '25 hours' where exam_id=$1", [ex8]);
    assert.equal(await n('select count(*) n from private.expired_exam_uploads where exam_id=$1', [ex8]), 40);
    // A referenced photo is never listed.
    const q8 = (await one('select id from private.exam_questions where exam_id=$1 and position=0', [ex8])).id;
    await admin.query("insert into private.exam_responses(attempt_id,question_id,upload_id) select $1,$2,(select id from private.exam_uploads where exam_id=$3 limit 1)", [c8.id, q8, ex8]);
    assert.equal(await n('select count(*) n from private.expired_exam_uploads where exam_id=$1', [ex8]), 39);
    console.log('PASS full-time race g: the 41st photo is refused (homework and exam); the unreferenced ones are listed once older than a day');
    console.log('All full-time rule races passed.');
  } finally {
    for (const c of clients) { try { await c.query('rollback'); } catch {} try { await c.end(); } catch {} }
  }
};
