'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { motionOn } from '@/frontend/lib/motion';

const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const SLIDE_MS = 220;

type Box = { x: number; y: number; width: number };

/** Where the underline sits inside the container, measured so that scrolling and a right-to-left page do not change it. */
function boxOf(element: Element, container: HTMLElement): Box {
  const e = element.getBoundingClientRect(), c = container.getBoundingClientRect();
  return { x: e.left - c.left - container.clientLeft + container.scrollLeft, y: e.top - c.top - container.clientTop + container.scrollTop + e.height - 2, width: e.width };
}

/**
 * The tab underline slides to the new tab. The menu does not: it changes in place (owner decision, DECISIONS.md, design-components.css).
 * The markup is always right by itself: the real tab paints the underline, in the server's HTML, in Classic and with reduced motion. For the moment of a slide in New, a stand-in
 * moves from the old place to the new one (transform only) and the real underline waits; it paints again when the slide ends. CSS keeps the stand-in hidden otherwise.
 */
export function useSlidingIndicator<T extends HTMLElement>(active: string, key: string) {
  const container = useRef<T>(null);
  const slider = useRef<HTMLSpanElement>(null);
  const last = useRef<Box | null>(null);
  useBeforePaint(() => {
    const parent = container.current, moving = slider.current;
    if (!parent || !moving) return;
    const target = parent.querySelector(active);
    const to = target ? boxOf(target, parent) : null;
    const from = last.current;
    last.current = to;
    if (!to || !from || !to.width || !from.width || (to.x === from.x && to.y === from.y) || !motionOn()) return;
    moving.style.cssText = `left:${to.x}px;top:${to.y}px;width:${to.width}px;height:2px;transform-origin:0 0;transform:translate(${from.x - to.x}px,${from.y - to.y}px) scale(${from.width / to.width},1)`;
    parent.setAttribute('data-sliding', '');
    void moving.getBoundingClientRect(); // the browser has to see the start before it can animate to the end
    moving.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    moving.style.transform = 'none';
    const end = () => { window.clearTimeout(timer); moving.removeEventListener('transitionend', end); parent.removeAttribute('data-sliding'); moving.style.cssText = ''; };
    const timer = window.setTimeout(end, SLIDE_MS + 100);
    moving.addEventListener('transitionend', end);
    return end;
  }, [active, key]);
  return { container, slider };
}
