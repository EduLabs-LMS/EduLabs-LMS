'use client';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FIRST_OPEN_DONE_EVENT, firstOpenActive } from '@/frontend/lib/first-load';
import { motionOn } from '@/frontend/lib/motion';

const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How long main[data-enter] stays once the page has arrived: the longest stagger and the rise fit inside it. After that nothing on the page can animate its way in. */
export const PAGE_ENTRY_MS = 700;
/** A page whose skeleton never leaves does not keep the attribute forever. */
export const PAGE_ENTRY_HOLD_CAP_MS = 10000;
const COUNT_MS = 250;
const BUSY = '[data-skeleton], [data-state="loading"]';

// One page at a time, and it outlives the frame: signing in or restoring a session mounts the whole tree again (FirebaseBridge), which is not a new page.
let lastPath: string | null = null;
let entryOpen = false;
let counting = false;

/**
 * Called while the frame renders, so a page's first render already knows: components below the frame run their effects first.
 * The first render of a document counts up only behind the opening logo. After a reload the numbers have already been painted by the server, and counting from zero would show them twice.
 */
export function notePageRender(pathname: string) {
  if (typeof window === 'undefined') return;
  if (lastPath === null) { lastPath = pathname; entryOpen = true; counting = firstOpenActive(); return; }
  if (lastPath !== pathname) { lastPath = pathname; entryOpen = true; counting = true; }
}

/**
 * The window for "a page's first render". The attribute is in the server's markup for the first page, and the CSS keyed on it animates what is on the page.
 * It stays while the page shows a skeleton, so the real content rises when it arrives, then goes. A data refresh after that cannot animate anything: nothing matches.
 */
export function usePageEntry(main: RefObject<HTMLElement>, pathname: string) {
  useBeforePaint(() => {
    const element = main.current;
    if (!element) return;
    if (!entryOpen) { element.removeAttribute('data-enter'); return; }
    element.setAttribute('data-enter', '');
    let observer: MutationObserver | undefined;
    let cap: number | undefined;
    let timer: number | undefined;
    const close = () => { observer?.disconnect(); window.clearTimeout(cap); element.removeAttribute('data-enter'); entryOpen = false; counting = false; };
    const settle = () => {
      if (timer !== undefined || element.querySelector(BUSY)) return;
      observer?.disconnect();
      timer = window.setTimeout(close, PAGE_ENTRY_MS);
    };
    const start = () => {
      observer = new MutationObserver(settle);
      observer.observe(element, { childList: true, subtree: true });
      cap = window.setTimeout(close, PAGE_ENTRY_HOLD_CAP_MS);
      settle();
    };
    if (firstOpenActive()) window.addEventListener(FIRST_OPEN_DONE_EVENT, start, { once: true });
    else start();
    return () => {
      window.removeEventListener(FIRST_OPEN_DONE_EVENT, start);
      observer?.disconnect();
      window.clearTimeout(cap);
      window.clearTimeout(timer);
    };
  }, [main, pathname]);
}

/**
 * A summary number rises to its value when the page first shows, and shows the plain value at any other time: on the server, in Classic, with reduced motion, after a reload
 * and when the value changes later. Only a page's first render counts, so a number that arrives with a refresh just appears.
 */
export function useCountUp(value: number) {
  const [shown, setShown] = useState<number | null>(null);
  const target = useRef(value);
  target.current = value;
  useBeforePaint(() => {
    if (!counting || !motionOn() || value <= 0) return;
    let frame = 0;
    const run = () => {
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - started) / COUNT_MS, 1);
        if (progress >= 1) { setShown(null); return; }
        setShown(Math.round(target.current * (1 - (1 - progress) ** 3)));
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };
    setShown(0);
    if (firstOpenActive()) window.addEventListener(FIRST_OPEN_DONE_EVENT, run, { once: true });
    else run();
    return () => { window.removeEventListener(FIRST_OPEN_DONE_EVENT, run); window.cancelAnimationFrame(frame); setShown(null); };
    // Once, when the number first appears. Later changes of the value show as they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown ?? value;
}
