// Loaded with NODE_OPTIONS=--require for the LOCAL speed measurement only. Sends the few Google hosts that firebase-admin
// talks to (certificate keys, user lookup, token endpoint) to the fictional server on loopback. Everything else is untouched.
const port = process.env.SPEED_FAKE_GOOGLE_PORT;
if (port) {
  const mapped = new Set(['www.googleapis.com', 'identitytoolkit.googleapis.com', 'oauth2.googleapis.com', 'accounts.google.com', 'securetoken.googleapis.com']);
  const http = require('http'), https = require('https');
  const origHttpsRequest = https.request.bind(https);
  const rewrite = (args) => {
    let [first, second, third] = args, options = {}, callback;
    if (typeof first === 'string' || first instanceof URL) { const u = new URL(first); options = { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname + u.search }; if (typeof second === 'object' && second) Object.assign(options, second); callback = typeof second === 'function' ? second : third; }
    else { options = { ...first }; callback = second; }
    const host = String(options.hostname || options.host || '').replace(/:\d+$/, '');
    return { host, options, callback };
  };
  https.request = function (...args) {
    const { host, options, callback } = rewrite(args);
    if (!mapped.has(host)) return origHttpsRequest(...args);
    return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port: Number(port), agent: undefined, headers: { ...(options.headers || {}), 'x-fake-host': host } }, callback);
  };
  https.get = function (...args) { const r = https.request(...args); r.end(); return r; };
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    try {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.protocol === 'https:' && mapped.has(u.hostname)) {
        const headers = new Headers(init?.headers || (typeof input === 'object' && input.headers) || {}); headers.set('x-fake-host', u.hostname);
        return origFetch('http://127.0.0.1:' + port + u.pathname + u.search, { ...init, headers, method: init?.method || (typeof input === 'object' && input.method) || 'GET', body: init?.body });
      }
    } catch { /* fall through */ }
    return origFetch(input, init);
  };
}
