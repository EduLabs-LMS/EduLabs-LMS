'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import Link from 'next/link';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { Button } from '@/frontend/components/design/button';
import { SearchField } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { usePhone } from '@/frontend/components/design/use-phone';
import { sessionTime } from '@/frontend/features/teacher-home/parts';
import { HelpButton } from '@/frontend/features/teacher-helper/help-button';
import { GroupCallError, groupCall, groupSave, isAbort } from '@/frontend/features/teacher-groups/api';
import { GroupError, ModeLabel } from '@/frontend/features/teacher-groups/parts';
import { AttendanceSheetSkeleton } from '@/frontend/features/teacher-attendance/skeletons';
import type { GroupPage, GroupRow, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import { studentsByName } from '@/shared/teacher-groups';
import {
  AUTO_RETRIES, MARKS_PER_SAVE, PENDING_NOTE_MS, ROSTER_PAGES, ROSTER_PAGE_SIZE, SEARCH_FROM, changedMarks, countMarks, markRestPresent, marksOf, matchesSearch, reasonValid, retryDelay, retryable, toggled,
  type Mark, type Marks,
} from '@/shared/teacher-attendance';
import { LeaveQuestion, useLeaveGuard } from './leave-guard';

type Detail = { group: StudyGroup; serverNow: string };
type Sheet = { session: GroupSession; rows: GroupRow[]; complete: boolean };
type Load<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; value: T };
type Saving = 'idle' | 'saving' | 'retrying' | 'saved' | 'error';
type Busy = null | 'finalize' | 'reopen';
type Failure = GroupCallError;
const asError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);
/** A note that a save was running, kept only for this tab and this Session, so a reload during a save can say so instead of looking like lost work. */
const noteKey = (sessionId: string) => `lms-attendance-saving:${sessionId}`;
function writeNote(sessionId: string, on: boolean) {
  try { if (on) window.sessionStorage.setItem(noteKey(sessionId), String(Date.now())); else window.sessionStorage.removeItem(noteKey(sessionId)); } catch { /* no storage: the page still shows the server's state */ }
}
function readNote(sessionId: string) {
  try { const at = Number(window.sessionStorage.getItem(noteKey(sessionId))); return Boolean(at) && Date.now() - at < PENDING_NOTE_MS; } catch { return false; }
}
/** After a reload during a save: how long to wait before asking the server again. The save may still be finishing. */
const RECHECKS = [1500, 3500, 7000];

/** One Session's list, every page of it. The database decides who may read it; a failure is an error, never an empty list. */
async function readSheet(groupId: string, sessionId: string, signal?: AbortSignal): Promise<Sheet> {
  const rows: GroupRow[] = [];
  const seen = new Set<string>();
  let session: GroupSession | undefined, hasMore = false;
  for (let page = 0; page < ROSTER_PAGES; page++) {
    const r = await groupCall<GroupPage<GroupRow>>('view', groupId, { section: sessionId, page, search: '' }, null, signal);
    if (page === 0) session = r.session;
    for (const row of r.rows) if (!seen.has(row.user_id)) { seen.add(row.user_id); rows.push(row); }
    hasMore = Boolean(r.hasMore);
    if (!hasMore) break;
  }
  if (!session) throw new GroupCallError(null);
  return { session, rows, complete: !hasMore };
}

/**
 * Every tap is saved at once by a single queue: one call carries everything that differs from what is saved (up to the 100 the database takes
 * atomically), and the next call uses the Session version the previous reply returned. A mark is never dropped: it stays on screen until the
 * database has accepted it, a failure that can pass is retried by itself with a growing wait, and the page always renders what the server holds.
 */
