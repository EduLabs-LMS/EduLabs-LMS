'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { durationWords } from '@/frontend/features/teacher-exams/exam-words';
import { dayText, scoreText, whenText } from '@/frontend/features/student-exams/student-exam-format';
import { clockOffset, sectionOf, SECTIONS, type ListSection, type StudentList, type StudentRow } from '@/shared/exams-student';
import type { MessageKey } from '@/frontend/locales/messages';
import { cn } from '@/shared/utils';

export type StudentListLoad = { state: 'ready'; data: StudentList } | { state: 'error' };
const card = 'rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm';
const TITLES: Record<ListSection, MessageKey> = { open: 'se.list.open', upcoming: 'se.list.upcoming', waiting: 'se.list.waiting', results: 'se.list.results', closed: 'se.list.closed' };

/**
 * The student's exams, from exam_student_list: open now, coming up (with this student's own window), handed in, results, closed. Which part
 * an exam is in follows the database's clock, read once and carried forward. Starting is on the exam's own page.
 */
export function StudentExamsList({ load }: { load: StudentListLoad }) {
  const { language, t, number } = useLanguage();
  const [course, setCourse] = useState<string>('all');
  const [now, setNow] = useState(() => Date.now());
  const received = useMemo(() => Date.now(), []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  if (load.state === 'error') return <section className={cn(card, 'space-y-3')} data-student-exams-error role="alert"><p><L id="se.list.error" /></p><Link href="/exams" className="underline"><L id="se.list.retry" /></Link></section>;
  const offset = clockOffset(load.data.serverNow, received), server = now + offset;
  const courses = Array.from(new Map(load.data.rows.map(r => [r.courseId, r.courseTitle])));
  const rows = load.data.rows.filter(r => course === 'all' || r.courseId === course);
  const groups = SECTIONS.map(section => ({ section, rows: rows.filter(r => sectionOf(r, server) === section) })).filter(g => g.rows.length > 0);
  return <div className="mx-auto w-full max-w-3xl space-y-5" data-student-exams>
    <header className={cn(card, 'flex items-center gap-3')}>
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border-2 border-black bg-primary"><FileText className="h-6 w-6" aria-hidden /></span>
      <div><h1 className="font-display text-2xl leading-tight"><L id="se.list.title" /></h1><p className="text-sm text-slate-600"><L id="se.list.intro" /></p></div>
    </header>
    {courses.length > 1 && <div role="group" aria-label={t('se.list.course')} className="flex flex-wrap gap-2" data-course-filter>
      {[['all', t('se.list.all_courses')] as const, ...courses.map(([id, title]) => [id, title] as const)].map(([id, label]) => <button key={id} type="button" aria-pressed={course === id} data-course={id}
        onClick={() => setCourse(id)} className={cn('min-h-[44px] rounded-full border-2 border-black px-4 text-sm font-semibold', course === id ? 'bg-primary' : 'bg-white')}>{label}</button>)}
    </div>}
    {groups.length === 0 && <p className={card} data-student-exams-empty><L id="se.list.empty" /></p>}
    {groups.map(g => <section key={g.section} aria-labelledby={`se-${g.section}`} data-section={g.section} className="space-y-3">
      <h2 id={`se-${g.section}`} className="font-display text-lg"><L id={TITLES[g.section]} /> <span className="text-sm text-slate-600" dir="ltr">{number(g.rows.length)}</span></h2>
      <ul className="space-y-3">{g.rows.map(r => <li key={r.id}><Row row={r} section={g.section} language={language} t={t} number={number} /></li>)}</ul>
    </section>)}
  </div>;
}

function Row({ row, section, language, t, number }: { row: StudentRow; section: ListSection; language: string; t: (k: MessageKey, v?: Record<string, string | number>) => string; number: (n: number) => string }) {
  const w = row.window;
  const line = section === 'open' ? (row.tryState === 'in_progress' ? t('se.list.working') : t('se.list.until', { when: whenText(w?.closesAt ?? null, language) }))
    : section === 'upcoming' ? t('se.list.opens', { when: whenText(w?.opensAt ?? null, language) })
    : section === 'results' ? (row.result?.absent ? t('se.list.absent') : scoreText(row.result?.score ?? null, row.result?.maxScore ?? null, number))
    : section === 'waiting' ? (row.kind === 'paper' ? (row.heldOn ? t('se.list.paper_held', { when: dayText(row.heldOn, language) }) : t('se.list.paper')) : t('se.list.handed_in'))
    : (w?.closesAt ? t('se.list.closed_on', { when: whenText(w.closesAt, language) }) : t('se.list.closed_note'));
  const action = section === 'open' ? (row.tryState === 'in_progress' ? 'se.list.continue' : 'se.list.start') : 'se.list.view';
  return <Link href={`/exams/${row.id}`} data-exam-row={row.id} data-section-of={section} className={cn(card, 'flex min-h-[44px] items-center justify-between gap-3 transition-transform hover:-translate-y-0.5')}>
    <span className="min-w-0 space-y-1">
      <span className="block truncate font-semibold" dir="auto">{row.title}</span>
      <span className="block truncate text-sm text-slate-600" dir="auto">{row.courseTitle}</span>
      <span className="block text-sm" data-row-line>{line}{row.kind === 'online' && row.timeLimitMinutes ? <> · {durationWords(t, row.timeLimitMinutes, number)}</> : null}</span>
    </span>
    <span className={cn('flex-none rounded-full border-2 border-black px-4 py-2 text-sm font-semibold', section === 'open' ? 'bg-primary' : 'bg-white')}><L id={action as MessageKey} /></span>
  </Link>;
}
