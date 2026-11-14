// Live classes (the EduLabs class on self-hosted Jitsi): the shared rules, the provider seam (configuration, the signed token, the meeting
// options), the pre-mark rule of Take attendance, the REAL middleware, the HTTP handler gates, the migration's shape and the locales.
// No network, no database: docs/ai/TESTING.md lists the SQL suite (supabase/tests/live-class.sql) and the browser harness.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), crypto = require('crypto');
const { manifest, hashes } = require('./lib/migrations.cjs');
const read = f => fs.readFileSync(f, 'utf8');
function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, Buffer, console, Date, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const live = load('shared/live-class.ts');
const provider = load('server/services/live-class-provider.ts', { 'server-only': {}, 'node:crypto': crypto });
const attendance = load('shared/teacher-attendance.ts');
const SECRET = 'x'.repeat(64);
const ENV = { LIVE_CLASS_PROVIDER: 'jitsi', LIVE_CLASS_URL: 'https://meet.edulabs-eg.com', LIVE_CLASS_APP_ID: 'edulabs', LIVE_CLASS_SECRET: SECRET };
const MIGRATION = 'supabase/migrations/20261119120000_live_class.sql';

test('shared rules: an online Session with no link is the EduLabs class; the window is 15 minutes before to 30 minutes after', () => {
 assert.equal(live.isLiveClass({ mode: 'online', join_url: '' }), true);
 assert.equal(live.isLiveClass({ mode: 'online', join_url: 'https://meet.example.com/x' }), false, 'Own link');
 assert.equal(live.isLiveClass({ mode: 'center', join_url: '' }), false);
 const s = { starts_at: '2026-11-20T18:00:00Z', ends_at: '2026-11-20T19:00:00Z' }, at = t => Date.parse(t);
 assert.equal(live.liveClassOpenAt(s, at('2026-11-20T17:44:59Z')), false);
 assert.equal(live.liveClassOpenAt(s, at('2026-11-20T17:45:00Z')), true);
 assert.equal(live.liveClassOpenAt(s, at('2026-11-20T19:29:59Z')), true);
 assert.equal(live.liveClassOpenAt(s, at('2026-11-20T19:30:00Z')), false);
 assert.equal(live.liveClassOpenAt({ ...s, cancelled: true }, at('2026-11-20T18:10:00Z')), false);
 assert.equal(live.liveClassAhead(s, at('2026-11-19T10:00:00Z')), true, 'a student may open the page a day early: it waits');
 assert.equal(live.liveClassAhead(s, at('2026-11-20T19:30:00Z')), false);
 assert.equal(live.classHref('abc'), '/class/abc');
 assert.equal(live.classHref('abc', true), '/class/abc?start=1');
 // The same numbers as the migration.
 const sql = read(MIGRATION);
 assert.match(sql, /opens:=s\.starts_at-interval '15 minutes'; closes:=s\.ends_at\+interval '30 minutes';/);
 assert.equal(live.LIVE_CLASS_OPENS_BEFORE_MIN, 15); assert.equal(live.LIVE_CLASS_CLOSES_AFTER_MIN, 30);
});

test('shared rules: the database reply is checked before anything is signed; refusals are answered in the app\'s words', () => {
 const base = { state: 'waiting', sessionId: 's', groupId: 'g', title: 'T', groupName: 'G', startsAt: 'a', endsAt: 'b', opensAt: 'c', closesAt: 'd', serverNow: 'e', staff: false };
 assert.equal(live.parseOpenRow(base).state, 'waiting');
 assert.equal(live.parseOpenRow({ ...base, state: 'joined' }), null, 'an unknown state');
 assert.equal(live.parseOpenRow({ ...base, staff: 'no' }), null);
 assert.equal(live.parseOpenRow({ ...base, state: 'open' }), null, 'open without a room');
 assert.equal(live.parseOpenRow({ ...base, state: 'open', room: 'short', moderator: false, displayName: 'A' }), null, 'a room that is not 64 hex');
 const open = live.parseOpenRow({ ...base, state: 'open', room: 'a'.repeat(64), moderator: true, displayName: 'A', startedNow: true, extra: 'dropped' });
 assert.equal(open.room, 'a'.repeat(64)); assert.equal(open.moderator, true); assert.equal(open.extra, undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(live.liveClassFailure({ code: '42501' }))), { status: 403, body: { kind: 'denied' } });
 assert.deepEqual(JSON.parse(JSON.stringify(live.liveClassFailure({ code: '23514' }))), { status: 400, body: { kind: 'invalid' } });
 assert.deepEqual(JSON.parse(JSON.stringify(live.liveClassFailure({ code: 'XX000' }))), { status: 503, body: { kind: 'failed' } });
});

