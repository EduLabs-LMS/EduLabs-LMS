const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dir = 'frontend/features/support';
const sources = fs.readdirSync(path.join(root, dir)).filter((f) => /\.tsx?$/.test(f));

const NEW_KEYS = [
	'support.filter_all', 'support.filter_open', 'support.filter_in_progress', 'support.filter_resolved',
	'support.subtitle_staff', 'support.awaiting_reply', 'support.waiting_for_support', 'support.overdue_tag',
	'support.staff_label', 'support.attach_soon', 'support.hint_enter', 'support.hint_attachments_soon',
	'support.reply_placeholder_staff', 'support.reply_placeholder_requester', 'support.loading',
];

test('new Support strings exist in English and Arabic', () => {
	const en = read('frontend/locales/en.ts');
	const ar = read('frontend/locales/ar.ts');
	for (const key of NEW_KEYS) {
		assert.match(en, new RegExp(`"${key}": "[^"]+"`), `en missing ${key}`);
		assert.match(ar, new RegExp(`"${key}": "[^"]+"`), `ar missing ${key}`);
	}
});

test('Support UI uses logical (RTL-safe) spacing, alignment and corners only', () => {
	const physical = /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b|\b(?:left|right)-\d|\brounded-(?:l|r|tl|tr|bl|br)(?:-|\b)|\bborder-(?:l|r)\b/;
	for (const file of sources) {
		const text = read(`${dir}/${file}`);
		assert.doesNotMatch(text, physical, `${file} contains a physical-direction class`);
	}
});

test('half-written replies are saved per ticket in both runtimes', () => {
	assert.match(read(`${dir}/use-reply-draft.ts`), /sessionStorage/);
	assert.match(read(`${dir}/supabase-support-view.tsx`), /useReplyDraft\(detail\?\.ticket\.id/);
	assert.match(read(`${dir}/support-chat.tsx`), /useReplyDraft\(initial\.ticket\.id\)/);
});

test('a status or assignment change never clears the reply; only a finished reply or create does', () => {
	const view = read(`${dir}/supabase-support-view.tsx`);
	assert.match(view, /if\(action==='reply'\)setReply\(''\)/);
	assert.match(view, /if\(action==='create'\)\{setNewText\(''\)/);
	assert.doesNotMatch(view, /setDetail\(null\);setText/);
});

test('permissions in the UI are unchanged: In Progress and assignment stay staff-only', () => {
	const view = read(`${dir}/supabase-support-view.tsx`);
	assert.match(view, /detail\.staff\|\|s!=='IN_PROGRESS'\|\|tk\.status==='IN_PROGRESS'/);
	assert.match(view, /disabled:!detail\.staff&&s==='IN_PROGRESS'/);
	assert.match(view, /detail\.staff&&<label/);
	for (const action of ['create', 'reply', 'status', 'assign']) {
		assert.match(view, new RegExp(`command\\('${action}'`), `missing command ${action}`);
	}
});

test('staff messages show a display label, never the raw role value', () => {
	assert.match(read(`${dir}/supabase-support-view.tsx`), /staffLabel=\{m\.staff\?<L id="support\.staff_label"\/>/);
	assert.match(read(`${dir}/support-chat.tsx`), /staffLabel=\{isAdminSender \? 'Support' : undefined\}/);
	assert.doesNotMatch(read(`${dir}/support-chat.tsx`), />\s*Admin\s*</);
});

test('status colors stay distinct and attention tags exist', () => {
	const badge = read(`${dir}/status-badge.tsx`);
	assert.match(badge, /OPEN: 'bg-amber-200/);
	assert.match(badge, /IN_PROGRESS: 'bg-sky-200/);
	assert.match(badge, /RESOLVED: 'bg-primary/);
	assert.match(read(`${dir}/supabase-support-view.tsx`), /AttentionTag tone="wait"/);
});
