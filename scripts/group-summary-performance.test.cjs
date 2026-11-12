// Draft migration 20261105120000: only the summary section of private.group_view changes, and it no longer calls the per-row authorization function.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const oldSql = read('supabase/migrations/20261018100132_group_presentation_and_session_summary.sql');
const newSql = read('supabase/migrations/20261105120000_group_summary_performance.sql');
const fn = sql => { const start = sql.indexOf('create or replace function private.group_view('); return sql.slice(start, sql.indexOf('end$$;', start) + 6); };
const before = fn(oldSql), after = fn(newSql);
const summary = f => { const a = f.indexOf("if p_section='summary' then"), b = f.indexOf("if p_group is null and p_section like 'offering:%' then"); return [f.slice(0, a), f.slice(a, b), f.slice(b)]; };

test('migration: LF only, pinned as text, not the last migration any more, not applied by anything in the app', () => {
 assert.ok(!newSql.includes('\r')); assert.match(read('.gitattributes'), /20261105120000_group_summary_performance\.sql -text/);
 const names = fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
 assert.equal(names.at(-8), '20261105120000_group_summary_performance.sql', 'only the space-name, listing-performance, course-content, homework rules, lesson publish, homework move and homework correct migrations come after it');
 assert.match(newSql, /^-- Performance of private\.group_view[\s\S]*\nbegin;\n/); assert.match(newSql, /\ncommit;\n$/);
 assert.equal((newSql.match(/create or replace function/g) ?? []).length, 1, 'one function is replaced');
 assert.doesNotMatch(newSql.replace(/--.*$/gm, ''), /\b(grant|revoke|alter|create table|create index|drop)\b/i, 'no grants, tables or indexes change');
});
test('migration: everything outside the summary section is copied unchanged, apart from two declared variables', () => {
 const [h1, s1, t1] = summary(before), [h2, s2, t2] = summary(after);
 assert.equal(t2, t1, 'every section after the summary is byte for byte the same');
 assert.equal(h2, h1.replace('group_row record;\n', 'group_row record; managed uuid[]; offs uuid[];\n'), 'the head differs only by the two new variables');
 assert.notEqual(s2, s1);
 assert.match(s2, /if p_group is not null and not private\.can_view_group\(p_group\) then raise exception 'Group unavailable'/, 'the view check stays');
});
test('migration: the summary decides the managed groups once and never calls the per-row functions over a whole table', () => {
 const [, s1, ] = summary(before), [, s2] = summary(after);
 assert.ok(s1.includes('private.can_manage_group(s.group_id)'), 'the old summary did call it per row');
 assert.equal((s2.match(/private\.can_manage_group\(/g) ?? []).length, 1, 'once, over candidate groups');
 assert.doesNotMatch(s2, /can_manage_group\(s\./); assert.match(s2, /managed:=array\(select g2\.id from public\.study_groups g2/);
 assert.match(s2, /organization_memberships m where m\.user_id=u and m\.status='active'/, 'only groups of the caller\'s own organizations are candidates');
 assert.doesNotMatch(s2.replace(/--.*$/gm, ''), /auth\.uid\(\)/, 'the caller is current_app_user_id(), never auth.uid(): a Firebase subject is not a UUID');
 assert.match(s2, /where a\.user_id=u and not s\.cancelled/); assert.match(s2, /s\.group_id=any\(managed\) and not s\.cancelled/);
 assert.match(s2, /h\.offering_id=any\(offs\) and private\.homework_enrolled\(h\.id\)/, 'homework only in offerings the caller is enrolled in, still decided by the same function');
 assert.match(s2, /e\.user_id=u and e\.status='active'/);
});
test('SQL: the equivalence test is in the suite, the benchmark runs only with --bench', () => {
 const runner = read('scripts/exam-sql-local.cjs');
 assert.match(runner, /'group-summary-performance'/); assert.match(runner, /process\.argv\.includes\('--bench'\)/);
 const test = read('supabase/tests/group-summary-performance.sql'), bench = read('supabase/tests/group-summary-performance-benchmark.sql');
 assert.match(test, /rollback;\s*$/); assert.match(bench, /rollback;\s*$/);
 assert.match(bench, /count\(\*\) from public\.session_attendance\)>=20000/);
 assert.match(bench, /explain \(analyze, costs off, timing off\)/);
});
