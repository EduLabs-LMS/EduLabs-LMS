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

test('staff get four tabs, students get overview and their own attendance; teachers have no own attendance history', () => {
  assert.equal(JSON.stringify(meeting.tabsFor(true)), JSON.stringify(['overview', 'members', 'sessions', 'settings']));
  assert.equal(JSON.stringify(meeting.tabsFor(false)), JSON.stringify(['overview', 'attendance']));
  assert.equal(meeting.defaultView('members'), 'members');
  assert.equal(meeting.defaultView('settings'), 'staff');
  assert.equal(meeting.defaultView('attendance'), 'history');
  assert.equal(meeting.defaultView('overview'), null);
  assert.equal(meeting.showOwnHistory(true), false);
  assert.equal(meeting.showOwnHistory(false), true);
  assert.equal(meeting.weeklyLabel({ weekday: 1, time: '19:00', durationMinutes: 90 }, ['Sun', 'Mon']), 'Mon 19:00 · 90 min');
});

test('the redesigned workspace keeps every existing group feature', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  for (const feature of ["request('create'", "mutate('edit'", "'archive'", "'unarchive'", "mutate('one-off'", "operation:'reschedule'", "operation:'restore'", "operation:'cancel'", "mutate('attendance'", "mutate('finalize'", "mutate('reopen'", "mutate('add'", "mutate('remove'", "mutate('transfer'", "mutate('staff'", "'eligible'", "'audit'", "'history'", 'gv.take_attendance', 'gv.mark_page_attended', 'gv.reopen', 'gv.add_weekly', 'gv.move_target', 'gv.my_attendance', 'gv.offering_label', 'gv.more_offerings', 'gv.discard', 'gv.join_class', 'GroupPresentationForm', 'GroupSummaryPanel', 'GroupRosterView phase1 privacySafe', 'groups.start_host']) assert.ok(source.includes(feature), 'missing ' + feature);
});

test('a group opens as its own screen with a back button, not below the list', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /editing&&!selected\?<div className="space-y-4">\{renderForm\(\)\}<\/div>:selected\?renderGroup\(selected\):renderList\(\)/);
  assert.match(source, /gv\.back_to_groups/);
  assert.match(source, /rtl:rotate-180/);
});

test('only people who are students of a group see an attendance history; teachers never do', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /\{showOwnHistory\(isStaff\)&&<div><button/);
  assert.match(source, /\{ownHistory&&showOwnHistory\(isStaff\)&&<section/);
  assert.doesNotMatch(source, /My attendance history/);
});

test('archive, cancel, deactivate, finalize and reopen ask first; restore and unarchive stay one tap', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /ask\('groups\.confirm_archive_title'[^]*?mutate\('archive'\)/);
  assert.match(source, /ask\('groups\.confirm_finalize_title'[^]*?mutate\('finalize'/);
  assert.match(source, /setAskReason\(\{title:'groups\.confirm_cancel_title'[^]*?operation:'cancel'/);
  assert.match(source, /setAskReason\(\{title:'groups\.confirm_remove_title'[^]*?mutate\('remove'/);
  assert.match(source, /setAskReason\(\{title:'gv\.reopen_title',body:'gv\.reopen_body',required:true[^]*?mutate\('reopen'/);
  assert.match(source, /s\.cancelled\?run\(\(\)=>mutate\('session',\{sessionId:s\.id,sessionVersion:s\.version,operation:'restore'/);
  assert.match(source, /:run\(\(\)=>mutate\('unarchive'\)\)/);
  assert.doesNotMatch(source, /onClick=\{\(\)=>run\(\(\)=>mutate\('(archive|finalize|remove)'/);
});

test('several students are added one after another through the existing add command, with progress and a guard against unsaved attendance', () => {
  const source = fs.readFileSync('frontend/features/groups/group-workspace.tsx', 'utf8');
  assert.match(source, /for\(let i=0;i<ids\.length;i\+\+\)\{await mutate\('add',\{userId:ids\[i\]\}\)/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /const locked=busy\|\|loading\|\|Object\.keys\(marks\)\.length>0/);
  assert.match(source, /disabled=\{locked\}[^]*?openTab\(t\)/);
});

test('the Jitsi card creates, copies, opens and clears links, and never claims privacy', () => {
  const form = fs.readFileSync('frontend/features/groups/group-presentation-form.tsx', 'utf8');
  for (const part of ['makeJitsiRoom()', 'groups.create_room', 'groups.copy_link', 'https://meet.jit.si/', 'Clear meeting link', 'Saving a link does not make a meeting private', 'applyMeetingDefaults:true']) assert.ok(form.includes(part), 'missing ' + part);
});
