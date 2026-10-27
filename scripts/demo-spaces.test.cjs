const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), ts = require('typescript'), crypto = require('node:crypto');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const teacherHome = localization.load('shared/teacher-home.ts');

function load(file, deps = {}) {
 const m = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: m, exports: m.exports, URL, Buffer, console, require: n => n === 'zod' || n === 'node:crypto' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
 return m.exports;
}
const read = f => fs.readFileSync(f, 'utf8');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const contract = load('shared/contracts/platform-demo.ts');
const plain = v => JSON.parse(JSON.stringify(v)); // objects built inside the vm are a different realm
const failure = (message, status, reason) => Object.assign(new Error(message), { status, reason });

const MIGRATION = 'supabase/migrations/20261027120000_demo_spaces.sql';
const migrations = () => fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort().map(n => read('supabase/migrations/' + n));

// ---------------------------------------------------------------- migration and version consistency
test('migration: the reviewed demo-spaces SQL is byte-identical to the approved draft and is checked out without line-ending conversion', () => {
 const raw = fs.readFileSync(MIGRATION), hash = b => crypto.createHash('sha256').update(b).digest('hex');
 const lf = hash(Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
 assert.equal(hash(raw) === 'e8638ca13c9b5bbc1ec84894928479d8e3301924a3ca49a2bb4b76b37d3bfa4c' || lf === 'e8638ca13c9b5bbc1ec84894928479d8e3301924a3ca49a2bb4b76b37d3bfa4c', true);
 assert.match(read('.gitattributes'), /supabase\/migrations\/20261027120000_demo_spaces\.sql -text/);
 const names = fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort();
 assert.equal(names[names.length - 1], '20261027120000_demo_spaces.sql', 'it sorts after every earlier migration');
});
test('migration: platform administrators only, every call audited, nothing runs by itself', () => {
 const sql = read(MIGRATION);
 for (const fn of ['platform_set_demo_space', 'platform_demo_fill', 'platform_demo_clear', 'platform_demo_status']) assert.match(sql, new RegExp('function private\\.' + fn + '[\\s\\S]*?is_platform_admin\\(\\)'));
 assert.match(sql, /demo\.mark.*demo\.unmark.*demo\.fill.*demo\.clear/s);
 assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bpg_cron\b|\btrigger\b.*demo/i);
});

test('versions: the latest seed version in the SQL, the service constant and docs/ai/DEMO_DATA.md agree', () => {
 const sqlVersions = migrations().flatMap(sql => [...sql.matchAll(/'latestSeedVersion',\s*(\d+)/g)].map(m => Number(m[1])));
 assert.ok(sqlVersions.length >= 1, 'platform_demo_status reports the latest seed version');
 const sqlLatest = Math.max(...sqlVersions);
 const filled = migrations().flatMap(sql => [...sql.matchAll(/update private\.demo_spaces set seed_version=(\d+)/g)].map(m => Number(m[1])));
 assert.equal(Math.max(...filled), sqlLatest, 'the version the fill stores is the version the status reports as latest');
 const constant = Number(/latestDemoSeedVersion\s*=\s*(\d+)/.exec(read('shared/contracts/platform-demo.ts'))[1]);
 const doc = read('docs/ai/DEMO_DATA.md');
 const rows = doc.split('\n').filter(l => /^\|\s*[^|-]/.test(l) && !/Teacher feature/.test(l) && /`[a-z_]+`/.test(l)).map(l => l.split('|').map(c => c.trim()).filter(Boolean));
 assert.ok(rows.length >= 1, 'the seed table has rows');
 const docLatest = Math.max(...rows.map(r => Number(r[2])));
 assert.equal(constant, sqlLatest, 'service constant vs SQL');
 assert.equal(docLatest, sqlLatest, 'DEMO_DATA.md table vs SQL');
 assert.equal(contract.latestDemoSeedVersion, constant);
});
test('versions: every module and table the SQL seeds is documented in DEMO_DATA.md', () => {
 const doc = read('docs/ai/DEMO_DATA.md'), all = migrations().join('\n');
 const modules = new Set([...all.matchAll(/demo_track\(p_org,'([a-z_]+)'/g)].map(m => m[1]));
 assert.ok(modules.size >= 2);
 for (const m of modules) assert.ok(doc.includes('`' + m + '`'), 'seed module ' + m + ' is not in DEMO_DATA.md');
 const allowed = /table_name text not null check \(table_name in \(([^)]*)\)\)/.exec(all)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
 for (const t of allowed) assert.ok(doc.includes('`' + t + '`'), 'seed table ' + t + ' is not in DEMO_DATA.md');
 for (const f of ['docs/ai/DECISIONS.md', 'docs/ai/TESTING.md']) assert.match(read(f), /DEMO_DATA\.md/, f + ' mentions the rule');
 assert.match(read('docs/ai/DECISIONS.md'), /extend\s+the demo seed in the same change/);
});

