// Users & Study Groups redesign: waitlist visibility in both states, no feature lost, confirmations before risky actions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Array, Error });
  return module.exports;
}
const view = load('shared/users-view.ts');

test('waitlist is visible only while someone is waiting or past requests are being viewed on purpose', () => {
  assert.equal(view.waitlistVisible(3, false), true);
  assert.equal(view.waitlistVisible(0, false), false);
  assert.equal(view.waitlistVisible(null, false), false);
  assert.equal(view.waitlistVisible(0, true), true);
});

test('with the waitlist off, its tab and stat card are gone and the stats row re-flows to three', () => {
  assert.equal(JSON.stringify(view.visibleTabs(true)), JSON.stringify(['all', 'students', 'waitlist', 'groups']));
  assert.equal(JSON.stringify(view.visibleTabs(false)), JSON.stringify(['all', 'students', 'groups']));
  assert.equal(JSON.stringify(view.visibleStats(true)), JSON.stringify(['total', 'waitlist', 'groups', 'homework']));
  assert.equal(JSON.stringify(view.visibleStats(false)), JSON.stringify(['total', 'groups', 'homework']));
  assert.equal(view.safeTab('waitlist', false), 'all');
  assert.equal(view.safeTab('waitlist', true), 'waitlist');
  assert.equal(view.safeTab('students', false), 'students');
});

test('small display helpers', () => {
  assert.equal(view.initialOf('  mona'), 'M');
  assert.equal(view.initialOf(null), '?');
  assert.equal(view.statusTone('active'), 'good');
  assert.equal(view.statusTone('suspended'), 'warn');
  assert.equal(view.statusTone('cancelled'), 'neutral');
});

test('the rebuilt screen keeps every existing action and asks before the risky ones', () => {
  const source = fs.readFileSync('frontend/features/admin/users/supabase-student-admin.tsx', 'utf8');
  for (const feature of ["administer<{ rows: AdminOffering[] }>('offerings'", "'roster'", "'requests'", "'links'", "'metrics'", "command('approve'", "command('reject'", "command('suspend'", "command('reactivate'", "command('enroll'", "command('revoke-link'", "command('link'", 'Create access link', 'Enroll existing student', 'Revoke link', 'Newer links', 'Older links', 'users.previous_offerings', 'users.more_offerings', 'users.profile_id', 'Assigned assistant view', 'Past access requests', 'crypto.randomUUID()', 'href="/groups"']) assert.ok(source.includes(feature), 'missing ' + feature);
  // Reject, Suspend and Revoke link go through the confirmation; Approve and Reactivate stay one tap.
  assert.match(source, /ask\('users\.confirm_reject_title'[^)]*\(\) => void command\('reject'/);
  assert.match(source, /ask\('users\.confirm_suspend_title'[^)]*\(\) => void command\('suspend'/);
  assert.match(source, /ask\('users\.confirm_revoke_title'[^)]*\(\) => void command\('revoke-link'/);
  assert.doesNotMatch(source, /onClick=\{\(\) => void command\('(reject|suspend|revoke-link)'/);
  // Old role names and the pill badge are gone; the table never clips its actions and has a card layout for phones.
  assert.doesNotMatch(source, /Admin & Teacher Portal|ADMIN/);
  assert.match(source, /hidden overflow-x-auto[^"]*md:block/);
  assert.match(source, /md:hidden/);
  assert.match(source, /rtl:rotate-180/);
});

test('the waitlist section and stat card are rendered only through the visibility helpers', () => {
  const source = fs.readFileSync('frontend/features/admin/users/supabase-student-admin.tsx', 'utf8');
  assert.match(source, /waitlistVisible\(metrics\?\.pendingWaitlistCount \?\? null, forceWaitlist\)/);
  assert.match(source, /showWaitlist = waitlistOn &&/);
  assert.match(source, /\{showWaitlist && <section/);
  assert.match(source, /visibleStats\(waitlistOn\)/);
  assert.match(source, /visibleTabs\(waitlistOn\)/);
});
