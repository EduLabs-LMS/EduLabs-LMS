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
