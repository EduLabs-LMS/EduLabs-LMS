// The teacher Homework screens: Cairo times, the wizard's state, the contract, how refusals become words, the routes (with a stubbed
// viewer and database client), Delete images, the middleware, the menu and the texts. Behaviour against PostgreSQL is in
// teacher-homework-sql.cjs; the screens themselves are in teacher-homework-browser.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}, extra = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Array, Map, Set, JSON, Number, Date, Intl, Math, Object, String, Buffer, Uint8Array, console, ...extra,
   require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const hw = load('shared/teacher-homework.ts');
const contract = load('shared/contracts/teacher-homework.ts', { zod: require('zod') });
const { messages } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ids = () => { let n = 100; return () => uuid(++n); };
const NOW = Date.parse('2026-11-09T10:00:00Z');
/** A complete wizard: a blank-answer question (B right), a written choice and an essay, a deadline next week. */
function complete() {
 const id = ids();
 const s = hw.newWizard(id, { courseId: uuid(1), offeringId: uuid(2), lessonId: uuid(3) });
 s.title = 'Forces'; s.deadlineDate = '2026-11-16'; s.deadlineTime = '23:59';
 const book = hw.toggleCorrect(s.questions[0], s.questions[0].options[1].id);
 let written = hw.newQuestion('choice', id); written.text = 'Which is a force?'; written.options = written.options.map((o, i) => ({ ...o, text: ['Push', 'Mass', 'Time', 'Length'][i] })); written = hw.toggleCorrect(written, written.options[0].id);
 const essay = { ...hw.newQuestion('essay', id), text: 'Explain friction', modelAnswer: 'It opposes motion' };
 s.questions = [book, written, essay];
 return s;
}

// --------------------------------------------------------------------------------------------------------------------------------
// Cairo time
// --------------------------------------------------------------------------------------------------------------------------------
test('Cairo: winter is +02:00, summer +03:00, whatever the machine\'s zone; the spring gap has no time and the autumn fold takes the later one', () => {
 assert.equal(hw.cairoIso('2026-11-16', '23:59'), '2026-11-16T23:59:00+02:00');
 assert.equal(hw.cairoIso('2026-07-01', '09:30'), '2026-07-01T09:30:00+03:00');
 assert.equal(hw.cairoIso('2026-04-24', '00:30'), null, 'Cairo skips from 00:00 to 01:00 on the last Friday of April');
 assert.equal(hw.cairoIso('2026-10-29', '23:30'), '2026-10-29T23:30:00+02:00', 'the hour that happens twice: the later instant');
 for (const [d, t] of [['2026-13-01', '10:00'], ['2026-11-16', '7:00'], ['', '10:00'], ['2026-11-16T', '10:00'], ['2026-02-30', '10:00']]) assert.equal(hw.cairoIso(d, t), null, d + ' ' + t);
 for (const iso of ['2026-11-16T23:59:00+02:00', '2026-07-01T09:30:00+03:00']) { const f = hw.cairoFields(iso); assert.equal(hw.cairoIso(f.date, f.time), iso, 'round trip'); }
 assert.deepEqual(plain(hw.cairoFields('2026-11-16T22:00:00Z')), { date: '2026-11-17', time: '00:00' }, 'midnight is 00, never 24');
 assert.equal(hw.cairoToday(Date.parse('2026-11-09T22:30:00Z')), '2026-11-10');
 assert.ok(hw.deadlineInFuture('2026-11-09T12:01:00+02:00', NOW)); assert.ok(!hw.deadlineInFuture('2026-11-09T12:00:00+02:00', NOW)); assert.ok(!hw.deadlineInFuture(null, NOW));
});
test('the week runs Saturday to Friday in Cairo: the screen shows the Friday before the next Saturday', () => {
 const w = hw.weekRange('2026-11-07T00:00:00+02:00', '2026-11-14T00:00:00+02:00', 'en');
 assert.match(w.from, /^Sat 7 Nov$/); assert.match(w.to, /^Fri 13 Nov$/);
 assert.match(hw.weekRange('2026-11-07T00:00:00+02:00', '2026-11-14T00:00:00+02:00', 'ar').from, /[؀-ۿ]/);
 assert.match(hw.cairoTime('2026-11-16T21:59:00Z', 'en'), /^11:59\sPM$/);
});

