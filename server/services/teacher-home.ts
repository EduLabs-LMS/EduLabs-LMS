import 'server-only';
import { courseCapability, type WebsiteContext } from '@/server/services/website';
import { groupService } from '@/server/services/groups';
import { communicationService } from '@/server/services/communications';
import { spaceIsDemo } from '@/server/services/demo-space';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { GroupPage, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import type { NotificationPage } from '@/shared/contracts/communications';
import { DEMO_CHECK_LIMIT, buildTeacherHome, createTargets, mapCourses, showDemoLabel, teachingSpaceIds, type RawCourse, type Settled, type TeacherHomeLoad } from '@/shared/teacher-home';

/** Reads run independently; one failing read marks only its own section as failed. Uses the existing services, which stay authoritative. */
export async function settle<T>(read: () => PromiseLike<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await read() }; }
  catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return { ok: false, status: typeof status === 'number' ? status : null };
  }
}

export async function teacherCourses(context: WebsiteContext): Promise<Settled<RawCourse[]>> {
  return settle(async () => (await context.repository.courses()).filter(c => courseCapability(context, c)));
}


export async function loadTeacherHome(context: WebsiteContext, now = Date.now()): Promise<TeacherHomeLoad> {
  const groups = settle(async () => (await groupService()).overview() as Promise<GroupPage<StudyGroup>>);
  const upcoming = settle(async () => (await groupService()).view<GroupSession & { group_name?: string }>(null, 'upcoming'));
  const notifications = settle(async () => (await (await communicationService())('notifications', 'list', { page: 0, filter: 'unread' })) as unknown as NotificationPage);
  const [courses, g, u, n] = await Promise.all([teacherCourses(context), groups, upcoming, notifications]);
  const targets = createTargets(context.organizations, context.memberships);
  return { ...buildTeacherHome({ courses, groups: g, upcoming: u, notifications: n, now }), createTargets: targets, demo: await demoLabel(teachingSpaceIds(targets, courses)) };
}

/** A failed check shows no label and no error: the label only ever says something the database confirmed. */
async function demoLabel(spaceIds: string[]): Promise<boolean> {
  if (!spaceIds.length || spaceIds.length > DEMO_CHECK_LIMIT) return false;
  try {
    const client = await getSupabaseServerClient();
    return showDemoLabel(spaceIds, await Promise.all(spaceIds.map(id => spaceIsDemo(client, id))));
  } catch { return false; }
}

export async function loadTeacherCourses(context: WebsiteContext) {
  const courses = await teacherCourses(context);
  return { courses: mapCourses(courses), createTargets: createTargets(context.organizations, context.memberships) };
}
