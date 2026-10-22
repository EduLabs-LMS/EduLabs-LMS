'use client';
import { useEffect } from 'react';
import { guardFetch } from '@/shared/student-preview';

/** Safety net: while a preview page is open, any state-changing request is refused in the browser. */
export function PreviewGuard() {
  useEffect(() => {
    const realFetch = window.fetch, realBeacon = navigator.sendBeacon;
    window.fetch = guardFetch(realFetch.bind(window));
    navigator.sendBeacon = () => false;
    return () => { window.fetch = realFetch; navigator.sendBeacon = realBeacon; };
  }, []);
  return null;
}
