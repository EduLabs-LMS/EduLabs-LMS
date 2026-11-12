import { notFound } from 'next/navigation';
import { SecureLessonOverview } from '@/app/(dashboard)/_components/secure-lesson-overview';
import { isFirebaseStaging } from '@/shared/auth-config';

/** A lesson by its id (?offering=<group>). Firebase staging only; the exact path is allow-listed in middleware.ts. */
export default async function LessonPage({ params, searchParams }: { params: Promise<{ courseId: string; lessonId: string }>; searchParams: Promise<{ offering?: string | string[] }> }) {
  if (!isFirebaseStaging()) notFound();
  const { courseId, lessonId } = await params;
  const offering = (await searchParams).offering;
  return <SecureLessonOverview courseId={courseId} id={lessonId} offeringId={typeof offering === 'string' ? offering : undefined} />;
}
