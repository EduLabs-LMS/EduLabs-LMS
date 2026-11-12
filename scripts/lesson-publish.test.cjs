// Draft migration 20261110120000 (a lesson is never tethered to one of its components): its shape, statically, and the student models on a published lesson
// with no parts. The behaviour is in supabase/tests/lesson-publish.sql and scripts/lesson-publish-concurrency.cjs (npm run test:exam-sql:postgres).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs');
const { load } = require('./localization-test-loader.cjs');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const NAME = '20261110120000_lesson_publish.sql';
const sql = fs.readFileSync('supabase/migrations/' + NAME, 'utf8'), code = sql.replace(/--.*$/gm, '');
const body = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('end $$;', i) + 'end $$;'.length); };

test('the file: LF only, pinned as text, followed only by the homework move migration, one transaction, the caller from current_app_user_id', () => {
  assert.ok(!sql.includes('\r'), 'the staging manager hashes the Git blob');
  assert.match(read('.gitattributes'), /20261110120000_lesson_publish\.sql -text/);
  assert.deepEqual(fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort().slice(-3), [NAME, '20261112120000_homework_move.sql', '20261113120000_homework_correct_demo.sql']);
  assert.match(code, /^\s*begin;/); assert.match(code, /commit;\s*$/);
  assert.doesNotMatch(code, /auth\.uid/);
  assert.match(code, /private\.current_app_user_id\(\) is null/);
});

test('the rule is gone from edit_learning_content and everything else in it is kept', () => {
  const before = body(read('supabase/migrations/20261018092002_chapter_metadata.sql'), 'create or replace function private.edit_learning_content(');
  const after = body(sql, 'create or replace function private.edit_learning_content(');
  assert.doesNotMatch(code, /Publish a part first/);
  const removed = before.split('\n').filter(l => !after.split('\n').includes(l));
  assert.deepEqual(removed.map(l => l.trim()), [before.split('\n').find(l => l.includes('Publish a part first')).trim()], 'exactly one line is removed');
  assert.equal(after.split('\n').length, before.split('\n').length - 1, 'and nothing is added');
  assert.match(after, /Add video, notes or a resource first/, 'the part-level rule stays');
});

test('edit_course_structure gains publish_lesson and unpublish_lesson and keeps everything else', () => {
  const before = body(read('supabase/migrations/20261106130000_course_content_tree.sql'), 'create function private.edit_course_structure(');
  const after = body(sql, 'create or replace function private.edit_course_structure(');
  const added = after.split('\n').filter(l => !before.split('\n').includes(l));
  const kept = before.split('\n').filter(l => !after.split('\n').includes(l));
  assert.deepEqual(kept.map(l => l.trim()), ["create function private.edit_course_structure(p_course_id uuid,p_action text,p_id uuid,p_parent_id uuid,p_updated_at timestamptz,p_data jsonb) returns uuid",
    "elsif p_action in ('rename_lesson','delete_lesson','move_lesson') then"], 'only the header and the lesson action list change');
  assert.ok(added.every(l => /publish_lesson|unpublish_lesson|create or replace function private\.edit_course_structure|^\s*--|p_data<>'\{\}'::jsonb|update public\.lessons set status|where id=p_id and status<>|return p_id;|end if;/.test(l)), added.join('\n'));
  assert.match(after, /security definer set search_path=''/);
  assert.match(after, /not private\.can_edit_course\(p_course_id\)/);
  assert.match(after, /from public\.courses c where c\.id=p_course_id for update/);
  assert.match(after, /if state='archived' then raise exception 'Course archived' using errcode='PT409',detail='\{"reasons":\["archived"\]\}'/);
  assert.doesNotMatch(code, /create (or replace )?function public\./, 'the public invoker wrappers and their grants are kept as they are');
  assert.doesNotMatch(code, /\b(grant|revoke) [^;]*function/i, 'no function grant changes');
});

test('the direct status grant is revoked, nothing else', () => {
  assert.match(code, /revoke update\(status\) on public\.lessons from authenticated;/);
  assert.equal((code.match(/\brevoke\b/g) || []).length, 1);
  assert.doesNotMatch(code, /\bgrant\b/);
  const outside = code.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.doesNotMatch(outside, /create policy|drop |create table|alter table|insert into|delete from|update /i, 'outside the two functions only the revoke');
  assert.doesNotMatch(code, /seed_version|demo_/, 'no demo seed change');
});

test('no app code writes a lesson status directly (only definer functions do)', () => {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  for (const d of ['app', 'server', 'frontend', 'shared']) walk(d);
  for (const f of files) assert.doesNotMatch(read(f), /from\(['"]lessons['"]\)\s*\.\s*(update|upsert|insert)/, f);
});

test('student models: a published lesson with no parts shows Locked and links to its lesson page, and nothing throws', () => {
  const model = load('shared/v2-learning-model.ts'), { resumeLearning } = load('shared/continue-learning.ts');
  const scope = { courses: [{ id: 'c', title: 'Physics' }], modules: [{ id: 'm', course_id: 'c', title: 'Chapter', position: 0, group_type: 'Chapter', chapter_number: 1 }],
    lessons: [{ id: 'empty', module_id: 'm', title: 'Homework only', status: 'published', cover_url: null }, { id: 'full', module_id: 'm', title: 'With a part', status: 'published', cover_url: null }],
    offerings: [{ id: 'o', course_id: 'c', name: 'Run' }], progress: [],
    segments: [{ id: 's', lesson_id: 'full', title: 'Part', position: 0, status: 'published' }], segmentProgress: [] };
  const lessons = model.v2Chapters(scope, 'o')[0].lessons;
  const empty = lessons.find(l => l.id === 'empty'), full = lessons.find(l => l.id === 'full');
  assert.equal(empty.status, 'Locked'); assert.equal(empty.href, '/courses/c/lessons/empty?offering=o', 'its lesson page (homework-correct)'); assert.equal(empty.partsCount, 0); assert.equal(empty.chapters.length, 0);
  assert.equal(full.href, '/courses/c/chapters/s?offering=o', 'the lesson beside it is unchanged');
  const student = model.v2StudentLessons(scope).find(l => l.id === 'o:empty');
  assert.equal(student.status, 'Locked'); assert.equal(student.href, '/courses/c/lessons/empty?offering=o');
  const resume = resumeLearning({ limited: false, courses: [{ id: 'c', organization_id: 'org', title: 'Physics', status: 'published' }], offerings: [{ id: 'o', course_id: 'c', name: 'Run', status: 'active' }],
    enrollments: [{ offering_id: 'o', status: 'active', enrolled_at: null, expires_at: null }], modules: scope.modules, lessons: scope.lessons, segments: [], segmentProgress: [], progress: [] }, [{ id: 'org', status: 'active' }], Date.now());
  assert.equal(resume.items.length, 0, 'Continue Learning offers nothing for it');
});