// --------------------------------------------------------------------------------------------------------------------------------
// The wizard
// --------------------------------------------------------------------------------------------------------------------------------
test('wizard: each step names what stops it, in order; a complete homework has none', () => {
 const empty = hw.newWizard(ids());
 assert.deepEqual(plain(hw.stepIssues(empty, 'details', NOW).map(i => i.key)), ['title', 'course', 'lesson']);
 assert.deepEqual(plain(hw.stepIssues(empty, 'questions', NOW)), [{ step: 'questions', key: 'correct', question: 0 }], 'a choice needs only a right answer: its texts are optional');
 assert.deepEqual(plain(hw.stepIssues({ ...empty, questions: [hw.newQuestion('essay', ids())] }, 'questions', NOW).map(i => i.key)), ['question_text'], 'an essay still needs its question');
 assert.deepEqual(plain(hw.stepIssues(empty, 'rules', NOW).map(i => i.key)), ['deadline']);
 assert.deepEqual(plain(hw.stepIssues(empty, 'solutions', NOW)), [], 'solutions are optional');
 const s = complete();
 assert.deepEqual(plain(hw.allIssues(s, NOW)), []);
 assert.deepEqual(plain(hw.stepIssues({ ...s, questions: [] }, 'questions', NOW).map(i => i.key)), ['no_questions']);
 assert.deepEqual(plain(hw.stepIssues({ ...s, deadlineDate: '2026-11-01' }, 'rules', NOW).map(i => i.key)), ['deadline_past']);
 assert.deepEqual(plain(hw.stepIssues({ ...s, status: 'published', deadlineDate: '2026-11-01' }, 'rules', NOW)), [], 'a published one keeps its passed deadline (Change deadline moves it)');
 assert.deepEqual(plain(hw.stepIssues({ ...s, deadlineDate: '2026-04-24', deadlineTime: '00:30' }, 'rules', NOW).map(i => i.key)), ['deadline_invalid']);
 assert.equal(hw.WIZARD_STEPS.join(), 'details,questions,rules,solutions,review');
});
test('wizard: a choice starts with four blank answers A to D; texts are optional; 2 to 8 answers; tap marks and unmarks any number', () => {
 const id = ids(); let q = hw.newQuestion('choice', id);
 assert.equal(q.options.length, 4); assert.ok(q.options.every(o => o.text === '')); assert.equal(q.text, ''); assert.ok(hw.blankAnswers(q));
 assert.ok(!('textbook' in q) && !('multiple' in q), 'no textbook switch and no type control');
 for (let i = 0; i < 10; i++) q = hw.addOption(q, id);
 assert.equal(q.options.length, hw.MAX_OPTIONS);
 for (let i = 0; i < 10; i++) q = hw.removeOption(q, q.options[0].id);
 assert.equal(q.options.length, hw.MIN_OPTIONS);
 q = hw.toggleCorrect(q, q.options[0].id); q = hw.toggleCorrect(q, q.options[1].id);
 assert.equal(q.correctIds.length, 2, 'a second tap adds a second right answer');
 assert.equal(hw.toggleCorrect(q, q.options[0].id).correctIds.join(), q.options[1].id, 'tapping a right answer again unmarks it');
 assert.equal(hw.toggleCorrect(q, uuid(999)), q, 'an unknown option changes nothing');
 assert.equal(hw.removeOption(q, q.options[0].id), q, 'never fewer than two');
 const typed = { ...q, options: q.options.map((o, i) => ({ ...o, text: i ? 'Mass' : '' })) };
 assert.ok(!hw.blankAnswers(typed), 'any answer text shows the list'); assert.ok(hw.blankAnswers({ ...q, options: q.options.map(o => ({ ...o, text: '  ' })) }));
 q.text = 'Kept'; const essay = hw.setKind(q, 'essay', id);
 assert.equal(essay.id, q.id); assert.equal(essay.text, 'Kept'); assert.equal(essay.options.length, 0); assert.equal(essay.correctIds.length, 0);
 assert.equal(hw.setKind(essay, 'choice', id).options.length, 4);
 const list = complete().questions;
 assert.deepEqual(plain(hw.moveQuestion(list, 0, 2).map(x => x.id)), [list[1].id, list[2].id, list[0].id]);
 assert.equal(hw.moveQuestion(list, 0, 3), list); assert.equal(hw.moveQuestion(list, -1, 0), list);
 assert.equal(hw.clampMarks(-3), 0); assert.equal(hw.clampMarks(1000), 100); assert.equal(hw.clampMarks(2.6), 3);
 assert.equal(hw.totalMarks(complete()), 1 + 1 + 2);
});
test('wizard: the type follows the right answers: one is single choice, more than one multiple choice; nothing else is sent', () => {
 const id = ids(); let q = hw.newQuestion('choice', id);
 assert.equal(hw.choiceType(q), 'single_choice', 'none marked yet');
 q = hw.toggleCorrect(q, q.options[2].id); assert.equal(hw.choiceType(q), 'single_choice');
 q = hw.toggleCorrect(q, q.options[0].id); assert.equal(hw.choiceType(q), 'multiple_choice');
 const def = hw.toDefinition({ ...complete(), questions: [q] }, true);
 assert.equal(def.questions[0].type, 'multiple_choice'); assert.deepEqual(plain(def.questions[0].correctIds), [q.options[2].id, q.options[0].id]);
 assert.ok(contract.teacherHomeworkDefinition.safeParse(plain(def)).success, 'blank answers and a blank question publish once marked');
 assert.equal(hw.toDefinition({ ...complete(), questions: [hw.toggleCorrect(q, q.options[0].id)] }, true).questions[0].type, 'single_choice');
 for (const n of [2, 3, 5, 8]) {
  let many = hw.newQuestion('choice', id); while (many.options.length < n) many = hw.addOption(many, id); while (many.options.length > n) many = hw.removeOption(many, many.options[0].id);
  many = hw.toggleCorrect(many, many.options[n - 1].id);
  assert.ok(contract.teacherHomeworkDefinition.safeParse(plain(hw.toDefinition({ ...complete(), questions: [many] }, true))).success, n + ' blank answers');
 }
 const forged = plain(def); forged.questions[0].type = 'single_choice';
 assert.ok(!contract.teacherHomeworkDefinition.safeParse(forged).success, 'single choice with two keys is refused');
 const unkeyed = plain(hw.toDefinition({ ...complete(), questions: [hw.newQuestion('choice', id)] }, true));
 assert.ok(!contract.teacherHomeworkDefinition.safeParse(unkeyed).success, 'publishing needs a right answer');
 const dup = plain(def); dup.questions[0].options[1].id = dup.questions[0].options[0].id;
 assert.ok(!contract.teacherHomeworkDefinition.safeParse(dup).success, 'no duplicate answer keys');
});
test('wizard: answers are lettered A to H in English and in the Arabic abjad order, never numbers', () => {
 assert.equal(Array.from({ length: 8 }, (_, i) => hw.letter(i)).join(''), 'ABCDEFGH');
 assert.deepEqual(Array.from({ length: 8 }, (_, i) => hw.letter(i, 'ar')), ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح']);
 assert.equal(hw.letter(5), 'F'); assert.equal(hw.letter(4, 'ar'), 'هـ');
 for (const i of [-1, 8, 99]) assert.doesNotMatch(hw.letter(i) + hw.letter(i, 'ar'), /\d/, 'out of range is still a letter');
});
test('wizard: a saved homework is offered only the courses of its own teaching space; a new one any', () => {
 const all = [{ id: uuid(1), spaceId: 'a' }, { id: uuid(8), spaceId: 'a' }, { id: uuid(20), spaceId: 'b' }];
 assert.deepEqual(plain(hw.placeCourses(all, all, { id: null, courseId: '' }).map(c => c.id)), [uuid(1), uuid(8), uuid(20)], 'new: every editable course');
 assert.deepEqual(plain(hw.placeCourses(all, all, { id: uuid(50), courseId: uuid(1) }).map(c => c.id)), [uuid(1), uuid(8)], 'saved in space a: space a only');
 assert.deepEqual(plain(hw.placeCourses(all, all, { id: uuid(50), courseId: uuid(20) }).map(c => c.id)), [uuid(20)]);
 assert.deepEqual(plain(hw.placeCourses(all.slice(1), all, { id: uuid(50), courseId: uuid(1) }).map(c => c.id)), [uuid(8)], 'the space comes from every course, editable or not');
 assert.deepEqual(plain(hw.placeCourses(all, all, { id: uuid(50), courseId: uuid(99) })), [], 'an unknown course offers nothing to move to');
 assert.match(read('frontend/features/teacher-homework/homework-wizard.tsx'), /placeCourses\(editable, courses, state\)/);
 assert.match(read('server/services/teacher-homework-page.ts'), /spaceId: c\.organization_id/);
});
test('wizard: course and lesson move until a student starts or for a later version; another course empties the lesson', () => {
 const s = { ...complete(), id: uuid(50), revision: 3 };
 assert.equal(hw.placeLocked(s), false, 'a saved homework nobody started may move');
 assert.equal(hw.placeLocked({ ...s, status: 'published' }), false, 'published too');
 assert.equal(hw.placeLocked({ ...s, locked: true }), true, 'a student started (get_homework locked)');
 assert.equal(hw.placeLocked({ ...s, version: 2 }), true, 'a later version');
 assert.equal(hw.placeLocked(hw.newWizard(ids())), false);
 const other = hw.chooseCourse(s, uuid(8), uuid(9));
 assert.deepEqual([other.courseId, other.offeringId, other.lessonId], [uuid(8), uuid(9), ''], 'another course clears the lesson');
 assert.ok(!hw.draftSavable(other), 'so nothing autosaves until a lesson is picked');
 assert.ok(hw.draftSavable({ ...other, lessonId: uuid(10) }));
 const run = hw.chooseCourse(s, uuid(1), uuid(11));
 assert.deepEqual([run.offeringId, run.lessonId], [uuid(11), uuid(3)], 'another run of the same course keeps the lesson');
 const locked = { ...s, locked: true };
 assert.equal(hw.chooseCourse(locked, uuid(8), uuid(9)), locked, 'locked: nothing changes'); assert.equal(hw.chooseCourse({ ...s, version: 2 }, uuid(8), uuid(9)).courseId, uuid(1));
 const wizard = read('frontend/features/teacher-homework/homework-wizard.tsx');
 assert.match(wizard, /const fixed = placeLocked\(state\)/); assert.match(wizard, /chooseCourse\(s, c, o\)/);
 assert.match(wizard, /reason === 'started' \|\| reply\.failure\.reason === 'versioned'/, 'a refused move keeps what was typed and offers Reload');
 assert.equal(messages.en['hw.w.fixed'], 'A student has started this homework, so it stays in this lesson.');
});
test('wizard: photo answers off make every essay text only; on, essays take text or a photo; choices are always chosen', () => {
 const s = complete();
 assert.match(read('frontend/features/teacher-homework/homework-wizard.tsx'), /data-photos>\r?\n\s*<legend className="d-field-label"><L id="hw.w.answer_heading" \/>/, 'the switch is on the Rules step under How students answer');
 assert.deepEqual(plain(hw.toDefinition(s, true).questions.map(q => q.responseMode)), ['text', 'text', 'both']);
 const off = hw.toDefinition({ ...s, photos: false }, true);
 assert.ok(off.questions.every(q => q.responseMode === 'text')); assert.equal(off.rules.photosAllowed, false);
 assert.ok(contract.teacherHomeworkDefinition.safeParse(off).success);
 const forged = plain(off); forged.questions[2].responseMode = 'both';
 assert.ok(!contract.teacherHomeworkDefinition.safeParse(forged).success, 'the contract refuses a photo essay when photos are off');
});
test('wizard: tries are one time (sent as 1) or 2 to 10', () => {
 const s = complete();
 assert.equal(hw.toDefinition(s, true).rules.maxTries, 1);
 for (const [given, sent] of [[1, 2], [2, 2], [7, 7], [10, 10], [11, 10], [99, 10]]) assert.equal(hw.toDefinition({ ...s, tries: 'fix_mistakes', maxTries: given }, true).rules.maxTries, sent);
 assert.equal(hw.clampTries(0), 2); assert.equal(hw.clampTries(4.4), 4);
 assert.deepEqual(plain(hw.stepIssues({ ...s, tries: 'from_zero', maxTries: 11 }, 'rules', NOW).map(i => i.key)), ['tries']);
 assert.deepEqual(plain(hw.stepIssues({ ...s, tries: 'one_time', maxTries: 11 }, 'rules', NOW)), [], 'one time ignores the count');
 for (const rules of [{ tries: 'one_time', maxTries: 2 }, { tries: 'fix_mistakes', maxTries: 1 }, { tries: 'from_zero', maxTries: 11 }]) {
  const d = plain(hw.toDefinition(s, true)); Object.assign(d.rules, rules);
  assert.ok(!contract.teacherHomeworkDefinition.safeParse(d).success, JSON.stringify(rules));
 }
 assert.equal(hw.solutionsRule({ solutionsOpen: 'after_hand_in', tries: 'one_time', maxTries: 1 }), 'after_hand_in');
 assert.equal(hw.solutionsRule({ solutionsOpen: 'after_hand_in', tries: 'fix_mistakes', maxTries: 3 }), 'after_last_try');
 assert.equal(hw.solutionsRule({ solutionsOpen: 'after_deadline', tries: 'one_time', maxTries: 1 }), 'after_deadline');
});
test('wizard: the deadline is sent with its offset and matches the database pattern; none while the date is empty', () => {
 const def = hw.toDefinition(complete(), true);
 assert.equal(def.rules.deadline, '2026-11-16T23:59:00+02:00'); assert.match(def.rules.deadline, contract.deadlinePattern);
 assert.equal(hw.toDefinition({ ...complete(), deadlineDate: '' }, false).rules.deadline, null);
 assert.ok(!contract.teacherHomeworkDefinition.safeParse({ ...plain(def), rules: { ...def.rules, deadline: '2026-11-16T23:59:00' } }).success, 'no offset is refused');
 assert.ok(!contract.teacherHomeworkDefinition.safeParse({ ...plain(def), rules: { ...def.rules, deadline: null } }).success, 'published needs a deadline');
 assert.ok(contract.teacherHomeworkDefinition.safeParse(plain(hw.toDefinition({ ...complete(), deadlineDate: '' }, false))).success, 'a draft does not');
});
test('wizard: a draft saves once it has a title, a course, a lesson and questions the database accepts', () => {
 const s = complete();
 assert.ok(hw.draftSavable(s));
 assert.ok(!hw.draftSavable({ ...s, title: '  ' })); assert.ok(!hw.draftSavable({ ...s, lessonId: '' })); assert.ok(!hw.draftSavable({ ...s, offeringId: '' })); assert.ok(!hw.draftSavable({ ...s, questions: [] }));
 assert.ok(!hw.draftSavable({ ...s, deadlineDate: '2026-04-24', deadlineTime: '00:30' }), 'an impossible time is not stored');
 const id = ids(); const blankFive = hw.addOption(hw.newQuestion('choice', id), id);
 assert.ok(hw.draftSavable({ ...s, questions: [blankFive] }), 'five blank answers save (no textbook rule)');
 assert.ok(hw.draftSavable({ ...s, questions: [hw.newQuestion('choice', id)] }), 'four blank answers save');
 const def = plain(hw.toDefinition({ ...s, questions: [hw.newQuestion('choice', id)] }, false));
 assert.ok(contract.teacherHomeworkDefinition.safeParse(def).success, 'and the contract takes it as a draft');
 assert.ok(!contract.teacherHomeworkDefinition.safeParse({ ...def, published: true }).success, 'but not published without a key');
});
test('wizard: what is saved reads back as the same wizard', () => {
 const s = { ...complete(), id: uuid(50), revision: 7, tries: 'fix_mistakes', maxTries: 4, photos: false, lateAllowed: true, solutionsOpen: 'after_deadline', solutionText: 'Look at page 12' };
 const def = hw.toDefinition(s, false);
 s.questions[2] = { ...s.questions[2], modelImageId: uuid(60) };
 s.questions[0] = { ...s.questions[0], modelAnswer: 'B: the current halves', modelImageId: uuid(61) };
 const def2 = hw.toDefinition(s, false);
 assert.equal(def2.questions[2].modelImageId, uuid(60)); assert.equal(def2.questions[0].modelImageId, uuid(61), 'a choice question has a model answer picture too');
 assert.equal(def2.questions[0].modelAnswer, 'B: the current halves', 'and its explanation is sent');
 assert.equal(def2.questions[1].modelImageId, null, 'a question without one sends none');
 assert.ok(contract.teacherHomeworkDefinition.safeParse(plain(def2)).success);
 const swapped = hw.setKind(s.questions[0], 'essay', ids()); assert.equal(swapped.modelImageId, uuid(61)); assert.equal(swapped.modelAnswer, 'B: the current halves', 'changing the kind keeps the model answer and its picture');
 const back = hw.fromView({ id: uuid(50), offeringId: uuid(2), lessonId: uuid(3), segmentId: null, revision: 7, version: 1, locked: false, staff: true, canManage: true, workflow: 'questions', deadline: def2.rules.deadline, definition: def2 }, uuid(1));
 assert.deepEqual(plain(back), plain(s));
 assert.equal(hw.fromView({ id: uuid(50), offeringId: uuid(2), lessonId: uuid(3), segmentId: null, revision: 7, version: 3, locked: false, staff: true, canManage: true, workflow: 'questions', deadline: null, definition: def }, uuid(1)).version, 3);
 assert.equal(back.revision, 7, 'the revision is the exact number read');
});

// --------------------------------------------------------------------------------------------------------------------------------
// The contract
// --------------------------------------------------------------------------------------------------------------------------------
test('contract: the wizard\'s save is accepted; extra keys, a client-named user, string or fractional revisions and bad shapes are refused', () => {
 const definition = plain(hw.toDefinition(complete(), true));
 const save = { offeringId: uuid(2), lessonId: uuid(3), revision: 7, definition };
 assert.equal(contract.homeworkSave.parse(save).revision, 7);
 assert.equal(contract.homeworkSave.parse({ ...save, revision: Number.MAX_SAFE_INTEGER }).revision, Number.MAX_SAFE_INTEGER, 'kept exactly');
 assert.equal(contract.homeworkSave.parse({ ...save, revision: null }).revision, null);
 const bad = [
  { ...save, userId: uuid(9) }, { ...save, revision: '7' }, { ...save, revision: 7.5 }, { ...save, revision: -1 }, { ...save, revision: Number.MAX_SAFE_INTEGER + 2 },
  { ...save, offeringId: 'x' }, { ...save, definition: { ...definition, extra: 1 } }, { ...save, definition: { ...definition, mode: 'FILE_UPLOAD' } },
  { ...save, definition: { ...definition, title: '' } }, { ...save, definition: { ...definition, title: 'a\nb' } }, { ...save, definition: { ...definition, questions: [] } },
  { ...save, definition: { ...definition, questions: Array.from({ length: 101 }, (_, i) => ({ ...definition.questions[2], id: uuid(500 + i) })) } },
  { ...save, definition: { ...definition, questions: [definition.questions[0], definition.questions[0]] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[0], options: Array.from({ length: 9 }, (_, i) => ({ id: uuid(600 + i), text: '' })), correctIds: [uuid(600)] }] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[0], options: [{ id: uuid(600), text: '' }], correctIds: [uuid(600)] }] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[1], type: 'single_choice', correctIds: definition.questions[1].options.slice(0, 2).map(o => o.id) }] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[2], options: [{ id: uuid(77), text: 'x' }] }] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[1], responseMode: 'both' }] } },
  { ...save, definition: { ...definition, questions: [{ ...definition.questions[2], points: 101 }] } },
  { ...save, definition: { ...definition, rules: { ...definition.rules, extra: true } } },
 ];
 bad.forEach((b, i) => assert.ok(!contract.homeworkSave.safeParse(b).success, 'bad ' + i));
});
test('contract: lifecycle, Change deadline and Delete images take exactly their fields', () => {
 const ok = b => contract.homeworkLifecycle.safeParse(b).success;
 for (const action of ['publish', 'unpublish', 'clone']) assert.ok(ok({ action, revision: 3 }), action);
 assert.ok(ok({ action: 'reschedule', revision: 3, deadline: '2026-11-20T18:00:00+02:00', lateAllowed: true }));
 for (const b of [{ action: 'publish' }, { action: 'publish', revision: '3' }, { action: 'delete', revision: 3 }, { action: 'publish', revision: 3, deadline: '2026-11-20T18:00:00+02:00' },
  { action: 'reschedule', revision: 3, deadline: '2026-11-20T18:00:00', lateAllowed: true }, { action: 'reschedule', revision: 3, deadline: '2026-11-20T18:00:00+02:00' },
  { action: 'reschedule', revision: 3, deadline: 'tomorrow', lateAllowed: false }, { action: 'publish', revision: 3, userId: uuid(1) }]) assert.ok(!ok(b), JSON.stringify(b));
 assert.ok(contract.homeworkDeleteImages.safeParse({ confirm: true }).success);
 for (const b of [{}, { confirm: false }, { confirm: 'true' }, { confirm: true, paths: ['x'] }]) assert.ok(!contract.homeworkDeleteImages.safeParse(b).success, JSON.stringify(b));
 assert.deepEqual(plain(contract.portalQuery.parse({})), { tab: 'open', page: 0 });
 assert.deepEqual(plain(contract.portalQuery.parse({ course: uuid(1), tab: 'closed', page: '3' })), { course: uuid(1), tab: 'closed', page: 3 });
 for (const q of [{ tab: 'all' }, { page: '-1' }, { page: '1.5' }, { course: 'x' }, { user: uuid(1) }]) assert.ok(!contract.portalQuery.safeParse(q).success, JSON.stringify(q));
});

