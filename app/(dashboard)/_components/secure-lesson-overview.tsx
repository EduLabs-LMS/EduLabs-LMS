import { notFound, redirect } from 'next/navigation';
import { learningService } from '@/server/services/lessons';
import { getApplicationViewer } from '@/server/services/application-auth';
import { LessonOverview, LessonUnavailable } from '@/frontend/features/courses/lesson/lesson-overview';
import { lessonId } from '@/shared/contracts/lessons';
import { lessonOverview, lessonPage } from '@/shared/student-lesson';

/**
 * A student's lesson page addressed by the lesson id (DECISIONS.md, "A lesson is never tethered to one of its components"). A lesson with
 * published parts opens its part page, exactly as before; a lesson without one shows its title and its homework. The same checks as a part
 * page: a draft lesson or course, an inactive group or an ended enrollment is "unavailable", never an empty page.
 */
export async function SecureLessonOverview({ courseId, id, offeringId }: { courseId: string; id: string; offeringId?: string }) {
  if (!await getApplicationViewer()) redirect('/sign-in');
  if (!lessonId.safeParse(courseId).success || !lessonId.safeParse(id).success || !lessonId.safeParse(offeringId).success) notFound();
  let view: ReturnType<typeof lessonOverview>;
  try {
    const service = await learningService(courseId);
    await service.offering(offeringId!);
    // The outline only (ids, titles, positions, status): this page shows no content, so it reads none (fix track 2a).
    const [outline, progress] = await Promise.all([service.outline(), service.progress(offeringId!)]);
    view = lessonOverview(outline, progress, courseId, id, offeringId!);
  } catch (e) { const status = (e as { status?: number }).status; return <LessonUnavailable failed={status === 503} tooLarge={status === 413} />; }
  if (view.kind === 'part') redirect(view.href);
  if (view.kind === 'unavailable') return <LessonUnavailable />;
  return <LessonOverview courseId={courseId} lessonId={id} offeringId={offeringId!} title={view.title} module={view.module} back={lessonPage(courseId, offeringId!)} />;
}
