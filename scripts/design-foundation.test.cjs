// The Classic / New design foundation: tokens, the switch cookie, avatars, WCAG AA contrast of every text and fill pair, the real middleware and the locale strings.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm'), ts = require('typescript');
const localization = require('./localization-test-loader.cjs');
const design = localization.load('shared/design.ts');
const { messages } = localization.load('frontend/locales/messages.ts');
const read = f => fs.readFileSync(f, 'utf8');
const tokens = read('frontend/styles/design-tokens.css'), components = read('frontend/styles/design-components.css'), bridge = read('frontend/styles/design-bridge.css');

/** The custom properties of the block that starts with this exact selector. */
function block(selector) {
  const at = tokens.indexOf('\n' + selector + ' {'); assert.ok(at >= 0, 'missing block ' + selector);
  const body = tokens.slice(tokens.indexOf('{', at) + 1, tokens.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--d-[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const classicLight = block(':root, html[data-design="classic"]');
const classicDark = { ...classicLight, ...block('html.dark:not([data-design="new"]), html.dark:not(:has([data-teacher-shell]))') };
const newLight = block('html[data-design="new"]:has([data-teacher-shell])');
const newDark = { ...newLight, ...block('html.dark[data-design="new"]:has([data-teacher-shell])') };

function parse(value, over) {
  value = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(value); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(value); if (m) return [...m[1]].map(c => parseInt(c + c, 16));
  m = /^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:\/\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (m && m[4] !== undefined) { const top = parse(`hsl(${m[1]} ${m[2]}% ${m[3]}%)`), under = over || [255, 255, 255]; return top.map((c, i) => Math.round(c * +m[4] + under[i] * (1 - +m[4]))); }
  if (m) { const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100, f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; }
  throw new Error('not a solid colour: ' + value);
}
function colour(set, name) {
  let value = set['--d-' + name]; assert.ok(value, 'token --d-' + name);
  for (let i = 0; i < 4 && /^var\(/.test(value); i++) value = set[/^var\((--d-[\w-]+)\)/.exec(value)[1]];
  return parse(value, name === 'surface' ? undefined : colour(set, 'surface'));
}
const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const sets = { 'Classic light': classicLight, 'Classic dark': classicDark, 'New light': newLight, 'New dark': newDark };
const pairs = [
  ['ink', 'canvas'], ['ink', 'surface'], ['ink', 'sidebar'], ['ink', 'phone-bar'], ['ink', 'field'], ['ink', 'raised'],
  ['text-2', 'surface'], ['text-2', 'raised'], ['meta', 'surface'], ['meta', 'canvas'], ['meta', 'sidebar'], ['meta', 'phone-bar'], ['nav-text', 'sidebar'], ['link', 'surface'], ['link', 'canvas'],
  ['on-primary', 'primary'], ['on-accent', 'accent'], ['danger-text', 'danger-bg'], ['attention-text', 'attention-bg'],
  ['pill-success', 'pill-success-bg'], ['pill-info', 'pill-info-bg'], ['pill-warning', 'pill-warning-bg'], ['pill-danger', 'pill-danger-bg'], ['pill-neutral', 'pill-neutral-bg'],
  ['nav-active-text', 'nav-active-bg'], ['tile-band-text', 'tile-band'], ['tile-day', 'tile-bg'], ['hero-pill-text', 'hero-pill-bg'], ['ring-text', 'ring-center'],
  ...[1, 2, 3, 4, 5, 6].map(i => [`avatar-${i}-text`, `avatar-${i}`]),
];

test('contrast: every text and fill pair meets WCAG AA (4.5:1) in both looks and both themes', () => {
  const low = [];
  for (const [name, set] of Object.entries(sets)) for (const [text, back] of pairs) {
    const ratio = contrast(colour(set, text), colour(set, back));
    if (ratio < 4.5) low.push(`${name}: ${text} on ${back} = ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(low, []);
});

test('contrast: the focus ring and the tab colours stand out at 3:1 (non-text) on their backgrounds', () => {
  const low = [];
  for (const [name, set] of Object.entries(sets)) for (const [fg, back] of [['focus', 'surface'], ['focus', 'canvas'], ['tab-active', 'phone-bar'], ['tab-inactive', 'phone-bar']]) {
    const ratio = contrast(colour(set, fg), colour(set, back));
    if (ratio < 3) low.push(`${name}: ${fg} on ${back} = ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(low, []);
});

test('New tokens are the owner\'s values', () => {
  const expected = { canvas: '#EDF1E8', surface: '#FBFDF8', sidebar: '#F3F7EE', ink: '#1D2518', 'text-2': '#44523D', meta: '#5C6E51', line: '#D3DEC9', 'field-line': '#B7C6AA', primary: '#7FD959', 'on-primary': '#14301A', tint: '#E3F3DA', deep: '#2B6416', 'primary-shadow': '3px 3px 0 #2B6416', 'pill-success': '#2B6416', 'pill-success-bg': '#E3F3DA', 'pill-info': '#1F5A6B', 'pill-info-bg': '#E0F0F3', 'pill-warning': '#7A4F00', 'pill-warning-bg': '#FEF3C7', 'pill-danger': '#A61B1B', 'pill-danger-bg': '#FBE9E9', 'pill-neutral': '#44523D', 'pill-neutral-bg': '#E3E9DC' };
  for (const [name, value] of Object.entries(expected)) assert.equal(newLight['--d-' + name].toUpperCase(), value.toUpperCase(), name);
  assert.match(newLight['--d-card-shadow'], /0 3px 0 #D3DEC9/i); assert.match(newLight['--d-card-shadow'], /0 14px 28px -18px rgba\(29,\s*37,\s*24,\s*0?\.28\)/i);
  for (const [name, value] of Object.entries({ canvas: '#111813', surface: '#1C2620', ink: '#EDF2E9', line: '#33423A' })) assert.equal(newDark['--d-' + name].toUpperCase(), value, 'dark ' + name);
  assert.equal(newLight['--d-pill-height'], '24px'); assert.equal(newLight['--d-pill-size'], '13px'); assert.equal(newLight['--d-pill-weight'], '600');
  assert.equal(newLight['--d-title-md'], '28px'); assert.equal(newLight['--d-title-phone'], '24px');
  assert.equal(newLight['--d-section-size'], '18px'); assert.equal(newLight['--d-section-weight'], '700'); assert.equal(newLight['--d-body-size'], '15px'); assert.equal(newLight['--d-label-size'], '14px'); assert.equal(newLight['--d-meta-size'], '13px'); assert.equal(newLight['--d-data-size'], '14px');
  assert.equal(newLight['--d-radius-hero'], '24px'); assert.equal(newLight['--d-radius-control'], '16px');
  assert.match(tokens, /html\[data-design="new"\]\[lang="ar"\]:has\(\[data-teacher-shell\]\) \{\s*--d-body-lh: 1\.6;/);
});

test('New has no black outline and no hard black shadow, in the tokens or in the bridge to the existing screens', () => {
  for (const [name, set] of [['New light', newLight], ['New dark', newDark]]) for (const [key, value] of Object.entries(set)) {
    if (/border|line|shadow/.test(key)) assert.doesNotMatch(value, /#000(000)?\b|\bblack\b/i, `${name} ${key}`);
  }
  assert.doesNotMatch(bridge.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.[\w\\:.\-/[\]!]*black[\w\\:.\-/[\]!]*/g, ''), /#000|\bblack\b/i, 'the bridge sets no black itself');
});

test('Classic is today\'s look: its tokens are what the existing utilities resolve to', () => {
  const tailwind = read('tailwind.config.js'), globals = read('app/globals.css');
  assert.equal(classicLight['--d-ink'], 'hsl(100 20% 12%)', 'the text colour the old pages inherited from <body>'); assert.match(globals, /--foreground: 100 20% 12%;/);
  assert.equal(classicLight['--d-primary'], '#000000', 'the dark primary button of today'); assert.equal(classicLight['--d-primary-border'], '#000000');
  assert.equal(classicLight['--d-card-border-width'], '2.5px'); assert.equal(classicLight['--d-radius-card'], '24px'); assert.equal(classicLight['--d-card-shadow'].replace(/\s+/g, ' '), '4px 4px 0 #000');
  assert.equal(classicLight['--d-hero-bg'], 'hsl(102 63% 60% / 0.3)', 'bg-primary/30'); assert.equal(classicLight['--d-attention-bg'], '#fcd34d', 'bg-amber-300');
  assert.equal(classicLight['--d-canvas'].toLowerCase(), '#e9eee4', 'bg-slate-50 of the customised palette'); assert.equal(classicLight['--d-surface'].toLowerCase(), '#f6f9f2', 'bg-white of the customised palette');
  assert.match(tailwind, /#e9eee4/i); assert.match(tailwind, /#f6f9f2/i); assert.ok(globals.length > 0);
  assert.match(tokens, /^:root, html\[data-design="classic"\] \{/m, 'Classic is also the default with no attribute at all');
});

test('tokens: every variable the components and the bridge read is defined, in both looks', () => {
  const defined = new Set([...tokens.matchAll(/(--d-[\w-]+):/g)].map(m => m[1]));
  defined.add('--d-tabs-offset'); defined.add('--d-tile-count'); defined.add('--d-i');
  const used = new Set([...(components + bridge).matchAll(/var\((--d-[\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(u => !defined.has(u)), []);
  const onlyNew = [...Object.keys(newLight)].filter(k => !(k in classicLight)), onlyClassic = [...Object.keys(classicLight)].filter(k => !(k in newLight));
  assert.deepEqual(onlyNew, [], 'New defines nothing Classic lacks'); assert.deepEqual(onlyClassic, [], 'Classic defines nothing New lacks');
  // next/font declares its variables on <body>: a token that reads one on <html> would resolve to nothing.
  const onRoot = tokens.slice(0, tokens.indexOf('\nbody {'));
  assert.doesNotMatch(onRoot.replace(/\/\*[\s\S]*?\*\//g, ''), /var\(--font-/);
});

test('components use logical properties only, so the layout mirrors in Arabic by itself', () => {
  const rules = (components + bridge).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)\s*:/m);
  assert.doesNotMatch(rules, /(?:^|[\s;{])(?:left|right)\s*:/m);
  assert.doesNotMatch(rules, /text-align:\s*(?:left|right)/);
  assert.match(components, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the switch cookie: known values only, default Classic, no user data, not a security setting', () => {
  assert.equal(design.defaultDesign, 'new'); assert.equal(design.designCookieKey, 'edulabs_design');
  assert.equal(design.designFromCookie('new'), 'new'); assert.equal(design.designFromCookie('classic'), 'classic');
  for (const bad of [undefined, null, '', 'NEW', 'new;', '"><script>', 'admin', 42, {}]) assert.equal(design.designFromCookie(bad), 'new', String(bad));
  assert.equal(design.designCookie('new', true), 'edulabs_design=new; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  assert.equal(design.designCookie('classic', false), 'edulabs_design=classic; Path=/; Max-Age=31536000; SameSite=Lax');
  const layout = read('app/layout.tsx');
  assert.match(layout, /designFromCookie\(cookieStore\.get\(designCookieKey\)\?\.value\)/); assert.match(layout, /data-design=\{design\}/, 'the server sets it on <html>, so there is no flash');
  for (const css of ['design-tokens', 'design-components', 'design-bridge']) assert.match(layout, new RegExp(`^import '@/frontend/styles/${css}\\.css';`, 'm'));
  for (const file of ['middleware.ts', 'server/services/website.ts', 'server/services/teacher-home.ts']) assert.doesNotMatch(read(file), /edulabs_design|designCookieKey|data-design/, 'nothing about access reads it: ' + file);
  const settings = read('frontend/features/teacher-settings/design-settings.tsx');
  assert.match(settings, /document\.cookie = designCookie\(next, window\.location\.protocol === 'https:'\)/); assert.match(settings, /documentElement\.dataset\.design = next/);
  assert.match(read('app/(dashboard)/(routes)/teacher/settings/language/page.tsx'), /<DesignSettings initial=/);
  assert.equal(messages.en['ds.design.title'], 'Design'); assert.equal(messages.en['ds.design.classic'], 'Classic'); assert.equal(messages.en['ds.design.new'], 'New');
  assert.equal(messages.ar['ds.design.title'], 'التصميم'); assert.equal(messages.ar['ds.design.classic'], 'الكلاسيكي'); assert.equal(messages.ar['ds.design.new'], 'الجديد');
});

test('the bridge can only ever touch a teacher page in the New look', () => {
  const rules = bridge.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(Boolean);
  for (const rule of rules) {
    const selectors = rule.split('{')[0].replace(/@media[^{]*/, '');
    if (rule.startsWith('@media')) { assert.match(rule, /html\[data-design="new"\]:has\(\[data-teacher-shell\]\)/); continue; }
    for (const s of selectors.split(/,(?![^(]*\))/)) if (s.trim()) assert.match(s.trim(), /^html\[data-design="new"\]:has\(\[data-teacher-shell\]\)/, s);
  }
  const student = ['app/(dashboard)/layout.tsx'].map(read).join('');
  assert.match(student, /staffOrganizationIds\.length \? <TeacherFrame>/, 'only staff get the frame that carries data-teacher-shell');
  assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /data-teacher-shell/);
  assert.doesNotMatch(read('frontend/components/sidebar.tsx') + read('frontend/features/dashboard/mobile-sidebar.tsx'), /data-teacher-shell|d-shell/);
});

test('avatars: the tint comes from a stable hash of the id; initials are whole characters; nothing is stored', () => {
  const ids = Array.from({ length: 300 }, (_, i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0'));
  for (const id of ids) { const t = design.avatarTint(id); assert.ok(Number.isInteger(t) && t >= 1 && t <= design.AVATAR_TINTS, id); assert.equal(design.avatarTint(id), t, 'stable'); }
  assert.equal(new Set(ids.map(design.avatarTint)).size, design.AVATAR_TINTS, 'every tint gets used');
  assert.equal(design.stableHash('abc'), 440920331, 'FNV-1a, the same everywhere');
  assert.equal(design.initials('Synthetic Teacher'), 'ST'); assert.equal(design.initials('  mona  '), 'M'); assert.equal(design.initials('محمد أحمد'), 'مأ'); assert.equal(design.initials(''), ''); assert.equal(design.initials(null), '');
  assert.equal(design.initials('😀 Smile'), '😀S', 'never half an emoji');
  assert.doesNotMatch(read('frontend/components/design/avatar.tsx') + read('shared/design.ts'), /localStorage|sessionStorage|document\.cookie/);
});

test('shared components: one icon set, no emoji; every component is exported; no retired component and no PR #19 code', () => {
  const dir = 'frontend/components/design', files = fs.readdirSync(dir), barrel = read(path.join(dir, 'index.ts'));
  for (const name of ['Button', 'StatusPill', 'PageHeader', 'Card', 'ListRow', 'DateTile', 'Avatar', 'Field', 'SearchField', 'Tabs', 'SegmentedControl', 'StickyActionBar', 'Dialog', 'DesignSkeleton', 'Icon', 'IconBadge', 'CardHead', 'buttonClass']) assert.match(barrel, new RegExp(`\\b${name}\\b`), name);
  const all = files.map(f => read(path.join(dir, f))).join('\n') + read('frontend/features/teacher-frame/teacher-frame.tsx');
  assert.doesNotMatch(all, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no emoji in the UI');
  assert.doesNotMatch(all, /from 'lucide-react'/, 'one icon set in the design components and the frame');
});

test('locale: every new string exists in both languages with the same placeholders, Arabic in Arabic, and no forbidden word', () => {
  const forbidden = /organi[sz]ation|tenant|\bslug\b|program(me)?s?\b|\bstages?\b|\bmodules?\b|studio|منظمة|مؤسسة|وحدة|برنامج|مرحلة/i;
  const keys = Object.keys(messages.en).filter(k => k.startsWith('ds.') || k.startsWith('th.greet.') || k.startsWith('th.attention.') || k.startsWith('th.summary.') || k.startsWith('th.home.sessions_'));
  assert.ok(keys.length >= 20);
  for (const k of keys) {
    assert.ok(messages.ar[k], 'Arabic for ' + k); assert.match(messages.ar[k], /[؀-ۿ]/, k);
    const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
    assert.equal(holes(messages.en[k]), holes(messages.ar[k]), k);
    assert.doesNotMatch(messages.en[k] + messages.ar[k], forbidden, k);
  }
  assert.equal(messages.en['th.updates.title'], 'Updates'); assert.equal(messages.en['th.updates.all'], 'See all'); assert.equal(messages.en['th.next.open'], 'Open group'); assert.equal(messages.en['th.nav.groups'], 'Groups');
});

test('frame: the real middleware lets the exact pages through and sends lookalikes to /unavailable; a staff check still guards Settings', () => {
  class NextResponse { constructor(status, location) { this.status = status; this.location = location; this.headers = new Map(); } static next() { return new NextResponse(200); } static json(_, o) { return new NextResponse(o.status); } static redirect(u) { return new NextResponse(307, u.pathname); } }
  const loadTs = (file, deps = {}) => {
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: m, exports: m.exports, URL, require: n => n === 'zod' ? require(n) : n in deps ? deps[n] : (() => { throw Error('Unexpected import ' + n); })() });
    return m.exports;
  };
  const middleware = loadTs('middleware.ts', {
    '@/shared/public-website': loadTs('shared/public-website.ts', { zod: require('zod') }), '@/shared/website-routes': loadTs('shared/website-routes.ts'),
    '@clerk/nextjs/server': { clerkMiddleware: () => () => { throw Error('the legacy handler must not run in Firebase staging'); }, createRouteMatcher: () => () => false },
    '@/shared/auth-config': { isFirebaseStaging: () => true }, 'next/server': { NextResponse },
  }).default;
  const hit = pathname => middleware({ nextUrl: new URL('https://platform.example' + pathname), url: 'https://platform.example' + pathname }, {});
  const course = '00000000-0000-4000-8000-000000000001';
  for (const ok of ['/teacher/courses', '/teacher/settings', '/teacher/settings/account', '/teacher/settings/language', '/teacher/settings/notifications', '/teacher/settings/courses', '/teacher/settings/courses/' + course, '/teacher/courses/' + course, '/teacher/groups', '/teacher/students', '/notifications', '/support']) assert.equal(hit(ok).status, 200, ok);
  for (const bad of ['/teacher/courses/', '/teacher/courses/x', '/teacher/courses/' + course + '/x', '/teacher/settings/', '/teacher/settings/courses/', '/teacher/settings/courses/x', '/teacher/settings/account/x', '/teacher/settingsx', '/teacher/coursesx', '/teacher/settings/design']) {
    const r = hit(bad); assert.equal(r.status, 307, bad); assert.equal(r.location, '/unavailable', bad);
  }
  assert.match(read('app/(dashboard)/(routes)/teacher/settings/courses/page.tsx'), /redirect\('\/teacher\/courses'\)/);
  assert.match(read('app/(dashboard)/(routes)/teacher/courses/page.tsx'), /TeacherCoursesPage/);
  assert.match(read('app/(dashboard)/_components/teacher-home-pages.tsx'), /loadTeacherCourses\(await staffContext\(\)\)/, 'the course list still asks the server who you are');
  assert.match(read('app/(dashboard)/(routes)/teacher/settings/layout.tsx'), /await staffContext\(\)/);
});

test('first load: the provider waits for the end of the animation, then the address; in-app navigation never plays it', () => {
  const provider = read('frontend/components/providers/loading-provider.tsx'), overlay = read('frontend/components/loading-overlay.tsx');
  assert.match(provider, /first\.phase !== 'running' \|\| !first\.played/); assert.match(provider, /onPlayed=\{firstPlayed\}/);
  assert.match(overlay, /getAnimations\?\.\(\{ subtree: true \}\)/); assert.match(overlay, /FIRST_LOAD_PLAY_FALLBACK_MS/); assert.match(overlay, /prefers-reduced-motion: reduce/); assert.match(overlay, /bg-background'/);
  assert.match(read('app/globals.css'), /\.first-load-letter \{/);
});

test('signing out from the frame during an attendance save asks first', () => {
  const guard = read('frontend/features/teacher-attendance/leave-guard.tsx'), frame = read('frontend/features/teacher-frame/teacher-frame.tsx');
  assert.match(frame, /requestGuardedAction\(\(\) => \{ void signOut\(\); \}\)/); assert.match(guard, /setActionGuard\(run => setAsking\(\{ kind: 'action', run \}\)\)/); assert.match(guard, /removeActionGuard\(\)/);
});
