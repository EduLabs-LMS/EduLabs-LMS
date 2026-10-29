'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { teacherSettingsSections } from '@/shared/teacher-settings';
import { SettingsList } from './shell';

/** /teacher/settings: a list on a phone, and on a desktop width straight to the first section (the sidebar is the list there). */
export function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const go = () => { if (wide.matches) router.replace(teacherSettingsSections[0].href); };
    go(); wide.addEventListener('change', go);
    return () => wide.removeEventListener('change', go);
  }, [router]);
  return <SettingsList />;
}
