'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Select, Switch } from '@/frontend/components/design/controls';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { actionToast } from '@/frontend/lib/action-toast';
import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import { ReleaseManyDialog } from '@/frontend/features/teacher-homework/correct-screen';
import {
  dayLabel, enteredCount, entryOf, entryState, markItem, sheetReleasable, sheetRows,
  type ExamFailure, type ExamView, type Sheet, type SheetEntry, type SheetRow,
} from '@/shared/teacher-exams';
import { EXAMS_API, examCall, examFailureWords } from './exam-words';

type RowSave = 'idle' | 'saving' | 'saved' | 'failed';
const SAVE_AFTER = 700;

/**
 * The mark sheet of a paper exam: every student of the run, by Group. A mark box per student (0 to the maximum, in halves) and Absent;
 * each mark is saved as it is typed (exam_paper_mark), and Enter goes to the next student. "Release marks" releases every entered mark at
 * once after a confirm. A released mark changes only with a reason (the database asks for one and keeps it). Read: exam_paper_sheet.
 */
export function PaperMarks({ examId }: { examId: string }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const [exam, setExam] = useState<ExamView | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [group, setGroup] = useState('all');
  const [entries, setEntries] = useState<Record<string, SheetEntry>>({});
  const [saves, setSaves] = useState<Record<string, RowSave>>({});
  const [rowFailure, setRowFailure] = useState<Record<string, ExamFailure | undefined>>({});
  const [confirm, setConfirm] = useState(false);
  const [live, setLive] = useState('');
  const timers = useRef(new Map<string, number>()), inFlight = useRef(new Set<string>()), again = useRef(new Set<string>());
  const rowsRef = useRef<SheetRow[]>([]), entriesRef = useRef<Record<string, SheetEntry>>({});
  rowsRef.current = rows; entriesRef.current = entries;
  const say = (text: string) => { setLive(text); actionToast(text); };

  useEffect(() => { examCall<ExamView>(`${EXAMS_API}/${examId}`).then(r => { if (r.ok) setExam(r.body); }); }, [examId]);
  /** Every page of the sheet (100 students a page). What the teacher is typing stays; a stored row replaces the rest. */
  const read = useCallback(async (keepTyped = true) => {
    setReading(true);
    try {
      const all: SheetRow[] = []; let first: Sheet | null = null;
      for (let page = 0; page < 100; page++) {
        const response = await fetch(`${EXAMS_API}/${examId}/sheet?page=${page}`, { cache: 'no-store' });
        if (!response.ok) { setFailure({ status: response.status }); return; }
        const body = await response.json() as Sheet;
        first ??= body; all.push(...body.rows);
        if (all.length >= body.counts.total || body.rows.length < body.pageSize) break;
      }
      setSheet(first); setRows(all); setFailure(null);
      setEntries(cur => { const next: Record<string, SheetEntry> = {}; for (const r of all) next[r.userId] = keepTyped && cur[r.userId] && entryState(r, cur[r.userId], first?.maxMarks ?? 0) !== 'same' && saves[r.userId] !== 'saved' ? cur[r.userId] : entryOf(r); return next; });
    } catch { setFailure({ status: null }); }
    finally { setReading(false); }
  }, [examId]); // eslint-disable-line react-hooks/exhaustive-deps -- saves is only a hint for which typed rows to keep
  useEffect(() => { void read(false); }, [read]);

  const max = sheet?.maxMarks ?? 0;
  /** Send one student's mark as typed. One request per student at a time; a change typed meanwhile is sent after it. */
  const sendRow = useCallback(async (userId: string) => {
    const r = rowsRef.current.find(x => x.userId === userId), e = entriesRef.current[userId];
    if (!r || !e || !sheet) return;
    if (entryState(r, e, sheet.maxMarks) !== 'ready') return;
    if (inFlight.current.has(userId)) { again.current.add(userId); return; }
    inFlight.current.add(userId);
    setSaves(s => ({ ...s, [userId]: 'saving' })); setRowFailure(f => ({ ...f, [userId]: undefined }));
    const item = markItem(r, e, sheet.maxMarks);
    try {
      const done = await examCall<{ items: { userId: string; resultId: string; revision: number }[] }>(`${EXAMS_API}/${examId}/marks`, { items: [item] });
      if (!done.ok) {
        setSaves(s => ({ ...s, [userId]: 'failed' })); setRowFailure(f => ({ ...f, [userId]: done.failure }));
        if (done.failure.kind === 'changed') void read();
        return;
      }
      const stored = done.body.items.find(x => x.userId === userId);
      setRows(list => list.map(x => x.userId !== userId ? x : { ...x, mark: item.mark, absent: item.absent, resultId: stored?.resultId ?? x.resultId, revision: stored?.revision ?? x.revision }));
      setEntries(cur => ({ ...cur, [userId]: { ...cur[userId], reason: '' } }));
      setSaves(s => ({ ...s, [userId]: 'saved' }));
    } finally {
      inFlight.current.delete(userId);
      if (again.current.delete(userId)) window.setTimeout(() => void sendRow(userId), 0);
    }
  }, [examId, read, sheet]);
  function type(userId: string, next: Partial<SheetEntry>, now = false) {
    setEntries(cur => { const merged = { ...cur, [userId]: { ...cur[userId], ...next } }; entriesRef.current = merged; return merged; });
    setSaves(s => ({ ...s, [userId]: 'idle' }));
    const old = timers.current.get(userId);
    if (old) window.clearTimeout(old);
    timers.current.set(userId, window.setTimeout(() => { timers.current.delete(userId); void sendRow(userId); }, now ? 0 : SAVE_AFTER));
  }
  useEffect(() => () => { for (const id of Array.from(timers.current.values())) window.clearTimeout(id); }, []);

  const shown = useMemo(() => sheetRows(rows, group), [rows, group]);
  const entered = enteredCount(shown);
  const releasable = sheetReleasable(rows);
  const pending = rows.some(r => entries[r.userId] && entryState(r, entries[r.userId], max) !== 'same');
  const draft = sheet?.status === 'draft';
  const releaseWhy = draft ? 'ex.m.publish_first' : pending ? 'ex.m.wait_saving' : exam && !exam.can.release ? 'ex.c.no_release' : null;
  const groupOptions = [{ value: 'all', label: t('ex.m.all_students') }, ...(sheet?.groups ?? []).map(g => ({ value: g.id, label: <bdi dir="auto">{g.name}</bdi> })), ...(rows.some(r => !r.groupIds.length) ? [{ value: 'none', label: t('ex.no_group') }] : [])];

  function focusNext(index: number) {
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-mark-input]'));
    const next = boxes[index + 1];
    if (next) { next.focus(); next.select(); } else boxes[index]?.blur();
  }

  return <div data-paper-marks className="d-stack-lg">
    <div className="d-hw-top">
      <Link href="/teacher/exams" className={`${buttonClass('tertiary')} d-back`} data-marks-back><Icon name="back" size={16} /><L id="ex.title" /></Link>
      {sheet && <span className="d-meta" role="status" data-entered={`${entered}/${shown.length}`}>{t('ex.entered_of', { n: number(entered), total: number(shown.length) })}</span>}
    </div>
    <header className="d-stack-xs">
      {exam ? <h1 className="d-title"><bdi dir="auto">{exam.title}</bdi></h1> : <DesignSkeleton className="h-7 w-48" />}
      {sheet && <p className="d-meta">{t('ex.on_paper_short')} · {t('ex.out_of', { n: number(sheet.maxMarks) })}{sheet.heldOn ? ` · ${dayLabel(sheet.heldOn, lang)}` : ''}</p>}
    </header>
    {failure && <SectionError status={failure.status} onRetry={() => void read()} pending={reading} />}
    {!sheet && !failure && <div role="status" data-state="loading" className="d-card d-card--pad d-stack-sm">{[0, 1, 2, 3].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}<span className="sr-only"><L id="th.state.loading" /></span></div>}

    {sheet && <section aria-labelledby="ex-m-sheet" data-mark-sheet className="d-card d-card--pad d-stack-sm">
      <div className="d-hw-qhead">
        <h2 id="ex-m-sheet" className="d-section"><L id="ex.m.title" /></h2>
        <label className="d-field d-ex-group-pick" data-group-pick><span className="d-field-label sr-only"><L id="ex.m.group" /></span>
          <Select value={group} onChange={setGroup} options={groupOptions} aria-label={t('ex.m.group')} /></label>
      </div>
      <p className="d-meta"><L id="ex.m.hint" /></p>
      {shown.length === 0 ? <p data-state="empty" className="d-body"><L id="ex.m.empty" /></p>
        : <ul className="d-list">{shown.map((r, i) => markRow(r, i))}</ul>}
    </section>}

    {sheet && <div className="d-hw-bar" data-release-bar>
      <span className="d-label">{t(`ex.m.ready.${countForm(releasable.length)}` as MessageKey, { n: number(releasable.length) })}</span>
      <span className="d-stack-xs">
        <Button variant="primary" data-release-marks aria-disabled={!releasable.length || Boolean(releaseWhy) || undefined} aria-describedby={releaseWhy ? 'ex-m-why' : undefined} onClick={() => { if (releasable.length && !releaseWhy) setConfirm(true); }}><L id="ex.m.release" /></Button>
        {releaseWhy && releasable.length > 0 && <span id="ex-m-why" className="d-meta"><L id={releaseWhy as MessageKey} /></span>}
      </span>
    </div>}
    <p role="status" data-marks-live className="sr-only">{live}</p>
    {confirm && <ReleaseManyDialog n={releasable.length} title={t(`ex.m.release_n.${countForm(releasable.length)}` as MessageKey, { n: number(releasable.length) })}
      send={() => examCall<{ released: number }>(`${EXAMS_API}/${examId}/release-many`, { items: releasable })} words={f => examFailureWords(t, f)}
      onClose={() => setConfirm(false)} onReload={async () => { await read(); }}
      onDone={n => { setConfirm(false); say(t(`ex.m.live.released.${countForm(n)}` as MessageKey, { n: number(n) })); void read(false); }} />}
  </div>;

  function markRow(r: SheetRow, index: number) {
    const e = entries[r.userId] ?? entryOf(r);
    const state = entryState(r, e, max, lang);
    const save = saves[r.userId] ?? 'idle', failed = rowFailure[r.userId];
    const at = `ex-m-${r.userId}`;
    return <li key={r.userId} data-mark-row={r.userId} data-entry={state} className="d-row d-ex-mark-row">
      {!phone && <Avatar id={r.userId} name={r.name} />}
      <span className="d-row-body d-stack-xs">
        <span className="d-label" id={`${at}-name`}><bdi dir="auto">{r.name ?? t('hw.c.no_name')}</bdi></span>
        <span className="d-meta" aria-live="polite" data-row-save={save}>
          {state === 'invalid' ? <span className="d-field-error">{t('ex.m.invalid', { max: number(max) })}</span>
            : state === 'cannot_clear' ? <span className="d-field-error"><L id="ex.fail.cannot_clear" /></span>
            : save === 'saving' ? <L id="hw.w.saving" /> : save === 'saved' ? <L id="ex.m.saved" /> : r.released ? <L id="hw.c.released" /> : null}
        </span>
        {r.released && state === 'needs_reason' && <label className="d-field" data-mark-reason><span className="d-field-label"><L id="ex.m.reason" /></span>
          <input className="d-field-input" dir="auto" maxLength={4000} value={e.reason} onChange={ev => type(r.userId, { reason: ev.target.value })} aria-describedby={`${at}-why`} />
          <span id={`${at}-why`} className="d-meta"><L id="hw.c.reason_hint" /></span></label>}
        {failed && <span role="alert" data-row-failure={failed.kind} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{failed.kind === 'changed' ? t('ex.m.stale') : examFailureWords(t, failed)}</span>}
      </span>
      <span className="d-row-trailing d-ex-mark-controls">
        <span className="d-ex-mark-box">
          <input data-mark-input={index} className="d-field-input d-ex-mark-input" inputMode="decimal" enterKeyHint="next" dir="ltr" autoComplete="off" maxLength={6}
            aria-labelledby={`${at}-name`} aria-describedby={`${at}-max`} aria-invalid={state === 'invalid' || undefined} aria-readonly={e.absent || undefined} readOnly={e.absent}
            value={e.absent ? '' : e.text} placeholder={e.absent ? t('ex.m.absent') : '–'}
            onChange={ev => type(r.userId, { text: ev.target.value })}
            onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); type(r.userId, {}, true); focusNext(index); } }} />
          <span id={`${at}-max`} className="d-meta">{t('ex.m.of_max', { max: number(max) })}</span>
        </span>
        <Switch checked={e.absent} onChange={on => type(r.userId, { absent: on, text: on ? '' : e.text }, true)} data-absent={r.userId} label={<L id="ex.m.absent" />} aria-label={t('ex.m.absent_for', { name: r.name ?? '' })} />
        {save === 'saving' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {r.released && <StatusPill tone="success" data-released=""><Icon name="check" size={14} /><span className="sr-only"><L id="hw.c.released" /></span></StatusPill>}
      </span>
    </li>;
  }
}
