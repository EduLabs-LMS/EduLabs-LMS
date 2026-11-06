'use client';
import { useEffect, useState } from 'react';
import { ChoiceGroup } from '@/frontend/components/design/controls';
import { useTeacherSurface } from '@/frontend/components/design/surface';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { languages } from '@/shared/language';
export function LanguageSettings() {
 const { language, setLanguage, storageError, t } = useLanguage();
 const [mounted, setMounted] = useState(false);
 const teacher = useTeacherSurface();
 useEffect(() => setMounted(true), []);
 return <section aria-labelledby="language-title" className={teacher ? 'd-card d-card--pad d-stack' : 'rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6'}>
  <h2 id="language-title" className={teacher ? 'd-section' : 'font-display text-2xl'}><L id="language.title"/></h2>
  <p className={teacher ? 'd-meta' : 'mt-3 text-sm text-muted-foreground'}><L id="language.description"/></p>
  <div className={teacher ? undefined : 'mt-5'}><ChoiceGroup label={t('language.mode')} describedBy="language-scope" disabled={!mounted} columns={2} value={mounted ? language : null} onChange={setLanguage} options={languages.map(value => ({ value, name: value === 'ar' ? 'العربية' : 'English', lang: value, dir: value === 'ar' ? 'rtl' as const : 'ltr' as const, label: value === 'ar' ? 'العربية' : 'English', description: <L id={value === 'ar' ? 'language.arabicDescription' : 'language.englishDescription'}/> }))} /></div>
  <p id="language-scope" className={teacher ? 'd-meta' : 'mt-4 text-sm text-muted-foreground'}><L id="language.scope"/></p>
  <p role="status" className="sr-only"><L id={mounted ? 'language.active' : 'language.loading'}/></p>
  {storageError && <p role="alert" className={teacher ? 'd-field-error' : 'mt-3 text-sm text-amber-800'}><L id="language.blocked"/></p>}
 </section>;
}
