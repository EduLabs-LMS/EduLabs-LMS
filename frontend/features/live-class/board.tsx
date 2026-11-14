'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, FilePlus2, Download, Pencil, Redo2, Trash2, Undo2, RotateCcw } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/design/button';
import { Dialog } from '@/frontend/components/design/dialog';
import { Icon } from '@/frontend/components/design/icon';
import { cn } from '@/shared/utils';

/** One stroke: pen or eraser, its colour and width, and its points as x, y, pressure, all in PAGE units (see PAGE_W). */
export type Stroke = { tool: 'pen' | 'eraser'; color: string; width: number; points: number[] };
type Page = { strokes: Stroke[]; redo: Stroke[] };
type Saved = { v: 2; page: number; pages: Stroke[][] };

/**
 * Every page is the same fixed 16:9 page (the shape of the shared screen students receive), shown as large as the window allows with bands
 * around it. A resize or a rotation scales the drawing; it never cuts it off. A saved picture is always PAGE_W x PAGE_H.
 */
export const PAGE_W = 1600, PAGE_H = 900;

export const BOARD_COLORS = [
  { value: '#111111', key: 'board.color.black' },
  { value: '#1d4ed8', key: 'board.color.blue' },
  { value: '#dc2626', key: 'board.color.red' },
  { value: '#15803d', key: 'board.color.green' },
  { value: '#ea580c', key: 'board.color.orange' },
  { value: '#7c3aed', key: 'board.color.purple' },
] as const;
export const BOARD_WIDTHS = [
  { value: 3, key: 'board.width.thin' },
  { value: 6, key: 'board.width.medium' },
  { value: 12, key: 'board.width.thick' },
] as const;
/** The eraser is wider than the pen it follows. */
const ERASER_SCALE = 4;
export const MAX_PAGES = 50;
export const boardStorageKey = (sessionId: string) => `edulabs-board:${sessionId}`;

/** A saved board as it was written, or null when it is not one (an older or broken value is ignored, never trusted). */
export function parseSavedBoard(raw: string | null): Saved | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  const s = v as Partial<Saved> | null;
  if (!s || s.v !== 2 || !Array.isArray(s.pages) || !s.pages.length || s.pages.length > MAX_PAGES) return null;
  const colors: readonly string[] = BOARD_COLORS.map(c => c.value);
  const ok = s.pages.every(p => Array.isArray(p) && p.every(st => st && (st.tool === 'pen' || st.tool === 'eraser') && colors.includes(st.color)
    && typeof st.width === 'number' && st.width > 0 && st.width <= 64 && Array.isArray(st.points) && st.points.length % 3 === 0 && st.points.every(n => typeof n === 'number' && Number.isFinite(n))));
  if (!ok) return null;
  const page = Number.isInteger(s.page) && (s.page as number) >= 0 && (s.page as number) < s.pages.length ? s.page as number : 0;
  return { v: 2, page, pages: s.pages };
}

/** The drawn width at one point: pressure 0.5 (a mouse, or a finger) draws the chosen width; a pen draws thinner or thicker. */
const sized = (stroke: Stroke, pressure: number) => (stroke.tool === 'eraser' ? stroke.width * ERASER_SCALE : stroke.width * (0.4 + 1.2 * pressure));

/** Draws points [from, end) of a stroke (from 0: the whole stroke, starting with a dot). */
function paint(ctx: CanvasRenderingContext2D, stroke: Stroke, from = 0) {
  const p = stroke.points;
  if (p.length < 3) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (from === 0) {
    ctx.beginPath(); ctx.arc(p[0], p[1], sized(stroke, p[2]) / 2, 0, Math.PI * 2); ctx.fill();
    from = 3;
  }
  // One path while the width stays the same (a mouse or a finger: the whole stroke), so the round ends of short pieces do not overlap into beads.
  let width = -1;
  for (let i = Math.max(from, 3); i < p.length; i += 3) {
    const w = Math.round(sized(stroke, (p[i - 1] + p[i + 2]) / 2) * 4) / 4;
    if (w !== width) {
      if (width > 0) ctx.stroke();
      width = w; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(p[i - 3], p[i - 2]);
    }
    ctx.lineTo(p[i], p[i + 1]);
  }
  if (width > 0) ctx.stroke();
  ctx.restore();
}

