import { L } from '@/frontend/components/language-provider';
import CourseCard from '@/frontend/components/course-card';
import { loadPreviewCourses } from '@/server/services/student-preview';
import { previewCourseHref } from '@/shared/student-preview';

export default async function PreviewCoursesPage() {
  const { courses, hidden } = await loadPreviewCourses();
  return <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
    <div className="space-y-1"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl"><L id="preview.title" /></h1><p className="text-sm text-slate-500"><L id="preview.pick_course" /></p></div>
    {!courses.length && <p role="status" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><L id="preview.no_courses" /></p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.map(c => <CourseCard key={c.id} id={c.id} href={previewCourseHref(c.id)} title={c.title} category={c.category} chaptersLength={c.modules} />)}</div>
    {hidden > 0 && <p role="status" className="text-sm text-slate-500"><L id="preview.drafts_hidden" values={{ count: hidden }} /></p>}
  </div>;
}
