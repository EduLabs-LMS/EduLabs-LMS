import type { GroupRow, GroupSession } from '@/shared/contracts/groups';

/**
 * Pure mapping for the teacher Take attendance screen. The marks are exactly what the existing group service stores
 * (`attended`, `absent`, `not_marked`); there is no late or excused state, and nothing here estimates or invents a mark.
 */
export type Mark = 'attended' | 'absent' | 'not_marked';
export type Marks = Record<string, Mark>;
export type SheetState = GroupSession['attendance_state'];
export type MarkChange = { userId: string; status: Mark };

/** The database saves at most this many marks in one atomic call. */
export const MARKS_PER_SAVE = 100;
/** Pages of 25 read for one Session's list; a longer list is said to be cut off and cannot be finalized from here. */
export const ROSTER_PAGES = 40;
export const ROSTER_PAGE_SIZE = 25;
/** Pages of Sessions read only to work out "Session N". If more remain, the number is left out rather than guessed. */
export const NUMBER_PAGES = 8;

export const attendanceHref = (groupId: string, sessionId: string) => `/teacher/groups/${groupId}/attendance/${sessionId}`;

const isMark = (v: unknown): v is Mark => v === 'attended' || v === 'absent' || v === 'not_marked';

export function marksOf(rows: readonly Pick<GroupRow, 'user_id' | 'status'>[]): Marks {
  const out: Marks = {};
  for (const r of rows) out[r.user_id] = isMark(r.status) ? r.status : 'not_marked';
  return out;
}

export function countMarks(marks: Marks) {
  const c = { attended: 0, absent: 0, not_marked: 0 };
  for (const v of Object.values(marks)) c[v]++;
  return c;
}

/** Only what differs from the last saved list is sent. */
export function changedMarks(saved: Marks, current: Marks): MarkChange[] {
  return Object.keys(current).filter(id => current[id] !== saved[id]).map(userId => ({ userId, status: current[userId] }));
}

export function allPresent(marks: Marks): Marks {
  return Object.fromEntries(Object.keys(marks).map(id => [id, 'attended' as const]));
}

/** Pressing the mark a student already has takes it back to "not marked". */
export function toggled(current: Mark, pressed: 'attended' | 'absent'): Mark {
  return current === pressed ? 'not_marked' : pressed;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The 1-based place of a Session among the Group's Sessions that took place or are planned (cancelled ones do not count). `null` when it cannot be known. */
export function sessionNumber(rows: readonly GroupSession[], allRead: boolean, sessionId: string): number | null {
  if (!allRead) return null;
  const live = rows.filter(s => !s.cancelled).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
  const i = live.findIndex(s => s.id === sessionId);
  return i < 0 ? null : i + 1;
}

/** Attendance can be taken once the Session has started; a cancelled Session has none. */
export function canTakeAttendance(s: Pick<GroupSession, 'starts_at' | 'cancelled'>, now: number) {
  return !s.cancelled && now >= Date.parse(s.starts_at);
}

export const reasonValid = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 1000;
