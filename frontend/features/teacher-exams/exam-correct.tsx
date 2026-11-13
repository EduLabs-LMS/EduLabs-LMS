'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { Tabs } from '@/frontend/components/design/tabs';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { actionToast } from '@/frontend/lib/action-toast';
import { examPictureUrl } from '@/frontend/lib/exam-upload';
import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import { Essay, Loading, ReleaseManyDialog } from '@/frontend/features/teacher-homework/correct-screen';
import { cairoDay, cairoTime, pageCount } from '@/shared/teacher-homework';
import { reasonOk } from '@/shared/teacher-homework-correct';
import {
  autoLines, EXAM_QUEUE_TABS, examDraftChanged, examDraftComplete, examDraftOf, examEssays, examGradeBody, examTotals, nextInQueue, releaseBlock,
  type ExamDraft, type ExamEssay, type ExamFailure, type ExamView, type Queue, type QueueRow, type QueueTab,
} from '@/shared/teacher-exams';
import { EXAMS_API, examCall, examFailureWords } from './exam-words';

type Notice = { failure: ExamFailure } | null;
const BLOCK_WORDS = { no_right: 'ex.c.no_release', still_open: 'ex.fail.still_open', unfinished: 'ex.fail.unfinished', released: 'ex.c.released_note' } as const;

/**
 * Correcting one online exam, one student at a time: Homework's correcting screen, read from exam_queue (the lists) and exam_get with one try.
 * Choice and number answers are marked by the database (letters and numbers are shown); essays get a mark in halves and a note. A result is
 * released per student only once that student's window has closed; "Release N grades" sends exactly the queue's list. The buttons follow
 * the exam's correct / release rights; the database decides again. A change made elsewhere keeps what was typed and offers Reload.
 */
