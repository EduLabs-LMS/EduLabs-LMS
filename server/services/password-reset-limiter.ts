import 'server-only';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * A small fixed-window limiter for the password-reset request. It is IN MEMORY, PER SERVER PROCESS: a restart empties it and several instances do
 * not share it (this app has no other limiter; the only other one is the external gateway of the public websites). It holds hashed keys only, never
 * an email or an address, is bounded (the oldest key is dropped when it is full) and is never logged.
 */

export type LimitRule = { limit: number; windowMs: number };
export type LimitVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };
export type Limiter = { take(scope: string, key: string): LimitVerdict };

export function createLimiter(rules: Record<string, LimitRule>, now: () => number = Date.now, maxKeys = 20000): Limiter {
 const buckets = new Map<string, { windowStart: number; count: number }>();
 return {
  take(scope, key) {
  const rule = rules[scope];
  if (!rule) throw new Error('Unknown limiter scope');
  const id = scope + ':' + createHash('sha256').update(key).digest('base64url');
  const t = now();
  let bucket = buckets.get(id);
  if (!bucket || t - bucket.windowStart >= rule.windowMs) {
   bucket = { windowStart: t, count: 0 };
   buckets.delete(id); // reinsert so the oldest-first order below stays true
   if (buckets.size >= maxKeys) { const oldest = buckets.keys().next().value; if (oldest !== undefined) buckets.delete(oldest); }
   buckets.set(id, bucket);
  }
  if (bucket.count >= rule.limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + rule.windowMs - t) / 1000)) };
  bucket.count++;
  return { allowed: true };
  },
 };
}

/** 3 emails per address and 20 requests per client address in 15 minutes; one shared bucket of 200 when no client address can be trusted. */
export const passwordResetRules: Record<string, LimitRule> = {
 email: { limit: 3, windowMs: 15 * 60 * 1000 },
 ip: { limit: 20, windowMs: 15 * 60 * 1000 },
 shared: { limit: 200, windowMs: 15 * 60 * 1000 },
};

/**
 * The client address, from the ONE header the operator names in PASSWORD_RESET_CLIENT_IP_HEADER (the header their proxy sets, e.g. x-real-ip).
 * No header is trusted by default: a client can send any of them. For a list header (x-forwarded-for) the LAST entry is used, the one the operator's
 * own proxy appended. A value that is not an IP address counts as no address.
 */
export function clientAddress(headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string | null {
 const name = env.PASSWORD_RESET_CLIENT_IP_HEADER?.trim().toLowerCase();
 if (!name || !/^[a-z0-9-]{1,40}$/.test(name)) return null;
 const raw = headers.get(name);
 if (!raw) return null;
 const last = raw.split(',').map((v) => v.trim()).filter(Boolean).pop() ?? '';
 const bare = last.replace(/^\[|\]$/g, '').replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/, '$1');
 return isIP(bare) ? bare.toLowerCase() : null;
}

let shared: Limiter | undefined;
/** One limiter per process. */
export const passwordResetLimiter = () => (shared ??= createLimiter(passwordResetRules));
