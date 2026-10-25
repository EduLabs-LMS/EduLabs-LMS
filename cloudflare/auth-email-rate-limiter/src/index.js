const LIMITS = {
  verification: { identityHour: 5, identityDay: 5, cooldownSeconds: 60 },
  "password-reset": { identityHour: 3, identityDay: 5, cooldownSeconds: 0 },
  "teacher-invitation": { identityHour: 3, identityDay: 5, cooldownSeconds: 60 },
};
const IP_HOUR = 10;
const IP_DAY = 30;
const DAILY_BUDGET = 80;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
function constantTimeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function recent(events, cutoff) {
  return Array.isArray(events) ? events.filter(n => Number.isSafeInteger(n) && n > cutoff) : [];
}

export class RateLimitState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    if (request.method !== "POST") return json({ error: "not_found" }, 404);
    const now = Date.now();
    let input;
    try {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 2048) return json({ error: "invalid_request" }, 400);
      input = await request.json();
    } catch { return json({ error: "invalid_request" }, 400); }
    const policy = LIMITS[input?.bucket];
    if (!policy || !validHash(input?.identity) || !validHash(input?.ip)) {
      return json({ error: "invalid_request" }, 400);
    }

    const idKey = "identity:" + input.bucket + ":" + input.identity;
    const ipKey = "ip:" + input.ip;
    const globalKey = "global:daily";
    const result = await this.ctx.storage.transaction(async txn => {
      const idEvents = recent(await txn.get(idKey), now - DAY);
      const ipEvents = recent(await txn.get(ipKey), now - DAY);
      const globalEvents = recent(await txn.get(globalKey), now - DAY);
      const lastIdentity = idEvents.length ? idEvents[idEvents.length - 1] : 0;
      const identityHour = idEvents.filter(t => t > now - HOUR).length;
      const identityDay = idEvents.length;
      const ipHour = ipEvents.filter(t => t > now - HOUR).length;
      const ipDay = ipEvents.length;

      let reason = null;
      if (policy.cooldownSeconds && lastIdentity && now - lastIdentity < policy.cooldownSeconds * 1000) reason = "cooldown";
      else if (identityHour >= policy.identityHour) reason = "identity_hour";
      else if (identityDay >= policy.identityDay) reason = "identity_day";
      else if (ipHour >= IP_HOUR) reason = "ip_hour";
      else if (ipDay >= IP_DAY) reason = "ip_day";
      else if (globalEvents.length >= DAILY_BUDGET) reason = "daily_budget";

      // Count identity/IP attempts even when blocked; never store raw addresses.
      idEvents.push(now);
      ipEvents.push(now);
      await txn.put(idKey, idEvents);
      await txn.put(ipKey, ipEvents);
      if (!reason) {
        globalEvents.push(now);
        await txn.put(globalKey, globalEvents);
      } else {
        await txn.put(globalKey, globalEvents);
      }
      return { allowed: !reason, reason, retryAfter: reason === "cooldown" ? Math.max(1, Math.ceil((policy.cooldownSeconds * 1000 - (now - lastIdentity)) / 1000)) : 60 };
    });
    return json({ allowed: result.allowed, ...(result.allowed ? {} : { retryAfter: result.retryAfter }) }, 200);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "not_found" }, 404);
    const expected = env.AUTH_EMAIL_GATEWAY_TOKEN;
    const auth = request.headers.get("authorization") || "";
    if (!expected || !auth.startsWith("Bearer ") || !constantTimeEqual(auth.slice(7), expected)) {
      return json({ error: "unauthorized" }, 401);
    }
    const namespace = env.RATE_LIMITER;
    if (!namespace) return json({ error: "unavailable" }, 503);
    let input;
    try {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 2048) return json({ error: "invalid_request" }, 400);
      input = await request.json();
    } catch { return json({ error: "invalid_request" }, 400); }
    if (!LIMITS[input?.bucket] || !validHash(input?.identity) || !validHash(input?.ip)) {
      return json({ error: "invalid_request" }, 400);
    }
    const id = namespace.idFromName("edulabs-auth-email-global-v1");
    const stub = namespace.get(id);
    const upstream = await stub.fetch("https://rate-limiter.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!upstream?.ok) return json({ error: "unavailable" }, 503);
    const verdict = await upstream.json().catch(() => null);
    if (!verdict || typeof verdict.allowed !== "boolean") return json({ error: "unavailable" }, 503);
    return json({ allowed: verdict.allowed, ...(verdict.retryAfter ? { retryAfter: verdict.retryAfter } : {}) });
  },
};
