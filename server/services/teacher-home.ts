import 'server-only';
import { courseCapability, type WebsiteContext } from '@/server/services/website';
import { groupService } from '@/server/services/groups';
import { communicationService } from '@/server/services/communications';
import { spaceIsDemo } from '@/server/services/demo-space';
import { studentAdministration } from '@/server/services/student-administration';
import { readPortal } from '@/server/services/teacher-homework';
import { isFirebaseStaging } from '@/shared/auth-config';
import { getSupabaseServerClient } from '@/server/integrations/supabase';
import type { GroupPage, GroupRow, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import type { NotificationPage } from '@/shared/contracts/communications';
import { groupCourseChoices } from '@/shared/teacher-groups';
import { DEMO_CHECK_LIMIT, UNSAVED_GROUP_LIMIT, buildTeacherHome, mapHomework, mapGroups, mapSessions, createTargets, mapCourses, showDemoLabel, teachingSpaceIds, type HomeMetrics, type HomeNextFacts, type RawCourse, type RawInputs, type Settled, type TeacherHomeLoad } from '@/shared/teacher-home';

/** Reads run independently; one failing read marks only its own section as failed. Uses the existing services, which stay authoritative. */
export async function settle<T>(read: () => PromiseLike<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await read() }; }
  catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return { ok: false, status: typeof status === 'number' ? status : null };
  }
}

export async function teacherCourses(context: WebsiteContext): Promise<Settled<RawCourse[]>> {
  // The context already read the caller's courses (same read, same limit) in this request.
  return settle(async () => context.courses.filter(c => courseCapability(context, c)));
}


export async function loadTeacherHome(context: WebsiteContext, now = Date.now()): Promise<TeacherHomeLoad> {
  // The courses and spaces are already in the context, so the demo-label check can start with the other reads instead of after them.
  const ownCourses = await teacherCourses(context);
  const targets = createTargets(context.organizations, context.memberships);
  const demo = demoLabel(teachingSpaceIds(targets, ownCourses));
  const groups = settle(async () => (await groupService()).overview() as Promise<GroupPage<StudyGroup>>);
  const upcoming = settle(async () => (await groupService()).view<GroupSession & { group_name?: string }>(null, 'upcoming'));
  // The rule "attendance not saved" is read per Group from its own sessions, exactly like a Group card does (the existing `view`, no new endpoint).
  const unsaved = groups.then(g => settle(async () => {
    if (!g.ok) return [];
    const service = await groupService();
    const all: string[] = [];
    mapGroups(g).staffIds.forEach((_name, id) => all.push(id));
    const ids = all.slice(0, UNSAVED_GROUP_LIMIT);
    return Promise.all(ids.map(async groupId => { const page = await service.view<GroupSession>(groupId, 'sessions'); return { groupId, rows: page.rows, more: Boolean(page.hasMore) }; }));
  }));
  const notifications = settle(async () => (await (await communicationService())('notifications', 'list', { page: 0, filter: 'unread' })) as unknown as NotificationPage);
  // The existing counts the database scopes to what the caller may support.
  const metrics = settle(() => studentAdministration<HomeMetrics>('metrics', {}));
  const nextFacts = Promise.all([groups, upcoming]).then(([g, u]) => readNextFacts(g, u, now));
  // Homework to correct: the Homework page's own read (homework_portal, which the database scopes to what the caller may correct).
  const homework = isFirebaseStaging() ? settle(async () => {
    const read = await readPortal(null, 'open', 0);
    if (read.status !== 200) throw Object.assign(new Error('Homework read failed'), { status: read.status });
    return read.body as { toCorrect?: unknown };
  }).then(mapHomework) : Promise.resolve({ state: 'unavailable' as const });
  const [g, u, n, a, m, facts, demoShown, hw] = await Promise.all([groups, upcoming, notifications, unsaved, metrics, nextFacts, demo, homework]);
  return { ...buildTeacherHome({ courses: ownCourses, groups: g, upcoming: u, notifications: n, unsaved: a, metrics: m, nextFacts: facts, now }), createTargets: targets, demo: demoShown, homework: hw };
}

/**
 * What the hero says about the next session, from the same reads the Group and Attendance pages use. A running class: its marked count (this read also fixes the class's
 * list, exactly as opening its Attendance page does: see DECISIONS.md). A later one: the Group's students. If the read fails the fact is left out, and Home still shows.
 */
async function readNextFacts(groups: RawInputs['groups'], upcoming: RawInputs['upcoming'], now: number): Promise<HomeNextFacts | null> {
  const { section, staffIds } = mapGroups(groups);
  const sessions = mapSessions(upcoming, staffIds, section, now);
  const next = sessions.state === 'ready' ? sessions.data.next : null;
  if (!next) return null;
  const read = await settle(async () => {
    const service = await groupService();
    if (next.happening) {
      const counts = (await service.view<GroupRow>(next.groupId, next.id)).counts;
      return counts ? { kind: 'marked' as const, marked: counts.attended + counts.absent, total: counts.attended + counts.absent + counts.not_marked } : null;
    }
    const page = await service.view<GroupRow>(next.groupId, 'members');
    return { kind: 'members' as const, students: page.rows.length, more: Boolean(page.hasMore) };
  });
  return read.ok ? read.value : null;
}

/** A failed check shows no label and no error: the label only ever says something the database confirmed. */
async function demoLabel(spaceIds: string[]): Promise<boolean> {
  if (!spaceIds.length || spaceIds.length > DEMO_CHECK_LIMIT) return false;
  try {
    const client = await getSupabaseServerClient();
    return showDemoLabel(spaceIds, await Promise.all(spaceIds.map(id => spaceIsDemo(client, id))));
  } catch { return false; }
}

/** The courses a new Group can belong to, for the Create a Group page. */
export async function loadGroupCourses(context: WebsiteContext, now = Date.now()) {
  return settle(async () => {
    return groupCourseChoices(context.courses, context.offerings, context, now);
  });
}

export async function loadTeacherCourses(context: WebsiteContext) {
  const courses = await teacherCourses(context);
  return { courses: mapCourses(courses), createTargets: createTargets(context.organizations, context.memberships) };
}
