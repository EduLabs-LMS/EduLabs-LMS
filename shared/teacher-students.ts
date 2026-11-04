// The teacher Students screen: pure rules for the lists, the merged paging, join requests, invite links and attendance.
// Everything here is plain data in, plain data out; the screens call the existing student-administration endpoint and the database decides who may do what.
import type { AdminOffering, StudentRow } from '@/shared/contracts/student-administration';
import type { GroupRow, StudyGroup } from '@/shared/contracts/groups';

export const ROSTER_PAGE = 25;
/** A student page and the Group index read at most this many pages of one course / one Group; past it the screen says so. */
export const MAX_ROSTER_PAGES = 40;
export const MAX_MEMBER_PAGES = 20;
export const MAX_HISTORY_PAGES = 4;

export type RosterRow = StudentRow & { enrolled_at?: string | null };
export type RequestRow = { id: string; user_id: string; display_name: string | null; status: string; version: number; reason?: string; created_at: string };
export type LinkRow = { id: string; kind: 'request' | 'invite'; expires_at: string; revoked_at: string | null; claimed_at: string | null };

export const STATUS_FILTERS = ['all', 'active', 'suspended', 'expired', 'completed', 'cancelled', 'invited', 'waiting'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type StudentStatus = 'active' | 'suspended' | 'expired' | 'completed' | 'cancelled' | 'invited';

/** An enrollment stays "active" in the database after it ends; the teacher sees Expired. */
export function displayStatus(row: Pick<RosterRow, 'status' | 'expires_at'>, now: number): StudentStatus {
  if (row.status === 'active' && row.expires_at && Date.parse(row.expires_at) <= now) return 'expired';
  return (['active', 'suspended', 'completed', 'cancelled', 'invited'].includes(row.status) ? row.status : 'invited') as StudentStatus;
}

/** The roster action's own filter for a screen filter ("waiting" is read from the requests instead). */
export const rosterFilter = (filter: StatusFilter) => filter === 'waiting' ? 'all' : filter;

export const courseName = (o: Pick<AdminOffering, 'course_title' | 'name'>) => o.course_title?.trim() || o.name;

/** The courses a teacher may look at and, separately, the ones they may change. */
export const manageable = (offerings: readonly AdminOffering[]) => offerings.filter(o => o.manage);

// ---- One list over many courses: each course is read in name order a page at a time, and the lists are merged.
export type Stream = { offering: AdminOffering; rows: RosterRow[]; page: number; done: boolean; failed: boolean; capped: boolean };
export const newStream = (offering: AdminOffering): Stream => ({ offering, rows: [], page: 0, done: false, failed: false, capped: false });
const key = (r: Pick<RosterRow, 'display_name' | 'id'>) => `${(r.display_name ?? '').toLocaleLowerCase()}\u0000${r.id}`;

export type Step = { kind: 'need'; index: number } | { kind: 'row'; index: number } | { kind: 'end' };
/**
 * The next row in order across every course. A course whose buffer is empty and not finished must be read first (or the order could be wrong),
 * except one that failed: it is left out and the screen says so.
 */
export function nextStep(streams: readonly Stream[]): Step {
  let best = -1;
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (s.failed) continue;
    if (s.rows.length === 0) { if (!s.done) return { kind: 'need', index: i }; continue; }
    if (best < 0 || key(s.rows[0]) < key(streams[best].rows[0])) best = i;
  }
  return best < 0 ? { kind: 'end' } : { kind: 'row', index: best };
}
export const readPage = (s: Stream, rows: readonly RosterRow[]): Stream => {
  const full = rows.length >= ROSTER_PAGE, atCap = s.page + 1 >= MAX_ROSTER_PAGES;
  return { ...s, rows: [...s.rows, ...rows], page: s.page + 1, done: !full || atCap, capped: full && atCap, failed: false };
};
export const failStream = (s: Stream): Stream => ({ ...s, failed: true });
export const retryStream = (s: Stream): Stream => ({ ...s, failed: false });
export const takeRow = (streams: readonly Stream[], index: number): { streams: Stream[]; row: RosterRow } => ({ row: streams[index].rows[0], streams: streams.map((s, i) => i === index ? { ...s, rows: s.rows.slice(1) } : s) });
export const hasMore = (streams: readonly Stream[]) => streams.some(s => !s.failed && (s.rows.length > 0 || !s.done));
/** A course with more students than the screen reads says so rather than silently stopping. */
export const truncated = (streams: readonly Stream[]) => streams.some(s => s.capped);

