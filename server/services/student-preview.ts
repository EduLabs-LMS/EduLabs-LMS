import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { isFirebaseStaging } from '@/shared/auth-config';
import { courseCapability, getWebsiteContext, loadWebsiteScope, offeringCapability } from '@/server/services/website';
import { isTeacherSideContext } from '@/server/services/teacher-side';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gate for every preview page. Read-only: it uses the viewer's own session and the same row-level
 * security as the rest of the teacher experience, and it never switches role, tenant or enrollment.
 * Students and platform roles get a 404, as if the area did not exist.
 */
export async function requireStudentPreview() {
  if (!isFirebaseStaging()) notFound();
  const context = await getWebsiteContext();
  if (!context) redirect('/sign-in');
  if (!isTeacherSideContext(context)) notFound();
  return context;
}

/** Published courses the teacher-side viewer works on, with how many unpublished ones are hidden. */
export async function loadPreviewCourses() {
  const context = await requireStudentPreview();
  const rows = (await context.repository.courses()).slice(0, 100);
  const offerings = await context.repository.offerings(rows.map(c => c.id));
  const mine = rows.filter(c => courseCapability(context, c) || offerings.some(o => o.course_id === c.id && offeringCapability(context, c, o.id)));
  const published = mine.filter(c => c.status === 'published');
  const modules = await context.repository.modules(published.map(c => c.id));
  return {
    context,
    courses: published.map(c => ({ id: c.id, title: c.title, category: context.organizations.find(o => o.id === c.organization_id)?.name, modules: modules.filter(m => m.course_id === c.id).length })),
    hidden: mine.length - published.length,
  };
}

/** One course for preview. Unpublished courses are reported as unpublished, never rendered as if live. */
export async function loadPreviewCourse(courseId: string) {
  const context = await requireStudentPreview();
  if (!uuid.test(courseId)) notFound();
  const scope = await loadWebsiteScope(context, undefined, courseId);
  const course = scope?.courses[0];
  if (!scope || !course) notFound();
  const staff = courseCapability(context, course) || scope.offerings.some(o => offeringCapability(context, course, o.id));
  if (!staff) notFound();
  const hidden = scope.lessons.filter(l => l.status !== 'published').length + (scope.segments ?? []).filter(s => s.status !== 'published').length;
  return { context, scope, course, published: course.status === 'published', hidden };
}
