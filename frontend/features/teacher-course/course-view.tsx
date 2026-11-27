'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Field } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import type { MessageKey } from '@/frontend/locales/messages';
import { SectionError, StatusBadge, useRetry } from '@/frontend/features/teacher-home/parts';
import { CourseContent } from '@/frontend/features/teacher-course/content-section';
import { CourseResults } from '@/frontend/features/teacher-reports/course-results';
import { SegmentedControl } from '@/frontend/components/design/controls';
import { COURSE_DESCRIPTION_MAX, COURSE_TITLE_MAX, courseFailure, courseTextChanges, courseTextProblem, nextStatus, type CourseFailureKind, type CourseLoad, type CoursePageData, type CourseTextProblem } from '@/shared/teacher-course-page';
import type { Classification } from '@/shared/contracts/academics';

type Grades = { state: 'loading' } | { state: 'ready'; selected: Classification['selected'] } | { state: 'error'; status: number | null };
const failureText: Record<CourseFailureKind, MessageKey> = {
  signin: 'tc.error.signin', denied: 'tc.error.denied', changed: 'tc.error.changed', invalid: 'tc.error.invalid', unknown: 'tc.error.unknown', failed: 'tc.error.failed',
};

export function CourseLoading() {
  return <div role="status" data-state="loading" className="d-page">
    <div aria-hidden="true" className="d-page-header-main"><DesignSkeleton className="h-5 w-24" /><DesignSkeleton className="h-9 w-72 max-w-full" /></div>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm"><DesignSkeleton className="h-5 w-32" /><DesignSkeleton className="h-11 w-full" /></div>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm"><DesignSkeleton className="h-5 w-32" /><DesignSkeleton className="h-11 w-48" /></div>
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}

const backLink = <Link href="/teacher/courses" data-course-back className="d-back d-focus"><Icon name="back" size={16} /><L id="tc.back" /></Link>;

/** One course: what it is, whether students can see it, Publish / Unpublish, and its chapters and lessons. */
export function TeacherCourseView({ load }: { load: CourseLoad }) {
  const retry = useRetry();
  if (load.state === 'error') return <div data-teacher-course className="d-page">{backLink}<SectionError status={load.status} onRetry={retry.retry} pending={retry.pending} /></div>;
  if (load.state === 'missing') return <div data-teacher-course data-state="missing" className="d-page">{backLink}
    <div className="d-card d-card--pad d-stack"><h1 className="d-section"><L id="tc.missing.title" /></h1><p className="d-body"><L id="tc.missing.body" /></p></div></div>;
  // The key is the version read: after a save or a reload the whole page starts again from what the server now holds.
  return <Course key={load.course.updatedAt} course={load.course} />;
}

