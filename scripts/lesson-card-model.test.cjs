const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'shared', 'lesson-card-model.ts');
const source = fs.readFileSync(filename, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(transpiled, {
  exports: moduleRef.exports,
  module: moduleRef,
  Map, Error,
}, { filename });
const { lessonNumbersByModule, lessonCardStatus, moduleDisplayLabel } = moduleRef.exports;

test('lesson indices restart within each real module ID', () => {
  const numbered = lessonNumbersByModule([
    { id: 'l-1', module_id: 'a' },
    { id: 'l-2', module_id: 'a' },
    { id: 'l-3', module_id: 'b' },
    { id: 'l-4', module_id: 'a' },
    { id: 'l-5', module_id: 'b' },
  ]);
  assert.equal(numbered.get('l-1'), 1);
  assert.equal(numbered.get('l-2'), 2);
  assert.equal(numbered.get('l-3'), 1);
  assert.equal(numbered.get('l-4'), 3);
  assert.equal(numbered.get('l-5'), 2);
});

test('duplicate IDs and missing module IDs are rejected', () => {
  assert.throws(() => lessonNumbersByModule([
    { id: 'l-1', module_id: 'a' }, { id: 'l-1', module_id: 'b' },
  ]), /Duplicate/);
  assert.throws(() => lessonNumbersByModule([{ id: 'x', module_id: '' }]), /required/);
});

test('progress is never inferred without a selected offering', () => {
  assert.equal(lessonCardStatus({ published: true, offeringSelected: false, progressStatus: 'completed' }), 'Published');
  assert.equal(lessonCardStatus({ published: true, offeringSelected: true, progressStatus: 'completed' }), 'Completed');
  assert.equal(lessonCardStatus({ published: true, offeringSelected: true, progressStatus: 'in_progress' }), 'In Progress');
  assert.equal(lessonCardStatus({ published: true, offeringSelected: true, progressStatus: null }), 'Not Started');
  assert.equal(lessonCardStatus({ published: true, offeringSelected: true, progressStatus: 'unrecognized' }), 'Published');
  assert.equal(lessonCardStatus({ published: false, offeringSelected: true, progressStatus: 'completed' }), 'Locked');
});

test('module titles remain course-scoped rather than global chapter keys', () => {
  assert.equal(moduleDisplayLabel('  Electricity  ', 2), 'Electricity');
  assert.equal(moduleDisplayLabel('', 2), 'Module 3');
});
