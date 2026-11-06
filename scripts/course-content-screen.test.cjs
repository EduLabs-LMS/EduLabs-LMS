// The Content section of the course page: numbering, the requests it sends, how refusals become words, the contract and the route (static and pure; behaviour is in teacher-course-content-browser.cjs).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: m, exports: m.exports, URL, Array, Map, Set, JSON, Number, require: n => n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const shared = load('shared/course-content.ts');
const { contentEdit } = load('shared/contracts/course-content.ts', { zod: require('zod') });
const words = load('frontend/features/teacher-course/content-words.ts');
const { messages, translate } = require('./localization-test-loader.cjs').load('frontend/locales/messages.ts');
const fill = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
const say = language => (key, values) => { assert.ok(messages[language][key], key); return translate ? translate(language, key, values) : fill(messages[language][key], values); };
const en = say('en'), ar = say('ar');

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const stamp = n => `2026-11-06T10:00:${String(n).padStart(2, '0')}.123456+00:00`;
const lesson = (n, chapterId, position, extra = {}) => ({ id: uuid(n), chapterId, title: 'Lesson ' + n, position, status: 'draft', updatedAt: stamp(n), homework: 0, draftHomework: 0, deleteBlockers: [], contentBlocks: 0, hasCover: false, parts: 0, ...extra });
const chapter = (n, number) => ({ id: uuid(n), title: 'Chapter ' + n, type: 'chapter', number, position: number - 1, updatedAt: stamp(n) });
const structure = () => ({ archived: false, canEdit: true, chapters: [chapter(2, 2), chapter(1, 1), chapter(3, 3)],
 lessons: [lesson(13, uuid(1), 7), lesson(11, uuid(1), 0), lesson(12, uuid(1), 3), lesson(21, uuid(2), 40)] });
const item = n => ({ id: uuid(n), updated_at: stamp(n) });