function Course({ course }: { course: CoursePageData }) {
  const [grades, setGrades] = useState<Grades>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'content' | 'results'>('content');
  const { t } = useLanguage();
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ kind: 'classification', organizationId: course.organizationId, courseId: course.id });
    setGrades({ state: 'loading' });
    fetch(`/api/teacher/academics?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw Object.assign(new Error('grades'), { status: r.status }); return await r.json() as Classification; })
      .then(c => setGrades({ state: 'ready', selected: c.selected }))
      .catch((e: unknown) => { if ((e as Error).name !== 'AbortError') setGrades({ state: 'error', status: (e as { status?: number }).status ?? null }); });
    return () => controller.abort();
  }, [course.id, course.organizationId, attempt]);

  return <div data-teacher-course data-course={course.id} className="d-page">
    <PageHeader back={{ href: '/teacher/courses', label: <L id="tc.back" />, data: { 'data-course-back': '' } }} title={<span data-course-title><bdi dir="auto">{course.title}</bdi></span>} pill={<StatusBadge status={course.status} />}
      meta={course.showSpace ? <span data-course-space><bdi dir="auto">{course.spaceName}</bdi></span> : undefined} />
    <section aria-labelledby="tc-d" data-section="details" className="d-card d-card--pad d-stack">
      <h2 id="tc-d" className="d-section"><L id="tc.details" /></h2>
      <dl className="d-dl d-dl--grid">
        <Row label="tc.system" tour="course-system">{grades.state === 'ready' ? (grades.selected.length ? <ul className="d-list">{unique(grades.selected.map(s => s.programLabel)).map(p => <li key={p}><bdi dir="auto">{p}</bdi></li>)}</ul> : <L id="tc.none" />) : <GradeState grades={grades} retry={() => setAttempt(a => a + 1)} />}</Row>
        <Row label="tc.grade" tour="course-grade">{grades.state === 'ready' ? (grades.selected.length ? <ul className="d-list">{grades.selected.map(s => <li key={s.id}><bdi dir="auto">{s.label}</bdi></li>)}</ul> : <L id="tc.none" />) : grades.state === 'loading' ? <span className="d-meta">…</span> : null}</Row>
        {course.description && !editsText(course) && <Row label="tc.description" wide><p data-course-description className="d-pre d-wrap"><bdi dir="auto">{course.description}</bdi></p></Row>}
      </dl>
    </section>
    <CourseSettings course={course} />
    <Status course={course} />
    <SegmentedControl label={t('rp.course.switch')} value={view} onChange={setView} data-tour="course-results-switch" data-course-switch options={[{ value: 'content', label: t('rp.course.content'), 'data-view': 'content' }, { value: 'results', label: t('rp.course.results'), 'data-view': 'results' }]} />
    {view === 'content' ? <CourseContent courseId={course.id} /> : <CourseResults courseId={course.id} />}
  </div>;
}

const unique = (items: string[]) => Array.from(new Set(items));

function Row({ label, tour, wide, children }: { label: MessageKey; tour?: string; wide?: boolean; children: React.ReactNode }) {
  return <div data-tour={tour} className={wide ? 'd-dl-wide' : undefined}><dt><L id={label} /></dt><dd className="d-wrap">{children}</dd></div>;
}

/** A failed read of the grade is said plainly, with its own retry; it never reads as "no grade". */
function GradeState({ grades, retry }: { grades: Grades; retry: () => void }) {
  if (grades.state === 'loading') return <span role="status" className="d-meta"><L id="th.state.loading" /></span>;
  if (grades.state !== 'error') return null;
  return <span role="alert" data-state="error" className="d-alert"><span className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span><L id={grades.status === 403 ? 'tc.grade_denied' : 'tc.grade_error'} /></span></span>
    {grades.status !== 403 && <Button type="button" data-grade-retry onClick={retry}><L id="th.state.retry" /></Button>}</span>;
}

/** The name and description form is shown to whoever may change the text (owner, admin, the course team including editors) on a course that is not archived. */
const editsText = (course: CoursePageData) => course.canEdit && course.status !== 'archived';

/** What a teacher typed survives a "changed elsewhere" reload: the page restarts from the server's version, then puts the typing back. */
const typed = new Map<string, { title: string; description: string }>();
const problemText: Record<CourseTextProblem, MessageKey> = { empty_name: 'tc.settings.empty_name', name_long: 'tc.settings.too_long', about_long: 'tc.settings.too_long' };

async function patchCourse(course: CoursePageData, fields: object) {
  let response: Response;
  try {
    response = await fetch(`/api/teacher/courses/${course.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated_at: course.updatedAt, ...fields }) });
  } catch { throw Object.assign(new Error('lost'), { status: null }); }
  if (!response.ok) throw Object.assign(new Error('refused'), { status: response.status });
}
const failureOf = (e: unknown) => courseFailure((e as { status?: number | null }).status ?? null);

