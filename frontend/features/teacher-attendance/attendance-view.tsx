'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { inkButton, linkClass, plainButton, sessionTime } from '@/frontend/features/teacher-home/parts';
import { HelpButton } from '@/frontend/features/teacher-helper/help-button';
import { GroupCallError, groupCall, isAbort } from '@/frontend/features/teacher-groups/api';
import { GroupError, Loading, ModeLabel } from '@/frontend/features/teacher-groups/parts';
import type { GroupPage, GroupRow, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import {
  MARKS_PER_SAVE, NUMBER_PAGES, ROSTER_PAGES, ROSTER_PAGE_SIZE, allPresent, changedMarks, countMarks, marksOf, reasonValid, sessionNumber, toggled,
  type Mark, type Marks,
} from '@/shared/teacher-attendance';

type Detail = { group: StudyGroup; serverNow: string };
type Sheet = { session: GroupSession; rows: GroupRow[]; complete: boolean };
type Load<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; value: T };
type Saving = 'idle' | 'saving' | 'saved' | 'error';
type Busy = null | 'finalize' | 'reopen';
type Failure = GroupCallError;
const asError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);
const bigButton = 'min-h-[48px] w-full lg:w-auto lg:min-w-[260px]';
const pill = 'inline-flex min-h-[48px] w-[5.5rem] items-center justify-center rounded-full border-2 px-3 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-60';

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

