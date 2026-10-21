'use client';
import { useEffect, useState } from 'react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { languages } from '@/shared/language';
export function LanguageSettings() {
 const { language, setLanguage, storageError } = useLanguage();
 const [mounted, setMounted] = useState(false);
 useEffect(() => setMounted(true), []);
 return <section aria-labelledby="language-title" className="rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6">
  <h2 id="language-title" className="font-display text-2xl"><L id="language.title"/></h2>
  <p className="mt-3 text-sm text-muted-foreground"><L id="language.description"/></p>
  <fieldset disabled={!mounted} aria-describedby="language-scope" className="mt-5"><legend className="sr-only"><L id="language.mode"/></legend><div className="grid gap-3 sm:grid-cols-2">
   {languages.map(value => <label key={value} lang={value} dir={value === 'ar' ? 'rtl' : 'ltr'} className={'relative flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ' + (mounted && language === value ? 'border-black bg-primary text-primary-foreground shadow-hard-sm' : 'border-border bg-card text-card-foreground hover:bg-accent')}>
    <input type="radio" name="lms-language" aria-label={value === 'ar' ? 'العربية' : 'English'} value={value} checked={mounted && language === value} onChange={() => setLanguage(value)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--ring))]"/>
    <span><span className="font-bold">{value === 'ar' ? 'العربية' : 'English'}</span><span className="mt-2 block text-xs leading-relaxed"><L id={value === 'ar' ? 'language.arabicDescription' : 'language.englishDescription'}/></span></span>
   </label>)}
  </div></fieldset>
  <p id="language-scope" className="mt-4 text-sm text-muted-foreground"><L id="language.scope"/></p>
  <p role="status" className="sr-only"><L id={mounted ? 'language.active' : 'language.loading'}/></p>
  {storageError && <p role="alert" className="mt-3 text-sm text-amber-800"><L id="language.blocked"/></p>}
 </section>;
}