/** Course settings: the name and the description. Only what changed is sent, with the version this page read (public.course_update decides). */
function CourseSettings({ course }: { course: CoursePageData }) {
  const { t } = useLanguage();
  const router = useLoadingRouter();
  const kept = typed.get(course.id);
  const [title, setTitle] = useState(kept?.title ?? course.title);
  const [description, setDescription] = useState(kept?.description ?? course.description ?? '');
  const [problem, setProblem] = useState<CourseTextProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<CourseFailureKind | null>(null);
  useEffect(() => { typed.delete(course.id); }, [course.id]);
  if (!course.canEdit) return null;
  if (course.status === 'archived') return <section aria-labelledby="tc-set" data-section="settings" data-tour="course-settings" className="d-card d-card--pad d-stack">
    <h2 id="tc-set" className="d-section"><L id="tc.settings" /></h2>
    <p data-settings-archived className="d-body"><L id="tc.settings.archived" /></p>
  </section>;
  const changes = courseTextChanges(course, title, description);
  const dirty = Object.keys(changes).length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || reloading || !dirty) return;
    const found = courseTextProblem(title, description);
    setProblem(found); if (found) return;
    setBusy(true); setError(null);
    try {
      await patchCourse(course, changes);
      setReloading(true);
      actionToast(t('tc.settings.saved'));
      router.refresh(); // the page reads the new version; the key restarts this form from it
    } catch (failure) { setError(failureOf(failure)); setBusy(false); }
  }
  const reload = () => { typed.set(course.id, { title, description }); setReloading(true); router.refresh(); };

  return <section aria-labelledby="tc-set" data-section="settings" data-tour="course-settings" className="d-card d-card--pad d-stack">
    <h2 id="tc-set" className="d-section"><L id="tc.settings" /></h2>
    <form data-course-settings className="d-stack-form d-stretch" noValidate onSubmit={e => void save(e)}>
      <Field label={<L id="tc.settings.name" />} data-course-name dir="auto" value={title} maxLength={COURSE_TITLE_MAX + 20} autoComplete="off"
        error={problem === 'empty_name' || problem === 'name_long' ? <L id={problemText[problem]} values={{ max: COURSE_TITLE_MAX }} /> : undefined}
        onChange={e => { setTitle(e.target.value); setProblem(null); setError(null); }} />
      <div className="d-field">
        <label htmlFor="tc-about" className="d-field-label"><L id="tc.settings.about" /></label>
        <textarea id="tc-about" data-course-about dir="auto" rows={4} value={description} aria-invalid={problem === 'about_long' || undefined}
          aria-describedby={problem === 'about_long' ? 'tc-about-hint tc-about-error' : 'tc-about-hint'} className="d-field-input d-textarea"
          onChange={e => { setDescription(e.target.value); setProblem(null); setError(null); }} />
        <p id="tc-about-hint" className="d-field-hint"><L id="tc.settings.about_hint" /></p>
        {problem === 'about_long' && <p id="tc-about-error" role="alert" className="d-field-error"><L id="tc.settings.too_long" values={{ max: COURSE_DESCRIPTION_MAX }} /></p>}
      </div>
      <div className="d-actions">
        <Button type="submit" variant="primary" data-course-save aria-disabled={!dirty || undefined} disabled={busy || reloading}>{(busy || reloading) && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tc.settings.save" /></Button>
      </div>
      {error && <Failure error={error} reload={reload} reloading={reloading} />}
    </form>
  </section>;
}

