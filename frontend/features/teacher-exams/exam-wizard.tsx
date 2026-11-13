'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { ChoiceGroup, Select, Switch } from '@/frontend/components/design/controls';
import { Dialog } from '@/frontend/components/design/dialog';
import { Field } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { actionToast } from '@/frontend/lib/action-toast';
import { examPictureUrl, uploadExamPicture } from '@/frontend/lib/exam-upload';
import type { MessageKey } from '@/frontend/locales/messages';
import { groupCall } from '@/frontend/features/teacher-groups/api';
import { QuestionsStep, Stepper, TextArea } from '@/frontend/features/teacher-homework/questions-step';
import { buildTree, type CourseStructure } from '@/shared/course-content';
import type { GroupPage, GroupSession } from '@/shared/contracts/groups';
import { cairoDay, cairoFields, cairoIso, cairoTime } from '@/shared/teacher-homework';
import {
  cairoDate, clampLimit, closesIso, coreOf, dayLabel, detailsOnly, examIssues, examSavable, examStepIssues, examTotal, fromExamView, hasEssays, limitCap, newExam, newExamQuestion,
  opensIso, PAPER_MAX, questionsSavable, setExamKind, stepsOf, toExamDefinition, toggleChapter,
  type ExamFailure, type ExamIssue, type ExamKind, type ExamPageLoad, type ExamQuestion, type ExamStep, type ExamView, type ExamWindow, type ExamWizard as Wizard,
} from '@/shared/teacher-exams';
import { durationWords, EXAMS_API, examCall, examCount, examFailureWords, triesWords } from './exam-words';

type Save = 'idle' | 'saving' | 'saved' | 'waiting' | 'failed' | 'stale';
type Saved = { id: string; revision: number; status: string };
const ids = () => crypto.randomUUID();
const STEP_KEYS: Record<ExamStep, MessageKey> = { details: 'ex.w.step.details', questions: 'ex.w.step.questions', when: 'ex.w.step.when', rules: 'ex.w.step.rules', review: 'ex.w.step.review' };
type WindowPopup = { type: 'session' | 'time'; window: ExamWindow } | null;

/**
 * New exam and editing one, phone first. Online: Details, Questions, When, Rules, Review. On paper: Details, Review. A draft saves itself
 * while the teacher types ("Draft saved"); exam_save needs every right answer, so until each question has one the draft saves without its
 * questions and says so. A save that finds the exam changed elsewhere keeps what was typed and offers Reload. Once a student started (or a
 * paper mark exists) only the details save on this exam: changing the questions, times or rules makes a new version, which the Review says.
 */
