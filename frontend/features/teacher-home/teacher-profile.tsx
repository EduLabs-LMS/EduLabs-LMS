'use client';
import Link from 'next/link';
import { Settings, User } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';

/** Bottom of the teacher menu: the signed-in account (photo, name, e-mail from the existing account profile) and the cog that opens Settings. */
export function TeacherProfile({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const { user } = useApplicationAuth();
  const name = user?.fullName?.trim();
  return <div data-teacher-profile className="flex items-center gap-3 rounded-2xl border-2 border-black bg-white p-2 shadow-hard-sm">
    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-black bg-primary/30">
      {user?.imageUrl ? <img alt="" src={user.imageUrl} width={44} height={44} className="h-full w-full object-cover" /> : <User className="h-5 w-5" />}
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-bold leading-tight text-slate-900" data-profile-name><bdi dir="auto">{name || <L id="th.profile.no_name" />}</bdi></span>
      {user?.email && <span className="truncate text-xs text-slate-600" data-profile-email><bdi dir="ltr">{user.email}</bdi></span>}
    </span>
    <Link aria-label={t('th.profile.settings')} href="/teacher/settings" onClick={() => onNavigate?.()} data-teacher-settings-link
      className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-black bg-slate-50 text-black transition-all hover:bg-primary active:translate-x-0.5 active:translate-y-0.5 md:h-11 md:w-11">
      <Settings aria-hidden className="h-6 w-6" />
    </Link>
  </div>;
}