/**
 * The Board (/class/<session>/board): a white page the teacher draws on and shares into the class with Share screen, like a PDF. Students never
 * reach it (the server answers 404 to anyone but the Group's staff) and only ever see it as video. Nothing is sent anywhere: the pages are kept in
 * this browser under the Session, and "New board" deletes them.
 *
 * Input: Pointer Events for pen, mouse and touch, with pressure and the browser's coalesced points; drawing happens once per frame, outside React.
 * A resting hand does not draw: while a pen is down or hovering, and once a pen has been used on this page, touch is ignored (a device without a pen
 * draws with a finger).
 */
export function Board({ sessionId }: { sessionId: string }) {
  const { t } = useLanguage();
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pages = useRef<Page[]>([{ strokes: [], redo: [] }]);
  const current = useRef(0);
  const tool = useRef<{ tool: 'pen' | 'eraser'; color: string; width: number }>({ tool: 'pen', color: BOARD_COLORS[0].value, width: BOARD_WIDTHS[1].value });
  const [view, setView] = useState({ tool: 'pen' as 'pen' | 'eraser', color: BOARD_COLORS[0].value as string, width: BOARD_WIDTHS[1].value as number });
  const [nav, setNav] = useState({ page: 0, count: 1, undo: false, redo: false });
  const [storage, setStorage] = useState<'local' | 'session' | 'none'>('local');
  const [confirm, setConfirm] = useState<null | 'clear' | 'new'>(null);
  const [loaded, setLoaded] = useState(false);
  const key = boardStorageKey(sessionId);

  const sync = useCallback(() => {
    const p = pages.current[current.current];
    setNav({ page: current.current, count: pages.current.length, undo: p.strokes.length > 0, redo: p.redo.length > 0 });
  }, []);

  const redraw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
    for (const s of pages.current[current.current].strokes) paint(ctx, s);
  }, []);

  /** Kept in this browser: localStorage, else sessionStorage (this tab only), else nowhere, and the page says so. */
  const persist = useCallback(() => {
    const value = JSON.stringify({ v: 2, page: current.current, pages: pages.current.map(p => p.strokes) } satisfies Saved);
    try { localStorage.setItem(key, value); setStorage('local'); return; } catch { /* full or blocked */ }
    try { sessionStorage.setItem(key, value); setStorage('session'); return; } catch { /* full or blocked */ }
    setStorage('none');
  }, [key]);

  // Load once.
  useEffect(() => {
    let saved: Saved | null = null;
    try { saved = parseSavedBoard(localStorage.getItem(key)); } catch { /* blocked */ }
    if (!saved) try { saved = parseSavedBoard(sessionStorage.getItem(key)); } catch { /* blocked */ }
    if (saved) { pages.current = saved.pages.map(strokes => ({ strokes, redo: [] })); current.current = saved.page; }
    setLoaded(true);
    sync();
  }, [key, sync]);

  // The page is fitted into the drawing area (largest 16:9 that fits, centred); device pixels for sharp lines; drawing is in page units.
  useEffect(() => {
    const a = area.current, c = canvas.current;
    if (!a || !c) return;
    const fit = () => {
      const r = a.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const scale = Math.max(0.01, Math.min(r.width / PAGE_W, r.height / PAGE_H));
      const w = Math.floor(PAGE_W * scale), h = Math.floor(PAGE_H * scale);
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      c.getContext('2d')?.setTransform(c.width / PAGE_W, 0, 0, c.height / PAGE_H, 0, 0);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(a);
    return () => ro.disconnect();
  }, [redraw, loaded]);

  // Drawing: native listeners, one stroke at a time, painted once per frame.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let active: { id: number; type: string; stroke: Stroke; drawn: number } | null = null;
    let penSeen = false, penDown = false, frame = 0;
    const flush = () => {
      frame = 0;
      const ctx = c.getContext('2d');
      if (!ctx || !active) return;
      paint(ctx, active.stroke, active.drawn);
      active.drawn = active.stroke.points.length;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      // A mouse or a finger reports 0.5 while pressed (or 0 on some browsers); a pen reports its real pressure.
      const pressure = e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
      const x = (e.clientX - r.left) * PAGE_W / r.width, y = (e.clientY - r.top) * PAGE_H / r.height;
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100];
    };
    const cancel = () => {
      if (!active) return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      try { c.releasePointerCapture(active.id); } catch { /* already released */ }
      active = null;
      redraw();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'pen') { penSeen = true; penDown = true; }
      if (e.pointerType === 'touch' && (penSeen || penDown)) return; // palm or resting hand
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (active) {
        if (e.pointerType === 'pen' && active.type === 'touch') cancel(); // the hand landed first: the pen wins
        else return; // one stroke at a time (a second finger does not draw)
      }
      e.preventDefault();
      const t0 = tool.current;
      active = { id: e.pointerId, type: e.pointerType, stroke: { tool: t0.tool, color: t0.color, width: t0.width, points: at(e) }, drawn: 0 };
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      schedule();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'pen') penSeen = true; // hovering counts
      if (!active || e.pointerId !== active.id) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) active.stroke.points.push(...at(ev));
      schedule();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'pen') penDown = false;
      if (!active || e.pointerId !== active.id) return;
      if (e.type === 'pointercancel') { cancel(); return; }
      if (frame) { cancelAnimationFrame(frame); }
      flush();
      const page = pages.current[current.current];
      page.strokes.push(active.stroke); page.redo = [];
      try { c.releasePointerCapture(active.id); } catch { /* already released */ }
      active = null;
      persist(); sync();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
  }, [persist, redraw, sync, loaded]);

  const choose = (next: Partial<typeof view>) => { tool.current = { ...tool.current, ...next }; setView(tool.current); };
  const undo = () => { const p = pages.current[current.current]; const s = p.strokes.pop(); if (s) { p.redo.push(s); redraw(); persist(); sync(); } };
  const redo = () => { const p = pages.current[current.current]; const s = p.redo.pop(); if (s) { p.strokes.push(s); redraw(); persist(); sync(); } };
  const go = (page: number) => { if (page < 0 || page >= pages.current.length) return; current.current = page; redraw(); persist(); sync(); };
  const addPage = () => { if (pages.current.length >= MAX_PAGES) return; pages.current.splice(current.current + 1, 0, { strokes: [], redo: [] }); go(current.current + 1); };
  const clearPage = () => { pages.current[current.current] = { strokes: [], redo: [] }; redraw(); persist(); sync(); };
  const newBoard = () => {
    pages.current = [{ strokes: [], redo: [] }]; current.current = 0;
    try { localStorage.removeItem(key); } catch { /* blocked */ }
    try { sessionStorage.removeItem(key); } catch { /* blocked */ }
    redraw(); setStorage('local'); sync();
  };
  /** The page as a picture, PAGE_W x PAGE_H whatever the window: the drawing on white (the eraser leaves holes, which become white). */
  const savePicture = () => {
    const layer = document.createElement('canvas'), out = document.createElement('canvas');
    layer.width = out.width = PAGE_W; layer.height = out.height = PAGE_H;
    const lc = layer.getContext('2d'), ctx = out.getContext('2d');
    if (!lc || !ctx) return;
    for (const s of pages.current[current.current].strokes) paint(lc, s);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.drawImage(layer, 0, 0);
    out.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `board-page-${current.current + 1}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo (not while a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirm || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (pressed: boolean) => cn('d-btn', 'd-btn--icon', 'd-board-tool', pressed && 'd-board-tool--on');
  // data-teacher-shell: the staff look (Classic or New) applies here as in the teacher frame.
  return <main data-board data-teacher-shell className="d-board" data-tool={view.tool}>
    <div role="toolbar" aria-label={t('board.toolbar')} className="d-board-bar">
      <div className="d-board-group">
        <button type="button" data-tool-pen className={toggle(view.tool === 'pen')} aria-pressed={view.tool === 'pen'} aria-label={t('board.pen')} title={t('board.pen')} onClick={() => choose({ tool: 'pen' })}><Pencil aria-hidden size={20} /></button>
        <button type="button" data-tool-eraser className={toggle(view.tool === 'eraser')} aria-pressed={view.tool === 'eraser'} aria-label={t('board.eraser')} title={t('board.eraser')} onClick={() => choose({ tool: 'eraser' })}><Eraser aria-hidden size={20} /></button>
      </div>
      <div className="d-board-group" role="group" aria-label={t('board.colors')}>
        {BOARD_COLORS.map(c => <button key={c.value} type="button" data-color={c.value} className={toggle(view.color === c.value)} aria-pressed={view.color === c.value} aria-label={t(c.key)} title={t(c.key)} onClick={() => choose({ color: c.value, tool: 'pen' })}>
          <span aria-hidden className="d-board-swatch" style={{ background: c.value }} />
        </button>)}
      </div>
      <div className="d-board-group" role="group" aria-label={t('board.widths')}>
        {BOARD_WIDTHS.map(w => <button key={w.value} type="button" data-width={w.value} className={toggle(view.width === w.value)} aria-pressed={view.width === w.value} aria-label={t(w.key)} title={t(w.key)} onClick={() => choose({ width: w.value })}>
          <span aria-hidden className="d-board-dot" style={{ width: w.value + 4, height: w.value + 4 }} />
        </button>)}
      </div>
      <div className="d-board-group">
        <Button variant="icon" data-undo aria-label={t('board.undo')} title={t('board.undo')} disabled={!nav.undo} onClick={undo}><Undo2 aria-hidden size={20} className="d-board-flip" /></Button>
        <Button variant="icon" data-redo aria-label={t('board.redo')} title={t('board.redo')} disabled={!nav.redo} onClick={redo}><Redo2 aria-hidden size={20} className="d-board-flip" /></Button>
        <Button variant="icon" data-clear aria-label={t('board.clear')} title={t('board.clear')} disabled={!nav.undo} onClick={() => setConfirm('clear')}><Trash2 aria-hidden size={20} /></Button>
      </div>
      <div className="d-board-group" role="group" aria-label={t('board.pages')}>
        <Button variant="icon" data-prev aria-label={t('board.prev')} title={t('board.prev')} disabled={nav.page === 0} onClick={() => go(current.current - 1)}><Icon name="back" size={20} /></Button>
        <span data-page-label className="d-board-page" aria-live="polite"><L id="board.page_of" values={{ page: nav.page + 1, count: nav.count }} /></span>
        <Button variant="icon" data-next aria-label={t('board.next')} title={t('board.next')} disabled={nav.page >= nav.count - 1} onClick={() => go(current.current + 1)}><Icon name="chevron" size={20} /></Button>
        <Button variant="icon" data-add-page aria-label={t('board.add_page')} title={t('board.add_page')} disabled={nav.count >= MAX_PAGES} onClick={addPage}><FilePlus2 aria-hidden size={20} /></Button>
      </div>
      <div className="d-board-group">
        <Button data-save-picture onClick={savePicture}><Download aria-hidden size={18} /><span><L id="board.save" /></span></Button>
        <Button data-new-board onClick={() => setConfirm('new')}><RotateCcw aria-hidden size={18} /><span><L id="board.new" /></span></Button>
      </div>
    </div>
    {storage !== 'local' && <p role="status" data-storage={storage} className="d-board-note"><L id={storage === 'session' ? 'board.saved_tab' : 'board.not_saved'} /></p>}
    <div ref={area} className="d-board-area" dir="ltr">
      <canvas ref={canvas} data-board-canvas aria-label={t('board.canvas')} role="img" className="d-board-canvas" />
    </div>
    <p className="d-board-hint"><L id="board.share_hint" /></p>
    <Dialog open={confirm !== null} onOpenChange={o => { if (!o) setConfirm(null); }} data-board-confirm={confirm ?? undefined}
      title={<L id={confirm === 'new' ? 'board.new_title' : 'board.clear_title'} />}
      description={<L id={confirm === 'new' ? 'board.new_body' : 'board.clear_body'} />}
      footer={<>
        <Button onClick={() => setConfirm(null)}><L id="board.cancel" /></Button>
        <Button variant="destructive" data-confirm onClick={() => { if (confirm === 'new') newBoard(); else clearPage(); setConfirm(null); }}><L id={confirm === 'new' ? 'board.new_confirm' : 'board.clear_confirm'} /></Button>
      </>} />
  </main>;
}
