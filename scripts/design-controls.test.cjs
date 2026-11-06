// The owner's feedback after testing New: both looks stay, the credits and the teacher's footer, the menu that changes in place, the logo's contrast, no native controls, the finished attendance sheet.
// The browser side is in design-controls-checks.cjs, teacher-attendance-browser.cjs and settings-browser-components.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const localization = require('./localization-test-loader.cjs');
const { messages } = localization.load('frontend/locales/messages.ts');
const read = f => fs.readFileSync(f, 'utf8');
const tokens = read('frontend/styles/design-tokens.css'), components = read('frontend/styles/design-components.css');

function block(selector) {
  const at = tokens.indexOf('\n' + selector + ' {'); assert.ok(at >= 0, 'missing block ' + selector);
  const body = tokens.slice(tokens.indexOf('{', at) + 1, tokens.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--d-[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const classicLight = block(':root, html[data-design="classic"]'), newLight = block('html[data-design="new"]:has([data-teacher-shell])');
const sets = { 'Classic light': classicLight, 'Classic dark': { ...classicLight, ...block('html.dark:not([data-design="new"]), html.dark:not(:has([data-teacher-shell]))') }, 'New light': newLight, 'New dark': { ...newLight, ...block('html.dark[data-design="new"]:has([data-teacher-shell])') } };
const parse = value => {
  value = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(value); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i.exec(value); assert.ok(m, 'solid colour: ' + value);
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100, f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
};
const colour = (set, name) => parse(set['--d-' + name]);
const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const below = (need, pairs) => { const low = []; for (const [name, set] of Object.entries(sets)) for (const [fg, back] of pairs) { const ratio = contrast(colour(set, fg), colour(set, back)); if (ratio < need) low.push(`${name}: ${fg} on ${back} = ${ratio.toFixed(2)}`); } return low; };
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []);

test('both looks stay: nothing plans to delete one, and the switch is described as lasting', () => {
  assert.doesNotMatch(read('docs/ai/V1.md'), /delete the losing look/i);
  const decisions = read('docs/ai/DECISIONS.md');
  assert.match(decisions, /Both looks stay permanently/);
  for (const file of ['shared/design.ts', 'frontend/features/teacher-settings/design-settings.tsx', 'frontend/styles/design-bridge.css']) assert.doesNotMatch(read(file), /losing look|temporary/i, file);
  for (const language of ['en', 'ar']) assert.doesNotMatch(messages[language]['ds.design.help'], /^Try|^جرّب/, 'an invitation to compare is gone: ' + language);
  assert.match(read('frontend/features/teacher-settings/design-settings.tsx'), /lasting personal preference/);
});

test('the credits: the owner\'s order, one left-to-right run, the second name greyer than the first and AA on every background', () => {
  const footer = read('frontend/components/footer.tsx');
  assert.match(footer, /<bdi dir="ltr" data-credits><span data-credit="1"[^>]*>Mohamed Tamer Mohamed<\/span> &amp; <span data-credit="2"[^>]*>Mohamed Ahmed Yehia<\/span><\/bdi>/);
  assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /<FooterCredits \/>/);
  assert.doesNotMatch(read('frontend/features/teacher-frame/teacher-frame.tsx'), /Mohamed Ahmed Yehia/, 'one source for the names');
  assert.deepEqual(below(4.5, ['surface', 'canvas', 'phone-bar', 'raised'].flatMap(back => [['credit-1', back], ['credit-2', back]])), []);
  for (const [name, set] of Object.entries(sets)) assert.ok(contrast(colour(set, 'credit-1'), colour(set, 'surface')) > contrast(colour(set, 'credit-2'), colour(set, 'surface')), 'the second name is the quieter one: ' + name);
  assert.equal(sets['New light']['--d-credit-2'], sets['New light']['--d-meta'], 'New\'s meta colour');
  assert.equal(sets['New dark']['--d-credit-2'], sets['New dark']['--d-meta']);
  assert.match(components, /\.d-credit-1 \{ color: var\(--d-credit-1\); \}/); assert.match(components, /\.d-credit-2 \{ color: var\(--d-credit-2\); \}/);
});

test('the teacher\'s footer says where to get help; students keep their text; /support is a route the middleware allows', () => {
  const footer = read('frontend/components/footer.tsx');
  assert.match(footer, /audience = 'student'/, 'a student gets what they had unless the frame says otherwise');
  assert.match(footer, /audience === 'teacher' \? <><L id="footer\.teacher_help"\/>\{" "\}<a href="\/support"/);
  assert.match(footer, /<L id="dynamic\.platformHelp"\/>/, 'the student text is still there');
  assert.match(read('frontend/features/teacher-frame/teacher-frame.tsx'), /<Footer audience="teacher" \/>/);
  assert.equal(messages.en['footer.teacher_help'], 'Need help?'); assert.equal(messages.en['footer.teacher_help_link'], 'Contact EduLabs support');
  assert.ok(messages.ar['footer.teacher_help']); assert.match(messages.ar['footer.teacher_help_link'], /EduLabs/);
  assert.ok(messages.en['dynamic.platformHelp'].includes('authorized teacher'), 'the student wording is untouched');
  const { isPhaseOneRoute } = localization.load('shared/website-routes.ts');
  assert.equal(isPhaseOneRoute('/support'), true, 'the link goes somewhere real');
  assert.ok(footer.includes('dynamic.courseHelp') && footer.includes('dynamic.contactSoon'), 'the Soon items are left as they are');
});

test('the menu changes in place: no travelling indicator in the frame, 120 ms, only inside the motion block; the tab underline stays', () => {
  const frame = read('frontend/features/teacher-frame/teacher-frame.tsx');
  assert.doesNotMatch(frame, /useSlidingIndicator|d-slider/);
  assert.doesNotMatch(components, /d-slider--pill|d-slider--tab/);
  const motion = components.slice(components.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.match(motion, /\.d-nav:not\(\.d-nav--soon\)::before[^}]*opacity: 0; transform: scale\(0\.97\);[^}]*transition: opacity 120ms ease-out, transform 120ms ease-out/);
  assert.match(read('frontend/components/design/tabs.tsx'), /useSlidingIndicator/);
  assert.doesNotMatch(components.slice(0, components.indexOf('@media (prefers-reduced-motion: no-preference)')), /\.d-nav::before/, 'without motion the pill stays on the item');
});

