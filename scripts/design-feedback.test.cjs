// The owner's feedback on the New look: the countdown words, the server clock, the opening logo's head script, and what the stylesheets promise. The browser side is in design-feedback-checks.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const { load } = require('./localization-test-loader.cjs');
const read = f => fs.readFileSync(f, 'utf8');
const { countdownParts, formatCountdown, msToNextMinute, serverClockOffset, serverTimeFrom } = load('shared/home-countdown.ts');
const { firstOpenScript, FIRST_OPEN_KEY, FIRST_OPEN_ATTRIBUTE } = load('frontend/lib/first-load.ts');
const { teacherNav, teacherNavSoon } = load('shared/teacher-home.ts');

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, T = Date.UTC(2031, 2, 3, 9, 0, 0);
const at = ms => countdownParts(T + ms, T);
const en = ms => formatCountdown(at(ms), 'en');
const ar = ms => formatCountdown(at(ms), 'ar');

test('countdown, English: the owner\'s four forms', () => {
  assert.equal(en(2 * DAY + 5 * HOUR), 'in 2 d 5 h');
  assert.equal(en(3 * HOUR + 20 * MIN), 'in 3 h 20 min');
  assert.equal(en(25 * MIN), 'in 25 min');
  assert.equal(en(0), 'starting now');
});

test('countdown: the edges of each form', () => {
  assert.equal(en(DAY + MIN), 'in 1 d', 'just over 24 h: days, and a zero part is left out');
  assert.equal(en(DAY), 'in 24 h', 'exactly 24 h is not more than 24 h');
  assert.equal(en(DAY - MIN), 'in 23 h 59 min');
  assert.equal(en(HOUR), 'in 1 h'); assert.equal(en(HOUR - MIN), 'in 59 min'); assert.equal(en(MIN), 'in 1 min');
  assert.equal(en(25 * MIN - 1000), 'in 25 min', 'rounds up: never says less than is left');
  assert.equal(en(1000), 'in 1 min', 'one second before the start is not "starting now" yet');
  assert.equal(en(-1000), 'starting now'); assert.equal(en(-3 * HOUR), 'starting now', 'a page left open past the start');
  assert.equal(en(30 * DAY), 'in 30 d');
  assert.equal(formatCountdown(countdownParts(NaN, T), 'en'), 'starting now', 'a broken date never prints NaN');
});

test('countdown, Arabic: real plural forms, joined with و', () => {
  assert.equal(ar(2 * DAY + 5 * HOUR), 'بعد يومين و5 ساعات', 'the owner\'s example');
  assert.equal(ar(DAY + HOUR), 'بعد يوم وساعة');
  assert.equal(ar(DAY + 2 * HOUR), 'بعد يوم وساعتين');
  assert.equal(ar(3 * DAY + 11 * HOUR), 'بعد 3 أيام و11 ساعة');
  assert.equal(ar(10 * DAY), 'بعد 10 أيام'); assert.equal(ar(11 * DAY), 'بعد 11 يومًا'); assert.equal(ar(100 * DAY), 'بعد 100 يوم');
  assert.equal(ar(HOUR), 'بعد ساعة'); assert.equal(ar(2 * HOUR), 'بعد ساعتين'); assert.equal(ar(3 * HOUR + 20 * MIN), 'بعد 3 ساعات و20 دقيقة');
  assert.equal(ar(10 * HOUR + MIN), 'بعد 10 ساعات ودقيقة'); assert.equal(ar(23 * HOUR + 2 * MIN), 'بعد 23 ساعة ودقيقتين');
  assert.equal(ar(MIN), 'بعد دقيقة'); assert.equal(ar(2 * MIN), 'بعد دقيقتين'); assert.equal(ar(3 * MIN), 'بعد 3 دقائق'); assert.equal(ar(10 * MIN), 'بعد 10 دقائق'); assert.equal(ar(11 * MIN), 'بعد 11 دقيقة'); assert.equal(ar(25 * MIN), 'بعد 25 دقيقة');
  assert.equal(ar(0), 'تبدأ الآن');
  assert.equal(formatCountdown(at(3 * MIN), 'ar', n => '٠١٢٣٤٥٦٧٨٩'[n]), 'بعد ٣ دقائق', 'the screen\'s own number format');
  assert.equal(formatCountdown(at(2 * MIN), 'ar', () => { throw new Error('dual has no number'); }), 'بعد دقيقتين');
});

test('countdown: only the server\'s clock decides. A device clock that is wrong by any amount changes nothing', () => {
  const start = T + 25 * MIN;
  for (const wrong of [0, 3 * HOUR, -3 * HOUR, 5 * 365 * DAY, -5 * 365 * DAY]) {
    const device = T + wrong, offset = serverClockOffset(T, device);
    assert.equal(serverTimeFrom(device, offset), T, 'at the moment of the answer');
    assert.equal(formatCountdown(countdownParts(start, serverTimeFrom(device, offset)), 'en'), 'in 25 min', 'wrong by ' + wrong);
    assert.equal(formatCountdown(countdownParts(start, serverTimeFrom(device + 10 * MIN, offset)), 'en'), 'in 15 min', 'ten minutes later on that same device');
    assert.equal(formatCountdown(countdownParts(start, serverTimeFrom(device + 25 * MIN, offset)), 'en'), 'starting now');
  }
});

