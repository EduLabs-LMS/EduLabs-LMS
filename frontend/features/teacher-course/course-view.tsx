'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { usePageLoadingSignal } from '@/frontend/components/providers/use-page-loading-signal';
import { useLoadingRouter } from '@/frontend/components/providers/use-loading-router';
import type { MessageKey } from '@/frontend/locales/messages';
import { SectionError, StatusBadge, card, inkButton, linkClass, plainButton, primaryButton, useRetry } from '@/frontend/features/teacher-home/parts';
import { courseFailure, nextStatus, type CourseFailureKind, type CourseLoad, type CoursePageData } from '@/shared/teacher-course-page';
import type { Classification } from '@/shared/contracts/academics';

const tall = '!min-h-[48px]';
type Grades = { state: 'loading' } | { state: 'ready'; selected: Classification['selected'] } | { state: 'error'; status: number | null };
const failureText: Record<CourseFailureKind, MessageKey> = {
  signin: 'tc.error.signin', denied: 'tc.error.denied', changed: 'tc.error.changed', invalid: 'tc.error.invalid', unknown: 'tc.error.unknown', failed: 'tc.error.failed',
};

export function CourseLoading() {
  return <div role="status" data-state="loading" className="w-full space-y-5">
    <div className="h-20 animate-pulse rounded-[24px] border-[2.5px] border-black bg-slate-200" />
    <div className="h-40 animate-pulse rounded-[24px] border-[2.5px] border-black bg-slate-200" />
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}

/** One course: what it is, whether students can see it, and Publish / Unpublish. Chapters and lessons are not here yet (see TEACHER_UI_SPEC.md). */
export function TeacherCourseView({ load }: { load: CourseLoad }) {
  const retry = useRetry();
  const back = <Link href="/teacher/settings/courses" data-course-back className={linkClass}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><L id="tc.back" /></Link>;
  if (load.state === 'error') return <div data-teacher-course className="space-y-4">{back}<div className={card}><SectionError status={load.status} onRetry={retry.retry} pending={retry.pending} /></div></div>;
  if (load.state === 'missing') return <div data-teacher-course data-state="missing" className="space-y-4">{back}
    <div className={`${card} space-y-2`}><h1 className="font-display text-2xl"><L id="tc.missing.title" /></h1><p className="text-base text-slate-800"><L id="tc.missing.body" /></p></div></div>;
  // The key is the version read: after a save or a reload the whole page starts again from what the server now holds.
  return <Course key={load.course.updatedAt} course={load.course} back={back} />;
}

function Course({ course, back }: { course: CoursePageData; back: React.ReactNode }) {
  const [grades, setGrades] = useState<Grades>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  usePageLoadingSignal(grades.state === 'loading');
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

  return <div data-teacher-course data-course={course.id} className="w-full space-y-5">
    {back}
    <header className="space-y-2">
      <h1 data-course-title className="break-words font-display text-3xl leading-tight lg:text-4xl"><bdi dir="auto">{course.title}</bdi></h1>
      {course.showSpace && <p data-course-space className="text-base text-slate-700"><bdi dir="auto">{course.spaceName}</bdi></p>}
    </header>
    <section aria-labelledby="tc-d" data-section="details" className={`${card} space-y-4`}>
      <h2 id="tc-d" className="font-display text-2xl"><L id="tc.details" /></h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Row label="tc.system" tour="course-system">{grades.state === 'ready' ? (grades.selected.length ? <ul>{unique(grades.selected.map(s => s.programLabel)).map(p => <li key={p}><bdi dir="auto">{p}</bdi></li>)}</ul> : <L id="tc.none" />) : <GradeState grades={grades} retry={() => setAttempt(a => a + 1)} />}</Row>
        <Row label="tc.grade" tour="course-grade">{grades.state === 'ready' ? (grades.selected.length ? <ul>{grades.selected.map(s => <li key={s.id}><bdi dir="auto">{s.label}</bdi></li>)}</ul> : <L id="tc.none" />) : grades.state === 'loading' ? <span className="text-slate-600">…</span> : null}</Row>
        {course.description && <Row label="tc.description" wide><p data-course-description className="whitespace-pre-line break-words"><bdi dir="auto">{course.description}</bdi></p></Row>}
      </dl>
    </section>
    <Status course={course} />
    <section aria-labelledby="tc-l" data-section="lessons" data-tour="course-lessons" className={`${card} space-y-2`}>
      <h2 id="tc-l" className="font-display text-2xl"><L id="tc.lessons" /></h2>
      <p data-lessons-soon className="text-base text-slate-800"><L id="tc.lessons_soon" /></p>
    </section>
  </div>;
}

