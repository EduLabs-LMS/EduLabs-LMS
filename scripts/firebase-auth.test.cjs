const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps, env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process: { env }, Date, Map, Buffer, URL, console,
    require(name) { if (name === 'server-only') return {}; assert.ok(name in deps, name); return deps[name]; } });
  return module.exports;
}
const env = { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'diagonproduction' };
test('restored-session and form completion navigate home only once', async () => {
  const effects = [], navigations = [];
  let finishSync;
  const syncing = new Promise(resolve => { finishSync = resolve; });
  const user = { emailVerified: true };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('frontend/features/auth/firebase-form.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const dependencies = {
    react: { useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect), useRef: value => ({ current: value }), useCallback: callback => callback },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'Link' },
    'firebase/auth': { signInWithEmailAndPassword: async () => ({ user }), getRedirectResult: async () => null },
    '@/frontend/lib/firebase': { getFirebaseAuth: () => ({}), restoreFirebaseAuth: async () => {} },
    '@/shared/contracts/student-administration': load('shared/contracts/student-administration.ts',{zod:require('zod')}),
    '@/frontend/components/providers/firebase-auth-provider': {
      useFirebaseAuth: () => ({ user, loading: false, error: null }),
      synchronizeFirebaseSession: () => syncing,
    },
  };
  vm.runInNewContext(source, { module, exports: module.exports,URLSearchParams,
    window: { location: { search:'',replace: path => navigations.push(path), assign: path => navigations.push(path) } },
    require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  const tree = module.exports.FirebaseForm({});
  const form = tree.props.children.find(child => child?.type === 'form');
  form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  effects[2]();
  finishSync();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(navigations, ['/home']);
});
const identity = () => ({ uid: 'firebase-string-uid', sub: 'firebase-string-uid', aud: 'diagonproduction', iss: 'https://securetoken.google.com/diagonproduction', exp: Date.now() / 1000 + 60 });
function authService(admin, staging = true) {
  return load('server/services/firebase-auth.ts', { 'next/headers': {}, '@/shared/auth-config': { isFirebaseStaging: () => staging }, '@/server/integrations/firebase-admin': { getFirebaseAdminAuth: () => admin } }, env);
}
test('token verification requests revocation checks and rejects wrong audience/issuer, expiry and UID spoofing', async () => {
  let claims = identity();
  const service = authService({ verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); assert.equal(token, 'real-token'); return claims; } });
  assert.equal((await service.verifyFirebaseToken('real-token')).uid, claims.uid);
  for (const change of [{ aud: 'other-project' }, { iss: 'https://securetoken.google.com/other-project' }, { exp: 1 }, { uid: 'spoof' }, { sub: '' }]) {
    claims = { ...identity(), ...change };
    await assert.rejects(service.verifyFirebaseToken('real-token'), /Invalid token identity/);
  }
  await assert.rejects(service.verifyFirebaseToken('x'.repeat(16001)), /Invalid token/);
  await assert.rejects(authService({}, false).verifyFirebaseToken('real-token'), /disabled/);
});
test('claim provisioning preserves existing claims and coalesces concurrent requests without accepting arbitrary roles', async () => {
  let claims = { support_feature: true }; let writes = 0;
  const service = authService({ getUser: async uid => { assert.equal(uid, 'verified-uid'); return { customClaims: claims }; },
    setCustomUserClaims: async (uid, value) => { writes++; claims = value; } });
  await Promise.all(Array.from({ length: 10 }, () => service.provisionFirebaseClaim('verified-uid')));
  assert.equal(writes, 1); assert.equal(claims.support_feature, true); assert.equal(claims.role, 'authenticated');
  assert.equal(await service.provisionFirebaseClaim('verified-uid'), false);
  claims = { role: 'service_role' };
  await assert.rejects(service.provisionFirebaseClaim('verified-uid'), /Conflicting API role/);
  assert.equal(writes, 1);
});
test('disabled Firebase accounts cannot receive claims', async () => {
  await assert.rejects(authService({ getUser: async () => ({ disabled: true }) }).provisionFirebaseClaim('disabled'), /disabled/);
});
test('Firebase staging never routes legacy APIs to Clerk or Prisma', () => {
  const { default: middleware } = load('middleware.ts', {
    '@clerk/nextjs/server': { clerkMiddleware: () => () => assert.fail('Legacy handler'), createRouteMatcher: () => () => false },
    '@/shared/auth-config': { isFirebaseStaging: () => true },
    '@/shared/website-routes': load('shared/website-routes.ts', {}),
    'next/server': { NextResponse: { next: () => 'allowed', redirect: url => url.pathname, json: (_, options) => options.status } },
  });
  const request = path => ({ url: `http://localhost${path}`, nextUrl: new URL(`http://localhost${path}`) });
  for (const path of ['/api/uploadthing', '/api/admin/users', '/api/livekit', '/api/courses']) assert.equal(middleware(request(path), {}), 503);
  assert.equal(middleware(request('/home'), {}), 'allowed');
  assert.equal(middleware(request('/teacher/create'), {}), 'allowed');
  for (const path of ['/api/teacher/organizations', '/api/teacher/courses', '/api/teacher/courses/20000000-0000-0000-0000-000000000001']) assert.equal(middleware(request(path), {}), 'allowed');
  for (const path of ['/api/teacher/courses/invalid', '/api/teacher/courses/20000000-0000-0000-0000-000000000001/chapters']) assert.equal(middleware(request(path), {}), 503);
  assert.equal(middleware(request('/courses/id/chapters/lesson'), {}), '/unavailable');
  for (const path of ['/sign-in', '/lms-staging', '/api/auth/firebase/session']) assert.equal(middleware(request(path), {}), 'allowed');
});
test('same-origin CSRF validation fails closed in production without an exact configured origin', () => {
  const deps = { 'next/server': {}, '@supabase/supabase-js': {}, '@/shared/supabase-config': {}, '@/shared/auth-config': {}, '@/server/services/firebase-auth': {}, '@/server/integrations/firebase-admin': {} };
  const request = (origin, site = 'same-origin') => ({ url: 'https://portal.example/api/auth/firebase/session', headers: new Headers({ origin, 'sec-fetch-site': site }) });
  deps['next/server'] = {}; // Handler module is imported without executing any mutation.
  // Headers are passed in from this realm, not constructed by the tested module.
  const { validFirebaseOrigin } = load('server/http/firebase/route.ts', deps, { NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example' });
  assert.equal(validFirebaseOrigin(request('https://portal.example')), true);
  assert.equal(validFirebaseOrigin(request('https://evil.example')), false);
  assert.equal(validFirebaseOrigin(request('https://portal.example', 'cross-site')), false);
  assert.equal(load('server/http/firebase/route.ts', deps, { NODE_ENV: 'production' }).validFirebaseOrigin(request('https://portal.example')), false);
});
test('server Supabase requests forward the verified Firebase ID token, never a privileged key or cookie substitute', async () => {
  let options;
  const { getSupabaseServerClient } = load('server/integrations/supabase.ts', {
    '@supabase/ssr': {}, 'next/headers': {}, '@/shared/auth-config': { isFirebaseStaging: () => true },
    '@/server/services/firebase-auth': { getFirebaseSession: async () => ({ token: 'verified-id-token', identity: { role: 'authenticated', email_verified: true } }) },
    '@/shared/supabase-config': { getSupabaseConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }) },
    '@supabase/supabase-js': { createClient: (url, key, value) => { assert.equal(key, 'sb_publishable_test'); options = value; return {}; } },
  });
  await getSupabaseServerClient(); assert.equal(await options.accessToken(), 'verified-id-token'); assert.equal(options.auth.persistSession, false);
});

