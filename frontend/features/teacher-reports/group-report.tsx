'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Avatar } from '@/frontend/components/design/avatar';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GroupError } from '@/frontend/features/teacher-groups/parts';
import { useSwr } from '@/frontend/lib/use-swr';
import type { GroupReport, StudentLine } from '@/shared/contracts/teacher-reports';
import { reportGet, monthQuery } from './api';
import { MonthPicker, Reasons, Stat, usePct } from './parts';

const asCallError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);
export const studentHref = (userId: string, offeringId: string) => `/teacher/students/${userId}?course=${offeringId}`;

/** The Report tab of a Group: three numbers, who needs attention (worst first), everyone else. One read per month, with its own error and Retry. */
export function GroupReportPanel({ groupId, offeringId }: { groupId: string; offeringId: string }) {
  const [month, setMonth] = useState<string | null>(null);
  const read = useCallback((signal: AbortSignal) => reportGet<GroupReport>(`/api/teacher/reports/groups/${groupId}${monthQuery(month)}`, signal), [groupId, month]);
  const { data, retry } = useSwr<GroupReport, GroupCallError>(`group:${groupId}:report:${month ?? 'now'}`, read, asCallError);
  const [firstMonth, setFirst] = useState<string | null>(null);
  if (data.state === 'ready' && data.value.firstMonth !== firstMonth) setFirst(data.value.firstMonth);
  return <div data-group-report className="d-stack-lg">
    <MonthPicker value={month} firstMonth={firstMonth} onChange={setMonth} />
    {data.state === 'loading' && <div role="status" data-state="loading" className="d-stack"><DesignSkeleton className="h-24" /><DesignSkeleton className="h-40" /><span className="sr-only"><L id="rp.loading" /></span></div>}
    {data.state === 'error' && <GroupError kind={data.error.kind} onRetry={retry} />}
    {data.state === 'ready' && <ReportBody report={data.value} offeringId={offeringId} />}
  </div>;
}

function ReportBody({ report, offeringId }: { report: GroupReport; offeringId: string }) {
  const { t, number } = useLanguage();
  const pct = usePct();
  const s = report.summary;
  const sessions = s.attendance.sessions === 1 ? t('rp.stat.sessions_one') : t('rp.stat.sessions', { count: number(s.attendance.sessions) });
  const exams = s.exams.count === 1 ? t('rp.stat.exams_one') : t('rp.stat.exams_count', { count: number(s.exams.count) });
  const empty = report.attentionTotal + report.everyoneTotal === 0;
  return <>
    <div className="d-rp-stats" data-report-numbers>
      <Stat label={t('rp.stat.attendance')} value={pct(s.attendance.pct)} sub={sessions} data-stat="attendance" />
      <Stat label={t('rp.stat.homework')} value={pct(s.homework.pct)} sub={t('rp.stat.given', { count: number(s.homework.given) })} data-stat="homework" />
      <Stat label={t('rp.stat.exams')} value={pct(s.exams.pct)} sub={exams} data-stat="exams" />
    </div>
    <p className="d-meta" data-pace>{report.pace.reached ? <L id="rp.pace" values={{ label: report.pace.reached.label, count: number(report.pace.homeworkGiven) }} /> : <L id="rp.pace_none" />}</p>
    {empty && <p data-state="empty" className="d-body"><L id="rp.group.nobody" /></p>}
    {!empty && <>
      <section className="d-rp-section" data-attention-list>
        <h3 className="d-rp-h"><L id="rp.attention.title" values={{ count: number(report.attentionTotal) }} /></h3>
        {report.attentionTotal === 0 ? <p className="d-body"><L id="rp.attention.empty" /></p> : <Rows lines={report.attention} offeringId={offeringId} attention />}
      </section>
      {report.everyoneTotal > 0 && <section className="d-rp-section" data-everyone-list>
        <h3 className="d-rp-h"><L id="rp.everyone.title" values={{ count: number(report.everyoneTotal) }} /></h3>
        <Rows lines={report.everyone} offeringId={offeringId} />
      </section>}
      {(report.attention.length < report.attentionTotal || report.everyone.length < report.everyoneTotal) && <p className="d-meta"><L id="rp.shown_first" values={{ count: number(report.attention.length + report.everyone.length) }} /></p>}
    </>}
  </>;
}

function Rows({ lines, offeringId, attention = false }: { lines: StudentLine[]; offeringId: string; attention?: boolean }) {
  const { number } = useLanguage();
  const pct = usePct();
  return <ul className="d-rp-rows d-card d-card--pad">{lines.map(l => <li key={l.userId}>
    <Link href={studentHref(l.userId, offeringId)} data-report-student={l.userId} className="d-rp-row d-focus">
      <Avatar id={l.userId} name={l.name} />
      <span className="d-rp-row-body">
        <span className="d-label"><bdi dir="auto">{l.name}</bdi></span>
        {attention ? <Reasons reasons={l.reasons} />
          : <span className="d-meta"><L id="rp.everyone.row" values={{ attendance: pct(l.attendance.pct), done: number(l.homework.done), given: number(l.homework.given), exams: pct(l.exams.pct) }} /></span>}
      </span>
    </Link>
  </li>)}</ul>;
}
