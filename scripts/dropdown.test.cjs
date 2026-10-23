// Our own dropdown replaces the browser's native <select> everywhere except the script-free public teacher site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, React, Date, Array, Math, document: {},
    require: name => (name in dependencies ? dependencies[name] : require(name)) });
  return module.exports;
}
const dropdown = load('frontend/components/ui/dropdown-select.tsx', { '@/shared/utils': { cn: (...a) => a.filter(Boolean).join(' ') } });
const h = React.createElement;

test('options are read from plain options, fragments and arrays, with the text as the value when none is given', () => {
  const opts = dropdown.collectOptions([h('option', { key: 1, value: 'a' }, 'Alpha'), h(React.Fragment, { key: 2 }, h('option', { value: '' }, 'None'), h('option', { value: 'c', disabled: true }, 'Charlie')), [h('option', { key: 4 }, 'Delta')], false, null]);
  assert.equal(JSON.stringify(opts.map(o => [o.value, o.text, o.disabled])), JSON.stringify([['a', 'Alpha', false], ['', 'None', false], ['c', 'Charlie', true], ['Delta', 'Delta', false]]));
});

test('arrow keys skip disabled options and wrap around; nothing is chosen when everything is disabled', () => {
  const opts = [{ disabled: false }, { disabled: true }, { disabled: false }];
  assert.equal(dropdown.stepIndex(opts, 0, 1), 2);
  assert.equal(dropdown.stepIndex(opts, 2, 1), 0);
  assert.equal(dropdown.stepIndex(opts, 0, -1), 2);
  assert.equal(dropdown.stepIndex(opts, -1, 1), 0);
  assert.equal(dropdown.stepIndex([{ disabled: true }], 0, 1), -1);
});

test('closed, it shows the chosen label as an accessible combobox, with no options in the page', () => {
  const html = renderToStaticMarkup(h(dropdown.Dropdown, { value: 'b', 'aria-label': 'Pick', className: 'field' }, h('option', { value: 'a' }, 'Alpha'), h('option', { value: 'b' }, 'Bravo')));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Pick"/);
  assert.match(html, /Bravo/);
  assert.doesNotMatch(html, /Alpha|role="option"/);
});

test('uncontrolled use keeps a form value in a hidden field, and required stays checkable', () => {
  const html = renderToStaticMarkup(h(dropdown.Dropdown, { name: 'stage', defaultValue: 's2', required: true }, h('option', { value: '' }, 'All'), h('option', { value: 's2' }, 'Stage two')));
  assert.match(html, /<input type="hidden" name="stage" value="s2"/);
  assert.match(html, /required=""/);
  assert.match(html, /Stage two/);
});

test('no native <select> is left in the app, except in the standalone public teacher site that runs without scripts', () => {
  const left = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); }
      else if (full.endsWith('.tsx') && /<select\b/.test(fs.readFileSync(full, 'utf8'))) left.push(full);
    }
  })('frontend');
  walkApp('app');
  function walkApp(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkApp(full);
      else if (full.endsWith('.tsx') && /<select\b/.test(fs.readFileSync(full, 'utf8'))) left.push(full);
    }
  }
  assert.equal(left.filter(f => !f.endsWith('public-website/teacher-site.tsx') && !f.endsWith('dropdown-select.tsx')).join(','), '');
});

test('the dropdown opens with an animation and works from the keyboard', () => {
  const source = fs.readFileSync('frontend/components/ui/dropdown-select.tsx', 'utf8');
  for (const part of ['data-[state=open]:animate-in', 'data-[state=closed]:animate-out', 'zoom-in-95', 'transition-transform', "e.key === 'ArrowDown'", "e.key === 'Enter'", 'typed.current', 'aria-activedescendant']) assert.ok(source.includes(part), 'missing ' + part);
});

test('student pages use the shared look: search and progress filter on Self-learning, a plain welcome header instead of the placeholder carousel', () => {
  const learning = fs.readFileSync('frontend/features/self-learning/self-learning-view.tsx', 'utf8');
  for (const part of ['SearchField', 'FilterPills', 'filterChapters', 'm-list', 'PageHeader', 'aria-expanded']) assert.ok(learning.includes(part), 'missing ' + part);
  const home = fs.readFileSync('frontend/features/dashboard/student-home.tsx', 'utf8');
  assert.doesNotMatch(home, /heroSlides|unsplash/i);
  assert.match(home, /<PageHeader/);
});
