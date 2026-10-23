const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module, exports: module.exports, Array, Number });
  return module.exports;
}
const f = load('shared/learning-filter.ts');
const lesson = (id, title, done) => ({ id, title, chapters: done.map(isCompleted => ({ id, title, isCompleted })) });
const chapters = [
  { id: 'c1', title: 'Electricity', subtitle: '', type: 'Chapter', number: 1, lessons: [lesson('a', 'Static charge', [true, true]), lesson('b', 'Circuits', [true, false]), lesson('c', 'Ohm law', [false])] },
  { id: 'c2', title: 'Waves', subtitle: '', type: 'Chapter', number: 2, lessons: [lesson('d', 'Sound', [false])] },
];
const ids = list => list.flatMap(c => c.lessons.map(l => l.id)).join('');
test('lesson state follows the parts', () => {
  assert.equal(f.lessonState(chapters[0].lessons[0]), 'Completed');
  assert.equal(f.lessonState(chapters[0].lessons[1]), 'In Progress');
  assert.equal(f.lessonState(chapters[0].lessons[2]), 'Open Lesson');
  assert.equal(f.lessonState({ chapters: [] }), 'Locked');
  assert.equal(f.lessonState({ status: 'Not Started', chapters: [] }), 'Not Started');
});
test('search matches lesson or chapter titles; a chapter match keeps all its lessons; empty chapters disappear', () => {
  assert.equal(ids(f.filterChapters(chapters, '', 'all')), 'abcd');
  assert.equal(ids(f.filterChapters(chapters, 'ohm', 'all')), 'c');
  assert.equal(ids(f.filterChapters(chapters, 'electric', 'all')), 'abc');
  assert.equal(f.filterChapters(chapters, 'zzz', 'all').length, 0);
  assert.equal(f.filterChapters(chapters, 'sound', 'all').length, 1);
});
test('progress filters pick completed, in progress and not started lessons', () => {
  assert.equal(ids(f.filterChapters(chapters, '', 'done')), 'a');
  assert.equal(ids(f.filterChapters(chapters, '', 'progress')), 'b');
  assert.equal(ids(f.filterChapters(chapters, '', 'new')), 'cd');
  assert.equal(ids(f.filterChapters(chapters, 'ohm', 'done')), '');
});
test('chapter progress is the share of finished lessons', () => {
  assert.equal(f.chapterProgress(chapters[0]), 1 / 3);
  assert.equal(f.chapterProgress({ lessons: [] }), 0);
});
