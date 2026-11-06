'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Globe } from 'lucide-react';
import { Icon, Tabs, type IconName } from '@/frontend/components/design';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { coursePagePattern } from '@/shared/teacher-course-page';
import { settingsSectionFor, teacherSettingsRoot, teacherSettingsSections, type TeacherSettingsSection } from '@/shared/teacher-settings';

const sectionIcons: Record<TeacherSettingsSection['key'], IconName | 'globe'> = { account: 'students', language: 'globe', notifications: 'bell' };

/**
 * Settings inside the main teacher frame, with its own sub-navigation inside the content area. Desktop: the title and underline tabs. Phone: a back arrow
 * and the title; the root is the list of sections, each section its own page. A course's page keeps its address under Settings but belongs to Courses, so it is shown without this sub-navigation.
 */
export function TeacherSettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { t } = useLanguage();
  if (coursePagePattern.test(pathname)) return <>{children}</>;
  const section = settingsSectionFor(pathname);
  return <div data-teacher-settings className="d-settings">
    <header className="d-settings-head d-settings-head--wide"><h1 className="d-title"><L id="ts.title" /></h1></header>
    <header className="d-settings-head d-settings-head--phone">
      <Link href={section ? teacherSettingsRoot : '/home'} data-settings-phone-back aria-label={section ? t('ts.back_to_settings') : t('ts.back')} className="d-btn d-btn--icon d-btn--tertiary d-focus"><Icon name="back" /></Link>
      <h1 className="d-title">{section ? <L id={`ts.${section.key}.title`} /> : <L id="ts.title" />}</h1>
    </header>
    <div className="d-settings-tabs"><Tabs label={t('ts.nav.label')} active={section?.key ?? ''} data-settings-sidebar items={teacherSettingsSections.map(s => ({ key: s.key, href: s.href, label: <L id={`ts.${s.key}.title`} />, 'data-settings-section': s.key }))} /></div>
    <div className="d-stack-lg">{children}</div>
  </div>;
}

/** Phone: the list of sections. On a desktop width the first section is shown instead (see SettingsIndex). */
export function SettingsList() {
  return <ul data-settings-list className="d-list d-card md:hidden">
    {teacherSettingsSections.map(s => {
      const icon = sectionIcons[s.key];
      return <li key={s.key} className="d-row"><Link href={s.href} data-settings-section={s.key} className="d-row-link d-focus">
        <span aria-hidden className="d-badge d-badge--info">{icon === 'globe' ? <Globe className="h-5 w-5" /> : <Icon name={icon} />}</span>
        <span className="d-row-body"><span className="d-label"><L id={`ts.${s.key}.title`} /></span><span className="d-meta"><L id={`ts.${s.key}.hint`} /></span></span>
        <Icon name="chevron" className="d-chevron" />
      </Link></li>;
    })}
  </ul>;
}
