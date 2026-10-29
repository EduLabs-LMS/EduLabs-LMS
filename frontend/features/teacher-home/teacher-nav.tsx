'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CheckSquare, FileText, GraduationCap, Home, Users } from 'lucide-react';
import { L, Localized } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { teacherNav, type TeacherNavItem } from '@/shared/teacher-home';

const icons: Record<TeacherNavItem['key'], typeof Home> = { home: Home, students: GraduationCap, groups: Users, homework: CheckSquare, exams: FileText, reports: BarChart3 };
const row = 'relative flex items-center gap-3.5 px-4 py-3 min-h-[48px] text-[15px] font-medium rounded-2xl border-2 border-transparent transition-all duration-200 ease-out';

/** Shown to active staff only. Navigation is a convenience: the API and database decide what any destination may do. */
export function TeacherNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  return <Localized as="nav" labels={{ 'aria-label': 'th.nav.label' }} data-teacher-nav className="p-3 flex flex-col space-y-1.5 overflow-y-auto scrollbar-none flex-1">
    {teacherNav.map(item => {
      const Icon = icons[item.key];
      // A screen that does not exist yet is a disabled item with a "Coming soon" label, never a link to an unavailable page.
      if (item.href === null) return <span key={item.key} aria-disabled="true" data-nav={item.key} data-soon className={cn(row, 'cursor-not-allowed text-slate-500')}>
        <Icon aria-hidden className="w-[22px] h-[22px] shrink-0 text-slate-400" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2"><L id={`th.nav.${item.key}`} /><span className="rounded-full border-2 border-slate-400 px-2 text-xs font-bold leading-5 text-slate-600"><L id="th.nav.soon" /></span></span>
      </span>;
      const active = item.match(pathname);
      return <Link key={item.key} href={item.href} onClick={() => onNavigate?.()} aria-current={active ? 'page' : undefined} data-nav={item.key}
        className={cn(row, 'cursor-pointer active:translate-x-0.5 active:translate-y-0.5', active ? 'bg-primary text-black border-black font-semibold shadow-hard-sm' : 'text-slate-700 hover:text-black hover:bg-slate-100')}>
        <Icon aria-hidden className={cn('w-[22px] h-[22px] shrink-0 transition-colors', active ? 'text-black' : 'text-slate-500')} />
        <span><L id={`th.nav.${item.key}`} /></span>
      </Link>;
    })}
  </Localized>;
}
