// Stylesheet for the browser harnesses, built from the CURRENT sources instead of whatever `.next/static/css` a previous build left behind:
// a stale build is missing every class and rule added since (a transparent "yellow" button, a dark-mode rule that is not there), and the
// harness then fails (or worse, passes) for a reason that has nothing to do with the app. The `.next` stylesheet is still read for the font
// faces; this is appended after it, so the current rules win.
//   1. Tailwind compile of app/globals.css with the repository config (the same input the build uses);
//   2. the plain CSS files app/layout.tsx imports after it (appearance, language), in the same order.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
let cached = null;
module.exports = function harnessCss() {
  if (cached) return cached;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lms-css-')), 'globals.css');
  cp.execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'), '-i', 'app/globals.css', '-o', out], { stdio: ['ignore', 'ignore', 'ignore'] });
  const layout = fs.readFileSync('app/layout.tsx', 'utf8');
  const extra = [...layout.matchAll(/^import '([^']+\.css)';/gm)].map(m => m[1]).filter(p => p !== './globals.css')
    .map(p => path.resolve(p.startsWith('@/') ? p.slice(2) : path.join('app', p))).map(p => fs.readFileSync(p, 'utf8'));
  // For scripts/classic-visual-compare.cjs only: the old frame's geometry, so that the content can be compared with screenshots taken before the frame moved.
  if (process.env.LMS_CLASSIC_OLD_GEOMETRY) extra.push(`
    :root, html[data-design="classic"] { --d-sidebar-width: 288px; --d-header-height: ${process.env.LMS_CLASSIC_OLD_GEOMETRY}px; }
    @media (min-width: 768px) { .d-main { padding-top: 16px; } .d-main-inner { padding: 32px; } }
    .d-main > div.hidden { display: none !important; } /* the earlier harnesses did not render the footer */
    @media (max-width: 767px) { .d-main { padding-top: 8px; padding-bottom: 0; min-height: 100vh; } .d-bottom-tabs, .d-phone-footer { display: none !important; } }
    @media (min-width: 640px) and (max-width: 767px) { .d-main-inner { padding: 24px; } }
  `);
  cached = [fs.readFileSync(out, 'utf8'), ...extra].join('\n');
  return cached;
};
