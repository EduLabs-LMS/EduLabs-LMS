'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type RowDrag = { scope: string; id: string; from: number; to: number };

/**
 * Drag a row up or down inside its list, from its handle. Rows are marked data-drag-row and are direct children of one list. Nothing slides: the row dims and a line shows where it will land,
 * so there is no animation to turn off for reduced motion, and up and down are the same in both directions of text. Escape cancels; the list only changes on a drop.
 */
export function useRowDrag(onDrop: (scope: string, from: number, to: number) => void) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => () => stop.current?.(), []);

  const start = useCallback((event: ReactPointerEvent<HTMLElement>, scope: string, id: string) => {
    if (event.button !== 0 || stop.current) return;
    const handle = event.currentTarget, row = handle.closest<HTMLElement>('[data-drag-row]'), list = row?.parentElement;
    if (!row || !list) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const rows = Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-drag-row'));
    const from = rows.indexOf(row), startY = event.clientY, pointer = event.pointerId;
    let lastY = startY, active = false, to = from, frame = 0;

    const measure = () => {
      let next = 0;
      rows.forEach((other, i) => { if (i === from) return; const box = other.getBoundingClientRect(); if (lastY > box.top + box.height / 2) next++; });
      to = next;
      setDrag({ scope, id, from, to });
    };
    const scroll = () => {
      if (active) {
        const edge = 56, step = lastY < edge ? -10 : lastY > window.innerHeight - edge ? 10 : 0;
        if (step) { window.scrollBy(0, step); measure(); }
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      lastY = e.clientY;
      if (!active && Math.abs(lastY - startY) < 4) return;
      active = true;
      measure();
    };
    const finish = (commit: boolean) => {
      stop.current?.();
      setDrag(null);
      if (commit && active && to !== from) drop.current(scope, from, to);
    };
    const up = (e: PointerEvent) => { if (e.pointerId === pointer) finish(true); };
    const cancel = (e: PointerEvent) => { if (e.pointerId === pointer) finish(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };

    try { handle.setPointerCapture(pointer); } catch { /* the pointer is gone: the listeners below simply never fire */ }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    const select = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    frame = requestAnimationFrame(scroll);
    stop.current = () => {
      stop.current = null;
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      document.body.style.userSelect = select;
      try { handle.releasePointerCapture(pointer); } catch { /* already released */ }
    };
  }, []);

  return { drag, start };
}

/** Where the line goes on a row while another row is dragged over the list. */
export function dropSide(drag: RowDrag | null, scope: string, index: number): 'before' | 'after' | undefined {
  if (!drag || drag.scope !== scope || drag.to === drag.from || index !== drag.to) return undefined;
  return drag.to < drag.from ? 'before' : 'after';
}
