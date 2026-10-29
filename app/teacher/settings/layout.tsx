import type { Metadata } from 'next';
import { staffContext } from '@/app/(dashboard)/_components/teacher-home-pages';
import { TeacherSettingsShell } from '@/frontend/features/teacher-settings/shell';

export const metadata: Metadata = { title: 'Settings | EduLabs', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Its own frame, outside the main teacher layout. Defense in depth: every page below repeats the staff check, because layouts are not re-run on client navigation. */
export default async function TeacherSettingsLayout({ children }: { children: React.ReactNode }) {
  await staffContext();
  return <TeacherSettingsShell>{children}</TeacherSettingsShell>;
}
