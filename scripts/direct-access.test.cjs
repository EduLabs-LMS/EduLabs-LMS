// Fix track 1 (A9-11): the browser role writes nothing directly, so no server or page code may either.
// Every write goes through a database function (a private security-definer function behind a public invoker wrapper).
// This test fails when any file under server/, app/, shared/ or frontend/ calls .from('<table>') and then .insert / .update / .upsert / .delete
// in the same statement. The allow-list below must stay EMPTY: an entry means a write that still bypasses the functions, and needs the owner's
// approval, a reason and a removal date written next to it.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');

// file (relative, forward slashes) -> reason. EMPTY by design.
const allowed = {};

const roots = ['server', 'app', 'shared', 'frontend'];
const skip = new Set(['node_modules', '.next', '.local']);
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
// Blank out comments and the inside of strings and template literals, so a word in a message or a comment never counts as code.
// Table names are read from the original text at the same position.
function blank(source) {
  let out = '', i = 0;
  while (i < source.length) {
    const c = source[i], n = source[i + 1];
    if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out += source[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      out += c; i++;
      while (i < source.length && source[i] !== c) { if (source[i] === '\\') { out += '  '; i += 2; continue; } out += source[i] === '\n' ? '\n' : ' '; i++; }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
const writes = /\.\s*(insert|update|upsert|delete)\s*\(/;
// Returns every `.from('table')` statement that also writes.
function directWrites(source) {
  const code = blank(source), found = [];
  const from = /\.from\s*\(\s*(['"`])/g;
  let m;
  while ((m = from.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/storage\s*$/.test(before)) continue; // storage buckets are not tables
    const close = source.indexOf(m[1], m.index + m[0].length);
    const table = source.slice(m.index + m[0].length, close);
    // The rest of the statement: up to the next ';' at bracket depth 0 (relative to the call), or a closing bracket of the enclosing call.
    let depth = 0, end = code.length;
    for (let k = m.index; k < code.length; k++) {
      const ch = code[k];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth < 0) { end = k; break; } }
      else if (ch === ';' && depth <= 0) { end = k; break; }
    }
    const statement = code.slice(m.index, end);
    const w = writes.exec(statement);
    if (w) found.push({ table, method: w[1], line: source.slice(0, m.index).split('\n').length });
  }
  return found;
}

test('the guard finds a write and ignores comments, strings and reads', () => {
  assert.equal(directWrites("await client.from('courses').update({ title: 'x' }).eq('id', id);").length, 1);
  assert.equal(directWrites("const r = await client\n  .from('enrollments')\n  .insert({ a: 1 })\n  .select('id');").length, 1);
  assert.equal(directWrites("client.from(`profiles`).upsert(row)").length, 1);
  assert.equal(directWrites("client.from('lessons').delete().eq('id', 1)").length, 1);
  assert.equal(directWrites("client.from('courses').select('id,title').eq('id', id).maybeSingle();").length, 0);
  assert.equal(directWrites("// client.from('courses').update({})\nconst a = 1;").length, 0);
  assert.equal(directWrites("const text = \"client.from('courses').update({})\";").length, 0);
  assert.equal(directWrites("client.storage.from('lms-course-media').update(path, file)").length, 0);
  assert.equal(directWrites("await client.rpc('course_update', { p_course_id: id });").length, 0);
});

test('no file under server/, app/, shared/ or frontend/ writes a table directly (the allow-list is empty)', () => {
  assert.deepEqual(Object.keys(allowed), [], 'the allow-list must stay empty');
  const offenders = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const rel = file.split(path.sep).join('/');
      if (rel in allowed) continue;
      for (const w of directWrites(fs.readFileSync(file, 'utf8'))) offenders.push(`${rel}:${w.line} .from('${w.table}').${w.method}(...)`);
    }
  }
  assert.deepEqual(offenders, [], 'Direct table writes must go through a database function:\n' + offenders.join('\n'));
});

test('the legacy secure exam route answers 410 Gone for every method, and neither allow-list lets it through', async () => {
  const route = fs.readFileSync('app/api/secure-exams/[examId]/[action]/route.ts', 'utf8');
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) assert.match(route, new RegExp('retiredRoute as ' + method + '\\b'), method);
  assert.match(route, /from '@\/server\/http\/retired-route';/, 'the adapter delegates to server/http/');
  assert.doesNotMatch(route, /^(import|export)\b.*(exam-runner|examPOST)/m, 'the retired route no longer reaches the old handler');
  const handler = 'server/http/retired-route.ts';
  assert.doesNotMatch(fs.readFileSync(handler, 'utf8'), /exam-runner'|examPOST/, 'the retired handler does not reach the old one');
  const ts = require('typescript'), vm = require('node:vm'), next = require('next/server'), mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(handler, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: n => n === 'server-only' ? {} : n === 'next/server' ? next : require(n) });
  const response = mod.exports.retiredRoute();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'This exam route has been retired.' });
  const middleware = fs.readFileSync('middleware.ts', 'utf8');
  assert.match(middleware, /path\.startsWith\('\/api\/secure-exams\/'\)\) return NextResponse\.json\(\{ error: 'This exam route has been retired\.' \}, \{ status: 410/);
  assert.doesNotMatch(middleware, /secure-exams[^\n]*NextResponse\.next\(\)/, 'middleware no longer allows secure-exams through');
  assert.doesNotMatch(fs.readFileSync('frontend/lib/api.ts', 'utf8'), /secure-exams/, 'the browser transport no longer allows secure-exams');
});

test('the legacy exam tables and RPCs are closed, and no page or service reads the legacy exam list for the Home or the staff check', () => {
  const website = fs.readFileSync('server/repositories/website.ts', 'utf8') + fs.readFileSync('server/services/website.ts', 'utf8');
  assert.doesNotMatch(website, /offering_assessments|from\('assessments'\)|scheduledAssessments|assessments:/, 'the website scope reads no legacy exam table');
  const pages = fs.readFileSync('app/(dashboard)/_components/website-pages.tsx', 'utf8');
  assert.doesNotMatch(pages, /Assessments|scope\.scheduled|available_upcoming_assessments/, 'the Home has no legacy Assessments section');
  const exams = fs.readFileSync('server/services/exams.ts', 'utf8');
  assert.doesNotMatch(exams, /loadExamList|repository\.list\(/, 'the exam list gate is a plain staff check');
  const migration = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('_close_direct_table_access.sql'));
  assert.equal(migration.length, 1, 'one closing migration');
  const sql = fs.readFileSync('supabase/migrations/' + migration[0], 'utf8');
  for (const table of ['assessments', 'offering_assessments', 'assessment_questions', 'assessment_options', 'assessment_attempts', 'assessment_responses'])
    assert.match(sql, new RegExp('public\\.' + table + '\\b'), table + ' is named in the revoke');
  assert.match(sql, /revoke all on public\.assessments[\s\S]*from anon,authenticated,service_role/);
});

test('the closing migration has the expected shape: one transaction, no cascade, definer functions with an empty search_path, writes revoked, no edit of old migrations', () => {
  const name = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('_close_direct_table_access.sql'))[0];
  const sql = fs.readFileSync('supabase/migrations/' + name, 'utf8');
  assert.ok(name > '20261119120000_live_class.sql', 'dated after the last applied migration');
  assert.match(sql, /^begin;/m); assert.match(sql, /^commit;\s*$/m);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\bcascade\b/i, 'no CASCADE drops');
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\bdrop (table|function|view|column)\b/i, 'nothing is dropped except policies and one trigger');
  for (const fn of sql.split(/create or replace function /).slice(1)) {
    const header = fn.slice(0, fn.indexOf('$$'));
    if (/security definer/i.test(header)) assert.match(header, /set search_path=''/, 'definer function with an empty search_path: ' + header.slice(0, 60));
  }
  for (const t of ['courses', 'course_modules', 'course_staff', 'lessons', 'lesson_blocks', 'lesson_progress', 'media_assets', 'organization_memberships', 'organizations', 'profiles', 'enrollments', 'course_offerings', 'offering_staff'])
    assert.match(sql, new RegExp('public\\.' + t + '\\b'), t + ' is in the revoke list');
  assert.match(sql, /revoke insert,update,delete,truncate,references,trigger on/);
  assert.match(fs.readFileSync('.gitattributes', 'utf8'), new RegExp('supabase/migrations/' + name.replace('.', '\\.') + ' -text'), 'kept byte-exact like every migration');
  const hidden = [...sql].filter(ch => { const c = ch.codePointAt(0); return (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || (c < 32 && ![9, 10, 13].includes(c)); });
  assert.deepEqual(hidden, [], 'no invisible or bidirectional character in the file itself (the regex uses escapes)');
});
