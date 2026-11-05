import type { GroupPage, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import type { NotificationEvent, NotificationPage } from '@/shared/contracts/communications';
import { unsavedSessions } from '@/shared/teacher-groups';
import { canTakeAttendance } from '@/shared/teacher-attendance';

/** Pure mapping for the teacher Home and Courses pages. Every section carries its own state, so a failed read is never shown as an empty one. */
export type Settled<T> = { ok: true; value: T } | { ok: false; status: number | null };
export type Section<T> = { state: 'ready'; data: T } | { state: 'error'; status: number | null } | { state: 'unavailable' };

export type CourseStatus = 'draft' | 'published' | 'archived';
export type HomeCourse = { id: string; title: string; status: CourseStatus };
export type HomeSession = { id: string; groupId: string; groupName: string; title: string; startsAt: string; endsAt: string; mode: 'online' | 'center'; location: string;
  /** Where the attendance sheet stands: only `finalized` means it was taken (a draft with marks is still being taken, a reopened one is being edited). */ attendance: GroupSession['attendance_state'];
  /** The session has started and is not cancelled (judged on the server clock when Home was read), so attendance can be taken. */ happening: boolean };
/** A finished session whose attendance was not finalized: the same rule as the "attendance not saved" line on a Group card. */
export type HomeUnsaved = { id: string; groupId: string; groupName: string; title: string; startsAt: string; endsAt: string };
export type HomeUpdate = { id: string; event: NotificationEvent; createdAt: string; link: string | null; sessionChange: boolean };
export type CreateTarget = { id: string; name: string };

export const COURSE_LIMIT = 100;
export const UPDATE_LIMIT = 5;
export const COMING_UP_LIMIT = 5;
/** At most this many "attendance not saved" rows on Home; the Groups they come from are read at most UNSAVED_GROUP_LIMIT at a time. */
export const UNSAVED_LIMIT = 3;
export const UNSAVED_GROUP_LIMIT = 10;
const sessionEvents: readonly NotificationEvent[] = ['session_details', 'session_starting'];
const courseStatuses: readonly string[] = ['draft', 'published', 'archived'];

export type RawCourse = { id: string; organization_id: string; title: string; status: string };
export type RawInputs = {
  /** Courses the signed-in teacher may manage (already filtered by the server capability check). */
  courses: Settled<RawCourse[]>;
  groups: Settled<GroupPage<StudyGroup>>;
  upcoming: Settled<GroupPage<GroupSession & { group_name?: string }>>;
  notifications: Settled<NotificationPage>;
  /** Each Group the teacher manages with its first page of sessions (upcoming first, then the latest finished ones). `more`: the page did not hold them all. */
  unsaved?: Settled<{ groupId: string; rows: GroupSession[]; more?: boolean }[]>;
  /** The existing staff counts of the student administration read. */
  metrics?: Settled<HomeMetrics>;
  /** What the hero says about the next session; null when it could not be read (the fact is then left out). */
  nextFacts?: HomeNextFacts | null;
  now: number;
};

export type HomeMetrics = { totalStudents: number; pendingWaitlistCount: number };
/** For a class already running: how many of its students are marked. Before it starts: how many students the Group has (`more`: at least this many). */
export type HomeNextFacts = { kind: 'marked'; marked: number; total: number } | { kind: 'members'; students: number; more: boolean };

export type TeacherHomeData = {
  /** The server clock when Home was read: the greeting and the date come from it, not from the device. */
  now: string;
  /** The small numbers on Home. Null means not known, and then that tile is left out. */
  summary: { activeGroups: number | null; students: number | null };
  /** Join requests waiting for a decision. */
  waiting: Section<{ count: number }>;
  /** Sessions on today's Cairo date, finished ones included. Null means it could not be counted for certain. */
  sessionsToday: number | null;
  nextFacts: HomeNextFacts | null;
  courses: Section<{ items: HomeCourse[]; truncated: boolean }>;
  groups: Section<{ count: number; partial: boolean }>;
  sessions: Section<{ next: HomeSession | null; comingUp: HomeSession[]; partial: boolean }>;
  /** Finished sessions still waiting for attendance, newest first, at most UNSAVED_LIMIT. */
  unsaved: Section<HomeUnsaved[]>;
  updates: Section<{ items: HomeUpdate[]; unread: number }>;
  firstVisit: boolean;
};

export type TeacherHomeLoad = TeacherHomeData & { createTargets: CreateTarget[]; demo: boolean };

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
    .map((s): HomeSession => ({ id: s.id, groupId: s.group_id, groupName: staffIds.get(s.group_id) ?? s.group_name ?? '', title: s.title, startsAt: s.starts_at, endsAt: s.ends_at, mode: s.mode, location: s.location, attendance: s.attendance_state, happening: canTakeAttendance(s, now) }));
  return { state: 'ready', data: { next: mine[0] ?? null, comingUp: mine.slice(1, 1 + COMING_UP_LIMIT), partial: groups.data.partial || Boolean(upcoming.value.hasMore) } };
}

