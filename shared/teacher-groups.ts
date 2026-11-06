import { nextSession, sessionState, validGroupMeetingUrl, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';

/**
 * Pure mapping for the teacher Groups & Classes screens. Everything here is derived from what the existing group service already returns
 * (study_groups rows, `detail`, `sessions` and `members` views); nothing is estimated or invented.
 */
export type WeeklyTime = { weekday: number; time: string; durationMinutes: number };
export type GroupFilter = 'active' | 'archived';
export type AttendanceSummary = 'opens' | 'saved' | 'reopened' | 'unsaved' | 'none';

/** Groups the list reads (25 per page, pages 0..LIST_PAGES-1); a bigger list is said to be cut off, never silently shortened. */
export const LIST_PAGES = 4;
export const PAGE_SIZE = 25;
/** Sessions waiting for attendance shown before "Show N more". */
export const NEEDS_SHOWN = 5;
/** Pages of a Group's attendance history read to add up each student's attendance (25 rows each); beyond this a student shows a dash, never a partial number. */
export const ATTENDANCE_PAGES = 20;

export function sortedSchedules(items: readonly WeeklyTime[]): WeeklyTime[] {
  return [...items].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
}

/** A reference instant for a weekday and a wall-clock time (2024-01-07 was a Sunday), formatted in UTC so the label never shifts. */
export function weeklyReference(weekday: number, time: string) {
  return `2024-01-${String(7 + weekday).padStart(2, '0')}T${time}:00Z`;
}

/** Only the current members (an open interval) count as students. */
export function currentMembers(rows: readonly GroupRow[]) {
  return rows.filter(r => r.ends_at == null);
}

export type StudentsCount = { count: number; more: boolean; capacity: number | null };
export function studentsCount(rows: readonly GroupRow[], hasMore: boolean | undefined, capacity: number | null): StudentsCount {
  return { count: currentMembers(rows).length, more: Boolean(hasMore), capacity };
}

/** "Past" means it ended; a cancelled session is placed by when it was to start. A session in progress stays with the upcoming ones. */
export function partitionSessions(rows: readonly GroupSession[], now: number): { upcoming: GroupSession[]; earlier: GroupSession[] } {
  const later = (s: GroupSession) => (s.cancelled ? Date.parse(s.starts_at) > now : Date.parse(s.ends_at) > now);
  return {
    upcoming: rows.filter(later).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id)),
    earlier: rows.filter(s => !later(s)).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || a.id.localeCompare(b.id)),
  };
}

/**
 * The Group page's four sections. Now: in progress. Needs attendance: finished, not cancelled, not finalized (newest first). Upcoming: yet to start, cancelled ones included so a teacher can see them.
 * Past: everything else, newest first. Every Session is in exactly one.
 */
export function groupSessions(rows: readonly GroupSession[], now: number) {
  const { upcoming, earlier } = partitionSessions(rows, now);
  const live = (s: GroupSession) => sessionState(s, now) === 'ongoing';
  const waiting = (s: GroupSession) => !s.cancelled && s.attendance_state !== 'finalized';
  return { now: upcoming.filter(live), needs: earlier.filter(waiting), upcoming: upcoming.filter(s => !live(s)), past: earlier.filter(s => !waiting(s)) };
}

/** Each student's Present marks out of Present and Absent marks. A student not marked in a Session is left out of that Session's count; nothing is estimated. */
export type AttendanceTotal = { attended: number; total: number };
export function attendanceTotals(rows: readonly Pick<GroupRow, 'user_id' | 'status'>[]) {
  const totals = new Map<string, AttendanceTotal>();
  for (const { user_id, status } of rows) {
    if (status !== 'attended' && status !== 'absent') continue;
    const entry = totals.get(user_id) ?? { attended: 0, total: 0 };
    entry.total++;
    if (status === 'attended') entry.attended++;
    totals.set(user_id, entry);
  }
  return totals;
}

/** The Cairo date and time of an instant, as a date and a time input expect them. */
export function cairoFields(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/** Where Invite students opens, with the Group's course already chosen. */
export const inviteHref = (offeringId: string) => `/teacher/students/invite?invite=${offeringId}`;

export function attendanceSummary(s: GroupSession, now: number): AttendanceSummary {
  const state = sessionState(s, now);
  if (state === 'cancelled') return 'none';
  if (s.attendance_state === 'finalized') return 'saved';
  if (state === 'upcoming' || state === 'ongoing') return 'opens';
  return s.attendance_state === 'reopened' ? 'reopened' : 'unsaved';
}

/** The most recent finished, non-cancelled session has no saved attendance. Derived from the same sessions read the card already makes. */
export function lastUnsavedSession(rows: readonly GroupSession[], now: number): GroupSession | null {
  const done = rows.filter(s => !s.cancelled && Date.parse(s.ends_at) <= now).sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at));
  return done.length > 0 && done[0].attendance_state !== 'finalized' ? done[0] : null;
}
/**
 * Every finished, non-cancelled session whose attendance was not finalized, newest first. `lastUnsavedSession` only ever names the latest
 * finished one, so an earlier class left unsaved was invisible on Home.
 */
