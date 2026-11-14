import { z } from 'zod';

/**
 * What the teacher Reports routes accept, and what the database functions answer with (migration 20261117120000_reports.sql).
 * Strict: an unknown parameter is refused. The caller is never named (the server uses the signed-in identity); the database authorizes every read again.
 * A month is a Cairo calendar month 'YYYY-MM' or 'all' (the whole course); nothing means this month.
 */
const id = z.string().uuid();
export const reportMonth = z.union([z.literal('all'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]);
const page = z.coerce.number().int().min(0).max(100000);

/** The Groups list sends the Group ids of the page it shows, comma separated (at most 100, each once). */
export const GROUPS_PER_READ = 100;
// The check runs on the string (a failed pattern can still reach a later step), then the ids are split.
const idList = (v: string) => { const ids = v.split(','); return ids.every(x => id.safeParse(x).success) && new Set(ids).size === ids.length; };
export const groupsQuery = z.object({
  groups: z.string().regex(/^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,99}$/).refine(idList),
}).strict().transform(q => q.groups.split(','));
export const groupReportQuery = z.object({ month: reportMonth.optional() }).strict();
/** `course` is the run the screens call a course (the Students screens carry it as ?course=). */
export const attentionQuery = z.object({ course: id.optional(), page: page.default(0) }).strict();
export const studentReportQuery = z.object({ course: id, month: reportMonth.optional() }).strict();
export const courseReportQuery = z.object({ month: reportMonth.optional() }).strict();

export type Pct = number | null;
export type ReportRange = { month: string; timezone: 'Africa/Cairo'; from: string; to: string };
/** A reason a student needs attention, as the database counts it. The screen words it (en and ar). */
export type Reason =
  | { code: 'missed_sessions'; n: number }
  | { code: 'homework_missing'; n: number }
  | { code: 'exams_low'; pct: number }
  | { code: 'exam_absent'; title: string };
export type Ratio = { pct: Pct; present?: number; total?: number; done?: number; given?: number; count?: number };

export type GroupNumbers = {
  groupId: string; hasNumbers: boolean;
  attendance: { pct: Pct; present: number; total: number };
  homework: { pct: Pct; done: number; given: number };
  exams: { pct: Pct; count: number };
  attention: number;
};
export type GroupsReport = ReportRange & { groups: GroupNumbers[] };

export type StudentLine = {
  userId: string; name: string;
  attendance: { pct: Pct; present: number; total: number };
  homework: { done: number; given: number; missing: number };
  exams: { pct: Pct; count: number; absent: number };
  reasons: Reason[];
};
export type GroupReport = ReportRange & {
  firstMonth: string;
  group: { id: string; name: string };
  pace: { reached: { chapter: number; lesson: number; lessonId: string; label: string } | null; homeworkGiven: number };
  summary: { attendance: { pct: Pct; sessions: number }; homework: { pct: Pct; given: number }; exams: { pct: Pct; count: number } };
  attentionTotal: number; attention: StudentLine[]; everyoneTotal: number; everyone: StudentLine[];
};

export type AttentionRow = { userId: string; name: string; offeringId: string; courseTitle: string; group: { id: string; name: string } | null; reasons: Reason[] };
export type AttentionReport = ReportRange & { page: number; pageSize: number; total: number; rows: AttentionRow[] };

export type SessionMark = { id: string; groupId: string | null; day: number; date: string; state: 'present' | 'absent' };
export type HomeworkLine = { id: string; title: string; groupId: string | null; state: 'done' | 'missing' | 'due'; score: number | null; max: number | null; detail: 'released' | 'waiting' | null; dueAt: string };
export type ExamLine = { id: string; title: string; groupId: string | null; state: 'marked' | 'waiting' | 'absent'; score: number | null; max: number | null; kind: 'online' | 'paper'; at: string };
export type StudentReport = ReportRange & {
  firstMonth: string | null; groups: { id: string; name: string }[];
  attendance: { pct: Pct; present: number; total: number };
  homework: { done: number; given: number; missing: number; avgPct: Pct };
  exams: { pct: Pct; count: number; absent: number };
  sessions: SessionMark[]; homeworkList: HomeworkLine[]; examList: ExamLine[];
};

export type ChapterResult = { id: string; number: number; title: string; exams: number; homework: number; pct: Pct; weakest: boolean; groups: { groupId: string | null; pct: Pct; marks: number }[] };
export type CourseReport = ReportRange & { firstMonth: string | null; groups: { id: string; name: string }[]; chapters: ChapterResult[] };
