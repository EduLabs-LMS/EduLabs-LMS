const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('shared/roles.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: m, exports: m.exports, Array });
const r = m.exports;
const mem = (role, status = 'active') => [{ role, status }];
test('the highest role wins: Admin, then Teacher, then Assistant, then Student', () => {
  assert.equal(r.viewerRole(mem('admin'), [], []), 'admin');
  assert.equal(r.viewerRole(mem('owner'), [], []), 'teacher');
  assert.equal(r.viewerRole(mem('teacher'), [], []), 'teacher');
  assert.equal(r.viewerRole(mem('assistant'), [], []), 'assistant');
  assert.equal(r.viewerRole(mem('student'), [], []), 'student');
  assert.equal(r.viewerRole([], [], []), 'student');
  assert.equal(r.viewerRole([...mem('assistant'), ...mem('admin')], [], []), 'admin');
  assert.equal(r.viewerRole(mem('assistant'), [{ role: 'instructor' }], []), 'teacher');
});
test('course and group staff roles count, inactive memberships do not', () => {
  assert.equal(r.viewerRole(mem('student'), [{ role: 'owner' }], []), 'teacher');
  assert.equal(r.viewerRole(mem('student'), [{ role: 'assistant' }], []), 'assistant');
  assert.equal(r.viewerRole(mem('student'), [], [{ role: 'teaching_assistant' }]), 'assistant');
  assert.equal(r.viewerRole(mem('student'), [], [{ role: 'instructor' }]), 'teacher');
  assert.equal(r.viewerRole(mem('admin', 'suspended'), [], []), 'student');
  assert.equal(r.viewerRole(mem('owner', 'invited'), [], []), 'student');
});
test('every role has its own chip colour and old login roles map to the same names', () => {
  const classes = Object.values(r.roleChipClass);
  assert.equal(new Set(classes).size, 4);
  assert.match(r.roleChipClass.admin, /red/); assert.match(r.roleChipClass.teacher, /amber/); assert.match(r.roleChipClass.assistant, /violet/); assert.match(r.roleChipClass.student, /green/);
  assert.equal(r.legacyRole('ADMIN'), 'admin'); assert.equal(r.legacyRole('Teacher'), 'teacher'); assert.equal(r.legacyRole('assistant'), 'assistant');
  assert.equal(r.legacyRole('STUDENT'), 'student'); assert.equal(r.legacyRole(null), 'student'); assert.equal(r.legacyRole('anything'), 'student');
});
test('the sidebar badge shows the role name, never STAFF', () => {
  const source = fs.readFileSync('frontend/components/sidebar.tsx', 'utf8');
  assert.match(source, /roleChipClass\[shownRole\]/);
  assert.match(source, /'roles\.'\+shownRole/);
  assert.doesNotMatch(source, /'STAFF'/);
});
