'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Languages } from 'lucide-react';
import { ar } from './translations';

export type Locale = 'en' | 'ar';
const Context = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: 'en', setLocale: () => {} });
export function Preferences({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.cookie = `edulabs-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }, [locale]);
  return <Context.Provider value={{ locale, setLocale }}>{children}</Context.Provider>;
}
export function useLocale() {
  const context = useContext(Context);
  return { ...context, t: (text: string) => context.locale === 'ar' ? ar[text] ?? text : text };
}
/** Usable from server components; application data itself is never translated. */
export function T({ children, arabic }: { children: string; arabic?: string }) {
  const { locale, t } = useLocale();
  return <>{locale === 'ar' && arabic ? arabic : t(children)}</>;
}
export function PreferenceControls() {
  const { locale, setLocale, t } = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  return <div className="edu-tools">
    <button type="button" className="edu-icon-btn" aria-label={t('Change language')} onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}><Languages size={18} /><span>{locale === 'en' ? 'العربية' : 'English'}</span></button>
    <button type="button" className="edu-icon-btn" aria-label={t(dark ? 'Switch to light mode' : 'Switch to dark mode')} aria-pressed={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
  </div>;
}
