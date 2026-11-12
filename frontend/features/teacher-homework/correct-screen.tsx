'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Dialog } from '@/frontend/components/design/dialog';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { Tabs } from '@/frontend/components/design/tabs';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { homeworkApi } from '@/frontend/lib/homework';
import { actionToast } from '@/frontend/lib/action-toast';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { cairoDay, cairoTime, pageCount, type HomeworkFailure } from '@/shared/teacher-homework';
import {
  choiceSummary, clampPoints, draftChanged, draftComplete, draftOf, essayLines, gradeBody, nextStudent, QUEUE_TABS, reasonOk, releaseBody, releaseManyBody, totals, tryState,
  type Draft, type EssayLine, type Queue, type QueueRow, type QueueTab, type TryView,
} from '@/shared/teacher-homework-correct';
import { countText, failureWords, homeworkCall } from './homework-words';

const API = '/api/teacher/homework';
const countOf = (q: Queue, key: QueueTab) => q.counts[key === 'to_correct' ? 'toCorrect' : key];
type Notice = { failure: HomeworkFailure } | null;

/**
 * Correcting one homework, one student at a time: the lists come from homework_queue, the try from get_homework (staff), and every save or
 * release goes through the teacher Homework routes. The buttons follow canGrade / canRelease; the database decides again. A change made
 * elsewhere (stale) keeps what the teacher typed and offers Reload.
 */