test('numbering: chapters by stored number, lessons by order: gaps in positions never show', () => {
 const tree = shared.buildTree(structure());
 assert.deepEqual(plain(tree.map(c => c.number)), [1, 2, 3]);
 assert.deepEqual(plain(tree[0].lessons.map(l => [l.id, l.label])), [[uuid(11), '1.1'], [uuid(12), '1.2'], [uuid(13), '1.3']]);
 assert.deepEqual(plain(tree[1].lessons.map(l => l.label)), ['2.1'], 'position 40 is still the first lesson');
 assert.equal(tree[2].lessons.length, 0);
});
test('numbering: the chapter number is the stored one, not worked out here', () => {
 const s = structure(); s.chapters[1].number = 9;
 assert.deepEqual(plain(shared.buildTree(s).map(c => c.number)), [9, 2, 3]);
 assert.equal(shared.buildTree(s)[0].lessons[2].label, '9.3');
});
test('reorder: the whole new order with the exact versions read; a move to the same place, or off the end, sends nothing', () => {
 const tree = shared.buildTree(structure());
 assert.deepEqual(plain(shared.reorderChaptersEdit(tree, 2, 0)), { action: 'reorder_modules', items: [item(3), item(1), item(2)] });
 assert.deepEqual(plain(shared.reorderLessonsEdit(tree[0], 0, 2)), { action: 'reorder_lessons', parentId: uuid(1), items: [item(12), item(13), item(11)] });
 assert.equal(shared.reorderChaptersEdit(tree, 1, 1), null); assert.equal(shared.reorderChaptersEdit(tree, 0, -1), null); assert.equal(shared.reorderChaptersEdit(tree, 2, 3), null);
 assert.equal(shared.reorderLessonsEdit(tree[0], 0, 3), null); assert.equal(shared.reorderLessonsEdit(tree[2], 0, 0), null);
});
test('move: the target chapter\'s full order with the lesson last, carrying the version read; its own chapter sends nothing', () => {
 const tree = shared.buildTree(structure());
 assert.deepEqual(plain(shared.moveLessonEdit(tree[0].lessons[0], tree[1])), { action: 'move_lesson', id: uuid(11), parentId: uuid(2), updatedAt: stamp(11), items: [item(21), item(11)] });
 assert.deepEqual(plain(shared.moveLessonEdit(tree[0].lessons[0], tree[2])).items, [item(11)], 'an empty chapter');
 assert.equal(shared.moveLessonEdit(tree[0].lessons[0], tree[0]), null);
});
test('delete chapter: lists every lesson shown, so one added elsewhere is not removed unseen', () => {
 const tree = shared.buildTree(structure());
 assert.deepEqual(plain(shared.deleteChapterEdit(tree[0])), { action: 'delete_chapter', id: uuid(1), updatedAt: stamp(1), items: [item(11), item(12), item(13)] });
});
test('what shows during a reorder: chapters renumber, lessons change order, and the input is untouched so a failure can put it back', () => {
 const s = structure(), before = JSON.stringify(s);
 const next = shared.buildTree(shared.withChapterOrder(s, 2, 0));
 assert.deepEqual(plain(next.map(c => [c.id, c.number, c.position])), [[uuid(3), 1, 0], [uuid(1), 2, 1], [uuid(2), 3, 2]]);
 assert.equal(next[1].lessons[0].label, '2.1');
 const lessons = shared.buildTree(shared.withLessonOrder(s, uuid(1), 2, 0))[0].lessons;
 assert.deepEqual(plain(lessons.map(l => [l.id, l.label])), [[uuid(13), '1.1'], [uuid(11), '1.2'], [uuid(12), '1.3']]);
 assert.equal(JSON.stringify(s), before);
});
test('database call: each action goes to the function the owner named, with the version and parent in the right place', () => {
 const course = uuid(99), call = edit => plain(shared.contentCall(course, edit));
 const base = { p_course_id: course, p_id: null, p_parent_id: null, p_updated_at: null };
 assert.deepEqual(call({ action: 'create_chapter', title: 'A' }), { fn: 'edit_course_structure', args: { ...base, p_action: 'create_chapter', p_data: { title: 'A' } } });
 assert.deepEqual(call({ action: 'rename_chapter', id: uuid(1), updatedAt: stamp(1), title: 'B' }), { fn: 'edit_course_structure', args: { ...base, p_action: 'rename_chapter', p_id: uuid(1), p_updated_at: stamp(1), p_data: { title: 'B' } } });
 assert.deepEqual(call({ action: 'rename_lesson', id: uuid(11), updatedAt: stamp(11), title: 'C' }), { fn: 'edit_course_structure', args: { ...base, p_action: 'rename_lesson', p_id: uuid(11), p_updated_at: stamp(11), p_data: { title: 'C' } } });
 assert.deepEqual(call({ action: 'delete_lesson', id: uuid(11), updatedAt: stamp(11) }), { fn: 'edit_course_structure', args: { ...base, p_action: 'delete_lesson', p_id: uuid(11), p_updated_at: stamp(11), p_data: {} } });
 assert.deepEqual(call({ action: 'delete_chapter', id: uuid(1), updatedAt: stamp(1), items: [item(11)] }), { fn: 'edit_course_structure', args: { ...base, p_action: 'delete_chapter', p_id: uuid(1), p_updated_at: stamp(1), p_data: { items: [item(11)] } } });
 assert.deepEqual(call({ action: 'move_lesson', id: uuid(11), parentId: uuid(2), updatedAt: stamp(11), items: [item(11)] }), { fn: 'edit_course_structure', args: { ...base, p_action: 'move_lesson', p_id: uuid(11), p_parent_id: uuid(2), p_updated_at: stamp(11), p_data: { items: [item(11)] } } });
 assert.deepEqual(call({ action: 'create_lesson', parentId: uuid(1), title: 'D' }), { fn: 'edit_learning_content', args: { ...base, p_action: 'create_lesson', p_parent_id: uuid(1), p_data: { title: 'D' } } });
 assert.deepEqual(call({ action: 'reorder_modules', items: [item(1)] }), { fn: 'edit_learning_content', args: { ...base, p_action: 'reorder_modules', p_data: { items: [item(1)] } } });
 assert.deepEqual(call({ action: 'reorder_lessons', parentId: uuid(1), items: [item(11)] }), { fn: 'edit_learning_content', args: { ...base, p_action: 'reorder_lessons', p_parent_id: uuid(1), p_data: { items: [item(11)] } } });
});
test('database refusals become the reply the screen reads', () => {
 const r = error => plain(shared.contentReply(error));
 assert.deepEqual(r({ code: 'PT409', message: 'Stale', details: null }), { status: 409, body: { kind: 'changed' } });
 assert.deepEqual(r({ code: 'PT409', message: 'x', details: '{"reasons":["archived"]}' }), { status: 409, body: { kind: 'archived' } });
 assert.deepEqual(r({ code: '23503', message: 'x', details: '{"reasons":["student_work","parts"],"lessonIds":["a"],"contentBlocks":3,"covers":1,"parts":2,"homework":1}' }),
  { status: 409, body: { kind: 'refused', reasons: ['student_work', 'parts'], contentBlocks: 3, covers: 1, parts: 2, homework: 1 } });
 assert.deepEqual(r({ code: '23503', message: 'a foreign key', details: 'Key (id) is still referenced' }), { status: 409, body: { kind: 'refused', reasons: ['in_use'], contentBlocks: 0, covers: 0, parts: 0, homework: 0 } }, 'a plain foreign key has no JSON detail');
 for (const message of ['Module unavailable', 'Lesson unavailable', 'Content unavailable']) assert.deepEqual(r({ code: '42501', message }), { status: 409, body: { kind: 'changed' } }, message);
 for (const message of ['Course unavailable', 'Content editing denied', 'denied']) assert.deepEqual(r({ code: '42501', message }), { status: 403, body: { kind: 'denied' } }, message);
 assert.equal(r({ code: 'PGRST116' }).status, 403);
 for (const code of ['23514', '22P02', '23505']) assert.deepEqual(r({ code }), { status: 400, body: { kind: 'invalid' } }, code);
 assert.deepEqual(r({ code: 'PT413' }), { status: 413, body: { kind: 'too_large' } });
 for (const code of ['XX000', '', undefined]) assert.deepEqual(r({ code }), { status: 503, body: { kind: 'failed' } }, String(code));
});
test('the screen\'s reading of a reply: no reply is an unknown outcome, never a plain failure', () => {
 const kind = (status, body) => shared.contentFailure(status, body).kind;
 assert.deepEqual([[null], [401], [403], [404], [400], [415], [413], [500], [503]].map(([s]) => kind(s)), ['unknown', 'signin', 'denied', 'denied', 'invalid', 'invalid', 'too_large', 'failed', 'failed']);
 assert.equal(kind(409, { kind: 'changed' }), 'changed'); assert.equal(kind(409, { kind: 'archived' }), 'archived'); assert.equal(kind(409, null), 'changed');
 assert.deepEqual(plain(shared.contentFailure(409, { kind: 'refused', reasons: ['parts'], parts: 2, contentBlocks: -1, covers: 'x' })), { kind: 'refused', refusal: { reasons: ['parts'], contentBlocks: 0, covers: 0, parts: 2, homework: 0 } });
 assert.deepEqual(plain(shared.contentFailure(409, { kind: 'refused' })).refusal.reasons, ['in_use']);
});
test('before anyone tries: a lesson\'s blockers from the read; a chapter counts only the lessons that stop it', () => {
 assert.equal(shared.lessonRefusal(lesson(1, uuid(1), 0)), null);
 const blocked = lesson(2, uuid(1), 0, { deleteBlockers: ['homework', 'content'], homework: 1, draftHomework: 1, contentBlocks: 2, hasCover: true, parts: 3 });
 assert.deepEqual(plain(shared.lessonRefusal(blocked)), { reasons: ['homework', 'content'], contentBlocks: 2, covers: 1, parts: 3, homework: 2 });
 const tree = shared.buildTree({ archived: false, canEdit: true, chapters: [chapter(1, 1), chapter(2, 2)], lessons: [blocked, lesson(3, uuid(1), 1, { deleteBlockers: ['student_work', 'parts'], parts: 1, homework: 1 }), lesson(4, uuid(1), 2, { contentBlocks: 9 })] });
 assert.deepEqual(plain(shared.chapterRefusal(tree[0])), { reasons: ['homework', 'content', 'student_work', 'parts'], contentBlocks: 2, covers: 1, parts: 4, homework: 3 });
 assert.equal(shared.chapterRefusal(tree[1]), null);
});
const refusal = (reasons, extra = {}) => ({ reasons, contentBlocks: 0, covers: 0, parts: 0, homework: 0, ...extra });
test('refusal wording: "content item", never "block", in the owner\'s four Arabic forms', () => {
 const inside = (t, n, covers = 0) => words.refusalSentences(t, refusal(['content'], { contentBlocks: n, covers }), 'lesson')[0];
 assert.equal(inside(en, 1), 'This lesson has 1 content item.'); assert.equal(inside(en, 2), 'This lesson has 2 content items.'); assert.equal(inside(en, 3), 'This lesson has 3 content items.'); assert.equal(inside(en, 11), 'This lesson has 11 content items.');
 assert.equal(inside(ar, 1), 'في هذا الدرس عنصر محتوى واحد.'); assert.equal(inside(ar, 2), 'في هذا الدرس عنصرا محتوى.'); assert.equal(inside(ar, 3), 'في هذا الدرس 3 عناصر محتوى.'); assert.equal(inside(ar, 10), 'في هذا الدرس 10 عناصر محتوى.'); assert.equal(inside(ar, 11), 'في هذا الدرس 11 عنصرًا.');
 assert.equal(inside(en, 2, 1), 'This lesson has 2 content items and a cover.'); assert.equal(inside(ar, 2, 1), 'في هذا الدرس عنصرا محتوى وصورة غلاف.');
 for (const [key, text] of [...Object.entries(messages.en), ...Object.entries(messages.ar)]) if (key.startsWith('tc.content.')) assert.doesNotMatch(text, /\bblocks?\b|كتل/, key);
});
test('refusal wording: every reason in plain words, student work first, always ending with what can still be done, for a lesson and for a chapter, in both languages', () => {
 const lessonAll = refusal(['homework', 'student_work', 'student_progress', 'parts', 'content', 'in_use'], { homework: 2, parts: 1, contentBlocks: 1, covers: 1 });
 assert.deepEqual(plain(words.refusalSentences(en, lessonAll, 'lesson')), ['Students have started its homework, so it stays.', 'Students have started this lesson, so it stays.', 'This lesson has 2 homework, 1 part, 1 content item and a cover.', 'Something else still uses this lesson.', 'You can rename or move it.']);
 assert.deepEqual(plain(words.refusalSentences(ar, lessonAll, 'lesson')), ['بدأ الطلاب في واجبه، لذا يبقى.', 'بدأ الطلاب هذا الدرس، لذا يبقى.', 'في هذا الدرس واجبان وجزء واحد وعنصر محتوى واحد وصورة غلاف.', 'ما زال هناك ما يستخدم هذا الدرس.', 'يمكنك إعادة تسميته أو نقله.']);
 assert.equal(words.refusalSentences(en, refusal(['parts'], { parts: 3 }), 'chapter')[0], 'Lessons in this chapter have 3 parts.');
 assert.equal(words.refusalSentences(ar, refusal(['parts'], { parts: 3 }), 'chapter')[0], 'في دروس هذا الفصل 3 أجزاء.');
 assert.equal(words.refusalSentences(en, refusal(['student_work']), 'chapter')[0], 'Students have started homework in this chapter, so it stays.');
 // A reason with no count still reads as a sentence, and an unknown reason is not silence.
 assert.equal(words.refusalSentences(en, refusal(['homework']), 'lesson')[0], 'This lesson has homework.');
 assert.equal(words.refusalSentences(en, refusal(['content']), 'lesson')[0], 'This lesson has content.');
 assert.deepEqual(plain(words.refusalSentences(en, refusal(['something_new']), 'lesson')), ['Something else still uses this lesson.', 'You can rename or move it.']);
});
test('counts: the four forms; the join reads naturally in both languages', () => {
 assert.deepEqual([1, 2, 3, 10, 11, 100].map(words.countForm), ['one', 'two', 'few', 'few', 'many', 'many']);
 assert.deepEqual([1, 2, 3, 11].map(n => words.countWord(ar, 'lesson', n)), ['درس واحد', 'درسان', '3 دروس', '11 درسًا']);
 assert.deepEqual([1, 2, 3, 11].map(n => words.countWord(ar, 'chapter', n)), ['فصل واحد', 'فصلان', '3 فصول', '11 فصلًا']);
 assert.deepEqual([1, 2, 3, 11].map(n => words.countWord(ar, 'cover', n)), ['صورة غلاف', 'صورتا غلاف', '3 صور غلاف', '11 صورة غلاف']);
 assert.deepEqual([1, 2, 3, 11].map(n => words.countWord(en, 'homework', n)), ['1 homework', '2 homework', '3 homework', '11 homework']);
 assert.equal(words.joinWords(en, ['A', 'B', 'C']), 'A, B and C'); assert.equal(words.joinWords(en, ['A', 'B']), 'A and B'); assert.equal(words.joinWords(en, ['A']), 'A');
 assert.equal(words.joinWords(ar, ['أ', 'ب', 'ج']), 'أ وب وج');
});
test('contract: accepts exactly what the screen sends; refuses extras, empty names, control characters, too many rows and a version that is not a timestamp', () => {
 const ok = value => contentEdit.safeParse(value).success;
 const tree = shared.buildTree(structure());
 for (const edit of [shared.reorderChaptersEdit(tree, 0, 1), shared.reorderLessonsEdit(tree[0], 0, 1), shared.moveLessonEdit(tree[0].lessons[0], tree[1]), shared.deleteChapterEdit(tree[0]), { action: 'delete_lesson', id: uuid(1), updatedAt: stamp(1) }, { action: 'create_chapter', title: ' A ' }, { action: 'create_lesson', parentId: uuid(1), title: 'B' }, { action: 'rename_chapter', id: uuid(1), updatedAt: stamp(1), title: 'C' }, { action: 'rename_lesson', id: uuid(1), updatedAt: stamp(1), title: 'D' }]) assert.ok(ok(plain(edit)), edit.action);
 assert.equal(contentEdit.parse({ action: 'create_chapter', title: ' A ' }).title, 'A', 'names are trimmed');
 assert.equal(contentEdit.parse({ action: 'rename_lesson', id: uuid(1), updatedAt: stamp(1), title: 'D' }).updatedAt, stamp(1), 'the version keeps its microseconds');
 assert.ok(ok({ action: 'create_chapter', title: 'x'.repeat(120) })); assert.ok(!ok({ action: 'create_chapter', title: 'x'.repeat(121) }));
 assert.ok(ok({ action: 'create_lesson', parentId: uuid(1), title: 'x'.repeat(200) })); assert.ok(!ok({ action: 'create_lesson', parentId: uuid(1), title: 'x'.repeat(201) }));
 assert.ok(ok({ action: 'create_chapter', title: 'فيزياء الصف التاسع' }));
 for (const bad of [
  { action: 'create_chapter', title: '   ' }, { action: 'create_chapter', title: 'a\nb' }, { action: 'create_chapter', title: 'A', extra: 1 }, { action: 'drop_course' }, {},
  { action: 'rename_lesson', id: uuid(1), title: 'no version' }, { action: 'rename_lesson', id: uuid(1), updatedAt: 'yesterday', title: 'x' }, { action: 'rename_lesson', id: 'not-a-uuid', updatedAt: stamp(1), title: 'x' },
  { action: 'delete_chapter', id: uuid(1), updatedAt: stamp(1) }, { action: 'move_lesson', id: uuid(1), updatedAt: stamp(1), items: [] }, { action: 'reorder_lessons', items: [] },
  { action: 'reorder_modules', items: [{ id: uuid(1), updated_at: stamp(1), position: 4 }] }, { action: 'reorder_modules', items: Array.from({ length: 502 }, () => item(1)) },
  { action: 'delete_lesson', id: uuid(1), updatedAt: stamp(1), course_id: uuid(2) },
 ]) assert.ok(!ok(bad), JSON.stringify(bad).slice(0, 80));
});
test('server: the route is a one-line adapter, signed in, same origin, capped, re-checks editing, uses the signed-in client, and no service role', () => {
 assert.equal(read('app/api/teacher/courses/[courseId]/content/route.ts').trim(), "export { timedCourseContentGET as GET, timedCourseContentPOST as POST } from '@/server/http/timed';");
 const http = read('server/http/course-content.ts'), service = read('server/services/course-content.ts');
 assert.match(http, /validFirebaseOrigin\(request\)/); assert.match(http, /isFirebaseStaging\(\)/); assert.match(http, /viewer\.backend !== 'firebase'/); assert.match(http, /contentEdit\.safeParse\(body\)/); assert.match(http, /size > LIMIT/); assert.match(http, /'private, no-store'/);
 assert.match(service, /editableTeacherCourse\(userId, courseId\)/); assert.match(service, /getSupabaseServerClient\(\)/); assert.match(service, /rpc\('course_structure'/); assert.match(service, /rpc\('edit_course_structure'/); assert.match(service, /rpc\('edit_learning_content'/);
 assert.doesNotMatch(http + service, /service[_-]?role|supabaseAdmin|\.from\(/i, 'only the two functions, under the teacher\'s own identity');
});
test('middleware: the content endpoint passes, nothing next to it does', () => {
 const m = read('middleware.ts').match(/if \(\/\^\\\/api\\\/teacher\\\/\(website[^\n]*\.test\(path\)\)/)[0];
 const pattern = new RegExp(m.slice(m.indexOf('/^') + 1, m.lastIndexOf('/.test')));
 const id = uuid(1);
 for (const good of [`/api/teacher/courses/${id}`, `/api/teacher/courses/${id}/content`, '/api/teacher/courses']) assert.ok(pattern.test(good), good);
 for (const bad of [`/api/teacher/courses/${id}/chapters`, `/api/teacher/courses/${id}/content/x`, `/api/teacher/courses/${id}/content/`, '/api/teacher/courses/content', '/api/teacher/courses/not-a-uuid/content']) assert.ok(!pattern.test(bad), bad);
});
test('screen: writes only through the content route, sends no position of its own, keeps no legacy route, and nothing is decided by a role here', () => {
 const v = read('frontend/features/teacher-course/content-section.tsx');
 assert.deepEqual([...new Set([...v.matchAll(/['"`](\/api\/[^'"`?]*)/g)].map(m => m[1]))], ['/api/teacher/courses/${courseId}/content']);
 assert.doesNotMatch(v, /\/chapters|isTeacher|role ===|viewer\.role/);
 assert.match(v, /setStructure\(before\)/, 'a failure puts the earlier copy back');
 assert.match(read('frontend/features/teacher-course/course-view.tsx'), /<CourseContent courseId=\{course\.id\} \/>/);
});
test('drag: nothing moves on screen, so reduced motion and right-to-left need no special case', () => {
 const drag = read('frontend/features/teacher-course/use-row-drag.ts');
 assert.doesNotMatch(drag, /transform|transition|animate/); assert.match(drag, /setPointerCapture/); assert.match(drag, /'Escape'/);
 const rules = read('frontend/styles/design-components.css').split('\n').filter(l => /d-content|data-drag-row/.test(l)).join('\n');
 assert.doesNotMatch(rules, /transition|animation|\bleft:|\bright:|margin-left|margin-right|padding-left|padding-right/, 'logical properties, no motion');
});
test('locales: every tc.content text in both languages, same holes, Arabic, no tenant vocabulary and no word the owner ruled out', () => {
 const keys = Object.keys(messages.en).filter(k => k.startsWith('tc.content.')); assert.ok(keys.length >= 80, String(keys.length));
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k]?.trim(), k);
  const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join(); assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
  assert.match(messages.ar[k], /[؀-ۿ]/, k);
  assert.doesNotMatch(messages.en[k] + messages.ar[k], /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|\boffering|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i, k);
 }
 assert.equal(messages.en['tc.content.changed'], 'This changed somewhere else.');
 assert.match(messages.en['tc.content.note'], /Videos and files inside a lesson come with the lesson editor/);
 assert.equal(messages.en['tc.lessons_soon'], undefined, 'the old note is gone');
});