test('countdown: the next update comes when the server\'s clock reaches a whole minute, so once a minute', () => {
  assert.equal(msToNextMinute(T), MIN); assert.equal(msToNextMinute(T + 1000), 59000); assert.equal(msToNextMinute(T + 59999), 1);
  assert.equal(msToNextMinute(-1000), 1000, 'before 1970 too: a device-independent number stays positive');
});

test('countdown on Home: the server\'s now, a calm line, in both looks, and not on a live class', () => {
  const view = read('frontend/features/teacher-home/home-view.tsx'), hook = read('frontend/features/teacher-home/use-server-now.ts');
  assert.match(view, /useServerNow\(data\.now\)/); assert.match(view, /\{!now && <Countdown as="p" startsAt=\{next\.startsAt\}/);
  assert.doesNotMatch(view, /Date\.now\(\)/, 'the screen never reads the device clock itself');
  assert.match(hook, /useState\(\(\) => Date\.parse\(serverNow\)\)/, 'the first render is the server\'s value');
  assert.match(read('frontend/styles/design-components.css'), /\.d-countdown \{[^}]*font-variant-numeric: tabular-nums/);
});

/** The real head script, in a small stand-in for a document. */
const runScript = (storage, setAttribute = () => {}) => vm.runInNewContext(firstOpenScript, { window: { sessionStorage: storage }, document: { documentElement: { setAttribute } } });
const memory = (start = {}) => { const data = new Map(Object.entries(start)); return { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, v), data }; };

test('the opening logo\'s head script: once per tab, one word in storage, safe without storage', () => {
  const store = memory(), seen = [];
  runScript(store, (name, value) => seen.push([name, value]));
  assert.deepEqual(seen, [[FIRST_OPEN_ATTRIBUTE, '1']], 'a new tab');
  assert.deepEqual([...store.data], [[FIRST_OPEN_KEY, '1']], 'no personal data');
  runScript(store, () => seen.push('again'));
  assert.equal(seen.length, 1, 'a reload in the same tab does not ask again');
  runScript({ getItem() { throw new Error('blocked'); } }, () => assert.fail('no storage: skipped, not repeated on every load'));
  runScript({ getItem: () => null, setItem() { throw new Error('quota'); } }, () => assert.fail('a flag that cannot be written: skipped, not repeated on every load'));
  assert.doesNotMatch(firstOpenScript, /[<>]/, 'nothing in it can close the script element');
});

test('the opening logo: in the root layout on every route, outside the keyed app tree, and the older landing splash is gone', () => {
  const layout = read('app/layout.tsx'), css = read('app/globals.css');
  assert.match(layout, /<head>[\s\S]*dangerouslySetInnerHTML=\{\{ __html: firstOpenScript \}\}[\s\S]*<\/head>\s*<body/);
  assert.match(layout, /<\/LanguageProvider>\s*<FirstOpenCurtain \/>/); assert.doesNotMatch(layout, /IntroSplash/); assert.equal(fs.existsSync('frontend/components/intro-splash.tsx'), false);
  assert.match(css, /\[data-first-open-curtain\] \{ display: none; \}/, 'hidden unless the script found a new tab, so no script means no logo');
  assert.match(css, /first-open-cap 0\.25s ease-out 6s forwards/, 'the stylesheet lifts it by itself');
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*html\[data-first-open\] \[data-first-open-curtain\] \{ animation-delay: 1\.5s; \}/);
});

test('the logo: no box anywhere, the placeholder tokens are gone, sign-in has no green panel behind it', () => {
  const tokens = read('frontend/styles/design-tokens.css'), components = read('frontend/styles/design-components.css');
  for (const gone of ['--d-logo-mark-bg', '--d-logo-mark-shadow', '--d-nav-active-bar']) { assert.doesNotMatch(tokens, new RegExp(gone), gone); assert.doesNotMatch(components, new RegExp(gone), gone); }
  const mark = components.match(/\.d-logo-mark \{[^}]*\}/)[0];
  assert.doesNotMatch(mark, /background|box-shadow|border-radius/);
  const form = read('frontend/features/auth/firebase-form.tsx');
  assert.doesNotMatch(form, /EduLabsMark[^>]*tone="ink"/); assert.doesNotMatch(form, /bg-primary p-6/);
  assert.doesNotMatch(read('frontend/components/loading-overlay.tsx'), /EduLabsMark[^>]*className="[^"]*\bbg-/);
});