function handlers({ staging = true, verified = true, role = 'authenticated', revokeFails = false } = {}) {
  const writes = []; const rpcCalls = []; const revoked = [];
  const identity = { uid: 'verified-uid', email_verified: verified, role, exp: Date.now() / 1000 + 600 };
  const response = { json: (data, options = {}) => ({ data, status: options.status || 200, cookies: { set: (...args) => writes.push(args) } }) };
  const exports = load('server/http/firebase/route.ts', {
    'next/server': { NextResponse: response }, '@/shared/auth-config': { isFirebaseStaging: () => staging },
    '@/shared/supabase-config': { getSupabaseConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }) },
    '@/server/services/firebase-auth': { firebaseCookie: '__Host-lms-firebase-id', verifyFirebaseToken: async () => identity,
      getFirebaseSession: async () => ({ identity, token: 'verified-id-token' }), provisionFirebaseClaim: async uid => { assert.equal(uid, 'verified-uid'); return true; } },
    '@/server/integrations/firebase-admin': { getFirebaseAdminAuth: () => ({ revokeRefreshTokens: async uid => { revoked.push(uid); if (revokeFails) throw Error('offline'); } }) },
    '@supabase/supabase-js': { createClient: (url, key, options) => ({ rpc: async name => { rpcCalls.push([name, await options.accessToken()]); return { data: 'stable-profile-uuid', error: null }; } }) },
  }, { NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example' });
  const request = (action, body = { idToken: 'verified-id-token', userId: 'attacker', role: 'service_role', profileId: 'victim' }, origin = 'https://portal.example') => new Request(`https://portal.example/api/auth/firebase/${action}`, {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ...exports, request, writes, rpcCalls, revoked };
}
test('staging endpoints fail closed and enforce CSRF and body limits before identity work', async () => {
  const disabled = handlers({ staging: false }); assert.equal((await disabled.POST(disabled.request('session'))).status, 404);
  const enabled = handlers(); assert.equal((await enabled.POST(enabled.request('session', {}, 'https://evil.example'))).status, 403);
  assert.equal((await enabled.POST(enabled.request('session', { idToken: 'x'.repeat(19000) }))).status, 413);
  assert.equal(enabled.rpcCalls.length, 0);
});
test('server session rejects unverified email and unexpected PostgreSQL roles', async () => {
  for (const configuration of [{ verified: false }, { role: 'service_role' }]) {
    const handler = handlers(configuration); assert.equal((await handler.POST(handler.request('session'))).status, 403);
    assert.equal(handler.writes.length, 0); assert.equal(handler.rpcCalls.length, 0);
  }
});
test('session derives UUID only from token RPC and sets bounded Secure HttpOnly host cookie', async () => {
  const handler = handlers(); const result = await handler.POST(handler.request('session'));
  assert.equal(result.status, 200); assert.equal(result.data.profileId, 'stable-profile-uuid');
  assert.deepEqual(handler.rpcCalls, [['onboard_firebase_profile', 'verified-id-token']]);
  const [name, token, options] = handler.writes[0]; assert.equal(name, '__Host-lms-firebase-id'); assert.equal(token, 'verified-id-token');
  assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'strict'); assert.equal(options.path, '/');
  assert.ok(options.maxAge > 0 && options.maxAge <= 600);
});
test('logout revokes only verified identity, invalidates database tokens and clears cookie even on failure', async () => {
  for (const revokeFails of [false, true]) {
    const handler = handlers({ revokeFails }); const result = await handler.POST(handler.request('logout'));
    assert.equal(result.status, revokeFails ? 401 : 200);
    assert.deepEqual(handler.revoked, ['verified-uid']);
    assert.deepEqual(handler.rpcCalls, [['revoke_my_firebase_identity', 'verified-id-token']]);
    assert.equal(handler.writes[0][2].maxAge, 0);
  }
});