export function mapUnsaved(raw: RawInputs['unsaved'], staffIds: Map<string, string>, groups: TeacherHomeData['groups'], now: number): TeacherHomeData['unsaved'] {
  if (groups.state !== 'ready') return groups.state === 'error' ? { state: 'error', status: groups.status } : { state: 'unavailable' };
  if (!raw) return { state: 'unavailable' };
  if (!raw.ok) return fail(raw);
  const items = raw.value.flatMap(({ groupId, rows }): HomeUnsaved[] => {
    const name = staffIds.get(groupId);
    return name === undefined ? [] : unsavedSessions(rows.filter(r => r.group_id === groupId), now).map(s => ({ id: s.id, groupId, groupName: name, title: s.title, startsAt: s.starts_at, endsAt: s.ends_at }));
  }).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt) || a.id.localeCompare(b.id));
  return { state: 'ready', data: items.slice(0, UNSAVED_LIMIT) };
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

const cairoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const cairoHourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' });
/** YYYY-MM-DD on the Cairo calendar, so it also compares by plain string order. */
export const cairoDay = (at: number) => cairoDayFormat.format(new Date(at));
export const cairoHour = (at: number) => Number(cairoHourFormat.format(new Date(at)));
export const greetingKey = (hour: number): 'morning' | 'afternoon' | 'evening' => hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
export const sessionsTodayKey = (count: number) => count === 0 ? 'th.home.sessions_none' as const : count === 1 ? 'th.home.sessions_one' as const : 'th.home.sessions_many' as const;

/**
 * Sessions on today's Cairo date: those still to come (the upcoming read) and those already finished (each Group's own page). It says a number only when every
 * read that could hold one of today's sessions was complete; otherwise null, and the page shows no count rather than a wrong one.
 */
export function countSessionsToday(input: RawInputs, staffIds: Map<string, string>, groups: TeacherHomeData['groups']): number | null {
  if (groups.state !== 'ready' || groups.data.partial || staffIds.size > UNSAVED_GROUP_LIMIT) return null;
  if (!input.upcoming.ok || input.upcoming.value.hasMore || !input.unsaved?.ok) return null;
  const today = cairoDay(input.now);
  const found = new Set<string>();
  const add = (s: GroupSession) => { if (staffIds.has(s.group_id) && !s.cancelled && cairoDay(Date.parse(s.starts_at)) === today) found.add(s.id); };
  input.upcoming.value.rows.forEach(add);
  for (const { rows, more } of input.unsaved.value) {
    // A cut-off page still answers for today if it reached back past today.
    if (more && !rows.some(r => cairoDay(Date.parse(r.starts_at)) < today)) return null;
    rows.forEach(add);
  }
  return found.size;
}

