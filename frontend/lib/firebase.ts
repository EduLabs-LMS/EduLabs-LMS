'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { getFirebaseConfig } from '@/shared/auth-config';

let ready: Promise<void> | undefined;
export function getFirebaseAuth() {
  const app = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
  return getAuth(app);
}
export function restoreFirebaseAuth() {
  const auth = getFirebaseAuth();
  ready ??= setPersistence(auth, browserLocalPersistence).then(() => auth.authStateReady()).catch(failure => {
    // A transient browser-storage failure must not poison every later retry.
    // Keep the required persistence policy; never fall back to weaker storage.
    ready = undefined;
    throw failure;
  });
  return ready;
}