function adminFixture(value,extra={}) {
 const events=[],deps={'node:fs':{readFileSync:()=>{events.push('read');return JSON.stringify(value);}},'firebase-admin/app':{getApps:()=>[],cert:v=>{events.push({cert:v});return 'local-cert';},applicationDefault:()=>{events.push('adc');return 'adc';},initializeApp:v=>{events.push({initialized:v});return {}; }},'firebase-admin/auth':{getAuth:()=>({local:true})}};
 return {events,admin:load('server/integrations/firebase-admin.ts',deps,{NEXT_PUBLIC_FIREBASE_PROJECT_ID:'synthetic-project',...extra})};
}
test('protected service-account configuration signs locally without remote IAM escalation',()=>{const f=adminFixture({type:'service_account',project_id:'synthetic-project',client_email:'synthetic@example.invalid',private_key:'synthetic-key'},{GOOGLE_APPLICATION_CREDENTIALS:'protected-credential.json'});f.admin.getFirebaseAdminAuth();assert.equal(f.events.includes('adc'),false);assert.equal(f.events.find(e=>e.cert)?.cert.projectId,'synthetic-project');assert.equal(f.events.find(e=>e.initialized)?.initialized.credential,'local-cert');});
test('protected service-account configuration rejects mismatched projects before initialization',()=>{const f=adminFixture({type:'service_account',project_id:'wrong-project',client_email:'synthetic@example.invalid',private_key:'synthetic-key'},{GOOGLE_APPLICATION_CREDENTIALS:'protected-credential.json'});assert.throws(()=>f.admin.getFirebaseAdminAuth(),/does not match/);assert.equal(f.events.some(e=>e.initialized),false);});
test('workload ADC and explicit server credential modes remain supported',()=>{const workload=adminFixture({});workload.admin.getFirebaseAdminAuth();assert.equal(workload.events.includes('adc'),true);assert.equal(workload.events.includes('read'),false);const explicit=adminFixture({},{FIREBASE_CLIENT_EMAIL:'synthetic@example.invalid',FIREBASE_PRIVATE_KEY:'synthetic-key',GOOGLE_APPLICATION_CREDENTIALS:'unused.json'});explicit.admin.getFirebaseAdminAuth();assert.equal(explicit.events.includes('read'),false);assert.equal(explicit.events.find(e=>e.initialized)?.initialized.credential,'local-cert');});