export function ExamWizard({ load, examId, initialCourse, initialKind }: { load: ExamPageLoad; examId: string | null; initialCourse: string | null; initialKind: ExamKind }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const router = useLoadingRouter();
  const courses = useMemo(() => load.state === 'ready' ? load.courses : [], [load]);
  const editable = courses.filter(c => c.canEdit && c.offerings.length > 0);
  const [state, setState] = useState<Wizard | null>(null);
  const [author, setAuthor] = useState(true);
  const [windows, setWindows] = useState<ExamWindow[]>([]);
  const [readFailure, setReadFailure] = useState<ExamFailure | null>(null);
  const [step, setStep] = useState<ExamStep>('details');
  const [save, setSave] = useState<Save>('idle');
  const [failure, setFailure] = useState<ExamFailure | null>(null);
  const [issues, setIssues] = useState<ExamIssue[]>([]);
  const [structure, setStructure] = useState<CourseStructure | null>(null);
  const [structureFailed, setStructureFailed] = useState(false);
  const [picture, setPicture] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<{ at: string; percent: number } | null>(null);
  const [uploadFailure, setUploadFailure] = useState<{ at: string; text: string } | null>(null);
  const [popup, setPopup] = useState<WindowPopup>(null);
  const [finishing, setFinishing] = useState(false);
  const [live, setLive] = useState('');
  const edits = useRef(0), saved = useRef(0), saving = useRef(false), latest = useRef<Wizard | null>(null), baseCore = useRef('');
  latest.current = state;

  // ---- reading
  const readExam = useCallback(async (id: string, keep = false) => {
    const read = await examCall<ExamView>(`${EXAMS_API}/${id}`);
    if (!read.ok) { if (!keep) setReadFailure(read.failure); return null; }
    setWindows(read.body.windows); setAuthor(read.body.can.author);
    if (!keep) {
      const next = fromExamView(read.body, ids);
      edits.current = saved.current = 0; baseCore.current = coreOf(next);
      setState(next); setReadFailure(null); setSave('idle'); setFailure(null);
    } else setState(s => s && { ...s, revision: read.body.revision, status: read.body.status, started: read.body.started });
    return read.body;
  }, []);
  useEffect(() => {
    if (examId) { void readExam(examId); return; }
    const course = editable.find(c => c.id === initialCourse) ?? (editable.length === 1 ? editable[0] : undefined);
    setState(newExam(ids, initialKind, course ? { courseId: course.id, offeringId: course.offerings.length === 1 ? course.offerings[0].id : '' } : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per page
  }, [examId]);

  const courseId = state?.courseId ?? '';
  useEffect(() => {
    if (!courseId) { setStructure(null); return; }
    let on = true;
    setStructureFailed(false);
    fetch(`/api/teacher/courses/${courseId}/content`, { cache: 'no-store' })
      .then(async r => { if (!on) return; if (!r.ok) { setStructureFailed(true); return; } setStructure(await r.json() as CourseStructure); })
      .catch(() => { if (on) setStructureFailed(true); });
    return () => { on = false; };
  }, [courseId]);
  const chapters = useMemo(() => structure ? buildTree(structure) : [], [structure]);

  // ---- writing
  const change = useCallback((fn: (s: Wizard) => Wizard) => { setState(s => s ? fn(s) : s); edits.current++; setIssues([]); }, []);
  /** One save of `s` as it is (a new exam names its run and kind). A started exam sends only its details. */
  const store = useCallback(async (s: Wizard): Promise<{ ok: true; body: Saved } | { ok: false; failure: ExamFailure }> => {
    const definition = s.id ? (s.started ? detailsOnly(toExamDefinition(s)) : toExamDefinition(s)) : toExamDefinition(s, { create: true });
    return examCall<Saved>(`${EXAMS_API}/${s.id ?? 'new'}/save`, { offeringId: s.id ? null : s.offeringId, revision: s.id ? s.revision : null, definition });
  }, []);
  const send = useCallback(async (): Promise<Saved | null> => {
    const s = latest.current;
    if (!s || saving.current || !examSavable(s)) return null;
    saving.current = true; setSave('saving');
    const at = edits.current;
    try {
      const reply = await store(s);
      if (!reply.ok) { setFailure(reply.failure); setSave(reply.failure.kind === 'changed' || (reply.failure.kind === 'refused' && reply.failure.reason === 'started') ? 'stale' : 'failed'); return null; }
      saved.current = at; setFailure(null);
      setState(cur => cur && { ...cur, id: reply.body.id, revision: reply.body.revision });
      if (!s.id) { try { window.history.replaceState(window.history.state, '', `/teacher/exams/${reply.body.id}`); } catch { /* the address is a convenience */ } }
      setSave(edits.current === at ? 'saved' : 'waiting');
      // Each Group's linked session follows the starting day: read the windows again after a save of the times.
      if (s.kind === 'online' && s.timing === 'per_group') void readExam(reply.body.id, true).then(v => { if (v) setState(cur => cur && { ...cur, revision: v.revision }); });
      return reply.body;
    } finally { saving.current = false; }
  }, [readExam, store]);
  // Autosave: a draft nobody started, a moment after the last keystroke. Never a published or started exam, never after a stale save.
  useEffect(() => {
    if (!state || !author || state.started || state.status !== 'draft' || save === 'stale' || save === 'saving' || finishing) return;
    if (edits.current === saved.current || !examSavable(state)) { if (edits.current !== saved.current && save !== 'waiting') setSave('waiting'); return; }
    const timer = window.setTimeout(() => { void send(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [state, save, send, finishing, author]);

  const cap = state ? limitCap(state, windows) : null;
  const coreChanged = state ? coreOf(state) !== baseCore.current : false;

  /** Review: publish (every step complete) or keep as a draft. A started exam whose questions, times or rules changed becomes a new version first. */
  async function finish(publish: boolean) {
    const s = latest.current;
    if (!s || finishing || !author) return;
    const blocking = publish || (s.started && coreChanged) ? examIssues(s, Date.now(), cap) : examStepIssues(s, 'details', Date.now());
    if (blocking.length) { setIssues(blocking); return; }
    setFinishing(true); setFailure(null);
    try {
      let current = s;
      if (s.started && coreChanged && s.id && s.revision !== null) {
        // A new version: a copy of this exam (its questions, chapters and rules) as a draft, then everything typed saved on it.
        const clone = await examCall<Saved>(`${EXAMS_API}/${s.id}/lifecycle`, { action: 'clone', revision: s.revision });
        if (!clone.ok) { setFailure(clone.failure); return; }
        current = { ...s, id: clone.body.id, revision: clone.body.revision, status: 'draft', started: false, version: s.version + 1 };
        latest.current = current; setState(current);
      }
      if (current.id && current.status !== 'draft' && !current.started && !questionsSavable(current)) { setIssues(examIssues(current, Date.now(), cap)); return; }
      const stored = await store(current);
      if (!stored.ok) { setFailure(stored.failure); if (stored.failure.kind === 'changed') setSave('stale'); return; }
      current = { ...current, id: stored.body.id, revision: stored.body.revision };
      latest.current = current; setState(current); saved.current = edits.current;
      if (publish && current.status === 'draft') {
        const done = await examCall<Saved>(`${EXAMS_API}/${current.id}/lifecycle`, { action: 'publish', revision: current.revision });
        if (!done.ok) { setFailure(done.failure); try { window.history.replaceState(window.history.state, '', `/teacher/exams/${current.id}`); } catch { /* convenience */ } return; }
      }
      actionToast(t(publish ? (s.status === 'draft' || current.version > s.version ? 'ex.w.published_live' : 'ex.w.saved_live') : 'ex.w.draft_live', { title: s.title.trim() }));
      router.push('/teacher/exams');
    } finally { setFinishing(false); }
  }
  async function reload() { if (state?.id) { setSave('idle'); setFailure(null); await readExam(state.id); } }

  // ---- pictures
  function uploadTo(at: string, file: File, purpose: 'question' | 'model', done: (row: { id: string }) => void) {
    if (!state?.id || upload) return;
    const id = state.id;
    setUploadFailure(null); setUpload({ at, percent: 0 });
    uploadExamPicture(id, file, purpose, percent => setUpload({ at, percent }))
      .then(row => { done(row); setPicture(p => ({ ...p, [row.id]: '' })); examPictureUrl(id, row.id).then(url => setPicture(p => ({ ...p, [row.id]: url }))).catch(() => undefined); })
      .catch(() => setUploadFailure({ at, text: t('hw.w.picture_failed') }))
      .finally(() => setUpload(null));
  }
  useEffect(() => {
    if (!state?.id) return;
    for (const imageId of state.questions.flatMap(q => [q.imageId, q.modelImageId])) if (imageId && picture[imageId] === undefined) {
      setPicture(p => ({ ...p, [imageId]: '' }));
      examPictureUrl(state.id, imageId).then(url => setPicture(p => ({ ...p, [imageId]: url }))).catch(() => undefined);
    }
  }, [state?.id, state?.questions, picture]);

  // ---- rendering
  if (readFailure) return <Frame title={<L id="ex.w.edit" />} status={null}><div role="alert" data-state="error" className="d-alert">
    <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{readFailure.kind === 'denied' ? t('ex.w.not_found') : examFailureWords(t, readFailure)}</span></p>
    {readFailure.kind === 'signin' ? <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link> : readFailure.kind !== 'denied' && <Button onClick={() => examId && void readExam(examId)}><L id="th.state.retry" /></Button>}
  </div></Frame>;
  if (!state) return <Frame title={<L id={examId ? 'ex.w.edit' : 'ex.w.new'} />} status={null}><div role="status" data-state="loading" className="d-card d-card--pad d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}<span className="sr-only"><L id="th.state.loading" /></span></div></Frame>;
  if (!examId && !editable.length) return <Frame title={<L id="ex.w.new" />} status={null}><div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="ex.w.no_courses" /></p></div></Frame>;

  const steps = stepsOf(state.kind);
  const index = Math.max(0, steps.indexOf(step));
  const shown = steps[index];
  const go = (next: ExamStep) => { setIssues([]); setStep(next); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); };
  const next = () => { const found = examStepIssues(state, shown, Date.now(), cap); if (found.length) { setIssues(found); return; } go(steps[index + 1]); };
  const now = Date.now();
  const saveText: Record<Save, MessageKey | null> = { idle: state.id ? 'hw.w.saved' : null, saving: 'hw.w.saving', saved: 'hw.w.saved', waiting: 'hw.w.unsaved', failed: 'hw.w.save_failed', stale: 'hw.w.save_failed' };
  const status = !author || state.started || state.status !== 'draft' ? null : saveText[save];
  const questionsPending = state.kind === 'online' && state.status === 'draft' && !questionsSavable(state) && (save === 'saved' || save === 'idle') && Boolean(state.id);
  const issueList = issues.length > 0 && <div role="alert" data-issues className="d-alert"><ul className="d-stack-xs">{issues.map((issue, i) => <li key={i} data-issue={issue.key} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{t(`ex.w.issue.${issue.key}` as MessageKey, { n: (issue.question ?? 0) + 1, cap: cap === null ? '' : durationWords(t, cap, number) })}</li>)}</ul></div>;
  const fixed = Boolean(state.id);
  // Before the steps: the When step's window rows use it too.
  const readOnlyWhy = !author ? 'ex-w-read-only' : undefined;
  const currentCourse = courses.find(c => c.id === state.courseId);
  const courseOptions = (fixed ? courses.filter(c => c.id === state.courseId) : editable).flatMap(c => c.offerings.map(o => ({ value: `${c.id}:${o.id}`, label: <bdi dir="auto">{c.offerings.length > 1 ? `${c.title} · ${o.name}` : c.title}</bdi> })));
  if (currentCourse && state.offeringId && !courseOptions.some(o => o.value === `${currentCourse.id}:${state.offeringId}`)) courseOptions.push({ value: `${currentCourse.id}:${state.offeringId}`, label: <bdi dir="auto">{currentCourse.title}</bdi> });

  // -- Details
  const details = <Card title="ex.w.step.details" hint={state.kind === 'paper' ? 'ex.w.details_hint_paper' : 'ex.w.details_hint'}>
    <ChoiceGroup label={t('ex.w.kind')} value={state.kind} columns={2} disabled={fixed} reason={fixed ? t('ex.w.kind_fixed') : undefined} onChange={kind => change(s => ({ ...s, kind, questions: kind === 'online' && !s.questions.length ? [newExamQuestion('choice', ids)] : s.questions }))} data-field="kind" options={[
      { value: 'online', label: t('ex.kind.online'), description: t('ex.kind.online_hint'), 'data-kind': 'online' },
      { value: 'paper', label: t('ex.kind.paper'), description: t('ex.kind.paper_hint'), 'data-kind': 'paper' },
    ]} />
    <Field label={<L id="ex.w.title" />} value={state.title} maxLength={200} dir="auto" autoComplete="off" onChange={e => change(s => ({ ...s, title: e.target.value }))} data-field="title" />
    <label className="d-field" data-field="course"><span className="d-field-label"><L id="ex.w.course" /></span>
      <Select value={state.courseId && state.offeringId ? `${state.courseId}:${state.offeringId}` : ''} placeholder={t('ex.w.course_pick')} disabled={fixed} aria-describedby={fixed ? 'ex-course-fixed' : undefined} options={courseOptions}
        onChange={v => { const [c, o] = v.split(':'); change(s => ({ ...s, courseId: c, offeringId: o, chapterIds: [], coversAllChapters: true })); }} />
      {fixed && <span id="ex-course-fixed" className="d-field-hint"><L id="ex.w.course_fixed" /></span>}
    </label>
    <fieldset className="d-stack-xs" data-chapters>
      <legend className="d-field-label"><L id="ex.w.chapters" /></legend>
      <div role="group" aria-label={t('ex.w.chapters')} className="d-hw-chips">
        <button type="button" role="checkbox" aria-checked={state.coversAllChapters} data-chapter="all" className="d-ex-chip d-focus" onClick={() => change(s => ({ ...s, ...toggleChapter(s, 'all') }))}>{state.coversAllChapters && <Icon name="check" size={14} />}<L id="ex.w.chapters_all" /></button>
        {chapters.map(c => { const on = !state.coversAllChapters && state.chapterIds.includes(c.id); return <button key={c.id} type="button" role="checkbox" aria-checked={on} data-chapter={c.id} className="d-ex-chip d-focus" onClick={() => change(s => ({ ...s, ...toggleChapter(s, c.id) }))}>
          {on && <Icon name="check" size={14} />}{t('tc.content.chapter_n', { n: c.number })}{c.title && <> · <bdi dir="auto">{c.title}</bdi></>}</button>; })}
      </div>
      {structureFailed && <p role="alert" className="d-field-error"><L id="tc.content.failed" /></p>}
      <p className="d-meta"><L id="ex.w.chapters_hint" /></p>
    </fieldset>
    {state.kind === 'paper' && <div className="d-field-pair">
      <Field type="number" inputMode="numeric" min={1} max={PAPER_MAX} label={<L id="ex.w.max_marks" />} value={String(state.maxMarks)} onChange={e => change(s => ({ ...s, maxMarks: Math.round(Number(e.target.value)) || 0 }))} data-field="max-marks" />
      <Field type="date" label={<><L id="ex.w.held_on" /> <span className="d-meta"><L id="hw.w.optional" /></span></>} value={state.heldOn} onChange={e => change(s => ({ ...s, heldOn: e.target.value }))} data-field="held-on" />
    </div>}
    <TextArea label={<><L id="ex.w.description" /> <span className="d-meta"><L id="hw.w.optional" /></span></>} value={state.description} maxLength={8000} rows={3} onChange={v => change(s => ({ ...s, description: v }))} data="description" />
  </Card>;

  // -- Questions (Homework's step, with Number for exams)
  const questions = <QuestionsStep<ExamQuestion> questions={state.questions} kinds={['choice', 'number', 'essay']} change={fn => change(s => ({ ...s, questions: fn(s.questions) }))}
    create={kind => newExamQuestion(kind, ids)} setKind={(x, kind) => setExamKind(x, kind, ids)}
    picture={picture} upload={upload} uploadFailure={uploadFailure} uploadBlocked={!state.id ? t('ex.w.picture_wait') : null}
    onUploadFailure={at => setUploadFailure({ at, text: t('hw.w.picture_failed') })} onUpload={uploadTo} />;

  // -- When
  const opens = opensIso(state), closes = closesIso(state);
  const when = <Card title="ex.w.step.when" hint="ex.w.when_hint">
    <ChoiceGroup label={t('ex.w.timing')} value={state.timing} onChange={timing => change(s => ({ ...s, timing }))} data-field="timing" options={[
      { value: 'per_group', label: t('ex.timing.per_group'), description: t('ex.timing.per_group_hint'), 'data-timing': 'per_group' },
      { value: 'same_time', label: t('ex.timing.same_time'), description: t('ex.timing.same_time_hint'), 'data-timing': 'same_time' },
    ]} />
    {state.timing === 'per_group' ? <div className="d-stack-sm" data-per-group>
      <Field type="date" label={<L id="ex.w.starting_from" />} value={state.startingFrom} min={cairoDate(now)} onChange={e => change(s => ({ ...s, startingFrom: e.target.value }))} data-field="starting-from" hint={<L id="ex.w.starting_from_hint" />} />
      <div className="d-stack-xs" data-windows>
        <span className="d-field-label"><L id="ex.w.each_group" /></span>
        {!state.id || !state.startingFrom ? <p className="d-meta" data-windows-wait><L id={state.startingFrom ? 'ex.w.windows_wait' : 'ex.w.windows_pick_day'} /></p>
          : windows.length === 0 ? <p className="d-meta" data-no-groups><L id="ex.w.no_groups" /></p>
          : <ul className="d-list">{windows.map(w => windowRow(w))}</ul>}
        {save === 'saving' && state.id && <p className="d-meta" role="status"><L id="ex.w.windows_reading" /></p>}
      </div>
      <p className="d-content-line" data-no-group-note><Icon name="info" /><span><L id="ex.w.no_group_note" /></span></p>
    </div> : <fieldset className="d-stack-xs" data-same-time>
      <legend className="d-field-label"><L id="ex.w.window" /></legend>
      <div className="d-field-pair">
        <Field type="date" label={<L id="ex.w.opens_date" />} value={state.opensDate} min={cairoDate(now)} onChange={e => change(s => ({ ...s, opensDate: e.target.value, closesDate: s.closesDate || e.target.value }))} data-field="opens-date" />
        <Field type="time" label={<L id="ex.w.opens_time" />} value={state.opensTime} onChange={e => change(s => ({ ...s, opensTime: e.target.value }))} data-field="opens-time" />
      </div>
      <div className="d-field-pair">
        <Field type="date" label={<L id="ex.w.closes_date" />} value={state.closesDate} min={state.opensDate || cairoDate(now)} onChange={e => change(s => ({ ...s, closesDate: e.target.value }))} data-field="closes-date" />
        <Field type="time" label={<L id="ex.w.closes_time" />} value={state.closesTime} onChange={e => change(s => ({ ...s, closesTime: e.target.value }))} data-field="closes-time" />
      </div>
      {opens && closes && Date.parse(closes) > Date.parse(opens) && <p className="d-meta" data-window-shown>{t('ex.same_time_at', { day: cairoDay(opens, lang), from: cairoTime(opens, lang), to: cairoTime(closes, lang) })} · <L id="hw.w.cairo" /></p>}
      <p className="d-content-line" data-everyone-note><Icon name="info" /><span><L id="ex.w.same_time_note" /></span></p>
    </fieldset>}
    <div className="d-stack-xs" data-time-limit>
      <Switch checked={state.limitOn} onChange={on => change(s => ({ ...s, limitOn: on, timeLimitMinutes: clampLimit(s.timeLimitMinutes, cap) }))} data-limit-switch="" label={<span className="d-stack-xs"><span><L id="ex.w.limit" /></span><span className="d-meta"><L id="ex.w.limit_hint" /></span></span>} />
      {state.limitOn && <div className="d-hw-qhead"><span className="d-label"><L id="ex.w.limit_minutes" /></span>
        <Stepper value={state.timeLimitMinutes} min={5} max={cap ?? 1440} step={5} label={t('ex.w.limit_minutes')} less={t('ex.w.limit_less')} more={t('ex.w.limit_more')} shown={durationWords(t, state.timeLimitMinutes, number)}
          lessReason={t('ex.w.limit_min')} moreReason={cap !== null ? t('ex.w.limit_cap', { cap: durationWords(t, cap, number) }) : undefined} onChange={n => change(s => ({ ...s, timeLimitMinutes: clampLimit(n, cap) }))} data="limit" />
      </div>}
      {state.limitOn && cap !== null && <p className="d-meta" data-limit-cap>{t('ex.w.limit_cap', { cap: durationWords(t, cap, number) })}</p>}
    </div>
  </Card>;

  // -- Rules
  const essays = hasEssays(state);
  const rules = <Card title="ex.w.step.rules" hint="ex.w.rules_hint">
    <ChoiceGroup label={t('ex.w.tries')} value={state.tries} onChange={tries => change(s => ({ ...s, tries }))} data-field="tries" options={[
      { value: 'one_time', label: t('ex.tries.one'), description: t('ex.tries.one_hint'), 'data-tries': 'one_time' },
      { value: 'fix_mistakes', label: t('ex.tries.fix'), description: t('ex.tries.fix_hint'), 'data-tries': 'fix_mistakes' },
      { value: 'from_zero', label: t('ex.tries.zero'), description: t('ex.tries.zero_hint'), 'data-tries': 'from_zero' },
    ]} />
    <Switch checked={state.shuffle} onChange={on => change(s => ({ ...s, shuffle: on }))} data-shuffle="" label={<span className="d-stack-xs"><span><L id="ex.w.shuffle" /></span><span className="d-meta"><L id="ex.w.shuffle_hint" /></span></span>} />
    {essays && <Switch checked={state.photos} onChange={on => change(s => ({ ...s, photos: on }))} data-photos-switch="" label={<span className="d-stack-xs"><span><L id="hw.w.photos" /></span><span className="d-meta"><L id="hw.w.photos_hint" /></span></span>} />}
    <Switch checked={state.autoRelease && !essays} disabled={essays} reason={essays ? t('ex.w.auto_release_off') : undefined} onChange={on => change(s => ({ ...s, autoRelease: on }))} data-auto-release=""
      label={<span className="d-stack-xs"><span><L id="ex.w.auto_release" /></span><span className="d-meta"><L id="ex.w.auto_release_hint" /></span></span>} />
  </Card>;

  // -- Review
  const choiceN = state.questions.filter(x => x.kind === 'choice').length, numberN = state.questions.filter(x => x.kind === 'number').length, essayN = state.questions.length - choiceN - numberN;
  const whenText = state.timing === 'per_group' ? (state.startingFrom ? t('ex.per_group_from', { day: dayLabel(state.startingFrom, lang) }) : t('ex.no_start'))
    : opens && closes ? t('ex.same_time_at', { day: cairoDay(opens, lang), from: cairoTime(opens, lang), to: cairoTime(closes, lang) }) : t('ex.no_time');
  const chapterText = state.coversAllChapters ? t('ex.w.chapters_all') : chapters.filter(c => state.chapterIds.includes(c.id)).map(c => t('tc.content.chapter_n', { n: c.number })).join(' · ');
  const review = <div className="d-stack-sm">
    <dl className="d-card d-card--pad d-hw-review" data-review>
      <ReviewRow k="details" go={go}><span className="d-label"><bdi dir="auto">{state.title || '–'}</bdi></span>
        <span className="d-meta">{t(state.kind === 'paper' ? 'ex.kind.paper' : 'ex.kind.online')} · <bdi dir="auto">{currentCourse?.title ?? ''}</bdi> · {chapterText}</span>
        {state.kind === 'paper' && <span className="d-meta">{t('ex.out_of', { n: number(state.maxMarks) })}{state.heldOn ? ` · ${dayLabel(state.heldOn, lang)}` : ''}</span>}</ReviewRow>
      {state.kind === 'online' && <>
        <ReviewRow k="questions" go={go}><span className="d-label">{examCount(t, 'question', state.questions.length)} · {examCount(t, 'mark', examTotal(state))}</span>
          <span className="d-meta">{[choiceN ? t('ex.w.r.choice', { n: number(choiceN) }) : '', numberN ? t('ex.w.r.number', { n: number(numberN) }) : '', essayN ? examCount(t, 'essay', essayN) : ''].filter(Boolean).join(' · ')}</span></ReviewRow>
        <ReviewRow k="when" go={go}><span className="d-label">{whenText}</span>
          <span className="d-meta">{state.limitOn ? t('ex.w.r.limit', { d: durationWords(t, state.timeLimitMinutes, number) }) : t('ex.w.r.no_limit')}</span></ReviewRow>
        <ReviewRow k="rules" go={go}><span className="d-label">{triesWords(t, state.tries)}</span>
          <span className="d-meta">{t(state.shuffle ? 'ex.w.r.shuffle_on' : 'ex.w.r.shuffle_off')} · {t(state.autoRelease && !essays ? 'ex.w.r.auto_on' : 'ex.w.r.auto_off')}</span></ReviewRow>
      </>}
    </dl>
    {state.started && <div className="d-notice d-stack-xs" data-started-review><p className="d-label"><L id={coreChanged ? 'ex.w.version_title' : 'ex.w.started_title'} /></p><p className="d-body"><L id={coreChanged ? 'ex.w.version_body' : 'ex.w.started_body'} /></p></div>}
    {!state.started && state.status === 'draft' && <p className="d-content-line" data-publish-note><Icon name="bell" /><span><L id={state.kind === 'paper' ? 'ex.w.publish_note_paper' : 'ex.w.publish_note'} /></span></p>}
  </div>;

  const body: Record<ExamStep, ReactNode> = { details, questions, when, rules, review };
  const published = state.status !== 'draft';
  const primaryKey: MessageKey = state.started ? (coreChanged ? 'ex.w.publish_version' : 'ex.w.save_details') : published ? 'ex.w.save_published' : 'ex.w.publish';
  return <Frame title={shown === 'review' ? <L id="ex.w.review_title" /> : state.title.trim() && shown !== 'details' ? <bdi dir="auto">{state.title}</bdi> : <L id={examId ? 'ex.w.edit' : 'ex.w.new'} />} status={status} phone={phone} steps={steps} step={index} kind={state.kind}>
    {!author && <div className="d-notice" data-read-only id="ex-w-read-only"><p className="d-content-line"><Icon name="info" /><span><L id="ex.w.read_only" /></span></p></div>}
    {state.started && shown !== 'review' && <div className="d-notice" data-started-note><p className="d-content-line"><Icon name="info" /><span><L id="ex.w.started_body" /></span></p></div>}
    {(save === 'stale' || (save === 'failed' && failure)) && <div role="alert" data-save-failure={save} className="d-alert">
      <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{save === 'stale' ? t('ex.w.stale') : examFailureWords(t, failure!)}</span></p>
      {save === 'stale' ? <Button data-reload onClick={() => void reload()}><L id="tc.reload" /></Button> : <Button data-retry-save onClick={() => void send()}><L id="th.state.retry" /></Button>}
    </div>}
    {failure && save !== 'stale' && save !== 'failed' && <div role="alert" data-finish-failure={failure.kind} className="d-alert"><p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{examFailureWords(t, failure)}</span></p></div>}
    {questionsPending && shown === 'questions' && <p className="d-content-line" data-questions-pending><Icon name="info" /><span><L id="ex.w.questions_pending" /></span></p>}
    {body[shown]}
    {issueList}
    <div className="d-hw-bar" data-wizard-bar>
      {index > 0 ? <Button data-step-back aria-label={phone ? t('hw.w.back') : undefined} onClick={() => go(steps[index - 1])}><Icon name="back" size={16} />{!phone && <L id="hw.w.back" />}</Button> : <span />}
      {!phone && shown !== 'review' && <span className="d-meta">{t('ex.w.step_of', { n: index + 1, total: steps.length })}</span>}
      {shown === 'review' ? <span className="d-hw-finish">
        {!published && !state.started && <Button data-keep-draft aria-disabled={finishing || !author || undefined} aria-describedby={readOnlyWhy} onClick={() => void finish(false)}><L id="ex.w.keep_draft" /></Button>}
        {state.started && coreChanged && <Button data-version-draft aria-disabled={finishing || !author || undefined} aria-describedby={readOnlyWhy} onClick={() => void finish(false)}><L id="ex.w.version_draft" /></Button>}
        <Button variant="primary" data-publish aria-disabled={finishing || !author || undefined} aria-describedby={readOnlyWhy} aria-busy={finishing || undefined} onClick={() => void finish(true)}>{finishing && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={primaryKey} /></Button>
      </span> : <Button variant="primary" data-step-next onClick={next}>{t(index === steps.length - 2 ? 'hw.w.to_review' : 'hw.w.next', { step: t(STEP_KEYS[steps[index + 1]]) })}<Icon name="chevron" size={16} /></Button>}
    </div>
    <p role="status" data-wizard-live className="sr-only">{live}</p>
    {popup && state.id && state.revision !== null && <WindowDialog examId={state.id} revision={state.revision} popup={popup} onClose={() => setPopup(null)}
      onDone={async revision => { setPopup(null); setState(s => s && { ...s, revision }); const v = await readExam(state.id as string, true); if (v) setState(s => s && { ...s, revision: v.revision }); setLive(t('ex.w.window_saved')); actionToast(t('ex.w.window_saved')); }} />}
  </Frame>;

  function windowRow(w: ExamWindow) {
    const open = w.frozen || (w.state === 'ok' && w.opensAt !== null && Date.parse(w.opensAt) <= now && state?.status === 'published');
    const whenText = w.state === 'ok' && w.opensAt && w.closesAt ? `${cairoDay(w.opensAt, lang)} · ${cairoTime(w.opensAt, lang)}–${cairoTime(w.closesAt, lang)}` : t(w.state === 'cancelled' ? 'ex.window.cancelled' : 'ex.window.needs_time');
    const why = `ex-w-open-${w.groupId}`;
    return <li key={w.groupId} data-window-row={w.groupId} data-source={w.source} data-state={w.state} className="d-row d-row--action">
      <span className="d-row-body">
        <span className="d-label"><bdi dir="auto">{w.groupName}</bdi></span>
        <span className="d-meta">{whenText}{w.source === 'picked' ? ` · ${t('ex.window.picked')}` : w.source === 'custom' ? ` · ${t('ex.window.custom')}` : ''}</span>
        {open && <span id={why} className="d-meta"><L id="ex.fail.window_open" /></span>}
      </span>
      <span className="d-row-trailing">
        {w.state !== 'ok' && <StatusPill tone="warning" data-needs-time=""><L id={w.state === 'cancelled' ? 'ex.window.cancelled_short' : 'ex.window.needs_time_short'} /></StatusPill>}
        <Button variant="tertiary" data-window-change={w.groupId} aria-disabled={open || !author || undefined} aria-describedby={open ? why : readOnlyWhy} onClick={() => { if (!open && author) setPopup({ type: w.state === 'needs_time' ? 'time' : 'session', window: w }); }}>
          <L id={w.state === 'needs_time' ? 'ex.w.pick_time' : 'ex.w.change'} /></Button>
      </span>
    </li>;
  }
}

/** Change a Group's window: another coming session of that Group, a time of its own (for a Group with no session), or back to its session. */
function WindowDialog({ examId, revision, popup, onClose, onDone }: { examId: string; revision: number; popup: NonNullable<WindowPopup>; onClose: () => void; onDone: (revision: number) => void }) {
  const { t, language } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const w = popup.window;
  const [mode, setMode] = useState<'session' | 'time'>(popup.type);
  const [sessions, setSessions] = useState<GroupSession[] | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [picked, setPicked] = useState<string>(w.source === 'picked' && w.sessionId ? w.sessionId : '');
  const a0 = w.source === 'custom' && w.opensAt ? cairoFields(w.opensAt) : null, b0 = w.source === 'custom' && w.closesAt ? cairoFields(w.closesAt) : null;
  const [date, setDate] = useState(a0?.date ?? '');
  const [from, setFrom] = useState(a0?.time ?? '09:00');
  const [to, setTo] = useState(b0?.time ?? '10:00');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let on = true;
    groupCall<GroupPage<GroupSession>>('view', w.groupId, { section: 'sessions', page: 0 })
      .then(p => { if (on) setSessions(p.rows.filter(s => !s.cancelled && Date.parse(s.starts_at) > Date.now())); })
      .catch(() => { if (on) setReadFailed(true); });
    return () => { on = false; };
  }, [w.groupId]);
  async function send(body: Record<string, unknown>) {
    if (sending) return;
    setSending(true); setError(null);
    try {
      const done = await examCall<{ revision: number }>(`${EXAMS_API}/${examId}/window`, { groupId: w.groupId, revision, ...body });
      if (!done.ok) { setError(done.failure.kind === 'changed' ? t('ex.w.stale') : examFailureWords(t, done.failure)); return; }
      onDone(done.body.revision);
    } finally { setSending(false); }
  }
  function save() {
    if (mode === 'session') { if (!picked) { setError(t('ex.w.pick_session_first')); return; } void send({ source: 'picked', sessionId: picked }); return; }
    const a = date ? cairoIso(date, from) : null, b = date ? cairoIso(date, to) : null;
    if (!a || !b) { setError(t('ex.w.issue.times_invalid')); return; }
    if (Date.parse(b) <= Date.parse(a)) { setError(t('ex.w.issue.closes_before')); return; }
    if (Date.parse(a) <= Date.now()) { setError(t('ex.fail.time_passed')); return; }
    void send({ source: 'custom', opensAt: a, closesAt: b });
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending) onClose(); }} data-window-dialog={w.groupId} title={t('ex.w.window_title', { group: w.groupName })}
    footer={<>{w.source !== 'auto' && <Button variant="tertiary" data-window-auto aria-disabled={sending || undefined} onClick={() => void send({ source: 'auto' })}><L id="ex.w.back_to_session" /></Button>}
      <Button data-window-cancel aria-disabled={sending || undefined} onClick={() => { if (!sending) onClose(); }}><L id="hw.cancel" /></Button>
      <Button variant="primary" data-window-save aria-disabled={sending || undefined} aria-busy={sending || undefined} onClick={save}>{sending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ex.w.window_save" /></Button></>}>
    <div className="d-stack-sm">
      <ChoiceGroup label={t('ex.w.window_how')} value={mode} columns={2} onChange={setMode} options={[{ value: 'session', label: t('ex.w.another_session'), 'data-window-mode': 'session' }, { value: 'time', label: t('ex.w.pick_time'), 'data-window-mode': 'time' }]} />
      {mode === 'session' && (readFailed ? <p role="alert" className="d-field-error"><L id="ex.w.sessions_failed" /></p>
        : sessions === null ? <DesignSkeleton className="h-11 w-full" />
        : sessions.length === 0 ? <p className="d-meta" data-no-sessions><L id="ex.w.no_sessions" /></p>
        : <ChoiceGroup label={t('ex.w.coming_sessions')} value={picked || null} onChange={setPicked} options={sessions.slice(0, 12).map(s => ({ value: s.id, label: `${cairoDay(s.starts_at, lang)} · ${cairoTime(s.starts_at, lang)}–${cairoTime(s.ends_at, lang)}`, 'data-session': s.id }))} />)}
      {mode === 'time' && <div className="d-stack-xs">
        <Field type="date" label={<L id="ex.w.window_day" />} value={date} min={cairoDate(Date.now())} onChange={e => { setDate(e.target.value); setError(null); }} data-window-date="" />
        <div className="d-field-pair">
          <Field type="time" label={<L id="ex.w.opens_time" />} value={from} onChange={e => { setFrom(e.target.value); setError(null); }} data-window-from="" />
          <Field type="time" label={<L id="ex.w.closes_time" />} value={to} onChange={e => { setTo(e.target.value); setError(null); }} data-window-to="" />
        </div>
        <p className="d-meta"><L id="hw.w.cairo" /></p>
      </div>}
      {error && <p role="alert" data-window-error className="d-field-error">{error}</p>}
    </div>
  </Dialog>;
}

/** The wizard's frame: back to Exams, the save state, the title, and where the teacher is among the steps (a bar on a phone). */
function Frame({ title, status, phone = false, steps, step, kind, children }: { title: ReactNode; status: MessageKey | null; phone?: boolean; steps?: readonly ExamStep[]; step?: number; kind?: ExamKind; children: ReactNode }) {
  const { t } = useLanguage();
  const last = steps ? steps.length - 1 : 0;
  return <div data-exam-wizard data-step={steps && step !== undefined ? steps[step] : undefined} data-kind={kind} className="d-stack-lg d-hw-wizard">
    <div className="d-hw-top">
      <Link href="/teacher/exams" className="d-back d-focus" data-wizard-back><Icon name="back" size={16} /><L id="ex.title" /></Link>
      {status && <span role="status" data-save-state={status} className="d-meta">{t(status)}</span>}
    </div>
    {steps && step !== undefined && phone && <div className="d-stack-xs" data-steps-phone>
      <span className="d-meta d-hw-eyebrow">{step < last ? t('ex.w.step_eyebrow', { n: step + 1, total: last, step: t(STEP_KEYS[steps[step]]) }) : t(STEP_KEYS.review)}</span>
      <div role="progressbar" aria-label={t('hw.w.steps')} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} className="d-hw-progress">{steps.map((key, i) => <i key={key} data-done={i <= step ? '' : undefined} />)}</div>
    </div>}
    <h1 className="d-title">{title}</h1>
    {steps && step !== undefined && !phone && <nav aria-label={t('hw.w.steps')} data-steps className="d-hw-steps">
      {steps.map((key, i) => <span key={key} aria-current={i === step ? 'step' : undefined} data-done={i < step ? '' : undefined} className="d-hw-step">
        <i aria-hidden="true">{i < step || key === 'review' ? <Icon name="check" size={14} /> : i + 1}</i>{t(STEP_KEYS[key])}{i < step && <span className="sr-only"> ({t('hw.w.done')})</span>}
        {i < last && <span aria-hidden="true" className="d-hw-step-line" />}
      </span>)}
    </nav>}
    {children}
  </div>;
}

function Card({ title, hint, children }: { title: MessageKey; hint: MessageKey; children: ReactNode }) {
  return <section aria-labelledby="ex-card" className="d-card d-card--pad d-stack-sm" data-wizard-card>
    <div className="d-stack-xs"><h2 id="ex-card" className="d-section"><L id={title} /></h2><p className="d-meta"><L id={hint} /></p></div>
    {children}
  </section>;
}

function ReviewRow({ k, go, children }: { k: Exclude<ExamStep, 'review'>; go: (step: ExamStep) => void; children: ReactNode }) {
  const { t } = useLanguage();
  return <div className="d-hw-review-row" data-review-row={k}>
    <dt className="d-section-label">{t(STEP_KEYS[k])}</dt>
    <dd className="d-row-body">{children}</dd>
    <Button variant="tertiary" aria-label={t('hw.w.r.edit_step', { step: t(STEP_KEYS[k]) })} data-review-edit={k} onClick={() => go(k)}><L id="hw.w.r.edit" /></Button>
  </div>;
}
