'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { button, inkButton, linkClass, plainButton, primaryButton, sessionTime } from '@/frontend/features/teacher-home/parts';
import { HelpButton } from '@/frontend/features/teacher-helper/help-button';
import { GroupCallError, groupCall, isAbort } from '@/frontend/features/teacher-groups/api';
import { GroupError, Loading, ModeLabel } from '@/frontend/features/teacher-groups/parts';
import type { GroupPage, GroupRow, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import {
  MARKS_PER_SAVE, NUMBER_PAGES, ROSTER_PAGES, ROSTER_PAGE_SIZE, allPresent, changedMarks, chunk, countMarks, marksOf, reasonValid, sessionNumber, toggled,
  type Mark, type Marks,
} from '@/shared/teacher-attendance';

type Detail = { group: StudyGroup; serverNow: string };
type Sheet = { session: GroupSession; rows: GroupRow[]; saved: Marks; complete: boolean };
type Load<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; value: T };
type Busy = null | 'save' | 'finalize' | 'reopen';
type Notice = null | 'saved' | 'finalized' | 'reopened';
type Failure = { error: GroupCallError; partial: boolean };
const asError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);
const bigButton = 'min-h-[48px] flex-1 lg:flex-none';
const sheetBox = 'bg-white lg:rounded-[24px] lg:border-[2.5px] lg:border-black';

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
  return { session, rows, saved: marksOf(rows), complete: !hasMore };
}

