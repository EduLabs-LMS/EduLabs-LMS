'use client';
import { TeacherSurface } from '@/frontend/components/design/surface';
import * as Menu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { BrandLogo } from '@/frontend/components/brand-logo';
import { Avatar, Dialog, Icon, type IconName } from '@/frontend/components/design';
import Footer, { FooterCredits } from '@/frontend/components/footer';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth, useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { TeacherNav } from '@/frontend/features/teacher-home/teacher-nav';
import { requestGuardedAction } from '@/frontend/lib/guarded-action';
import { notePageRender, usePageEntry } from '@/frontend/lib/page-entry';
import { attendancePathPattern } from '@/shared/teacher-attendance';
import { teacherCoursesActive, teacherExamsActive, teacherHomeHref, teacherHomeworkActive, teacherNav, teacherNavSoon, teacherSettingsActive } from '@/shared/teacher-home';
import { UnreadProvider, useUnread } from './unread';

const SETTINGS = '/teacher/settings';
const HELP = '/support';
const NOTIFICATIONS = '/notifications';
const COURSES = '/teacher/courses';
const HOMEWORK = '/teacher/homework';
const EXAMS = '/teacher/exams';

/** Signing out while an attendance save is running asks first, like every other way out of that page. */
function useSignOut() {
  const { signOut } = useApplicationAuth();
  return () => requestGuardedAction(() => { void signOut(); });
}

/** Bottom of the sidebar: the person (avatar, name, teaching space). Opens a small menu with the e-mail, Settings, Help and Sign out. */
function ProfileMenu() {
  const { t } = useLanguage();
  const { user } = useApplicationAuth();
  const navigation = useWebsiteNavigation();
  const signOut = useSignOut();
  const name = user?.fullName?.trim() || navigation?.viewer.displayName?.trim() || '';
  const space = navigation?.organizations.find(o => navigation.staffOrganizationIds.includes(o.id))?.name;
  return <Menu.Root>
    <Menu.Trigger data-teacher-profile aria-label={t('th.profile.menu')} className="d-profile">
      <Avatar id={user?.id ?? navigation?.viewer.id ?? 'teacher'} name={name} imageUrl={user?.imageUrl} />
      <span className="d-profile-text">
        <span className="d-label" data-profile-name><bdi dir="auto">{name || <L id="th.profile.no_name" />}</bdi></span>
        {space && <span className="d-meta" data-profile-space><bdi dir="auto">{space}</bdi></span>}
      </span>
    </Menu.Trigger>
    <Menu.Portal><Menu.Content side="top" align="start" sideOffset={6} collisionPadding={12} data-profile-menu className="d-menu">
      {user?.email && <p className="d-menu-meta" data-profile-email><bdi dir="ltr">{user.email}</bdi></p>}
      <Menu.Item asChild className="d-menu-item"><Link href={SETTINGS} data-teacher-settings-link><Icon name="settings" /><L id="th.nav.settings" /></Link></Menu.Item>
      <Menu.Item asChild className="d-menu-item"><a href={HELP} data-teacher-support><Icon name="help" /><L id="th.nav.help" /></a></Menu.Item>
      <Menu.Item className="d-menu-item d-menu-item--danger" data-teacher-signout onSelect={signOut}><Icon name="logout" /><L id="navigation.sign_out" /></Menu.Item>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}

function DesktopSidebar({ pathname }: { pathname: string }) {
  const { t, number } = useLanguage();
  const unread = useUnread();
  return <aside data-teacher-sidebar className="d-sidebar">
    <div className="d-sidebar-logo"><BrandLogo href={teacherHomeHref} /></div>
    <TeacherNav />
    <div className="d-sidebar-spacer" />
    <div data-teacher-footer className="d-nav-list">
      <Link href={NOTIFICATIONS} data-nav="notifications" aria-current={pathname === NOTIFICATIONS ? 'page' : undefined} aria-label={unread === null ? t('settings.notifications') : t('notifications.bell', { count: number(unread) })} className="d-nav">
        <Icon name="bell" /><span><L id="settings.notifications" /></span>
        {unread !== null && unread > 0 && <span aria-hidden data-unread-count className="d-count">{unread > 99 ? '99+' : number(unread)}</span>}
      </Link>
      <Link href={SETTINGS} data-nav="settings" aria-current={teacherSettingsActive(pathname) ? 'page' : undefined} className="d-nav"><Icon name="settings" /><span><L id="th.nav.settings" /></span></Link>
      <ProfileMenu />
    </div>
  </aside>;
}

function PhoneHeader() {
  const { t, number } = useLanguage();
  const unread = useUnread();
  return <header data-teacher-phone-header className="d-phone-header">
    <BrandLogo href={teacherHomeHref} size="phone" />
    <Link href={NOTIFICATIONS} data-teacher-bell aria-label={unread === null ? t('settings.notifications') : t('notifications.bell', { count: number(unread) })} className="d-btn d-btn--icon">
      <Icon name="bell" size={20} />
      {unread !== null && unread > 0 && <span aria-hidden data-unread-dot className="d-bell-dot" />}
    </Link>
  </header>;
}