test('New carries Classic\'s personality: the lime pill and edge, the rounded shapes', () => {
  const tokens = read('frontend/styles/design-tokens.css'), blocks = start => { const from = tokens.indexOf(start + ' {'); assert.ok(from >= 0, start); return tokens.slice(from, tokens.indexOf('\n}', from)); };
  const newLight = blocks('html[data-design="new"]'), classic = blocks(':root, html[data-design="classic"]');
  const value = (block, name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();
  for (const [name, expected] of [['--d-nav-active-bg', '#7FD959'], ['--d-nav-active-text', '#14301A'], ['--d-nav-active-shadow', '3px 3px 0 #2B6416'], ['--d-primary', '#7FD959'], ['--d-primary-shadow', '3px 3px 0 #2B6416'], ['--d-primary-active-transform', 'translate(3px, 3px)'], ['--d-tab-active-bg', '#7FD959']]) assert.equal(value(newLight, name), expected, name);
  for (const name of ['--d-radius-control', '--d-radius-field', '--d-radius-card', '--d-radius-hero', '--d-radius-nav', '--d-radius-badge']) assert.equal(value(newLight, name), value(classic, name), 'the same shape as Classic: ' + name);
  assert.equal(value(classic, '--d-primary-active-transform'), value(classic, '--d-active-transform'), 'Classic\'s press is what it was');
});

test('Motion: all of it is inside no-preference and starts with the New look, so reduced motion and Classic never see it', () => {
  const components = read('frontend/styles/design-components.css');
  const start = components.indexOf('@media (prefers-reduced-motion: no-preference) {'), end = components.indexOf('.d-toast { display');
  assert.ok(start > 0 && end > start);
  const block = components.slice(start, end);
  for (const rule of block.split('\n').map(l => l.trim()).filter(l => /\{.*\}$/.test(l) && !l.startsWith('@') && !l.startsWith('/*'))) assert.ok(rule.startsWith('html[data-design="new"]'), rule.slice(0, 90));
  // Times within 120 to 250 ms, apart from the 30 ms stagger and the shimmer, the one thing that repeats.
  for (const m of block.matchAll(/\b(\d+)ms\b/g)) { const ms = Number(m[1]); assert.ok((ms >= 120 && ms <= 250) || ms === 1400 || ms === 30, m[0]); }
  assert.equal((block.match(/infinite/g) || []).length, 1, 'only the shimmer loops');
  const hook = read('frontend/lib/motion.ts');
  assert.match(hook, /dataset\.design === 'new'/); assert.match(hook, /prefers-reduced-motion: reduce/);
  const bridge = read('frontend/styles/design-bridge.css');
  assert.match(bridge, /prefers-reduced-motion: no-preference\) \{\s*html\[data-design="new"\]:has\(\[data-teacher-shell\]\)/);
});

test('Homework, Exams and Reports: in the data as not-yet-links, in both languages', () => {
  const { messages } = load('frontend/locales/messages.ts');
  assert.deepEqual([...teacherNavSoon], ['homework', 'exams', 'reports']);
  for (const item of teacherNav) assert.equal(typeof item.href, 'string');
  assert.ok(!teacherNav.some(i => teacherNavSoon.includes(i.key)), 'an item is one or the other');
  assert.equal(messages.en['th.nav.soon'], 'Soon'); assert.equal(messages.ar['th.nav.soon'], 'قريبًا'); assert.equal(messages.en['th.nav.coming_soon'], 'Coming soon');
  const nav = read('frontend/features/teacher-home/teacher-nav.tsx');
  assert.match(nav, /role="link" aria-disabled="true" title=\{t\('th\.nav\.coming_soon'\)\}/); assert.doesNotMatch(nav.match(/teacherNavSoon\.map[\s\S]*?<\/span>\)\}/)[0], /tabIndex|href=/);
});

test('A toast only where the screen already confirms, and only as an addition to that', () => {
  const toast = read('frontend/lib/action-toast.tsx');
  assert.match(toast, /if \(!motionOn\(\)\) return;/); assert.match(toast, /aria-hidden="true"/);
  for (const [file, confirmed, said] of [
    ['frontend/features/teacher-settings/space-names.tsx', /data-space-saved/, /actionToast\(t\('ts\.space\.saved'\)\)/],
    ['frontend/features/teacher-students/invite.tsx', /data-made-link/, /actionToast\(t\('ts\.invite\.ready'\)\)/],
    ['frontend/features/teacher-students/requests.tsx', /data-request-notices/, /actionToast\(t\('ts\.requests\.rejected'\)\)/],
    ['frontend/features/teacher-attendance/attendance-view.tsx', /data-finished/, /actionToast\(t\('ta\.finished'\)\)/],
    ['frontend/features/teacher-course/course-view.tsx', /data-status-note/, /actionToast\(t\(target === 'published'/],
  ]) { const source = read(file); assert.match(source, confirmed, file); assert.match(source, said, file); }
});
