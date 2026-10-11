'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BookOpen, Home, Users, ShieldCheck, LogOut, HelpCircle, Menu, Calendar } from 'lucide-react';
import { useApplicationAuth, useWebsiteNavigation, ApplicationAvatar } from '@/frontend/components/providers/application-auth-provider';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '@/frontend/components/ui/sheet';
import { useSupportModal } from '@/frontend/hooks/use-support-modal';
import { Brand } from './tree';
import { PreferenceControls, useLocale } from './preferences';

export function EduSidebar({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { user, signOut } = useApplicationAuth();
  const navigation = useWebsiteNavigation();
  const { onOpen } = useSupportModal();
  const { t } = useLocale();
  const path = usePathname(); const params = useSearchParams(); const router = useRouter();
  const organization = params.get('organization') || '';
  const staff = !!navigation?.staffOrganizationIds.some(id => !organization || id === organization);
  const [error, setError] = useState('');
  const items = [{ label:'Home', href:'/home', icon:Home },{ label:'Self Learning', href:'/self-learning', icon:BookOpen },{ label:'Groups', href:'/group', icon:Users }, ...(staff ? [{ label:'Teacher Courses', href:'/teacher/courses', icon:ShieldCheck }] : [])];
  return <aside className={`edu-sidebar ${className}`}>
    <header className="edu-sidebar-header"><Link href="/home" onClick={onNavigate} aria-label="EduLabs"><Brand /></Link></header>
    <div className="p-4"><label className="text-sm font-semibold" htmlFor={onNavigate ? 'mobile-organization' : 'desktop-organization'}>{t('Organization')}</label><select id={onNavigate ? 'mobile-organization' : 'desktop-organization'} className="mt-2" value={organization} onChange={e => { router.push(e.target.value ? `/home?organization=${e.target.value}` : '/home'); onNavigate?.(); }}><option value="">{t('All your organizations')}</option>{navigation?.organizations.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></div>
    <nav className="edu-sidebar-nav" aria-label={t('Teaching tools')}>{items.map(({ label, href, icon:Icon }) => <Link key={href} className="edu-nav-link" aria-current={path === href || (href === '/teacher/courses' && path.startsWith('/teacher/')) ? 'page' : undefined} href={organization ? `${href}?organization=${encodeURIComponent(organization)}` : href} onClick={onNavigate}><Icon size={20} /><span>{t(label)}</span></Link>)}<div className="edu-nav-link edu-muted"><Calendar size={20}/><span>{t('Sessions')}</span><span className="edu-pill">{t('Soon')}</span></div><button type="button" className="edu-nav-link" onClick={() => { onNavigate?.(); onOpen(); }}><HelpCircle size={20}/>{t('Website Help')}</button><Link href="/onboarding/organization" className="edu-nav-link" onClick={onNavigate}>{t('Create an organization')}</Link></nav>
    <footer className="edu-sidebar-foot"><PreferenceControls /><div className="flex items-center gap-3"><ApplicationAvatar /><div className="min-w-0"><p>{user?.fullName || user?.email}</p><span className="edu-pill">{t(staff ? 'Course staff' : 'Learner')}</span></div></div><button className="edu-nav-link" type="button" onClick={() => { onNavigate?.(); void signOut().catch(() => setError(t('Unable to sign out. Please try again.'))); }}><LogOut size={18}/>{t('Logout')}</button>{error && <p role="alert">{error}</p>}</footer>
  </aside>;
}
export function EduMobileSidebar() {
  const [open,setOpen] = useState(false); const { locale,t } = useLocale();
  return <header className="edu-mobile-header"><Link href="/home" aria-label="EduLabs"><Brand /></Link><Sheet open={open} onOpenChange={setOpen}><SheetTrigger className="edu-icon-btn" aria-label={locale === 'ar' ? 'فتح قائمة التنقل' : 'Open navigation menu'} aria-expanded={open}><Menu size={22}/></SheetTrigger><SheetContent side={locale === 'ar' ? 'right' : 'left'} className="edu-drawer edu-app"><SheetTitle className="sr-only">{t('Teaching tools')}</SheetTitle><SheetDescription className="sr-only">{t('Organization')}</SheetDescription><EduSidebar onNavigate={() => setOpen(false)} /></SheetContent></Sheet></header>;
}
