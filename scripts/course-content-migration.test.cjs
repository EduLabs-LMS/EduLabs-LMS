// Draft migration 20261106130000: its shape, statically. The behaviour is in supabase/tests/course-content-tree.sql and scripts/course-content-concurrency.cjs,
// which need a local PostgreSQL (npm run test:exam-sql:postgres).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const NAME = '20261106130000_course_content_tree.sql';
const sql = read('supabase/migrations/' + NAME), code = sql.replace(/--.*$/gm, '');
const names = () => fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();

test('the file: LF only, pinned as text and the newest migration', () => {
 assert.ok(!sql.includes('\r'), 'the staging manager hashes the Git blob');
 assert.match(read('.gitattributes'), /20261106130000_course_content_tree\.sql -text/);
 assert.equal(names().at(-1), NAME);
 assert.match(code, /^\s*begin;/); assert.match(code, /commit;\s*$/);
});

test('the rules: private SECURITY DEFINER, public invoker wrapper, no auth.uid(), empty search_path', () => {
 assert.doesNotMatch(code, /auth\.uid/);
 for (const fn of ['edit_course_structure', 'course_structure']) {
  assert.match(code, new RegExp('create function private\\.' + fn + '\\([\\s\\S]*?security definer set search_path=\'\''), fn + ' is private and definer');
  assert.match(code, new RegExp('create function public\\.' + fn + '\\([\\s\\S]*?security invoker set search_path=\'\''), fn + ' has an invoker wrapper');
  assert.match(code, new RegExp('revoke all on function public\\.' + fn + '\\([^)]*\\) from public,anon;'));
  assert.match(code, new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to authenticated;'));
 }
 for (const fn of ['lesson_delete_blockers\\(uuid\\)', 'keep_lesson_in_course\\(\\)']) assert.match(code, new RegExp('revoke all on function private\\.' + fn + ' from public,anon,authenticated,service_role;'), fn + ' is internal');
 const body = /create function private\.edit_course_structure[\s\S]*?end \$\$;/.exec(code)[0];
 assert.match(body, /private\.current_app_user_id\(\) is null or p_course_id is null or not private\.can_edit_course\(p_course_id\)/, 'the same authorization as editing the course, before anything else');
 assert.match(body, /from public\.courses c where c\.id=p_course_id for update/, 'the same course-root lock as edit_learning_content');
 assert.ok(body.indexOf('can_edit_course') < body.indexOf('for update'), 'a person with no rights never holds the lock');
 assert.match(body, /is distinct from p_updated_at then raise exception 'Content changed\. Reload\.' using errcode='PT409'/, 'a stale request is PT409');
});

test('what it does not touch', () => {
 assert.doesNotMatch(code, /function (private|public)\.edit_learning_content/, 'the existing editing operation is unchanged');
 assert.doesNotMatch(code, /function private\.demo_clear_core/, 'Clear is unchanged');
 assert.doesNotMatch(code, /alter table|create table|create policy|drop policy|^\s*grant [a-z, ]+ on public\./im, 'no table, policy or table grant changes');
 assert.deepEqual(code.match(/drop [a-z]+ [^;]+;/gi), ['drop trigger prevent_reparenting on public.lessons;'], 'the one drop is the trigger it recreates');
 assert.match(code, /create trigger prevent_reparenting before update on public\.lessons for each row execute function private\.reject_reparenting\('id'\);/, 'the lesson id still never changes');
 assert.doesNotMatch(code, /on conflict/i, 'a refused change is refused, never turned into another one');
});

test('demo seed 4: the board tree, no homework, and Clear needs no change', () => {
 const fill = /create or replace function private\.demo_fill_core[\s\S]*?end \$\$;/.exec(code)[0];
 assert.match(fill, /seed_version=4/); assert.match(code, /'latestSeedVersion',4/);
 for (const title of ['Electric current', 'Magnetism', 'Electromagnetic induction', "Ohm''s law", 'Resistors in series and parallel', "Kirchhoff''s laws", 'Magnetic field of a wire', 'Force on a wire']) assert.ok(fill.includes(title), title);
 assert.doesNotMatch(fill, /homework_assignments|lesson_segments/, 'demo data holds no homework or parts, so Clear is not refused');
 assert.doesNotMatch(fill, /@/, 'no e-mail address in the seed');
});

test('the tests exist and run in the local suite', () => {
 assert.ok(fs.existsSync('supabase/tests/course-content-tree.sql'));
 const harness = read('scripts/exam-sql-local.cjs');
 assert.match(harness, /'course-content-tree'/); assert.match(harness, /course-content-concurrency\.cjs/);
 assert.match(read('supabase/tests/course-content-tree.sql'), /securetoken\.google\.com/, 'every identity is a Firebase identity');
 assert.match(read('scripts/course-content-concurrency.cjs'), /securetoken\.google\.com/);
});
