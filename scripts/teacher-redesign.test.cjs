const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript');
function load(file, deps = {}) {
	const m = { exports: {} };
	vm.runInNewContext(
		ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText,
		{ module: m, exports: m.exports, Date, Set, Array, String, Number, require: (n) => (n in deps ? deps[n] : require(n)) }
	);
	return m.exports;
}
const slug = load('frontend/lib/slug.ts');
const SERVER = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test('slug: English titles become readable server-valid slugs', () => {
	assert.equal(slug.slugFromTitle('Electric Current & Resistance!'), 'electric-current-resistance');
	assert.equal(slug.slugFromTitle('  Café -- Ångström  '), 'cafe-angstrom');
	assert.ok(SERVER.test(slug.slugFromTitle('Grade 10: Forces (Part 2)')));
});

test('slug: Arabic-only and mixed titles never produce an empty or invalid slug', () => {
	const arabic = slug.slugFromTitle('قوانين نيوتن');
	assert.ok(arabic.length > 0 && SERVER.test(arabic), arabic);
	assert.equal(slug.slugFromTitle('الفصل ١٢'), slug.slugBase('الفصل ١٢'));
	assert.match(slug.slugFromTitle('الفصل ١٢'), /12$/);
	assert.ok(SERVER.test(slug.slugFromTitle('فيزياء Physics 2026')));
});

test('slug: emoji-only or empty titles use the fallback', () => {
	assert.equal(slug.slugFromTitle('🔥🔥'), 'course');
	assert.equal(slug.slugFromTitle('   ', [], 'lesson'), 'lesson');
});

test('slug: duplicates get -2, -3 and the check is case-insensitive', () => {
	assert.equal(slug.slugFromTitle('Forces', ['forces']), 'forces-2');
	assert.equal(slug.slugFromTitle('Forces', ['forces', 'FORCES-2']), 'forces-3');
	assert.equal(slug.nextSlugCandidate('forces'), 'forces-2');
	assert.equal(slug.nextSlugCandidate('forces-2'), 'forces-3');
});

test('slug: very long titles stay within the server limit, even after a suffix', () => {
	const long = 'a'.repeat(300);
	const base = slug.slugFromTitle(long);
	assert.ok(base.length <= 80 && slug.isValidSlug(base));
	assert.ok(slug.isValidSlug(slug.nextSlugCandidate('a'.repeat(100))));
});

const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const TEACHER_KEYS = [
	'teach.segment.pill',
	'teach.segment.draft_notice',
	'teach.segment.completion_line',
	'teach.segment.customize',
	'teach.segment.title_field',
	'teach.segment.description_field',
	'teach.segment.content',
	'teach.segment.content_type',
	'teach.segment.type_video',
	'teach.segment.type_homework',
	'teach.segment.delete',
	'teach.segment.delete_confirm',
	'teach.video.field',
	'teach.video.solution_link',
	'teach.video.add_solution',
	'teach.video.edit_solution',
	'teach.resources.field',
	'teach.resources.add',
	'teach.homework.format',
	'teach.homework.file_upload',
	'teach.homework.platform_questions',
	'teach.homework.builder_title',
	'teach.homework.builder_sub',
	'teach.homework.portal_title',
	'teach.homework.portal_sub',
	'teach.lesson.delete',
	'teach.lesson.delete_confirm',
	'teach.lesson.completion_line',
	'teach.chapter.update_warning',
];

test('teacher redesign: English and Arabic parity for all new teach keys', () => {
	const en = read('frontend/locales/en.ts');
	const ar = read('frontend/locales/ar.ts');
	for (const key of TEACHER_KEYS) {
		assert.match(en, new RegExp(`"${key.replace('.', '\\.')}":\\s*"[^"]+"`), `en.ts missing ${key}`);
		assert.match(ar, new RegExp(`"${key.replace('.', '\\.')}":\\s*"[^"]+"`), `ar.ts missing ${key}`);
	}
});

test('teacher redesign: unpublished banners use WCAG AAA compliant contrast', () => {
	const segmentEditor = read('frontend/features/teacher/chapters/segment-editor.tsx');
	const lessonEditor = read('frontend/features/teacher/chapters/lesson-editor.tsx');
	// Must not use green text on yellow background
	assert.doesNotMatch(segmentEditor, /bg-amber-100.*text-emerald/);
	assert.doesNotMatch(lessonEditor, /bg-amber-100.*text-emerald/);
	// Must use high contrast amber-950 on amber-100 or amber-200
	assert.match(segmentEditor, /border-amber-600 bg-amber-100.*text-amber-950/);
});

test('teacher redesign: destructive lesson and segment actions use DeleteButton with confirmation', () => {
	const segmentEditor = read('frontend/features/teacher/chapters/segment-editor.tsx');
	const lessonEditor = read('frontend/features/teacher/chapters/lesson-editor.tsx');
	const teacherUi = read('frontend/features/teacher/ui/teacher-ui.tsx');
	// DeleteButton component exists and uses AlertDialog
	assert.match(teacherUi, /export const DeleteButton/);
	assert.match(teacherUi, /AlertDialogCancel/);
	assert.match(teacherUi, /AlertDialogAction/);
	// Both editors use DeleteButton
	assert.match(segmentEditor, /<DeleteButton[\s\S]*?label=\{t\('teach\.segment\.delete'\)\}/);
	assert.match(lessonEditor, /<DeleteButton[\s\S]*?label=\{t\('teach\.lesson\.delete'\)\}/);
});

test('teacher redesign: chapter details dialog shows affected lessons count', () => {
	const dialog = read('frontend/features/teacher/chapters/chapter-details-dialog.tsx');
	assert.match(dialog, /t\('teach\.chapter\.update_warning'/);
	assert.match(dialog, /lessonCount/);
});
