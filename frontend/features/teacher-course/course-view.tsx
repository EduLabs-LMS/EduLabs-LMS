'use client';
import { actionToast } from '@/frontend/lib/action-toast';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button, buttonClass } from '@/frontend/components/design/button';
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
import { courseFailure, nextStatus, type CourseFailureKind, type CourseLoad, type CoursePageData } from '@/shared/teacher-course-page';
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
        {course.description && <Row label="tc.description" wide><p data-course-description className="d-pre d-wrap"><bdi dir="auto">{course.description}</bdi></p></Row>}
      </dl>
    </section>
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

/** Publish / Unpublish. The database decides (row-level security and the version check); this only asks first and says what happened. */
function Status({ course }: { course: CoursePageData }) {
  const { t } = useLanguage();
  const router = useLoadingRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CourseFailureKind | null>(null);
  const [reloading, setReloading] = useState(false);
  const sent = useRef(false);
  const target = nextStatus(course.status);

  async function change() {
    if (busy || sent.current || !target) return;
    sent.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/teacher/courses/${course.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated_at: course.updatedAt, status: target }) });
      if (!response.ok) throw Object.assign(new Error('status'), { status: response.status });
      setAsking(false);
      setReloading(true);
      actionToast(t(target === 'published' ? 'tc.status.published' : 'tc.status.draft'));
      router.refresh(); // the page reads the new version; the key restarts this component
    } catch (failure) {
      sent.current = false;
      setError(courseFailure((failure as { status?: number }).status ?? null)); setBusy(false);
    }
  }
  const reload = () => { setReloading(true); router.refresh(); };

  return <section aria-labelledby="tc-s" data-section="status" data-tour="course-status" className="d-card d-card--pad d-stack">
    <h2 id="tc-s" className="d-section"><L id="tc.status" /></h2>
    <p data-status-note className="d-body"><L id={course.status === 'published' ? 'tc.status.published' : course.status === 'draft' ? 'tc.status.draft' : 'tc.status.archived'} /></p>
    {target && course.canEdit && !asking && <Button type="button" variant={target === 'published' ? 'primary' : 'secondary'} data-course-publish data-tour="course-publish" onClick={() => { setError(null); setAsking(true); }}><L id={target === 'published' ? 'tc.publish' : 'tc.unpublish'} /></Button>}
    {target && !course.canEdit && <p data-cannot-edit className="d-meta"><L id="tc.cannot_edit" /></p>}
    {target && asking && <div role="group" aria-label={t(target === 'published' ? 'tc.publish' : 'tc.unpublish')} data-confirm className="d-confirm">
      <p className="d-label"><L id={target === 'published' ? 'tc.confirm_publish' : 'tc.confirm_unpublish'} values={{ title: course.title }} /></p>
      <div className="d-actions">
        <Button type="button" variant="primary" data-confirm-yes disabled={busy || reloading} onClick={() => void change()}>{(busy || reloading) && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={target === 'published' ? 'tc.publish' : 'tc.unpublish'} /></Button>
        <Button type="button" data-confirm-no disabled={busy || reloading} onClick={() => { setAsking(false); setError(null); }}><L id="tc.cancel" /></Button>
      </div>
    </div>}
    {error && <div role="alert" data-state="error" data-failure={error} className="d-alert">
      <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span><L id={failureText[error]} /></span></p>
      {(error === 'changed' || error === 'unknown') && <Button type="button" data-course-reload onClick={reload} disabled={reloading}>{reloading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tc.reload" /></Button>}
      {error === 'signin' && <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link>}
    </div>}
  </section>;
}
