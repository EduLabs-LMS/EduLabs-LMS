// Only called by the localhost disposable database harness. No development access.
// Exams (migration 20261114120000_exams.sql) under real waits, on separate connections, with Firebase identities: a start against a move of
// the linked session (both orders: the opened window keeps its times, the deadline is never changed), a start that waits past the window's
// end (refused), two tabs starting and two tabs handing in the same try, a grade against a release (both orders), a bulk release against a
// grade, two paper mark sheets for the same student, and a Group created after publishing (linked at its commit, no read) whose
// opened session is moved against a student's start, both orders.
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
module.exports = async function (makeClient, admin) {
  const clients = [], run = randomUUID();
  const claims = label => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true,
    email: `exc-${label}-${run}@example.test`, auth_time: Math.floor(Date.now() / 1000), sub: `exc-${run}-${label}` });
  async function tab(label) {
    const c = await makeClient(); clients.push(c);
    c.pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    c.claim = async () => { await c.query('begin'); await c.query("set local lock_timeout='10s'"); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claims(label)]); };
    return c;
  }
  async function blocked(c) {
    for (let i = 0; i < 300; i++) { if ((await admin.query('select cardinality(pg_blocking_pids($1)) n', [c.pid])).rows[0].n > 0) return; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Expected a real exam lock wait');
  }
  const value = r => r.rows[0].value;
  const refused = p => p.then(() => null, e => ({ code: e.code, reason: e.detail && e.detail.startsWith('{') ? JSON.parse(e.detail).reason : null, message: e.message }));
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const iso = ms => new Date(Date.now() + ms).toISOString();
  const work = (c, exam, action, revision = null, data = {}) => c.query('select public.exam_work($1,$2,$3,$4) value', [exam, action, revision, data]);
  const teacher = await tab('teacher'), ta = await tab('ta'), s1 = await tab('s1'), s1b = await tab('s1'), s2 = await tab('s2'), s3 = await tab('s3'), s4 = await tab('s4'), s5 = await tab('s5'), mover = await makeClient();
  clients.push(mover); mover.pid = (await mover.query('select pg_backend_pid() pid')).rows[0].pid;
  try {
    const ids = {};
    for (const [label, c] of [['teacher', teacher], ['ta', ta], ['s1', s1], ['s2', s2], ['s3', s3], ['s4', s4], ['s5', s5]]) { await c.claim(); ids[label] = (await c.query('select public.onboard_firebase_profile() id')).rows[0].id; await c.query('commit'); }
    const org = randomUUID(), course = randomUUID(), off = randomUUID(), group = randomUUID(), session = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic exam races',$2)", [org, 'exc-' + run]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now()),($1,$3,'assistant','active',now())", [org, ids.teacher, ids.ta]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values($1,$2,'Synthetic exam races','exc-races','published','private',$3)", [course, org, ids.teacher]);
    await admin.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$2,'Run','scheduled','active')", [off, course]);
    await admin.query("insert into public.offering_staff(offering_id,user_id,role) values($1,$2,'teaching_assistant')", [off, ids.ta]);
    await admin.query("insert into public.enrollments(offering_id,user_id,status) values($1,$2,'active'),($1,$3,'active'),($1,$4,'active')", [off, ids.s1, ids.s2, ids.s3]);
    await admin.query("insert into public.study_groups(id,offering_id,name,mode,location,created_by) values($1,$2,'Race group','center','Room 1',$3)", [group, off, ids.teacher]);
    await admin.query("insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by) select $1,$2,e.user_id,e.id,now()-interval '1 day',$3 from public.enrollments e where e.offering_id=$2", [group, off, ids.teacher]);
    await admin.query("insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by) values($1,$2,'Now',now()-interval '5 minutes',now()+interval '2 hours',now()-interval '5 minutes',now()+interval '2 hours','center',$3,$3)", [session, group, ids.teacher]);
    const questions = [{ type: 'choice', text: 'Pick B', points: 2, options: ['A', 'B'], correct: [1] }, { type: 'essay', text: 'Explain', points: 4 }];
    const create = async definition => {
      await teacher.claim();
      const id = value(await teacher.query('select public.exam_save(null,$1,null,$2) value', [off, definition])).id;
      await teacher.query("select public.exam_lifecycle($1,'publish',1)", [id]); await teacher.query('commit'); return id;
    };
    const perGroup = await create({ kind: 'online', title: 'Per group race', startingFrom: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), timeLimitMinutes: 60, questions });
    const window = await one('select opens_at,closes_at,frozen from private.exam_windows($1) where group_id=$2', [perGroup, group]);
    assert.equal(window.frozen, false);

    // 1. A start holds the linked session: a move waits, then freezes the opened window; the try keeps its deadline.
    await s1.claim(); const started = value(await work(s1, perGroup, 'start'));
    await mover.query('begin'); const move = mover.query("update public.group_sessions set starts_at=now()+interval '3 days',ends_at=now()+interval '3 days 1 hour' where id=$1", [session]);
    await blocked(mover); await s1.query('commit'); await move; await mover.query('commit');
    const frozen = await one('select opens_at,closes_at,frozen from private.exam_windows($1) where group_id=$2', [perGroup, group]);
    assert.equal(frozen.frozen, true); assert.equal(+frozen.opens_at, +window.opens_at); assert.equal(+frozen.closes_at, +window.closes_at);
    assert.equal(+(await one('select deadline_at from private.exam_attempts where id=$1', [started.id])).deadline_at, +new Date(started.deadlineAt));
    console.log('PASS exam race: a session move waits for a start, then the opened window keeps its times and the try its deadline');
    // The other order: the move holds the session; a start waits, then starts inside the kept (frozen) window.
    await mover.query('begin'); await mover.query("update public.group_sessions set starts_at=now()+interval '4 days',ends_at=now()+interval '4 days 1 hour' where id=$1", [session]);
    await s2.claim(); const start2 = s2.query("select public.exam_work($1,'start',null,'{}') value", [perGroup]);
    await new Promise(r => setTimeout(r, 150)); await mover.query('commit'); const s2try = value(await start2); await s2.query('commit');
    assert.equal(s2try.status, 'in_progress'); assert.ok(new Date(s2try.deadlineAt) <= new Date(window.closes_at));
    console.log('PASS exam race: a start after a move of an opened session starts inside the kept window');

    // 1b. Groups created after publishing, each committed on its own: linked at that commit (no exam read happens), then their opened
    // session is moved against a student's start, both orders. G2 is created with its session in one transaction (the Group trigger);
    // G3 gets its session in a later transaction (the session trigger).
    await admin.query("insert into public.enrollments(offering_id,user_id,status) values($1,$2,'active'),($1,$3,'active')", [off, ids.s4, ids.s5]);
    const lateA = randomUUID(), lateAs = randomUUID(), lateB = randomUUID(), lateBs = randomUUID();
    await admin.query(`with g as (insert into public.study_groups(id,offering_id,name,mode,location,created_by) values($1,$2,'Late group A','center','Room 2',$4) returning id)
      insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by)
      select $3,g.id,'Now',now()-interval '5 minutes',now()+interval '2 hours',now()-interval '5 minutes',now()+interval '2 hours','center',$4,$4 from g`, [lateA, off, lateAs, ids.teacher]);
    await admin.query("insert into public.study_groups(id,offering_id,name,mode,location,created_by) values($1,$2,'Late group B','center','Room 3',$3)", [lateB, off, ids.teacher]);
    assert.equal((await one('select count(*)::int n from private.exam_group_windows where exam_id=$1 and group_id=$2', [perGroup, lateB])).n, 0);
    await admin.query("insert into public.group_sessions(id,group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,created_by,updated_by) values($1,$2,'Now',now()-interval '5 minutes',now()+interval '2 hours',now()-interval '5 minutes',now()+interval '2 hours','center',$3,$3)", [lateBs, lateB, ids.teacher]);
    await admin.query("insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by) select $1,$2,e.user_id,e.id,now()-interval '1 day',$4 from public.enrollments e where e.offering_id=$2 and e.user_id=$3", [lateA, off, ids.s4, ids.teacher]);
    await admin.query("insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by) select $1,$2,e.user_id,e.id,now()-interval '1 day',$4 from public.enrollments e where e.offering_id=$2 and e.user_id=$3", [lateB, off, ids.s5, ids.teacher]);
    for (const [g, sess] of [[lateA, lateAs], [lateB, lateBs]]) {
      const link = await one('select source,session_id,frozen_opens_at from private.exam_group_windows where exam_id=$1 and group_id=$2', [perGroup, g]);
      assert.equal(link.source, 'auto'); assert.equal(link.session_id, sess); assert.equal(link.frozen_opens_at, null);
    }
    console.log('PASS exam race: Groups created after publishing are linked at their commit (with the session, and when the session comes later), no read');
    const late2 = await one('select starts_at,ends_at from public.group_sessions where id=$1', [lateAs]);
    await s4.claim(); const s4try = value(await work(s4, perGroup, 'start'));
    await mover.query('begin'); const move2 = mover.query("update public.group_sessions set starts_at=now()+interval '5 days',ends_at=now()+interval '5 days 1 hour' where id=$1", [lateAs]);
    await blocked(mover); await s4.query('commit'); await move2; await mover.query('commit');
    const kept2 = await one('select opens_at,closes_at,frozen from private.exam_windows($1) where group_id=$2', [perGroup, lateA]);
    assert.equal(kept2.frozen, true); assert.equal(+kept2.opens_at, +late2.starts_at); assert.equal(+kept2.closes_at, +late2.ends_at);
    assert.equal(+(await one('select deadline_at from private.exam_attempts where id=$1', [s4try.id])).deadline_at, +new Date(s4try.deadlineAt));
    console.log('PASS exam race: a late Group\'s session move waits for a start, then the window keeps its opened times and the try its deadline');
    const late3 = await one('select starts_at,ends_at from public.group_sessions where id=$1', [lateBs]);
    await mover.query('begin'); await mover.query("update public.group_sessions set starts_at=now()+interval '6 days',ends_at=now()+interval '6 days 1 hour' where id=$1", [lateBs]);
    await s5.claim(); const start5 = s5.query("select public.exam_work($1,'start',null,'{}') value", [perGroup]);
    await blocked(s5); await mover.query('commit'); const s5try = value(await start5); await s5.query('commit');
    const kept3 = await one('select opens_at,closes_at,frozen from private.exam_windows($1) where group_id=$2', [perGroup, lateB]);
    assert.equal(kept3.frozen, true); assert.equal(+kept3.opens_at, +late3.starts_at);
    assert.equal(s5try.status, 'in_progress'); assert.ok(new Date(s5try.deadlineAt) <= new Date(late3.ends_at));
    console.log('PASS exam race: a start waiting on a late Group\'s session move starts inside the kept window');

    // 2. Two tabs start the same exam: one try. Two tabs hand it in: one hand-in, the other is stale.
    await s3.claim(); const tabB = await tab('s3');
    const first = value(await work(s3, perGroup, 'start'));
    await tabB.claim(); const second = tabB.query("select public.exam_work($1,'start',null,'{}') value", [perGroup]);
    await blocked(tabB); await s3.query('commit'); const again = value(await second); await tabB.query('commit');
    assert.equal(again.id, first.id); assert.equal((await one('select count(*)::int n from private.exam_attempts where exam_id=$1 and user_id=$2', [perGroup, ids.s3])).n, 1);
    console.log('PASS exam race: two tabs starting get one try');
    await s1.claim(); await s1b.claim();
    const a = await one("select id,revision from private.exam_attempts where exam_id=$1 and user_id=$2", [perGroup, ids.s1]);
    const h1 = value(await work(s1, perGroup, 'submit', a.revision, { attemptId: a.id }));
    const h2 = refused(work(s1b, perGroup, 'submit', a.revision, { attemptId: a.id }));
    await blocked(s1b); await s1.query('commit'); const lost = await h2; await s1b.query('rollback');
    assert.equal(h1.status, 'submitted'); assert.equal(lost.code, 'PT409'); assert.equal(lost.reason, 'stale');
    console.log('PASS exam race: two tabs handing in the same try: one hand-in, the other is refused as stale');

    // 3. A grade against a release (both orders), once the student's window has closed.
    await admin.query("update private.exam_group_windows set frozen_opens_at=now()-interval '3 hours',frozen_closes_at=now()-interval '1 second' where exam_id=$1", [perGroup]);
    const result = async user => one('select id,revision,status,released_at from private.exam_results where exam_id=$1 and user_id=$2', [perGroup, user]);
    const essay = (await one('select id from private.exam_questions where exam_id=$1 and position=1', [perGroup])).id;
    // Time is up for the open tries (s2, s3, s4, s5); the teacher's next read hands them in.
    await admin.query("update private.exam_attempts set started_at=now()-interval '10 minutes',deadline_at=now()-interval '1 second' where exam_id=$1 and status='in_progress'", [perGroup]);
    await teacher.claim(); await teacher.query("select public.exam_queue($1,'corrected')", [perGroup]); await teacher.query('commit');
    assert.equal((await one("select count(*)::int n from private.exam_attempts where exam_id=$1 and status='submitted' and auto_submitted", [perGroup])).n, 4);
    let r1 = await result(ids.s1);
    await teacher.claim(); await ta.claim();
    await teacher.query("select public.exam_work($1,'grade',$2,$3)", [perGroup, r1.revision, JSON.stringify({ attemptId: a.id, marks: [{ questionId: essay, points: 3.5 }] })]);
    const rel = refused(ta.query("select public.exam_work($1,'release',$2,$3)", [perGroup, r1.revision, { resultId: r1.id }]));
    await blocked(ta); await teacher.query('commit'); const relLost = await rel; await ta.query('rollback');
    assert.equal(relLost.code, 'PT409'); assert.equal(relLost.reason, 'stale'); assert.equal((await result(ids.s1)).released_at, null);
    console.log('PASS exam race: a release waiting on a grade is refused as stale (the student never gets the old score)');
    r1 = await result(ids.s1);
    await ta.claim(); await teacher.claim();
    await ta.query("select public.exam_work($1,'release',$2,$3)", [perGroup, r1.revision, { resultId: r1.id }]);
    const gr = refused(teacher.query("select public.exam_work($1,'grade',$2,$3)", [perGroup, r1.revision, { attemptId: a.id, marks: [{ questionId: essay, points: 4 }], reason: 'late change' }]));
    await blocked(teacher); await ta.query('commit'); const grLost = await gr; await teacher.query('rollback');
    assert.equal(grLost.code, 'PT409'); assert.equal(grLost.reason, 'stale');
    assert.equal((await one("select count(*)::int n from private.notification_events where event_type='exam_released' and resource_id=$1", [r1.id])).n, 1);
    console.log('PASS exam race: a grade waiting on a release is refused as stale; one notice');

    // 4. A bulk release against a grade of one of its results.
    const r2 = await result(ids.s2), r3 = await result(ids.s3);
    assert.equal(r2.status, 'corrected'); assert.equal(r3.status, 'corrected'); // empty essays are 0
    await teacher.claim(); await ta.claim();
    const bulk = value(await teacher.query('select public.exam_release_many($1,$2) value', [perGroup, JSON.stringify([{ resultId: r2.id, revision: Number(r2.revision) }, { resultId: r3.id, revision: Number(r3.revision) }])]));
    const g3 = refused(ta.query("select public.exam_work($1,'grade',$2,$3)", [perGroup, r3.revision, { attemptId: (await one('select final_attempt_id id from private.exam_results where id=$1', [r3.id])).id, marks: [{ questionId: essay, points: 2 }] }]));
    await blocked(ta); await teacher.query('commit'); const g3Lost = await g3; await ta.query('rollback');
    assert.equal(bulk.released, 2); assert.equal(g3Lost.code, 'PT409'); assert.equal(g3Lost.reason, 'stale');
    console.log('PASS exam race: a grade waiting on a bulk release is refused as stale');

    // 5. A start that waits past the window's end is refused.
    const closing = await create({ kind: 'online', title: 'Closing race', timing: 'same_time', opensAt: iso(60000), closesAt: iso(3 * 3600000), questions: [questions[0]] });
    await admin.query("update private.exams set opens_at=now()-interval '1 minute',closes_at=clock_timestamp()+interval '1500 milliseconds' where id=$1", [closing]);
    await mover.query('begin'); await mover.query('select 1 from private.exams where id=$1 for update', [closing]);
    await s1.claim(); const late = refused(s1.query("select public.exam_work($1,'start',null,'{}') value", [closing]));
    await blocked(s1); await new Promise(r => setTimeout(r, 1800)); await mover.query('commit'); const lateLost = await late; await s1.query('rollback');
    assert.equal(lateLost.code, 'PT409'); assert.equal(lateLost.reason, 'deadline_passed');
    assert.equal((await one('select count(*)::int n from private.exam_attempts where exam_id=$1', [closing])).n, 0);
    console.log('PASS exam race: a start that waits past the window end is refused; no try');

    // 6. Two mark sheets for the same student: the second waits and is stale.
    const paper = await create({ kind: 'paper', title: 'Paper race', maxMarks: 10 });
    await teacher.claim(); await ta.claim();
    await teacher.query('select public.exam_paper_mark($1,$2)', [paper, JSON.stringify([{ userId: ids.s1, mark: 6 }])]);
    const sheet = refused(ta.query('select public.exam_paper_mark($1,$2)', [paper, JSON.stringify([{ userId: ids.s1, mark: 7 }])]));
    await blocked(ta); await teacher.query('commit'); const sheetLost = await sheet; await ta.query('rollback');
    assert.equal(sheetLost.code, 'PT409'); assert.equal(sheetLost.reason, 'stale');
    assert.equal(Number((await one('select paper_mark from private.exam_results where exam_id=$1 and user_id=$2', [paper, ids.s1])).paper_mark), 6);
    console.log('PASS exam race: a second mark sheet for the same student waits and is refused as stale');
  } finally {
    for (const c of clients) { try { await c.query('rollback'); } catch {} try { await c.end(); } catch {} }
  }
};
