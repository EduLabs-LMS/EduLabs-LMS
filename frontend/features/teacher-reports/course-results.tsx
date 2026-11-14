'use client';
import { useCallback, useState } from 'react';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GroupError } from '@/frontend/features/teacher-groups/parts';
import { useSwr } from '@/frontend/lib/use-swr';
import type { ChapterResult, CourseReport } from '@/shared/contracts/teacher-reports';
import { monthQuery, reportGet } from './api';
import { MonthPicker, ReportBar, usePct } from './parts';

const asCallError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);

/** The Results half of the Course page: one card per chapter, a bar per Group, the weakest chapter flagged. Its own error with Retry. */
export function CourseResults({ courseId }: { courseId: string }) {
  const [month, setMonth] = useState<string | null>(null);
  const read = useCallback((signal: AbortSignal) => reportGet<CourseReport>(`/api/teacher/reports/courses/${courseId}${monthQuery(month)}`, signal), [courseId, month]);
  const { data, retry } = useSwr<CourseReport, GroupCallError>(`report:course:${courseId}:${month ?? 'now'}`, read, asCallError);
  const [firstMonth, setFirst] = useState<string | null>(null);
  if (data.state === 'ready' && data.value.firstMonth !== firstMonth) setFirst(data.value.firstMonth);
  return <section data-course-results className="d-stack-lg">
    <MonthPicker value={month} firstMonth={firstMonth} onChange={setMonth} />
    <p className="d-meta"><L id="rp.course.intro" /></p>
    {data.state === 'loading' && <div role="status" data-state="loading" className="d-stack"><DesignSkeleton className="h-32" /><DesignSkeleton className="h-32" /><span className="sr-only"><L id="rp.loading" /></span></div>}
    {data.state === 'error' && <GroupError kind={data.error.kind} onRetry={retry} />}
    {data.state === 'ready' && (data.value.chapters.length === 0
      ? <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="rp.chapter.no_chapters" /></p></div>
      : <ul className="d-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{data.value.chapters.map(c => <li key={c.id}><Chapter chapter={c} groups={data.value.groups} /></li>)}</ul>)}
  </section>;
}

function Chapter({ chapter, groups }: { chapter: ChapterResult; groups: CourseReport['groups'] }) {
  const { t, number } = useLanguage();
  const pct = usePct();
  const empty = chapter.pct === null;
  const name = (id: string | null) => id ? groups.find(g => g.id === id)?.name ?? '' : t('rp.group.none');
  return <article className="d-card d-rp-chapter" data-chapter={chapter.id} data-weakest={chapter.weakest ? 'true' : undefined}>
    <div className="d-rp-chapter-head">
      <h3 className="d-label"><bdi dir="auto">{t('rp.chapter.title', { number: number(chapter.number), title: chapter.title })}</bdi></h3>
      {chapter.weakest && <StatusPill tone="warning" data-weakest><L id="rp.chapter.weakest" /></StatusPill>}
    </div>
    <p className="d-meta"><L id="rp.chapter.counts" values={{ exams: number(chapter.exams), homework: number(chapter.homework) }} /></p>
    {empty ? <p className="d-body" data-no-marks><L id="rp.chapter.none" /></p>
      : <ul className="d-rp-bars">{chapter.groups.map(g => <li key={g.groupId ?? 'none'}>
        <span className="d-meta"><bdi dir="auto">{name(g.groupId)}</bdi></span><ReportBar pct={g.pct} /><span className="d-rp-value">{pct(g.pct)}</span></li>)}</ul>}
  </article>;
}
