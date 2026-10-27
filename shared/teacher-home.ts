import type { GroupPage, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import type { NotificationEvent, NotificationPage } from '@/shared/contracts/communications';

/** Pure mapping for the teacher Home and Courses pages. Every section carries its own state, so a failed read is never shown as an empty one. */
export type Settled<T> = { ok: true; value: T } | { ok: false; status: number | null };
export type Section<T> = { state: 'ready'; data: T } | { state: 'error'; status: number | null } | { state: 'unavailable' };

export type CourseStatus = 'draft' | 'published' | 'archived';
export type HomeCourse = { id: string; title: string; status: CourseStatus };
export type HomeSession = { id: string; groupId: string; groupName: string; title: string; startsAt: string; endsAt: string; mode: 'online' | 'center'; location: string };
export type HomeUpdate = { id: string; event: NotificationEvent; createdAt: string; link: string | null; sessionChange: boolean };
export type CreateTarget = { id: string; name: string };

export const COURSE_LIMIT = 100;
export const UPDATE_LIMIT = 5;
export const COMING_UP_LIMIT = 5;
const sessionEvents: readonly NotificationEvent[] = ['session_details', 'session_starting'];
const courseStatuses: readonly string[] = ['draft', 'published', 'archived'];

export type RawCourse = { id: string; organization_id: string; title: string; status: string };
export type RawInputs = {
  /** Courses the signed-in teacher may manage (already filtered by the server capability check). */
  courses: Settled<RawCourse[]>;
  groups: Settled<GroupPage<StudyGroup>>;
  upcoming: Settled<GroupPage<GroupSession & { group_name?: string }>>;
  notifications: Settled<NotificationPage>;
  now: number;
};

export type TeacherHomeData = {
  courses: Section<{ items: HomeCourse[]; truncated: boolean }>;
  groups: Section<{ count: number; partial: boolean }>;
  sessions: Section<{ next: HomeSession | null; comingUp: HomeSession[]; partial: boolean }>;
  /** Pending counts per Group in the existing summary are the viewer's own unsubmitted homework, not submissions awaiting correction, so this section is never filled from them. */
  homework: Section<never>;
  updates: Section<{ items: HomeUpdate[]; unread: number }>;
  firstVisit: boolean;
};

export type TeacherHomeLoad = TeacherHomeData & { createTargets: CreateTarget[] };

const fail = <T>(r: Settled<unknown>): Section<T> => ({ state: 'error', status: r.ok ? null : r.status });

export function mapCourses(raw: Settled<RawCourse[]>): TeacherHomeData['courses'] {
  if (!raw.ok) return fail(raw);
  const items = raw.value.filter(c => courseStatuses.includes(c.status)).map(c => ({ id: c.id, title: c.title, status: c.status as CourseStatus }));
  return { state: 'ready', data: { items: items.slice(0, COURSE_LIMIT), truncated: items.length > COURSE_LIMIT } };
}

export function mapGroups(raw: Settled<GroupPage<StudyGroup>>): { section: TeacherHomeData['groups']; staffIds: Map<string, string> } {
  if (!raw.ok) return { section: fail(raw), staffIds: new Map() };
  const mine = raw.value.rows.filter(g => g.staff && g.status === 'active');
  const partial = Boolean(raw.value.hasMore);
  return { section: { state: 'ready', data: { count: mine.length, partial } }, staffIds: new Map(mine.map(g => [g.id, g.name])) };
}

export function mapSessions(upcoming: RawInputs['upcoming'], staffIds: Map<string, string>, groups: TeacherHomeData['groups'], now: number): TeacherHomeData['sessions'] {
  if (groups.state !== 'ready') return groups.state === 'error' ? { state: 'error', status: groups.status } : { state: 'unavailable' };
  if (!upcoming.ok) return fail(upcoming);
  const mine = upcoming.value.rows
    .filter(s => staffIds.has(s.group_id) && !s.cancelled && Date.parse(s.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id))
    .map((s): HomeSession => ({ id: s.id, groupId: s.group_id, groupName: staffIds.get(s.group_id) ?? s.group_name ?? '', title: s.title, startsAt: s.starts_at, endsAt: s.ends_at, mode: s.mode, location: s.location }));
  return { state: 'ready', data: { next: mine[0] ?? null, comingUp: mine.slice(1, 1 + COMING_UP_LIMIT), partial: groups.data.partial || Boolean(upcoming.value.hasMore) } };
}

export function mapUpdates(raw: Settled<NotificationPage>): TeacherHomeData['updates'] {
  if (!raw.ok) return fail(raw);
  const items = raw.value.rows
    .filter(n => !n.read_at)
    .map((n): HomeUpdate => ({ id: n.id, event: n.event_type, createdAt: n.created_at, link: safeLink(n.link), sessionChange: sessionEvents.includes(n.event_type) }))
    .sort((a, b) => Number(b.sessionChange) - Number(a.sessionChange) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { state: 'ready', data: { items: items.slice(0, UPDATE_LIMIT), unread: raw.value.unread } };
}

/** Only same-site paths are linked; anything else would be an open redirect carried in data. */
export function safeLink(link: string | null): string | null {
  return link && /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]*$/.test(link) ? link : null;
}

export function buildTeacherHome(input: RawInputs): TeacherHomeData {
  const courses = mapCourses(input.courses);
  const { section: groups, staffIds } = mapGroups(input.groups);
  const firstVisit = courses.state === 'ready' && courses.data.items.length === 0 && groups.state === 'ready' && groups.data.count === 0 && !groups.data.partial;
  return {
    courses, groups,
    sessions: mapSessions(input.upcoming, staffIds, groups, input.now),
    homework: { state: 'unavailable' },
    updates: mapUpdates(input.notifications),
    firstVisit,
  };
}

/** A course may be created in a place where the member is an owner, admin or teacher; the server decides again on save. */
export function createTargets(organizations: { id: string; name: string; status?: string }[], memberships: { organization_id: string; role: string; status: string }[]): CreateTarget[] {
  return organizations
    .filter(o => (o.status === undefined || o.status === 'active') && memberships.some(m => m.organization_id === o.id && m.status === 'active' && ['owner', 'admin', 'teacher'].includes(m.role)))
    .map(o => ({ id: o.id, name: o.name }));
}

/** A URL-safe name derived from the title; non-Latin titles fall back to a short random suffix so the server's slug rule always holds. */
export function courseSlug(title: string, random: () => string): string {
  const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  const suffix = random().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return base ? `${base}-${suffix}` : `course-${suffix}`;
}

export type TeacherNavItem = { key: 'home' | 'courses' | 'students' | 'groups' | 'homework' | 'exams' | 'reports' | 'settings'; href: string; match: (path: string) => boolean };
/** Destinations without a new screen go to the existing neutral scaffold or the existing page; nothing here is faked. */
export const teacherNav: readonly TeacherNavItem[] = [
  { key: 'home', href: '/home', match: p => p === '/' || p === '/home' },
  { key: 'courses', href: '/teacher/courses', match: p => p.startsWith('/teacher/courses') || p === '/teacher/create' },
  { key: 'students', href: '/admin/users', match: p => p.startsWith('/admin/users') },
  { key: 'groups', href: '/groups', match: p => p.startsWith('/group') || p === '/sessions-groups' || p === '/sessions' },
  { key: 'homework', href: '/admin/submissions', match: p => p.startsWith('/admin/submissions') },
  { key: 'exams', href: '/exams', match: p => p.startsWith('/exams') },
  { key: 'reports', href: '/teacher/analytics', match: p => p.startsWith('/teacher/analytics') },
  { key: 'settings', href: '/settings', match: p => p === '/settings' || p.startsWith('/settings/') || p === '/personalization' },
];

/** Teacher navigation is for active staff of the Firebase/Supabase build only; students and the Clerk fallback keep their own navigation. */
export const showTeacherNav = (firebase: boolean, staffOrganizationIds: readonly string[] | null | undefined) => firebase && Boolean(staffOrganizationIds?.length);