// --------------------------------------------------------------------------------------------------------------------------------
// Refusals
// --------------------------------------------------------------------------------------------------------------------------------
test('refusals: every database code and reason maps to one status and body, and the screen reads it back', () => {
 const cases = [
  [{ code: 'PT409', message: 'Homework is closed', details: '{"reason":"still_open"}' }, 409, { kind: 'refused', reason: 'still_open' }],
  [{ code: 'PT409', message: 'x', details: '{"reason":"deadline_passed"}' }, 409, { kind: 'refused', reason: 'deadline_passed' }],
  [{ code: 'PT409', message: 'x', details: '{"reason":"no_tries_left"}' }, 409, { kind: 'refused', reason: 'no_tries_left' }],
  [{ code: 'PT409', message: 'x', details: '{"reason":"Not A Reason!"}' }, 409, { kind: 'changed' }],
  [{ code: 'PT409', message: 'Work has started; clone a new version' }, 409, { kind: 'refused', reason: 'started' }],
  [{ code: 'PT409', message: 'Homework changed. Reload it.' }, 409, { kind: 'changed' }],
  [{ code: 'PT409', message: 'x', details: 'not json' }, 409, { kind: 'changed' }],
  [{ code: '23503', message: 'in use' }, 409, { kind: 'refused', reason: 'in_use' }],
  [{ code: '42501', message: 'Not allowed' }, 403, { kind: 'denied' }],
  [{ code: 'PGRST116', message: 'none' }, 403, { kind: 'denied' }],
  [{ code: '23514', message: 'Set a deadline before publishing' }, 400, { kind: 'invalid', reason: 'no_deadline' }],
  [{ code: '23514', message: 'The new deadline must be in the future' }, 400, { kind: 'invalid', reason: 'deadline_past' }],
  [{ code: '23514', message: 'Photo answers are off: every essay is answered in text' }, 400, { kind: 'invalid', reason: 'photos_off' }],
  [{ code: '23514', message: 'A model answer picture is an image' }, 400, { kind: 'invalid', reason: 'model_image' }],
  [{ code: 'PT409', message: 'Work has started; this homework stays in its lesson', details: '{"reason":"started"}' }, 409, { kind: 'refused', reason: 'started' }],
  [{ code: 'PT409', message: 'A later version stays in its lesson', details: '{"reason":"versioned"}' }, 409, { kind: 'refused', reason: 'versioned' }],
  [{ code: 'PT409', message: 'A homework stays in its teaching space', details: '{"reason":"other_space"}' }, 409, { kind: 'refused', reason: 'other_space' }],
  [{ code: '23514', message: 'Complete question keys before publishing' }, 400, { kind: 'invalid', reason: 'keys' }],
  [{ code: '23514', message: 'Tries must be 2 to 10' }, 400, { kind: 'invalid', reason: 'tries' }],
  [{ code: '23514', message: 'Finish cloned media first' }, 400, { kind: 'invalid', reason: 'media' }],
  [{ code: '23514', message: 'Only new homework has a deadline' }, 400, { kind: 'invalid', reason: 'legacy' }],
  [{ code: '23514', message: 'Something else' }, 400, { kind: 'invalid' }],
  [{ code: '22P02', message: 'bad uuid' }, 400, { kind: 'invalid' }],
  [{ code: '23505', message: 'duplicate' }, 400, { kind: 'invalid' }],
  [{ code: 'PT413', message: 'too large' }, 413, { kind: 'too_large' }],
  [{ code: '57014', message: 'timeout' }, 503, { kind: 'failed' }],
  [{}, 503, { kind: 'failed' }],
 ];
 for (const [error, status, body] of cases) {
  const r = hw.homeworkReply(error);
  assert.equal(r.status, status, JSON.stringify(error)); assert.deepEqual(plain(r.body), body, JSON.stringify(error));
  const seen = plain(hw.homeworkFailure(r.status, r.body));
  if (body.kind === 'refused' || body.kind === 'invalid') assert.deepEqual(seen, { kind: body.kind, reason: body.reason ?? null });
  else assert.equal(seen.kind, status === 403 ? 'denied' : body.kind);
  assert.doesNotMatch(JSON.stringify(r.body), /Not allowed|duplicate|uuid|timeout/, 'no database text reaches the screen');
 }
 assert.deepEqual(plain(hw.homeworkFailure(null, null)), { kind: 'unknown' }, 'no reply: it may have been saved');
 assert.deepEqual(plain(hw.homeworkFailure(401, { kind: 'signin' })), { kind: 'signin' });
 assert.deepEqual(plain(hw.homeworkFailure(404, { kind: 'denied' })), { kind: 'denied' });
 assert.deepEqual(plain(hw.homeworkFailure(415, { kind: 'invalid' })), { kind: 'invalid', reason: null });
 assert.deepEqual(plain(hw.homeworkFailure(500, {})), { kind: 'failed' });
 const words = read('frontend/features/teacher-homework/homework-words.ts');
 for (const reason of ['started', 'versioned', 'other_space', 'still_open', 'no_deadline', 'deadline_past', 'keys', 'model_image', 'photos_off', 'tries', 'media', 'legacy']) {
  assert.match(words, new RegExp(`${reason}: 'hw\\.fail\\.${reason}'`), reason); assert.ok(messages.en['hw.fail.' + reason] && messages.ar['hw.fail.' + reason], reason);
 }
});

