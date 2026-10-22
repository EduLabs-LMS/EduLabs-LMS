const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dir = 'frontend/features/admin/users';
const view = read(`${dir}/admin-users-view.tsx`);
const directory = read(`${dir}/master-user-directory.tsx`);
const ui = read(`${dir}/users-ui.tsx`);
const en = read('frontend/locales/en.ts');
const ar = read('frontend/locales/ar.ts');

const keysOf = (src) => [...src.matchAll(/^\s*"(users\.[^"]+|counts\.(?:students|submissions)\.[^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => [m[1], m[2]]);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every users.* string exists in English and Arabic with the same placeholders', () => {
	const e = new Map(keysOf(en));
	const a = new Map(keysOf(ar));
	assert.ok(e.size > 100, 'expected the new users.* keys');
	assert.deepEqual([...e.keys()].sort(), [...a.keys()].sort());
	for (const [key, text] of e) {
		assert.ok(text.trim() && a.get(key).trim(), key);
		if (!key.startsWith('counts.')) assert.deepEqual(placeholders(text), placeholders(a.get(key)), key);
	}
});

test('every t(...) key used by the redesign exists', () => {
	const e = new Map(keysOf(en));
	for (const src of [view, directory, ui]) {
		for (const m of src.matchAll(/\bt\(\s*'(users\.[\w.]+)'/g)) assert.ok(e.has(m[1]), `missing ${m[1]}`);
		for (const m of src.matchAll(/'(users\.[\w.]+)'/g)) assert.ok(e.has(m[1]) || /^users\.(groups\.(collapse|expand))$/.test(m[1]), `missing ${m[1]}`);
	}
});

test('destructive actions ask for confirmation (revoke, delete user, deny waitlist, delete group)', () => {
	assert.doesNotMatch(view + directory, /\bconfirm\(/, 'no browser confirm() left');
	assert.match(directory, /setUserToRevoke\(user\)/);
	assert.match(directory, /user\.isApproved \? setUserToRevoke\(user\) : handleToggleApproval\(user\)/);
	assert.match(directory, /setUserToDelete\(user\)/);
	assert.match(view, /setDenyTarget\(\{/);
	assert.match(view, /setGroupToDelete\(\{/);
	assert.ok((view.match(/<ConfirmDialog/g) || []).length >= 2);
	assert.ok((directory.match(/<ConfirmDialog/g) || []).length >= 2);
	assert.match(ui, /variant="destructive"/);
});

test('waitlist card, tab and section share one gate constant and it is on for now', () => {
	assert.match(view, /const WAITLIST_ENABLED = true;/);
	assert.ok((view.match(/WAITLIST_ENABLED/g) || []).length >= 6);
	assert.match(view, /WAITLIST_ENABLED && \(\s*<StatCard/);
	assert.match(view, /WAITLIST_ENABLED && \(activeTab === 'ALL' \|\| activeTab === 'WAITLIST'\)/);
});

test('existing requests and features are untouched', () => {
	for (const call of [
		"api.get('/api/admin/waitlist')", "api.get('/api/admin/groups')", "api.get('/api/admin/users')",
		"api.post('/api/admin/waitlist'", "api.delete('/api/admin/waitlist'", 'api.delete(`/api/admin/groups?groupId=${groupId}`)',
	]) assert.ok(view.includes(call), call);
	for (const call of ["api.patch('/api/admin/users'", 'api.delete(`/api/admin/users?userId=${userToDelete.id}`)', 'isApproved: newStatus', "groupId: selectedGroupId === 'NONE' ? null : selectedGroupId"])
		assert.ok(directory.includes(call), call);
	for (const part of ['<GroupFormModal', '<ReassignModal', '<AddStudentsModal', '<StudentMirrorDrawer', 'getNextUpcomingSession(group.name, group.schedule)', 'openReassignModal(', 'openAddStudentsModal(group)', 'toggleGroupAccordion(group.id)'])
		assert.ok(view.includes(part), part);
	assert.match(directory, /role\.toUpperCase\(\) === 'STUDENT'/);
	assert.match(directory, /openGroupModal\(user\)/);
});

test('role display names are labels only; internal role values are never rewritten', () => {
	assert.match(ui, /case 'ADMIN':\s*return t\('users\.role\.admin'\)/);
	assert.doesNotMatch(directory, /role:\s*['"]/);
});

test('logical (RTL-safe) utilities only in the redesigned files', () => {
	for (const [name, src] of [['view', view], ['directory', directory], ['ui', ui]]) {
		assert.doesNotMatch(src, /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b|(?<![\w-])(?:left|right)-\d|\brounded-(?:l|r|tl|tr|bl|br)-/, name);
	}
	assert.match(view, /rtl:rotate-180/);
});

test('large directories render in pages, not all at once', () => {
	assert.match(directory, /const PAGE_SIZE = 50;/);
	assert.match(directory, /filteredUsers\.slice\(0, visible\)/);
});

test('mobile layout keeps every column and action (cards, not sideways scrolling)', () => {
	assert.match(directory, /md:hidden/);
	assert.doesNotMatch(directory + view, /overflow-x-auto/);
	for (const col of ['users.col.email', 'users.col.status', 'users.col.group', 'users.col.date']) assert.ok((directory.match(new RegExp(col.replace('.', '\\.'), 'g')) || []).length >= 2, col);
});
