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
/** A search box is offered above this many students. */
export const SEARCH_FROM = 15;
/** Automatic retries of a save that failed for a reason that can pass (no reply, server trouble); after these the teacher gets a Retry button. */
export const AUTO_RETRIES = 5;
/** A reload shortly after a save started is checked against the server again; the note of it expires after this long. */
export const PENDING_NOTE_MS = 60_000;

export const attendanceHref = (groupId: string, sessionId: string) => `/teacher/groups/${groupId}/attendance/${sessionId}`;
/** The address of the Take attendance page: the teacher frame hides the phone tabs there. */
export const attendancePathPattern = /^\/teacher\/groups\/[^/]+\/attendance\/[^/]+$/;

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

/** "Mark the rest present": only students still not marked change. A mark already set (present or absent) is never overwritten. */
export function markRestPresent(marks: Marks): Marks {
  return Object.fromEntries(Object.entries(marks).map(([id, mark]) => [id, mark === 'not_marked' ? 'attended' as const : mark]));
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

/** Waits before automatic retry number `attempt` (1-based): 1 s, 2 s, 4 s, 8 s, then 15 s. */
export const retryDelay = (attempt: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));

/** Only a missing reply or server trouble can pass by itself. A refusal (401, 403), an invalid request or a finished sheet will not. */
export const retryable = (status: number | null) => status === null || status >= 500;

/** Case- and accent-insensitive "contains", for the search box. An empty search matches everyone. */
export function matchesSearch(name: string, query: string) {
  const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '').toLocaleLowerCase();
  const q = fold(query.trim());
  return !q || fold(name).includes(q);
}

/** Attendance can be taken once the Session has started; a cancelled Session has none. */
export function canTakeAttendance(s: Pick<GroupSession, 'starts_at' | 'cancelled'>, now: number) {
  return !s.cancelled && now >= Date.parse(s.starts_at);
}

export const reasonValid = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 1000;
