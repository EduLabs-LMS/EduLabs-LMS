'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { communicate } from '@/frontend/lib/communications';
import type { NotificationPage } from '@/shared/contracts/communications';

const UnreadContext = createContext<number | null>(null);
const POLL_MS = 30000;
const TIMEOUT_MS = 15000;

/** The unread count of the teacher frame: one read and one 30-second poll, however many places show it (sidebar, phone bell). Null means not known, and then no count is shown. */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current: AbortController | null = null;
    let alive = true;
    const load = async () => {
      if (current) return;
      const controller = new AbortController();
      current = controller;
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const page = await communicate<NotificationPage>('notifications', 'list', { filter: 'unread', page: 0 }, undefined, { signal: controller.signal });
        if (alive) setCount(page.unread);
      } catch { if (alive) setCount(null); }
      finally { clearTimeout(timer); if (current === controller) current = null; }
    };
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    const poll = setInterval(refresh, POLL_MS);
    window.addEventListener('edulabs-notifications-changed', refresh);
    return () => { alive = false; current?.abort(); clearInterval(poll); window.removeEventListener('edulabs-notifications-changed', refresh); };
  }, []);
  return <UnreadContext.Provider value={count}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