export function unsavedSessions(rows: readonly GroupSession[], now: number): GroupSession[] {
  return rows.filter(s => !s.cancelled && Date.parse(s.ends_at) <= now && s.attendance_state !== 'finalized')
    .sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at) || a.id.localeCompare(b.id));
}
export const lastAttendanceUnsaved = (rows: readonly GroupSession[], now: number) => lastUnsavedSession(rows, now) !== null;

const nameCollator = new Intl.Collator(['ar', 'en'], { sensitivity: 'base', numeric: true });
/**
 * The one order for students on screen: alphabetical by name, Arabic and Latin names each in their own alphabetical order, ties by id.
 * The Take attendance list and the Group's Students tab both use it. (The database pages the Students tab by join date, so a Group with more
 * than one page of students is alphabetical within the pages shown.)
 */
export function studentsByName<T extends { display_name: string; user_id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => nameCollator.compare(a.display_name ?? '', b.display_name ?? '') || a.user_id.localeCompare(b.user_id));
}

export const nextOf = (rows: readonly GroupSession[], now: number) => nextSession([...rows], now);

export type ListedGroup = Pick<StudyGroup, 'id' | 'name' | 'status' | 'staff' | 'instructor' | 'capacity' | 'mode' | 'location' | 'version'>;
/** Only Groups the teacher manages are listed; the database decides that (`staff`), the screen only filters on it. */
export const managed = <T extends Pick<StudyGroup, 'staff'>>(rows: readonly T[]) => rows.filter(g => g.staff);
export function groupCounts(rows: readonly Pick<StudyGroup, 'status'>[]) {
  return { active: rows.filter(g => g.status === 'active').length, archived: rows.filter(g => g.status === 'archived').length };
}
/** Search reads the Group's name and its course title. The name of the run is never shown, so it must not decide a match either. */
export function filterGroups<T extends Pick<StudyGroup, 'name' | 'status'>>(rows: readonly T[], filter: GroupFilter, query: string, courseTitle: (group: T) => string = () => '') {
  const q = query.trim().toLowerCase();
  return rows.filter(g => g.status === filter && (!q || g.name.toLowerCase().includes(q) || courseTitle(g).toLowerCase().includes(q)));
}

/** What a failed call means for the person, never "nothing found". `null` = no reply (the outcome of a change is then unknown). */
export type FailureKind = 'signin' | 'denied' | 'changed' | 'invalid' | 'unavailable';
export function failureKind(status: number | null): FailureKind {
  return status === 401 ? 'signin' : status === 403 ? 'denied' : status === 409 ? 'changed' : status === 400 || status === 413 || status === 415 ? 'invalid' : 'unavailable';
}

// ---- Create and Edit a Group: the form is plain text until it is checked; the database still checks everything again.
export const GROUP_LENGTHS = [30, 45, 60, 75, 90, 120, 150, 180];
export const MAX_WEEKLY_TIMES = 14;
export type TimeRow = { weekday: number; time: string; durationMinutes: number };
export type GroupForm = { name: string; mode: 'center' | 'online'; location: string; joinUrl: string; capacity: string; times: TimeRow[] };
export type GroupFormProblem = 'name' | 'location' | 'join' | 'capacity' | 'times_required' | 'time' | 'times_duplicate';
export type GroupFields = { name: string; mode: 'center' | 'online'; location: string; joinUrl: string; capacity: number | null; schedules: WeeklyTime[] };

export const emptyTime = (): TimeRow => ({ weekday: 0, time: '', durationMinutes: 60 });
export const emptyGroupForm = (): GroupForm => ({ name: '', mode: 'center', location: '', joinUrl: '', capacity: '', times: [emptyTime()] });
export function formFromGroup(group: Pick<StudyGroup, 'name' | 'mode' | 'location' | 'join_url' | 'capacity'>, schedules: readonly WeeklyTime[]): GroupForm {
  return { name: group.name, mode: group.mode, location: group.location, joinUrl: group.join_url, capacity: group.capacity === null ? '' : String(group.capacity), times: sortedSchedules(schedules).map(s => ({ ...s })) };
}

