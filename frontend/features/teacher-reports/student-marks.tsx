'use client';
import { useCallback, useState } from 'react';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GroupError } from '@/frontend/features/teacher-groups/parts';
import { useSwr } from '@/frontend/lib/use-swr';
import type { ExamLine, HomeworkLine, StudentReport } from '@/shared/contracts/teacher-reports';
import { monthQuery, reportGet } from './api';
import { MonthPicker, Stat, usePct } from './parts';

const asCallError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);
const dayOnly: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' };

/** The marks section of the Student page: three numbers, the month's sessions as P/A boxes, a Homework list and an Exams list. Its own error with Retry. */
export function StudentMarks({ studentId, offeringId }: { studentId: string; offeringId: string }) {
  const [month, setMonth] = useState<string | null>(null);
  const read = useCallback((signal: AbortSignal) => reportGet<StudentReport>(`/api/teacher/reports/students/${studentId}?course=${offeringId}${month ? `&month=${month}` : ''}`, signal), [studentId, offeringId, month]);
  const { data, retry } = useSwr<StudentReport, GroupCallError>(`report:student:${studentId}:${offeringId}:${month ?? 'now'}`, read, asCallError);
  const [firstMonth, setFirst] = useState<string | null>(null);
  if (data.state === 'ready' && data.value.firstMonth !== firstMonth) setFirst(data.value.firstMonth);
  return <section data-student-marks data-tour="student-marks" className="d-stack-lg">
    <MonthPicker value={month} firstMonth={firstMonth} onChange={setMonth} />
    {data.state === 'loading' && <div role="status" data-state="loading" className="d-stack"><DesignSkeleton className="h-24" /><DesignSkeleton className="h-32" /><span className="sr-only"><L id="rp.loading" /></span></div>}
    {data.state === 'error' && <GroupError kind={data.error.kind} onRetry={retry} />}
    {data.state === 'ready' && <Body report={data.value} />}
  </section>;
}

function Body({ report }: { report: StudentReport }) {
  const { t, number } = useLanguage();
  const pct = usePct();
  const exams = report.exams.count === 1 ? t('rp.student.exams_sub_one') : t('rp.student.exams_sub', { count: number(report.exams.count) });
  return <>
    <div className="d-rp-stats">
      <Stat label={t('rp.student.sessions')} value={pct(report.attendance.pct)} sub={t('rp.student.att_sub', { present: number(report.attendance.present), total: number(report.attendance.total) })} data-stat="attendance" />
      <Stat label={t('rp.student.homework')} value={`${number(report.homework.done)}/${number(report.homework.given)}`} sub={report.homework.avgPct === null ? t('rp.dash') : t('rp.student.hw_avg', { pct: number(Math.round(report.homework.avgPct)) })} data-stat="homework" />
      <Stat label={t('rp.student.exams')} value={pct(report.exams.pct)} sub={exams} data-stat="exams" />
    </div>
    <section className="d-rp-section" data-student-sessions>
      <h3 className="d-rp-h"><L id="rp.student.sessions" /></h3>
      {report.sessions.length === 0 ? <p className="d-body"><L id="rp.student.nothing" /></p>
        : <ul className="d-rp-marks">{report.sessions.map(s => <li key={s.id} className="d-rp-mark" data-state={s.state}
          aria-label={t(s.state === 'present' ? 'rp.session.present_long' : 'rp.session.absent_long', { day: number(s.day) })}>
          <b aria-hidden="true">{t(s.state === 'present' ? 'rp.session.present' : 'rp.session.absent')}</b><span aria-hidden="true">{number(s.day)}</span></li>)}</ul>}
    </section>
    <section className="d-rp-section" data-student-homework>
      <h3 className="d-rp-h"><L id="rp.student.homework" /></h3>
      {report.homeworkList.length === 0 ? <p className="d-body"><L id="rp.student.nothing" /></p>
        : <ul className="d-rp-rows d-card d-card--pad">{report.homeworkList.map(h => <HomeworkRow key={h.id} line={h} />)}</ul>}
    </section>
    <section className="d-rp-section" data-student-exams>
      <h3 className="d-rp-h"><L id="rp.student.exams" /></h3>
      {report.examList.length === 0 ? <p className="d-body"><L id="rp.student.nothing" /></p>
        : <ul className="d-rp-rows d-card d-card--pad">{report.examList.map(e => <ExamRow key={e.id} line={e} />)}</ul>}
    </section>
  </>;
}

function Mark({ score, max }: { score: number | null; max: number | null }) {
  const { number } = useLanguage();
  return <span className="d-rp-value" dir="ltr">{score === null ? '' : number(score)}{max === null ? '' : `/${number(max)}`}</span>;
}

function HomeworkRow({ line }: { line: HomeworkLine }) {
  const { language } = useLanguage();
  const due = new Date(line.dueAt).toLocaleDateString(language, dayOnly);
  return <li><div className="d-rp-row" data-homework-state={line.state}>
    <span className="d-rp-row-body"><span className="d-label"><bdi dir="auto">{line.title}</bdi></span><span className="d-meta"><L id="rp.hw.due" values={{ date: due }} /></span></span>
    {line.state === 'missing' ? <StatusPill tone="danger"><L id="rp.hw.missing" /></StatusPill>
      : line.score !== null ? <Mark score={line.score} max={line.max} />
        : <StatusPill tone="neutral"><L id={line.detail === 'waiting' || line.state === 'done' ? 'rp.hw.waiting' : 'rp.hw.handed'} /></StatusPill>}
  </div></li>;
}

function ExamRow({ line }: { line: ExamLine }) {
  return <li><div className="d-rp-row" data-exam-state={line.state}>
    <span className="d-rp-row-body"><span className="d-label"><bdi dir="auto">{line.title}</bdi></span><span className="d-meta"><L id={line.kind === 'online' ? 'rp.exam.online' : 'rp.exam.paper'} /> · <LocalDate value={line.at} options={dayOnly} /></span></span>
    {line.state === 'absent' ? <StatusPill tone="danger"><L id="rp.exam.absent" /></StatusPill>
      : line.state === 'waiting' ? <StatusPill tone="neutral"><L id="rp.exam.waiting" /></StatusPill>
        : <Mark score={line.score} max={line.max} />}
  </div></li>;
}