const unique = (items: string[]) => Array.from(new Set(items));

function Row({ label, tour, wide, children }: { label: MessageKey; tour?: string; wide?: boolean; children: React.ReactNode }) {
  return <div data-tour={tour} className={wide ? 'sm:col-span-2' : undefined}><dt className="text-base font-bold"><L id={label} /></dt><dd className="mt-1 break-words text-base text-slate-900">{children}</dd></div>;
}

/** A failed read of the grade is said plainly, with its own retry; it never reads as "no grade". */
function GradeState({ grades, retry }: { grades: Grades; retry: () => void }) {
  if (grades.state === 'loading') return <span role="status" className="text-slate-600"><L id="th.state.loading" /></span>;
  if (grades.state !== 'error') return null;
  return <span role="alert" data-state="error" className="block space-y-2"><span className="flex gap-2"><AlertCircle aria-hidden className="mt-1 h-5 w-5 shrink-0" /><span><L id={grades.status === 403 ? 'tc.grade_denied' : 'tc.grade_error'} /></span></span>
    {grades.status !== 403 && <button type="button" data-grade-retry onClick={retry} className={`${plainButton} ${tall}`}><L id="th.state.retry" /></button>}</span>;
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
      router.refresh(); // the page reads the new version; the key restarts this component
    } catch (failure) {
      sent.current = false;
      setError(courseFailure((failure as { status?: number }).status ?? null)); setBusy(false);
    }
  }
  const reload = () => { setReloading(true); router.refresh(); };

  return <section aria-labelledby="tc-s" data-section="status" data-tour="course-status" className={`${card} space-y-4`}>
    <h2 id="tc-s" className="font-display text-2xl"><L id="tc.status" /></h2>
    <div className="flex flex-wrap items-center gap-3"><StatusBadge status={course.status} />
      <p data-status-note className="text-base text-slate-800"><L id={course.status === 'published' ? 'tc.status.published' : course.status === 'draft' ? 'tc.status.draft' : 'tc.status.archived'} /></p></div>
    {target && course.canEdit && !asking && <button type="button" data-course-publish data-tour="course-publish" onClick={() => { setError(null); setAsking(true); }} className={`${target === 'published' ? primaryButton : plainButton} ${tall} w-full sm:w-auto`}><L id={target === 'published' ? 'tc.publish' : 'tc.unpublish'} /></button>}
    {target && !course.canEdit && <p data-cannot-edit className="text-base text-slate-700"><L id="tc.cannot_edit" /></p>}
    {target && asking && <div role="group" aria-label={t(target === 'published' ? 'tc.publish' : 'tc.unpublish')} data-confirm className="space-y-3 rounded-2xl border-2 border-black bg-slate-50 p-4">
      <p className="text-base font-bold"><L id={target === 'published' ? 'tc.confirm_publish' : 'tc.confirm_unpublish'} values={{ title: course.title }} /></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-confirm-yes disabled={busy || reloading} onClick={() => void change()} className={`${inkButton} ${tall}`}>{(busy || reloading) && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={target === 'published' ? 'tc.publish' : 'tc.unpublish'} /></button>
        <button type="button" data-confirm-no disabled={busy || reloading} onClick={() => { setAsking(false); setError(null); }} className={`${plainButton} ${tall}`}><L id="tc.cancel" /></button>
      </div>
    </div>}
    {error && <div role="alert" data-state="error" data-failure={error} className="space-y-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-slate-900">
      <p className="flex gap-2 text-base"><AlertCircle aria-hidden className="mt-1 h-5 w-5 shrink-0" /><span><L id={failureText[error]} /></span></p>
      {(error === 'changed' || error === 'unknown') && <button type="button" data-course-reload onClick={reload} disabled={reloading} className={`${plainButton} ${tall}`}>{reloading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tc.reload" /></button>}
      {error === 'signin' && <Link href="/sign-in" className={plainButton}><L id="th.state.signin" /></Link>}
    </div>}
  </section>;
}
