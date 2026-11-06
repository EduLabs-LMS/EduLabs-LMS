'use client';

import { ChoiceGroup } from '@/frontend/components/design/controls';
import { useTeacherSurface } from '@/frontend/components/design/surface';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { appearanceModes, appearanceStorageKey, type AppearanceMode } from '@/shared/appearance';

const options = {
 light: { label: 'Light', description: 'Always use the light EduLabs palette.', Icon: Sun },
 dark: { label: 'Dark', description: 'A softer palette for darker surroundings.', Icon: Moon },
 system: { label: 'System', description: 'Follow this device as its appearance changes.', Icon: Monitor },
};

export function AppearanceSettings() {
 const { theme, setTheme, resolvedTheme } = useTheme();
 const { t, ui } = useLanguage();
 const [mounted, setMounted] = useState(false);
 const [storageError, setStorageError] = useState(false);
 const teacher = useTeacherSurface();

 useEffect(() => {
  setMounted(true);
  try { window.localStorage.getItem(appearanceStorageKey); }
  catch { setStorageError(true); }
 }, []);

 function choose(mode: AppearanceMode) {
  setTheme(mode);
  // next-themes deliberately tolerates storage failures. Tell the user when
  // their choice works in memory but cannot survive a reload or browser exit.
  try { setStorageError(window.localStorage.getItem(appearanceStorageKey) !== mode); }
  catch { setStorageError(true); }
 }

 return <section aria-labelledby="appearance-title" className={teacher ? 'd-card d-card--pad d-stack' : 'rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6'}>
  <h2 id="appearance-title" className={teacher ? 'd-section' : 'font-display text-2xl'}><L id="settings.appearance"/></h2>
  <p id="appearance-help" className={teacher ? 'd-meta' : 'mt-3 text-sm text-muted-foreground'}><L id="settings.choose_how_edulabs_looks_on"/></p>
  <div className={teacher ? undefined : 'mt-5'}><ChoiceGroup label={t('settings.appearance_mode')} describedBy="appearance-help" disabled={!mounted} columns={3} value={mounted ? (theme as AppearanceMode) : null} onChange={choose} options={appearanceModes.map(mode => {
   const { Icon, label, description } = options[mode];
   return { value: mode, name: ui(label), label: <L text={label}/>, icon: <Icon aria-hidden className="h-5 w-5" />, description: <L text={description}/> };
  })} /></div>
  <p role="status" aria-live="polite" className={teacher ? 'd-meta' : 'mt-4 text-sm text-muted-foreground'}>{!mounted ? <L id="appearance.loading"/> : theme === 'system' ? <L id="appearance.following" values={{mode:ui(resolvedTheme === 'dark'?'Dark':'Light').toLowerCase()}}/> : <L id={theme === 'dark'?'appearance.darkActive':'appearance.lightActive'}/>}</p>
  {storageError && <p role="alert" className={teacher ? 'd-field-error' : 'mt-3 text-sm text-amber-800'}><L id="settings.this_browser_is_preventing_appearance"/></p>}
 </section>;
}
