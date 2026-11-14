'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button } from '@/frontend/components/design/button';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { L } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GroupError } from '@/frontend/features/teacher-groups/parts';
import type { AttentionReport, AttentionRow } from '@/shared/contracts/teacher-reports';
import { reportGet } from './api';
import { studentHref } from './group-report';
import { Reasons } from './parts';

export type Attention =
  | { state: 'loading'; rows: AttentionRow[] }
  | { state: 'error'; rows: AttentionRow[]; error: GroupCallError }
  | { state: 'ready'; rows: AttentionRow[]; total: number; more: boolean; loadingMore: boolean };

/** Who needs attention this month across all Groups (and No Group), worst first, 25 a page. `course` null is every course. One read per page; the first page also gives the chip its number. */
export function useAttention(course: string | null, wanted: number): { attention: Attention; retry: () => void; loadMore: () => void } {
  const [rows, setRows] = useState<AttentionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [pages, setPages] = useState(1);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<GroupCallError>(new GroupCallError(null));
  const [revision, setRevision] = useState(0);
  const [lastCourse, setLastCourse] = useState(course);
  if (lastCourse !== course) { setLastCourse(course); setRows([]); setPages(1); setPhase('loading'); }
  const upTo = Math.max(pages, wanted);

  useEffect(() => {
    const controller = new AbortController();
    const have = Math.ceil(rows.length / pageSize);
    const next = phase === 'ready' && have >= 1 ? have : 0;
    if (phase === 'ready' && (have >= upTo || rows.length >= total)) return;
    const q = new URLSearchParams(); if (course) q.set('course', course); q.set('page', String(next));
    reportGet<AttentionReport>(`/api/teacher/reports/attention?${q}`, controller.signal).then(r => {
      if (controller.signal.aborted) return;
      setPageSize(r.pageSize); setTotal(r.total);
      setRows(prev => next === 0 ? r.rows : [...prev, ...r.rows]);
      setPhase('ready');
    }, e => {
      if (controller.signal.aborted || (e as Error).name === 'AbortError') return;
      setError(e instanceof GroupCallError ? e : new GroupCallError(null)); setPhase('error');
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, upTo, revision, phase === 'ready' ? rows.length : -1]);

  const retry = () => { setPhase('loading'); setRows([]); setRevision(v => v + 1); };
  const loadMore = () => setPages(Math.ceil(rows.length / pageSize) + 1);
  const attention: Attention = phase === 'loading' ? { state: 'loading', rows }
    : phase === 'error' ? { state: 'error', rows, error }
      : { state: 'ready', rows, total, more: rows.length < total, loadingMore: upTo > Math.ceil(rows.length / pageSize) };
  return { attention, retry, loadMore };
}

/** The Students list while "Needs attention" is chosen: each row's Group, its reasons, worst first. */
export function AttentionList({ attention, retry, loadMore }: { attention: Attention; retry: () => void; loadMore: () => void }) {
  return <section className="d-rp-section" data-attention-students>
    <p className="d-meta"><L id="rp.students.note" /></p>
    {attention.state === 'loading' && <div role="status" data-state="loading" className="d-stack"><DesignSkeleton className="h-16" /><DesignSkeleton className="h-16" /><span className="sr-only"><L id="rp.loading" /></span></div>}
    {attention.state === 'error' && <GroupError kind={attention.error.kind} onRetry={retry} />}
    {attention.state === 'ready' && (attention.rows.length === 0
      ? <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="rp.students.empty" /></p></div>
      : <ul className="d-rp-rows d-card d-card--pad" data-attention-rows>{attention.rows.map(r => <li key={`${r.offeringId}:${r.userId}`}>
        <Link href={studentHref(r.userId, r.offeringId)} data-attention-student={r.userId} className="d-rp-row d-focus">
          <Avatar id={r.userId} name={r.name} />
          <span className="d-rp-row-body">
            <span className="d-label"><bdi dir="auto">{r.name}</bdi></span>
            <span className="d-meta"><bdi dir="auto">{r.group ? r.group.name : ''}</bdi>{!r.group && <L id="rp.students.no_group" />} · <bdi dir="auto">{r.courseTitle}</bdi></span>
            <Reasons reasons={r.reasons} />
          </span>
        </Link></li>)}</ul>)}
    {attention.state === 'ready' && attention.more && <Button type="button" data-more-attention onClick={loadMore} disabled={attention.loadingMore}>{attention.loadingMore && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="rp.students.more" /></Button>}
  </section>;
}
