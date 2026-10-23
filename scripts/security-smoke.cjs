// Run against a locally started production build. No credentials or writes.
const assert = require('node:assert/strict');
const base = process.env.SECURITY_SMOKE_URL || 'http://localhost:3108';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Local server required');

async function request(path, headers = {}) {
  return fetch(`${base}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
}
async function main() {
  let passed = 0;
  for (const path of ['/sign-in', '/sign-up']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /clerk/i);
    passed++;
  }
  for (const path of ['/home', '/self-learning', '/admin/users']) {
    const response = await request(path, { accept: 'text/html' });
    assert.equal(response.status, 307, path);
    assert.ok(response.headers.get('location'));
    passed++;
  }
  for (const headers of [{}, { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' }]) {
    const response = await request('/api/courses/dashboard', headers);
    assert.equal(response.status, 404, 'Clerk protects unauthenticated non-document requests');
    passed++;
  }
  const upload = await request('/api/uploadthing');
  assert.equal(upload.status, 200);
  const routes = await upload.json();
  assert.ok(Array.isArray(routes) && routes.some(route => route.slug === 'homeworkSubmission'));
  passed++;
  const sharp = require('sharp');
  assert.ok((await sharp({ create: { width: 2, height: 2, channels: 4, background: '#fff' } }).png().toBuffer()).length > 0);
  passed++;
  const { AccessToken } = require('livekit-server-sdk');
  const token = new AccessToken('test-key', 'test-secret-for-local-signing-only', { identity: 'test-student' });
  token.addGrant({ room: 'test-room', roomJoin: true });
  const claims = JSON.parse(Buffer.from((await token.toJwt()).split('.')[1], 'base64url').toString());
  assert.equal(claims.sub, 'test-student');
  assert.equal(claims.video.room, 'test-room');
  passed++;
  console.log(`Security runtime smoke: ${passed} checks passed. Signed-in workflows require separate accounts.`);
}
main().catch(error => { console.error(`Security smoke failed: ${error.message}`); process.exitCode = 1; });
