'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, BookOpen, ChevronRight, Globe, User } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { settingsSectionFor, teacherSettingsRoot, teacherSettingsSections, type TeacherSettingsSection } from '@/shared/teacher-settings';

export const sectionIcons: Record<TeacherSettingsSection['key'], typeof User> = { account: User, courses: BookOpen, language: Globe, notifications: Bell };

/**
 * The Settings area has its own frame (it is not inside the main teacher sidebar layout). Desktop: a "Settings" sidebar with a way back, content on the
 * right (max 880px). Phone: a back arrow and the title on top; the root is the list of sections, each section its own page.
 */
export function TeacherSettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { t } = useLanguage();
  const section = settingsSectionFor(pathname);
  return <div data-teacher-settings className="min-h-screen bg-slate-50 text-black md:flex">
    <nav aria-label={t('ts.nav.label')} data-settings-sidebar className="hidden min-h-screen shrink-0 flex-col gap-1.5 border-e-2 border-black bg-white p-4 md:flex md:w-72">
      <Link href="/home" data-settings-back className="inline-flex min-h-[44px] w-fit items-center gap-1.5 rounded-xl px-2 text-base font-bold hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><L id="ts.back_to_app" /></Link>
      <h1 className="px-2 py-3 font-display text-3xl leading-tight"><L id="ts.title" /></h1>
      {teacherSettingsSections.map(s => {
        const Icon = sectionIcons[s.key], active = pathname === s.href;
        return <Link key={s.key} href={s.href} data-settings-section={s.key} aria-current={active ? 'page' : undefined}
          className={cn('flex min-h-[48px] items-center gap-3 rounded-2xl border-2 px-3 text-base transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2', active ? 'border-black bg-primary font-bold shadow-hard-sm' : 'border-transparent font-semibold text-slate-700 hover:bg-slate-100 hover:text-black')}>
          <Icon aria-hidden className="h-[22px] w-[22px] shrink-0" /><span><L id={`ts.${s.key}.title`} /></span>
        </Link>;
      })}
    </nav>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b-2 border-black bg-white px-4 py-2.5 md:hidden">
        <Link href={section ? teacherSettingsRoot : '/home'} data-settings-phone-back aria-label={section ? t('ts.back_to_settings') : t('ts.back')} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-black bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><ArrowLeft aria-hidden className="h-6 w-6 rtl:rotate-180" /></Link>
        <h1 className="font-display text-2xl leading-tight">{section ? <L id={`ts.${section.key}.title`} /> : <L id="ts.title" />}</h1>
      </header>
      <main className="px-4 py-5 md:px-14 md:py-10"><div className="w-full max-w-[880px] space-y-6">{children}</div></main>
    </div>
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