export function buildTeacherHome(input: RawInputs): TeacherHomeData {
  const courses = mapCourses(input.courses);
  const { section: groups, staffIds } = mapGroups(input.groups);
  const firstVisit = courses.state === 'ready' && courses.data.items.length === 0 && groups.state === 'ready' && groups.data.count === 0 && !groups.data.partial;
  const metrics = input.metrics;
  return {
    now: new Date(input.now).toISOString(),
    summary: { activeGroups: groups.state === 'ready' && !groups.data.partial ? groups.data.count : null, students: metrics?.ok ? metrics.value.totalStudents : null },
    waiting: !metrics ? { state: 'unavailable' } : metrics.ok ? { state: 'ready', data: { count: metrics.value.pendingWaitlistCount } } : fail(metrics),
    sessionsToday: countSessionsToday(input, staffIds, groups),
    nextFacts: input.nextFacts ?? null,
    courses, groups,
    sessions: mapSessions(input.upcoming, staffIds, groups, input.now),
    unsaved: mapUnsaved(input.unsaved, staffIds, groups, input.now),
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

export const DEMO_CHECK_LIMIT = 10;

/** Every teaching space the teacher works in: where they can create courses plus where their listed courses live. */
export function teachingSpaceIds(targets: CreateTarget[], courses: Settled<RawCourse[]>): string[] {
  const ids = new Set(targets.map(t => t.id));
  if (courses.ok) for (const c of courses.value) ids.add(c.organization_id);
  return Array.from(ids);
}

/**
 * The "Demo space" label is shown only when every one of the teacher's teaching spaces was confirmed as a demo space.
 * One unknown answer, one real space, or no space at all means no label, so a real space is never labelled demo.
 */
export function showDemoLabel(spaceIds: readonly string[], answers: readonly boolean[]): boolean {
  return spaceIds.length > 0 && spaceIds.length <= DEMO_CHECK_LIMIT && answers.length === spaceIds.length && answers.every(a => a === true);
}

/** A URL-safe name derived from the title; non-Latin titles fall back to a short random suffix so the server's slug rule always holds. */
export function courseSlug(title: string, random: () => string): string {
  const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  const suffix = random().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return base ? `${base}-${suffix}` : `course-${suffix}`;
}

export type TeacherNavItem = { key: 'home' | 'groups' | 'students' | 'courses'; href: string; match: (path: string) => boolean };
/** Where the whole logo and the Home menu item go. */
export const teacherHomeHref = '/home';
/** A course's own page keeps its address under Settings (/teacher/settings/courses/<id>) but belongs to the Courses menu item. */
export const teacherCoursesActive = (p: string) => p === '/teacher/courses' || p.startsWith('/teacher/courses/') || p.startsWith('/teacher/settings/courses/');
export const teacherSettingsActive = (p: string) => (p === '/teacher/settings' || p.startsWith('/teacher/settings/')) && !teacherCoursesActive(p);
/** The main teacher menu. Homework, Exams and Reports stay hidden until they are built (owner decision, DECISIONS.md). Notifications and Settings sit at the bottom of the frame. */
export const teacherNav: readonly TeacherNavItem[] = [
  { key: 'home', href: teacherHomeHref, match: p => p === '/' || p === '/home' },
  { key: 'groups', href: '/teacher/groups', match: p => p === '/teacher/groups' || p.startsWith('/teacher/groups/') },
  { key: 'students', href: '/teacher/students', match: p => p === '/teacher/students' || p.startsWith('/teacher/students/') },
  { key: 'courses', href: '/teacher/courses', match: teacherCoursesActive },
];

/** Teacher navigation is for active staff of the Firebase/Supabase build only; students and the Clerk fallback keep their own navigation. */
export const showTeacherNav = (firebase: boolean, staffOrganizationIds: readonly string[] | null | undefined) => firebase && Boolean(staffOrganizationIds?.length);
