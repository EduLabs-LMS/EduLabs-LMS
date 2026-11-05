'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Icon } from '@/frontend/components/design';
import { L, Localized } from '@/frontend/components/language-provider';
import { teacherNav } from '@/shared/teacher-home';

/** Shown to active staff only. Navigation is a convenience: the API and database decide what any destination may do. */
export function TeacherNav() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  // The main-menu screens are fetched while the browser is idle, so choosing one shows its frame and skeleton at once. This only prepares the
  // screen's loading shell (no data is read for it, and nothing about access is decided here): the page still reads and checks everything itself.
  useEffect(() => {
    const hrefs = teacherNav.flatMap(item => item.href !== pathname ? [item.href] : []);
    const start = () => hrefs.forEach(href => { try { router.prefetch(href); } catch { /* a missed prefetch only costs the head start */ } });
    const idle = (window as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) { const handle = idle(start, { timeout: 2000 }); return () => (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle); }
    const timer = window.setTimeout(start, 400);
    return () => window.clearTimeout(timer);
  }, [router, pathname]);
  return <Localized as="nav" labels={{ 'aria-label': 'th.nav.label' }} data-teacher-nav className="d-nav-list">
    {teacherNav.map(item => <Link key={item.key} href={item.href} aria-current={item.match(pathname) ? 'page' : undefined} data-nav={item.key} className="d-nav">
      <Icon name={item.key === 'home' ? 'home' : item.key} />
      <span><L id={`th.nav.${item.key}`} /></span>
    </Link>)}
  </Localized>;
}
