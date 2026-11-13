'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ActionMenu } from '@/frontend/components/design/action-menu';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { ChoiceGroup, SegmentedControl, Select, Switch } from '@/frontend/components/design/controls';
import { Field } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import { actionToast } from '@/frontend/lib/action-toast';
import { homeworkApi, uploadHomeworkFile } from '@/frontend/lib/homework';
import type { MessageKey } from '@/frontend/locales/messages';
import { buildTree, contentFailure, type CourseStructure, type TreeLesson } from '@/shared/course-content';
import {
  addOption, allIssues, blankAnswers, cairoDay, cairoTime, cairoToday, choiceType, chooseCourse, clampMarks, clampTries, draftSavable, fromView, letter, MAX_OPTIONS, MAX_QUESTIONS, MAX_TRIES, MIN_OPTIONS, MIN_TRIES, moveQuestion, newQuestion, newWizard,
  placeCourses, placeLocked, removeOption, setKind, solutionsRule, stepIssues, toDefinition, toggleCorrect, totalMarks, wizardDeadline, WIZARD_STEPS,
  type HomeworkFailure, type HomeworkPageLoad, type Issue, type TeacherHomeworkView, type WizardQuestion, type WizardState, type WizardStep,
} from '@/shared/teacher-homework';
import { countText, failureWords, homeworkCall, triesText } from './homework-words';
import { FilePick, QuestionsStep, Stepper, TextArea } from './questions-step';

const API = '/api/teacher/homework';
type Save = 'idle' | 'saving' | 'saved' | 'waiting' | 'failed' | 'stale';
type FileRow = { id: string; name: string; kind: 'video' | 'pdf' };
const ids = () => crypto.randomUUID();
const STEP_KEYS: Record<WizardStep, MessageKey> = { details: 'hw.w.step.details', questions: 'hw.w.step.questions', rules: 'hw.w.step.rules', solutions: 'hw.w.step.solutions', review: 'hw.w.step.review' };

/**
 * New homework and editing one: Details, Questions, Rules, Solutions, then Review. A draft saves itself while the teacher types ("Draft saved").
 * A save that finds the homework changed elsewhere keeps what was typed and offers Reload. Once students have started, saving makes a new
 * version (the existing clone); a new date for everyone goes through Change deadline on the Homework page instead.
 * Course and lesson may change until a student starts (get_homework's locked) or for a later version; the save then moves the homework, and
 * a move refused because a student started meanwhile keeps what was typed and offers Reload too.
 */
