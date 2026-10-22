import Link from 'next/link';
import { L } from '@/frontend/components/language-provider';
import { SecureLessonPage } from '../../../../../_components/secure-lesson-page';
import { loadPreviewCourse } from '@/server/services/student-preview';
import { PREVIEW_PATH } from '@/shared/student-preview';

export default async function PreviewLessonPage({ params }: { params: Promise<{ courseId: string; chapterId: string }> }) {
  const { courseId, chapterId } = await params;
  const { published } = await loadPreviewCourse(courseId);
  if (!published) return <div className="space-y-4"><Link className="text-sm font-semibold text-sky-700" href={PREVIEW_PATH}><L id="preview.back_to_courses" /></Link><p role="status" className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600"><L id="preview.course_unpublished" /></p></div>;
  return <SecureLessonPage courseId={courseId} segmentId={chapterId} preview />;
}