export function TeacherAttendanceView({ groupId, sessionId }: { groupId: string; sessionId: string }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<Load<Detail>>({ state: 'loading' });
  const [sheet, setSheet] = useState<Load<Sheet>>({ state: 'loading' });
  const [number, setNumber] = useState<number | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState<null | 'finalize' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDetail({ state: 'loading' });
    groupCall<Detail>('view', groupId, { section: 'detail' }, null, controller.signal)
      .then(value => setDetail({ state: 'ready', value }), e => { if (!isAbort(e)) setDetail({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [groupId, detailRevision]);

  // "Session N" is cosmetic: if its read fails or is too long to count, the title is just "Attendance".
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
    setSheet({ state: 'ready', value }); setMarks(value.saved);
  }, [groupId, sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    setSheet({ state: 'loading' });
    load(controller.signal).catch(e => { if (!isAbort(e)) setSheet({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [load, revision]);

  const value = sheet.state === 'ready' ? sheet.value : null;
  const dirty = value ? changedMarks(value.saved, marks).length > 0 : false;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const counts = useMemo(() => countMarks(marks), [marks]);
  const group = detail.state === 'ready' ? detail.value.group : null;
  const instructor = Boolean(group?.instructor);

  /** Saves what changed, at most 100 marks per call. Each call needs the Session version the database holds now, so it is read again after every save. */
  async function persist(start: Sheet): Promise<GroupSession> {
    let session = start.session, saved = start.saved, sent = 0;
    for (const part of chunk(changedMarks(start.saved, marks), MARKS_PER_SAVE)) {
      try {
        await groupCall('attendance', groupId, { sessionId, sessionVersion: session.version, marks: part });
        sent++; saved = { ...saved, ...Object.fromEntries(part.map(m => [m.userId, m.status])) };
        const head = await groupCall<GroupPage<GroupRow>>('view', groupId, { section: sessionId, page: 0, search: '' });
        if (!head.session) throw new GroupCallError(null);
        session = head.session;
      } catch (e) {
        if (sent > 0 && alive.current) setSheet({ state: 'ready', value: { ...start, session, saved } });
        throw Object.assign(asError(e), { partial: sent > 0 });
      }
    }
    if (alive.current) setSheet({ state: 'ready', value: { ...start, session, saved } });
    return session;
  }

  async function command(kind: Exclude<Busy, null>) {
    if (busy || !value) return;
    if (kind === 'reopen' && !reasonValid(reason)) { setReasonProblem(true); return; }
    setBusy(kind); setFailure(null); setNotice(null);
    try {
      if (kind === 'reopen') {
        await groupCall('reopen', groupId, { sessionId, sessionVersion: value.session.version, reason: reason.trim() });
      } else {
        const session = await persist(value);
        if (kind === 'finalize') await groupCall('finalize', groupId, { sessionId, sessionVersion: session.version });
      }
      setConfirming(null); setReason(''); setReasonProblem(false);
      await load();
      setNotice(kind === 'save' ? 'saved' : kind === 'finalize' ? 'finalized' : 'reopened');
    } catch (e) {
      setFailure({ error: asError(e), partial: Boolean((e as { partial?: boolean }).partial) });
    } finally { if (alive.current) setBusy(null); }
  }

  const reloadAll = () => { setFailure(null); setNotice(null); setConfirming(null); setRevision(v => v + 1); };
  const title = number ? t('ta.title', { number }) : t('ta.title_plain');
  const locked = value?.session.attendance_state === 'finalized';
  const cancelled = Boolean(value?.session.cancelled);
  const editable = Boolean(value) && !locked && !cancelled;
  const state = value?.session.attendance_state ?? 'draft';

  return <div data-teacher-attendance className="w-full space-y-5 pb-44 lg:pb-0">
    <Link href={`/teacher/groups/${groupId}`} data-back className={linkClass}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><span className="ms-2">{group ? <L id="ta.back" values={{ name: group.name }} /> : <L id="ta.back_plain" />}</span></Link>
    <header className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-3xl leading-tight lg:text-4xl">{title}</h1>
        <HelpButton />
      </div>
      {value && <p data-session-subtitle className="text-base text-slate-700"><LocalDate value={value.session.starts_at} options={sessionTime} /> · <span className="font-bold"><ModeLabel mode={value.session.mode} /></span>{value.session.mode === 'center' && value.session.location && <span className="break-words"> · {value.session.location}</span>}</p>}
    </header>
    {detail.state === 'error' && <div data-detail-error className="space-y-2"><p className="text-base text-slate-800"><L id="ta.error.group" /></p><GroupError kind={detail.error.kind} onRetry={() => setDetailRevision(v => v + 1)} /></div>}
    {sheet.state === 'loading' && <Loading label="ta.loading" className="h-40" />}
    {sheet.state === 'error' && <GroupError kind={sheet.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {value && cancelled && <div data-state="cancelled" role="status"><p className="text-base text-slate-800"><L id="ta.cancelled" /></p></div>}
    {value && !cancelled && <>
      <section data-tour="status-bar" data-sheet-state={state} aria-label={t('ta.sheet.label')} className={`space-y-2 border-y-2 border-black/15 py-3 lg:border-[2.5px] lg:p-4 ${sheetBox}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span data-sheet-badge className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${state === 'finalized' ? 'bg-primary' : state === 'reopened' ? 'bg-amber-100' : 'bg-slate-200'}`}><L id={`ta.state.${state}`} /></span>
          <p data-counts className="flex flex-wrap gap-x-2 text-base font-bold">
            <span data-count="attended"><L id="ta.count.present" values={{ count: counts.attended }} /></span><span aria-hidden>·</span>
            <span data-count="absent"><L id="ta.count.absent" values={{ count: counts.absent }} /></span><span aria-hidden>·</span>
            <span data-count="not_marked"><L id="ta.count.not_marked" values={{ count: counts.not_marked }} /></span>
          </p>
        </div>
        {dirty && <p data-unsaved-changes role="status" className="text-base text-slate-800"><L id="ta.unsaved_changes" /></p>}
        {notice && <p data-notice={notice} role="status" className="text-base font-bold"><L id={notice === 'saved' ? 'ta.saved' : notice === 'finalized' ? 'ta.finalized_done' : 'ta.reopened_done'} /></p>}
      </section>
      {!value.complete && <p data-truncated className="text-base text-slate-800"><L id="ta.truncated" values={{ count: ROSTER_PAGES * ROSTER_PAGE_SIZE }} /></p>}
      {value.rows.length === 0
        ? <div data-state="empty"><p className="text-base text-slate-800"><L id="ta.empty" /></p></div>
        : <div className={`space-y-3 lg:border-[2.5px] lg:p-5 lg:shadow-hard ${sheetBox}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl"><L id="ta.students" /></h2>
            {editable && <button type="button" data-tour="mark-all" data-mark-all disabled={Boolean(busy)} onClick={() => setMarks(allPresent(marks))} className={`${plainButton} min-h-[48px]`}><L id="ta.mark_all" /></button>}
          </div>
          <ul data-tour="student-rows" data-student-list className="divide-y-2 divide-black/15">
            {value.rows.map(r => <StudentRow key={r.user_id} row={r} mark={marks[r.user_id] ?? 'not_marked'} editable={editable && !busy} onMark={m => setMarks(prev => ({ ...prev, [r.user_id]: m }))} />)}
          </ul>
        </div>}
      <div data-tour="save-actions" data-actions className="fixed inset-x-0 bottom-0 z-30 space-y-3 border-t-2 border-black bg-white p-4 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        {failure && <GroupError kind={failure.error.kind} unknownOutcome={failure.error.status === null && !failure.partial} onRetry={failure.error.kind === 'changed' || failure.error.status === null ? reloadAll : undefined} retryLabel="tg.reload" />}
        {failure?.partial && <p data-partial role="alert" className="text-base font-bold"><L id="ta.error.partial" /></p>}
        {confirming === 'finalize' && <div role="group" data-confirm-finalize aria-label={t('ta.finalize')} className="space-y-2 rounded-xl border-2 border-black bg-amber-50 p-3">
          <p className="text-base"><L id="ta.finalize.confirm" /></p>
          {counts.not_marked > 0 && <p className="text-base font-bold"><L id="ta.finalize.unmarked" values={{ count: counts.not_marked }} /></p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-confirm-finalize-yes disabled={Boolean(busy)} onClick={() => void command('finalize')} className={`${inkButton} ${bigButton}`}>{busy === 'finalize' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.finalize.yes" /></button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)} className={`${plainButton} ${bigButton}`}><L id="ta.finalize.keep" /></button>
          </div>
        </div>}
        {confirming === 'reopen' && <div role="group" data-confirm-reopen aria-label={t('ta.reopen')} className="space-y-2 rounded-xl border-2 border-black bg-amber-50 p-3">
          <label className="block space-y-1"><span className="font-bold"><L id="ta.reopen.reason" /></span>
            <textarea data-reopen-reason value={reason} maxLength={1000} rows={2} aria-invalid={reasonProblem} onChange={e => { setReason(e.target.value); setReasonProblem(false); }} className="min-h-[48px] w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-base" />
          </label>
          <p className={`text-base ${reasonProblem ? 'font-bold text-rose-800' : 'text-slate-700'}`} role={reasonProblem ? 'alert' : undefined}><L id={reasonProblem ? 'ta.reopen.reason_required' : 'ta.reopen.hint'} /></p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-confirm-reopen-yes disabled={Boolean(busy)} onClick={() => void command('reopen')} className={`${inkButton} ${bigButton}`}>{busy === 'reopen' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.reopen.yes" /></button>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setConfirming(null); setReasonProblem(false); }} className={`${plainButton} ${bigButton}`}><L id="ta.reopen.keep" /></button>
          </div>
        </div>}
        {!confirming && <div className="flex gap-3 lg:justify-end">
          {editable && <button type="button" data-save-draft disabled={Boolean(busy) || !dirty} onClick={() => void command('save')} className={`${plainButton} ${bigButton}`}>{busy === 'save' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ta.save" /></button>}
          {editable && instructor && <button type="button" data-finalize disabled={Boolean(busy) || !value.complete || value.rows.length === 0} onClick={() => { setFailure(null); setNotice(null); setConfirming('finalize'); }} className={`${primaryButton} ${bigButton}`}><L id="ta.finalize" /></button>}
          {locked && instructor && <button type="button" data-reopen disabled={Boolean(busy)} onClick={() => { setFailure(null); setNotice(null); setConfirming('reopen'); }} className={`${plainButton} ${bigButton}`}><L id="ta.reopen" /></button>}
        </div>}
        {!confirming && group && !instructor && (editable || locked) && <p data-only-instructor className="text-base text-slate-700"><L id="ta.only_instructor" /></p>}
      </div>
    </>}
  </div>;
}

function StudentRow({ row, mark, editable, onMark }: { row: GroupRow; mark: Mark; editable: boolean; onMark: (m: Mark) => void }) {
  const label: Record<Mark, 'ta.present' | 'ta.absent' | 'ta.not_marked'> = { attended: 'ta.present', absent: 'ta.absent', not_marked: 'ta.not_marked' };
  const tone = (m: 'attended' | 'absent') => mark !== m ? 'bg-white text-black' : m === 'attended' ? 'bg-primary text-black' : 'bg-rose-100 text-black';
  return <li data-student={row.user_id} data-mark={mark} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
    <p className="min-w-0 break-words text-base font-bold">{row.display_name}</p>
    {editable
      ? <div role="group" aria-label={row.display_name} className="grid grid-cols-2 gap-2 sm:w-72">
        <button type="button" data-mark-button="attended" aria-pressed={mark === 'attended'} onClick={() => onMark(toggled(mark, 'attended'))} className={`${button} min-h-[48px] ${tone('attended')}`}><L id="ta.present" /></button>
        <button type="button" data-mark-button="absent" aria-pressed={mark === 'absent'} onClick={() => onMark(toggled(mark, 'absent'))} className={`${button} min-h-[48px] ${tone('absent')}`}><L id="ta.absent" /></button>
      </div>
      : <p data-mark-text className="text-base font-bold"><L id={label[mark]} /></p>}
  </li>;
}
