import { nextSession, sessionState, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';

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
/** Sessions shown before "See older sessions". */
export const RECENT_PAST = 3;

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
export const lastAttendanceUnsaved = (rows: readonly GroupSession[], now: number) => lastUnsavedSession(rows, now) !== null;

export const nextOf = (rows: readonly GroupSession[], now: number) => nextSession([...rows], now);

export type ListedGroup = Pick<StudyGroup, 'id' | 'name' | 'offering_name' | 'status' | 'staff' | 'instructor' | 'capacity' | 'mode' | 'location' | 'version'>;
/** Only Groups the teacher manages are listed; the database decides that (`staff`), the screen only filters on it. */
export const managed = <T extends Pick<StudyGroup, 'staff'>>(rows: readonly T[]) => rows.filter(g => g.staff);
export function groupCounts(rows: readonly Pick<StudyGroup, 'status'>[]) {
  return { active: rows.filter(g => g.status === 'active').length, archived: rows.filter(g => g.status === 'archived').length };
}
export function filterGroups<T extends Pick<StudyGroup, 'name' | 'offering_name' | 'status'>>(rows: readonly T[], filter: GroupFilter, query: string) {
  const q = query.trim().toLowerCase();
  return rows.filter(g => g.status === filter && (!q || g.name.toLowerCase().includes(q) || g.offering_name.toLowerCase().includes(q)));
}

/** What a failed call means for the person, never "nothing found". `null` = no reply (the outcome of a change is then unknown). */
export type FailureKind = 'signin' | 'denied' | 'changed' | 'invalid' | 'unavailable';
export function failureKind(status: number | null): FailureKind {
  return status === 401 ? 'signin' : status === 403 ? 'denied' : status === 409 ? 'changed' : status === 400 || status === 413 || status === 415 ? 'invalid' : 'unavailable';
}