export function CorrectScreen({ homeworkId, start }: { homeworkId: string; start: string | null }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const [tab, setTab] = useState<QueueTab>('to_correct');
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueFailure, setQueueFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<string | null>(start);
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState<TryView | null>(null);
  const [viewFailure, setViewFailure] = useState<HomeworkFailure | null>(null);
  const [base, setBase] = useState<Draft>({ marks: {}, feedback: '' });
  const [draft, setDraft] = useState<Draft>({ marks: {}, feedback: '' });
  const [reason, setReason] = useState('');
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState<'save' | 'next' | 'release' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmMany, setConfirmMany] = useState(false);
  const [live, setLive] = useState('');
  const lastQueue = useRef(0), lastTry = useRef(0);
  // Every student row seen so far: a student who left the list being shown (saved, released) keeps their name.
  const known = useRef(new Map<string, QueueRow>());
  const say = (text: string) => { setLive(text); actionToast(text); };

  const readQueue = useCallback(async () => {
    const mine = ++lastQueue.current;
    setReading(true);
    try {
      const response = await fetch(`${API}/${homeworkId}/queue?${new URLSearchParams({ tab, page: String(page) })}`, { cache: 'no-store' });
      if (mine !== lastQueue.current) return null;
      if (!response.ok) { setQueueFailure({ status: response.status }); return null; }
      const body = await response.json() as Queue;
      for (const r of body.rows) if (r.submissionId) known.current.set(r.submissionId, r);
      setQueue(body); setQueueFailure(null);
      return body;
    } catch { if (mine === lastQueue.current) setQueueFailure({ status: null }); return null; }
    finally { if (mine === lastQueue.current) setReading(false); }
  }, [homeworkId, page, tab]);
  useEffect(() => { void readQueue(); }, [readQueue]);

  /** One try. `keep`: a reload after a change made elsewhere keeps what the teacher typed (only the revision is new). */
  const readTry = useCallback(async (submissionId: string, keep = false) => {
    const mine = ++lastTry.current;
    if (!keep) { setView(null); setViewFailure(null); }
    const got = await homeworkCall<TryView>(`${API}/${homeworkId}/tries/${submissionId}`);
    if (mine !== lastTry.current) return;
    if (!got.ok) { setViewFailure(got.failure); return; }
    setView(got.body); setViewFailure(null);
    const attempt = got.body.submissions[0];
    const fresh = draftOf(got.body, attempt);
    setBase(fresh);
    if (!keep) { setDraft(fresh); setReason(''); setAskReason(false); }
  }, [homeworkId]);
  useEffect(() => {
    if (!current) return;
    void readTry(current);
    try { window.history.replaceState(window.history.state, '', `?try=${current}`); } catch { /* the address is a convenience */ }
  }, [current, readTry]);
  // The first student of To correct, when none was asked for.
  useEffect(() => { if (!current && !phone && queue?.tab === 'to_correct') { const first = queue.rows.find(r => r.submissionId); if (first?.submissionId) setCurrent(first.submissionId); } }, [current, phone, queue]);

  const listRows = useMemo(() => queue?.tab === tab ? queue.rows : [], [queue, tab]);
  const row = useMemo(() => listRows.find(r => r.submissionId === current) ?? (current ? known.current.get(current) ?? null : null), [listRows, current]);
  const attempt = view?.submissions[0] ?? null;
  const state = attempt ? tryState(attempt) : 'waiting';
  // A corrected student opened by address (?try=) is not in To correct: show Done, where their row (and name) is.
  useEffect(() => {
    if (current && attempt?.id === current && state !== 'waiting' && tab === 'to_correct' && queue?.tab === 'to_correct' && !known.current.has(current)) { setTab('done'); setPage(0); }
  }, [attempt, current, queue, state, tab]);
  const changed = draftChanged(draft, base);
  const canGrade = Boolean(view?.canGrade), canRelease = Boolean(view?.canRelease);
  const needsReason = state === 'released' && changed;

  function pick(submissionId: string) {
    if (busy) return;
    setNotice(null); setCurrent(submissionId); setListOpen(false);
  }

  async function save(next: boolean) {
    if (!view || !attempt || busy) return;
    if (!canGrade) return;
    if (!changed && state !== 'waiting') { if (next) goNext(); return; }
    if (needsReason && !reasonOk(reason)) { setAskReason(true); return; }
    setBusy(next ? 'next' : 'save'); setNotice(null);
    try {
      const done = await homeworkCall<unknown>(`${API}/${homeworkId}/tries/${attempt.id}`, gradeBody(draft, attempt.correction?.revision ?? 0, needsReason ? reason.trim() : ''));
      if (!done.ok) { setNotice({ failure: done.failure }); return; }
      say(t(state === 'released' ? 'hw.c.live.taken_back' : 'hw.c.live.saved', { name: row?.name ?? '' }));
      const rows = listRows;
      void readQueue();
      if (next) { const following = nextStudent(rows, attempt.id); if (following?.submissionId) { setCurrent(following.submissionId); return; } }
      await readTry(attempt.id);
    } finally { setBusy(null); }
  }
  function goNext() {
    const following = nextStudent(listRows, current);
    if (following?.submissionId) setCurrent(following.submissionId);
  }
  async function release() {
    if (!attempt?.correction || busy || !canRelease || changed) return;
    setBusy('release'); setNotice(null);
    try {
      const done = await homeworkCall<unknown>(`${API}/${homeworkId}/tries/${attempt.id}`, releaseBody(attempt.correction.revision));
      if (!done.ok) { setNotice({ failure: done.failure }); return; }
      say(t('hw.c.live.released', { name: row?.name ?? '' }));
      void readQueue(); await readTry(attempt.id);
    } finally { setBusy(null); }
  }

  const homework = queue?.homework;
  const ready = queue?.readyToRelease ?? 0;
  const releaseReason = 'hw-c-no-release', gradeReason = 'hw-c-no-grade';
  const showList = !phone || listOpen || !current;
  const showTry = !phone || (!listOpen && Boolean(current));
  const position = row ? listRows.filter(r => r.submissionId).findIndex(r => r.submissionId === row.submissionId) + 1 : 0;

  return <div data-correct-screen className="d-stack-lg">
    <div className="d-hw-top">
      {phone && showTry
        ? <Button variant="tertiary" data-correct-list onClick={() => setListOpen(true)}><Icon name="back" size={16} /><L id="hw.c.students" /></Button>
        : <Link href="/teacher/homework" className={`${buttonClass('tertiary')} d-back`} data-correct-back><Icon name="back" size={16} /><L id="hw.title" /></Link>}
      {phone && showTry && position > 0 && <span className="d-meta" data-correct-position>{t('hw.c.position', { n: position, total: queue ? countOf(queue, tab) : listRows.length })}</span>}
    </div>
    <header className="d-stack-xs" data-correct-header>
      {homework ? <h1 className="d-title"><bdi dir="auto">{homework.title}</bdi></h1> : <DesignSkeleton className="h-7 w-48" />}
      {homework?.deadline && queue && <p className="d-meta">{t(Date.parse(homework.deadline) <= Date.parse(queue.serverNow) ? 'hw.closed_on' : 'hw.due_short', { day: cairoDay(homework.deadline, lang) })}</p>}
    </header>
    {queueFailure && <SectionError status={queueFailure.status} onRetry={() => void readQueue()} pending={reading} />}

    {queue && ready > 0 && <div data-release-many className="d-card d-card--pad d-hw-bar d-correct-ready">
      <span className="d-label">{t(`hw.c.ready.${countForm(ready)}` as MessageKey, { n: ready })}</span>
      <span className="d-stack-xs">
        <Button variant="primary" data-release-many-open aria-disabled={!queue.homework.canRelease || undefined} aria-describedby={queue.homework.canRelease ? undefined : 'hw-c-many-why'} onClick={() => { if (queue.homework.canRelease) setConfirmMany(true); }}>
          {t(`hw.c.release_many.${countForm(ready)}` as MessageKey, { n: ready })}</Button>
        {!queue.homework.canRelease && <span id="hw-c-many-why" className="d-meta"><L id="hw.c.no_release" /></span>}
      </span>
    </div>}

    <div className={phone ? 'd-stack-lg' : 'd-correct-split'}>
      {showList && queue && <section aria-labelledby="hw-c-list" data-correct-students className="d-card d-card--pad d-stack-sm">
        <h2 id="hw-c-list" className="sr-only"><L id="hw.c.students" /></h2>
        <Tabs label={t('hw.c.students')} active={tab} onSelect={key => { setTab(key as QueueTab); setPage(0); }} items={QUEUE_TABS.map(key => ({ key, label: t(`hw.c.tab.${key}`, { n: countOf(queue, key) }), 'data-tab': key }))} />
        <div role="tabpanel" aria-busy={reading || undefined} data-tab-panel={tab}>
          {queue.tab === tab && listRows.length === 0 && <p data-state="empty" className="d-body"><L id={`hw.c.empty.${tab}`} /></p>}
          {queue.tab === tab && listRows.length > 0 && <ul className="d-list">{listRows.map(r => studentRow(r))}</ul>}
        </div>
        {queue.tab === tab && pageCount(countOf(queue, tab), queue.pageSize) > 1 && <div data-pager className="d-pager">
          {page > 0 && <Button data-page-prev onClick={() => setPage(page - 1)}><L id="hw.prev" /></Button>}
          <span className="d-meta">{t('hw.page', { n: page + 1, total: pageCount(countOf(queue, tab), queue.pageSize) })}</span>
          {page + 1 < pageCount(countOf(queue, tab), queue.pageSize) && <Button data-page-next onClick={() => setPage(page + 1)}><L id="hw.next" /></Button>}
        </div>}
      </section>}
      {!queue && !queueFailure && <Loading />}

      {showTry && current && <section aria-labelledby="hw-c-try" data-correct-try={current} data-try-shown={attempt?.id} data-try-state={state} className="d-card d-card--pad d-stack-md">
        {viewFailure && <p role="alert" data-try-failure={viewFailure.kind} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{failureWords(t, viewFailure)}</p>}
        {!view && !viewFailure && <Loading />}
        {view && attempt && tryBody(view, attempt)}
      </section>}
      {showTry && !current && queue && !phone && <p className="d-card d-card--pad d-body" data-correct-none><L id="hw.c.pick" /></p>}
    </div>
    <p role="status" data-correct-live className="sr-only">{live}</p>
    {confirmMany && queue && <ReleaseManyDialog homeworkId={homeworkId} queue={queue} onClose={() => setConfirmMany(false)}
      onReload={async () => { await readQueue(); }}
      onDone={n => { setConfirmMany(false); say(t(`hw.c.live.released_many.${countForm(n)}` as MessageKey, { n })); void readQueue(); if (current) void readTry(current); }} />}
  </div>;

  function studentRow(r: QueueRow) {
    if (!r.submissionId) return <li key={r.userId} data-missing-row={r.userId} className="d-row">
      <Avatar id={r.userId} name={r.name} />
      <span className="d-row-body"><span className="d-label"><bdi dir="auto">{r.name ?? t('hw.c.no_name')}</bdi></span><span className="d-meta"><L id="hw.c.nothing" /></span></span>
    </li>;
    const on = r.submissionId === current;
    return <li key={r.submissionId} className="d-row">
      <button type="button" data-student-row={r.submissionId} aria-current={on || undefined} className="d-row-link d-focus d-correct-student" onClick={() => pick(r.submissionId as string)}>
        <Avatar id={r.userId} name={r.name} />
        <span className="d-row-body">
          <span className="d-label"><bdi dir="auto">{r.name ?? t('hw.c.no_name')}</bdi></span>
          <span className="d-meta">{r.submittedAt && `${cairoDay(r.submittedAt, lang)} ${cairoTime(r.submittedAt, lang)}`}{(r.try ?? 1) > 1 && ` · ${t('hw.c.try', { n: r.try ?? 1 })}`}</span>
        </span>
        <span className="d-row-trailing">
          {r.late && <StatusPill tone="warning" data-late=""><L id="hw.c.late" /></StatusPill>}
          {r.released && <StatusPill tone="success" data-released=""><L id="hw.c.released" /></StatusPill>}
          {!r.released && r.status === 'corrected' && tab === 'done' && <StatusPill tone="info" data-not-released=""><L id="hw.c.not_released" /></StatusPill>}
        </span>
      </button>
    </li>;
  }

  function tryBody(v: TryView, a: NonNullable<typeof attempt>) {
    const max = v.definition.rules?.maxTries ?? null;
    const choices = choiceSummary(v, a, lang);
    const essays = essayLines(v, a);
    const total = totals(v, a, draft);
    const choiceGot = choices.reduce((s, c) => s + c.points, 0), choiceMax = choices.reduce((s, c) => s + c.max, 0);
    return <>
      <div className="d-hw-qhead" id="hw-c-try">
        {row && <Avatar id={row.userId} name={row.name} />}
        <span className="d-stack-xs">
          <span className="d-section"><bdi dir="auto">{row?.name ?? t('hw.c.no_name')}</bdi></span>
          <span className="d-meta">{a.submittedAt && t('hw.c.handed_at', { day: cairoDay(a.submittedAt, lang), time: cairoTime(a.submittedAt, lang) })}
            {' · '}{max ? t('hw.c.try_of', { n: a.number, total: max }) : t('hw.c.try', { n: a.number })}</span>
        </span>
        {a.missedDeadline && <StatusPill tone="warning" data-missed=""><L id="hw.c.missed" /></StatusPill>}
        {state === 'released' && <StatusPill tone="success" data-released=""><L id="hw.c.released" /></StatusPill>}
        {state === 'corrected' && <StatusPill tone="info" data-not-released=""><L id="hw.c.not_released" /></StatusPill>}
      </div>

      {choices.length > 0 && <div data-choice-summary className="d-stack-xs d-correct-block">
        <div className="d-hw-qhead"><span className="d-label"><L id="hw.c.choices" /></span><span className="d-meta"><L id="hw.c.auto" /></span>
          <span className="d-label" data-choice-total>{t('hw.c.out_of', { got: number(choiceGot), max: number(choiceMax) })}</span></div>
        <ul className="d-hw-chips">{choices.map(c => <li key={c.questionId} data-choice={c.questionId} data-right={c.correct || undefined}>
          <StatusPill tone={c.correct ? 'success' : 'danger'}>
            <Icon name={c.correct ? 'check' : 'close'} size={14} />
            <span className="sr-only">{t(c.correct ? 'hw.c.right' : 'hw.c.wrong')} </span>
            {c.correct ? t('hw.c.q_right', { n: c.n, picked: c.picked.join(' ') })
              : c.answered ? t('hw.c.q_wrong', { n: c.n, picked: c.picked.join(' '), right: c.right.join(' ') }) : t('hw.c.q_blank', { n: c.n, right: c.right.join(' ') })}
            {c.kept && <> · <L id="hw.c.kept_short" /></>}
          </StatusPill>
        </li>)}</ul>
      </div>}

      {essays.map(e => <Essay key={e.question.id} homeworkId={homeworkId} essay={e} name={row?.name ?? ''} editable={canGrade && !e.kept}
        value={e.kept ? { points: e.points, feedback: e.feedback } : draft.marks[e.question.id] ?? { points: null, feedback: '' }}
        onChange={m => setDraft(d => ({ ...d, marks: { ...d.marks, [e.question.id]: m } }))} />)}

      <label className="d-field" data-overall-note><span className="d-field-label">{t('hw.c.note_overall', { name: row?.name ?? '' })}</span>
        <textarea className="d-field-input d-textarea" rows={2} maxLength={10000} dir="auto" value={draft.feedback} readOnly={!canGrade} aria-readonly={!canGrade || undefined}
          onChange={ev => setDraft(d => ({ ...d, feedback: ev.target.value }))} /></label>

      {state === 'released' && <p className="d-content-line" data-released-note><Icon name="info" /><span><L id="hw.c.released_note" /></span></p>}
      {needsReason && <label className="d-field" data-edit-reason><span className="d-field-label"><L id="hw.c.reason" /></span>
        <input className="d-field-input" dir="auto" maxLength={4000} value={reason} aria-invalid={askReason && !reasonOk(reason) || undefined} aria-describedby="hw-c-reason-hint"
          onChange={ev => { setReason(ev.target.value); setAskReason(false); }} />
        <span id="hw-c-reason-hint" className={askReason && !reasonOk(reason) ? 'd-field-error' : 'd-meta'}><L id="hw.c.reason_hint" /></span></label>}

      {notice && <div role="alert" data-correct-failure={notice.failure.kind} className="d-alert">
        <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{notice.failure.kind === 'changed' ? t('hw.c.stale') : failureWords(t, notice.failure)}</span></p>
        {notice.failure.kind === 'changed' && <Button data-correct-reload onClick={() => { setNotice(null); void readTry(a.id, true); }}><L id="hw.c.reload" /></Button>}
      </div>}

      {!canGrade && <p id={gradeReason} className="d-content-line" data-no-grade><Icon name="info" /><span><L id="hw.c.no_grade" /></span></p>}
      {canGrade && !canRelease && state === 'corrected' && <p id={releaseReason} className="d-content-line" data-no-release><Icon name="info" /><span><L id="hw.c.no_release" /></span></p>}
      {canGrade && !draftComplete(draft) && <p className="d-meta" data-incomplete><L id="hw.c.incomplete" /></p>}

      <div className="d-hw-bar" data-correct-bar>
        <span className="d-label" data-total>{t('hw.c.total', { got: number(total.got), max: number(total.max) })}</span>
        <span className="d-hw-finish">
          {state === 'corrected' && !changed && <Button data-release-one aria-disabled={!canRelease || busy !== null || undefined} aria-describedby={canRelease ? undefined : releaseReason} aria-busy={busy === 'release' || undefined}
            onClick={() => void release()}>{busy === 'release' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.c.release_one" /></Button>}
          {!phone && <Button data-correct-save aria-disabled={!canGrade || busy !== null || undefined} aria-describedby={canGrade ? undefined : gradeReason} aria-busy={busy === 'save' || undefined}
            onClick={() => void save(false)}>{busy === 'save' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.c.save" /></Button>}
          <Button variant="primary" data-correct-next aria-disabled={!canGrade || busy !== null || undefined} aria-describedby={canGrade ? undefined : gradeReason} aria-busy={busy === 'next' || undefined}
            onClick={() => void save(true)}>{busy === 'next' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={phone ? 'hw.c.next_short' : 'hw.c.next'} /></Button>
        </span>
      </div>
    </>;
  }
}

/** One essay: the question, the student's text and photo exactly as sent (nothing drawn on it), then the mark and a note. */
function Essay({ homeworkId, essay, name, editable, value, onChange }: { homeworkId: string; essay: EssayLine; name: string; editable: boolean; value: { points: number | null; feedback: string }; onChange: (m: { points: number | null; feedback: string }) => void }) {
  const { t, number } = useLanguage();
  const [model, setModel] = useState(false);
  const q = essay.question, at = `hw-c-${q.id}`;
  const points = value.points;
  const set = (n: number) => onChange({ ...value, points: clampPoints(n, q.points) });
  return <div data-essay={q.id} data-kept={essay.kept || undefined} className="d-stack-sm d-correct-block">
    <div className="d-hw-qhead">
      <span className="d-label">{t('hw.c.essay', { n: essay.n, marks: countText(t, 'mark', q.points) })}</span>
      {essay.kept && <StatusPill tone="neutral" data-kept=""><L id="hw.c.kept" /></StatusPill>}
      {q.modelAnswer && <Button variant="tertiary" aria-expanded={model} aria-controls={`${at}-model`} data-model-toggle onClick={() => setModel(!model)}><L id="hw.c.model" /></Button>}
    </div>
    {q.text && <p className="d-body"><bdi dir="auto">{q.text}</bdi></p>}
    {model && <p id={`${at}-model`} className="d-content-line" data-model-answer><Icon name="info" /><bdi dir="auto">{q.modelAnswer}</bdi></p>}
    <div className="d-stack-xs" data-typed>
      <span className="d-meta d-hw-eyebrow"><L id="hw.c.typed" /></span>
      {essay.text ? <p className="d-body d-correct-answer"><bdi dir="auto">{essay.text}</bdi></p> : <p className="d-meta"><L id="hw.c.no_text" /></p>}
    </div>
    {essay.photo && <Photo homeworkId={homeworkId} id={essay.photo.id} deleted={Boolean(essay.photo.deleted)} n={essay.n} />}
    {editable
      ? <div className="d-stack-sm">
        <span className="d-hw-qhead"><span className="d-label" id={`${at}-mark`}><L id="hw.c.mark" /></span>
          <span role="group" aria-labelledby={`${at}-mark`} className="d-hw-stepper" data-stepper={q.id}>
            <button type="button" className="d-btn d-btn--secondary d-hw-step-btn" aria-label={t('hw.c.less')} aria-disabled={points === 0 || undefined} onClick={() => { if (points !== 0) set(points === null ? 0 : points - 1); }}>−</button>
            <span aria-live="polite" className="d-label d-hw-step-value" data-stepper-value={points ?? ''}>{t('hw.c.out_of', { got: points === null ? '–' : number(points), max: number(q.points) })}</span>
            <button type="button" className="d-btn d-btn--secondary d-hw-step-btn" aria-label={t('hw.c.more')} aria-disabled={points === q.points || undefined} onClick={() => { if (points !== q.points) set(points === null ? Math.min(1, q.points) : points + 1); }}>+</button>
          </span></span>
        <label className="d-field" data-essay-note><span className="d-field-label">{t('hw.c.note', { name })}</span>
          <textarea className="d-field-input d-textarea" rows={2} maxLength={4000} dir="auto" value={value.feedback} onChange={ev => onChange({ ...value, feedback: ev.target.value })} /></label>
      </div>
      : <div className="d-stack-xs">
        <span className="d-label" data-mark-read>{t('hw.c.mark_read', { got: points === null ? '–' : number(points), max: number(q.points) })}</span>
        {value.feedback && <p className="d-body"><bdi dir="auto">{value.feedback}</bdi></p>}
      </div>}
  </div>;
}

/** The student's photo through the signed-media flow (a five-minute link for staff). A photo removed to free space says so. */
function Photo({ homeworkId, id, deleted, n }: { homeworkId: string; id: string; deleted: boolean; n: number }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null | ''>(null);
  useEffect(() => {
    if (deleted) return;
    let live = true;
    setUrl(null);
    homeworkApi<{ url: string }>(homeworkId, 'media', { id }).then(m => { if (live) setUrl(m.url); }).catch(() => { if (live) setUrl(''); });
    return () => { live = false; };
  }, [deleted, homeworkId, id]);
  if (deleted) return <p className="d-content-line" data-photo-deleted={id}><Icon name="info" /><span><L id="hw.c.photo_deleted" /></span></p>;
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

/** "Release 12 grades": exactly the queue's list, all or nothing. A grade changed elsewhere releases none and asks for a reload. */
function ReleaseManyDialog({ homeworkId, queue, onClose, onReload, onDone }: { homeworkId: string; queue: Queue; onClose: () => void; onReload: () => Promise<void>; onDone: (n: number) => void }) {
  const { t } = useLanguage();
  const [error, setError] = useState<HomeworkFailure | null>(null);
  const [sending, setSending] = useState(false);
  const n = queue.releasable.length;
  async function send() {
    if (sending) return;
    setSending(true); setError(null);
    try {
      const done = await homeworkCall<{ released: number }>(`${API}/${homeworkId}/release-many`, releaseManyBody(queue));
      if (!done.ok) { setError(done.failure); return; }
      onDone(done.body.released);
    } finally { setSending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending) onClose(); }} data-release-many-dialog="" title={t(`hw.c.release_many.${countForm(n)}` as MessageKey, { n })}
    description={t('hw.c.release_many_body')}
    footer={<><Button data-release-many-cancel aria-disabled={sending || undefined} onClick={() => { if (!sending) onClose(); }}><L id="hw.cancel" /></Button>
      {error?.kind === 'changed'
        ? <Button variant="primary" data-release-many-reload onClick={() => { setError(null); void onReload(); }}><L id="hw.c.reload" /></Button>
        : <Button variant="primary" data-release-many-confirm aria-disabled={sending || n === 0 || undefined} aria-busy={sending || undefined} onClick={() => void send()}>{sending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.c.release_confirm" /></Button>}</>}>
    <p className="d-content-line"><Icon name="bell" /><span><L id="hw.c.release_notify" /></span></p>
    {error && <p role="alert" data-release-many-error={error.kind} className="d-field-error">{error.kind === 'changed' ? t('hw.c.many_changed') : failureWords(t, error)}</p>}
  </Dialog>;
}

function Loading() {
  return <div role="status" data-state="loading" className="d-stack-sm">
    {[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}
