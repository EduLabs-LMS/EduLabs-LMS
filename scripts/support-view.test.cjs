// Support redesign is display-only: who is waiting on whom, who can be named, and unsent drafts stay on this device.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Array, Date, Error });
  return module.exports;
}
const view = load('shared/support-view.ts');
const due = '2026-10-23T10:00:00Z';

test('wait state follows the real data: a requester message sets a reply-due time, a staff reply clears it', () => {
  assert.equal(view.waitState({ status: 'OPEN', response_due_at: due }, true), 'needs_reply');
  assert.equal(view.waitState({ status: 'OPEN', response_due_at: due }, false), 'waiting');
  assert.equal(view.waitState({ status: 'IN_PROGRESS', response_due_at: null }, true), 'replied');
  assert.equal(view.waitState({ status: 'IN_PROGRESS', response_due_at: null }, false), 'replied');
  assert.equal(view.waitState({ status: 'RESOLVED', response_due_at: null }, true), 'resolved');
  assert.equal(view.waitState({ status: 'RESOLVED', response_due_at: due }, false), 'resolved');
});

test('the subtitle fits the person: tickets sent to them, their own, or both', () => {
  assert.equal(view.subtitleKind([]), 'requester');
  assert.equal(view.subtitleKind([{ staff: false }]), 'requester');
  assert.equal(view.subtitleKind([{ staff: true }, { staff: true }]), 'staff');
  assert.equal(view.subtitleKind([{ staff: true }, { staff: false }]), 'both');
});

test('the requester name comes from their earliest own message and is absent when it is not on the page', () => {
  assert.equal(view.requesterName([{ staff: true, sender_name: 'Support', created_at: '2026-10-21T10:00:00Z' }, { staff: false, sender_name: 'Mona', created_at: '2026-10-15T10:00:00Z' }, { staff: false, sender_name: 'Mona K', created_at: '2026-10-16T10:00:00Z' }]), 'Mona');
  assert.equal(view.requesterName([{ staff: true, sender_name: 'Support', created_at: '2026-10-21T10:00:00Z' }]), null);
});

test('drafts are saved per user and ticket, removed when empty, and never throw when storage is blocked', () => {
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const a = view.draftKey('u1', 'reply:t1'), b = view.draftKey('u2', 'reply:t1');
  assert.notEqual(a, b);
  view.writeDraft(storage, a, 'half a reply');
  assert.equal(view.readDraft(storage, a), 'half a reply');
  assert.equal(view.readDraft(storage, b), '');
  view.writeDraft(storage, a, '   ');
  assert.equal(data.has(a), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => { view.writeDraft(blocked, a, 'x'); view.writeDraft(blocked, a, ''); assert.equal(view.readDraft(blocked, a), ''); });
  assert.equal(view.readDraft(null, a), '');
});

test('the rebuilt support screen keeps its safeguards and mirrors for RTL', () => {
  const source = fs.readFileSync('frontend/features/support/supabase-support-view.tsx', 'utf8');
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /\{m\.body\}/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /role="log"/);
  assert.match(source, /e\.key === 'Enter' && !e\.shiftKey && !e\.nativeEvent\.isComposing/);
  assert.match(source, /rtl:rotate-180/);
  // A failed send must keep the text: the draft is cleared only after the request succeeded.
  assert.ok(source.indexOf("await communicate<{ id: string }>('support', action") < source.indexOf('sent?.clear()'));
  assert.doesNotMatch(source, /paperclip|attach/i);
  // Only the signed-in user's own photo is ever shown.
  assert.match(source, /url=\{m\.mine \? user\?\.imageUrl : null\}/);
});