function Failure({ error, reload, reloading, denied }: { error: CourseFailureKind; reload: () => void; reloading: boolean; denied?: MessageKey }) {
  return <div role="alert" data-state="error" data-failure={error} className="d-alert">
    <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span><L id={error === 'denied' && denied ? denied : failureText[error]} /></span></p>
    {(error === 'changed' || error === 'unknown') && <Button type="button" data-course-reload onClick={reload} disabled={reloading}>{reloading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tc.reload" /></Button>}
    {error === 'signin' && <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link>}
  </div>;
}

type Change = 'published' | 'draft' | 'archived' | 'restore';
const changeWords: Record<Change, { button: MessageKey; confirm: MessageKey; done: MessageKey }> = {
  published: { button: 'tc.publish', confirm: 'tc.confirm_publish', done: 'tc.status.published' },
  draft: { button: 'tc.unpublish', confirm: 'tc.confirm_unpublish', done: 'tc.status.draft' },
  archived: { button: 'tc.archive', confirm: 'tc.confirm_archive', done: 'tc.status.done_archived' },
  restore: { button: 'tc.restore', confirm: 'tc.confirm_restore', done: 'tc.status.done_restored' },
};

/**
 * Publish / Unpublish / Archive / Restore. Shown only to those the database lets change the status (the course owner or instructor, or
 * the space owner or admin; restoring an archived course: the space owner or admin). Each asks first; the database decides on save.
 */
function Status({ course }: { course: CoursePageData }) {
  const { t } = useLanguage();
  const router = useLoadingRouter();
  const [asking, setAsking] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CourseFailureKind | null>(null);
  const [reloading, setReloading] = useState(false);
  const sent = useRef(false);
  const toggle = nextStatus(course.status);
  const archived = course.status === 'archived';
  const offered: Change[] = archived ? (course.canRestore ? ['restore'] : []) : course.canChangeStatus && toggle ? [toggle, 'archived'] : [];

  async function change(what: Change) {
    if (busy || sent.current) return;
    sent.current = true; setBusy(true); setError(null);
    try {
      await patchCourse(course, { status: what === 'restore' ? 'draft' : what });
      setAsking(null);
      setReloading(true);
      actionToast(t(changeWords[what].done));
      router.refresh(); // the page reads the new version; the key restarts this component
    } catch (failure) {
      sent.current = false;
      setError(failureOf(failure)); setBusy(false);
    }
  }
  const reload = () => { setReloading(true); router.refresh(); };
  const ask = (what: Change) => { setError(null); setAsking(what); };

  return <section aria-labelledby="tc-s" data-section="status" data-tour="course-status" className="d-card d-card--pad d-stack">
    <h2 id="tc-s" className="d-section"><L id="tc.status" /></h2>
    <p data-status-note className="d-body"><L id={course.status === 'published' ? 'tc.status.published' : course.status === 'draft' ? 'tc.status.draft' : 'tc.status.archived'} /></p>
    {offered.length > 0 && !asking && <div className="d-actions">
      {offered.map(what => <Button key={what} type="button" variant={what === 'published' ? 'primary' : 'secondary'}
        {...(what === 'archived' ? { 'data-course-archive': '' } : what === 'restore' ? { 'data-course-restore': '' } : { 'data-course-publish': '', 'data-tour': 'course-publish' })}
        onClick={() => ask(what)}><L id={changeWords[what].button} /></Button>)}
    </div>}
    {!offered.length && <p data-cannot-edit className="d-meta"><L id={archived ? 'tc.cannot_restore' : 'tc.cannot_status'} /></p>}
    {asking && <div role="group" aria-label={t(changeWords[asking].button)} data-confirm={asking} className="d-confirm">
      <p className="d-label"><L id={changeWords[asking].confirm} values={{ title: course.title }} /></p>
      <div className="d-actions">
        <Button type="button" variant={asking === 'archived' ? 'destructive' : 'primary'} data-confirm-yes disabled={busy || reloading} onClick={() => void change(asking)}>{(busy || reloading) && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={changeWords[asking].button} /></Button>
        <Button type="button" data-confirm-no disabled={busy || reloading} onClick={() => { setAsking(null); setError(null); }}><L id="tc.cancel" /></Button>
      </div>
    </div>}
    {error && <Failure error={error} reload={reload} reloading={reloading} denied={archived ? 'tc.cannot_restore' : asking === 'archived' || asking === 'published' || asking === 'draft' ? 'tc.cannot_status' : undefined} />}
  </section>;
}
