// Local speed measurement of a PRODUCTION build (`next start`) against fictional services on loopback.
//   node scripts/speed/measure.cjs --dist .next-speed --label after --memo on --google-ms 120 --supabase-ms 25 --runs 7 --out result.json
// What it measures: the server and client path of our code. The fictional Supabase has no SQL time (that is measured against a
// disposable PostgreSQL, see supabase/tests/*benchmark.sql); the fictional Google answers the revocation lookup after --google-ms.
// Round-trip COUNTS per page and action are exact and carry over to staging; milliseconds depend on the delays you pass.
// Nothing here uses a real project, token, key or customer record.
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { startFakeGoogle } = require('./fake-google.cjs'), { startFakeSupabase, uuid } = require('./fake-supabase.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const dist = arg('dist', '.next-speed'), label = arg('label', 'run'), memo = arg('memo', 'on'), runs = Number(arg('runs', 7));
const googleMs = Number(arg('google-ms', 0)), supabaseMs = Number(arg('supabase-ms', 0)), outFile = arg('out', '');
const SUPABASE_PORT = 54399, APP_PORT = 3399, ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const google = await startFakeGoogle({ keysDir: path.resolve('.local/speed/keys'), latencyMs: googleMs });
  const supabase = await startFakeSupabase({ latencyMs: supabaseMs, port: SUPABASE_PORT });
  const env = {
    ...process.env, NODE_ENV: 'production', EDULABS_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_AUTH_BACKEND: 'firebase-staging', LMS_DATA_BACKEND: 'supabase-staging',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyFictionalLocalSpeedHarness000000000000', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'speed-harness.invalid',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'speed-harness', NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:speedharness',
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_speedharness',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_ZmljdGlvbmFsLnNwZWVkLmhhcm5lc3MuaW52YWxpZCQ', CLERK_SECRET_KEY: 'sk_test_fictional',
    APP_ORIGIN: ORIGIN, LMS_SERVER_TIMING: '1', LMS_DISABLE_REQUEST_MEMO: memo === 'off' ? '1' : '0',
    SPEED_FAKE_GOOGLE_PORT: String(google.port), GOOGLE_APPLICATION_CREDENTIALS: google.credentialPath,
    NODE_OPTIONS: `--require ${path.resolve('scripts/speed/preload.cjs')}`,
  };
  delete env.FIREBASE_AUTH_EMULATOR_HOST; delete env.FIREBASE_CLIENT_EMAIL; delete env.FIREBASE_PRIVATE_KEY;
  const server = spawn(process.execPath, ['--require', './scripts/windows-filesystem.cjs', './node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(APP_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(ORIGIN + '/api/health')).status < 500) break; } catch { /* not up yet */ }
      if (i > 120) throw Error('server did not start\n' + log);
      await sleep(500);
    }
    const cookieName = '__Host-lms-firebase-id', headers = () => ({ cookie: `${cookieName}=${google.mintToken('speed-teacher')}` });
    const post = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    const F = supabase.fixtures(), g = F.groups[0], session = F.sessions[g.id][0], offering = F.offerings[0], course = F.courses[0];
    const page = p => ({ kind: 'page', path: p });
    const api = (p, body, method = 'POST') => ({ kind: 'api', path: p, body, method });
    const scenarios = [
      ['Home (/home)', page('/home')],
      ['Groups list', page('/teacher/groups')],
      ['One Group', page('/teacher/groups/' + g.id)],
      ['Students', page('/teacher/students')],
      ['Take attendance', page(`/teacher/groups/${g.id}/attendance/${session.id}`)],
      ['Settings > Courses', page('/teacher/settings/courses')],
      ['Course page', page('/teacher/settings/courses/' + course.id)],
      ['API: Groups list read', api('/api/study-groups', { action: 'view', groupId: null, version: null, data: { section: 'summary', page: 0 } })],
      ['API: Group tab (sessions)', api('/api/study-groups', { action: 'view', groupId: g.id, version: null, data: { section: 'sessions', page: 0 } })],
      ['API: attendance save (1 mark)', () => api('/api/study-groups', { action: 'attendance', groupId: g.id, version: null, data: { sessionId: session.id, sessionVersion: supabase.fixtures().sessions[g.id][0].version, marks: [{ userId: supabase.fixtures().members[g.id][0].user_id, status: 'attended' }] } })],
      ['API: student search', api('/api/student-administration', { action: 'roster', data: { page: 0, search: 'student 1', filter: 'all' }, offeringId: offering.id })],
      ['API: approve join request', api('/api/student-administration', { action: 'approve', data: { expiresAt: null }, offeringId: offering.id, subjectId: uuid(6101), version: 1, requestId: uuid(4242) })],
      ['API: publish course', () => api('/api/teacher/courses/' + course.id, { updated_at: supabase.fixtures().courses[0].updated_at, status: 'published' }, 'PATCH')],
      ['API: create Group', api('/api/study-groups', { action: 'create', groupId: null, version: null, data: { offeringId: offering.id, definition: { name: 'Synthetic new group', description: '', mode: 'center', location: 'Room', joinUrl: '', instructions: '', capacity: 20, schedules: [{ weekday: 2, time: '17:00', durationMinutes: 60 }] } } })],
    ];
    const results = [];
    for (const [name, spec] of scenarios) {
      const samples = [], upstream = [], timings = [], statuses = new Set();
      for (let i = 0; i < runs + 1; i++) {
        const s = typeof spec === 'function' ? spec() : spec;
        supabase.resetCounts(); const g0 = { ...google.stats };
        const started = performance.now();
        const response = await fetch(ORIGIN + s.path, s.kind === 'page' ? { headers: headers(), redirect: 'manual' } : { method: s.method, headers: { ...headers(), ...post }, body: JSON.stringify(s.body) });
        const text = await response.text();
        const ms = performance.now() - started;
        statuses.add(response.status);
        if (i === 0) continue; // warm-up
        samples.push(ms);
        upstream.push({ google: google.stats.lookups - g0.lookups, supabase: supabase.counts() });
        const header = response.headers.get('server-timing');
        const marker = /<script type="application\/json" id="lms-server-timing">(.*?)<\/script>/s.exec(text);
        timings.push(header || (marker ? JSON.parse(marker[1].replace(/\\u003c/g, '<')) : null));
      }
      const mid = upstream[Math.floor(upstream.length / 2)];
      results.push({ name, statuses: [...statuses], ms: Math.round(median(samples)), min: Math.round(Math.min(...samples)), googleLookups: mid.google, supabaseCalls: Object.values(mid.supabase).reduce((a, b) => a + b, 0), supabaseByName: mid.supabase, timing: timings[Math.floor(timings.length / 2)] });
    }
    const report = { label, memo, googleMs, supabaseMs, runs, node: process.version, results, certFetches: google.stats.certs };
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
    const pad = (v, n) => String(v).padEnd(n);
    console.log(`\n${label}: memo=${memo} google=${googleMs}ms supabase=${supabaseMs}ms runs=${runs} (median ms; upstream calls per request)`);
    console.log(pad('scenario', 34) + pad('status', 8) + pad('ms', 7) + pad('google', 8) + pad('supabase', 9) + 'by name');
    for (const r of results) console.log(pad(r.name, 34) + pad(r.statuses.join('/'), 8) + pad(r.ms, 7) + pad(r.googleLookups, 8) + pad(r.supabaseCalls, 9) + Object.entries(r.supabaseByName).map(([k, v]) => `${k}x${v}`).join(' '));
    console.log('certificate fetches (should be 1: keys are cached):', google.stats.certs);
  } finally {
    server.kill(); await google.close(); await supabase.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