test('the logo: one mark, its colour from a token in every set, at least 3:1 on everything it sits on, the shape unchanged', () => {
  const mark = read('frontend/components/edulabs-mark.tsx');
  assert.match(mark, /var\(--d-logo-tree, #2b6416\)/); assert.doesNotMatch(mark, /#7ed957/i, 'no fixed light green any more');
  assert.deepEqual(below(3, [['logo-tree', 'canvas'], ['logo-tree', 'surface'], ['logo-tree', 'sidebar'], ['logo-tree', 'phone-bar']]), []);
  assert.equal(sets['New light']['--d-logo-tree'], '#2B6416'); assert.equal(sets['Classic light']['--d-logo-tree'], '#2B6416');
  assert.equal(sets['New dark']['--d-logo-tree'], '#7ED957'); assert.equal(sets['Classic dark']['--d-logo-tree'], '#7ED957');
  // The overlay and sign-in stand on --background and --card, not on the design tokens.
  const hsl = (file, name) => { const m = new RegExp(`${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`).exec(read(file)); return parse(`hsl(${m[1]} ${m[2]}% ${m[3]}%)`); };
  assert.ok(contrast(parse('#2B6416'), hsl('app/globals.css', '--background')) >= 3, 'deep green on the light page');
  assert.ok(contrast(parse('#2B6416'), hsl('app/globals.css', '--card')) >= 3, 'deep green on a light card');
  assert.ok(contrast(parse('#7ED957'), hsl('frontend/styles/appearance.css', '--background')) >= 3, 'light green on the dark page');
  assert.ok(contrast(parse('#7ED957'), hsl('frontend/styles/appearance.css', '--card')) >= 3, 'light green on a dark card');
});

test('switches and choices can be told apart: both states at 3:1 in both looks and themes; every set has the same new tokens', () => {
  const names = ['logo-tree', 'credit-1', 'credit-2', 'switch-on', 'switch-on-thumb', 'switch-on-border', 'switch-off', 'switch-off-thumb', 'switch-off-border', 'choice-on-bg', 'choice-on-text', 'choice-on-border', 'choice-on-shadow', 'choice-mark'];
  for (const [set, values] of Object.entries(sets)) for (const name of names) assert.ok(values['--d-' + name], `${set}: --d-${name}`);
  assert.deepEqual(below(3, [['switch-on-thumb', 'switch-on'], ['switch-off-thumb', 'switch-off'], ['switch-on-border', 'surface'], ['switch-on-border', 'canvas'], ['switch-off-border', 'surface'], ['switch-off-border', 'canvas']]), []);
  assert.deepEqual(below(4.5, [['choice-on-text', 'choice-on-bg']]), []);
});

test('no native checkbox, radio or select in the teacher area or the shared settings, notifications and support screens', () => {
  const scope = ['frontend/features/teacher-attendance', 'frontend/features/teacher-course', 'frontend/features/teacher-frame', 'frontend/features/teacher-groups', 'frontend/features/teacher-helper', 'frontend/features/teacher-home', 'frontend/features/teacher-settings', 'frontend/features/teacher-students', 'frontend/features/personalization', 'frontend/features/notifications', 'frontend/features/support', 'frontend/components/design'];
  const found = [];
  for (const dir of scope) for (const file of walk(dir)) {
    const source = read(file);
    for (const native of [/<select\b/, /as="select"/, /type=["']checkbox["']/, /type=["']radio["']/]) if (native.test(source)) found.push(`${file}: ${native}`);
  }
  assert.deepEqual(found, []);
});

test('the controls promise what a screen reader and a keyboard need', () => {
  const controls = read('frontend/components/design/controls.tsx');
  assert.match(controls, /role="switch" aria-checked=\{checked\} aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(controls, /<button type="button" role="switch"/, 'a real button: Space and Enter come with it');
  assert.match(controls, /role="radiogroup"/); assert.match(controls, /role="radio" aria-checked=\{option === value\}/);
  assert.match(controls, /role="combobox" aria-haspopup="listbox"/); assert.match(controls, /role="listbox"/); assert.match(controls, /role="option" aria-selected/); assert.match(controls, /aria-activedescendant/);
  assert.match(components, /\.d-switch \{[^}]*min-height: var\(--d-target\); min-width: var\(--d-target\)/, '44 px');
  assert.match(components, /\.d-choice \{[^}]*min-height: var\(--d-target\)/); assert.match(components, /\.d-select-option \{[^}]*min-height: var\(--d-target\)/);
  assert.match(components, /html\[dir="rtl"\] \.d-switch\[aria-checked="true"\] \.d-switch-thumb/, 'mirrored');
  assert.match(components, /\.d-switch:focus-visible, \.d-choice:focus-visible, \.d-select:focus-visible/);
  const motion = components.slice(components.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.match(motion, /html\[data-design="new"\] \.d-switch-thumb \{ transition: transform 120ms ease-out; \}/);
  assert.doesNotMatch(components.slice(0, components.indexOf('@media (prefers-reduced-motion: no-preference)')), /\.d-switch-thumb \{[^}]*transition/, 'Classic and reduced motion do not animate it');
});

test('Notifications: the switches call the same handlers, browser push is one switch, and it starts from what the browser has', () => {
  const view = read('frontend/features/notifications/notifications-view.tsx');
  assert.match(view, /data-browser-push checked=\{pushOn===true\}/); assert.match(view, /onChange=\{next=>void push\(next\)\.then\(readPush\)\}/);
  assert.match(view, /getRegistration\(\)/); assert.doesNotMatch(view, /useEffect\(\(\)=>\{[^}]*requestPermission/, 'looking asks for no permission');
  assert.match(view, /preference\(event,next,p\?\.push\?\?false\)/); assert.match(view, /preference\(event,p\?\.in_app\?\?true,next\)/);
  assert.ok(messages.en['notifications.browser_push'] && messages.ar['notifications.browser_push']);
  assert.equal(messages.en['notifications.enable_browser_push'], undefined, 'one switch, not two buttons');
});

test('the finished attendance sheet: the header on a desktop, a floating bar on a phone, safe-area padding; the white band cannot come back', () => {
  const view = read('frontend/features/teacher-attendance/attendance-view.tsx');
  assert.match(view, /data-header-actions/); assert.match(view, /canEdit && phone \? 'd-float-bar'/);
  assert.match(view, /aria-describedby=\{editHint\} title=\{t\('ta\.edit_needs_reason'\)\}/);
  const bar = components.match(/\.d-float-bar \{[^}]*\}/)[0];
  assert.match(bar, /position: fixed/); assert.match(bar, /env\(safe-area-inset-bottom\)/);
  assert.match(components, /\[data-teacher-attendance\] \[data-actions\] \{ background: transparent !important;/);
});
