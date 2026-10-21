'use client';

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
 const { ui } = useLanguage();
 const [mounted, setMounted] = useState(false);
 const [storageError, setStorageError] = useState(false);

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

 return <section aria-labelledby="appearance-title" className="rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6">
  <h2 id="appearance-title" className="font-display text-2xl"><L id="settings.appearance"/></h2>
  <p id="appearance-help" className="mt-3 text-sm text-muted-foreground"><L id="settings.choose_how_edulabs_looks_on"/></p>
  <fieldset disabled={!mounted} aria-describedby="appearance-help" className="mt-5">
   <legend className="sr-only"><L id="settings.appearance_mode"/></legend>
   <div className="grid gap-3 sm:grid-cols-3">
    {appearanceModes.map(mode => {
     const { Icon, label, description } = options[mode];
     const selected = mounted && theme === mode;
     return <label key={mode} className={'relative flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ' + (selected ? 'border-black bg-primary text-primary-foreground shadow-hard-sm' : 'border-border bg-card text-card-foreground hover:bg-accent')}>
      <input type="radio" aria-label={ui(label)} name="lms-appearance" value={mode} checked={selected} onChange={() => choose(mode)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--ring))]" />
      <span className="min-w-0">
       <span className="flex items-center gap-2 font-bold"><Icon aria-hidden className="h-5 w-5" /><L text={label}/></span>
       <span className="mt-2 block text-xs leading-relaxed"><L text={description}/></span>
      </span>
     </label>;
    })}
   </div>
  </fieldset>
  <p role="status" aria-live="polite" className="mt-4 text-sm text-muted-foreground">{!mounted ? <L id="appearance.loading"/> : theme === 'system' ? <L id="appearance.following" values={{mode:ui(resolvedTheme === 'dark'?'Dark':'Light').toLowerCase()}}/> : <L id={theme === 'dark'?'appearance.darkActive':'appearance.lightActive'}/>}</p>
  {storageError && <p role="alert" className="mt-3 text-sm text-amber-800"><L id="settings.this_browser_is_preventing_appearance"/></p>}
 </section>;
}
