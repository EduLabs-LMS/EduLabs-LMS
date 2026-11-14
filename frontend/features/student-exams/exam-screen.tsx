'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, WifiOff } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { QuestionCard } from '@/frontend/features/student-exams/question-card';
import { ExamReview } from '@/frontend/features/student-exams/exam-review';
import { dayText, scoreText, whenText } from '@/frontend/features/student-exams/student-exam-format';
import { isOffline, studentCall, studentFailureWords, STUDENT_EXAMS_API, type Failure } from '@/frontend/features/student-exams/student-exam-words';
import { examCount, durationWords } from '@/frontend/features/teacher-exams/exam-words';
import {
  canRetry, canStart, clockOffset, clockText, draftOf, isAnswered, secondsLeft, unanswered,
  type Draft, type StudentAttempt, type StudentExamView, type StudentItem,
} from '@/shared/exams-student';
import { parseNumber } from '@/shared/teacher-exams';
import { cn } from '@/shared/utils';

const card = 'rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm';
type Mode = 'overview' | 'taking' | 'review';
type SaveState = 'saved' | 'saving' | 'unsaved' | 'offline';
const RETRY_MS = 4000, TEXT_DELAY_MS = 700, SETTLE_MS = 2000, SETTLE_TRIES = 8;

/**
 * One exam for its student: the overview (the window, the rules, Start, the score once released), taking it (the server's clock, each answer
 * saved as it is given, a lost connection kept on screen and tried again, hand in with a list of what is unanswered, the deadline where
 * the server's own auto-submit wins), and the answer review once the database says it is open. The order of the questions and of each choice is
 * the try's stored order and is never changed here. Nothing on this screen decides anything: the database refuses what it must.
 */
