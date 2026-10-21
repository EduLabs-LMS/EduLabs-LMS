'use client';
import { usePathname } from 'next/navigation';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, forwardRef } from 'react';
import { isLanguage, languageBootstrap, languageCookieKey, languageDirection, languageStorageKey, type Language } from '@/shared/language';
import { messages, type MessageKey, translate, translateUi } from '@/frontend/locales/messages';
const LanguageContext = createContext({ language: 'en' as Language, setLanguage: (_value: Language) => {}, storageError: false });
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export function LanguageProvider({ children, initialLanguage = 'en' }: { children: React.ReactNode; initialLanguage?: Language }) {
 const pathname = usePathname();
 const [language, update] = useState<Language>(initialLanguage), [storageError, setStorageError] = useState(false);
 useBrowserLayoutEffect(() => {
  try { const value = localStorage.getItem(languageStorageKey); update(isLanguage(value) ? value : 'en'); }
  catch { setStorageError(true); }
 }, []);
 useBrowserLayoutEffect(() => {
  document.documentElement.lang = language;
  document.documentElement.dir = languageDirection(language);
  delete document.documentElement.dataset.languagePending;
 }, [language]);
 useEffect(() => {
  const changed = (event: StorageEvent) => {
   if (event.key !== null && event.key !== languageStorageKey) return;
   const next = isLanguage(event.newValue) ? event.newValue : 'en';
   update(next);
   document.cookie = `${languageCookieKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
 }, []);
 useEffect(() => {
  const titles: Record<string, MessageKey> = { '/settings':'navigation.settings','/personalization':'navigation.settings','/home':'navigation.home','/self-learning':'navigation.self_learning','/exams':'navigation.exams','/notifications':'settings.notifications','/support':'navigation.support' };
  if (pathname && titles[pathname]) document.title = translate(language, titles[pathname]) + ' | EduLabs';
 }, [language, pathname]);
 const value = useMemo(() => ({ language, storageError, setLanguage(next: Language) {
  if (!isLanguage(next)) return;
  update(next);
  let saved = false;
  try { localStorage.setItem(languageStorageKey, next); saved = localStorage.getItem(languageStorageKey) === next; setStorageError(!saved); }
  catch { setStorageError(true); }
  if (saved) document.cookie = `${languageCookieKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
 } }), [language, storageError]);
 return <><script data-lms-language-bootstrap dangerouslySetInnerHTML={{ __html: languageBootstrap }} /><LanguageContext.Provider value={value}>{children}</LanguageContext.Provider></>;
}
export function useLanguage() {
 const state = useContext(LanguageContext);
 return { ...state, direction: languageDirection(state.language), t: (key: MessageKey, values?: Record<string, string | number>) => translate(state.language, key, values), ui: (text: string) => translateUi(state.language, text), number: (n: number) => new Intl.NumberFormat(state.language).format(n) };
}
/** Explicit platform copy only. Never pass teacher/student content to this component. */
export function L({ id, values, text }: { id?: MessageKey; values?: Record<string, string | number>; text?: string }) {
 const { language } = useLanguage();
 return <>{id ? translate(language, id, values) : translateUi(language, text ?? '')}</>;
}
/** No extra DOM; preserves refs/handlers when localizing native or shared controls. */
type LocalizedProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { as: React.ElementType; labels: Record<string, MessageKey>; size?: string | number; variant?: string; referrerPolicy?: React.HTMLAttributeReferrerPolicy; unoptimized?: boolean; fill?: boolean; side?: string; align?: string; allow?: string; allowFullScreen?: boolean; collisionPadding?: number };
export const Localized = forwardRef<HTMLElement, LocalizedProps>(function Localized({ as, labels, ...props }, ref) {
 const { t } = useLanguage();
 return React.createElement(as, { ...props, ...Object.fromEntries(Object.entries(labels).map(([name, key]) => [name, t(key)])), ref });
});
export function LocalDate({ value, options, compactUtc = false }: { value: string; options?: Intl.DateTimeFormatOptions; compactUtc?: boolean }) {
 const { language } = useLanguage();
 return <bdi>{compactUtc && language==='en' ? new Date(value).toISOString().slice(0,16).replace('T',' ')+' UTC' : new Date(value).toLocaleString(language, options)}</bdi>;
}
export function LocalCount({ count, noun }: { count: number; noun: 'lessons' | 'parts' | 'notifications' | 'questions' | 'pendingHomework' }) {
 const { language, number } = useLanguage();
 const category = new Intl.PluralRules(language).select(count);
 return <>{translate(language, `counts.${noun}.${category}` as MessageKey, { count: number(count) })}</>;
}
export { messages };

/** Localized presentation only; timestamps and attempt limits stay unchanged. */
export function LocalDuration({ seconds }: { seconds: number | null }) {
 const { language, ui } = useLanguage();
 if (seconds === null) return <>{ui('No time limit')}</>;
 if (language === 'en') {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return <>{seconds < 60 ? `${seconds} sec` : m < 60 ? `${m} min${s ? ` ${s} sec` : ''}` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}</>;
 }
 const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour';
 return <>{new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 1 }).format(seconds / (unit === 'second' ? 1 : unit === 'minute' ? 60 : 3600))}</>;
}
export function LocalAttempts({ count }: { count: number | null }) {
 return count === null ? <L id="exam.attemptLimitUnknown"/> : count === 1 ? <L id="exam.oneAllowed"/> : <L id="exam.attemptsAllowed" values={{ count }}/>;
}
export function LocalSessionDate({ value, englishFallback }: { value: string | Date; englishFallback: string }) {
 const { language } = useLanguage();
 const date = new Date(value);
 return <bdi>{language==='en'||!Number.isFinite(date.getTime()) ? englishFallback : date.toLocaleString(language,{dateStyle:'full',timeStyle:'short',timeZone:'Africa/Cairo'})}</bdi>;
}
