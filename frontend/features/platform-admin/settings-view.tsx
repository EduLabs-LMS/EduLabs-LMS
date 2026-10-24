'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useLanguage } from '@/frontend/components/language-provider';
import { Card, CardBody, CardHead, Page, PageHeader, Segmented } from '@/frontend/design-system';
import { isAppearanceMode, type AppearanceMode } from '@/shared/appearance';
import { isLanguage, type Language } from '@/shared/language';

/** Preferences use the application's existing browser-local storage (the same keys the student Settings page uses).
 *  They are remembered per browser on this device; nothing is synchronized between devices. */
export function SettingsView() {
 const { t, language, setLanguage, storageError } = useLanguage();
 const { theme, setTheme } = useTheme();
 const [mounted, setMounted] = useState(false);
 useEffect(() => setMounted(true), []);
 // next-themes only knows the stored value after mount; showing nothing selected beats showing a wrong one.
 const appearance = mounted && isAppearanceMode(theme) ? theme : null;

 return <Page layout="regular">
  <PageHeader title={t('pa.settings.title')} intro={t('pa.settings.intro')} />
  <Card labelledBy="pa-set-language">
   <CardHead id="pa-set-language" title={t('pa.language')} />
   <CardBody>
    <p className="eds-hint">{t('pa.settings.language_hint')}</p>
    <Segmented<Language> label={t('pa.language')} value={language} onChange={(next) => { if (isLanguage(next)) setLanguage(next); }}
     options={[{ value: 'en', label: 'English', lang: 'en' }, { value: 'ar', label: 'العربية', lang: 'ar' }]} />
   </CardBody>
  </Card>
  <Card labelledBy="pa-set-appearance">
   <CardHead id="pa-set-appearance" title={t('pa.theme')} />
   <CardBody>
    <p className="eds-hint">{t('pa.settings.appearance_hint')}</p>
    <Segmented<AppearanceMode> label={t('pa.theme')} value={appearance} onChange={setTheme}
     options={[{ value: 'light', label: t('pa.theme.light') }, { value: 'dark', label: t('pa.theme.dark') }, { value: 'system', label: t('pa.theme.system') }]} />
   </CardBody>
  </Card>
  <p className="eds-hint" role={storageError ? 'alert' : undefined}>{t(storageError ? 'pa.settings.storage_error' : 'pa.settings.local_note')}</p>
 </Page>;
}
