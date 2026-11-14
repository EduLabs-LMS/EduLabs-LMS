// Draft migration 20261109120000 (the owner's homework rules): its shape, statically. The behaviour is in supabase/tests/homework-rules.sql,
// homework-reads.sql, demo-homework.sql and scripts/homework-rules-concurrency.cjs, which need a local PostgreSQL (npm run test:exam-sql:postgres).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');
const NAME = '20261109120000_homework_teacher_rules.sql';
const sql = read('supabase/migrations/' + NAME), code = sql.replace(/--.*$/gm, '');
const names = () => fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
// Every function header, up to the body.
const headers = [...code.matchAll(/create (?:or replace )?function (public|private)\.([a-z_]+)\(([\s\S]*?)\$\$/g)].map(m => ({ schema: m[1], name: m[2], head: m[3] }));

test('the file: LF only, pinned as text, one transaction', () => {
 assert.ok(!sql.includes('\r'), 'the staging manager hashes the Git blob');
 assert.match(read('.gitattributes'), /20261109120000_homework_teacher_rules\.sql -text/);
 assert.match(code, /^\s*begin;/); assert.match(code, /commit;\s*$/);
});

test('the rules: private SECURITY DEFINER, public invoker wrappers, no auth.uid(), empty search_path, the caller from current_app_user_id', () => {
 assert.doesNotMatch(code, /auth\.uid/);
 assert.ok(headers.length >= 25);
 for (const h of headers) {
  assert.match(h.head, /set search_path=''/, h.schema + '.' + h.name + ' has an empty search_path');
  assert.match(h.head, h.schema === 'private' ? /security definer/ : /security invoker/, h.schema + '.' + h.name);
 }
 for (const fn of ['homework_delete_images', 'homework_storage_usage', 'homework_assistants', 'set_homework_assistant', 'homework_portal', 'homework_queue', 'homework_release_many']) {
  assert.ok(headers.some(h => h.schema === 'private' && h.name === fn), fn + ' is private');
  assert.ok(headers.some(h => h.schema === 'public' && h.name === fn), fn + ' has a public wrapper');
  assert.ok(code.includes(`'${fn}(`), fn + ' is in the grant loops');
 }
 assert.match(code, /revoke all on function private\.%s from public,anon'[\s\S]*grant execute on function private\.%s to authenticated'/);
 assert.match(code, /revoke all on function public\.%s from public,anon'[\s\S]*grant execute on function public\.%s to authenticated'/);
 assert.match(code, /revoke all on function private\.homework_is_late\(timestamptz,timestamptz\),private\.homework_week_start\(timestamptz\),private\.homework_course_manager\(uuid\),private\.homework_workflow_guard\(\) from public,anon,authenticated,service_role;/, 'internal helpers are revoked from everyone');
 assert.match(code, /revoke all on function private\.demo_homework_make\([^)]*\),private\.demo_homework_try\([^)]*\) from public,anon,authenticated,service_role;/, 'the seed helpers are revoked from everyone');
 assert.match(code, /'homework_assistant_permissions','homework_carried','homework_solutions_seen'[\s\S]*?enable row level security[\s\S]*?revoke all on private\.%I from public,anon,authenticated,service_role/, 'the new private tables have RLS and no grant');
 assert.doesNotMatch(code, /create policy|grant (select|insert|update|delete|all)[a-z, ]* on (table )?(public|private)\./i, 'no policy and no table grant is added');
});

test('the stable refusals the screens rely on', () => {
 assert.match(code, /raise exception 'Deadline passed' using errcode='PT409',detail='\{"reason":"deadline_passed"\}'/);
 assert.match(code, /raise exception 'No tries left' using errcode='PT409',detail='\{"reason":"no_tries_left"\}'/);
 assert.match(code, /raise exception 'Homework is still open' using errcode='PT409',detail='\{"reason":"still_open"\}'/);
 assert.match(code, /raise exception 'File too large' using errcode='PT413'/);
 for (const c of code.matchAll(/errcode='([A-Z0-9]+)'/g)) assert.ok(['42501', '23514', '23503', 'PT409', 'PT413'].includes(c[1]), 'only the agreed codes: ' + c[1]);
});

test("the owner's answers 1 and 2: reschedule and bulk release", () => {
 assert.match(code, /revoke all on function private\.homework_solutions_rule\(uuid,uuid\) from public,anon,authenticated,service_role;/, 'the solutions rule is internal');
 assert.match(code, /create table private\.homework_solutions_seen \(/, 'who already saw the solutions is stored');
 assert.match(code, /drop function public\.homework_lifecycle\(uuid,text,bigint\);\s*drop function private\.homework_lifecycle\(uuid,text,bigint\);/, 'the lifecycle gains an optional p_data');
 assert.match(code, /grant execute on function public\.homework_lifecycle\(uuid,text,bigint,jsonb\) to authenticated;/);
 assert.match(code, /p_action='reschedule'[\s\S]*?insert into private\.homework_solutions_seen[\s\S]*?update public\.homework_assignments set deadline_at/, 'the record is taken before the deadline moves');
 assert.match(code, /raise exception 'At most 500 grades at once' using errcode='23514'/);
 assert.match(code, /order by s\.id for update;[\s\S]*?order by x\.submission_id for update;/, 'bulk release locks tries and corrections in id order');
 assert.ok((code.match(/homework_solutions_seen x where x\.assignment_id=[^)]*and x\.user_id=/g) || []).length >= 4, 'the record is checked in start, retry, save/submit and upload');
 assert.doesNotMatch(code, /update public\.homework_submissions set missed_deadline/, 'a stored Missed the deadline is never recomputed');
});

test('what it keeps', () => {
 assert.match(code, /add column workflow text not null default 'legacy'/, 'existing homework becomes legacy by the column default, with no back-fill');
 assert.doesNotMatch(code, /update public\.homework_assignments set workflow/, 'no existing row is rewritten');
 assert.doesNotMatch(code, /alter column lesson_id drop not null/, 'every homework stays on a lesson');
 assert.doesNotMatch(code, /drop table|drop column|delete from storage\.objects/i, 'nothing is dropped; SQL never deletes a stored file');
 assert.doesNotMatch(code, /function (private|public)\.(homework_inbox|homework_history|homework_revisions)\(/, 'the inbox and history reads are unchanged');
 assert.doesNotMatch(code, /(function|table|on|into|update) (public|private)\.(assessment|exam)[a-z_]*/i, 'no exam table or function is touched (Clear still refuses a space with exams)');
 assert.match(code, /public\.offering_assessments where offering_id=any\(offerings_\)\) then blockers_ := array_append\(blockers_,'exams'::text\)/);
 assert.match(code, /'latestSeedVersion',5/); assert.match(code, /update private\.demo_spaces set seed_version=5/);
 assert.match(read('shared/contracts/platform-demo.ts'), /latestDemoSeedVersion = 9/);
});