export function ExamCorrectScreen({ examId, start }: { examId: string; start: string | null }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const [tab, setTab] = useState<QueueTab>('to_correct');
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueFailure, setQueueFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [exam, setExam] = useState<ExamView | null>(null);
  const [current, setCurrent] = useState<string | null>(start);
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState<ExamView | null>(null);
  const [viewFailure, setViewFailure] = useState<ExamFailure | null>(null);
  const [base, setBase] = useState<ExamDraft>({});
  const [draft, setDraft] = useState<ExamDraft>({});
  const [reason, setReason] = useState('');
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState<'save' | 'next' | 'release' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmMany, setConfirmMany] = useState(false);
  const [live, setLive] = useState('');
  const lastQueue = useRef(0), lastTry = useRef(0);
  // Every student row seen so far, by try: the result's id, revision and window come from the queue (exam_get's try has none).
  const known = useRef(new Map<string, QueueRow>());
  const say = (text: string) => { setLive(text); actionToast(text); };

  useEffect(() => { examCall<ExamView>(`${EXAMS_API}/${examId}`).then(r => { if (r.ok) setExam(r.body); }); }, [examId]);
  const readQueue = useCallback(async (which: QueueTab = tab, at: number = page, show = true) => {
    const mine = show ? ++lastQueue.current : lastQueue.current;
    if (show) setReading(true);
    try {
      const response = await fetch(`${EXAMS_API}/${examId}/queue?${new URLSearchParams({ tab: which, page: String(at) })}`, { cache: 'no-store' });
      if (show && mine !== lastQueue.current) return null;
      if (!response.ok) { if (show) setQueueFailure({ status: response.status }); return null; }
      const body = await response.json() as Queue;
      for (const r of body.rows) if (r.attemptId) known.current.set(r.attemptId, r);
      if (show) { setQueue(body); setQueueFailure(null); }
      return body;
    } catch { if (show && mine === lastQueue.current) setQueueFailure({ status: null }); return null; }
    finally { if (show && mine === lastQueue.current) setReading(false); }
  }, [examId, page, tab]);
  useEffect(() => { void readQueue(); }, [readQueue]);
  /** A try opened by address whose row is not on the page shown: the lists are read (to correct, then corrected) until it is found. */
  const findRow = useCallback(async (attemptId: string) => {
    for (const which of ['to_correct', 'corrected'] as const) for (let at = 0; at < 20; at++) {
      const q = await readQueue(which, at, false);
      if (!q) return;
      if (q.rows.some(r => r.attemptId === attemptId)) { setTab(which); setPage(at); return; }
      if ((at + 1) * q.pageSize >= q.counts[which]) break;
    }
  }, [readQueue]);

  const readTry = useCallback(async (attemptId: string, keep = false) => {
    const mine = ++lastTry.current;
    if (!keep) { setView(null); setViewFailure(null); }
    const got = await examCall<ExamView>(`${EXAMS_API}/${examId}/tries/${attemptId}`);
    if (mine !== lastTry.current) return;
    if (!got.ok || !got.body.attempt) { setViewFailure(got.ok ? { kind: 'denied' } : got.failure); return; }
    setView(got.body); setViewFailure(null);
    const fresh = examDraftOf(got.body.attempt);
    setBase(fresh);
    if (!keep) { setDraft(fresh); setReason(''); setAskReason(false); }
    if (!known.current.has(attemptId)) void findRow(attemptId);
  }, [examId, findRow]);
  useEffect(() => {
    if (!current) return;
    void readTry(current);
    try { window.history.replaceState(window.history.state, '', `?try=${current}`); } catch { /* the address is a convenience */ }
  }, [current, readTry]);
  useEffect(() => { if (!current && !phone && queue?.tab === 'to_correct') { const first = queue.rows.find(r => r.attemptId); if (first?.attemptId) setCurrent(first.attemptId); } }, [current, phone, queue]);

  const listRows = useMemo(() => queue?.tab === tab ? queue.rows : [], [queue, tab]);
  const row = useMemo(() => listRows.find(r => r.attemptId === current) ?? (current ? known.current.get(current) ?? null : null), [listRows, current, queue]); // eslint-disable-line react-hooks/exhaustive-deps -- known is read with the queue
  const attempt = view?.attempt ?? null;
  const changed = examDraftChanged(draft, base);
  const can = exam?.can ?? view?.can ?? { author: false, correct: false, release: false };
  const editableEssays = Object.keys(draft).length > 0;
  const needsReason = Boolean(row?.released) && changed;
  const block = releaseBlock(row, can.release);

  function pick(attemptId: string) { if (busy) return; setNotice(null); setCurrent(attemptId); setListOpen(false); }
  function goNext() { const following = nextInQueue(listRows, current); if (following?.attemptId) setCurrent(following.attemptId); }

  async function save(next: boolean) {
    if (!attempt || busy || !can.correct) return;
    if (!changed || !editableEssays) { if (next) goNext(); return; }
    if (!row?.resultId || row.revision === null) { setNotice({ failure: { kind: 'changed' } }); return; }
    if (needsReason && !reasonOk(reason)) { setAskReason(true); return; }
    setBusy(next ? 'next' : 'save'); setNotice(null);
    try {
      const done = await examCall<{ revision: number; status: 'waiting' | 'corrected'; score: number | null; released: boolean }>(`${EXAMS_API}/${examId}/work`, examGradeBody(draft, attempt.id, row.revision, needsReason ? reason.trim() : ''));
      if (!done.ok) { setNotice({ failure: done.failure }); return; }
      known.current.set(attempt.id, { ...row, revision: done.body.revision, status: done.body.status, score: done.body.score });
      say(t(row.released ? 'ex.c.live.changed' : 'ex.c.live.saved', { name: row.name ?? '' }));
      const rows = listRows;
      void readQueue();
      if (next) { const following = nextInQueue(rows, attempt.id); if (following?.attemptId) { setCurrent(following.attemptId); return; } }
      await readTry(attempt.id);
    } finally { setBusy(null); }
  }
  async function release() {
    if (!row?.resultId || row.revision === null || busy || block || changed) return;
    setBusy('release'); setNotice(null);
    try {
      const done = await examCall<{ revision: number }>(`${EXAMS_API}/${examId}/work`, { action: 'release', resultId: row.resultId, revision: row.revision });
      if (!done.ok) { setNotice({ failure: done.failure }); return; }
      if (attempt) known.current.set(attempt.id, { ...row, released: true, revision: done.body.revision });
      say(t('ex.c.live.released', { name: row.name ?? '' }));
      void readQueue(); if (attempt) await readTry(attempt.id);
    } finally { setBusy(null); }
  }

  const ready = queue?.readyToRelease ?? 0;
  const showList = !phone || listOpen || !current;
  const showTry = !phone || (!listOpen && Boolean(current));
  const position = row ? listRows.filter(r => r.attemptId).findIndex(r => r.attemptId === row.attemptId) + 1 : 0;
  const title = exam?.title;

  return <div data-correct-screen data-exam-correct className="d-stack-lg">
    <div className="d-hw-top">
      {phone && showTry
        ? <Button variant="tertiary" data-correct-list onClick={() => setListOpen(true)}><Icon name="back" size={16} /><L id="hw.c.students" /></Button>
        : <Link href="/teacher/exams" className={`${buttonClass('tertiary')} d-back`} data-correct-back><Icon name="back" size={16} /><L id="ex.title" /></Link>}
      {phone && showTry && position > 0 && queue && <span className="d-meta" data-correct-position>{t('hw.c.position', { n: position, total: queue.counts[tab] })}</span>}
    </div>
    <header className="d-stack-xs" data-correct-header>
      {title ? <h1 className="d-title"><bdi dir="auto">{title}</bdi></h1> : <DesignSkeleton className="h-7 w-48" />}
      {queue && <p className="d-meta">{queue.lastClose ? t(queue.closed ? 'ex.c.closed_on' : 'ex.c.closes_on', { day: cairoDay(queue.lastClose, lang), time: cairoTime(queue.lastClose, lang) }) : t('ex.c.no_last_close')}
        {queue.counts.inProgress > 0 && <> · {t('ex.c.in_progress_n', { n: number(queue.counts.inProgress) })}</>}</p>}
    </header>
    {queueFailure && <SectionError status={queueFailure.status} onRetry={() => void readQueue()} pending={reading} />}
    {queue && queue.holds.length > 0 && <p className="d-content-line" data-holds><Icon name="info" /><span>{t('ex.c.holds', { groups: queue.holds.map(h => h.groupName).join('، ') })}</span></p>}

    {queue && ready > 0 && <div data-release-many className="d-card d-card--pad d-hw-bar d-correct-ready">
      <span className="d-label">{t(`ex.c.ready.${countForm(ready)}` as MessageKey, { n: number(ready) })}</span>
      <span className="d-stack-xs">
        <Button variant="primary" data-release-many-open aria-disabled={!can.release || undefined} aria-describedby={can.release ? undefined : 'ex-c-many-why'} onClick={() => { if (can.release) setConfirmMany(true); }}>
          {t(`ex.c.release_many.${countForm(ready)}` as MessageKey, { n: number(ready) })}</Button>
        {!can.release && <span id="ex-c-many-why" className="d-meta"><L id="ex.c.no_release" /></span>}
      </span>
    </div>}

    <div className={phone ? 'd-stack-lg' : 'd-correct-split'}>
      {showList && queue && <section aria-labelledby="ex-c-list" data-correct-students className="d-card d-card--pad d-stack-sm">
        <h2 id="ex-c-list" className="sr-only"><L id="hw.c.students" /></h2>
        <Tabs label={t('hw.c.students')} active={tab} onSelect={key => { setTab(key as QueueTab); setPage(0); }} items={EXAM_QUEUE_TABS.map(key => ({ key, label: t(`ex.c.tab.${key}` as MessageKey, { n: number(queue.counts[key]) }), 'data-tab': key }))} />
        <div role="tabpanel" aria-busy={reading || undefined} data-tab-panel={tab}>
          {queue.tab === tab && listRows.length === 0 && <p data-state="empty" className="d-body"><L id={`ex.c.empty.${tab}` as MessageKey} /></p>}
          {queue.tab === tab && listRows.length > 0 && <ul className="d-list">{listRows.map(r => studentRow(r))}</ul>}
        </div>
        {queue.tab === tab && pageCount(queue.counts[tab], queue.pageSize) > 1 && <div data-pager className="d-pager">
          {page > 0 && <Button data-page-prev onClick={() => setPage(page - 1)}><L id="hw.prev" /></Button>}
          <span className="d-meta">{t('hw.page', { n: page + 1, total: pageCount(queue.counts[tab], queue.pageSize) })}</span>
          {page + 1 < pageCount(queue.counts[tab], queue.pageSize) && <Button data-page-next onClick={() => setPage(page + 1)}><L id="hw.next" /></Button>}
        </div>}
      </section>}
      {!queue && !queueFailure && <Loading />}

      {showTry && current && <section aria-labelledby="ex-c-try" data-correct-try={current} data-try-shown={attempt?.id} className="d-card d-card--pad d-stack-md">
        {viewFailure && <p role="alert" data-try-failure={viewFailure.kind} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{examFailureWords(t, viewFailure)}</p>}
        {!view && !viewFailure && <Loading />}
        {view && attempt && tryBody(attempt)}
      </section>}
      {showTry && !current && queue && !phone && <p className="d-card d-card--pad d-body" data-correct-none><L id="hw.c.pick" /></p>}
    </div>
    <p role="status" data-correct-live className="sr-only">{live}</p>
    {confirmMany && queue && <ReleaseManyDialog n={queue.releasable.length} title={t(`ex.c.release_many.${countForm(queue.releasable.length)}` as MessageKey, { n: number(queue.releasable.length) })}
      send={() => examCall<{ released: number }>(`${EXAMS_API}/${examId}/release-many`, { items: queue.releasable })} words={f => examFailureWords(t, f)}
      onClose={() => setConfirmMany(false)} onReload={async () => { await readQueue(); }}
      onDone={n => { setConfirmMany(false); say(t(`ex.c.live.released_many.${countForm(n)}` as MessageKey, { n: number(n) })); void readQueue(); if (current) void readTry(current); }} />}
  </div>;

  function studentRow(r: QueueRow) {
    if (!r.attemptId) return <li key={r.userId} data-missing-row={r.userId} className="d-row">
      <Avatar id={r.userId} name={r.name} />
      <span className="d-row-body"><span className="d-label"><bdi dir="auto">{r.name ?? t('hw.c.no_name')}</bdi></span>
        <span className="d-meta"><L id={r.inProgress ? 'ex.c.taking_now' : r.windowClosed ? 'ex.c.nothing' : 'ex.c.not_yet'} /></span></span>
    </li>;
    const on = r.attemptId === current;
    return <li key={r.attemptId} className="d-row">
      <button type="button" data-student-row={r.attemptId} aria-current={on || undefined} className="d-row-link d-focus d-correct-student" onClick={() => pick(r.attemptId as string)}>
        <Avatar id={r.userId} name={r.name} />
        <span className="d-row-body">
          <span className="d-label"><bdi dir="auto">{r.name ?? t('hw.c.no_name')}</bdi></span>
          <span className="d-meta">{r.submittedAt && `${cairoDay(r.submittedAt, lang)} ${cairoTime(r.submittedAt, lang)}`}{(r.number ?? 1) > 1 && ` · ${t('hw.c.try', { n: r.number ?? 1 })}`}
            {r.status === 'waiting' && (r.waitingMarks ?? 0) > 0 && ` · ${t('ex.c.essays_left', { n: number(r.waitingMarks ?? 0) })}`}</span>
        </span>
        <span className="d-row-trailing">
          {r.autoSubmitted && <StatusPill tone="neutral" data-auto-submitted=""><L id="ex.c.time_up" /></StatusPill>}
          {r.inProgress && <StatusPill tone="info" data-in-progress=""><L id="ex.c.retrying" /></StatusPill>}
          {r.released && <StatusPill tone="success" data-released=""><L id="hw.c.released" /></StatusPill>}
          {!r.released && r.status === 'corrected' && <StatusPill tone="info" data-not-released="">{r.score !== null && r.maxScore !== null ? t('hw.c.out_of', { got: number(r.score), max: number(r.maxScore) }) : <L id="hw.c.not_released" />}</StatusPill>}
        </span>
      </button>
    </li>;
  }

  function tryBody(a: NonNullable<ExamView['attempt']>) {
    const lines = autoLines(a, lang, number);
    const essays = examEssays(a);
    const total = examTotals(a, draft);
    const autoGot = lines.reduce((s, c) => s + c.points, 0), autoMax = lines.reduce((s, c) => s + c.max, 0);
    const state = row?.released ? 'released' : row?.status === 'corrected' && !changed ? 'corrected' : 'waiting';
    const releaseWhy = 'ex-c-no-release', gradeWhy = 'ex-c-no-grade';
    return <>
      <div className="d-hw-qhead" id="ex-c-try">
        {row && <Avatar id={row.userId} name={row.name} />}
        <span className="d-stack-xs">
          <span className="d-section"><bdi dir="auto">{row?.name ?? t('hw.c.no_name')}</bdi></span>
          <span className="d-meta">{a.submittedAt ? t('hw.c.handed_at', { day: cairoDay(a.submittedAt, lang), time: cairoTime(a.submittedAt, lang) }) : t('ex.c.not_handed')}{' · '}{t('hw.c.try', { n: a.number })}</span>
        </span>
        {a.autoSubmitted && <StatusPill tone="neutral" data-auto-submitted=""><L id="ex.c.time_up" /></StatusPill>}
        {state === 'released' && <StatusPill tone="success" data-released=""><L id="hw.c.released" /></StatusPill>}
        {state === 'corrected' && <StatusPill tone="info" data-not-released=""><L id="hw.c.not_released" /></StatusPill>}
      </div>

      {lines.length > 0 && <div data-choice-summary className="d-stack-xs d-correct-block">
        <div className="d-hw-qhead"><span className="d-label"><L id="ex.c.auto_title" /></span><span className="d-meta"><L id="hw.c.auto" /></span>
          <span className="d-label" data-choice-total>{t('hw.c.out_of', { got: number(autoGot), max: number(autoMax) })}</span></div>
        <ul className="d-hw-chips">{lines.map(c => <li key={c.questionId} data-choice={c.questionId} data-line-type={c.type} data-right={c.correct || undefined}>
          <StatusPill tone={c.correct ? 'success' : 'danger'}>
            <Icon name={c.correct ? 'check' : 'close'} size={14} />
            <span className="sr-only">{t(c.correct ? 'hw.c.right' : 'hw.c.wrong')} </span>
            {c.type === 'number'
              ? c.correct ? t('ex.c.n_right', { n: c.n, given: c.given ?? '' }) : c.answered ? t('ex.c.n_wrong', { n: c.n, given: c.given ?? '', right: c.right.join(' ') }) : t('ex.c.n_blank', { n: c.n, right: c.right.join(' ') })
              : c.correct ? t('hw.c.q_right', { n: c.n, picked: c.picked.join(' ') }) : c.answered ? t('hw.c.q_wrong', { n: c.n, picked: c.picked.join(' '), right: c.right.join(' ') }) : t('hw.c.q_blank', { n: c.n, right: c.right.join(' ') })}
            {c.kept && <> · <L id="hw.c.kept_short" /></>}
          </StatusPill>
        </li>)}</ul>
      </div>}

      {essays.map(e => <Essay key={e.item.id} homeworkId={examId} essay={asLine(e)} name={row?.name ?? ''} editable={can.correct && !e.kept} step={0.5}
        photo={e.uploadId ? <ExamPhoto examId={examId} id={e.uploadId} n={e.n} /> : null}
        value={e.kept ? { points: e.points, feedback: e.note } : { points: draft[e.item.id]?.points ?? null, feedback: draft[e.item.id]?.note ?? '' }}
        onChange={m => setDraft(d => ({ ...d, [e.item.id]: { points: m.points, note: m.feedback.slice(0, 2000) } }))} />)}

      {row?.released && <p className="d-content-line" data-released-note><Icon name="info" /><span><L id="ex.c.released_note" /></span></p>}
      {needsReason && <label className="d-field" data-edit-reason><span className="d-field-label"><L id="hw.c.reason" /></span>
        <input className="d-field-input" dir="auto" maxLength={4000} value={reason} aria-invalid={askReason && !reasonOk(reason) || undefined} aria-describedby="ex-c-reason-hint"
          onChange={ev => { setReason(ev.target.value); setAskReason(false); }} />
        <span id="ex-c-reason-hint" className={askReason && !reasonOk(reason) ? 'd-field-error' : 'd-meta'}><L id="hw.c.reason_hint" /></span></label>}

      {notice && <div role="alert" data-correct-failure={notice.failure.kind} data-reason={'reason' in notice.failure ? notice.failure.reason ?? undefined : undefined} className="d-alert">
        <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{notice.failure.kind === 'changed' ? t('hw.c.stale') : examFailureWords(t, notice.failure)}</span></p>
        {notice.failure.kind === 'changed' && <Button data-correct-reload onClick={() => { setNotice(null); void readQueue(); void readTry(a.id, true); }}><L id="hw.c.reload" /></Button>}
      </div>}

      {!can.correct && <p id={gradeWhy} className="d-content-line" data-no-grade><Icon name="info" /><span><L id="ex.c.no_correct" /></span></p>}
      {!editableEssays && can.correct && <p className="d-meta" data-all-auto><L id="ex.c.all_auto" /></p>}
      {can.correct && editableEssays && !examDraftComplete(draft) && <p className="d-meta" data-incomplete><L id="hw.c.incomplete" /></p>}
      {state === 'corrected' && block && block !== 'released' && <p id={releaseWhy} className="d-content-line" data-release-block={block}><Icon name="info" /><span>{t(BLOCK_WORDS[block])}{block === 'still_open' && row?.windowClosesAt ? ` ${t('ex.c.closes_at', { day: cairoDay(row.windowClosesAt, lang), time: cairoTime(row.windowClosesAt, lang) })}` : ''}</span></p>}

      <div className="d-hw-bar" data-correct-bar>
        <span className="d-label" data-total>{t('hw.c.total', { got: number(total.got), max: number(total.max) })}</span>
        <span className="d-hw-finish">
          {state === 'corrected' && <Button data-release-one aria-disabled={Boolean(block) || busy !== null || undefined} aria-describedby={block ? releaseWhy : undefined} aria-busy={busy === 'release' || undefined}
            onClick={() => void release()}>{busy === 'release' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ex.c.release_one" /></Button>}
          {!phone && editableEssays && <Button data-correct-save aria-disabled={!can.correct || busy !== null || undefined} aria-describedby={can.correct ? undefined : gradeWhy} aria-busy={busy === 'save' || undefined}
            onClick={() => void save(false)}>{busy === 'save' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.c.save" /></Button>}
          <Button variant="primary" data-correct-next aria-disabled={(editableEssays && !can.correct) || busy !== null || undefined} aria-describedby={editableEssays && !can.correct ? gradeWhy : undefined} aria-busy={busy === 'next' || undefined}
            onClick={() => void save(true)}>{busy === 'next' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={editableEssays ? (phone ? 'hw.c.next_short' : 'hw.c.next') : 'ex.c.next_student'} /></Button>
        </span>
      </div>
    </>;
  }
}

/** An exam essay in the shape Homework's Essay shows. */
function asLine(e: ExamEssay) {
  return { question: { id: e.item.id, type: 'essay' as const, text: e.item.text, imageId: e.item.imageId, points: e.item.points, responseMode: e.item.responseMode, options: [], correctIds: [], modelAnswer: e.item.modelText },
    n: e.n, text: e.text, photo: null, kept: e.kept, points: e.points, feedback: e.note };
}

/** The student's photo through the signed-media flow (a five-minute link for staff), shown exactly as sent. */
function ExamPhoto({ examId, id, n }: { examId: string; id: string; n: number }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null | ''>(null);
  useEffect(() => {
    let on = true;
    setUrl(null);
    examPictureUrl(examId, id).then(u => { if (on) setUrl(u); }).catch(() => { if (on) setUrl(''); });
    return () => { on = false; };
  }, [examId, id]);
  return <div className="d-stack-xs" data-photo={id}>
    <span className="d-meta d-hw-eyebrow"><L id="hw.c.photo" /></span>
    {url === null && <DesignSkeleton className="h-40 w-full" />}
    {url === '' && <p className="d-content-line" data-photo-failed><Icon name="warning" /><span><L id="hw.c.photo_failed" /></span></p>}
    {url && <a href={url} target="_blank" rel="noreferrer noopener" className="d-focus d-correct-photo" data-photo-open>
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, shown exactly as sent */}
      <img src={url} alt={t('hw.c.photo_alt', { n })} referrerPolicy="no-referrer" /></a>}
    <p className="d-meta"><L id="hw.c.photo_note" /></p>
  </div>;
}
