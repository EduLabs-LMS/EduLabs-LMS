'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Menu, Settings, Users, X } from 'lucide-react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Brand, Button, ButtonLink } from '@/frontend/design-system';

export function PlatformAdminShell({ name, children }: { name: string; children: React.ReactNode }) {
 const { t } = useLanguage();
 const pathname = usePathname();
 const [navOpen, setNavOpen] = useState(false);
 useEffect(() => setNavOpen(false), [pathname]);
 useEffect(() => {
  if (!navOpen) return;
  const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setNavOpen(false); };
  window.addEventListener('keydown', close);
  return () => window.removeEventListener('keydown', close);
 }, [navOpen]);
 const onTeachers = pathname?.startsWith('/platform-admin/teachers') ?? false;
 const onSettings = pathname?.startsWith('/platform-admin/settings') ?? false;

 return <div className="eds-root pa-root" data-platform-admin data-appearance-island data-nav-open={navOpen}>
  <aside className="pa-sidebar" id="pa-sidebar" aria-label={t('pa.nav.main')}>
   <Link href="/platform-admin/teachers" className="pa-brand" aria-label={`${t('pa.brand')} — ${t('pa.brand_sub')}`}>
    <span><Brand /><small>{t('pa.brand_sub')}</small></span>
   </Link>
   <nav className="pa-nav" aria-label={t('pa.nav.main')}>
    <Link href="/platform-admin/teachers" className="pa-link" aria-current={onTeachers ? 'page' : undefined}>
     <Users size={18} aria-hidden="true" />{t('pa.nav.teachers')}
    </Link>
   </nav>
   <div className="pa-sidebar-foot">
    <nav className="pa-nav" aria-label={t('pa.nav.settings_group')}>
     <Link href="/platform-admin/settings" className="pa-link" aria-current={onSettings ? 'page' : undefined}>
      <Settings size={18} aria-hidden="true" />{t('pa.nav.settings')}
     </Link>
    </nav>
    <span>{t('pa.signed_in_as', { name })}</span>
    <ButtonLink href="/home" variant="ghost" size="sm"><ArrowLeft size={16} className="eds-flip" aria-hidden="true" />{t('pa.nav.back')}</ButtonLink>
   </div>
  </aside>
  <button type="button" className="pa-scrim" aria-label={t('pa.nav.close')} tabIndex={-1} onClick={() => setNavOpen(false)} />
  <div className="pa-main">
   <header className="pa-topbar">
    <Button size="icon" className="pa-menu-btn" aria-controls="pa-sidebar" aria-expanded={navOpen} aria-label={t(navOpen ? 'pa.nav.close' : 'pa.nav.open')} onClick={() => setNavOpen(open => !open)}>
     {navOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
    </Button>
   </header>
   <main className="pa-content">{children}</main>
  </div>
 </div>;
}
