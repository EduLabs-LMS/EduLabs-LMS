const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('shared/exam-browse.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: m, exports: m.exports, Array, Date, Infinity });
const b = m.exports;
const e = (title, state, extra = {}) => ({ title, offeringName: 'Group A', courseTitle: 'Physics', state, opensAt: null, closesAt: null, kind: 'exam', ...extra });
const items = [e('Zeta', 'GRADED'), e('Alpha', 'NOT_OPEN_YET', { opensAt: '2026-11-02T00:00:00Z' }), e('Beta', 'NOT_OPEN_YET', { opensAt: '2026-11-01T00:00:00Z' }), e('Quiz', 'IN_PROGRESS', { kind: 'quiz', closesAt: '2026-10-30T00:00:00Z' }), e('Mid', 'NOT_STARTED', { closesAt: '2026-10-25T00:00:00Z' })];
const names = l => l.map(x => x.title).join(',');
test('states group into open now, upcoming and finished', () => {
  assert.equal(b.examGroup('NOT_STARTED'), 'active'); assert.equal(b.examGroup('IN_PROGRESS'), 'active');
  assert.equal(b.examGroup('NOT_OPEN_YET'), 'upcoming');
  for (const s of ['SUBMITTED', 'GRADED', 'TIME_EXPIRED', 'CLOSED']) assert.equal(b.examGroup(s), 'finished');
});
test('search, group and type filters combine', () => {
  assert.equal(names(b.filterExams(items, '', 'all')), 'Zeta,Alpha,Beta,Quiz,Mid');
  assert.equal(names(b.filterExams(items, 'alp', 'all')), 'Alpha');
  assert.equal(names(b.filterExams(items, 'physics', 'upcoming')), 'Alpha,Beta');
  assert.equal(names(b.filterExams(items, '', 'all', 'quiz')), 'Quiz');
  assert.equal(names(b.filterExams(items, 'zzz', 'all')), '');
});
test('soonest puts open exams first by deadline, then upcoming by opening time, then finished', () => {
  assert.equal(names(b.sortExams(items, 'soonest')), 'Mid,Quiz,Beta,Alpha,Zeta');
  assert.equal(names(b.sortExams(items, 'name')), 'Alpha,Beta,Mid,Quiz,Zeta');
});
