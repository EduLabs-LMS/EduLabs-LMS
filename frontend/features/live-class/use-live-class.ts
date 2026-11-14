'use client';
import { useSyncExternalStore } from 'react';

const nothing = () => () => {};
/**
 * Whether the EduLabs class is on: the server renders <html data-live-class="on"> only when the meeting server is configured
 * (server/services/live-class-provider.ts). Off, every Start/Join button stays hidden and Own link Sessions work as before. Read after hydration
 * (the server snapshot is "off"), so no request is made for it.
 */
export function useLiveClassOn(): boolean {
  return useSyncExternalStore(nothing, () => document.documentElement.dataset.liveClass === 'on', () => false);
}
