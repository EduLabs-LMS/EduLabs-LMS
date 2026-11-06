'use client';
import { useSyncExternalStore } from 'react';

/** Below the frame's sidebar breakpoint. Read on the client: the server paints the desktop arrangement, so a phone settles on its own right after hydration. */
const PHONE = '(max-width: 767px)';
export function usePhone() {
  return useSyncExternalStore(change => { const list = window.matchMedia(PHONE); list.addEventListener('change', change); return () => list.removeEventListener('change', change); }, () => window.matchMedia(PHONE).matches, () => false);
}