// --------------------------------------------------------------------------------------------------------------------------------
// The page's own logic
// --------------------------------------------------------------------------------------------------------------------------------
test('page: row actions follow the tab and the teacher\'s rights; sizes and pages read plainly', () => {
 const open = { status: 'published', deadline: '2026-11-16T23:59:00+02:00', workflow: 'questions' };
 assert.deepEqual(plain(hw.rowActions(open, 'open', true, true)), ['edit', 'deadline', 'unpublish']);
 assert.deepEqual(plain(hw.rowActions(open, 'closed', true, true)), ['edit', 'deadline', 'unpublish', 'delete_images']);
 assert.deepEqual(plain(hw.rowActions(open, 'closed', false, true)), ['delete_images'], 'a manager who cannot edit');
 assert.deepEqual(plain(hw.rowActions(open, 'closed', true, false)), ['edit', 'deadline', 'unpublish'], 'Delete images is for managers');
 assert.deepEqual(plain(hw.rowActions({ ...open, status: 'draft' }, 'drafts', true, true)), ['edit', 'publish']);
 assert.deepEqual(plain(hw.rowActions({ ...open, workflow: 'legacy' }, 'open', true, false)), ['edit', 'unpublish'], 'old homework has no deadline rules');
 assert.deepEqual(plain(hw.rowActions(open, 'open', false, false)), []);
 const n = x => String(x);
 assert.deepEqual(plain(hw.storageSize(1468006, n)), { value: '1.4', unit: 'mb' }); assert.deepEqual(plain(hw.storageSize(839680, n)), { value: '820', unit: 'kb' });
 assert.deepEqual(plain(hw.storageSize(10, n)), { value: '1', unit: 'kb' }); assert.deepEqual(plain(hw.storageSize(0, n)), { value: '0', unit: 'kb' });
 assert.equal(hw.pageCount(0, 25), 1); assert.equal(hw.pageCount(25, 25), 1); assert.equal(hw.pageCount(26, 25), 2);
});

