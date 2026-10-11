'use client';
import Link from 'next/link';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';
import type { StudentLesson } from '@/shared/contracts/dashboard';
import { Tree } from './tree';
import { useLocale } from './preferences';

export function LearningHome({ lessons, summaryAvailable = true }: { lessons: StudentLesson[]; summaryAvailable?: boolean }) {
  const { user } = useApplicationAuth(); const { locale,t } = useLocale();
  const completed = lessons.filter(l => l.chapters.length && l.chapters.every(c => c.isCompleted)).length;
  return <div className="space-y-6"><section className="edu-card edu-on-green edu-student-hero"><div><span className="edu-pill">{locale === 'ar' ? 'مساحتك التعليمية' : 'Your learning space'}</span><h1 className="mt-5">{t('Your learning, all in one place.')}</h1><p className="mt-4">{locale === 'ar' ? 'أهلًا بك، ' : 'Welcome, '}{user?.firstName || user?.fullName || user?.email}.</p></div><Tree variant="ink" /></section>
    <div className="edu-metrics"><div className="edu-card"><strong>{summaryAvailable ? lessons.length : '—'}</strong>{locale === 'ar' ? 'الدورات المتاحة' : 'Available course runs'}</div><div className="edu-card"><strong>{summaryAvailable ? completed : '—'}</strong>{locale === 'ar' ? 'الدورات المكتملة' : 'Completed course runs'}</div><div className="edu-card"><strong>{summaryAvailable ? lessons.reduce((sum,l) => sum+l.chapters.length,0) : '—'}</strong>{locale === 'ar' ? 'الدروس المنشورة' : 'Published lessons'}</div></div>
    <section className="edu-card"><h2 className="text-2xl">{locale === 'ar' ? 'واصل التعلم' : 'Keep growing'}</h2><div className="edu-learning-list">{lessons.map(l => <Link key={l.id} href={l.href || `/courses/${l.id}`} className="edu-learning-item"><div><h3 className="text-xl">{l.title}</h3><p className="edu-muted">{l.chapters.filter(c=>c.isCompleted).length} / {l.chapters.length} {locale === 'ar' ? 'دروس مكتملة' : 'lessons completed'}</p></div><span className="edu-btn">{locale === 'ar' ? 'عرض المقرر' : 'View course'} <span aria-hidden="true">↗</span></span></Link>)}</div>{!lessons.length && <div className="py-8"><p className="edu-muted">{locale === 'ar' ? 'لا توجد دروس متاحة بعد. سيحدد معلمك مجموعتك الدراسية.' : 'No lessons yet. Your teacher will arrange access to your learning group.'}</p><Link href="/self-learning" className="edu-link mt-4 inline-block">{t('Self Learning')}</Link></div>}</section>
  </div>;
}
export function TeachingOverview({ name, metrics }: { name?: string|null; metrics: { totalStudents:number; pendingWaitlistCount:number; pendingHomeworkCount:number|null; activeGroupsCount:number } }) {
  const { locale,t }=useLocale();
  return <section className="space-y-6"><div className="flex flex-wrap justify-between gap-4"><div><span className="edu-pill">{t('Teaching Overview')}</span><h1 className="text-3xl mt-4">{locale==='ar'?'أهلًا بعودتك، ':'Welcome back, '}{name || (locale==='ar'?'معلمنا':'teacher')}.</h1><p className="edu-muted mt-3">{locale==='ar'?'مقرراتك ومجموعاتك، في مساحة واحدة.':'Your courses and groups, with room to grow.'}</p></div><Link className="edu-btn edu-btn-green self-start" href="/teacher/courses">{t('Teacher Courses')}</Link></div><div className="edu-metrics">{[[metrics.totalStudents,'Active Enrollments'],[metrics.pendingWaitlistCount,'Pending Invitations'],[metrics.activeGroupsCount,'Active Groups']].map(([value,label])=><div className="edu-card" key={label}><strong>{value}</strong>{t(String(label))}</div>)}</div></section>;
}
