// Sessions & Groups redesign: tabs keep every feature, risky actions ask first, Jitsi rooms are valid and random.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Array, Error, Uint8Array, RegExp, URL, crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } },
    require: name => { assert.ok(name in dependencies, 'unexpected import ' + name); return dependencies[name]; } });
  return module.exports;
}
const groups = load('shared/contracts/groups.ts', { zod: require('zod') });
const meeting = load('shared/group-meeting.ts', { '@/shared/contracts/groups': groups });

test('a generated Jitsi room passes the same HTTPS rule the server applies and differs every time', () => {
  const rooms = new Set();
  for (let i = 0; i < 50; i++) {
    const url = meeting.makeJitsiRoom();
    assert.match(url, /^https:\/\/meet\.jit\.si\/EduLabs-[a-z0-9]{14}$/);
    assert.equal(groups.validGroupMeetingUrl(url), true);
    rooms.add(url);
  }
  assert.equal(rooms.size, 50);
  assert.match(meeting.makeJitsiRoom(n => new Uint8Array(n)), /EduLabs-aaaaaaaaaaaaaa$/);
});

test('students only ever get their own history; staff sections are split across the tabs', () => {
  assert.equal(JSON.stringify(meeting.recordViews(false, 'members')), JSON.stringify(['history']));
  assert.equal(JSON.stringify(meeting.recordViews(false, 'overview')), JSON.stringify(['history']));
  assert.equal(JSON.stringify(meeting.recordViews(true, 'members')), JSON.stringify(['members', 'eligible']));
  assert.equal(JSON.stringify(meeting.recordViews(true, 'more')), JSON.stringify(['staff', 'history', 'audit']));
  assert.equal(meeting.defaultView('members'), 'members');
  assert.equal(meeting.defaultView('more'), 'history');
  assert.equal(meeting.defaultView('overview'), null);
  assert.equal(JSON.stringify(meeting.groupTabs), JSON.stringify(['overview', 'members', 'sessions', 'more']));
});

test('the redesigned workspace keeps every existing group feature', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  for (const feature of ["request('create'", "mutate('edit'", "'archive'", "'unarchive'", "mutate('one-off'", "operation:'reschedule'", "operation:'restore'", "operation:'cancel'", "mutate('attendance'", "mutate('finalize'", "mutate('reopen'", "mutate('add'", "mutate('remove'", "mutate('transfer'", "mutate('staff'", "'eligible'", 'Take / review attendance', 'Mark this page attended', 'Reopen for correction', 'Add weekly meeting', 'Transfer destination', 'My attendance history', 'Filter by offering', 'More offering choices', 'Discard unsaved changes', 'Join class', 'GroupPresentationForm', 'GroupSummaryPanel', 'GroupRosterView phase1 privacySafe']) assert.ok(source.includes(feature), 'missing ' + feature);
});

test('archive, cancel session, deactivate member and finalize attendance ask first; restore and unarchive stay one tap', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /ask\('groups\.confirm_archive_title'[^]*?mutate\('archive'\)/);
  assert.match(source, /ask\('groups\.confirm_cancel_title'[^]*?operation:'cancel'/);
  assert.match(source, /ask\('groups\.confirm_remove_title'[^]*?mutate\('remove'/);
  assert.match(source, /ask\('groups\.confirm_finalize_title'[^]*?mutate\('finalize'/);
  assert.doesNotMatch(source, /onClick=\{\(\)=>run\(\(\)=>mutate\('(archive|finalize|remove)'/);
  assert.match(source, /s\.cancelled\?run\(\(\)=>mutate\('session',\{sessionId:s\.id,sessionVersion:s\.version,operation:'restore'/);
});

test('several students are added one after another through the existing add command, with progress and a guard against unsaved attendance', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /for\(let i=0;i<ids\.length;i\+\+\)\{await mutate\('add',\{userId:ids\[i\]\}\)/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /disabled=\{busy\|\|loading\|\|Object\.keys\(marks\)\.length>0\}[^]*?openTab\(t\)/);
});

test('the Jitsi card creates, copies, opens and clears links, and never claims privacy', () => {
  const form = fs.readFileSync('frontend/features/groups/group-presentation-form.tsx', 'utf8');
  for (const part of ['makeJitsiRoom()', 'groups.create_room', 'groups.copy_link', 'https://meet.jit.si/', 'Clear meeting link', 'Saving a link does not make a meeting private', 'applyMeetingDefaults:true']) assert.ok(form.includes(part), 'missing ' + part);
});
