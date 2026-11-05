// server/request-scope.ts: per-request memoization and Server-Timing. The security rule under test: nothing here outlives one request or is shared
// between requests, users or tokens, and a failed or expired answer is never reused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps, env = {}, clock = { now: 0 }) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process: { env }, Map, WeakMap, Array, Promise, Math, Number, String, URL, JSON, Response, Request, Headers, console,
    performance: { now: () => clock.now },
    require(name) { if (name === 'server-only') return {}; assert.ok(name in deps, name); return deps[name]; } });
  return module.exports;
}
// Every call of cookies() answers with the cookie store of the CURRENT request, like Next does: one object per request.
function world(env = {}) {
  const clock = { now: 1000 };
  const state = { store: {}, outside: false };
  const scope = load('server/request-scope.ts', { 'next/headers': { cookies: async () => { if (state.outside) throw new Error('outside a request'); return state.store; } } }, env, clock);
  return { scope, clock, state, newRequest() { state.store = {}; } };
}

test('memo: a value is computed once per request for one credential, and reused by later callers in that request', async () => {
  const w = world(); let runs = 0;
  const compute = async () => ++runs;
  assert.equal(await w.scope.requestMemo('session', 'token-a', compute), 1);
  assert.equal(await w.scope.requestMemo('session', 'token-a', compute), 1);
  const parallel = await Promise.all([w.scope.requestMemo('session', 'token-a', compute), w.scope.requestMemo('session', 'token-a', compute)]);
  assert.deepEqual(parallel, [1, 1]);
  assert.equal(runs, 1);
});
test('memo: the next request never sees the previous request\'s answer, so every request verifies and checks revocation afresh', async () => {
  const w = world(); let runs = 0;
  const compute = async () => ++runs;
  assert.equal(await w.scope.requestMemo('session', 'token-a', compute), 1);
  w.newRequest();
  assert.equal(await w.scope.requestMemo('session', 'token-a', compute), 2, 'same user and same token, new request: computed again');
  w.newRequest();
  assert.equal(await w.scope.requestMemo('session', 'token-a', compute), 3);
});
test('memo: another credential in the same request is never answered from the first one', async () => {
  const w = world(); const seen = [];
  const run = token => w.scope.requestMemo('viewer', token, async () => { seen.push(token); return 'viewer-of-' + token; });
  assert.equal(await run('token-a'), 'viewer-of-token-a');
  assert.equal(await run('token-b'), 'viewer-of-token-b', 'a different token recomputes');
  assert.equal(await run('token-b'), 'viewer-of-token-b');
  assert.deepEqual(seen, ['token-a', 'token-b']);
});
test('memo: a failure is not remembered, and an answer older than 30 seconds is not reused', async () => {
  const w = world(); let runs = 0;
  await assert.rejects(w.scope.requestMemo('k', 'p', async () => { runs++; throw new Error('boom'); }), /boom/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await w.scope.requestMemo('k', 'p', async () => { runs++; return 'ok'; }), 'ok', 'the failure was dropped');
  assert.equal(runs, 2);
  assert.equal(await w.scope.requestMemo('k', 'p', async () => { runs++; return 'again'; }), 'ok');
  w.clock.now += 30_001;
  assert.equal(await w.scope.requestMemo('k', 'p', async () => { runs++; return 'fresh'; }), 'fresh', 'expired entries recompute');
});
test('memo: outside a request (no cookie store) and with the measurement switch on, nothing is memoized', async () => {
  const w = world(); let runs = 0;
  w.state.outside = true;
  await w.scope.requestMemo('k', 'p', async () => ++runs); await w.scope.requestMemo('k', 'p', async () => ++runs);
  assert.equal(runs, 2);
  assert.equal(await w.scope.requestScope(), null);
  const off = world({ LMS_DISABLE_REQUEST_MEMO: '1' }); let more = 0;
  await off.scope.requestMemo('k', 'p', async () => ++more); await off.scope.requestMemo('k', 'p', async () => ++more);
  assert.equal(more, 2);
});
test('memo: nothing is kept at module level (the scope lives on the request\'s own cookie store object)', () => {
  const source = fs.readFileSync('server/request-scope.ts', 'utf8');
  assert.match(source, /const scopes = new WeakMap<object, RequestScope>\(\)/);
  assert.equal((source.match(/^(export )?(const|let|var) \w+(:[^=]+)?=\s*new (Map|Set)\(/gm) ?? []).length, 0);
});
test('timing: off by default; on, it records fixed phase names, durations and counts only', async () => {
  const off = world();
  assert.equal(await off.scope.timePhase('firebase_verify', async () => 7), 7);
  assert.equal((await off.scope.requestScope()).marks.size, 0, 'no marks when timing is off');
  const on = world({ LMS_SERVER_TIMING: '1' });
  await on.scope.timePhase('firebase_verify', async () => { on.clock.now += 40; });
  await on.scope.timePhase('rpc_group_view', async () => { on.clock.now += 10; });
  await on.scope.timePhase('rpc_group_view', async () => { on.clock.now += 20; });
  await on.scope.timePhase('weird name with spaces/ids 123e4567-e89b', async () => {});
  const value = on.scope.serverTimingValue(await on.scope.requestScope());
  assert.match(value, /firebase_verify;dur=40\.0;desc="x1"/); assert.match(value, /rpc_group_view;dur=30\.0;desc="x2"/); assert.match(value, /total;dur=70\.0/);
  const names = [...(await on.scope.requestScope()).marks.keys()];
  assert.ok(names.every(name => /^[A-Za-z0-9_.-]{1,48}$/.test(name)), 'unusual names are reduced to safe characters: ' + names.join());
  assert.doesNotMatch(value, /eyJ|Bearer/, 'no credentials');
});
test('timing: a new request starts with an empty scope (marks are never shared between requests)', async () => {
  const w = world({ LMS_SERVER_TIMING: '1' });
  await w.scope.timePhase('firebase_verify', async () => {});
  assert.equal((await w.scope.requestScope()).marks.size, 1);
  w.newRequest();
  assert.equal((await w.scope.requestScope()).marks.size, 0);
});
test('withServerTiming: untouched when off; adds one Server-Timing header when on; a handler error propagates', async () => {
  const response = () => new Response('{}', { headers: { 'content-type': 'application/json' } });
  const off = world(); const offModule = load('server/http/server-timing.ts', { '@/server/request-scope': off.scope }, {});
  const handled = await offModule.withServerTiming(async () => response())(new Request('http://x'));
  assert.equal(handled.headers.get('server-timing'), null);
  const on = world({ LMS_SERVER_TIMING: '1' }); const onModule = load('server/http/server-timing.ts', { '@/server/request-scope': on.scope }, { LMS_SERVER_TIMING: '1' });
  const timed = await onModule.withServerTiming(async () => { await on.scope.timePhase('viewer_lookup', async () => { on.clock.now += 5; }); return response(); })(new Request('http://x'));
  assert.match(timed.headers.get('server-timing'), /^viewer_lookup;dur=5\.0;desc="x1", total;dur=/);
  await assert.rejects(onModule.withServerTiming(async () => { throw new Error('handler failed'); })(new Request('http://x')), /handler failed/);
});
test('Supabase phase names carry the table or function only, never the query, filters or ids', () => {
  const deps = { '@supabase/ssr': {}, '@supabase/supabase-js': {}, '@/shared/auth-config': {}, '@/server/services/firebase-auth': {}, 'next/headers': {}, '@/shared/supabase-config': {}, '@/server/request-scope': world().scope };
  const { supabasePhaseName } = load('server/integrations/supabase.ts', deps);
  assert.equal(supabasePhaseName('https://x.supabase.co/rest/v1/rpc/group_view'), 'rpc_group_view');
  assert.equal(supabasePhaseName(new URL('https://x.supabase.co/rest/v1/profiles?id=eq.123e4567-e89b-12d3-a456-426614174000&select=*')), 'rest_profiles');
  assert.equal(supabasePhaseName('https://x.supabase.co/auth/v1/token'), 'supabase_other');
  assert.equal(supabasePhaseName('not a url'), 'supabase_other');
});
test('the revocation check is still part of every token verification, and the viewer and client reuse is tied to the token', () => {
  const auth = fs.readFileSync('server/services/firebase-auth.ts', 'utf8');
  assert.match(auth, /verifyIdToken\(token, true\)/);
  assert.match(auth, /requestMemo\('firebase-session', token,/);
  assert.match(fs.readFileSync('server/services/application-auth.ts', 'utf8'), /requestMemo\('viewer', session\.token,/);
  assert.match(fs.readFileSync('server/integrations/supabase.ts', 'utf8'), /requestMemo\('supabase-client', session\.token,/);
  assert.doesNotMatch(fs.readFileSync('next.config.js', 'utf8') + auth, /LMS_DISABLE_REQUEST_MEMO\s*=\s*['"]?1/, 'the measurement switch is never set by the app');
});
