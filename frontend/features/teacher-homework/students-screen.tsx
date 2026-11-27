'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import { byGroup, cairoDay, cairoTime, pageCount, type HomeworkStudentRow, type HomeworkStudents } from '@/shared/teacher-homework';

const API = '/api/teacher/homework';
const TONE = { handed_in: 'success', late: 'warning', not_handed_in: 'neutral' } as const;

/**
 * One homework's students, read only (owner, 2026-11-27): by Group, each student handed in, late or not handed in, the mark (a self-marked
 * try at its hand-in, an essay once released) and the tries used. Everything comes from homework_students, which the database authorizes.
 */
export function HomeworkStudentsScreen({ homeworkId }: { homeworkId: string }) {
  const { t, language, number } = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const [page, setPage] = useState(0);
  const [data, setData] = useState<HomeworkStudents | null>(null);
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const last = useRef(0);

  const read = useCallback(async () => {
    const mine = ++last.current;
    setReading(true);
    try {
      const response = await fetch(`${API}/${homeworkId}/students?${new URLSearchParams({ page: String(page) })}`, { cache: 'no-store' });
      if (mine !== last.current) return;
      if (!response.ok) { setFailure({ status: response.status }); return; }
      setData(await response.json() as HomeworkStudents); setFailure(null);
    } catch { if (mine === last.current) setFailure({ status: null }); }
    finally { if (mine === last.current) setReading(false); }
  }, [homeworkId, page]);
  useEffect(() => { void read(); }, [read]);

  const hw = data?.homework, counts = data?.counts;
  const pages = data ? pageCount(counts!.total, data.pageSize) : 1;
  const score = (n: number) => t('hw.s.mark', { score: number(n), max: number(hw?.totalMarks ?? 0) });

  return <div data-homework-students className="d-stack-lg">
    <div className="d-hw-top">
      <Link href="/teacher/homework" className={`${buttonClass('tertiary')} d-back`} data-students-back><Icon name="back" size={16} /><L id="hw.title" /></Link>
    </div>
    <header className="d-stack-xs" data-students-header>
      {hw ? <h1 className="d-title"><bdi dir="auto">{hw.title}</bdi></h1> : <DesignSkeleton className="h-7 w-48" />}
      {hw?.deadline && data && <p className="d-meta">{t(Date.parse(hw.deadline) <= Date.parse(data.serverNow) ? 'hw.closed_on' : 'hw.due_short', { day: cairoDay(hw.deadline, lang) })}</p>}
      {counts && <p className="d-meta" data-students-summary>
        {t('hw.s.summary', { handed: number(counts.handedIn), total: number(counts.total), late: number(counts.late) })}
        {hw?.usesMarks && <> · {counts.averageScore === null ? t('hw.average_none') : t('hw.average', { score: number(counts.averageScore), max: number(hw.totalMarks) })}</>}
      </p>}
      <p className="d-meta"><L id="hw.s.read_only" /></p>
    </header>
    {failure && <SectionError status={failure.status} onRetry={() => void read()} pending={reading} />}
    {!data && !failure && <div role="status" data-state="loading" className="d-card d-card--pad d-stack-sm">{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}<span className="sr-only"><L id="th.state.loading" /></span></div>}
    {data && data.rows.length === 0 && <p data-state="empty" className="d-card d-card--pad d-body"><L id="hw.s.empty" /></p>}
    {data && byGroup(data.rows).map(g => <section key={g.groupId ?? 'none'} data-students-group={g.groupId ?? ''} aria-busy={reading || undefined} className="d-card d-card--pad d-stack-sm">
      <h2 className="d-section">{g.groupName ? <bdi dir="auto">{g.groupName}</bdi> : <L id="hw.s.no_group" />}</h2>
      <ul className="d-list">{g.rows.map(r => studentRow(r))}</ul>
    </section>)}
    {data && pages > 1 && <div data-pager className="d-pager">
      {page > 0 && <Button data-page-prev onClick={() => setPage(page - 1)}><L id="hw.prev" /></Button>}
      <span className="d-meta">{t('hw.page', { n: number(page + 1), total: number(pages) })}</span>
      {page + 1 < pages && <Button data-page-next onClick={() => setPage(page + 1)}><L id="hw.next" /></Button>}
    </div>}
  </div>;

  function studentRow(r: HomeworkStudentRow) {
    return <li key={r.userId} data-student-row={r.userId} data-state={r.state} className="d-row">
      <span className="d-row-body d-stack-xs">
        <span className="d-label"><bdi dir="auto">{r.name ?? '–'}</bdi></span>
        {r.state !== 'not_handed_in' && <span className="d-meta">
          {r.submittedAt && <>{cairoDay(r.submittedAt, lang)} {cairoTime(r.submittedAt, lang)} · </>}{t('hw.s.tries', { n: number(r.tries) })}
        </span>}
      </span>
      <span className="d-row-trailing">
        {hw?.usesMarks && r.score !== null && <span className="d-label" data-student-mark>{score(r.score)}</span>}
        {r.waiting && r.score === null && <span className="d-meta" data-student-waiting><L id="hw.s.waiting" /></span>}
        <StatusPill tone={TONE[r.state]} data-student-state={r.state}><L id={`hw.s.state.${r.state}`} /></StatusPill>
      </span>
    </li>;
  }
}
