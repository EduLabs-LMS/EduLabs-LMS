const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies, env = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env }, console,
    require(name) {
      if (name === 'server-only' || name.endsWith('.css')) return {};
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

test('middleware protects student, teacher and API routes, allowing only explicit public routes', async () => {
  let protects = 0;
  const { default: middleware } = load('middleware.ts', {
    'next/server': {},
    '@/shared/auth-config': { isFirebaseStaging: () => false },
    '@/shared/website-routes': load('shared/website-routes.ts', {}),
    '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }),
    '@clerk/nextjs/server': {
      clerkMiddleware: callback => request => callback({ protect: async () => { protects++; } }, request),
      createRouteMatcher: patterns => request => patterns.some(pattern => new RegExp(`^${pattern}$`).test(new URL(request.url).pathname)),
    },
  });
  for (const route of ['/home', '/group', '/teacher/courses', '/admin/users', '/api/courses', '/api/admin/students', '/api/uploadthing-evil']) {
    const before = protects;
    await middleware({ url: `http://localhost${route}`, nextUrl: new URL(`http://localhost${route}`) }, {});
    assert.equal(protects, before + 1, route);
  }
  for (const route of ['/sign-in', '/sign-in/factor-one', '/sign-up', '/test-page', '/api/uploadthing']) {
    const before = protects;
    await middleware({ url: `http://localhost${route}`, nextUrl: new URL(`http://localhost${route}`) }, {});
    assert.equal(protects, before, route);
  }
});

test('promised route params and asynchronous Clerk identity reach the progress query intact', async () => {
  let writes = 0;
  class NextResponse extends Response { static json(data) { return new Response(JSON.stringify(data)); } }
  const { PUT } = load('server/http/courses/[courseId]/chapters/[chapterId]/progress/route.ts', {
    '@clerk/nextjs/server': { auth: async () => ({ userId: 'student-a' }) },
    'next/server': { NextResponse },
    '@/server/db': { db: { userProgress: { upsert: async value => {
      writes++;
      assert.equal(value.where.userId_chapterId.userId, 'student-a');
      assert.equal(value.where.userId_chapterId.chapterId, 'chapter-a');
      return value.create;
    } } } },
  });
  const response = await PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ isWatched: true }) }), {
    params: Promise.resolve({ courseId: 'course-a', chapterId: 'chapter-a' }),
  });
  assert.equal(response.status, 200);
  assert.equal(writes, 1);
});

test('UploadThing preserves separate teacher and student authorization with async Clerk', async () => {
  let identity = null;
  let teacher = false;
  function fileRoute() { return { middleware(handler) { this.authorize = handler; return this; }, onUploadComplete() { return this; } }; }
  const { ourFileRouter } = load('server/integrations/uploadthing.ts', {
    '@clerk/nextjs/server': { auth: async () => ({ userId: identity }) },
    '@/server/services/teacher': { isTeacher: async () => teacher },
    'uploadthing/next': { createUploadthing: () => fileRoute },
  }, { UPLOADTHING_TOKEN: 'test-only-placeholder' });
  await assert.rejects(ourFileRouter.courseImage.authorize(), /sign in/);
  await assert.rejects(ourFileRouter.homeworkSubmission.authorize(), /sign in/);
  identity = 'student-a';
  await assert.rejects(ourFileRouter.courseImage.authorize(), /Only teacher/);
  assert.equal((await ourFileRouter.homeworkSubmission.authorize()).userId, identity);
  teacher = true;
  assert.equal((await ourFileRouter.chapterVideo.authorize()).userId, identity);
});

test('Supabase client awaits request cookies and passes only the publishable key', async () => {
  const writes = [];
  let config;
  const { getSupabaseServerClient } = load('server/integrations/supabase.ts', {
    '@supabase/supabase-js': {},
    '@/shared/auth-config': { isFirebaseStaging: () => false },
    '@/shared/website-routes': load('shared/website-routes.ts', {}),
    '@/shared/public-website': load('shared/public-website.ts', { zod: require('zod') }),
    '@/server/services/firebase-auth': {},
    'next/headers': { cookies: async () => ({ getAll: () => [{ name: 'session', value: 'test' }], set: (...args) => writes.push(args) }) },
    '@/shared/supabase-config': { getSupabaseConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }) },
    '@supabase/ssr': { createServerClient: (url, key, options) => { config = { url, key, options }; return { scoped: true }; } },
  });
  assert.equal((await getSupabaseServerClient()).scoped, true);
  assert.equal(config.key, 'sb_publishable_test');
  assert.equal(config.options.cookies.getAll()[0].name, 'session');
  config.options.cookies.setAll([{ name: 'session', value: 'refreshed', options: { httpOnly: true } }]);
  assert.equal(writes[0][1], 'refreshed');
});

test('editor and preview disable vulnerable Quill semantic HTML export and retain the existing themes', () => {
  const dependencies = {
    'react': { useMemo: factory => factory() },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/dynamic': { default: () => 'test-editor' },
  };
  const editor = load('frontend/components/editor.tsx', dependencies).Editor({ value: '<p>Physics</p>', onChange() {} }).props.children;
  const preview = load('frontend/components/preview.tsx', dependencies).Preview({ value: '<p>Physics</p>' });
  assert.equal(editor.props.useSemanticHTML, false);
  assert.equal(preview.props.useSemanticHTML, false);
  assert.equal(editor.props.theme, 'snow');
  assert.equal(preview.props.theme, 'bubble');
  assert.equal(editor.props.value, '<p>Physics</p>');
});

test('patched PostCSS and selector parser preserve nested selectors and Tailwind utilities', async () => {
  const postcss = require('postcss');
  const nested = await postcss([require('postcss-nested')]).process('.card { &:hover { color: red } & > a { color: blue } }', { from: undefined });
  assert.match(nested.css, /\.card:hover/);
  assert.match(nested.css, /\.card > a/);
  const utilities = await postcss([require('tailwindcss')({
    content: [{ raw: '<div class="grid grid-cols-2 md:grid-cols-3 rounded-lg bg-white"></div>' }],
    corePlugins: { preflight: false },
  })]).process('@tailwind utilities;', { from: undefined });
  assert.match(utilities.css, /display: grid/);
  assert.match(utilities.css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(utilities.css, /@media \(min-width: 768px\)/);
  assert.match(utilities.css, /border-radius: 0\.5rem/);
});