// ---- Which Groups a student is in, from the Groups the teacher can see and those Groups' members.
export type GroupRef = Pick<StudyGroup, 'id' | 'name' | 'offering_id' | 'status' | 'staff' | 'version'>;
export const teacherGroups = (groups: readonly GroupRef[]) => groups.filter(g => g.staff);
export type MemberIndex = Map<string, { id: string; name: string }[]>;
export function indexMembers(groups: readonly Pick<GroupRef, 'id' | 'name'>[], members: Readonly<Record<string, readonly GroupRow[]>>): MemberIndex {
  const index: MemberIndex = new Map();
  for (const g of groups) for (const m of members[g.id] ?? []) {
    if (m.ends_at != null) continue;
    const list = index.get(m.user_id) ?? [];
    if (!list.some(x => x.id === g.id)) list.push({ id: g.id, name: g.name });
    index.set(m.user_id, list);
  }
  return index;
}
/** Groups of one course a student may be put into after approval: active and run by this teacher, by name. */
export const approvalGroups = (groups: readonly GroupRef[], offeringId: string) =>
  teacherGroups(groups).filter(g => g.offering_id === offeringId && g.status === 'active').sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

// ---- Join requests
export const pending = (rows: readonly RequestRow[]) => rows.filter(r => r.status === 'pending');
export const oldestFirst = <T extends Pick<RequestRow, 'created_at' | 'id'>>(rows: readonly T[]) => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
export type ApproveOutcome = 'approved' | 'approved_not_added' | 'failed';
/** What the teacher is told after "approve into a Group": the approval and the Group step are separate, and one never undoes the other. */
export const approveOutcome = (approved: boolean, added: boolean | null): ApproveOutcome => !approved ? 'failed' : added === false ? 'approved_not_added' : 'approved';

// ---- Join links: the secret is made in the browser, shown once, and only its hash is stored.
export const LINK_DAYS = [1, 3, 7, 14, 21] as const;
export const DEFAULT_LINK_DAYS = 7;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** 32 random bytes as 43 base64url characters, the form the database requires. The bytes must come from crypto.getRandomValues. */
export function tokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('Expected 32 random bytes');
  let out = '';
  for (let i = 0; i < 30; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const n = (bytes[30] << 16) | (bytes[31] << 8);
  return out + B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
}
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const linkExpiry = (now: number, days: number) => new Date(now + days * 86_400_000).toISOString();
export const joinPath = (token: string) => `/join/${token}`;
export const activeLinks = (rows: readonly LinkRow[], now: number) => rows.filter(l => l.kind === 'request' && l.revoked_at == null && Date.parse(l.expires_at) > now);

// ---- Attendance on a student's page
export type HistoryRow = { user_id: string; status: string; session_id: string; title: string; starts_at: string; display_name?: string | null };
export type AttendanceEntry = { sessionId: string; groupId: string; groupName: string; title: string; startsAt: string; status: 'attended' | 'absent' };
export function attendanceEntries(byGroup: Readonly<Record<string, { name: string; rows: readonly HistoryRow[] }>>, userId: string): AttendanceEntry[] {
  const out: AttendanceEntry[] = [];
  for (const [groupId, g] of Object.entries(byGroup)) for (const r of g.rows) {
    if (r.user_id !== userId || (r.status !== 'attended' && r.status !== 'absent')) continue;
    out.push({ sessionId: r.session_id, groupId, groupName: g.name, title: r.title, startsAt: r.starts_at, status: r.status });
  }
  return out.sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.sessionId.localeCompare(b.sessionId));
}
export const attendanceCounts = (entries: readonly AttendanceEntry[]) => ({ attended: entries.filter(e => e.status === 'attended').length, absent: entries.filter(e => e.status === 'absent').length });
