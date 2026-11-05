import 'server-only';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { WebsiteContext } from '@/server/services/website';
import { canEditTeacherCourse } from '@/shared/teacher-course';
import type { CourseLoad } from '@/shared/teacher-course-page';
import type { CourseStatus } from '@/shared/teacher-home';

const statuses: readonly string[] = ['draft', 'published', 'archived'];

/** One course for the course page, read as the signed-in teacher: row-level security decides whether it is visible at all. */
export async function loadCoursePage(context: WebsiteContext, courseId: string): Promise<CourseLoad> {
  try {
    const client = await getSupabaseServerClient();
    const { data, error } = await client.from('courses').select('id,organization_id,title,description,status,updated_at').eq('id', courseId).maybeSingle();
    if (error) return { state: 'error', status: null };
    if (!data || !statuses.includes(data.status)) return { state: 'missing' };
    const membership = context.memberships.find(m => m.organization_id === data.organization_id) ?? null;
    const staff = context.courseStaff.find(s => s.course_id === data.id) ?? null;
    const space = context.organizations.find(o => o.id === data.organization_id);
    return {
      state: 'ready',
      course: {
        id: data.id, organizationId: data.organization_id, spaceName: space?.name ?? '',
        showSpace: context.organizations.filter(o => o.status === 'active' && context.memberships.some(m => m.organization_id === o.id && m.status === 'active')).length > 1,
        title: data.title, description: data.description, status: data.status as CourseStatus, updatedAt: data.updated_at,
        canEdit: canEditTeacherCourse(membership, staff),
      },
    };
  } catch { return { state: 'error', status: null }; }
}
