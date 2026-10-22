import Link from 'next/link';
import { L } from '@/frontend/components/language-provider';
import { SelfLearningView } from '@/frontend/features/self-learning/self-learning-view';
import { loadPreviewCourse } from '@/server/services/student-preview';
import { v2Chapters } from '@/shared/v2-learning-model';
import { PREVIEW_PATH } from '@/shared/student-preview';

export default async function PreviewCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { scope, course, published, hidden } = await loadPreviewCourse((await params).courseId);
  const back = <Link className="text-sm font-semibold text-sky-700" href={PREVIEW_PATH}><L id="preview.back_to_courses" /></Link>;
  if (!published) return <div className="space-y-4">{back}<p role="status" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><L id="preview.course_unpublished" /></p></div>;
  // Same real student view; only the data source differs. Draft lessons and parts are dropped by v2Chapters exactly as for a student.
  return <div className="space-y-4">{back}<h1 className="text-2xl font-bold tracking-tight">{course.title}</h1>
    <SelfLearningView chapters={scope.limited ? [] : v2Chapters(scope, undefined, PREVIEW_PATH)} />
    {hidden > 0 && <p role="status" className="text-sm text-slate-500"><L id="preview.drafts_hidden" values={{ count: hidden }} /></p>}
  </div>;
}
