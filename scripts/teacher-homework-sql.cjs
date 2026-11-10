// Only called by the localhost disposable database harness. No development access.
// What the teacher Homework screens really send, against the real functions, under Firebase identities: the wizard's state builders, the
// routes' contract and call arguments, and the reply mapper. pg gives the same code, message and detail PostgREST passes on; PostgREST and
// the server's pre-checks are not run here (the database refuses on its own, which is what this proves).
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module: m, exports: m.exports, Intl, Date, Math, Number, JSON, Array, Set, Map, Object, String, require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
  return m.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const hw = load('shared/teacher-homework.ts'), contract = load('shared/contracts/teacher-homework.ts', { zod: require('zod') });
const claimsFor = sub => JSON.stringify({ iss: 'https://securetoken.google.com/diagonproduction', aud: 'diagonproduction', role: 'authenticated', email_verified: true, email: sub + '@example.test', auth_time: Math.floor(Date.now() / 1000), sub });

module.exports = async function (makeClient, admin) {
  const c = await makeClient();
  const as = sub => async work => {
    await c.query('begin'); await c.query('set local role authenticated'); await c.query("select set_config('request.jwt.claims',$1,true)", [claimsFor(sub)]);
    try { const result = await work(); await c.query('commit'); return result; } catch (e) { await c.query('rollback'); throw e; }
  };
  const subs = { teacher: 'thw-' + randomUUID(), ta: 'thw-' + randomUUID(), stranger: 'thw-' + randomUUID(), student: 'thw-' + randomUUID() };
  const who = Object.fromEntries(Object.entries(subs).map(([k, s]) => [k, as(s)]));
  const value = r => r.rows[0].v;
  // As the routes do it: the contract first, then the same arguments the service passes, under the signed-in identity.
  const save = (by, id, body) => { const b = contract.homeworkSave.parse(plain(body)); return by(() => c.query('select public.save_homework($1,$2,$3,null,$4,$5::jsonb,false) v', [id, b.offeringId, b.lessonId, b.revision, JSON.stringify(b.definition)])).then(value); };
  const life = (by, id, body) => { const b = contract.homeworkLifecycle.parse(plain(body)); const data = b.action === 'reschedule' ? { deadline: b.deadline, lateAllowed: b.lateAllowed } : {}; return by(() => c.query('select public.homework_lifecycle($1,$2,$3,$4::jsonb) v', [id, b.action, b.revision, JSON.stringify(data)])).then(value); };
  const view = (by, id) => by(() => c.query('select public.get_homework($1,null) v', [id])).then(value);
  const portal = (by, q = {}) => { const p = contract.portalQuery.parse(q); return by(() => c.query('select public.homework_portal($1,$2,$3) v', [p.course ?? null, p.tab, p.page])).then(value); };
  const images = (by, id) => by(() => c.query('select public.homework_delete_images($1) v', [id])).then(value);
  const refused = promise => promise.then(v => assert.fail('should be refused, got ' + JSON.stringify(v)), e => { if (!e.code) throw e; return plain(hw.homeworkReply({ code: e.code, message: e.message, details: e.detail }).body); });
  try {
    const ids = {};
    for (const k of Object.keys(subs)) ids[k] = (await who[k](() => c.query('select public.onboard_firebase_profile() id'))).rows[0].id;
    const org = randomUUID(), otherOrg = randomUUID(), course = randomUUID(), chapter = randomUUID(), lesson = randomUUID(), off = randomUUID();
    await admin.query("insert into public.organizations(id,name,slug) values($1,'Synthetic homework screens',$2),($3,'Synthetic other space',$4)", [org, 'thw-' + org, otherOrg, 'thw-' + otherOrg]);
    await admin.query("insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,'owner','active',now()),($1,$3,'assistant','active',now()),($4,$5,'owner','active',now())", [org, ids.teacher, ids.ta, otherOrg, ids.stranger]);
    await admin.query("insert into public.courses(id,organization_id,title,slug,status,visibility,created_by) values($1,$2,'Synthetic forces','thw-forces','published','private',$3)", [course, org, ids.teacher]);
    await admin.query("insert into public.course_modules(id,course_id,title,position) values($1,$2,'Chapter',0)", [chapter, course]);
    await admin.query("insert into public.lessons(id,module_id,title,position,status) values($1,$2,'Lesson',0,'published')", [lesson, chapter]);
    await admin.query("insert into public.course_offerings(id,course_id,name,delivery_mode,status) values($1,$2,'Run','scheduled','active')", [off, course]);
    await admin.query("insert into public.offering_staff(offering_id,user_id,role) values($1,$2,'teaching_assistant')", [off, ids.ta]);
    await admin.query("insert into public.enrollments(offering_id,user_id,status) values($1,$2,'active')", [off, ids.student]);

    // The wizard: a textbook question (B), a written choice, an essay; Cairo deadline next week, sent with its offset.
    const id = () => randomUUID();
    const state = hw.newWizard(id, { courseId: course, offeringId: off, lessonId: lesson });
    state.title = 'Synthetic forces homework';
    const next = new Date(Date.now() + 7 * 86400000), day = hw.cairoFields(next.toISOString()).date;
    state.deadlineDate = day; state.deadlineTime = '23:59';
    let book = hw.setTextbook(state.questions[0], true, id); book = hw.toggleCorrect(book, book.options[1].id);
    const essay = { ...hw.newQuestion('essay', id), text: 'Explain friction' };
    state.questions = [book, essay];
    assert.deepEqual(plain(hw.allIssues(state, Date.now())), []);
    assert.match(hw.wizardDeadline(state), /\+0[23]:00$/);

    // 1. A draft is saved (no revision), read back, and the revision makes the exact round trip.
    const hwId = await save(who.teacher, null, { offeringId: off, lessonId: lesson, revision: null, definition: hw.toDefinition(state, false) });
    let v = await view(who.teacher, hwId);
    assert.equal(v.staff, true); assert.equal(typeof v.revision, 'number');
    const back = hw.fromView(v, course);
    assert.equal(back.deadlineDate, day); assert.equal(back.deadlineTime, '23:59', 'the Cairo wall time reads back unchanged');
    assert.equal(back.questions[0].textbook, true); assert.equal(back.questions[1].kind, 'essay');
    const r0 = v.revision;
    await save(who.teacher, hwId, { offeringId: off, lessonId: lesson, revision: r0, definition: hw.toDefinition({ ...back, title: 'Synthetic forces homework, edited' }, false) });
    v = await view(who.teacher, hwId);
    assert.ok(v.revision > r0, 'a save moves the revision');
    assert.deepEqual(await refused(save(who.teacher, hwId, { offeringId: off, lessonId: lesson, revision: r0, definition: hw.toDefinition(back, false) })), { kind: 'changed' }, 'a stale save');
    console.log('PASS teacher homework screens: draft saved and read back, Cairo time and revision round trip, stale save is changed');

    // 2. Another space's teacher and an assistant without editing rights are refused by the database itself.
    assert.equal((await refused(save(who.stranger, hwId, { offeringId: off, lessonId: lesson, revision: v.revision, definition: hw.toDefinition(back, false) }))).kind, 'denied');
    assert.equal((await refused(save(who.stranger, null, { offeringId: off, lessonId: lesson, revision: null, definition: hw.toDefinition(back, false) }))).kind, 'denied');
    assert.equal((await refused(life(who.stranger, hwId, { action: 'publish', revision: v.revision }))).kind, 'denied');
    assert.equal((await refused(images(who.stranger, hwId))).kind, 'denied');
    assert.equal((await refused(save(who.ta, hwId, { offeringId: off, lessonId: lesson, revision: v.revision, definition: hw.toDefinition(back, false) }))).kind, 'denied', 'an assistant cannot edit');
    assert.equal((await refused(life(who.ta, hwId, { action: 'publish', revision: v.revision }))).kind, 'denied');
    const strangerPortal = await portal(who.stranger);
    assert.ok(!JSON.stringify(strangerPortal).includes(hwId), 'nothing of it on the other space\'s page');
    console.log('PASS teacher homework screens: another space\'s teacher and an assistant without editing are refused');

    // 3. Publishing needs a deadline: the database says no_deadline when the draft has none.
    const bare = await save(who.teacher, null, { offeringId: off, lessonId: lesson, revision: null, definition: hw.toDefinition({ ...state, deadlineDate: '', questions: [{ ...hw.newQuestion('essay', id), text: 'Another homework, its own question ids' }] }, false) });
    const bareView = await view(who.teacher, bare);
    assert.deepEqual(await refused(life(who.teacher, bare, { action: 'publish', revision: bareView.revision })), { kind: 'invalid', reason: 'no_deadline' });
    console.log('PASS teacher homework screens: publishing without a deadline is refused with its reason');

    // 4. Publish, then the page read: counts, the row, rights; then Change deadline (future only, stale is changed) and Delete images.
    await life(who.teacher, hwId, { action: 'publish', revision: v.revision });
    v = await view(who.teacher, hwId);
    const page = await portal(who.teacher, { course });
    for (const key of ['tab', 'page', 'pageSize', 'serverNow', 'stats', 'counts', 'toCorrect', 'rows']) assert.ok(key in page, key);
    for (const key of ['weekStart', 'weekEnd', 'essaysWaiting', 'correctedThisWeek', 'handedInThisWeek', 'onTimePercent']) assert.ok(key in page.stats, key);
    assert.equal(page.counts.open, 1); assert.equal(page.counts.drafts, 1);
    const row = page.rows.find(r => r.id === hwId);
    assert.ok(row); assert.equal(row.status, 'published'); assert.equal(row.workflow, 'questions'); assert.equal(Date.parse(row.deadline), Date.parse(hw.wizardDeadline(state)));
    assert.deepEqual(plain(hw.rowActions(row, 'open', true, true)), ['edit', 'deadline', 'unpublish']);
    assert.ok(Math.abs(Date.parse(page.stats.weekEnd) - Date.parse(page.stats.weekStart) - 7 * 86400000) <= 3600000, 'a whole week');
    assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short' }).format(new Date(page.stats.weekStart)), 'Sat', 'it starts on Saturday in Cairo');
    assert.deepEqual(plain((await portal(who.teacher, { course, tab: 'drafts' })).rows.map(r => r.id)), [bare]);

    const later = hw.cairoIso(hw.cairoFields(new Date(Date.now() + 9 * 86400000).toISOString()).date, '18:00');
    assert.deepEqual(await refused(life(who.teacher, hwId, { action: 'reschedule', revision: r0, deadline: later, lateAllowed: true })), { kind: 'changed' }, 'a stale change of deadline');
    const past = hw.cairoIso(hw.cairoFields(new Date(Date.now() - 86400000).toISOString()).date, '10:00');
    assert.deepEqual(await refused(life(who.teacher, hwId, { action: 'reschedule', revision: v.revision, deadline: past, lateAllowed: false })), { kind: 'invalid', reason: 'deadline_past' });
    await life(who.teacher, hwId, { action: 'reschedule', revision: v.revision, deadline: later, lateAllowed: true });
    v = await view(who.teacher, hwId);
    assert.equal(Date.parse(v.definition.rules.deadline), Date.parse(later)); assert.equal(v.definition.rules.lateAllowed, true);

    assert.deepEqual(await refused(images(who.teacher, hwId)), { kind: 'refused', reason: 'still_open' }, 'Delete images waits for the deadline');
    assert.equal((await refused(images(who.ta, hwId))).kind, 'denied', 'Delete images is for managers');
    await admin.query("update public.homework_assignments set deadline_at=now()-interval '1 hour' where id=$1", [hwId]);
    const closed = await portal(who.teacher, { course, tab: 'closed' });
    assert.ok(closed.rows.some(r => r.id === hwId), 'it is closed now');
    const done = await images(who.teacher, hwId);
    assert.deepEqual(plain(done), { deletedFiles: 0, bytesFreed: 0, paths: [] }, 'nothing to delete, the shape the route reads');
    console.log('PASS teacher homework screens: publish, the page read, Change deadline (stale, past, saved) and Delete images (open, assistant, closed)');

    // 5. A student cannot read it through the teacher's view, and the page is empty for them.
    const seen = await view(who.student, hwId).catch(e => ({ refused: e.code }));
    assert.ok(seen.refused || seen.staff === false, 'a student is not staff');
    const studentPage = await portal(who.student).catch(e => ({ refused: e.code }));
    assert.ok(studentPage.refused || !JSON.stringify(studentPage).includes(hwId));
    console.log('PASS teacher homework screens: a student is never staff on the teacher\'s routes');
  } finally {
    await c.end();
  }
};