/** `requireTimes` is true except when editing a Group that already has no weekly times. */
export function checkGroupForm(form: GroupForm, requireTimes = true): { problems: GroupFormProblem[]; value: GroupFields | null } {
  const problems: GroupFormProblem[] = [], name = form.name.trim(), location = form.location.trim(), joinUrl = form.joinUrl.trim(), capacity = form.capacity.trim();
  if (!name || name.length > 160) problems.push('name');
  if (form.mode === 'center' && (!location || location.length > 1000)) problems.push('location');
  if (form.mode === 'online' && !validGroupMeetingUrl(joinUrl)) problems.push('join');
  const count = Number(capacity);
  if (capacity && !(/^\d+$/.test(capacity) && count >= 1 && count <= 10000)) problems.push('capacity');
  if (requireTimes && !form.times.length) problems.push('times_required');
  if (form.times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))) problems.push('time');
  else if (new Set(form.times.map(t => `${t.weekday}:${t.time}`)).size !== form.times.length) problems.push('times_duplicate');
  if (problems.length) return { problems, value: null };
  return { problems, value: { name, mode: form.mode, location: form.mode === 'center' ? location : '', joinUrl: form.mode === 'online' ? joinUrl : '', capacity: capacity ? count : null, schedules: form.times.map(t => ({ ...t })) } };
}

const scheduleKey = (items: readonly WeeklyTime[]) => sortedSchedules(items).map(s => `${s.weekday}:${s.time}:${s.durationMinutes}`).join();
export const placeChanged = (group: Pick<StudyGroup, 'mode' | 'location' | 'join_url'>, value: Pick<GroupFields, 'mode' | 'location' | 'joinUrl'>) => group.mode !== value.mode || group.location !== value.location || group.join_url !== value.joinUrl;
/** A saved weekly time is gone or changed, so the database will cancel its upcoming automatic Sessions. */
export function timesRemoved(before: readonly WeeklyTime[], after: readonly WeeklyTime[]) {
  const kept = new Set(after.map(s => `${s.weekday}:${s.time}:${s.durationMinutes}`));
  return before.some(s => !kept.has(`${s.weekday}:${s.time}:${s.durationMinutes}`));
}
/** Weekly times are only sent when they changed (leaving them out keeps them); a changed place also moves the upcoming automatic Sessions. */
export function editPayload(group: Pick<StudyGroup, 'mode' | 'location' | 'join_url'>, before: readonly WeeklyTime[], value: GroupFields) {
  const { schedules, ...fields } = value;
  return { ...fields, ...(scheduleKey(before) === scheduleKey(schedules) ? {} : { schedules }), ...(placeChanged(group, value) ? { applyMeetingDefaults: true } : {}) };
}

// ---- Which course a new Group can belong to. Teachers pick a course; the course's current run stays out of sight.
export type RunRow = { id: string; course_id: string; status: string; starts_at?: string | null; ends_at?: string | null };
export type CourseChoice = { courseId: string; title: string; runId: string | null; published: boolean };
type GroupCourse = { id: string; organization_id: string; title: string; status: string };
type Access = { memberships: readonly { organization_id: string; role: string; status: string }[]; courseStaff: readonly { course_id: string; role: string }[]; offeringStaff: readonly { offering_id: string; role: string }[] };

/** The active, not yet ended run; with several, the one that started last, so the choice is always the same one. */
export function currentRun<T extends RunRow>(runs: readonly T[], courseId: string, now: number): T | null {
  const open = runs.filter(r => r.course_id === courseId && r.status === 'active' && (!r.ends_at || Date.parse(r.ends_at) > now));
  const start = (r: T) => (r.starts_at ? Date.parse(r.starts_at) : 0);
  return [...open].sort((a, b) => start(b) - start(a) || a.id.localeCompare(b.id))[0] ?? null;
}
/** The courses this teacher may create a Group in (same rule as the database, which still decides). A course without a current run can get one on saving. */
export function groupCourseChoices(courses: readonly GroupCourse[], runs: readonly RunRow[], access: Access, now: number): CourseChoice[] {
  const choices: CourseChoice[] = [];
  for (const course of courses) {
    if (course.status === 'archived') continue;
    const run = currentRun(runs, course.id, now);
    const manages = access.memberships.some(m => m.organization_id === course.organization_id && m.status === 'active' && ['owner', 'admin'].includes(m.role))
      || (access.memberships.some(m => m.organization_id === course.organization_id && m.status === 'active') && access.courseStaff.some(s => s.course_id === course.id && ['owner', 'instructor'].includes(s.role)));
    const instructsRun = run !== null && access.offeringStaff.some(s => s.offering_id === run.id && s.role === 'instructor');
    if (manages || instructsRun) choices.push({ courseId: course.id, title: course.title, runId: run?.id ?? null, published: course.status === 'published' });
  }
  return choices.sort((a, b) => a.title.localeCompare(b.title) || a.courseId.localeCompare(b.courseId));
}