export function StudentExamScreen({ examId }: { examId: string }) {
  const { language, t, number } = useLanguage();
  const [view, setView] = useState<StudentExamView | null>(null), [failure, setFailure] = useState<Failure | null>(null), [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState<StudentAttempt | null>(null), [mode, setMode] = useState<Mode>('overview');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved'), [notice, setNotice] = useState<Failure | null>(null), [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false), [unsavedBlock, setUnsavedBlock] = useState(false), [timeUp, setTimeUp] = useState(false);
  const [now, setNow] = useState(() => Date.now()), [offset, setOffset] = useState(0);

  const attemptRef = useRef<StudentAttempt | null>(null), draftsRef = useRef<Record<string, Draft>>({});
  const versions = useRef<Record<string, number>>({}), saved = useRef<Record<string, number>>({}), flushing = useRef<Promise<boolean> | null>(null);
  const timers = useRef<Record<string, number>>({}), retry = useRef<number | null>(null), alive = useRef(true), settling = useRef(false);
  useEffect(() => () => { alive.current = false; Object.values(timers.current).forEach(window.clearTimeout); if (retry.current) window.clearTimeout(retry.current); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const adopt = useCallback((next: StudentAttempt, received = Date.now()) => {
    attemptRef.current = next; setAttempt(next); setOffset(clockOffset(next.serverNow, received));
    const fresh: Record<string, Draft> = {}; for (const item of next.items) fresh[item.id] = draftOf(item);
    draftsRef.current = fresh; setDrafts(fresh); versions.current = {}; saved.current = {};
  }, []);

  /** The exam, and its open try when there is one (the database keeps one open try per student; a refresh lands back in it). */
  const load = useCallback(async (keep?: Mode) => {
    const read = await studentCall<StudentExamView>(`${STUDENT_EXAMS_API}/${examId}`);
    if (!alive.current) return null;
    if (!read.ok) { setFailure(read.failure); setLoading(false); return null; }
    const received = Date.now(), v = read.body;
    setView(v); setOffset(clockOffset(v.serverNow, received)); setFailure(null);
    const open = v.tries.find(x => x.status === 'in_progress');
    if (open) {
      const got = await studentCall<StudentExamView>(`${STUDENT_EXAMS_API}/${examId}?attempt=${open.id}`);
      if (!alive.current) return v;
      if (got.ok && got.body.attempt) { adopt(got.body.attempt); setMode('taking'); }
      else if (!got.ok) setFailure(got.failure);
    } else if (keep !== 'review') { attemptRef.current = null; setAttempt(null); setMode('overview'); }
    setLoading(false);
    return v;
  }, [examId, adopt]);
  useEffect(() => { void load(); }, [load]);

  // ---- saving: every answer as it is given, one at a time, with the try's revision; a lost connection keeps the answer and tries again
  const saveOne = useCallback(async (qid: string): Promise<'ok' | 'offline' | 'refused'> => {
    const a = attemptRef.current, item = a?.items.find(i => i.id === qid), draft = draftsRef.current[qid];
    if (!a || !item || !draft) return 'ok';
    const v = versions.current[qid] ?? 0;
    const answer = item.type === 'number' ? { numberValue: draft.number.trim() === '' ? null : parseNumber(draft.number) }
      : item.type === 'essay' ? { text: draft.text, uploadId: draft.uploadId }
      : { optionIds: draft.optionIds };
    if (item.type === 'number' && draft.number.trim() !== '' && answer.numberValue === null) { saved.current[qid] = v; return 'ok'; } // not a number yet: nothing to save
    const reply = await studentCall<{ revision: number }>(`${STUDENT_EXAMS_API}/${examId}/work`, { action: 'save', attemptId: a.id, revision: a.revision, questionId: qid, ...answer });
    if (!alive.current) return 'ok';
    if (reply.ok) { saved.current[qid] = v; return 'ok'; }
    if (isOffline(reply.failure)) return 'offline';
    // A refusal: the database has decided. Time is up and a changed try are handled from the server's own state; anything else is said.
    const reason = 'reason' in reply.failure ? reply.failure.reason : null;
    saved.current[qid] = v;
    if (reason === 'deadline_passed' || reply.failure.kind === 'changed') { void settle(); return 'refused'; }
    setNotice(reply.failure); return 'refused';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const run = (async () => {
      setSaveState('saving');
      for (let guard = 0; guard < 50; guard++) {
        const pending = Object.keys(versions.current).filter(q => (saved.current[q] ?? 0) !== (versions.current[q] ?? 0));
        if (pending.length === 0) { setSaveState('saved'); return true; }
        const result = await saveOne(pending[0]);
        if (result === 'offline') {
          setSaveState('offline');
          if (alive.current) retry.current = window.setTimeout(() => { retry.current = null; setNotice(null); void flush(); }, RETRY_MS);
          return false;
        }
      }
      return false;
    })().finally(() => { flushing.current = null; });
    flushing.current = run;
    return run;
  }, [saveOne]);

  const change = (item: StudentItem, patch: Partial<Draft>, delay = 0) => {
    if (timeUp || item.answer?.kept) return;
    const next = { ...(draftsRef.current[item.id] ?? draftOf(item)), ...patch };
    draftsRef.current = { ...draftsRef.current, [item.id]: next }; setDrafts(draftsRef.current);
    versions.current[item.id] = (versions.current[item.id] ?? 0) + 1; setSaveState('unsaved'); setUnsavedBlock(false); setNotice(null);
    if (timers.current[item.id]) window.clearTimeout(timers.current[item.id]);
    timers.current[item.id] = window.setTimeout(() => { void flush(); }, delay);
  };

  // ---- the deadline: the server's clock. At zero the database has handed the try in (the auto-submit wins); read it back until it says so.
  const remaining = attempt && attempt.status === 'in_progress' ? secondsLeft(attempt.deadlineAt, offset, now) : null;
  const settle = useCallback(async () => {
    if (settling.current) return; settling.current = true; setTimeUp(true); setConfirming(false);
    Object.values(timers.current).forEach(window.clearTimeout);
    for (let n = 0; n < SETTLE_TRIES && alive.current; n++) {
      const v = await load('overview');
      if (v && !v.tries.some(x => x.status === 'in_progress')) break;
      await new Promise(r => window.setTimeout(r, SETTLE_MS));
    }
    settling.current = false;
  }, [load]);
  useEffect(() => { if (mode === 'taking' && remaining === 0 && !timeUp) void settle(); }, [mode, remaining, timeUp, settle]);

  const start = async (action: 'start' | 'retry') => {
    setBusy(true); setNotice(null);
    const reply = await studentCall<StudentAttempt>(`${STUDENT_EXAMS_API}/${examId}/work`, { action });
    setBusy(false);
    if (!reply.ok) { setNotice(reply.failure); if (reply.failure.kind === 'changed') void load(); return; }
    adopt(reply.body); setIndex(0); setTimeUp(false); setSaveState('saved'); setMode('taking'); await load('review');
  };

  const handIn = async () => {
    const a = attemptRef.current; if (!a) return;
    setBusy(true); setNotice(null);
    const ok = await flush();
    if (!ok) { setBusy(false); setUnsavedBlock(true); return; }
    const reply = await studentCall<StudentAttempt>(`${STUDENT_EXAMS_API}/${examId}/work`, { action: 'submit', attemptId: a.id, revision: a.revision });
    setBusy(false);
    if (!reply.ok) {
      if (isOffline(reply.failure)) { setUnsavedBlock(true); return; }
      const reason = 'reason' in reply.failure ? reply.failure.reason : null;
      if (reason === 'deadline_passed' || reply.failure.kind === 'changed') { void settle(); return; }
      setNotice(reply.failure); setConfirming(false); return;
    }
    setConfirming(false); setUnsavedBlock(false); attemptRef.current = null; setAttempt(null); setMode('overview'); await load();
  };

  const openReview = async () => {
    const last = [...(view?.tries ?? [])].reverse().find(x => x.status === 'submitted'); if (!last) return;
    setBusy(true); setNotice(null);
    const reply = await studentCall<StudentExamView>(`${STUDENT_EXAMS_API}/${examId}?attempt=${last.id}`);
    setBusy(false);
    if (!reply.ok || !reply.body.attempt) { if (!reply.ok) setNotice(reply.failure); return; }
    setView(reply.body); attemptRef.current = null; setAttempt(reply.body.attempt); setOffset(clockOffset(reply.body.serverNow, Date.now())); setMode('review');
  };

  const items = useMemo(() => attempt?.items ?? [], [attempt]);
  const missing = useMemo(() => unanswered(items, drafts, parseNumber), [items, drafts]);
  const server = now + offset;

  if (loading) return <p className={card} role="status" data-student-exam-loading><L id="se.x.loading" /></p>;
  if (!view) return <Shell><p role="alert" data-student-exam-failure className={cn(card, 'flex items-start gap-2')}><AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden /><span>{failure ? studentFailureWords(t, failure) : t('se.fail.failed')}</span></p></Shell>;

  // ---------------------------------------------------------------- review
  if (mode === 'review' && attempt) return <Shell><ExamReview examId={examId} view={view} attempt={attempt} onBack={() => { setMode('overview'); setAttempt(null); void load(); }} /></Shell>;

  // ---------------------------------------------------------------- taking
  if (mode === 'taking' && attempt) {
    const item = items[Math.min(index, items.length - 1)], last = index >= items.length - 1;
    const answeredCount = items.length - missing.length;
    const low = remaining !== null && remaining <= 300;
    return <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-6" data-student-exam="taking" data-save-state={saveState} data-time-up={timeUp ? '' : undefined}>
      <header className="sticky top-0 z-10 flex items-center gap-3 rounded-2xl border-2 border-black bg-white px-3 py-2 shadow-hard-sm">
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold" dir="auto">{view.title}</span>
          <span className="block text-sm text-slate-600" data-progress>{t(saveState === 'saving' ? 'se.t.saving' : saveState === 'unsaved' ? 'se.t.unsaved' : saveState === 'offline' ? 'se.t.not_saved' : 'se.t.saved')} · {t('se.t.answered', { n: number(answeredCount), total: number(items.length) })}</span></span>
        {remaining !== null && <span role="timer" aria-label={t('se.t.timer', { time: clockText(remaining) })} data-timer={remaining} data-low={low ? '' : undefined}
          className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border-2 border-black px-3 font-bold tabular-nums', low ? 'bg-rose-200' : 'bg-amber-100')}><Clock className="h-4 w-4" aria-hidden /><bdi dir="ltr">{clockText(remaining)}</bdi></span>}
      </header>
      {timeUp && <p role="alert" data-time-up-note className={cn(card, 'flex items-start gap-2 bg-rose-50')}><AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden /><span><L id="se.t.time_up" /></span></p>}
      {saveState === 'offline' && !timeUp && <p role="alert" data-offline className={cn(card, 'flex items-start gap-2 bg-amber-50')}><WifiOff className="mt-0.5 h-5 w-5 flex-none" aria-hidden /><span><L id="se.t.offline" /></span></p>}
      {notice && <p role="alert" data-notice={'reason' in notice ? notice.reason ?? undefined : undefined} className={cn(card, 'flex items-start gap-2 bg-rose-50')}><AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden /><span>{studentFailureWords(t, notice)}</span></p>}
      <nav aria-label={t('se.t.questions_nav')} className="flex flex-wrap gap-1.5" data-tiles>
        {items.map((it, i) => { const done = isAnswered(it, drafts[it.id], parseNumber); return <button key={it.id} type="button" data-tile={i + 1} data-answered={done ? '' : undefined} aria-current={i === index ? 'step' : undefined}
          aria-label={t('se.t.tile', { n: number(i + 1), state: done ? t('se.t.answered_state') : t('se.t.unanswered_state') })} onClick={() => setIndex(i)}
          className={cn('inline-flex h-11 min-w-[44px] items-center justify-center rounded-xl border-2 border-black text-sm font-bold', i === index ? 'bg-primary shadow-hard-sm' : done ? 'bg-emerald-100' : 'bg-white')}>{number(i + 1)}</button>; })}
      </nav>
      {item && <QuestionCard key={item.id} examId={examId} attemptId={attempt.id} item={item} index={index} total={items.length} draft={drafts[item.id] ?? draftOf(item)} photosAllowed={view.photosAllowed}
        locked={timeUp} onChange={(patch, delay) => change(item, patch, delay)} />}
      <div className="sticky bottom-0 z-10 flex gap-2 rounded-2xl border-2 border-black bg-white p-2 shadow-hard-sm" data-bar>
        <Button type="button" variant="outline" className="h-12 flex-1" data-prev disabled={index === 0} aria-disabled={index === 0 || undefined} onClick={() => setIndex(index - 1)}><L id="se.t.prev" /></Button>
        {last ? <Button type="button" className="h-12 flex-1" data-hand-in disabled={timeUp} onClick={() => { setConfirming(true); setUnsavedBlock(false); }}><L id="se.t.hand_in" /></Button>
          : <Button type="button" className="h-12 flex-1" data-next onClick={() => setIndex(index + 1)}><L id="se.t.next" /></Button>}
      </div>
      {!last && <button type="button" data-hand-in-link disabled={timeUp} onClick={() => { setConfirming(true); setUnsavedBlock(false); }} className="min-h-[44px] min-w-[44px] self-center px-4 text-sm font-semibold underline"><L id="se.t.hand_in" /></button>}
      {confirming && <div role="dialog" aria-modal="true" aria-labelledby="se-confirm" data-confirm className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
        <div className={cn(card, 'w-full max-w-md space-y-3')}>
          <h2 id="se-confirm" className="font-display text-xl"><L id="se.c.title" /></h2>
          <p data-unanswered={missing.join(',')}>{missing.length === 0 ? t('se.c.all') : t('se.c.unanswered', { list: missing.map(n => number(n)).join(', ') })}</p>
          <p className="text-sm text-slate-600"><L id="se.c.warn" /></p>
          {unsavedBlock && <p role="alert" data-unsaved-block className="flex items-start gap-2 text-sm font-semibold"><WifiOff className="mt-0.5 h-4 w-4 flex-none" aria-hidden /><span><L id="se.c.unsaved" /></span></p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" data-keep-working onClick={() => setConfirming(false)}><L id="se.c.keep" /></Button>
            <Button type="button" className="h-12 flex-1" data-confirm-hand-in disabled={busy} onClick={() => void handIn()}>{busy ? t('se.c.handing') : t('se.c.confirm')}</Button>
          </div>
        </div>
      </div>}
    </div>;
  }

  // ---------------------------------------------------------------- overview
  const w = view.window, result = view.result, lastTry = view.tries[view.tries.length - 1];
  const handedIn = view.tries.some(x => x.status === 'submitted');
  const startable = canStart(view, server), again = canRetry(view, server);
  const ruleText = view.rule === 'fix_mistakes' ? t('se.x.rule_fix') : view.rule === 'from_zero' ? t('se.x.rule_zero') : view.kind === 'online' ? t('se.x.rule_one') : '';
  return <Shell>
    <section className={cn(card, 'space-y-3')} data-student-exam="overview" data-state={handedIn ? 'handed_in' : startable ? 'open' : 'closed'}>
      <div><p className="text-sm text-slate-600" dir="auto">{view.courseTitle}</p><h1 className="font-display text-2xl leading-tight" dir="auto">{view.title}</h1></div>
      {view.description && <p className="whitespace-pre-wrap text-sm" dir="auto">{view.description}</p>}
      {view.kind === 'online' ? <ul className="space-y-1 text-sm" data-facts>
        <li>{examCount(t, 'question', view.questionCount)} · {examCount(t, 'mark', view.totalPoints)}</li>
        {w?.state === 'ok' && w.opensAt && w.closesAt && <li data-window>{t('se.x.window', { from: whenText(w.opensAt, language), to: whenText(w.closesAt, language) })}</li>}
        <li>{view.timeLimitMinutes ? t('se.x.limit', { time: durationWords(t, view.timeLimitMinutes, number) }) : t('se.x.no_limit')}</li>
        {ruleText && <li>{ruleText}</li>}
      </ul> : <p className="text-sm" data-paper-note>{view.heldOn ? t('se.x.paper_held', { when: dayText(view.heldOn, language) }) : t('se.x.paper_note')} · {t('se.x.out_of', { n: number(view.maxMarks ?? 0) })}</p>}
      {view.kind === 'online' && !handedIn && !startable && <p role="status" data-closed-note className="flex items-start gap-2 text-sm font-semibold"><Clock className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
        <span>{w?.state === 'needs_time' || w?.state === 'none' || w?.state === 'cancelled' || !w ? t('se.x.no_window') : server < Date.parse(w.opensAt ?? '') ? t('se.x.opens_later', { when: whenText(w.opensAt, language) }) : t('se.x.closed')}</span></p>}
      {handedIn && <div className="space-y-2" data-handed-in>
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden /><L id="se.x.handed_in" /></p>
        {lastTry?.autoSubmitted && <p className="text-sm" data-auto-handed><L id="se.x.auto_handed" /></p>}
      </div>}
      {result && 'waiting' in result && <p className="text-sm" data-score-waiting role="status"><L id="se.x.score_waiting" /></p>}
      {view.kind === 'paper' && !result && <p className="text-sm" data-score-waiting role="status"><L id="se.x.paper_waiting" /></p>}
      {result && !('waiting' in result) && <p className="rounded-xl border-2 border-black bg-primary/60 p-3 font-semibold" data-score role="status">
        {result.absent ? t('se.x.absent') : t('se.x.score_value', { score: number(result.score ?? 0), max: number(result.maxScore ?? 0) })}</p>}
      {notice && <p role="alert" data-notice={'reason' in notice ? notice.reason ?? undefined : undefined} className="flex items-start gap-2 text-sm font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden /><span>{studentFailureWords(t, notice)}</span></p>}
      <div className="flex flex-wrap gap-2">
        {startable && <Button type="button" className="h-12" data-start disabled={busy} onClick={() => void start('start')}><L id="se.x.start" /></Button>}
        {again && <div className="space-y-2" data-retry-box><p className="text-sm">{view.rule === 'fix_mistakes' ? t('se.x.again_fix') : t('se.x.again_zero')}</p><Button type="button" className="h-12" data-retry disabled={busy} onClick={() => void start('retry')}><L id="se.x.again" /></Button></div>}
        {handedIn && view.reviewOpen && <Button type="button" variant="outline" className="h-12" data-review disabled={busy} onClick={() => void openReview()}><L id="se.x.review" /></Button>}
      </div>
      {handedIn && !view.reviewOpen && view.kind === 'online' && <p className="text-sm text-slate-600" data-review-later><L id="se.x.review_later" /></p>}
    </section>
  </Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl space-y-3">
    <Link href="/exams" data-back className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold underline"><ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden /><L id="se.x.back" /></Link>
    {children}
  </div>;
}