export function TeacherAttendanceView({ groupId, sessionId }: { groupId: string; sessionId: string }) {
  const { t } = useLanguage();
  const router = useLoadingRouter();
  const [detail, setDetail] = useState<Load<Detail>>({ state: 'loading' });
  const [sheet, setSheet] = useState<Load<Sheet>>({ state: 'loading' });
  const [marks, setMarks] = useState<Marks>({});
  const [saving, setSaving] = useState<Saving>('idle');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirming, setConfirming] = useState<null | 'finalize' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [recheck, setRecheck] = useState<'none' | 'checking' | 'done'>('none');
  const [detailRevision, setDetailRevision] = useState(0);
  const alive = useRef(true);
  const marksRef = useRef<Marks>({});
  const savedRef = useRef<Marks>({});
  const sessionRef = useRef<GroupSession | null>(null);
  const running = useRef(false);
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noted = useRef(false);
  const serverViews = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const editHint = useId();
  const phone = usePhone();
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    groupCall<Detail>('view', groupId, { section: 'detail' }, null, controller.signal)
      .then(value => setDetail({ state: 'ready', value }), e => { if (!isAbort(e)) setDetail({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [groupId, detailRevision]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await readSheet(groupId, sessionId, signal);
    const saved = marksOf(value.rows);
    savedRef.current = saved; marksRef.current = saved; sessionRef.current = value.session;
    setSheet({ state: 'ready', value }); setMarks(saved); setSaving('idle'); setPending(false);
    return value;
  }, [groupId, sessionId]);
  // A load always shows what the server holds. When the page was left while a save was running, the server may still be finishing it, so it is asked again a few times.
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reload = readNote(sessionId);
    setSheet({ state: 'loading' }); setRecheck('none');
    load(controller.signal).then(first => {
      if (!reload || stopped) return;
      setRecheck('checking');
      let last = JSON.stringify(marksOf(first.rows));
      RECHECKS.forEach((wait, i) => timers.push(setTimeout(async () => {
        if (stopped || running.current || changedMarks(savedRef.current, marksRef.current).length > 0) return;
        try {
          const rows = await readSheet(groupId, sessionId, controller.signal);
          const now = JSON.stringify(marksOf(rows.rows));
          if (stopped || running.current || changedMarks(savedRef.current, marksRef.current).length > 0) return;
          if (now !== last) { last = now; await load(controller.signal); }
        } catch (e) { if (isAbort(e)) return; }
        if (i === RECHECKS.length - 1 && !stopped) { writeNote(sessionId, false); setRecheck('done'); }
      }, wait)));
    }).catch(e => { if (!isAbort(e)) setSheet({ state: 'error', error: asError(e) }); });
    return () => { stopped = true; timers.forEach(clearTimeout); controller.abort(); };
  }, [load, groupId, sessionId, revision]);

  const counts = useMemo(() => countMarks(marks), [marks]);
  const value = sheet.state === 'ready' ? sheet.value : null;
  const group = detail.state === 'ready' ? detail.value.group : null;
  const instructor = Boolean(group?.instructor);
  const ordered = useMemo(() => studentsByName(value?.rows ?? []), [value]);
  const shown = useMemo(() => ordered.filter(r => matchesSearch(r.display_name ?? '', query)), [ordered, query]);

  const guarded = pending || saving === 'saving' || saving === 'retrying' || saving === 'error';
  const guard = useLeaveGuard(guarded, href => router.push(href));

  /** Re-reads the Session version. Only needed after a refused or unanswered save: a successful save returns the new version itself. */
  async function refreshSession() {
    const head = await groupCall<GroupPage<GroupRow>>('view', groupId, { section: sessionId, page: 0, search: '' });
    if (!head.session) throw new GroupCallError(null);
    sessionRef.current = head.session;
    if (alive.current) setSheet(prev => prev.state === 'ready' ? { state: 'ready', value: { ...prev.value, session: head.session as GroupSession } } : prev);
    return head.session;
  }

  /**
   * Home, the Groups and the Group page are rendered by the server and kept by the browser's router cache. After attendance changes, ask for them
   * again so the next visit shows what the server holds now (router.refresh drops every cached page, prefetched ones included). Saves are grouped
   * into one refresh; finishing or reopening refreshes at once. The screen being left does not cancel it.
   */
  function refreshServerViews(now = false) {
    if (serverViews.current) clearTimeout(serverViews.current);
    const run = () => { serverViews.current = null; try { router.refresh(); } catch { /* the next navigation reads fresh data anyway */ } };
    if (now) run(); else serverViews.current = setTimeout(run, 1200);
  }

  function settle() {
    const dirty = changedMarks(savedRef.current, marksRef.current).length > 0;
    if (!dirty) refreshServerViews();
    if (!alive.current) return;
    setPending(dirty);
    if (!dirty) { setSaving('saved'); if (noted.current) { noted.current = false; writeNote(sessionId, false); } }
  }

  /** What to do about a failed save: retry by itself (growing wait) when the reason can pass, otherwise stop and say so. */
  async function failed(error: GroupCallError) {
    let retry = retryable(error.status);
    if (error.status === 409) {
      // "Stale session": someone saved in between, or the sheet was finished. Take the current version and look.
      try { const head = await refreshSession(); retry = head.attendance_state !== 'finalized' && !head.cancelled; } catch { retry = true; }
    }
    if (!alive.current) return;
    if (retry && attempts.current < AUTO_RETRIES) {
      attempts.current++;
      setSaving('retrying'); setPending(true); setFailure(null);
      timer.current = setTimeout(() => { timer.current = null; void drain(); }, retryDelay(attempts.current));
      return;
    }
    setFailure(error); setSaving('error'); setPending(changedMarks(savedRef.current, marksRef.current).length > 0);
  }

  /** The queue. Runs until nothing differs from what is saved; taps made meanwhile are picked up by the same loop. */
  async function drain() {
    if (running.current) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    running.current = true;
    if (alive.current) { setSaving('saving'); setFailure(null); }
    let problem: GroupCallError | null = null;
    try {
      for (;;) {
        const part = changedMarks(savedRef.current, marksRef.current).slice(0, MARKS_PER_SAVE);
        if (part.length === 0) break;
        const session = sessionRef.current;
        if (!session) throw new GroupCallError(null);
        // The reply is the Session row after the save (group_command returns it for attendance), so its version is the next one to send.
        const reply = await groupSave<{ id?: string; version?: number }>('attendance', groupId, { sessionId, sessionVersion: session.version, marks: part });
        savedRef.current = { ...savedRef.current, ...Object.fromEntries(part.map(m => [m.userId, m.status])) };
        attempts.current = 0;
        if (reply.id === sessionId && typeof reply.version === 'number') sessionRef.current = { ...session, version: reply.version };
        else await refreshSession();
      }
    } catch (e) { problem = asError(e); } finally { running.current = false; }
    if (problem) await failed(problem); else settle();
  }

  function mark(next: Marks) {
    marksRef.current = next; setMarks(next); setPending(true); setConfirming(null); setRecheck(r => r === 'checking' ? 'done' : r);
    if (!noted.current) { noted.current = true; writeNote(sessionId, true); }
    attempts.current = 0;
    void drain();
  }
  /** Retry first takes the version the database holds now, so a stale one cannot keep failing. */
  async function retry() {
    attempts.current = 0; setFailure(null); setSaving('saving');
    try { await refreshSession(); } catch (e) { setFailure(asError(e)); setSaving('error'); return; }
    void drain();
  }

  async function command(kind: Exclude<Busy, null>) {
    const session = sessionRef.current;
    if (busy || !value || !session || running.current) return;
    if (kind === 'reopen' && !reasonValid(reason)) { setReasonProblem(true); return; }
    setBusy(kind); setFailure(null);
    try {
      if (kind === 'reopen') await groupCall('reopen', groupId, { sessionId, sessionVersion: session.version, reason: reason.trim() });
      else await groupCall('finalize', groupId, { sessionId, sessionVersion: session.version });
      if (kind === 'finalize') actionToast(t('ta.finished'));
      refreshServerViews(true);
      setConfirming(null); setReason(''); setReasonProblem(false);
      await load();
    } catch (e) {
      setFailure(asError(e));
    } finally { if (alive.current) setBusy(null); }
  }

  const reloadAll = () => { setFailure(null); setConfirming(null); setRevision(v => v + 1); };
  const sessionTitle = value?.session.title?.trim();
  const title = sessionTitle || t('ta.title_plain');
  const locked = value?.session.attendance_state === 'finalized';
  const cancelled = Boolean(value?.session.cancelled);
  const editable = Boolean(value) && !locked && !cancelled;
  const saveFailed = saving === 'error';
  const finishBlocked = Boolean(busy) || pending || saving === 'saving' || saving === 'retrying' || saveFailed || !value?.complete || value?.rows.length === 0;
  const searching = (value?.rows.length ?? 0) > SEARCH_FROM;

  const canEdit = Boolean(locked && instructor);
  const openReopen = () => { setFailure(null); setConfirming('reopen'); };
  // Keeping the sheet as it was: back to the button that opened the form, so the keyboard does not lose its place.
  const keepFinished = () => { setConfirming(null); setReasonProblem(false); requestAnimationFrame(() => editRef.current?.focus()); };

  // "Edit attendance" opens the reason form at the bottom of a long page: bring it into view and put the cursor in it.
  useEffect(() => {
    if (confirming !== 'reopen') return;
    const field = reasonRef.current; if (!field) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    field.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    field.focus({ preventScroll: true });
  }, [confirming]);

  return <div data-teacher-attendance className={cn('d-page', locked ? (canEdit ? 'd-attendance-room-phone' : '') : 'd-attendance-room')}>
    <div className="d-toolbar">
      <Link href={`/teacher/groups/${groupId}`} data-back className="d-back d-focus"><Icon name="back" size={16} /><span>{group ? <L id="ta.back" values={{ name: group.name }} /> : <L id="ta.back_plain" />}</span></Link>
      <HelpButton />
    </div>
    <header className="d-page-header">
      <div className="d-page-header-main">
        <h1 data-attendance-title className="d-title d-wrap"><bdi dir="auto">{title}</bdi></h1>
        {value && <p data-session-subtitle className="d-meta"><LocalDate value={value.session.starts_at} options={sessionTime} /> · <span className="font-bold"><ModeLabel mode={value.session.mode} /></span>{value.session.mode === 'center' && value.session.location && <span className="break-words"> · <bdi dir="auto">{value.session.location}</bdi></span>}</p>}
      </div>
      {/* The finished sheet on a desktop: its one action is a page action, with its hint under it. Tablets have no hover, so the hint is on the page and not only in a tooltip. */}
      {canEdit && !phone && !cancelled && !confirming && <div data-header-actions className="d-page-header-actions d-attendance-header-actions">
        <p id={editHint} data-edit-hint className="d-meta"><L id="ta.edit_needs_reason" /></p>
        <Button ref={editRef} type="button" size="lg" data-reopen aria-describedby={editHint} title={t('ta.edit_needs_reason')} disabled={Boolean(busy)} onClick={openReopen}><L id="ta.edit" /></Button>
      </div>}
    </header>
    {detail.state === 'error' && <div data-detail-error className="d-stack-lg"><p className="d-body"><L id="ta.error.group" /></p><GroupError kind={detail.error.kind} onRetry={() => setDetailRevision(v => v + 1)} /></div>}
    {sheet.state === 'loading' && <div role="status" data-state="loading"><AttendanceSheetSkeleton /><span className="sr-only"><L id="ta.loading" /></span></div>}
    {sheet.state === 'error' && <GroupError kind={sheet.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {value && recheck === 'checking' && <p role="status" data-rechecking className="d-body"><L id="ta.checking" /></p>}
    {value && recheck === 'done' && <p role="status" data-reload-note className="d-body"><L id="ta.reload_note" /></p>}
    {value && cancelled && <div data-state="cancelled" role="status"><p className="d-body"><L id="ta.cancelled" /></p></div>}
    {value && !cancelled && <>
      <div data-tour="status-bar" data-sheet-state={value.session.attendance_state} className="d-attendance-status">
        <p data-counts className="d-attendance-counts">
          {locked && <><span data-finished><L id="ta.finished" /></span><span aria-hidden>·</span></>}
          <span data-count="attended"><L id="ta.count.present" values={{ count: counts.attended }} /></span><span aria-hidden>·</span>
          <span data-count="absent"><L id="ta.count.absent" values={{ count: counts.absent }} /></span>
          {(!locked || counts.not_marked > 0) && <><span aria-hidden>·</span><span data-count="not_marked"><L id="ta.count.not_marked" values={{ count: counts.not_marked }} /></span></>}
        </p>
        {editable && counts.not_marked > 0 && <Button type="button" variant="tertiary" data-tour="mark-all" data-mark-all disabled={Boolean(busy)} onClick={() => mark(markRestPresent(marksRef.current))}><L id="ta.mark_rest" /></Button>}
      </div>
      {!value.complete && <p data-truncated className="d-body"><L id="ta.truncated" values={{ count: ROSTER_PAGES * ROSTER_PAGE_SIZE }} /></p>}
      {searching && <div data-tour="student-search"><SearchField label={t('ta.search')} data-student-search value={query} onChange={e => setQuery(e.target.value)} placeholder={t('ta.search')} autoComplete="off" dir="auto" /></div>}
      {value.rows.length === 0
        ? <div data-state="empty"><p className="d-body"><L id="ta.empty" /></p></div>
        : shown.length === 0
          ? <p data-search-empty className="d-body"><L id="ta.search_none" /></p>
          : <ul data-tour="student-rows" data-student-list className="d-list d-card d-card--pad">
            {shown.map(r => <StudentRow key={r.user_id} row={r} mark={marks[r.user_id] ?? 'not_marked'} editable={editable} onMark={m => mark({ ...marksRef.current, [r.user_id]: m })} />)}
          </ul>}
      <div data-tour="save-actions" data-actions className={locked ? (canEdit && phone ? 'd-float-bar' : 'd-attendance-actions') : 'd-attendance-actions d-attendance-bar'}>
        {guard.asking && <LeaveQuestion stay={guard.stay} leave={guard.leave} />}
        {failure && !saveFailed && <GroupError kind={failure.kind} unknownOutcome={failure.status === null} onRetry={failure.kind === 'changed' || failure.status === null ? reloadAll : undefined} retryLabel="tg.reload" />}
        {confirming === 'finalize' && <div role="group" data-confirm-finalize aria-label={t('ta.finish')} className="d-stack-sm">
          <p className="d-body"><L id="ta.finalize.confirm" /></p>
          {counts.not_marked > 0 && <p data-unmarked-warning className="d-label"><L id="ta.finalize.unmarked" values={{ count: counts.not_marked }} /></p>}
          <div className="d-attendance-choice">
            <Button type="button" variant="primary" size="lg" data-confirm-finalize-yes disabled={Boolean(busy)} onClick={() => void command('finalize')}>{busy === 'finalize' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.finalize.yes" /></Button>
            <Button type="button" size="lg" disabled={Boolean(busy)} onClick={() => setConfirming(null)}><L id="ta.finalize.keep" /></Button>
          </div>
        </div>}
        {confirming === 'reopen' && <div role="group" data-confirm-reopen aria-label={t('ta.edit')} className="d-stack-sm">
          <label className="d-field"><span className="d-field-label"><L id="ta.reopen.reason" /></span>
            <textarea ref={reasonRef} data-reopen-reason value={reason} maxLength={1000} rows={2} aria-invalid={reasonProblem} onChange={e => { setReason(e.target.value); setReasonProblem(false); }} className="d-field-input d-textarea" />
          </label>
          <p className={reasonProblem ? 'd-field-error' : 'd-meta'} role={reasonProblem ? 'alert' : undefined}><L id={reasonProblem ? 'ta.reopen.reason_required' : 'ta.reopen.hint'} /></p>
          <div className="d-attendance-choice">
            <Button type="button" variant="primary" size="lg" data-confirm-reopen-yes disabled={Boolean(busy)} onClick={() => void command('reopen')}>{busy === 'reopen' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.reopen.yes" /></Button>
            <Button type="button" size="lg" disabled={Boolean(busy)} onClick={keepFinished}><L id="ta.reopen.keep" /></Button>
          </div>
        </div>}
        {!confirming && editable && instructor && <Button type="button" variant="primary" size="lg" data-finalize disabled={finishBlocked} onClick={() => { setFailure(null); setConfirming('finalize'); }}><L id="ta.finish" /></Button>}
        {!confirming && canEdit && phone && <Button ref={editRef} type="button" size="lg" block data-reopen disabled={Boolean(busy)} onClick={openReopen}><L id="ta.edit" /></Button>}
        {!confirming && (!locked || (canEdit && phone)) && <div data-save-line role="status" aria-live="polite" className="d-attendance-save">
          {locked ? <span><L id="ta.edit_needs_reason" /></span>
            : saveFailed ? <><span data-save-state="error" className="d-field-error"><L id="ta.save_failed" /></span><Button type="button" variant="tertiary" data-save-retry onClick={() => void retry()}><L id="ta.save_retry" /></Button></>
            : saving === 'retrying' ? <span data-save-state="retrying" className="d-attendance-saving d-label"><Loader2 aria-hidden className="h-3 w-3 animate-spin" /><L id="ta.retrying" /></span>
            : saving === 'saving' ? <span data-save-state="saving" className="d-attendance-saving"><Loader2 aria-hidden className="h-3 w-3 animate-spin" /><L id="ta.saving" /></span>
            : saving === 'saved' ? <span data-save-state="saved"><L id="ta.saved_now" /></span>
            : <span data-save-state="idle"><L id="ta.saved_as_you_tap" /></span>}
        </div>}
        {!confirming && group && !instructor && (editable || locked) && <p data-only-instructor className="d-meta"><L id="ta.only_instructor" /></p>}
      </div>
    </>}
  </div>;
}

function StudentRow({ row, mark, editable, onMark }: { row: GroupRow; mark: Mark; editable: boolean; onMark: (m: Mark) => void }) {
  return <li data-student={row.user_id} data-mark={mark} className="d-row">
    <p className="d-row-body d-label d-wrap"><span><bdi dir="auto">{row.display_name}</bdi></span></p>
    {editable
      ? <div role="group" aria-label={row.display_name} className="d-seg d-seg--marks">
        <button type="button" data-mark-button="attended" aria-pressed={mark === 'attended'} onClick={() => onMark(toggled(mark, 'attended'))} className="d-seg-option"><L id="ta.present" /></button>
        <button type="button" data-mark-button="absent" aria-pressed={mark === 'absent'} onClick={() => onMark(toggled(mark, 'absent'))} className="d-seg-option"><L id="ta.absent" /></button>
      </div>
      /* Finished: a flat label, a coloured dot and plain text. No button shape, border or shadow, so it cannot be mistaken for something to press. */
      : <p data-mark-text={mark} className={cn('d-mark-text', mark === 'not_marked' ? 'd-meta' : 'd-label')}>
        {mark !== 'not_marked' && <span aria-hidden className={cn('d-mark-dot', mark === 'attended' ? 'bg-green-700' : 'bg-red-700')} />}
        <L id={mark === 'attended' ? 'ta.present' : mark === 'absent' ? 'ta.absent' : 'ta.not_marked'} />
      </p>}
  </li>;
}
