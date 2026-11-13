// Draft migration 20261106130000: its shape, statically. The behaviour is in supabase/tests/course-content-tree.sql and scripts/course-content-concurrency.cjs,
// which need a local PostgreSQL (npm run test:exam-sql:postgres).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const NAME = '20261106130000_course_content_tree.sql';
const sql = read('supabase/migrations/' + NAME), code = sql.replace(/--.*$/gm, '');
const names = () => fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();

test('the file: LF only, pinned as text, and only the homework rules and lesson publish migrations come after it', () => {
 assert.ok(!sql.includes('\r'), 'the staging manager hashes the Git blob');
 assert.match(read('.gitattributes'), /20261106130000_course_content_tree\.sql -text/);
 assert.deepEqual(names().slice(names().indexOf(NAME) + 1), ['20261109120000_homework_teacher_rules.sql', '20261110120000_lesson_publish.sql', '20261112120000_homework_move.sql', '20261113120000_homework_correct_demo.sql', '20261114120000_exams.sql']);
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
 for (const fn of ['lesson_delete_blockers\\(uuid\\)', 'lesson_delete_counts\\(uuid\\[\\]\\)', 'keep_lesson_in_course\\(\\)', 'pin_chapter_label\\(\\)', 'close_chapter_gaps\\(uuid\\)', 'close_chapter_gaps_after_delete\\(\\)', 'refuse_archived_structure\\(\\)']) assert.match(code, new RegExp('revoke all on function private\\.' + fn + ' from public,anon,authenticated,service_role;'), fn + ' is internal');
 const body = /create function private\.edit_course_structure[\s\S]*?end \$\$;/.exec(code)[0];
 assert.match(body, /private\.current_app_user_id\(\) is null or p_course_id is null or not private\.can_edit_course\(p_course_id\)/, 'the same authorization as editing the course, before anything else');
 assert.match(body, /from public\.courses c where c\.id=p_course_id for update/, 'the same course-root lock as edit_learning_content');
 assert.ok(body.indexOf("state='archived'") > body.indexOf('for update') && body.indexOf("state='archived'") < body.indexOf('p_data is null'), 'archived is read under the lock, before the input');
 assert.ok(body.indexOf('can_edit_course') < body.indexOf('for update'), 'a person with no rights never holds the lock');
 assert.match(body, /is distinct from p_updated_at then raise exception 'Content changed\. Reload\.' using errcode='PT409'/, 'a stale request is PT409');
});

test('what it does not touch', () => {
 assert.doesNotMatch(code, /function (private|public)\.edit_learning_content/, 'the existing editing operation is unchanged');
 assert.doesNotMatch(code, /function private\.demo_clear_core/, 'Clear is unchanged');
 assert.doesNotMatch(code, /create table|create policy|drop policy|^\s*grant [a-z, ]+ on public\./im, 'no new table or policy, and no client grant added');
 assert.deepEqual([...new Set(code.match(/alter table [a-z_.]+/g))], ['alter table public.course_modules'], 'only the chapter table is altered');
 assert.deepEqual(code.match(/drop [a-z]+ [^;]+;/gi), ['drop trigger prevent_reparenting on public.lessons;', 'drop constraint course_modules_chapter_number_check,drop constraint course_modules_group_type_check;'], 'the old label checks, which the new ones replace, and the trigger it recreates');
 assert.match(code, /create trigger prevent_reparenting before update on public\.lessons for each row execute function private\.reject_reparenting\('id'\);/, 'the lesson id still never changes');
 assert.doesNotMatch(code, /on conflict/i, 'a refused change is refused, never turned into another one');
});

test('the label: a trigger on every write, the table agrees, and the gap closes on delete', () => {
 assert.match(code, /create trigger pin_chapter_label before insert or update on public\.course_modules for each row/);
 assert.match(code, /new\.group_type:='Chapter';\s+new\.chapter_number:=new\.position\+1;/);
 assert.match(code, /check \(chapter_number=position\+1\)/); assert.match(code, /check \(group_type='Chapter'\)/); assert.match(code, /alter column chapter_number set not null/);
 assert.match(code, /create trigger close_chapter_gaps after delete on public\.course_modules referencing old table as gone for each statement/);
 assert.ok(code.indexOf('private.close_chapter_gaps(c); end loop; end $$;\nupdate public.course_modules set chapter_number=position+1') > 0, 'existing rows are rewritten once');
 assert.ok(code.indexOf('update public.course_modules set chapter_number=position+1') < code.indexOf('create trigger refuse_archived_structure'), 'the rewrite runs before archived courses start refusing');
 assert.deepEqual(code.match(/^revoke [a-z(), ]+ on public\.[a-z_]+ from authenticated;$/gm), ['revoke insert,delete on public.course_modules from authenticated;', 'revoke update(position) on public.course_modules from authenticated;', 'revoke delete on public.lessons from authenticated;'], 'a gap cannot be made and a refused delete cannot be walked around from outside');
});

test('an archived course: refused at the tables, for both', () => {
 for (const table of ['course_modules', 'lessons']) assert.match(code, new RegExp('create trigger refuse_archived_structure before insert or update or delete on public\\.' + table + ' for each row'), table);
 const fn = /create function private\.refuse_archived_structure[\s\S]*?end \$\$;/.exec(code)[0];
 assert.match(fn, /for share/, 'waits for an archive in another transaction');
 assert.doesNotMatch(fn, /current_app_user_id/, 'no caller is exempt');
 assert.match(code, /'archived',state='archived','canEdit',can_edit and state<>'archived'/, 'the read tells the screen');
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
