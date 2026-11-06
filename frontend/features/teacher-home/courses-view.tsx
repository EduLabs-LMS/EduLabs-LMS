'use client';
import { useState } from 'react';
import { L } from '@/frontend/components/language-provider';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { COURSE_LIMIT, type CreateTarget, type TeacherHomeData } from '@/shared/teacher-home';
import { CreateCourseDialog, CreateUnavailable } from './create-course';
import { CourseCards, Empty, SectionError, useRetry } from './parts';

/** Full-page course list: ready, empty, error with retry. Loading is the route's loading.tsx. */
export function TeacherCoursesView({ courses, targets }: { courses: TeacherHomeData['courses']; targets: CreateTarget[] }) {
  const retry = useRetry();
  const [creating, setCreating] = useState(false);
  return <div data-teacher-courses className="d-page">
    <PageHeader title={<L id="th.courses.page_title" />} meta={<L id="ts.courses.intro" />} primary={targets.length ? { key: 'create', label: <L id="th.courses.create" />, onClick: () => setCreating(true), data: { 'data-create-course': '' } } : undefined} />
    {!targets.length && <CreateUnavailable />}
    {targets.length > 0 && <CreateCourseDialog targets={targets} open={creating} onOpenChange={setCreating} />}
    {courses.state === 'error' ? <SectionError status={courses.status} onRetry={retry.retry} pending={retry.pending} />
      : courses.state === 'unavailable' ? null
      : !courses.data.items.length ? <div className="d-card d-card--pad"><Empty id="th.courses.empty" /></div>
      : <CourseCards items={courses.data.items} />}
    {courses.state === 'ready' && courses.data.truncated && <p className="d-meta"><L id="th.courses.truncated" values={{ count: COURSE_LIMIT }} /></p>}
    <p className="d-meta"><L id="ts.courses.note" /></p>
  </div>;
}

export function TeacherCoursesLoading() {
  return <div role="status" data-state="loading" className="d-page">
    <div aria-hidden="true" className="d-page-header-main"><DesignSkeleton className="h-9 w-48" /><DesignSkeleton className="h-5 w-72 max-w-full" /></div>
    <div aria-hidden="true" className="d-group-list">{[0, 1, 2].map(i => <div key={i} className="d-course-card"><DesignSkeleton className="h-5 w-40" /><DesignSkeleton className="h-6 w-20" /></div>)}</div>
    <span className="sr-only"><L id="th.state.loading" /></span>
  </div>;
}