// --------------------------------------------------------------------------------------------------------------------------------
// The routes, with a stubbed viewer and database client
// --------------------------------------------------------------------------------------------------------------------------------
const ORIGIN = 'https://lms.test';
function server({ viewer = { id: uuid(70), backend: 'firebase' }, rpc = {}, editable = true, from = {}, remove } = {}) {
 // `editable` is a yes for every course, or a function of the course.
 const calls = [];
 const client = {
  rpc: async (name, args) => { calls.push(['rpc', name, args]); const r = rpc[name]; return typeof r === 'function' ? r(args) : r ?? { data: null, error: null }; },
  from: table => ({ select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: (from[table] ?? {})[v] ?? null }) }) }) }),
  storage: { from: bucket => ({ remove: async paths => { calls.push(['remove', bucket, paths]); return remove ? remove(paths) : { data: paths.map(name => ({ name })), error: null }; } }) },
 };
 const service = load('server/services/teacher-homework.ts', {
  'server-only': {}, '@/server/integrations/supabase': { getSupabaseServerClient: async () => client },
  '@/server/services/homework': { homeworkService: async () => ({ client, copyCloneMedia: async id => calls.push(['copy', id]) }) },
  '@/server/services/teacher-course': { editableTeacherCourse: async (user, course) => { calls.push(['editable', user, course]); return typeof editable === 'function' ? editable(course) : editable; } },
  '@/shared/teacher-homework': hw,
 });
 class NextResponse { constructor(body, init) { this.body = body; this.status = init.status; this.headers = new Map(Object.entries(init.headers ?? {})); } static json(body, init) { return new NextResponse(body, init); } }
 const http = load('server/http/teacher-homework.ts', {
  'server-only': {}, 'next/server': { NextResponse }, zod: require('zod'),
  '@/server/http/firebase/route': { validFirebaseOrigin: r => r.headers.get('origin') === ORIGIN && r.headers.get('sec-fetch-site') !== 'cross-site' },
  '@/server/services/application-auth': { getApplicationViewer: async () => viewer },
  '@/server/services/teacher-homework': service, '@/shared/auth-config': { isFirebaseStaging: () => true }, '@/shared/contracts/teacher-homework': contract,
 });
 return { http, calls };
}
function request(path, { method = 'POST', body, headers = {}, raw } = {}) {
 const h = new Map(Object.entries({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }).filter(([, v]) => v !== null));
 const bytes = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
 const url = new URL(ORIGIN + path);
 return { method, headers: { get: k => h.get(k.toLowerCase()) ?? null }, nextUrl: url,
  body: bytes && { getReader: () => { let sent = 0; return { read: async () => sent < bytes.length ? { done: false, value: bytes.subarray(sent, sent += 65536) } : { done: true }, cancel: async () => {} }; } } };
}
const params = homeworkId => ({ params: Promise.resolve({ homeworkId }) });
const saveBody = (revision = null) => ({ offeringId: uuid(2), lessonId: uuid(3), revision, definition: plain(hw.toDefinition(complete(), false)) });

