// Draft migration 20261106120000: the listing sections of private.group_view and the offerings/metrics actions of private.student_administration
// are decided over the caller's own candidates, and every other line of both functions is copied byte for byte.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const NAME = '20261106120000_listing_performance.sql';
const newSql = read('supabase/migrations/' + NAME);
const prevGroup = read('supabase/migrations/20261105120000_group_summary_performance.sql');
const prevAdmin = read('supabase/migrations/20261016053117_student_administration_workflows.sql');
const fn = (sql, signature, end) => { const start = sql.indexOf(signature); assert.ok(start >= 0, signature); return sql.slice(start, sql.indexOf(end, start) + end.length); };
const groupBefore = fn(prevGroup, 'create or replace function private.group_view(', 'end$$;'), groupAfter = fn(newSql, 'create or replace function private.group_view(', 'end$$;');
const adminBefore = fn(prevAdmin, 'create function private.student_administration(', 'end$$;'), adminAfter = fn(newSql, 'create or replace function private.student_administration(', 'end$$;');
const between = (s, a, b) => { const i = s.indexOf(a), j = b ? s.indexOf(b, i) : s.length; assert.ok(i >= 0 && j >= i, a); return s.slice(i, j); };
const code = s => s.replace(/--.*$/gm, '');

test('migration: LF only, pinned as text, followed only by the course-content and homework rules migrations, one transaction, nothing but the two functions', () => {
 assert.ok(!newSql.includes('\r')); assert.match(read('.gitattributes'), /20261106120000_listing_performance\.sql -text/);
 const names = fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
 assert.deepEqual(names.slice(names.indexOf(NAME) + 1), ['20261106130000_course_content_tree.sql', '20261109120000_homework_teacher_rules.sql'], 'only the course-content and homework rules migrations come after it');
 assert.match(newSql, /\nbegin;\n/); assert.match(newSql, /\ncommit;\n$/);
 assert.equal((newSql.match(/create or replace function/g) ?? []).length, 2, 'exactly two functions are replaced');
 assert.doesNotMatch(code(newSql), /\b(grant\s+(execute|select|all|usage)|revoke\s+(execute|select|all|usage)|alter\s+(table|function)|create\s+(table|index|policy)|drop\s)/i, 'no grants, tables, indexes or policies change (create or replace keeps the privileges)');
 assert.doesNotMatch(code(newSql), /auth\.uid\(\)/, 'the caller is current_app_user_id(), never auth.uid(): a Firebase subject is not a UUID');
 assert.match(newSql, /language plpgsql security definer set search_path=''/g);
});
test('group_view: the summary section, the history list, the single-group sections and the tail are byte for byte the previous ones', () => {
 assert.equal(between(groupAfter, "if p_section='summary' then", "if p_group is null and p_section like 'offering:%' then"), between(groupBefore, "if p_section='summary' then", "if p_group is null and p_section like 'offering:%' then"));
 assert.equal(between(groupAfter, "  if p_section='history' then", "  if p_section='upcoming' then"), between(groupBefore, "  if p_section='history' then", "  if p_section='upcoming' then"));
 assert.equal(between(groupAfter, 'select * into g from public.study_groups where id=p_group;'), between(groupBefore, 'select * into g from public.study_groups where id=p_group;'));
 const head = s => s.slice(0, s.indexOf(" if p_section='summary' then"));
 assert.equal(head(groupAfter), head(groupBefore).replace('offs uuid[];\n', 'offs uuid[]; vis uuid[];\n'), 'the head differs only by the new variable');
});
test('group_view: every changed section asks the authorization function of its candidates once, never of every row of a table', () => {
 const offering = between(groupAfter, "if p_group is null and p_section like 'offering:%' then", ' if p_group is null then'), rest = between(groupAfter, "  if p_section='upcoming' then", 'select * into g from public.study_groups where id=p_group;');
 assert.match(offering, /with vis as materialized \(select listed\.id from public\.study_groups listed where listed\.offering_id=session_uuid and private\.can_view_group\(listed\.id\)\)/);
 assert.match(offering, /if not private\.can_manage_offering\(session_uuid\) then raise exception 'Offering unavailable' using errcode='42501'/, 'the offering check stays');
 assert.equal((offering.match(/can_view_group\(/g) ?? []).length, 1);
 assert.match(rest, /organization_memberships m where m\.user_id=u and m\.status='active'/, 'only groups of the caller\'s own spaces are candidates');
 assert.match(rest, /group_memberships/); assert.match(rest, /ends_at is null/, 'and groups the caller is a CURRENT member of');
 assert.equal((rest.match(/private\.can_view_group\(/g) ?? []).length >= 2, true, 'each candidate is still decided by can_view_group');
 assert.equal((rest.match(/private\.can_manage_offering\(o\.id\)/g) ?? []).length >= 1, true);
 assert.doesNotMatch(rest, /listed\.id\)\s+and listed\.name ilike[^\n]*private\.can_view_group/, 'no per-row call in the filter');
 assert.match(rest, /Open an individual group to view its sessions/, 'the upcoming limit stays');
 assert.match(rest, /private\.materialize_group\(group_row\.id\)/, 'upcoming still materializes the same groups');
});
test('student_administration: only the offerings and metrics actions change, every other line is copied unchanged', () => {
 const lines = s => s.split('\n');
 const a = lines(adminBefore.replace('create function private.student_administration(', 'create or replace function private.student_administration(')), b = lines(adminAfter);
 const tailMarker = " elsif p_action='mine' then";
 assert.equal(between(adminAfter, tailMarker), between(adminBefore, tailMarker), 'everything from "mine" to the end is byte for byte the same');
 const headMarker = " if p_action='offerings' then";
 assert.equal(adminAfter.slice(0, adminAfter.indexOf(headMarker)), adminBefore.slice(0, adminBefore.indexOf(headMarker)).replace('create function private.student_administration(', 'create or replace function private.student_administration('));
 assert.ok(b.length > a.length, 'the new version only adds explanation');
 const changed = between(adminAfter, headMarker, tailMarker);
 assert.match(changed, /with sup as materialized \(select o2\.id from public\.course_offerings o2 join public\.courses c2 on c2\.id=o2\.course_id where c2\.organization_id in \(select m\.organization_id from public\.organization_memberships m where m\.user_id=u and m\.status='active'\) and private\.can_support_offering\(o2\.id\)\)/);
 assert.equal((changed.match(/private\.can_support_offering\(/g) ?? []).length, 2, 'once for the picker, once for the four counts');
 assert.doesNotMatch(changed, /can_support_offering\(o\.id\)/, 'no per-row call over a whole table');
 assert.match(changed, /private\.is_org_member\(org\)/, 'asking for the metrics of another space is still refused');
});
test('SQL: the equivalence test is in the suite, the benchmark runs with --bench or --bench-listing', () => {
 const runner = read('scripts/exam-sql-local.cjs');
 assert.match(runner, /'listing-performance'/); assert.match(runner, /--bench-listing/); assert.match(runner, /listing-performance-benchmark\.sql/);
 const sql = read('supabase/tests/listing-performance.sql'), bench = read('supabase/tests/listing-performance-benchmark.sql');
 assert.match(sql, /rollback;\s*$/); assert.match(bench, /rollback;\s*$/);
 assert.match(sql, /group_view_before/); assert.match(sql, /student_administration_before/);
 assert.match(sql, /'iss','https:\/\/securetoken\.google\.com\//, 'Firebase sign-ins are compared too');
 assert.match(sql, /no Firebase listing call raised an invalid-uuid error/);
 assert.match(sql, /another space''s groups never appear in anybody else''s list/);
 assert.match(sql, /asking for the metrics of a space the caller does not belong to is still refused/);
 assert.doesNotMatch(code(bench), /auth\.uid\(\)/);
 assert.doesNotMatch(sql + bench, /@(?!example\.invalid)[a-z0-9.-]+\.[a-z]{2,}/i, 'synthetic addresses only');
});
