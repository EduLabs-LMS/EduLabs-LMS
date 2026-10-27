import { invitationFromHash } from '@/shared/invitation-link';

// The bearer secret must survive sign-in, sign-up, Google redirects and e-mail verification, which all leave the page.
// It is kept only in this browser, for a short time, and removed as soon as the invitation is accepted or found unusable.
const key = 'edulabs-teacher-invitation';
const lifetimeMs = 2 * 60 * 60 * 1000;
type Stored = { token: string; savedAt: number };

function stores(): Storage[] {
 const list: Storage[] = [];
 try { list.push(window.localStorage); } catch { /* blocked */ }
 try { list.push(window.sessionStorage); } catch { /* blocked */ }
 return list;
}

export function saveInvitationToken(token: string, now = Date.now()) {
 let saved = false;
 for (const store of stores()) {
  try { store.setItem(key, JSON.stringify({ token, savedAt: now } satisfies Stored)); saved = true; } catch { /* quota or blocked */ }
 }
 return saved;
}

export function readInvitationToken(now = Date.now()): string | null {
 for (const store of stores()) {
  try {
   const raw = store.getItem(key);
   if (!raw) continue;
   const value = JSON.parse(raw) as Partial<Stored>;
   if (typeof value.savedAt === 'number' && now - value.savedAt >= 0 && now - value.savedAt < lifetimeMs && typeof value.token === 'string' && invitationFromHash(`#${value.token}`)) return value.token;
   store.removeItem(key);
  } catch { try { store.removeItem(key); } catch { /* ignore */ } }
 }
 return null;
}

export function clearInvitationToken() {
 for (const store of stores()) { try { store.removeItem(key); } catch { /* ignore */ } }
}

export function hasPendingInvitation() { return readInvitationToken() !== null; }