/** Every tap is saved by a single queue: one call after another, each with the Session version the database holds now. A mark is never dropped; it stays on screen until it is saved. */
export function TeacherAttendanceView({ groupId, sessionId }: { groupId: string; sessionId: string }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<Load<Detail>>({ state: 'loading' });
  const [sheet, setSheet] = useState<Load<Sheet>>({ state: 'loading' });
  const [number, setNumber] = useState<number | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [saving, setSaving] = useState<Saving>('idle');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirming, setConfirming] = useState<null | 'finalize' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const alive = useRef(true);
  const marksRef = useRef<Marks>({});
  const savedRef = useRef<Marks>({});
  const sessionRef = useRef<GroupSession | null>(null);
  const running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    groupCall<Detail>('view', groupId, { section: 'detail' }, null, controller.signal)
      .then(value => setDetail({ state: 'ready', value }), e => { if (!isAbort(e)) setDetail({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [groupId, detailRevision]);

  // "Session N" is cosmetic: if its read fails or is too long to count, the title is just the Session's own name.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const rows: GroupSession[] = [];
      let hasMore = true;
      for (let page = 0; page < NUMBER_PAGES && hasMore; page++) {
        const r = await groupCall<GroupPage<GroupSession>>('view', groupId, { section: 'sessions', page, search: '' }, null, controller.signal);
        rows.push(...r.rows); hasMore = Boolean(r.hasMore);
      }
      setNumber(sessionNumber(rows, !hasMore, sessionId));
    })().catch(() => { if (!controller.signal.aborted) setNumber(null); });
    return () => controller.abort();
  }, [groupId, sessionId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await readSheet(groupId, sessionId, signal);
    const saved = marksOf(value.rows);
    savedRef.current = saved; marksRef.current = saved; sessionRef.current = value.session;
    setSheet({ state: 'ready', value }); setMarks(saved); setSaving('idle'); setPending(false);
  }, [groupId, sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    setSheet({ state: 'loading' });
    load(controller.signal).catch(e => { if (!isAbort(e)) setSheet({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [load, revision]);

  useEffect(() => {
    if (!pending && saving !== 'error') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, saving]);

  const counts = useMemo(() => countMarks(marks), [marks]);
  const value = sheet.state === 'ready' ? sheet.value : null;
  const group = detail.state === 'ready' ? detail.value.group : null;
  const instructor = Boolean(group?.instructor);

  /** Re-reads the Session version (every save changes it). */
  async function refreshSession() {
    const head = await groupCall<GroupPage<GroupRow>>('view', groupId, { section: sessionId, page: 0, search: '' });
    if (!head.session) throw new GroupCallError(null);
    sessionRef.current = head.session;
    if (alive.current) setSheet(prev => prev.state === 'ready' ? { state: 'ready', value: { ...prev.value, session: head.session as GroupSession } } : prev);
  }

  /** The queue. Runs until nothing differs from what is saved; taps made meanwhile are picked up by the same loop. */
  async function drain() {
    if (running.current) return;
    running.current = true;
    if (alive.current) { setSaving('saving'); setFailure(null); }
    let failed = false;
    try {
      for (;;) {
        const part = changedMarks(savedRef.current, marksRef.current).slice(0, MARKS_PER_SAVE);
        if (part.length === 0) break;
        const session = sessionRef.current;
        if (!session) throw new GroupCallError(null);
        await groupCall('attendance', groupId, { sessionId, sessionVersion: session.version, marks: part });
        savedRef.current = { ...savedRef.current, ...Object.fromEntries(part.map(m => [m.userId, m.status])) };
        await refreshSession();
      }
    } catch (e) {
      failed = true;
      if (alive.current) { setFailure(asError(e)); setSaving('error'); }
    } finally {
      running.current = false;
      if (alive.current) { setPending(changedMarks(savedRef.current, marksRef.current).length > 0); if (!failed) setSaving('saved'); }
    }
  }

  function mark(next: Marks) {
    marksRef.current = next; setMarks(next); setPending(true); setConfirming(null);
    void drain();
  }
  /** Retry first takes the version the database holds now, so a stale one cannot keep failing. */
  async function retry() {
    setFailure(null); setSaving('saving');
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
      setConfirming(null); setReason(''); setReasonProblem(false);
      await load();
    } catch (e) {
      setFailure(asError(e));
    } finally { if (alive.current) setBusy(null); }
  }

  const reloadAll = () => { setFailure(null); setConfirming(null); setRevision(v => v + 1); };
  const sessionTitle = value?.session.title?.trim();
  const title = number ? t('ta.title', { number, title: sessionTitle ?? '' }).replace(/ · $/, '') : sessionTitle || t('ta.title_plain');
  const locked = value?.session.attendance_state === 'finalized';
  const cancelled = Boolean(value?.session.cancelled);
  const editable = Boolean(value) && !locked && !cancelled;
  const saveFailed = saving === 'error';
  const finishBlocked = Boolean(busy) || pending || saving === 'saving' || saveFailed || !value?.complete || value?.rows.length === 0;

  return <div data-teacher-attendance className="w-full space-y-4 pb-44 lg:pb-0">
    <div className="flex items-center justify-between gap-3">
      <Link href={`/teacher/groups/${groupId}`} data-back className={linkClass}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><span className="ms-2">{group ? <L id="ta.back" values={{ name: group.name }} /> : <L id="ta.back_plain" />}</span></Link>
      <HelpButton />
    </div>
    <header className="space-y-1">
      <h1 data-attendance-title className="break-words font-display text-3xl leading-tight lg:text-4xl"><bdi dir="auto">{title}</bdi></h1>
      {value && <p data-session-subtitle className="text-base text-slate-700"><LocalDate value={value.session.starts_at} options={sessionTime} /> · <span className="font-bold"><ModeLabel mode={value.session.mode} /></span>{value.session.mode === 'center' && value.session.location && <span className="break-words"> · {value.session.location}</span>}</p>}
    </header>
    {detail.state === 'error' && <div data-detail-error className="space-y-2"><p className="text-base text-slate-800"><L id="ta.error.group" /></p><GroupError kind={detail.error.kind} onRetry={() => setDetailRevision(v => v + 1)} /></div>}
    {sheet.state === 'loading' && <Loading label="ta.loading" className="h-40" />}
    {sheet.state === 'error' && <GroupError kind={sheet.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {value && cancelled && <div data-state="cancelled" role="status"><p className="text-base text-slate-800"><L id="ta.cancelled" /></p></div>}
    {value && !cancelled && <>
      <div data-tour="status-bar" data-sheet-state={value.session.attendance_state} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b-2 border-black/15 pb-3">
        <p data-counts className="flex min-h-[48px] flex-wrap items-center gap-x-2 text-base font-bold">
          {locked && <><span data-finished><L id="ta.finished" /></span><span aria-hidden>·</span></>}
          <span data-count="attended"><L id="ta.count.present" values={{ count: counts.attended }} /></span><span aria-hidden>·</span>
          <span data-count="absent"><L id="ta.count.absent" values={{ count: counts.absent }} /></span>
          {(!locked || counts.not_marked > 0) && <><span aria-hidden>·</span><span data-count="not_marked"><L id="ta.count.not_marked" values={{ count: counts.not_marked }} /></span></>}
        </p>
        {editable && value.rows.length > 0 && <button type="button" data-tour="mark-all" data-mark-all disabled={Boolean(busy)} onClick={() => mark(allPresent(marksRef.current))} className={cn(linkClass, 'min-h-[48px]')}><L id="ta.all_present" /></button>}
      </div>
      {!value.complete && <p data-truncated className="text-base text-slate-800"><L id="ta.truncated" values={{ count: ROSTER_PAGES * ROSTER_PAGE_SIZE }} /></p>}
      {value.rows.length === 0
        ? <div data-state="empty"><p className="text-base text-slate-800"><L id="ta.empty" /></p></div>
        : <ul data-tour="student-rows" data-student-list className="divide-y divide-black/15">
          {value.rows.map(r => <StudentRow key={r.user_id} row={r} mark={marks[r.user_id] ?? 'not_marked'} editable={editable} onMark={m => mark({ ...marksRef.current, [r.user_id]: m })} />)}
        </ul>}
      <div data-tour="save-actions" data-actions className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t-2 border-black bg-white p-4 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:pt-2">
        {failure && !saveFailed && <GroupError kind={failure.kind} unknownOutcome={failure.status === null} onRetry={failure.kind === 'changed' || failure.status === null ? reloadAll : undefined} retryLabel="tg.reload" />}
        {confirming === 'finalize' && <div role="group" data-confirm-finalize aria-label={t('ta.finish')} className="space-y-2">
          <p className="text-base"><L id="ta.finalize.confirm" /></p>
          {counts.not_marked > 0 && <p data-unmarked-warning className="text-base font-bold"><L id="ta.finalize.unmarked" values={{ count: counts.not_marked }} /></p>}
          <div className="flex flex-col gap-2 lg:flex-row">
            <button type="button" data-confirm-finalize-yes disabled={Boolean(busy)} onClick={() => void command('finalize')} className={`${inkButton} ${bigButton}`}>{busy === 'finalize' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.finalize.yes" /></button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)} className={`${plainButton} ${bigButton}`}><L id="ta.finalize.keep" /></button>
          </div>
        </div>}
        {confirming === 'reopen' && <div role="group" data-confirm-reopen aria-label={t('ta.edit')} className="space-y-2">
          <label className="block space-y-1"><span className="font-bold"><L id="ta.reopen.reason" /></span>
            <textarea data-reopen-reason value={reason} maxLength={1000} rows={2} aria-invalid={reasonProblem} onChange={e => { setReason(e.target.value); setReasonProblem(false); }} className="min-h-[48px] w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-base text-black" />
          </label>
          <p className={`text-base ${reasonProblem ? 'font-bold text-rose-800' : 'text-slate-700'}`} role={reasonProblem ? 'alert' : undefined}><L id={reasonProblem ? 'ta.reopen.reason_required' : 'ta.reopen.hint'} /></p>
          <div className="flex flex-col gap-2 lg:flex-row">
            <button type="button" data-confirm-reopen-yes disabled={Boolean(busy)} onClick={() => void command('reopen')} className={`${inkButton} ${bigButton}`}>{busy === 'reopen' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.reopen.yes" /></button>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setConfirming(null); setReasonProblem(false); }} className={`${plainButton} ${bigButton}`}><L id="ta.reopen.keep" /></button>
          </div>
        </div>}
        {!confirming && editable && instructor && <button type="button" data-finalize disabled={finishBlocked} onClick={() => { setFailure(null); setConfirming('finalize'); }} className={`${inkButton} ${bigButton}`}><L id="ta.finish" /></button>}
        {!confirming && locked && instructor && <button type="button" data-reopen disabled={Boolean(busy)} onClick={() => { setFailure(null); setConfirming('reopen'); }} className={`${plainButton} ${bigButton}`}><L id="ta.edit" /></button>}
        {!confirming && <div data-save-line role="status" aria-live="polite" className="flex min-h-[24px] flex-wrap items-center gap-x-3 text-base text-slate-700">
          {locked ? (instructor && <span><L id="ta.edit_needs_reason" /></span>)
            : saveFailed ? <><span data-save-state="error" className="font-bold text-rose-800"><L id="ta.save_failed" /></span><button type="button" data-save-retry onClick={() => void retry()} className={cn(linkClass, 'min-h-[48px]')}><L id="ta.save_retry" /></button></>
            : saving === 'saving' ? <span data-save-state="saving" className="inline-flex items-center gap-1"><Loader2 aria-hidden className="h-3 w-3 animate-spin" /><L id="ta.saving" /></span>
            : saving === 'saved' ? <span data-save-state="saved"><L id="ta.saved_now" /></span>
            : <span data-save-state="idle"><L id="ta.saved_as_you_tap" /></span>}
        </div>}
        {!confirming && group && !instructor && (editable || locked) && <p data-only-instructor className="text-base text-slate-700"><L id="ta.only_instructor" /></p>}
      </div>
    </>}
  </div>;
}

function StudentRow({ row, mark, editable, onMark }: { row: GroupRow; mark: Mark; editable: boolean; onMark: (m: Mark) => void }) {
  const on = (m: 'attended' | 'absent') => m === 'attended' ? 'border-green-800 bg-green-700 text-white' : 'border-red-800 bg-red-700 text-white';
  const off = 'border-black/40 bg-white text-black';
  return <li data-student={row.user_id} data-mark={mark} className="flex min-h-[64px] items-center justify-between gap-3 py-2">
    <p className="min-w-0 flex-1 break-words text-base font-bold"><bdi dir="auto">{row.display_name}</bdi></p>
    {editable
      ? <div role="group" aria-label={row.display_name} className="flex shrink-0 gap-2">
        <button type="button" data-mark-button="attended" aria-pressed={mark === 'attended'} onClick={() => onMark(toggled(mark, 'attended'))} className={`${pill} ${mark === 'attended' ? on('attended') : off}`}><L id="ta.present" /></button>
        <button type="button" data-mark-button="absent" aria-pressed={mark === 'absent'} onClick={() => onMark(toggled(mark, 'absent'))} className={`${pill} ${mark === 'absent' ? on('absent') : off}`}><L id="ta.absent" /></button>
      </div>
      : mark === 'not_marked'
        ? <p data-mark-text className="shrink-0 text-base text-slate-700"><L id="ta.not_marked" /></p>
        : <div className="flex shrink-0 gap-2">
          {mark === 'absent' && <span aria-hidden className="w-[5.5rem]" />}
          <span data-mark-text={mark} className={`${pill} ${on(mark)}`}><L id={mark === 'attended' ? 'ta.present' : 'ta.absent'} /></span>
          {mark === 'attended' && <span aria-hidden className="w-[5.5rem]" />}
        </div>}
  </li>;
}
