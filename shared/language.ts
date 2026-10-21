/** Explicit, browser-local LMS UI language. Never an account or access claim. */
export const languageStorageKey = 'edulabs-lms-language';
export const languageCookieKey = 'edulabs_lms_language';
export const languages = ['en', 'ar'] as const;
export type Language = typeof languages[number];
export const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'ar';
export const languageDirection = (value: Language) => value === 'ar' ? 'rtl' : 'ltr';
// A same-origin, unprivileged preference cookie lets SSR render the saved language.
// If cookies/storage disagree, hide only the LMS shell until React reconciles it.
export const languageBootstrap = `try{var k='${languageStorageKey}',v=localStorage.getItem(k),l=v==='ar'?'ar':'en',h=document.documentElement;if(v!==null&&v!=='ar'&&v!=='en')localStorage.removeItem(k);if(h.lang!==l)h.dataset.languagePending='';h.lang=l;h.dir=l==='ar'?'rtl':'ltr';document.cookie='${languageCookieKey}='+l+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch(e){}`;