test('routes: signed out is 401 before any database call; a foreign origin is 403; reads must be same origin', async () => {
 const { http, calls } = server({ viewer: null });
 assert.equal((await http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body: saveBody() }), params('new'))).status, 401);
 assert.equal((await http.homeworkPortalGET(request('/api/teacher/homework', { method: 'GET', headers: { origin: null } }))).status, 401);
 assert.equal((await http.homeworkLifecyclePOST(request(`/api/teacher/homework/${uuid(5)}/lifecycle`, { body: { action: 'publish', revision: 1 } }), params(uuid(5)))).status, 401);
 assert.equal((await http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: true } }), params(uuid(5)))).status, 401);
 assert.equal((await http.homeworkGET(request(`/api/teacher/homework/${uuid(5)}`, { method: 'GET', headers: { origin: null } }), params(uuid(5)))).status, 401);
 assert.deepEqual(calls, []);
 const s = server();
 assert.equal((await s.http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body: saveBody(), headers: { origin: 'https://evil.test' } }), params('new'))).status, 403);
 assert.equal((await s.http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body: saveBody(), headers: { origin: null } }), params('new'))).status, 403, 'a write must say where it came from');
 assert.equal((await s.http.homeworkPortalGET(request('/api/teacher/homework', { method: 'GET', headers: { origin: null, 'sec-fetch-site': 'cross-site' } }))).status, 403);
 assert.equal((await s.http.homeworkPortalGET(request('/api/teacher/homework', { method: 'GET', headers: { origin: 'https://evil.test', 'sec-fetch-site': null } }))).status, 403);
 assert.deepEqual(s.calls, []);
});
test('routes: bad, oversized, wrongly typed and repeated input is refused before the database', async () => {
 const { http, calls } = server();
 const save = (body, opts = {}) => http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body, ...opts }), params(opts.id ?? 'new'));
 assert.equal((await save(saveBody(), { headers: { 'content-type': 'text/plain' } })).status, 415);
 assert.equal((await save(undefined, { raw: Buffer.from('{not json') })).status, 400);
 assert.equal((await save(undefined, { raw: Buffer.alloc(600001, 32) })).status, 413);
 assert.equal((await save({ ...saveBody(), userId: uuid(9) })).status, 400);
 assert.equal((await save(saveBody(3))).status, 400, 'a new homework has no revision');
 assert.equal((await save(saveBody(), { id: 'not-a-uuid' })).status, 400);
 const life = (id, body, raw) => http.homeworkLifecyclePOST(request(`/api/teacher/homework/${id}/lifecycle`, { body, raw }), params(id));
 assert.equal((await life('new', { action: 'publish', revision: 1 })).status, 400, 'new is only for saving');
 assert.equal((await life(uuid(5), { action: 'publish', revision: '1' })).status, 400);
 assert.equal((await life(uuid(5), undefined, Buffer.alloc(5000, 32))).status, 413);
 assert.equal((await http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: false } }), params(uuid(5)))).status, 400);
 const portal = q => http.homeworkPortalGET(request('/api/teacher/homework' + q, { method: 'GET', headers: { origin: null } }));
 for (const q of ['?tab=open&tab=closed', '?tab=all', '?page=-1', '?course=x', '?user=' + uuid(1)]) assert.equal((await portal(q)).status, 400, q);
 assert.equal((await http.homeworkGET(request('/api/teacher/homework/x', { method: 'GET' }), params('x'))).status, 400);
 assert.deepEqual(calls, [], 'nothing reached the database');
});
test('routes: the user is the signed-in one; a teacher who cannot edit the course is refused before the write; versions go and come back exactly', async () => {
 const view = { id: uuid(5), offeringId: uuid(2), lessonId: uuid(3), revision: 9007199254740991, staff: true, locked: false };
 const s = server({ rpc: { save_homework: { data: uuid(5), error: null }, get_homework: { data: view, error: null } }, from: { course_offerings: { [uuid(2)]: { course_id: uuid(1) } }, homework_assignments: { [uuid(5)]: { course_id: uuid(1) } } } });
 const r = await s.http.homeworkSavePOST(request(`/api/teacher/homework/${uuid(5)}/save`, { body: saveBody(9007199254740990) }), params(uuid(5)));
 assert.equal(r.status, 200); assert.deepEqual(plain(r.body), { id: uuid(5), revision: 9007199254740991 });
 assert.deepEqual(s.calls[0], ['editable', uuid(70), uuid(1)], 'the signed-in user, the course of the offering');
 const sent = s.calls.find(c => c[1] === 'save_homework')[2];
 assert.equal(sent.p_revision, 9007199254740990); assert.equal(sent.p_assignment, uuid(5)); assert.equal(sent.p_definition.rules.deadline, '2026-11-16T23:59:00+02:00');
 assert.ok(!JSON.stringify(sent).includes(uuid(70)), 'no user id is sent: the database reads it from the signed-in identity');
 assert.equal(r.headers.get('Cache-Control'), 'private, no-store');

 const other = server({ editable: false, from: { course_offerings: { [uuid(2)]: { course_id: uuid(1) } }, homework_assignments: { [uuid(5)]: { course_id: uuid(1) } } } });
 assert.equal((await other.http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body: saveBody() }), params('new'))).status, 404, 'another space\'s teacher, or an assistant without editing');
 assert.equal((await other.http.homeworkLifecyclePOST(request(`/api/teacher/homework/${uuid(5)}/lifecycle`, { body: { action: 'unpublish', revision: 2 } }), params(uuid(5)))).status, 404);
 assert.ok(!other.calls.some(c => c[0] === 'rpc'), 'no write was tried');
 const unseen = server({ from: {} });
 assert.equal((await unseen.http.homeworkSavePOST(request('/api/teacher/homework/new/save', { body: saveBody() }), params('new'))).status, 404, 'an offering the teacher cannot see');

 const refused = server({ rpc: { homework_lifecycle: { data: null, error: { code: 'PT409', message: 'Homework changed' } } }, from: { homework_assignments: { [uuid(5)]: { course_id: uuid(1) } } } });
 const stale = await refused.http.homeworkLifecyclePOST(request(`/api/teacher/homework/${uuid(5)}/lifecycle`, { body: { action: 'reschedule', revision: 4, deadline: '2026-11-20T18:00:00+02:00', lateAllowed: true } }), params(uuid(5)));
 assert.equal(stale.status, 409); assert.deepEqual(plain(stale.body), { kind: 'changed' });
 assert.deepEqual(plain(refused.calls.find(c => c[1] === 'homework_lifecycle')[2]), { p_assignment: uuid(5), p_action: 'reschedule', p_revision: 4, p_data: { deadline: '2026-11-20T18:00:00+02:00', lateAllowed: true } });

 const student = server({ rpc: { get_homework: { data: { ...view, staff: false }, error: null } } });
 assert.equal((await student.http.homeworkGET(request(`/api/teacher/homework/${uuid(5)}`, { method: 'GET', headers: { origin: null } }), params(uuid(5)))).status, 404, 'a student reading through the teacher route');
 const thrown = server({ rpc: { homework_portal: () => { throw Error('network'); } } });
 const failed = await thrown.http.homeworkPortalGET(request('/api/teacher/homework?tab=closed&page=2', { method: 'GET', headers: { origin: null } }));
 assert.equal(failed.status, 503); assert.deepEqual(plain(failed.body), { kind: 'failed' });
});
test('routes: a move checks the course it goes to and the course it is in; started and versioned come back as plain refusals', async () => {
 // uuid(1) is Physics (offering uuid(2)); uuid(8) is Chemistry (offering uuid(9)). The homework uuid(5) is in Physics.
 const from = { course_offerings: { [uuid(2)]: { course_id: uuid(1) }, [uuid(9)]: { course_id: uuid(8) } }, homework_assignments: { [uuid(5)]: { course_id: uuid(1) } },
  courses: { [uuid(1)]: { organization_id: uuid(90) }, [uuid(8)]: { organization_id: uuid(90) } } };
 const move = (s, offeringId = uuid(9)) => s.http.homeworkSavePOST(request(`/api/teacher/homework/${uuid(5)}/save`, { body: { ...saveBody(4), offeringId } }), params(uuid(5)));
 const view = { id: uuid(5), revision: 5, staff: true };
 const both = server({ rpc: { save_homework: { data: uuid(5), error: null }, get_homework: { data: view, error: null } }, from });
 assert.equal((await move(both)).status, 200);
 assert.deepEqual(both.calls.filter(c => c[0] === 'editable').map(c => c[2]), [uuid(8), uuid(1)], 'the target course, then the course it is in now');
 assert.equal(both.calls.find(c => c[1] === 'save_homework')[2].p_offering, uuid(9));

 const sourceOnly = server({ editable: course => course === uuid(1), rpc: { save_homework: { data: uuid(5), error: null } }, from });
 assert.equal((await move(sourceOnly)).status, 404, 'a teacher who cannot edit the target course');
 const targetOnly = server({ editable: course => course === uuid(8), rpc: { save_homework: { data: uuid(5), error: null } }, from });
 assert.equal((await move(targetOnly)).status, 404, 'a teacher who cannot edit the course it is in (another space\'s teacher moving it in)');
 const outsider = server({ editable: false, rpc: { save_homework: { data: uuid(5), error: null } }, from });
 assert.equal((await move(outsider)).status, 404, 'another space\'s teacher');
 const missing = server({ rpc: { save_homework: { data: uuid(5), error: null } }, from: { course_offerings: from.course_offerings } });
 assert.equal((await move(missing)).status, 404, 'a homework the teacher cannot see');
 for (const s of [sourceOnly, targetOnly, outsider, missing]) assert.ok(!s.calls.some(c => c[0] === 'rpc'), 'no write was tried');

 const same = server({ rpc: { save_homework: { data: uuid(5), error: null }, get_homework: { data: view, error: null } }, from });
 assert.equal((await move(same, uuid(2))).status, 200);
 assert.deepEqual(same.calls.filter(c => c[0] === 'editable').map(c => c[2]), [uuid(1)], 'an edit in place checks its course once');

 // One space (the owner's answer): a course in another space is refused before the write, even for a teacher who edits both.
 const spaces = { ...from, courses: { [uuid(1)]: { organization_id: uuid(90) }, [uuid(8)]: { organization_id: uuid(91) } } };
 const across = server({ rpc: { save_homework: { data: uuid(5), error: null } }, from: spaces });
 const away = await move(across);
 assert.equal(away.status, 409); assert.deepEqual(plain(away.body), { kind: 'refused', reason: 'other_space' });
 assert.deepEqual(across.calls.filter(c => c[0] === 'editable').map(c => c[2]), [uuid(8), uuid(1)], 'after both courses were checked');
 assert.ok(!across.calls.some(c => c[0] === 'rpc'), 'no write was tried');
 assert.deepEqual(plain(hw.homeworkFailure(away.status, away.body)), { kind: 'refused', reason: 'other_space' });
 assert.ok(messages.en['hw.fail.other_space'] && messages.ar['hw.fail.other_space'] && messages.en['hw.w.move_other_space'] && messages.ar['hw.w.move_other_space'], 'the screen names it');
 assert.match(read('frontend/features/teacher-homework/homework-wizard.tsx'), /reply\.failure\.reason === 'other_space'/, 'and keeps what was typed with Reload');
 const inside = server({ rpc: { save_homework: { data: uuid(5), error: null }, get_homework: { data: view, error: null } }, from: spaces });
 assert.equal((await move(inside, uuid(2))).status, 200, 'a move inside its course never asks about spaces');
 const dbSaysSo = server({ rpc: { save_homework: { data: null, error: { code: 'PT409', message: 'A homework stays in its teaching space', details: '{"reason":"other_space"}' } } }, from });
 assert.deepEqual(plain((await move(dbSaysSo)).body), { kind: 'refused', reason: 'other_space' }, 'the database\'s own refusal maps the same way');
 for (const reason of ['started', 'versioned']) {
  const refused = server({ rpc: { save_homework: { data: null, error: { code: 'PT409', message: reason === 'started' ? 'Work has started; this homework stays in its lesson' : 'A later version stays in its lesson', details: JSON.stringify({ reason }) } } }, from });
  const r = await move(refused);
  assert.equal(r.status, 409, reason); assert.deepEqual(plain(r.body), { kind: 'refused', reason });
  assert.deepEqual(plain(hw.homeworkFailure(r.status, r.body)), { kind: 'refused', reason });
  assert.ok(messages.en['hw.w.move_' + reason] && messages.ar['hw.w.move_' + reason], 'the screen names it: ' + reason);
 }
});
test('rows and the student screen: counts read "N questions · M marks"; students are told to choose one or every right answer; the model picture shows with the solutions', () => {
 const page = read('frontend/features/teacher-homework/homework-page.tsx');
 assert.match(page, /data-counts>\{countText\(t, 'question', row\.questionCount\)\} · \{countText\(t, 'mark', row\.totalMarks\)\}/);
 const words = load('frontend/features/teacher-homework/homework-words.ts', { '@/frontend/features/teacher-course/content-words': { countForm: n => n === 1 ? 'one' : n === 2 ? 'two' : n >= 3 && n <= 10 ? 'few' : 'many' }, '@/shared/teacher-homework': hw });
 const t = lang => (key, values = {}) => messages[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
 const row = (lang, q, m) => `${words.countText(t(lang), 'question', q)} · ${words.countText(t(lang), 'mark', m)}`;
 assert.equal(row('en', 1, 1), '1 question · 1 mark'); assert.equal(row('en', 3, 12), '3 questions · 12 marks');
 assert.equal(row('ar', 1, 2), [messages.ar['hw.count.question.one'], messages.ar['hw.count.mark.two']].join(' · '));
 assert.equal(messages.en['homework.choose_one'], 'Choose the right answer'); assert.equal(messages.en['homework.choose_many'], 'Choose every right answer');
 assert.match(messages.ar['homework.choose_one'], /[؀-ۿ]/); assert.match(messages.ar['homework.choose_many'], /[؀-ۿ]/);
 const student = read('frontend/features/courses/lesson/homework-question.tsx');
 assert.match(student, /homework\.choose_one'.*'homework\.choose_many'/);
 assert.match(read('frontend/features/courses/lesson/homework-student.tsx'), /'modelImageId' in k&&typeof k\.modelImageId==='string'&&<div data-model-picture><HomeworkMedia assignmentId=\{view\.id\} id=\{k\.modelImageId\}\/>/, 'only inside view.solutions, which the database fills when they open');
 const menu = read('frontend/components/design/action-menu.tsx');
 assert.match(menu, /\{item\.label\}\{item\.reason && <>\{' '\}<span data-menu-note=\{item\.key\} className="d-menu-reason">\(\{item\.reason\}\)<\/span><\/>\}<\/Menu\.Item>/, 'the reason is inside the item: "Move up (already first)"');
 assert.equal(`${messages.en['hw.w.q_up']} (${messages.en['hw.w.q_first']})`, 'Move up (already first)');
 assert.match(read('frontend/features/teacher-course/content-section.tsx'), /unavailable: a\.unavailable \|\| a\.disabled, reason: a\.disabled \? a\.reason : undefined/);
});
test('Delete images: the database marks and lists the photos, the files are removed with the signed-in client in chunks, a failure is left for maintenance', async () => {
 const paths = Array.from({ length: 150 }, (_, i) => `${uuid(5)}/sub/${i}.jpg`);
 const ok = server({ rpc: { homework_delete_images: { data: { deletedFiles: 152, bytesFreed: 4096, paths: [...paths, `${uuid(6)}/sub/x.jpg`, `${uuid(5)}/../x.jpg`, 7] }, error: null } } });
 const r = await ok.http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: true } }), params(uuid(5)));
 assert.equal(r.status, 200); assert.deepEqual(plain(r.body), { deletedFiles: 152, bytesFreed: 4096, filesRemoved: 150, storage: 'done' });
 const removed = ok.calls.filter(c => c[0] === 'remove');
 assert.deepEqual(removed.map(c => [c[1], c[2].length]), [['lms-homework', 100], ['lms-homework', 50]]);
 assert.ok(removed.every(c => c[2].every(p => p.startsWith(uuid(5) + '/') && !p.includes('..'))), 'nothing outside this homework is ever sent');

 let n = 0;
 const half = server({ rpc: { homework_delete_images: { data: { deletedFiles: 150, bytesFreed: 1, paths }, error: null } }, remove: p => { if (n++) throw Error('down'); return { data: null, error: { message: 'storage' } }; } });
 const later = await half.http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: true } }), params(uuid(5)));
 assert.equal(later.status, 200, 'the photos are gone for students either way; the files wait for maintenance');
 assert.deepEqual(plain(later.body), { deletedFiles: 150, bytesFreed: 1, filesRemoved: 0, storage: 'retry' });

 const open = server({ rpc: { homework_delete_images: { data: null, error: { code: 'PT409', message: 'Homework is still open', details: '{"reason":"still_open"}' } } } });
 const early = await open.http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: true } }), params(uuid(5)));
 assert.equal(early.status, 409); assert.deepEqual(plain(early.body), { kind: 'refused', reason: 'still_open' });
 assert.ok(!open.calls.some(c => c[0] === 'remove'), 'nothing removed while it is open');
 const denied = server({ rpc: { homework_delete_images: { data: null, error: { code: '42501', message: 'Only managers' } } } });
 assert.equal((await denied.http.homeworkDeleteImagesPOST(request(`/api/teacher/homework/${uuid(5)}/delete-images`, { body: { confirm: true } }), params(uuid(5)))).status, 403);
 assert.match(read('scripts/lms-storage-maintenance.cjs'), /lms-homework/, 'maintenance knows the homework bucket');
});
test('routes: one-line adapters, the timed handlers, signed-in client only, no service role, the old routes stay', () => {
 const adapters = {
  'app/api/teacher/homework/route.ts': "export { timedHomeworkPortalGET as GET } from '@/server/http/timed';",
  'app/api/teacher/homework/[homeworkId]/route.ts': "export { timedHomeworkGET as GET } from '@/server/http/timed';",
  'app/api/teacher/homework/[homeworkId]/save/route.ts': "export { timedHomeworkSavePOST as POST } from '@/server/http/timed';",
  'app/api/teacher/homework/[homeworkId]/lifecycle/route.ts': "export { timedHomeworkLifecyclePOST as POST } from '@/server/http/timed';",
  'app/api/teacher/homework/[homeworkId]/delete-images/route.ts': "export { timedHomeworkDeleteImagesPOST as POST } from '@/server/http/timed';",
 };
 for (const [file, line] of Object.entries(adapters)) assert.equal(read(file).trim(), line, file);
 const timed = read('server/http/timed.ts');
 for (const name of ['HomeworkPortalGET', 'HomeworkGET', 'HomeworkSavePOST', 'HomeworkLifecyclePOST', 'HomeworkDeleteImagesPOST']) assert.match(timed, new RegExp('timed' + name), name);
 const code = read('server/http/teacher-homework.ts') + read('server/services/teacher-homework.ts');
 assert.doesNotMatch(code, /service[_-]?role|supabaseAdmin|SERVICE_ROLE/i);
 assert.doesNotMatch(code, /body\.data\.userId|userId:\s*body|new Date\(/, 'no user from the client, no JS dates for versions');
 for (const old of ['save', 'lifecycle', 'list']) assert.ok(fs.existsSync(`app/api/homework/[assignmentId]/${old}/route.ts`) || fs.readdirSync('app/api/homework').length, old);
});
test('middleware: the homework endpoints and pages pass by exact path, nothing next to them does', () => {
 const source = read('middleware.ts');
 const apiLine = source.split('\n').find(l => l.includes("path === '/api/teacher/homework'"));
 const pattern = line => { const start = line.indexOf('/^'), end = line.indexOf('$/.test', start); return new RegExp(line.slice(start + 1, end + 1)); };
 const api = pattern(apiLine);
 const pageLine = source.split('\n').find(l => l.includes("path === '/teacher/homework'"));
 const page = pattern(pageLine);
 const id = uuid(1);
 for (const good of ['/api/teacher/homework/new/save', `/api/teacher/homework/${id}`, `/api/teacher/homework/${id}/save`, `/api/teacher/homework/${id}/lifecycle`, `/api/teacher/homework/${id}/delete-images`]) assert.ok(api.test(good), good);
 for (const bad of ['/api/teacher/homework/new', '/api/teacher/homework/new/lifecycle', `/api/teacher/homework/${id}/`, `/api/teacher/homework/${id}/grade`, `/api/teacher/homework/${id}/save/x`, '/api/teacher/homework/not-a-uuid/save', '/api/teacher/homework/ABCDEF00-0000-4000-8000-000000000001']) assert.ok(!api.test(bad), bad);
 assert.ok(page.test(`/teacher/homework/${id}`)); assert.ok(!page.test(`/teacher/homework/${id}/edit`)); assert.ok(!page.test('/teacher/homework/x'));
 assert.match(pageLine, /no-referrer/); assert.match(pageLine, /private, no-store/);
});

// --------------------------------------------------------------------------------------------------------------------------------
// Screens: static rules
// --------------------------------------------------------------------------------------------------------------------------------
const screens = ['homework-page.tsx', 'homework-wizard.tsx', 'correct-screen.tsx'].map(f => read('frontend/features/teacher-homework/' + f)).join('\n');
test('screens: no native checkbox, no disabled attribute, only the teacher homework and content routes, nothing decided by a role', () => {
 assert.doesNotMatch(screens, /type=["']checkbox["']/);
 assert.doesNotMatch(screens, /<(button|input|textarea|select)\b[^>]*\sdisabled[\s=>]/, 'aria-disabled with a reason instead (the design controls take `disabled` and render aria-disabled)');
 assert.match(screens, /aria-disabled/); assert.doesNotMatch(screens, /hw-correct-later|hw\.correct_later/, 'Correct is a real link now (homework-correct)');
 assert.match(screens, /href=\{`\/teacher\/homework\/\$\{row\.id\}\/correct`\}[^>]*data-correct=\{row\.id\}/);
 const routes = [...new Set([...screens.matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map(m => m[1]))].sort();
 for (const r of routes) assert.match(r, /^\/api\/(teacher\/homework|teacher\/courses\/|homework\/)/, r);
 assert.doesNotMatch(screens, /isTeacher|role ===|viewer\.role|service[_-]?role/);
 assert.doesNotMatch(screens, /new Date\([^)]*\)\.toISOString\(\)/, 'deadlines go out with Cairo\'s offset, not as UTC');
 const content = read('frontend/features/teacher-course/content-section.tsx');
 assert.doesNotMatch(content, /disabled=\{a\.disabled\}/, 'the phone sheet says why instead');
 assert.match(content, /data-content-unpublish/); assert.match(content, /'publish_lesson'|"publish_lesson"/); assert.match(content, /'unpublish_lesson'|"unpublish_lesson"/);
});
test('menu: Homework is a real page, no longer Soon, on the desktop menu and the phone More sheet', () => {
 const nav = load('shared/teacher-home.ts', { '@/shared/teacher-groups': { unsavedSessions: () => [] }, '@/shared/teacher-attendance': { canTakeAttendance: () => false } });
 assert.ok(nav.teacherNav.some(i => i.key === 'homework' && i.href === '/teacher/homework'));
 assert.deepEqual(plain(nav.teacherNavSoon), []);
 assert.ok(nav.teacherHomeworkActive('/teacher/homework')); assert.ok(nav.teacherHomeworkActive('/teacher/homework/new')); assert.ok(!nav.teacherHomeworkActive('/teacher/homeworks'));
 assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /data-more-item="homework"|data-more-item=\{?['"]homework/);
});
test('locales: every Homework text in both languages, same holes, Arabic, plural forms, and none of the ruled-out words', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('hw.'));
 assert.ok(keys.length >= 150, String(keys.length));
 for (const k of [...keys, ...Object.keys(messages.ar).filter(k => k.startsWith('hw.'))]) assert.ok(messages.en[k]?.trim() && messages.ar[k]?.trim(), k);
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  if (/[a-z]/i.test(messages.en[k].replace(/\{\w+\}/g, ''))) assert.match(messages.ar[k], /[؀-ۿ]/, k);
  assert.doesNotMatch(messages.en[k] + ' ' + messages.ar[k], /\bblocks?\b|\bmodules?\b|\bofferings?\b|\bsegments?\b|organi[sz]ation|enrol(l)?ment|منظمة|مؤسسة|وحدة/i, k);
 }
 for (const noun of ['question', 'mark', 'essay', 'choice']) for (const form of ['one', 'two', 'few', 'many']) assert.ok(messages.en[`hw.count.${noun}.${form}`] && messages.ar[`hw.count.${noun}.${form}`], noun + form);
 const all = keys.map(k => messages.en[k]).join('\n');
 assert.doesNotMatch(all, /Correcting comes in the next update/, 'correcting is built (homework-correct)');
 assert.match(all, /Image deleted to free space/); assert.match(all, /Save and next student/);
 assert.match(all, /Students who already saw the solutions keep them and get no more tries\./);
 assert.match(all, /Students see it when this lesson is published/);
 assert.match(all, /grades and notes are kept/i);
 assert.equal(messages.en['tc.content.unpublish_text'] ?? Object.values(messages.en).find(v => v.startsWith('Students won\'t see this lesson')), "Students won't see this lesson or its homework until you publish it again. Their answers and grades are kept.");
});
