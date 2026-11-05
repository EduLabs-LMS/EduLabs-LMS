// Classic visual check: compares a harness's screenshots with the ones the same harness took on the commit before the design foundation.
//   1. On the earlier commit: run a harness and keep its .local/<harness>-browser/screenshots folder as the baseline.
//   2. Here: run the same harness with LMS_CLASSIC_OLD_GEOMETRY=1. The frame moved on purpose (owner decision b: the structure changes apply to both looks), so
//      harness-css.cjs puts the content back where the old frame had it, which leaves anything else that changed to be found by this comparison.
//   3. node scripts/classic-visual-compare.cjs <baselineDir> <currentDir> <diffDir>
// The frame itself is left out of the comparison (the sidebar column on a desktop, the header band on a phone). Prints one line per screenshot and writes an image of what differs.
const fs = require('fs'), path = require('path');
const browserRuntime = process.env.LMS_BROWSER_RUNTIME;
if (!browserRuntime) throw Error('Set LMS_BROWSER_RUNTIME to existing Playwright tooling');
const { chromium } = require(path.join(browserRuntime, 'playwright'));
const [baseDir, nowDir, diffDir] = process.argv.slice(2);
if (!baseDir || !nowDir || !diffDir) throw Error('Usage: classic-visual-compare.cjs <baselineDir> <currentDir> <diffDir>');
fs.mkdirSync(diffDir, { recursive: true });
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LMS_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  const names = fs.readdirSync(baseDir).filter(f => f.endsWith('.png')).sort();
  const rows = [];
  for (const name of names) {
    const now = path.join(nowDir, name);
    if (!fs.existsSync(now)) { rows.push({ name, missing: true }); continue; }
    const result = await page.evaluate(async ({ a, b, rtl }) => {
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const [x, y] = await Promise.all([load(a), load(b)]);
      const width = Math.min(x.width, y.width), height = Math.min(x.height, y.height), phone = x.width < 768;
      const read = i => { const c = document.createElement('canvas'); c.width = width; c.height = height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); return g.getImageData(0, 0, width, height); };
      const p = read(x), q = read(y);
      const out = document.createElement('canvas'); out.width = width; out.height = height; const g = out.getContext('2d'); const mark = g.createImageData(width, height);
      const skipX = phone ? [0, 0] : rtl ? [width - 292, width] : [0, 292], skipY = phone ? 72 : 0;
      let differ = 0, total = 0, top = height, bottom = -1;
      for (let row = skipY; row < height; row++) for (let col = 0; col < width; col++) {
        if (col >= skipX[0] && col < skipX[1]) continue;
        total++;
        const at = (row * width + col) * 4, far = Math.abs(p.data[at] - q.data[at]) + Math.abs(p.data[at + 1] - q.data[at + 1]) + Math.abs(p.data[at + 2] - q.data[at + 2]);
        const m = (row * width + col) * 4; mark.data[m + 3] = 255; mark.data[m] = mark.data[m + 1] = mark.data[m + 2] = 255;
        if (far > 24) { differ++; mark.data[m] = 220; mark.data[m + 1] = mark.data[m + 2] = 0; if (row < top) top = row; if (row > bottom) bottom = row; }
      }
      g.putImageData(mark, 0, 0);
      return { sizeA: [x.width, x.height], sizeB: [y.width, y.height], differ, total, top, bottom, png: differ ? out.toDataURL('image/png') : null };
    }, { a: dataUrl(path.join(baseDir, name)), b: dataUrl(now), rtl: /(^|-)ar(-|\.)|arabic|rtl/i.test(name) });
    if (result.png) fs.writeFileSync(path.join(diffDir, name), Buffer.from(result.png.split(',')[1], 'base64'));
    rows.push({ name, ...result, png: undefined });
  }
  await browser.close();
  rows.sort((a, b) => (b.differ || 0) / (b.total || 1) - (a.differ || 0) / (a.total || 1));
  let same = 0;
  for (const r of rows) {
    if (r.missing) { console.log('MISSING ', r.name); continue; }
    if (!r.differ) { same++; continue; }
    console.log(`${(100 * r.differ / r.total).toFixed(3).padStart(7)}%  y ${r.top}-${r.bottom}  ${r.sizeA.join('x')} vs ${r.sizeB.join('x')}  ${r.name}`);
  }
  console.log(`${same} of ${rows.length} screenshots are identical outside the frame.`);
})().catch(e => { console.error(e); process.exit(1); });