// ---------------------------------------------------------------- service
function service(rpc) {
 const calls = [];
 const mod = load('server/services/platform-demo.ts', { 'server-only': {}, '@/server/services/platform-provisioning': { provisioningFailure: failure }, '@/shared/contracts/platform-demo': contract });
 return { calls, svc: mod.platformDemoService({ rpc: async (name, args) => { calls.push([name, args]); return rpc(name, args); } }), mod };
}
test('service: each operation calls exactly one platform function with only the space id (and the on/off flag); no actor, user or role is sent', async () => {
 const { calls, svc } = service(async name => ({ data: name === 'platform_demo_status' ? { demo: true, filled: true, seedVersion: 1, filledAt: '2030-01-01T00:00:00Z', latestSeedVersion: 1 } : name === 'platform_set_demo_space' ? { demo: true } : name === 'platform_demo_fill' ? { seedVersion: 1, courses: 2, lessons: 5, groups: 2, sessions: 5 } : { removedRows: 20 }, error: null }));
 assert.deepEqual(plain(await svc.status(uuid(1))), { demo: true, filled: true, seedVersion: 1, filledAt: '2030-01-01T00:00:00Z', latestSeedVersion: 1 });
 assert.deepEqual(plain(await svc.setDemo(uuid(1), true)), { organizationId: uuid(1), demo: true });
 assert.deepEqual(plain(await svc.fill(uuid(1))), { seedVersion: 1, courses: 2, lessons: 5, groups: 2, sessions: 5 });
 assert.deepEqual(plain(await svc.clear(uuid(1))), { removedRows: 20 });
 assert.deepEqual(calls.map(c => c[0]), ['platform_demo_status', 'platform_set_demo_space', 'platform_demo_fill', 'platform_demo_clear']);
 assert.deepEqual(calls.map(c => Object.keys(c[1]).sort().join()), ['p_org', 'p_on,p_org', 'p_org', 'p_org']);
});
test('service: database refusals map to a closed vocabulary; unknown text and unknown codes never leak', () => {
 const { mod } = service(async () => ({}));
 const cases = [
  [{ code: '42501', message: 'Platform administration denied' }, 403, 'forbidden'],
  [{ code: 'PT404', message: 'Portal unavailable' }, 404, 'not_found'],
  [{ code: 'PT409', message: 'This space is not marked as a demo space' }, 409, 'demo_not_marked'],
  [{ code: 'PT409', message: 'Demo data is already present. Clear it first.' }, 409, 'demo_filled'],
  [{ code: 'PT409', message: 'The teacher has not accepted the invitation yet' }, 409, 'not_accepted'],
  [{ code: 'PT409', message: 'A space with enrolled students cannot receive demo data' }, 409, 'has_students'],
  [{ code: 'PT409', message: 'A space with enrolled students cannot become a demo space' }, 409, 'has_students'],
  [{ code: 'PT409', message: 'Clear the demo data before turning demo off' }, 409, 'demo_not_cleared'],
  [{ code: 'PT409', message: 'something else entirely' }, 409, 'conflict'],
  [{ code: '22023', message: 'x' }, 400, 'invalid'],
  [{ code: 'XX000', message: 'relation "private.demo_spaces" does not exist' }, 503, 'unavailable'],
  [{}, 503, 'unavailable'],
 ];
 for (const [error, status, reason] of cases) { const e = mod.demoError(error); assert.equal(e.status, status); assert.equal(e.reason, reason); assert.doesNotMatch(e.message, /private\.|relation|does not exist/); }
});
test('service: a malformed or missing reply is unavailable, never success', async () => {
 for (const data of [null, undefined, {}, { demo: 'yes' }, 'ok']) {
  const { svc } = service(async () => ({ data, error: null }));
  await assert.rejects(svc.status(uuid(1)), e => e.status === 503 && e.reason === 'unavailable');
 }
 for (const [op, data] of [['fill', {}], ['fill', { seedVersion: 1, courses: -1, lessons: 1, groups: 1, sessions: 1 }], ['fill', { seedVersion: '1', courses: 1, lessons: 1, groups: 1, sessions: 1 }], ['clear', {}], ['clear', { removedRows: 'many' }], ['setDemo', {}], ['setDemo', { demo: false }]]) {
  const { svc } = service(async () => ({ data, error: null }));
  await assert.rejects(op === 'setDemo' ? svc.setDemo(uuid(1), true) : svc[op](uuid(1)), e => e.status === 503, op + JSON.stringify(data));
 }
 const { svc } = service(async () => ({ data: null, error: { code: 'PT409', message: 'Demo data is already present. Clear it first.' } }));
 await assert.rejects(svc.fill(uuid(1)), e => e.reason === 'demo_filled');
});

