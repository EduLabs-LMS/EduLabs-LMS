'use client';
import { L } from '@/frontend/components/language-provider';
import { COURSE_LIMIT, type CreateTarget, type TeacherHomeData } from '@/shared/teacher-home';
import { CreateCourse } from './create-course';
import { CourseCards, Empty, SectionError, card, useRetry } from './parts';

/** Full-page course list: ready, empty, error with retry. Loading is the route's loading.tsx. */
export function TeacherCoursesView({ courses, targets }: { courses: TeacherHomeData['courses']; targets: CreateTarget[] }) {
  const retry = useRetry();
  return <div data-teacher-courses className="mx-auto w-full max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border-[2.5px] border-black bg-primary p-4 shadow-hard sm:p-5">
      <div className="min-w-0"><h1 className="font-display text-3xl leading-tight"><L id="th.courses.page_title" /></h1><p className="text-base text-black"><L id="th.courses.page_intro" /></p></div>
      <CreateCourse targets={targets} />
    </header>
    <section className={`${card} space-y-4`}>
      {courses.state === 'error' ? <SectionError status={courses.status} onRetry={retry.retry} pending={retry.pending} />
        : courses.state === 'unavailable' ? null
        : !courses.data.items.length ? <Empty id="th.courses.empty" />
        : <CourseCards items={courses.data.items} />}
      {courses.state === 'ready' && courses.data.truncated && <p className="text-base text-slate-700"><L id="th.courses.truncated" values={{ count: COURSE_LIMIT }} /></p>}
    </section>
  </div>;
}

export function TeacherCoursesLoading() {
  return <div role="status" data-state="loading" className="mx-auto w-full max-w-6xl space-y-5">
    <div className="h-24 animate-pulse rounded-[24px] border-[2.5px] border-black bg-slate-200" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl border-2 border-black bg-slate-200" />)}</div>
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}