const tabIcon: Record<(typeof teacherNav)[number]['key'], IconName> = { home: 'home', groups: 'groups', students: 'students', courses: 'courses', homework: 'homework', exams: 'exams' };

/** Phone: Home, Groups, Students, and More for the rest. Courses, Homework and Exams are menu items on a desktop and live in More on a phone. */
function BottomTabs({ pathname }: { pathname: string }) {
  const { t } = useLanguage();
  const [more, setMore] = useState(false);
  const signOut = useSignOut();
  const inMore = teacherCoursesActive(pathname) || teacherHomeworkActive(pathname) || teacherExamsActive(pathname) || teacherSettingsActive(pathname) || pathname === HELP || pathname.startsWith(`${HELP}/`);
  const close = () => setMore(false);
  return <>
    <nav aria-label={t('th.nav.label')} data-teacher-tabs className="d-bottom-tabs">
      {teacherNav.filter(item => item.key !== 'courses' && item.key !== 'homework' && item.key !== 'exams').map(item => <Link key={item.key} href={item.href} aria-current={item.match(pathname) ? 'page' : undefined} data-bottom-tab={item.key} className="d-bottom-tab">
        <span className="d-bottom-tab-icon"><Icon name={tabIcon[item.key]} size={22} /></span><L id={`th.nav.${item.key}`} />
      </Link>)}
      <button type="button" data-bottom-tab="more" data-active={inMore ? 'true' : undefined} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)} className="d-bottom-tab">
        <span className="d-bottom-tab-icon"><Icon name="more" size={22} /></span><L id="th.nav.more" />
      </button>
    </nav>
    <Dialog open={more} onOpenChange={setMore} title={<L id="th.nav.more" />} data-more-sheet>
      <div className="d-sheet-list">
        <Link href={COURSES} onClick={close} data-more-item="courses" className="d-sheet-item"><Icon name="courses" size={20} /><L id="th.nav.courses" /></Link>
        <Link href={HOMEWORK} onClick={close} data-more-item="homework" aria-current={teacherHomeworkActive(pathname) ? 'page' : undefined} className="d-sheet-item"><Icon name="homework" size={20} /><L id="th.nav.homework" /></Link>
        <Link href={EXAMS} onClick={close} data-more-item="exams" aria-current={teacherExamsActive(pathname) ? 'page' : undefined} className="d-sheet-item"><Icon name="exams" size={20} /><L id="th.nav.exams" /></Link>
        {teacherNavSoon.map(key => <span key={key} role="link" aria-disabled="true" title={t('th.nav.coming_soon')} data-more-item={key} data-soon className="d-sheet-item d-sheet-item--soon"><Icon name={key} size={20} /><L id={`th.nav.${key}`} /><span className="d-soon"><L id="th.nav.soon" /></span></span>)}
        <Link href={SETTINGS} onClick={close} data-more-item="settings" className="d-sheet-item"><Icon name="settings" size={20} /><L id="th.nav.settings" /></Link>
        <a href={HELP} onClick={close} data-more-item="help" className="d-sheet-item"><Icon name="help" size={20} /><L id="th.nav.help" /></a>
        <button type="button" onClick={() => { close(); signOut(); }} data-more-item="signout" className="d-sheet-item d-sheet-item--danger"><Icon name="logout" size={20} /><L id="navigation.sign_out" /></button>
      </div>
    </Dialog>
  </>;
}

/**
 * The teacher app frame, in both looks: a 240 px sidebar flush to the edge on a desktop; a 56 px header, bottom tabs and a one-line footer on a phone.
 * Attendance hides the tabs, so its own sticky buttons stay the only thing at the bottom. The frame decides nothing about access: every page reads and checks for itself.
 */
export function TeacherFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const noTabs = attendancePathPattern.test(pathname);
  const main = useRef<HTMLElement>(null);
  notePageRender(pathname);
  usePageEntry(main, pathname);
  return <UnreadProvider>
    <div data-lms-shell data-teacher-shell data-tabs={noTabs ? 'hidden' : undefined} className="d-shell">
      <PhoneHeader />
      <DesktopSidebar pathname={pathname} />
      <div className="d-main">
        <main ref={main} data-enter="" className="d-main-inner"><TeacherSurface>{children}</TeacherSurface></main>
        <div className="hidden md:block"><Footer audience="teacher" /></div>
        <p data-teacher-phone-footer className="d-phone-footer"><FooterCredits /></p>
      </div>
      {!noTabs && <BottomTabs pathname={pathname} />}
    </div>
  </UnreadProvider>;
}