// ---------------------------------------------------------------- HTTP
class Response { constructor(body, init) { this.body = body; this.status = init?.status ?? 200; this.headers = init?.headers ?? {}; } }
const req = (method, body, { url = 'https://admin.example/api/platform-admin/portals/x/demo', type = 'application/json' } = {}) => ({ method, url, headers: { get: k => ({ 'content-type': type })[k.toLowerCase()] ?? null },
 body: body === undefined ? null : { getReader() { const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); let done = false; return { read: async () => done ? { done: true } : (done = true, { done: false, value: new Uint8Array(bytes) }), cancel: async () => {} }; } } });
function http({ status = 'ok', origin = true, svc = {} } = {}) {
 const calls = [];
 const portals = load('server/http/platform-admin-portals.ts', {
  'server-only': {}, 'next/server': { NextResponse: { json: (body, init) => new Response(body, init) }, NextRequest: class {} },
  '@/shared/contracts/platform-provisioning': load('shared/contracts/platform-provisioning.ts'),
  '@/server/services/platform-admin': { getPlatformAdminAccess: async () => { calls.push(['access']); return status === 'ok' ? { status, client: { id: 'client' } } : { status }; } },
  '@/server/services/platform-provisioning': { platformProvisioningService: () => ({}), acceptTeacherInvitation: async () => ({}), previewTeacherInvitation: async () => ({}) },
  '@/server/http/firebase/route': { validFirebaseOrigin: () => origin }, '@/server/services/application-auth': { getApplicationViewer: async () => null },
  '@/server/integrations/supabase': { getSupabaseServerClient: async () => ({}) }, '@/shared/auth-config': { isFirebaseStaging: () => true },
 });
 const service = {
  status: async id => { calls.push(['status', id]); return { demo: false, filled: false, seedVersion: null, filledAt: null, latestSeedVersion: 1 }; },
  setDemo: async (id, on) => { calls.push(['setDemo', id, on]); return { organizationId: id, demo: on }; },
  fill: async id => { calls.push(['fill', id]); return { seedVersion: 1, courses: 2, lessons: 5, groups: 2, sessions: 5 }; },
  clear: async id => { calls.push(['clear', id]); return { removedRows: 20 }; }, ...svc,
 };
 const mod = load('server/http/platform-admin-demo.ts', { 'server-only': {}, 'next/server': { NextRequest: class {} }, '@/shared/contracts/platform-demo': contract, '@/server/http/platform-admin-portals': portals, '@/server/services/platform-demo': { platformDemoService: () => service } });
 return { mod, calls };
}
test('HTTP: anonymous, unavailable and non-administrators never reach any demo operation', async () => {
 for (const [status, expected] of [['anonymous', 401], ['forbidden', 403], ['unavailable', 404]]) {
  for (const body of [undefined, { action: 'mark' }, { action: 'unmark' }, { action: 'fill' }, { action: 'clear' }]) {
   const h = http({ status }); const r = await h.mod.platformDemoHTTP(req(body === undefined ? 'GET' : 'POST', body), uuid(1));
   assert.equal(r.status, expected, status + JSON.stringify(body)); assert.deepEqual(h.calls.map(c => c[0]), ['access']);
  }
 }
});
test('HTTP: writes need an exact origin first, JSON, a bounded size and a strict verb-only body; the space comes only from the path', async () => {
 const cross = http({ origin: false }); assert.equal((await cross.mod.platformDemoHTTP(req('POST', { action: 'fill' }), uuid(1))).status, 403); assert.deepEqual(cross.calls, []);
 assert.equal((await http().mod.platformDemoHTTP(req('POST', { action: 'fill' }, { type: 'text/plain' }), uuid(1))).status, 415);
 assert.equal((await http().mod.platformDemoHTTP(req('POST', 'x'.repeat(32001)), uuid(1))).status, 413);
 assert.equal((await http().mod.platformDemoHTTP(req('POST', '{'), uuid(1))).status, 400);
 for (const bad of [{ action: 'fill', organizationId: uuid(2) }, { action: 'fill', userId: uuid(3) }, { action: 'mark', role: 'owner' }, { action: 'clear', email: 'x@example.test' }, { action: 'delete' }, { action: ['fill'] }, {}, []]) {
  const h = http(); const r = await h.mod.platformDemoHTTP(req('POST', bad), uuid(1)); assert.equal(r.status, 400, JSON.stringify(bad));
  assert.equal(h.calls.some(c => ['setDemo', 'fill', 'clear'].includes(c[0])), false, 'nothing ran for ' + JSON.stringify(bad));
 }
 assert.equal((await http().mod.platformDemoHTTP(req('POST', { action: 'fill' }, { url: 'https://admin.example/x?org=1' }), uuid(1))).status, 400);
 assert.equal((await http().mod.platformDemoHTTP(req('GET', undefined, { url: 'https://admin.example/x?org=1' }), uuid(1))).status, 400);
 for (const id of ['x', '../1', uuid(1) + '0', uuid(1).toUpperCase().replace(/-/g, '_')]) assert.equal((await http().mod.platformDemoHTTP(req('GET'), id)).status, 404, id);
});
test('HTTP: each verb runs exactly its operation for the path space; replies are never cached', async () => {
 for (const [action, expected] of [['mark', ['setDemo', uuid(1), true]], ['unmark', ['setDemo', uuid(1), false]], ['fill', ['fill', uuid(1)]], ['clear', ['clear', uuid(1)]]]) {
  const h = http(); const r = await h.mod.platformDemoHTTP(req('POST', { action }), uuid(1));
  assert.equal(r.status, 200); assert.deepEqual(h.calls.filter(c => c[0] !== 'access'), [expected]); assert.match(r.headers['Cache-Control'], /no-store/);
 }
 const h = http(); const s = await h.mod.platformDemoHTTP(req('GET'), uuid(1)); assert.equal(s.status, 200); assert.deepEqual(h.calls.filter(c => c[0] !== 'access'), [['status', uuid(1)]]);
});
test('HTTP: a database refusal keeps its status and reason; anything unexpected becomes a generic 503', async () => {
 const h = http({ svc: { fill: async () => { throw failure('The teacher has not accepted the invitation yet.', 409, 'not_accepted'); } } });
 const r = await h.mod.platformDemoHTTP(req('POST', { action: 'fill' }), uuid(1)); assert.equal(r.status, 409); assert.equal(r.body.reason, 'not_accepted');
 const boom = http({ svc: { clear: async () => { throw new Error('relation private.demo_spaces exploded'); } } });
 const b = await boom.mod.platformDemoHTTP(req('POST', { action: 'clear' }), uuid(1)); assert.equal(b.status, 503); assert.doesNotMatch(JSON.stringify(b.body), /private\.|exploded/);
});
test('route: the demo endpoint exists once, as GET and POST, and the source has no console output or injectable identifiers', () => {
 assert.match(read('app/api/platform-admin/portals/[portalId]/demo/route.ts'), /platformDemoRoute as GET, platformDemoRoute as POST/);
 const code = (read('server/http/platform-admin-demo.ts') + read('server/services/platform-demo.ts')).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
 assert.doesNotMatch(code, /console\.|p_user|p_role|p_actor|searchParams/);
});

