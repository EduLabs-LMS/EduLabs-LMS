// Every teacher screen in Classic and New, light and dark, English and Arabic, desktop and phone: a screenshot of each, and a measurement of what a
// screenshot cannot prove (WCAG AA text and control contrast, 44 px targets, no sideways scroll, right-to-left). Synthetic harness data only.
// A harness runs it as its last step with LMS_MATRIX=1. Pictures go to .local/design-screens/<screen>/<look>-<theme>-<lang>-<size>.png.
const fs = require('fs'), path = require('path');

const LOOKS = ['classic', 'new'], THEMES = ['light', 'dark'], LANGS = ['en', 'ar'];
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const ROOT = path.join(process.cwd(), '.local', 'design-screens');

// Runs in the page. Colours go through a canvas so any CSS colour syntax comes back as sRGB.
const audit = () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = c => { const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Everything an element may stand on, by walking outwards: one colour, or each stop of a gradient (the worst one counts). A picture cannot be read this way, so the answer is null: "not measured", never "passed".
  const behind = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage.includes('url(')) return null;
      const stops = s.backgroundImage === 'none' ? [] : (s.backgroundImage.match(/(?:rgba?|color|oklch|oklab|hsla?)\([^)]*\)/g) ?? []).map(rgba);
      if (s.backgroundImage !== 'none' && !stops.length) return null;
      if (stops.length) layers.push(stops);
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) { layers.push([c]); if (c[3] === 1) break; }
    }
    let bases = [[255, 255, 255, 1]];
    for (const options of layers.reverse()) bases = bases.flatMap(base => options.map(c => over(c, base)));
    return bases.slice(0, 16);
  };
  const roots = [document.querySelector('main'), ...document.querySelectorAll('[role="dialog"], [role="menu"], [data-sticky-primary]')].filter(Boolean);
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const quiet = el => el.closest('[aria-hidden="true"], .sr-only, [disabled], [aria-disabled="true"], [data-skeleton]');
  const text = [], unmeasured = new Set(), targets = [], controls = [];
  for (const root of roots) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const el = node.parentElement, words = node.textContent.trim();
      if (!words || !el || quiet(el) || !visible(el)) continue;
      const s = getComputedStyle(el), bg = behind(el);
      if (!bg) { unmeasured.add(words.slice(0, 30)); continue; }
      const size = parseFloat(s.fontSize), large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const worst = bg.map(b => ({ b, r: ratio(over(rgba(s.color), b), b) })).sort((x, y) => x.r - y.r)[0];
      if (worst.r < (large ? 3 : 4.5)) text.push(`${words.slice(0, 30)} | ${worst.r.toFixed(2)} | ${s.color} on ${worst.b.slice(0, 3).map(Math.round).join(',')}`);
      if (size < 12) text.push(`${words.slice(0, 30)} | ${size}px is below the 12 px minimum`);
    }
    for (const el of root.querySelectorAll('a, button, input, select, textarea, [role="switch"], [role="radio"], [role="combobox"], [role="tab"], [role="menuitem"]')) {
      if (!visible(el) || el.closest('.d-group-link') || el.matches('.d-group-link') || getComputedStyle(el).display === 'inline') continue;
      const b = el.getBoundingClientRect();
      if (b.height < 43.5 || b.width < 43.5) targets.push(`${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)} | ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    // A control's own edge has to be seen: 3:1 against what is around it, by the border or by its fill (WCAG 1.4.11).
    for (const el of root.querySelectorAll('.d-field-input, .d-select, .d-switch-track, .d-textarea')) {
      if (!visible(el) || quiet(el)) continue;
      const around = behind(el.parentElement); if (!around) continue;
      const s = getComputedStyle(el), width = parseFloat(s.borderTopWidth);
      const best = Math.min(...around.map(a => Math.max(width > 0 ? ratio(over(rgba(s.borderTopColor), a), a) : 0, ratio(over(rgba(s.backgroundColor), a), a))));
      if (best < 3) controls.push(`${el.className.toString().slice(0, 30)} | ${best.toFixed(2)}`);
    }
  }
  return {
    text: Array.from(new Set(text)), targets: Array.from(new Set(targets)), controls: Array.from(new Set(controls)), unmeasured: Array.from(unmeasured),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    dir: document.documentElement.dir, design: document.documentElement.dataset.design, dark: document.documentElement.classList.contains('dark'),
  };
};

/**
 * @param open ({ viewport, lang, theme, look, target }) => Promise<{ page, context }>: the harness's own way to open a page.
 * @param screens [{ name, target, ready, act?, sizes? }]: `target` is what `open` needs; `ready` a selector; `act(page)` runs before the picture (open a tab, a dialog).
 * @returns every finding, one line each, so the harness can fail on them.
 */
async function shootMatrix({ open, screens, label }) {
  const findings = [], listed = [], notMeasured = new Set();
  for (const screen of screens) {
    const dir = path.join(ROOT, screen.name); fs.mkdirSync(dir, { recursive: true });
    for (const look of LOOKS) for (const theme of THEMES) for (const lang of LANGS) for (const size of screen.sizes ?? Object.keys(SIZES)) {
      const tag = `${look}-${theme}-${lang}-${size}`, file = path.join(dir, tag + '.png');
      const { page, context } = await open({ viewport: SIZES[size], lang, theme, look, target: screen.target });
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator(screen.ready).first().waitFor();
        await page.evaluate(l => { document.documentElement.dataset.design = l; if (!document.querySelector('[data-teacher-shell]')) document.querySelector('main')?.setAttribute('data-teacher-shell', ''); }, look);
        if (screen.act) await screen.act(page);
        await page.waitForFunction(t => (t === 'dark') === document.documentElement.classList.contains('dark'), theme);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { document.getAnimations().forEach(a => { try { a.finish(); } catch {} }); r(); }))));
        const result = await page.evaluate(audit);
        const at = `${screen.name} ${tag}`;
        if (result.design !== look) findings.push(`${at}: the page is not in ${look}`);
        if (lang === 'ar' && result.dir !== 'rtl') findings.push(`${at}: not right-to-left`);
        if (result.overflow) findings.push(`${at}: sideways scroll`);
        for (const f of result.text) findings.push(`${at}: text ${f}`);
        for (const f of result.targets) findings.push(`${at}: target ${f}`);
        for (const f of result.controls) findings.push(`${at}: control edge ${f}`);
        for (const f of result.unmeasured) notMeasured.add(`${screen.name}: ${f}`);
        await page.screenshot({ path: file, fullPage: true });
        listed.push(path.relative(process.cwd(), file).split(path.sep).join('/'));
      } catch (e) { findings.push(`${screen.name} ${tag}: could not be drawn: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
      finally { await context.close(); }
    }
    console.log('matrix', screen.name);
  }
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, `audit-${label}.json`), JSON.stringify({ screens: screens.map(s => s.name), pictures: listed, findings, notMeasured: Array.from(notMeasured) }, null, 1));
  return findings;
}

module.exports = { shootMatrix };
