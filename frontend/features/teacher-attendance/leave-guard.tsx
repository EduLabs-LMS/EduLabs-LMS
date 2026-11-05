'use client';
import { useEffect, useRef, useState } from 'react';
import { L } from '@/frontend/components/language-provider';
import { inkButton, plainButton } from '@/frontend/features/teacher-home/parts';

type Leave = { kind: 'link'; href: string } | { kind: 'back' };

/**
 * While `active`, every way out of the page asks first: closing or reloading the tab and typing another address (the browser's own prompt),
 * any link on the page (the menu, the logo, "Back to the Group", a Home link), and the browser's Back button. A link to another site, or
 * one that opens a new tab, is left to the browser. `go` is the app's own navigation, used once the teacher chooses to leave anyway.
 * Navigation that is not a link or Back (a script calling the router) cannot be intercepted here.
 */
export function useLeaveGuard(active: boolean, go: (href: string) => void) {
  const [asking, setAsking] = useState<Leave | null>(null);
  const activeRef = useRef(active);
  const leaving = useRef(false);
  const sentinel = useRef(false);
  activeRef.current = active;

  useEffect(() => { if (!active) setAsking(null); }, [active]);

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { if (leaving.current) return; e.preventDefault(); e.returnValue = ''; };
    const click = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      setAsking({ kind: 'link', href: url.pathname + url.search + url.hash });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    // One extra history entry so that Back lands on this page again, where it can be asked about. The state is copied, which keeps the router's own bookkeeping.
    if (!sentinel.current) { window.history.pushState(window.history.state, '', window.location.href); sentinel.current = true; }
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); };
  }, [active]);

  useEffect(() => {
    const pop = () => {
      if (leaving.current || !sentinel.current) return;
      if (activeRef.current) { window.history.pushState(window.history.state, '', window.location.href); setAsking({ kind: 'back' }); return; }
      // The save finished: the extra entry is no longer wanted, so this Back goes on to the page before it.
      sentinel.current = false; window.history.back();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const stay = () => setAsking(null);
  const leave = () => {
    const target = asking; if (!target) return;
    leaving.current = true; setAsking(null);
    if (target.kind === 'back') { sentinel.current = false; window.history.go(-2); } else go(target.href);
  };
  return { asking, stay, leave };
}

/** The question shown in place of the buttons while a save is still running. "Stay" is the first, focused choice. */
export function LeaveQuestion({ stay, leave }: { stay: () => void; leave: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div role="alertdialog" aria-labelledby="ta-leave-t" data-leave-question className="space-y-2 rounded-2xl border-2 border-black bg-white p-3">
    <p id="ta-leave-t" className="text-base font-bold"><L id="ta.leave.text" /></p>
    <div className="flex flex-col gap-2 lg:flex-row">
      <button ref={ref} type="button" data-leave-stay onClick={stay} className={`${inkButton} min-h-[48px] w-full lg:w-auto lg:min-w-[200px]`}><L id="ta.leave.stay" /></button>
      <button type="button" data-leave-go onClick={leave} className={`${plainButton} min-h-[48px] w-full lg:w-auto lg:min-w-[200px]`}><L id="ta.leave.go" /></button>
    </div>
  </div>;
}