// ---------------------------------------------------------------- teacher Home label
test('Home label: shown only when every teaching space was confirmed as a demo space', () => {
 const { showDemoLabel, teachingSpaceIds } = teacherHome;
 assert.equal(showDemoLabel([uuid(1)], [true]), true);
 assert.equal(showDemoLabel([uuid(1), uuid(2)], [true, true]), true);
 assert.equal(showDemoLabel([uuid(1)], [false]), false, 'a non-demo space is never labelled');
 assert.equal(showDemoLabel([uuid(1), uuid(2)], [true, false]), false, 'a real space next to a demo space is not labelled');
 assert.equal(showDemoLabel([], []), false, 'no space, no label');
 assert.equal(showDemoLabel([uuid(1)], []), false, 'no answer, no label');
 assert.equal(showDemoLabel([uuid(1), uuid(2)], [true]), false, 'a missing answer, no label');
 assert.equal(showDemoLabel([uuid(1)], ['true']), false, 'only a real boolean true counts');
 assert.equal(showDemoLabel(Array.from({ length: 11 }, (_, i) => uuid(i)), Array(11).fill(true)), false, 'too many spaces to confirm');
 const ids = teachingSpaceIds([{ id: uuid(1), name: 'A' }], { ok: true, value: [{ id: uuid(9), organization_id: uuid(2), title: 't', status: 'draft' }, { id: uuid(8), organization_id: uuid(1), title: 't', status: 'draft' }] });
 assert.deepEqual([...ids].sort(), [uuid(1), uuid(2)].sort(), 'creation spaces plus the spaces of listed courses, once each');
 assert.deepEqual([...teachingSpaceIds([{ id: uuid(1), name: 'A' }], { ok: false, status: 503 })], [uuid(1)]);
});
test('Home label: the database check never throws or shows an error to the teacher', async () => {
 const mod = load('server/services/demo-space.ts', { 'server-only': {} });
 assert.equal(await mod.spaceIsDemo({ rpc: async () => ({ data: true, error: null }) }, uuid(1)), true);
 for (const result of [{ data: false, error: null }, { data: null, error: null }, { data: 'true', error: null }, { data: true, error: { code: '42501' } }, { data: 1, error: null }]) assert.equal(await mod.spaceIsDemo({ rpc: async () => result }, uuid(1)), false);
 assert.equal(await mod.spaceIsDemo({ rpc: async () => { throw new Error('network'); } }, uuid(1)), false);
 assert.equal(await mod.spaceIsDemo({ rpc: async (name, args) => { assert.equal(name, 'space_is_demo'); assert.deepEqual(Object.keys(args), ['p_org']); return { data: true, error: null }; } }, uuid(1)), true);
});
test('Home label: the Home loader answers with demo=false on any failure, and the view renders the label only when the server said so', () => {
 const loader = read('server/services/teacher-home.ts');
 assert.match(loader, /async function demoLabel[\s\S]*catch \{ return false; \}/);
 assert.match(loader, /demo: await demoLabel\(/);
 const view = read('frontend/features/teacher-home/home-view.tsx');
 assert.equal((view.match(/<DemoLabel \/>/g) || []).length, 2, 'Home and first visit only');
 for (const m of view.matchAll(/<DemoLabel \/>/g)) assert.match(view.slice(Math.max(0, m.index - 20), m.index), /data\.demo && $/, 'always behind data.demo');
 assert.doesNotMatch(view, /demo\s*\|\|\s*true|demo: true|data\.demo\s*=/);
});

// ---------------------------------------------------------------- locales
test('locales: every demo string exists in English and Arabic with the same placeholders; teacher words only on teacher screens', () => {
 const ours = k => /^(pa\.demo\.|pa\.activity\.demo_|pa\.err\.(demo_|not_accepted|has_students)|demo\.)/.test(k);
 assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ar).sort(), 'en and ar keys are in sync');
 const keys = Object.keys(messages.en).filter(ours);
 assert.ok(keys.length >= 45);
 const holes = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
 for (const k of keys) {
  assert.ok(messages.en[k].trim() && messages.ar[k].trim(), k);
  assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k + ' placeholders');
  assert.match(messages.ar[k], /[؀-ۿ]/, k + ' has Arabic text');
  assert.notEqual(messages.ar[k], messages.en[k], k);
 }
 const teacher = ['demo.space_label'];
 for (const k of teacher) assert.doesNotMatch(messages.en[k] + messages.ar[k], /organi[sz]ation|tenant|slug|program|stage|module|website studio|منظمة|مؤسسة|برنامج|مرحلة|وحدة/i, k);
 for (const k of ['pa.demo.filled']) for (const v of ['courses', 'lessons', 'groups', 'sessions']) assert.match(messages.en[k], new RegExp('\\{' + v + '\\}'));
});
test('admin UI: demo controls block double clicks, lock after an unknown outcome and never retry it automatically', () => {
 const ui = read('frontend/features/platform-admin/demo-section.tsx');
 assert.match(ui, /if \(inflight\.current \|\| unknown\) return/);
 assert.match(ui, /out\.reason === 'network'\) \{ setUnknown\(true\); return; \}/);
 assert.doesNotMatch(ui, /setTimeout|setInterval|retry\(/);
 assert.match(ui, /disabled=\{locked \|\| status\.filled \|\| !accepted\}/, 'Fill needs an accepted invitation');
 assert.match(ui, /disabled=\{locked \|\| status\.filled\}/, 'Turn demo off only when cleared');
 assert.match(ui, /disabled=\{locked \|\| !status\.filled\}/, 'Clear only when filled');
 const form = read('frontend/features/platform-admin/provision-form.tsx');
 assert.match(form, /useState\(false\);\s*\n\s*const \[demoState/, 'the Demo space checkbox is off by default');
 assert.match(form, /if \(demo\) void markDemo\(out\.data\.organizationId\)/, 'demo is marked only after provisioning succeeded');
 assert.doesNotMatch(form, /toRequest\([^)]*demo/, 'the provisioning request never carries demo');
 assert.match(form, /demoState === 'unknown'[\s\S]*pa\.demo\.partial_unknown/);
});
