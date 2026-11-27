'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { L } from '@/frontend/components/language-provider';
import { HomeworkAssignments } from './homework-assignments';

/** A lesson with no part, as a student sees it: its title, where it sits, and its homework. Plain student styles. */
export function LessonOverview({ courseId, lessonId, offeringId, title, module, back }: { courseId: string; lessonId: string; offeringId: string; title: string; module: string; back: string }) {
  // Opening it counts (owner, 2026-11-27): a lesson with nothing in it is complete once opened. Best effort; the database decides.
  useEffect(() => {
    void fetch('/api/learning/opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offeringId, lessonId }) }).catch(() => undefined);
  }, [offeringId, lessonId]);
  return <div className="mx-auto max-w-7xl space-y-4" data-lesson-page={lessonId}>
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-2">
      {module && <p className="text-sm text-slate-600"><bdi dir="auto">{module}</bdi></p>}
      <h1 className="font-display text-2xl font-bold"><bdi dir="auto">{title}</bdi></h1>
      <p className="text-sm text-slate-600"><L id="lesson_page.no_parts" /></p>
      <Link className="inline-flex min-h-[44px] items-center text-sky-700 font-semibold" href={back}><L id="lesson_page.back" /></Link>
    </div>
    <HomeworkAssignments key={`hw:${lessonId}`} courseId={courseId} lessonId={lessonId} segmentId={null} offeringId={offeringId} />
  </div>;
}

export function LessonUnavailable({ failed = false, tooLarge = false }: { failed?: boolean; tooLarge?: boolean }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3" data-lesson-unavailable>
    <p role="alert"><L id={tooLarge ? 'lesson_page.too_large' : failed ? 'lesson_page.failed' : 'lesson_page.unavailable'} /></p>
    <Link className="inline-flex min-h-[44px] items-center text-sky-700 font-semibold" href="/self-learning"><L id="lesson_page.return" /></Link>
  </div>;
}
