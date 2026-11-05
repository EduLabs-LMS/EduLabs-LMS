// Fictional Google endpoints for the local speed measurement: ID-token certificates, the Identity Toolkit user lookup
// (the Firebase revocation check) and the service-account token endpoint. Fictional keys are generated per run with openssl.
// Nothing here talks to a real Firebase project.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function makeKeys(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=speed-harness', '-days', '30'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
}

async function startFakeGoogle({ keysDir, projectId = 'speed-harness', latencyMs = 0 }) {
  const keys = makeKeys(keysDir), kid = 'speed-key-1';
  const stats = { certs: 0, lookups: 0, tokens: 0 };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const host = req.headers['x-fake-host'] || '', url = new URL(req.url, 'http://x');
    const send = (obj, status = 200, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (url.pathname.startsWith('/robot/v1/metadata/x509/')) { stats.certs++; await sleep(latencyMs); return send({ [kid]: keys.cert }, 200, { 'cache-control': 'public, max-age=19000, must-revalidate, no-transform' }); }
    if (/\/accounts:lookup$/.test(url.pathname)) {
      stats.lookups++; await sleep(latencyMs);
      const ids = JSON.parse(body || '{}').localId || [];
      return send({ users: ids.map(localId => ({ localId, email: localId + '@speed-harness.invalid', emailVerified: true, validSince: '1', disabled: false, lastLoginAt: '1', createdAt: '1' })) });
    }
    if (/\/token$/.test(url.pathname) || /oauth2/.test(url.pathname)) { stats.tokens++; await sleep(latencyMs); return send({ access_token: 'fictional-access-token', expires_in: 3599, token_type: 'Bearer' }); }
    send({ error: 'fictional google: not served ' + host + url.pathname }, 404);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const serviceAccount = { type: 'service_account', project_id: projectId, private_key_id: 'speed1', private_key: keys.key, client_email: 'speed@' + projectId + '.iam.gserviceaccount.com', client_id: '1', token_uri: 'https://oauth2.googleapis.com/token' };
  const credentialPath = path.join(keysDir, 'service-account.json'); fs.writeFileSync(credentialPath, JSON.stringify(serviceAccount));
  const mintToken = uid => {
    const now = Math.floor(Date.now() / 1000), head = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const payload = b64({ iss: 'https://securetoken.google.com/' + projectId, aud: projectId, sub: uid, user_id: uid, auth_time: now - 5, iat: now - 5, exp: now + 3000, email: uid + '@speed-harness.invalid', email_verified: true, role: 'authenticated', firebase: { identities: {}, sign_in_provider: 'password' } });
    const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + payload), keys.key).toString('base64url');
    return head + '.' + payload + '.' + sig;
  };
  return { port: server.address().port, credentialPath, mintToken, stats, setLatency: ms => { latencyMs = ms; }, close: () => new Promise(r => server.close(r)) };
}
module.exports = { startFakeGoogle };
