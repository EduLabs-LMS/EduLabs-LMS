'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { getFirebaseAuth, restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { clearSwr, setSwrOwner } from '@/frontend/lib/swr-cache';
import { clearFirstLoad } from '@/frontend/lib/first-load';

async function request(action: string, idToken?: string) {
  const response = await fetch(`/api/auth/firebase/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(idToken ? { idToken } : {}), credentials: 'same-origin', cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Authentication request failed');
  return result;
}
export async function synchronizeFirebaseSession(user: User) {
  let token = await user.getIdToken();
  const { refreshRequired } = await request('provision', token);
  if (refreshRequired || (await user.getIdTokenResult()).claims.role !== 'authenticated') {
    token = await user.getIdToken(true);
  }
  if (!user.emailVerified) throw new Error('Please verify your email, then choose “I verified my email”.');
  await request('session', token);
}
type AuthState = { user: User | null; loading: boolean; error: string | null; refresh: () => Promise<void>; logout: () => Promise<void> };
const Context = createContext<AuthState | null>(null);

export function FirebaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const current = getFirebaseAuth().currentUser;
    if (!current) throw new Error('Please sign in');
    await current.reload();
    await current.getIdToken(true);
    await synchronizeFirebaseSession(current);
    setError(null);
  }, []);
  useEffect(() => {
    let active = true; let unsubscribe = () => {}; let generation = 0;
    void restoreFirebaseAuth().then(() => {
      if (!active) return;
      unsubscribe = onIdTokenChanged(getFirebaseAuth(), async current => {
        const revision = ++generation;
        // Cached screen data belongs to one signed-in user: a different user, or nobody, starts with an empty cache.
        setSwrOwner(current?.uid ?? null);
        setUser(current); setLoading(true);
        try {
          if (current) await synchronizeFirebaseSession(current);
          if (active && revision === generation) setError(null);
        } catch (failure) {
          if (active && revision === generation) setError(failure instanceof Error ? failure.message : 'Authentication failed');
        } finally { if (active && revision === generation) setLoading(false); }
      });
    }).catch(() => { if (active) { setError('Firebase configuration is unavailable.'); setLoading(false); } });
    // ID token expiry is one hour; refresh while the page is active, including after wake.
    const renew = () => { if (getFirebaseAuth().currentUser) void refresh().catch(() => setError('Session expired. Please sign in again.')); };
    const timer = window.setInterval(renew, 40 * 60 * 1000);
    const visible = () => { if (document.visibilityState === 'visible') renew(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; unsubscribe(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const logout = async () => {
    let failure: unknown;
    try { await request('logout'); } catch (value) { failure = value; }
    clearSwr(); clearFirstLoad();
    await signOut(getFirebaseAuth());
    if (failure) throw failure;
    window.location.assign('/sign-in');
  };
  return <Context.Provider value={{ user, loading, error, refresh, logout }}>{children}</Context.Provider>;
}
export function useFirebaseAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('FirebaseAuthProvider is required');
  return value;
}
