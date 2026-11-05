'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, ChevronRight, Globe, User } from 'lucide-react';
import { Tabs } from '@/frontend/components/design';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { coursePagePattern } from '@/shared/teacher-course-page';
import { settingsSectionFor, teacherSettingsRoot, teacherSettingsSections, type TeacherSettingsSection } from '@/shared/teacher-settings';

export const sectionIcons: Record<TeacherSettingsSection['key'], typeof User> = { account: User, language: Globe, notifications: Bell };

/**
 * Settings inside the main teacher frame, with its own sub-navigation inside the content area. Desktop: the title and underline tabs. Phone: a back arrow
 * and the title; the root is the list of sections, each section its own page. A course's page keeps its address under Settings but belongs to Courses, so it is shown without this sub-navigation.
 */
export function TeacherSettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { t } = useLanguage();
  if (coursePagePattern.test(pathname)) return <>{children}</>;
  const section = settingsSectionFor(pathname);
  return <div data-teacher-settings className="d-settings text-black">
    <header className="hidden md:block"><h1 className="d-title"><L id="ts.title" /></h1></header>
    <header className="flex items-center gap-2 md:hidden">
      <Link href={section ? teacherSettingsRoot : '/home'} data-settings-phone-back aria-label={section ? t('ts.back_to_settings') : t('ts.back')} className="d-btn d-btn--icon"><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /></Link>
      <h1 className="d-title">{section ? <L id={`ts.${section.key}.title`} /> : <L id="ts.title" />}</h1>
    </header>
    <div className="hidden md:block"><Tabs label={t('ts.nav.label')} active={section?.key ?? ''} data-settings-sidebar items={teacherSettingsSections.map(s => ({ key: s.key, href: s.href, label: <L id={`ts.${s.key}.title`} />, 'data-settings-section': s.key }))} /></div>
    <div className="space-y-6">{children}</div>
  </div>;
}

/** Phone: the list of sections. On a desktop width the first section is shown instead (see SettingsIndex). */
export function SettingsList() {
  return <ul data-settings-list className="flex flex-col gap-2.5 md:hidden">
    {teacherSettingsSections.map(s => {
      const Icon = sectionIcons[s.key];
      return <li key={s.key}><Link href={s.href} data-settings-section={s.key} className="flex min-h-[72px] items-center gap-3.5 rounded-2xl border-2 border-black bg-white px-4 py-3 shadow-hard-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        <Icon aria-hidden className="h-[26px] w-[26px] shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col"><span className="text-lg font-bold"><L id={`ts.${s.key}.title`} /></span><span className="text-sm text-slate-600"><L id={`ts.${s.key}.hint`} /></span></span>
        <ChevronRight aria-hidden className="h-[22px] w-[22px] shrink-0 rtl:rotate-180" />
      </Link></li>;
    })}
  </ul>;
}