test('provider: OFF unless every setting is present and well formed', () => {
 assert.notEqual(provider.liveClassConfig(ENV), null);
 assert.equal(provider.liveClassConfigured({}), false, 'nothing set: off');
 for (const [k, v] of [['LIVE_CLASS_PROVIDER', 'livekit'], ['LIVE_CLASS_SECRET', 'short'], ['LIVE_CLASS_SECRET', undefined], ['LIVE_CLASS_APP_ID', ''], ['LIVE_CLASS_APP_ID', 'bad id'],
  ['LIVE_CLASS_URL', 'http://meet.edulabs-eg.com'], ['LIVE_CLASS_URL', 'https://meet.edulabs-eg.com/room'], ['LIVE_CLASS_URL', 'https://user:pw@meet.edulabs-eg.com'], ['LIVE_CLASS_URL', 'https://meet.edulabs-eg.com:8443'],
  ['LIVE_CLASS_URL', 'https://meet.edulabs-eg.com/?x=1'], ['LIVE_CLASS_URL', 'https://51.195.252.97'], ['LIVE_CLASS_URL', 'not a url']])
  assert.equal(provider.liveClassConfig({ ...ENV, [k]: v }), null, `${k}=${v}`);
});

test('provider: the token is HS256 with the app id, the meeting host, the room, a short life, and only a name and the moderator flag', () => {
 const c = provider.liveClassConfig(ENV), now = Date.parse('2026-11-20T18:00:00Z');
 const verify = token => {
  const [h, b, s] = token.split('.');
  assert.equal(crypto.createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url'), s, 'signed with the shared secret');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  return JSON.parse(Buffer.from(b, 'base64url'));
 };
 const room = 'f'.repeat(64);
 const short = verify(provider.classToken(c, { room, name: 'Mona Ali', moderator: false, closesAt: now + 45 * 60000, now }));
 assert.deepEqual(short, { aud: 'edulabs', iss: 'edulabs', sub: 'meet.edulabs-eg.com', room, nbf: now / 1000 - 30, exp: now / 1000 + 45 * 60, context: { user: { name: 'Mona Ali', moderator: false } } });
 const long = verify(provider.classToken(c, { room, name: 'T', moderator: true, closesAt: now + 20 * 3600000, now }));
 assert.equal(long.exp, now / 1000 + 3 * 3600, 'never more than 3 hours ahead');
 assert.equal(long.context.user.moderator, true);
 assert.doesNotMatch(JSON.stringify(long), /@|email|id"/, 'no e-mail and no account id');
 assert.doesNotMatch(provider.classToken(c, { room, name: 'T', moderator: false, closesAt: now, now }), /x{64}/, 'the secret is never in the token');
});

test('provider: staff get screen sharing, the whiteboard and recording buttons and start talking; students start muted with the camera off', () => {
 const c = provider.liveClassConfig(ENV), now = Date.now();
 const staff = provider.classJoin(c, { room: 'a'.repeat(64), name: 'T', moderator: true, title: 'Physics', closesAt: now + 3600000, now });
 const student = provider.classJoin(c, { room: 'a'.repeat(64), name: 'S', moderator: false, title: 'Physics', closesAt: now + 3600000, now });
 assert.equal(student.scriptUrl, 'https://meet.edulabs-eg.com/external_api.js');
 assert.equal(student.domain, 'meet.edulabs-eg.com');
 for (const b of ['desktop', 'whiteboard', 'recording']) {
  assert.ok(staff.options.configOverwrite.toolbarButtons.includes(b), 'staff: ' + b);
  assert.ok(!student.options.configOverwrite.toolbarButtons.includes(b), 'student: ' + b);
 }
 assert.equal(student.options.configOverwrite.startWithAudioMuted, true); assert.equal(student.options.configOverwrite.startWithVideoMuted, true);
 assert.equal(staff.options.configOverwrite.startWithAudioMuted, false);
 assert.equal(student.options.configOverwrite.disableDeepLinking, true, 'phones stay in the browser');
 assert.equal(student.options.roomName, 'a'.repeat(64));
 // The students' buttons are the server's TOOLBAR_BUTTONS (infra/jitsi/jitsi.env.example).
 assert.match(read('infra/jitsi/jitsi.env.example'), new RegExp('^TOOLBAR_BUTTONS=' + [...provider.STUDENT_BUTTONS].join(',') + '$', 'm'));
});

test('Take attendance: joined students still not marked become Present; a mark (or a tap made meanwhile) is never changed', () => {
 const joined = new Set(['a', 'b', 'c', 'gone']);
 const saved = { a: 'not_marked', b: 'absent', c: 'not_marked', d: 'not_marked' };
 const now = { a: 'not_marked', b: 'absent', c: 'absent', d: 'not_marked' };
 assert.deepEqual(JSON.parse(JSON.stringify(attendance.joinedToMark(joined, saved, now))), { a: 'attended', b: 'absent', c: 'absent', d: 'not_marked' });
 assert.equal(attendance.joinedToMark(new Set(['b']), saved, now), null, 'nothing to change: nothing is saved');
 assert.equal(attendance.joinedToMark(new Set(), saved, now), null);
 const view = read('frontend/features/teacher-attendance/attendance-view.tsx');
 assert.match(view, /if \(next\) mark\(next\);/, 'the existing save queue does it, as the teacher');
 assert.match(view, /premarked\.current \|\| !s \|\| s\.cancelled \|\| s\.attendance_state === 'finalized' \|\| Date\.parse\(s\.starts_at\) > Date\.now\(\)/, 'once per visit, never on a finished, cancelled or future sheet');
 assert.doesNotMatch(view, /groupCall\('finalize'[^)]*joined/, 'never finishes the sheet');
});

test('middleware: the two API paths and /class/<uuid> pass, the page with no-referrer and no-store; lookalikes do not', () => {
 class NextResponse { constructor(kind, status) { this.kind = kind; this.status = status; this.headers = new Map(); } static next() { return new NextResponse('next', 200); } static json(_, o) { return new NextResponse('json', o.status); } static redirect(u) { return new NextResponse('redirect:' + u.pathname, 307); } }
 const middleware = load('middleware.ts', {
  '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': load('shared/website-routes.ts'),
  '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('the legacy handler must not run in Firebase staging'), createRouteMatcher: () => () => false },
  '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
 }).default;
 const run = path => middleware({ nextUrl: new URL('https://platform.example' + path), url: 'https://platform.example' + path }, {});
 const id = 'a0000000-0000-4000-8000-00000000000b';
 assert.equal(run('/api/live-class/open').kind, 'next');
 assert.equal(run('/api/live-class/joined').kind, 'next');
 const page = run('/class/' + id);
 assert.equal(page.kind, 'next'); assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer'); assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
 for (const p of ['/class', '/class/', '/class/not-a-uuid', `/class/${id}/`, `/class/${id}/x`, `/class/${id.toUpperCase()}`]) assert.equal(run(p).kind, 'redirect:/unavailable', p);
 for (const p of ['/api/live-class', '/api/live-class/start', '/api/live-class/open/x', '/api/livekit']) assert.equal(run(p).status, 503, p);
});

test('HTTP: both handlers answer 404 when live classes are off, check origin, size and sign-in, and never cache or pass on a referrer', () => {
 const http = read('server/http/live-class.ts');
 assert.match(http, /if \(!isFirebaseStaging\(\) \|\| !liveClassConfigured\(\)\) return reply\(\{ kind: 'off' \}, 404\);[\s\S]*if \(!validFirebaseOrigin\(request\)\) return reply\(\{ kind: 'denied' \}, 403\);[\s\S]*readBody\(request, liveClassOpenBody, 512\)/);
 assert.match(http, /sameOriginRead\(request\)/);
 assert.match(http, /'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'/);
 assert.match(http, /limits\(\)\.take\('open', viewer\.id\)/);
 const service = read('server/services/live-class.ts');
 assert.match(service, /getSupabaseServerClient\(\)/);
 const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
 assert.doesNotMatch(code(service), /service.?role|SUPABASE_SERVICE|admin/i, 'runs as the signed-in person');
 assert.match(service, /if \(row\.state === 'open' && room && displayName\)/, 'a token only for an open class');
 assert.equal(read('app/api/live-class/open/route.ts').trim(), "export { timedLiveClassOpenPOST as POST } from '@/server/http/timed';");
 assert.equal(read('app/api/live-class/joined/route.ts').trim(), "export { timedLiveClassJoinedGET as GET } from '@/server/http/timed';");
 const page = read('app/(dashboard)/(routes)/class/[sessionId]/page.tsx');
 assert.match(page, /if \(!uuid\.test\(sessionId\) \|\| !isFirebaseStaging\(\) \|\| !liveClassConfigured\(\)\) notFound\(\);/);
 assert.match(read('app/layout.tsx'), /data-live-class=\{firebase && liveClassConfigured\(\) \? 'on' : undefined\}/, 'the buttons follow one server-rendered flag');
});

test('the provider seam: only the provider knows Jitsi (the class page knows only the IFrame API name); no secret ever reaches the browser', () => {
 const files = [];
 const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
 for (const d of ['app', 'frontend', 'server', 'shared']) walk(d);
 const jitsi = files.filter(f => /jitsi/i.test(read(f))).sort();
 assert.deepEqual(jitsi, ['frontend/features/live-class/class-view.tsx', 'server/services/live-class-provider.ts']);
 assert.doesNotMatch(read('frontend/features/live-class/class-view.tsx'), /jitsi\.|meet\.|LIVE_CLASS_|secret/i);
 for (const f of files.filter(f => f.startsWith('frontend/') || f.startsWith('shared/'))) assert.doesNotMatch(read(f), /LIVE_CLASS_SECRET/, f);
});

test('migration: registered, private tables with RLS, definer functions behind invoker wrappers, current_app_user_id, the new type in both checks', () => {
 const sql = read(MIGRATION);
 assert.equal(manifest()['20261119120000_live_class.sql'], hashes('20261119120000_live_class.sql').lf, 'one manifest line with the LF hash');
 assert.match(read('.gitattributes'), /^supabase\/migrations\/20261119120000_live_class\.sql -text$/m);
 assert.doesNotMatch(sql, /\r/);
 assert.match(sql, /alter table private\.live_class_rooms enable row level security;\nalter table private\.live_class_joins enable row level security;\nrevoke all on private\.live_class_rooms,private\.live_class_joins from public,anon,authenticated;/);
 for (const f of ['live_class_open', 'live_class_joined']) {
  assert.match(sql, new RegExp(`create function private\\.${f}\\([^)]*\\) returns jsonb language plpgsql (stable )?security definer set search_path=''`));
  assert.match(sql, new RegExp(`create function public\\.${f}\\([^)]*\\) returns jsonb language sql (stable )?security invoker set search_path=''`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public,anon;\\ngrant execute on function public\\.${f}\\([^)]*\\) to authenticated;`));
 }
 assert.match(sql, /revoke all on function private\.emit_class_started\(uuid\) from public,anon,authenticated;/);
 assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /auth\.uid\(\)/);
 assert.equal((sql.match(/'support_reply','class_started'\)\);/g) || []).length, 2, 'both event_type checks');
 for (const f of ['live_class_open', 'live_class_joined', 'emit_class_started']) {
  const body = sql.slice(sql.indexOf(`create function private.${f}(`)).split('end $$;')[0];
  assert.ok(body.length > 200, f);
  assert.doesNotMatch(body, /session_attendance/, f + ' never writes (or reads) attendance');
 }
 assert.doesNotMatch(sql, /function (private|public)\.group_(command|view)\(/, 'the Groups functions are unchanged');
 assert.doesNotMatch(sql, /drop table|drop column|drop function/i);
 assert.match(sql, /'latestSeedVersion',9\)/); assert.match(sql, /update private\.demo_spaces set seed_version=9/);
 assert.match(read('scripts/exam-sql-local.cjs'), /'live-class'\]/, 'the SQL suite is registered');
});

test('locales: every new key is in English and Arabic, and the notification type has its label', () => {
 const en = read('frontend/locales/en.ts'), ar = read('frontend/locales/ar.ts');
 const keys = [...en.matchAll(/^ {2}"(lc\.[a-z_.]+|notifications\.eventClassStarted)":/gm)].map(m => m[1]);
 assert.ok(keys.length >= 25);
 for (const k of keys) assert.match(ar, new RegExp(`^  "${k.replace(/\./g, '\\.')}": "[^"]*[\\u0600-\\u06FF][^"]*",$`, 'm'), k);
 const c = load('shared/contracts/communications.ts');
 assert.ok(c.notificationEvents.includes('class_started'));
 assert.equal(c.eventLabels.class_started, 'Your class has started');
 assert.match(en, /"notifications\.eventClassStarted": "Your class has started",/);
});
