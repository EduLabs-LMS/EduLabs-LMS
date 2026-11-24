const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function load(file, deps = {}, env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, process: { env }, console: { log() {}, error() {} },
    require(name) { if (name === 'server-only') return {}; if (name === 'zod') return require('zod'); if (name === '@/shared/auth-config') return { isFirebaseStaging: () => false }; assert.ok(name in deps, name); return deps[name]; },
  });
  return module.exports;
}

test('LMS staging fails closed before constructing a client by default', async () => {
  const { getStagingLmsRepository } = load('server/services/lms-staging.ts', {
    '@/server/integrations/supabase': { getSupabaseServerClient() { assert.fail('Client must not be created'); } },
    '@/server/repositories/lms': {},
  });
  await assert.rejects(getStagingLmsRepository(), /disabled/);
});
test('Clerk login alone cannot authorize the Supabase staging repository', async () => {
  const { getStagingLmsRepository } = load('server/services/lms-staging.ts', {
    '@/server/integrations/supabase': { getSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) },
    '@/server/repositories/lms': {},
  }, { LMS_DATA_BACKEND: 'supabase-staging' });
  await assert.rejects(getStagingLmsRepository(), /Verified Supabase identity/);
});
test('pagination rejects unbounded, negative, fractional and NaN requests', () => {
  const { pageRange } = load('server/repositories/lms.ts');
  assert.deepEqual(Array.from(pageRange()), [0, 49]);
  for (const value of [{ page: -1 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: NaN }]) assert.throws(() => pageRange(value));
});
test('repository excludes keys and unreleased grading columns from student reads', async () => {
  const selects = [];
  const query = { select(value) { selects.push(value); return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, range() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const repo = load('server/repositories/lms.ts').createSupabaseLmsRepository({ from: () => query }, 'verified-user');
  await repo.options('question'); await repo.responses('attempt');
  assert.deepEqual(selects, ['id,question_id,text,position', 'id,attempt_id,question_id,response,media_asset_id,updated_at']);
});
test('the repository has no direct progress write (progress is saved by a database function)', () => {
  const repo = load('server/repositories/lms.ts').createSupabaseLmsRepository({ from: () => assert.fail('no table access') }, 'verified-user');
  assert.equal(repo.updateProgress, undefined);
});
test('private storage does not overwrite and rejects Free-tier oversized uploads', async () => {
  let options;
  const adapter = load('server/integrations/lms-storage.ts').createSupabaseMediaStorage({ storage: { from: () => ({ upload: async (path, file, value) => { options = value; return { error: null }; } }) } });
  await adapter.upload('lms-course-media', 'path', { size: 10, type: 'application/pdf' });
  assert.equal(options.upsert, false);
  await assert.rejects(adapter.upload('lms-course-media', 'path', { size: 50_000_001 }), /limit/);
});
test('the repository has no direct media registration (uploads are registered by a database function)', () => {
  const repo = load('server/repositories/lms.ts').createSupabaseLmsRepository({ from: () => assert.fail('no table access') }, 'verified-user');
  assert.equal(repo.registerMedia, undefined);
});
test('grade port validates result payload and strips unspecified key material', async () => {
  const response = { attempt_id: '10000000-0000-0000-0000-000000000001', status: 'graded', score: 2, max_score: 2, responses: [], answer_keys: 'must never forward' };
  const repo = load('server/repositories/lms.ts').createSupabaseLmsRepository({ rpc: async () => ({ data: response, error: null }) }, 'verified-user');
  assert.equal(Object.hasOwn(await repo.results(response.attempt_id), 'answer_keys'), false);
  response.score = 'malformed';
  await assert.rejects(repo.results(response.attempt_id));
});
test('legacy email sync rejects unverified administrator email before database access', async () => {
  const { syncCurrentUser } = load('server/services/user.ts', {
    '@clerk/nextjs/server': { currentUser: async () => ({ id: 'user', primaryEmailAddressId: 'email', emailAddresses: [{ id: 'email', emailAddress: 'support.lop.physics@gmail.com', verification: { status: 'unverified' } }] }) },
    '@prisma/client': {}, '@/server/db': { db: new Proxy({}, { get() { assert.fail('Unverified identity reached persistence'); } }) },
  });
  assert.equal(await syncCurrentUser(), null);
});
