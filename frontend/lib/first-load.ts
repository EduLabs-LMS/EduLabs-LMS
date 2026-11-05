/**
 * The EduLabs logo animation plays to its full end at two moments (owner decisions, DECISIONS.md), and everything after it is the app frame with a skeleton of the page:
 *
 * 1. A fresh opening of the site, on any route: the first full page load in a browser tab. See "The opening" at the end of this file.
 * 2. "First load after sign-in", below.
 *
 * The sign-in code marks the moment; the loading provider plays the overlay once and clears the mark. The mark lives in sessionStorage only so a
 * full page load in the middle of signing in (the Google redirect) still counts; a later reload, a new tab or a restored session never replays it,
 * and signing out removes it. It carries no user data.
 */
const KEY = 'edulabs-first-load';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; } };

/**
 * Signing in changes the user, and the app tree is keyed on the user (FirebaseBridge), so the whole tree - the loading provider included - is
 * mounted again in the middle of the sign-in handler. A handler that captured the old provider would then talk to a dead instance. The mark is
 * therefore announced on `window`, and whichever provider is mounted at that moment starts the overlay.
 */
export const FIRST_LOAD_EVENT = 'edulabs:first-load';

export function markFirstLoad(storage: Store | null = store()) {
  try { storage?.setItem(KEY, 'pending'); } catch { /* private mode: the overlay is then simply skipped */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(FIRST_LOAD_EVENT)); } catch { /* no window: nothing is listening */ }
}
export function firstLoadPending(storage: Store | null = store()) {
  try { return storage?.getItem(KEY) === 'pending'; } catch { return false; }
}
export function clearFirstLoad(storage: Store | null = store()) {
  try { storage?.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** After the animation ends, the longest the logo waits for the first page's address. A slow page then shows the frame and its own skeleton: the logo never hangs. */
export const FIRST_LOAD_ARRIVAL_CAP_MS = 5000;
/** If the browser never reports the animation as finished, the logo stops waiting for it after this long (the animation itself takes about 1.9 s). */
export const FIRST_LOAD_PLAY_FALLBACK_MS = 3000;
/** With reduced motion nothing moves: the still logo holds this long, then the page shows. */
export const FIRST_LOAD_REDUCED_MS = 600;
/** A last moment on the finished logo before the overlay fades (its fade is another 250 ms). */
export const FIRST_LOAD_FINISH_MS = 50;
/**
 * The opening. A small script in the <head> of the root layout decides before anything paints. Once a tab has been opened the word stays in sessionStorage, so a reload
 * or in-app navigation in that tab never plays it again, and a new tab does. The value holds no personal data. With storage blocked or JavaScript off the script
 * cannot tell, and the logo is skipped rather than repeated. The flag is written here and not when the animation ends, so a page that breaks can never replay it forever.
 */
export const FIRST_OPEN_KEY = 'edulabs-opened';
export const FIRST_OPEN_ATTRIBUTE = 'data-first-open';
/** Announced on window when the opening logo starts to fade: the page's own entry can begin. */
export const FIRST_OPEN_DONE_EVENT = 'edulabs:first-open-done';
/** The fade at the end, the same as the CSS in app/globals.css. */
export const FIRST_OPEN_FADE_MS = 250;
export const firstOpenScript = `(function(){try{var s=window.sessionStorage;if(s.getItem('${FIRST_OPEN_KEY}'))return;s.setItem('${FIRST_OPEN_KEY}','1');document.documentElement.setAttribute('${FIRST_OPEN_ATTRIBUTE}','1')}catch(e){}})();`;
/** True from the first byte until the opening logo starts to fade. */
export const firstOpenActive = () => typeof document !== 'undefined' && document.documentElement.getAttribute(FIRST_OPEN_ATTRIBUTE) === '1';

/** The sign-in pages the first load starts from: the first page has arrived once the address has left them. */
export const firstLoadWaitsForAddress = (path: string) => path === '/' || path === '/sign-in' || path.startsWith('/sign-in/') || path === '/sign-up' || path.startsWith('/sign-up/');
