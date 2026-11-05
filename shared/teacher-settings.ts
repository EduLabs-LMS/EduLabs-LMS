/**
 * The teacher Settings area, inside the main teacher frame. ONE array: adding a section later is one entry here, one page under app/(dashboard)/(routes)/teacher/settings/<key>
 * and one exact path in shared/website-routes.ts (scripts/teacher-settings-groups.test.cjs fails if they disagree).
 */
export const teacherSettingsRoot = '/teacher/settings';
/** Labels come from the locale keys ts.<key>.title and ts.<key>.hint. */
export type TeacherSettingsSection = { key: 'account' | 'language' | 'notifications'; href: string };
export const teacherSettingsSections: readonly TeacherSettingsSection[] = [
  { key: 'account', href: '/teacher/settings/account' },
  { key: 'language', href: '/teacher/settings/language' },
  { key: 'notifications', href: '/teacher/settings/notifications' },
];
export const teacherSettingsPaths: readonly string[] = [teacherSettingsRoot, ...teacherSettingsSections.map(s => s.href)];

/** The section an address belongs to (the root has none). Exact matches only. */
export function settingsSectionFor(pathname: string): TeacherSettingsSection | null {
  return teacherSettingsSections.find(s => s.href === pathname) ?? null;
}