export function HomeworkWizard({ load, homeworkId, initialCourse }: { load: HomeworkPageLoad; homeworkId: string | null; initialCourse: string | null }) {
  const { t, language } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const phone = usePhone();
  const router = useLoadingRouter();
  const courses = useMemo(() => load.state === 'ready' ? load.courses : [], [load]);
  const editable = courses.filter(c => c.canEdit && c.offerings.length > 0);
  const [state, setState] = useState<WizardState | null>(null);
  const [readFailure, setReadFailure] = useState<HomeworkFailure | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [step, setStep] = useState<WizardStep>('details');
  const [save, setSave] = useState<Save>('idle');
  const [failure, setFailure] = useState<HomeworkFailure | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [structure, setStructure] = useState<CourseStructure | null>(null);
  const [structureFailed, setStructureFailed] = useState(false);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonFailure, setLessonFailure] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [upload, setUpload] = useState<{ at: string; percent: number } | null>(null);
  const [uploadFailure, setUploadFailure] = useState<{ at: string; text: string } | null>(null);
  const [picture, setPicture] = useState<Record<string, string>>({});
  const [finishing, setFinishing] = useState(false);
  const [live, setLive] = useState('');
  const edits = useRef(0), saved = useRef(0), saving = useRef(false), latest = useRef<WizardState | null>(null);
  // Where the homework was when last read or saved, so a refused save can tell a move from an edit.
  const placed = useRef<{ offeringId: string; lessonId: string } | null>(null);
  const [moveRefused, setMoveRefused] = useState(false);
  latest.current = state;
  const now = Date.now();

  // ---- reading
  const readHomework = useCallback(async (id: string) => {
    const read = await homeworkCall<TeacherHomeworkView & { courseId: string | null }>(`${API}/${id}`);
    if (!read.ok) { setReadFailure(read.failure); return; }
    if (read.body.workflow !== 'questions' || read.body.definition.mode !== 'PLATFORM_QUESTIONS') { setLegacy(true); return; }
    const next = fromView(read.body, read.body.courseId ?? courses.find(c => c.offerings.some(o => o.id === read.body.offeringId))?.id ?? '');
    edits.current = saved.current = 0;
    placed.current = { offeringId: next.offeringId, lessonId: next.lessonId }; setMoveRefused(false);
    setState(next); setReadFailure(null); setSave('idle'); setFailure(null);
    const named = await Promise.all([...(next.solutionVideoId ? [next.solutionVideoId] : []), ...next.solutionIds].map(async fileId => {
      try { const m = await homeworkApi<{ name: string; mime: string }>(id, 'media', { id: fileId }); return { id: fileId, name: m.name, kind: m.mime === 'video/mp4' ? 'video' as const : 'pdf' as const }; }
      catch { return { id: fileId, name: fileId === next.solutionVideoId ? 'video.mp4' : 'file.pdf', kind: fileId === next.solutionVideoId ? 'video' as const : 'pdf' as const }; }
    }));
    setFiles(named);
  }, [courses]);
  useEffect(() => {
    if (homeworkId) { void readHomework(homeworkId); return; }
    const course = editable.find(c => c.id === initialCourse) ?? (editable.length === 1 ? editable[0] : undefined);
    setState(newWizard(ids, course ? { courseId: course.id, offeringId: course.offerings.length === 1 ? course.offerings[0].id : '' } : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per page
  }, [homeworkId]);

  const courseId = state?.courseId ?? '';
  const readStructure = useCallback(async () => {
    if (!courseId) { setStructure(null); return; }
    setStructureFailed(false);
    try {
      const response = await fetch(`/api/teacher/courses/${courseId}/content`, { cache: 'no-store' });
      if (!response.ok) { setStructureFailed(true); return; }
      setStructure(await response.json() as CourseStructure);
    } catch { setStructureFailed(true); }
  }, [courseId]);
  useEffect(() => { void readStructure(); }, [readStructure]);
  const tree = useMemo(() => structure ? buildTree(structure) : [], [structure]);
  const lessons = tree.flatMap(c => c.lessons.map(l => ({ ...l, chapter: c.number })));
  const lesson = lessons.find(l => l.id === state?.lessonId) as (TreeLesson & { chapter: number }) | undefined;

  // ---- writing
  const change = useCallback((fn: (s: WizardState) => WizardState) => { setState(s => s ? fn(s) : s); edits.current++; setIssues([]); }, []);
  const send = useCallback(async (published: boolean): Promise<string | null> => {
    const s = latest.current;
    if (!s || saving.current) return null;
    saving.current = true; setSave('saving');
    const at = edits.current;
    try {
      const reply = await homeworkCall<{ id: string; revision: number | null }>(`${API}/${s.id ?? 'new'}/save`, { offeringId: s.offeringId, lessonId: s.lessonId, revision: s.revision, definition: toDefinition(s, published) });
      if (!reply.ok) {
        setFailure(reply.failure);
        const refused = reply.failure.kind === 'refused' && (reply.failure.reason === 'started' || reply.failure.reason === 'versioned' || reply.failure.reason === 'other_space');
        setMoveRefused(refused && Boolean(s.id) && (placed.current?.offeringId !== s.offeringId || placed.current?.lessonId !== s.lessonId));
        setSave(reply.failure.kind === 'changed' || refused ? 'stale' : 'failed');
        return null;
      }
      saved.current = at; setFailure(null); placed.current = { offeringId: s.offeringId, lessonId: s.lessonId };
      setState(cur => cur && { ...cur, id: reply.body.id, revision: reply.body.revision, status: published ? 'published' : 'draft' });
      if (!s.id) { try { window.history.replaceState(window.history.state, '', `/teacher/homework/${reply.body.id}`); } catch { /* the address is a convenience */ } }
      setSave(edits.current === at ? 'saved' : 'waiting');
      return reply.body.id;
    } finally { saving.current = false; }
  }, []);
  // Autosave: a draft that the database will accept, a moment after the last keystroke. Never a published or started homework, never after a stale save.
  useEffect(() => {
    if (!state || state.locked || state.status !== 'draft' || save === 'stale' || save === 'saving' || finishing) return;
    if (edits.current === saved.current || !draftSavable(state)) { if (edits.current !== saved.current && save !== 'waiting') setSave('waiting'); return; }
    const timer = window.setTimeout(() => { void send(false); }, 1200);
    return () => window.clearTimeout(timer);
  }, [state, save, send, finishing]);

  async function publishLesson() {
    if (!lesson || lessonBusy) return;
    setLessonBusy(true); setLessonFailure(null);
    try {
      let response: Response | null = null;
      try { response = await fetch(`/api/teacher/courses/${courseId}/content`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish_lesson', id: lesson.id, updatedAt: lesson.updatedAt }) }); } catch { response = null; }
      const body = response ? await response.json().catch(() => null) as { structure?: CourseStructure | null } | null : null;
      if (response?.ok) { if (body?.structure) setStructure(body.structure); else void readStructure(); setLive(t('hw.w.lesson_published')); actionToast(t('hw.w.lesson_published')); return; }
      const f = contentFailure(response ? response.status : null, body);
      setLessonFailure(t(f.kind === 'archived' ? 'tc.content.archived' : f.kind === 'changed' ? 'tc.content.changed' : f.kind === 'denied' ? 'tc.content.denied' : f.kind === 'unknown' ? 'tc.error.unknown' : 'tc.content.failed'));
      if (f.kind === 'changed' || f.kind === 'archived') void readStructure();
    } finally { setLessonBusy(false); }
  }

  /** Review: publish (everything complete, a deadline set) or keep as a draft. A started homework becomes a new version first. */
  async function finish(published: boolean) {
    const s = latest.current;
    if (!s || finishing) return;
    const blocking = published ? allIssues(s, Date.now()) : stepIssues(s, 'details', Date.now());
    if (blocking.length || (!published && !draftSavable(s))) { setIssues(blocking.length ? blocking : allIssues(s, Date.now())); return; }
    setFinishing(true); setFailure(null);
    try {
      if (s.locked && s.id && s.revision !== null) {
        const clone = await homeworkCall<{ id: string }>(`${API}/${s.id}/lifecycle`, { action: 'clone', revision: s.revision });
        if (!clone.ok) { setFailure(clone.failure); return; }
        const fresh = await homeworkCall<TeacherHomeworkView>(`${API}/${clone.body.id}`);
        if (!fresh.ok) { setFailure(fresh.failure); return; }
        // The new version has its own question and answer ids (the old version keeps its own): every row gets the copy's id at its place, or a fresh one.
        const copied = fresh.body.definition, renumber = (a: WizardQuestion[]) => a.map((q, i) => { const c = copied.questions[i]; const o = q.options.map((x, j) => ({ id: c?.options[j]?.id ?? ids(), text: x.text })); return { ...q, id: c?.id ?? ids(), options: o, modelImageId: q.modelImageId ? c?.modelImageId ?? null : null, correctIds: q.correctIds.map(id => o[q.options.findIndex(x => x.id === id)]?.id).filter((v): v is string => Boolean(v)) }; });
        // Solution files are copied with the version; ones the teacher removed stay removed.
        latest.current = { ...s, id: clone.body.id, revision: fresh.body.revision, version: fresh.body.version, locked: false, questions: renumber(s.questions), solutionVideoId: s.solutionVideoId ? copied.solutionVideoId : null, solutionIds: s.solutionIds.length ? copied.solutionIds : [] };
        setState(latest.current);
      }
      const id = await send(published);
      if (!id) return;
      actionToast(t(published ? 'hw.w.published_live' : 'hw.w.saved_live', { title: s.title.trim() }));
      router.push('/teacher/homework');
    } finally { setFinishing(false); }
  }

  async function reload() { if (state?.id) { setSave('idle'); await readHomework(state.id); } }

  // ---- uploads (the existing homework upload flow)
  async function uploadTo(at: string, file: File, purpose: 'question' | 'solution', done: (row: { id: string; name: string; mime: string }) => void) {
    if (!state?.id || upload) return;
    setUploadFailure(null); setUpload({ at, percent: 0 });
    try { done(await uploadHomeworkFile(state.id, file, purpose, null, percent => setUpload({ at, percent }))); }
    catch { setUploadFailure({ at, text: t(purpose === 'question' || at.startsWith('model-') ? 'hw.w.picture_failed' : 'hw.w.file_failed') }); }
    finally { setUpload(null); }
  }
  useEffect(() => {
    if (!state?.id) return;
    for (const imageId of state.questions.flatMap(q => [q.imageId, q.modelImageId])) if (imageId && picture[imageId] === undefined) {
      homeworkApi<{ url: string }>(state.id, 'media', { id: imageId }).then(m => setPicture(p => ({ ...p, [imageId]: m.url }))).catch(() => setPicture(p => ({ ...p, [imageId]: '' })));
    }
  }, [state?.id, state?.questions, picture]);

  // ---- rendering
  if (legacy) return <Frame title={<L id="hw.w.edit" />} status={null}><div role="alert" className="d-alert"><p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><L id="hw.w.legacy" /></p></div></Frame>;
  if (readFailure) return <Frame title={<L id="hw.w.edit" />} status={null}><div role="alert" data-state="error" className="d-alert">
    <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{readFailure.kind === 'denied' ? t('hw.w.not_found') : failureWords(t, readFailure)}</span></p>
    {readFailure.kind === 'signin' ? <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link> : readFailure.kind !== 'denied' && <Button onClick={() => homeworkId && void readHomework(homeworkId)}><L id="th.state.retry" /></Button>}
  </div></Frame>;
  if (!state) return <Frame title={<L id={homeworkId ? 'hw.w.edit' : 'hw.w.new'} />} status={null}><div role="status" data-state="loading" className="d-card d-card--pad d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}<span className="sr-only"><L id="th.state.loading" /></span></div></Frame>;
  if (!homeworkId && !editable.length) return <Frame title={<L id="hw.w.new" />} status={null}><div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="hw.w.no_courses" /></p></div></Frame>;

  const index = WIZARD_STEPS.indexOf(step);
  const go = (next: WizardStep) => { setIssues([]); setStep(next); if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); };
  const next = () => { const found = stepIssues(state, step, Date.now()); if (found.length) { setIssues(found); return; } go(WIZARD_STEPS[index + 1]); };
  // Course and lesson stay where they are once a student started or for a later version; a new or untouched homework may still move.
  const fixed = placeLocked(state);
  const fixedWhy = state.locked ? 'hw.w.fixed' : 'hw.w.fixed_version';
  const saveText: Record<Save, MessageKey | null> = { idle: state.id ? 'hw.w.saved' : null, saving: 'hw.w.saving', saved: 'hw.w.saved', waiting: 'hw.w.unsaved', failed: 'hw.w.save_failed', stale: 'hw.w.save_failed' };
  const status = state.locked || state.status === 'published' ? null : saveText[save];
  const issueList = issues.length > 0 && <div role="alert" data-issues className="d-alert"><ul className="d-stack-xs">{issues.map((issue, i) => <li key={i} data-issue={issue.key} className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" />{t(`hw.w.issue.${issue.key}` as MessageKey, { n: (issue.question ?? 0) + 1 })}</li>)}</ul></div>;

  // A saved homework is offered only the courses of its own teaching space.
  const courseOptions = placeCourses(editable, courses, state).flatMap(c => c.offerings.map(o => ({ value: `${c.id}:${o.id}`, label: <bdi dir="auto">{c.offerings.length > 1 ? `${c.title} · ${o.name}` : c.title}</bdi> })));
  const currentCourse = courses.find(c => c.id === state.courseId);
  if (currentCourse && !courseOptions.some(o => o.value === `${currentCourse.id}:${state.offeringId}`)) courseOptions.push({ value: `${currentCourse.id}:${state.offeringId}`, label: <bdi dir="auto">{currentCourse.title}</bdi> });

  const details = <Card title="hw.w.step.details" hint="hw.w.details_hint">
    <Field label={<L id="hw.w.title" />} value={state.title} maxLength={200} dir="auto" autoComplete="off" onChange={e => change(s => ({ ...s, title: e.target.value }))} data-field="title" />
    <label className="d-field" data-field="course"><span className="d-field-label"><L id="hw.w.course" /></span>
      <Select value={state.courseId ? `${state.courseId}:${state.offeringId}` : ''} placeholder={t('hw.w.course_pick')} disabled={fixed} aria-describedby={fixed ? 'hw-fixed' : undefined} options={courseOptions}
        onChange={v => { const [c, o] = v.split(':'); change(s => chooseCourse(s, c, o)); }} />
    </label>
    <label className="d-field" data-field="lesson"><span className="d-field-label"><L id="hw.w.lesson" /></span>
      <Select value={state.lessonId} placeholder={t('hw.w.lesson_pick')} disabled={fixed || !structure} aria-describedby={fixed ? 'hw-fixed' : 'hw-lesson-hint'}
        options={lessons.map(l => ({ value: l.id, label: <>{t('tc.content.chapter_n', { n: l.chapter })} · <bdi dir="ltr">{l.label}</bdi> <bdi dir="auto">{l.title}</bdi>{l.status === 'draft' ? ` · ${t('tc.content.draft')}` : ''}</> }))}
        onChange={v => change(s => ({ ...s, lessonId: v }))} />
      <span id="hw-lesson-hint" className="d-field-hint"><L id="hw.w.lesson_hint" /></span>
    </label>
    {fixed && <p id="hw-fixed" className="d-meta" data-fixed={state.locked ? 'started' : 'versioned'}><L id={fixedWhy} /></p>}
    {structureFailed && <p role="alert" className="d-field-error"><L id="tc.content.failed" /></p>}
    {structure && !lessons.length && <p className="d-meta" data-no-lessons><L id="hw.w.no_lessons" /> <Link href={`/teacher/settings/courses/${state.courseId}`} className="d-inline-link"><L id="hw.w.course_page" /></Link></p>}
    {lesson?.status === 'draft' && <div data-lesson-draft className="d-notice d-stack-xs">
      <p className="d-content-line"><Icon name="info" /><span><L id="hw.w.lesson_draft" /></span></p>
      {structure?.canEdit && !structure.archived && <Button data-publish-lesson className="d-self-start" aria-disabled={lessonBusy || undefined} aria-busy={lessonBusy || undefined} onClick={() => void publishLesson()}>{lessonBusy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="hw.w.publish_lesson" /></Button>}
      {lessonFailure && <p role="alert" className="d-field-error">{lessonFailure}</p>}
    </div>}
    <TextArea label={<><L id="hw.w.instructions" /> <span className="d-meta"><L id="hw.w.optional" /></span></>} value={state.instructions} maxLength={20000} rows={3} onChange={v => change(s => ({ ...s, instructions: v }))} data="instructions" />
  </Card>;

  const questions = <QuestionsStep questions={state.questions} kinds={['choice', 'essay']} change={fn => change(s => ({ ...s, questions: fn(s.questions) }))}
    create={kind => newQuestion(kind === 'essay' ? 'essay' : 'choice', ids)} setKind={(x, kind) => setKind(x, kind === 'essay' ? 'essay' : 'choice', ids)}
    picture={picture} upload={upload} uploadFailure={uploadFailure} uploadBlocked={!state.id ? t('hw.w.picture_wait') : null}
    onUploadFailure={at => setUploadFailure({ at, text: t('hw.w.picture_failed') })}
    onUpload={(at, file, purpose, done) => void uploadTo(at, file, purpose === 'model' ? 'solution' : 'question', done)} />;

  const deadline = wizardDeadline(state);
  const essayCount = state.questions.filter(x => x.kind === 'essay').length;
  const rules = <Card title="hw.w.step.rules" hint="hw.w.rules_hint">
    {state.locked && <p className="d-content-line" data-use-change-deadline><Icon name="info" /><span><L id="hw.w.locked_deadline" /> <Link href="/teacher/homework" className="d-inline-link"><L id="hw.action.deadline" /></Link></span></p>}
    <fieldset className="d-stack-xs" data-deadline>
      <legend className="d-field-label"><L id="hw.w.deadline" /></legend>
      <div className="d-field-pair">
        <Field type="date" label={<L id="hw.w.deadline_date" />} value={state.deadlineDate} min={cairoToday(now)} onChange={e => change(s => ({ ...s, deadlineDate: e.target.value }))} data-field="deadline-date" />
        <Field type="time" label={<L id="hw.w.deadline_time" />} value={state.deadlineTime} onChange={e => change(s => ({ ...s, deadlineTime: e.target.value }))} data-field="deadline-time" />
      </div>
      {deadline && <p className="d-meta" data-deadline-shown>{t('hw.due', { day: cairoDay(deadline, lang), time: cairoTime(deadline, lang) })} · <L id="hw.w.cairo" /></p>}
    </fieldset>
    <fieldset className="d-stack-xs" data-photos>
      <legend className="d-field-label"><L id="hw.w.answer_heading" /></legend>
      <Switch checked={state.photos} onChange={on => change(s => ({ ...s, photos: on }))} data-photos-switch="" label={<span className="d-stack-xs"><span><L id="hw.w.photos" /></span><span className="d-meta"><L id="hw.w.photos_hint" /></span></span>} />
      {/* Turning photo answers off makes every essay a text answer: one line says so. */}
      {!state.photos && <p className="d-meta" data-photos-off>{t(essayCount ? 'hw.w.photos_off' : 'hw.w.photos_off_none')}</p>}
    </fieldset>
    <Switch checked={state.lateAllowed} onChange={on => change(s => ({ ...s, lateAllowed: on }))} data-late="" label={<span className="d-stack-xs"><span><L id="hw.w.late" /></span><span className="d-meta"><L id="hw.w.late_hint" /></span></span>} />
    <ChoiceGroup label={t('hw.w.tries')} value={state.tries} onChange={tries => change(s => ({ ...s, tries }))} options={[
      { value: 'one_time', label: t('hw.w.tries.one'), 'data-tries': 'one_time' },
      { value: 'fix_mistakes', label: t('hw.w.tries.fix'), description: t('hw.w.tries.fix_hint'), 'data-tries': 'fix_mistakes' },
      { value: 'from_zero', label: t('hw.w.tries.zero'), description: t('hw.w.tries.zero_hint'), 'data-tries': 'from_zero' },
    ]} />
    {state.tries !== 'one_time' && <div className="d-hw-qhead"><span className="d-label"><L id="hw.w.tries_number" /></span>
      <Stepper value={state.maxTries} min={MIN_TRIES} max={MAX_TRIES} label={t('hw.w.tries_number')} less={t('hw.w.fewer_tries')} more={t('hw.w.more_tries')} shown={String(state.maxTries)} lessReason={t('hw.w.tries_min')} moreReason={t('hw.w.tries_max')} onChange={n => change(s => ({ ...s, maxTries: clampTries(n) }))} data="tries" />
    </div>}
    <p className="d-meta"><L id="hw.w.tries_note" /></p>
  </Card>;

  const ruleKey: Record<ReturnType<typeof solutionsRule>, MessageKey> = { after_hand_in: 'hw.w.rule.after_hand_in', after_last_try: 'hw.w.rule.after_last_try', after_deadline: 'hw.w.rule.after_deadline' };
  const video = files.find(f => f.kind === 'video');
  const solutions = <Card title="hw.w.step.solutions" hint="hw.w.solutions_hint">
    <ChoiceGroup label={t('hw.w.solutions_open')} value={state.solutionsOpen} onChange={v => change(s => ({ ...s, solutionsOpen: v }))} options={[
      { value: 'after_hand_in', label: t('hw.w.sol.after_hand_in'), 'data-solutions': 'after_hand_in' }, { value: 'after_deadline', label: t('hw.w.sol.after_deadline'), 'data-solutions': 'after_deadline' }]} />
    <p className="d-content-line" data-solutions-rule><Icon name="info" /><span>{t(ruleKey[solutionsRule(state)], { n: state.maxTries })}</span></p>
    <TextArea label={<><L id="hw.w.solution_text" /> <span className="d-meta"><L id="hw.w.optional" /></span></>} value={state.solutionText} maxLength={20000} rows={3} onChange={v => change(s => ({ ...s, solutionText: v }))} data="solution-text" />
    <div className="d-stack-xs" data-solution-files>
      <span className="d-field-label"><L id="hw.w.files" /> <span className="d-meta"><L id="hw.w.optional" /></span></span>
      {files.map(f => <div key={f.id} className="d-hw-file" data-solution-file={f.kind}><Icon name={f.kind === 'video' ? 'video' : 'courses'} />
        <span className="d-row-body"><span className="d-label"><bdi dir="auto">{f.name}</bdi></span><span className="d-meta"><L id="hw.w.file_ready" /></span></span>
        <Button variant="tertiary" data-file-remove onClick={() => { setFiles(all => all.filter(x => x.id !== f.id)); change(s => ({ ...s, solutionVideoId: s.solutionVideoId === f.id ? null : s.solutionVideoId, solutionIds: s.solutionIds.filter(x => x !== f.id) })); }}><L id="hw.w.remove" /></Button>
      </div>)}
      <FilePick at="solution" accept={video ? 'application/pdf' : 'video/mp4,application/pdf'} label={upload?.at === 'solution' ? t('hw.w.uploading', { n: upload.percent }) : t('hw.w.add_file')}
        blocked={!state.id ? t('hw.w.picture_wait') : upload ? t('hw.w.uploading', { n: upload.percent }) : state.solutionIds.length >= 10 ? t('hw.w.files_max') : null}
        onFile={file => void uploadTo('solution', file, 'solution', row => {
          const kind = row.mime === 'video/mp4' ? 'video' : 'pdf';
          setFiles(all => [...all.filter(x => !(kind === 'video' && x.kind === 'video')), { id: row.id, name: row.name, kind }]);
          change(s => kind === 'video' ? { ...s, solutionVideoId: row.id } : { ...s, solutionIds: [...s.solutionIds, row.id] });
        })} />
      {video && <p className="d-meta"><L id="hw.w.one_video" /></p>}
      {uploadFailure?.at === 'solution' && <p role="alert" className="d-field-error">{uploadFailure.text}</p>}
    </div>
  </Card>;

  const choices = state.questions.filter(x => x.kind === 'choice').length, essays = state.questions.length - choices;
  const courseName = currentCourse?.title ?? '';
  const review = <div className="d-stack-sm">
    <dl className="d-card d-card--pad d-hw-review" data-review>
      <ReviewRow k="details" go={go}><span className="d-label"><bdi dir="auto">{state.title || '–'}</bdi></span><span className="d-meta"><bdi dir="auto">{courseName}</bdi>{lesson && <> · {t('tc.content.chapter_n', { n: lesson.chapter })} · <bdi dir="ltr">{lesson.label}</bdi> <bdi dir="auto">{lesson.title}</bdi></>}</span></ReviewRow>
      <ReviewRow k="questions" go={go}><span className="d-label">{countText(t, 'question', state.questions.length)} · {countText(t, 'mark', totalMarks(state))}</span>
        <span className="d-meta">{[choices ? t('hw.w.r.choice', { n: countText(t, 'choice', choices) }) : '', essays ? countText(t, 'essay', essays) : '', t(state.photos ? 'hw.w.r.photos_on' : 'hw.w.r.photos_off')].filter(Boolean).join(' · ')}</span></ReviewRow>
      <ReviewRow k="rules" go={go}><span className="d-label">{deadline ? t('hw.due', { day: cairoDay(deadline, lang), time: cairoTime(deadline, lang) }) : t('hw.no_deadline')}</span>
        <span className="d-meta">{t(state.lateAllowed ? 'hw.w.r.late_on' : 'hw.w.r.late_off')} · {triesText(t, state.tries, state.maxTries)}</span></ReviewRow>
      <ReviewRow k="solutions" go={go}><span className="d-label">{t(ruleKey[solutionsRule(state)], { n: state.maxTries })}</span>
        <span className="d-meta">{files.length ? files.map(f => f.name).join(' · ') : t('hw.w.r.no_files')}</span></ReviewRow>
    </dl>
    {state.locked ? <div className="d-notice d-stack-xs" data-locked><p className="d-label"><L id="hw.w.locked_title" /></p><p className="d-body"><L id="hw.w.locked_body" /></p></div>
      : <p className="d-content-line" data-publish-note><Icon name="info" /><span>{t('hw.w.publish_note', { course: courseName, lesson: lesson?.label ?? '' })}</span></p>}
  </div>;

  const body: Record<WizardStep, ReactNode> = { details, questions, rules, solutions, review };
  const published = state.status === 'published';
  return <Frame title={step === 'review' ? <L id="hw.w.review_title" /> : state.title.trim() && step !== 'details' ? <bdi dir="auto">{state.title}</bdi> : <L id={homeworkId ? 'hw.w.edit' : 'hw.w.new'} />} status={status} phone={phone} step={index} onStep={i => go(WIZARD_STEPS[i])}>
    {state.locked && step !== 'review' && <div className="d-notice" data-locked-note><p className="d-content-line"><Icon name="info" /><span><L id="hw.w.locked_body" /></span></p></div>}
    {(save === 'stale' || (save === 'failed' && failure)) && <div role="alert" data-save-failure={save} className="d-alert">
      <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{save === 'stale' ? t(moveRefused ? (failure && 'reason' in failure && failure.reason === 'versioned' ? 'hw.w.move_versioned' : failure && 'reason' in failure && failure.reason === 'other_space' ? 'hw.w.move_other_space' : 'hw.w.move_started') : 'hw.w.stale') : failureWords(t, failure!)}</span></p>
      {save === 'stale' ? <Button data-reload onClick={() => void reload()}><L id="tc.reload" /></Button> : <Button data-retry-save onClick={() => void send(false)}><L id="th.state.retry" /></Button>}
    </div>}
    {failure && save !== 'stale' && save !== 'failed' && <div role="alert" className="d-alert"><p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{failureWords(t, failure)}</span></p></div>}
    {body[step]}
    {issueList}
    <div className="d-hw-bar" data-wizard-bar>
      {index > 0 ? <Button data-step-back aria-label={phone ? t('hw.w.back') : undefined} onClick={() => go(WIZARD_STEPS[index - 1])}><Icon name="back" size={16} />{!phone && <L id="hw.w.back" />}</Button> : <span />}
      {!phone && step !== 'review' && <span className="d-meta">{t('hw.w.step_of', { n: index + 1 })}</span>}
      {step === 'review' ? <span className="d-hw-finish">
        {!published && <Button data-keep-draft aria-disabled={finishing || undefined} onClick={() => void finish(false)}><L id={state.locked ? 'hw.w.new_version_draft' : 'hw.w.keep_draft'} /></Button>}
        <Button variant="primary" data-publish aria-disabled={finishing || undefined} aria-busy={finishing || undefined} onClick={() => void finish(true)}>{finishing && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={state.locked ? 'hw.w.new_version_publish' : published ? 'hw.w.save_published' : 'hw.w.publish'} /></Button>
      </span> : <Button variant="primary" data-step-next onClick={next}>{t(index === 3 ? 'hw.w.to_review' : 'hw.w.next', { step: t(STEP_KEYS[WIZARD_STEPS[index + 1]]) })}<Icon name="chevron" size={16} /></Button>}
    </div>
    <p role="status" data-wizard-live className="sr-only">{live}</p>
  </Frame>;
}

/** The wizard's frame: back to Homework, the save state, the title and where the teacher is among the steps. */
function Frame({ title, status, phone = false, step, onStep, children }: { title: ReactNode; status: MessageKey | null; phone?: boolean; step?: number; onStep?: (i: number) => void; children: ReactNode }) {
  const { t } = useLanguage();
  return <div data-homework-wizard data-step={step === undefined ? undefined : WIZARD_STEPS[step]} className="d-stack-lg d-hw-wizard">
    <div className="d-hw-top">
      <Link href="/teacher/homework" className="d-back d-focus" data-wizard-back><Icon name="back" size={16} /><L id="hw.title" /></Link>
      {status && <span role="status" data-save-state={status} className="d-meta">{t(status)}</span>}
    </div>
    {step !== undefined && phone && <div className="d-stack-xs" data-steps-phone>
      <span className="d-meta d-hw-eyebrow">{step < 4 ? t('hw.w.step_eyebrow', { n: step + 1, step: t(STEP_KEYS[WIZARD_STEPS[step]]) }) : t(STEP_KEYS.review)}</span>
      <div aria-hidden="true" className="d-hw-progress">{[0, 1, 2, 3].map(i => <i key={i} data-done={i <= step ? '' : undefined} />)}</div>
    </div>}
    <h1 className="d-title">{title}</h1>
    {step !== undefined && !phone && <nav aria-label={t('hw.w.steps')} data-steps className="d-hw-steps">
      {WIZARD_STEPS.map((key, i) => <span key={key} aria-current={i === step ? 'step' : undefined} data-done={i < step ? '' : undefined} className="d-hw-step">
        <i aria-hidden="true">{i < step || key === 'review' ? <Icon name="check" size={14} /> : i + 1}</i>{t(STEP_KEYS[key])}{i < step && <span className="sr-only"> ({t('hw.w.done')})</span>}
        {i < 4 && onStep && <span aria-hidden="true" className="d-hw-step-line" />}
      </span>)}
    </nav>}
    {children}
  </div>;
}

function Card({ title, hint, children }: { title: MessageKey; hint: MessageKey; children: ReactNode }) {
  return <section aria-labelledby="hw-card" className="d-card d-card--pad d-stack-sm" data-wizard-card>
    <div className="d-stack-xs"><h2 id="hw-card" className="d-section"><L id={title} /></h2><p className="d-meta"><L id={hint} /></p></div>
    {children}
  </section>;
}

function ReviewRow({ k, go, children }: { k: 'details' | 'questions' | 'rules' | 'solutions'; go: (step: WizardStep) => void; children: ReactNode }) {
  const { t } = useLanguage();
  return <div className="d-hw-review-row" data-review-row={k}>
    <dt className="d-section-label">{t(STEP_KEYS[k])}</dt>
    <dd className="d-row-body">{children}</dd>
    <Button variant="tertiary" aria-label={t('hw.w.r.edit_step', { step: t(STEP_KEYS[k]) })} data-review-edit={k} onClick={() => go(k)}><L id="hw.w.r.edit" /></Button>
  </div>;
}
