import { examReply } from '@/shared/teacher-exams';

/**
 * Student exams: what the database returns to a student, and the small rules the screens need. The database decides everything that
 * matters (the window, the clock, the tries, what is kept, what may be seen); nothing here grants anything, and the order of a try is the
 * database's (the try's stored items), never reordered here.
 */
export type StudentWindow = { opensAt: string | null; closesAt: string | null; state: 'ok' | 'cancelled' | 'needs_time' | 'none'; groupId?: string | null };
export type StudentResult = { score: number | null; maxScore: number | null; absent: boolean } | null;
export type StudentRow = {
  id: string; title: string; kind: 'online' | 'paper'; status: 'published' | 'archived'; courseId: string; courseTitle: string; offeringId: string;
  heldOn: string | null; timeLimitMinutes: number | null; tries: 'one_time' | 'fix_mistakes' | 'from_zero' | null;
  window: StudentWindow | null; tryState: 'not_started' | 'in_progress' | 'submitted'; result: StudentResult;
};
export type StudentList = { serverNow: string; rows: StudentRow[] };

export type StudentTry = { id: string; number: 1 | 2; status: 'in_progress' | 'submitted'; startedAt: string; deadlineAt: string; submittedAt: string | null; autoSubmitted: boolean; revision: number };
export type StudentExamView = {
  id: string; title: string; description: string; kind: 'online' | 'paper'; status: 'published' | 'archived'; courseId: string; courseTitle: string; offeringId: string;
  maxMarks: number | null; heldOn: string | null; timing: 'per_group' | 'same_time' | null; timeLimitMinutes: number | null; rule: 'one_time' | 'fix_mistakes' | 'from_zero' | null;
  photosAllowed: boolean; questionCount: number; totalPoints: number; serverNow: string; lastClose: string | null; closed: boolean; reviewOpen: boolean; staff: false;
  window: StudentWindow | null; tries: StudentTry[];
  result: { waiting: true } | { score: number | null; maxScore: number | null; absent: boolean; releasedAt: string | null } | null;
  attempt?: StudentAttempt;
};
export type StudentExamRead = StudentExamView;

export type StudentOption = { id: string; text: string };
export type StudentAnswer = { optionIds: string[] | null; numberValue: number | null; text: string | null; uploadId: string | null; kept: boolean; savedAt: string | null };
export type StudentItem = {
  id: string; position: number; type: 'single_choice' | 'multiple_choice' | 'number' | 'essay'; text: string; imageId: string | null; points: number; responseMode: 'text' | 'photo' | 'both';
  options: StudentOption[]; answer: StudentAnswer | null; mark: { points: number | null; auto: boolean; note: string } | null;
  /** Only when answer review is open: the keys. */
  correctOptionIds?: string[]; numberValue?: number | null; tolerance?: number; modelText?: string; modelImageId?: string | null;
};
export type StudentAttempt = StudentTry & { items: StudentItem[]; serverNow: string };

/** The server's clock as this browser sees it: the offset to add to Date.now() to get the database's time. */
export const clockOffset = (serverNow: string, receivedAt: number) => { const t = Date.parse(serverNow); return Number.isFinite(t) ? t - receivedAt : 0; };
/** Whole seconds left until a deadline on the server's clock (never negative). */
export const secondsLeft = (deadlineAt: string, offset: number, now: number) => Math.max(0, Math.ceil((Date.parse(deadlineAt) - (now + offset)) / 1000));
/** 1:05:09 or 31:05, from seconds. */
export function clockText(total: number) {
  const s = Math.max(0, Math.floor(total)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

/** What the student has put in one question so far (typed text stays text until it is saved). */
export type Draft = { optionIds: string[]; number: string; text: string; uploadId: string | null };
export const draftOf = (item: StudentItem): Draft => ({
  optionIds: item.answer?.optionIds ?? [], number: item.answer?.numberValue === null || item.answer?.numberValue === undefined ? '' : String(item.answer.numberValue),
  text: item.answer?.text ?? '', uploadId: item.answer?.uploadId ?? null,
});
/** Answered: a picked option, a number that reads as a number, some text or a photo. */
export function isAnswered(item: Pick<StudentItem, 'type'>, draft: Draft | undefined, parse: (raw: string) => number | null) {
  if (!draft) return false;
  if (item.type === 'number') return parse(draft.number) !== null;
  if (item.type === 'essay') return draft.text.trim() !== '' || draft.uploadId !== null;
  return draft.optionIds.length > 0;
}
/** The question numbers (1-based, in the try's order) that have no answer. */
export const unanswered = (items: StudentItem[], drafts: Record<string, Draft>, parse: (raw: string) => number | null) =>
  items.flatMap((item, i) => isAnswered(item, drafts[item.id], parse) ? [] : [i + 1]);

/** Which part of the list an exam belongs to, for this student, on the server's clock. */
export type ListSection = 'open' | 'upcoming' | 'waiting' | 'results' | 'closed';
export function sectionOf(row: StudentRow, serverNow: number): ListSection {
  if (row.result) return 'results';
  const w = row.window, opens = w?.opensAt ? Date.parse(w.opensAt) : NaN, closes = w?.closesAt ? Date.parse(w.closesAt) : NaN;
  if (row.kind === 'paper') return 'waiting';
  if (row.tryState === 'in_progress') return 'open';
  if (row.tryState === 'submitted') return 'waiting';
  if (w?.state === 'ok' && Number.isFinite(opens) && Number.isFinite(closes)) {
    if (serverNow < opens) return 'upcoming';
    if (serverNow < closes) return 'open';
  }
  return 'closed';
}
export const SECTIONS: ListSection[] = ['open', 'upcoming', 'waiting', 'results', 'closed'];

/** A second try is offered inside the student's own window, when the first is handed in, the rule allows it and none was taken. */
export function canRetry(view: Pick<StudentExamView, 'rule' | 'tries' | 'window' | 'kind'>, serverNow: number) {
  if (view.kind !== 'online' || !view.rule || view.rule === 'one_time' || view.tries.length !== 1) return false;
  const first = view.tries[0], w = view.window;
  return first.status === 'submitted' && w?.state === 'ok' && !!w.opensAt && !!w.closesAt && serverNow >= Date.parse(w.opensAt) && serverNow < Date.parse(w.closesAt);
}
export function canStart(view: Pick<StudentExamView, 'tries' | 'window' | 'kind' | 'status'>, serverNow: number) {
  const w = view.window;
  return view.kind === 'online' && view.status === 'published' && view.tries.length === 0 && w?.state === 'ok' && !!w.opensAt && !!w.closesAt && serverNow >= Date.parse(w.opensAt) && serverNow < Date.parse(w.closesAt);
}

/**
 * The reply mapper for the student routes: the teacher mapper's codes, plus the words the student functions use (a kept answer, a question
 * that takes a photo, a choice that is not one of the options, a photo that is not there). Reasons are the database's, said once here.
 */
type DatabaseError = { code?: string | null; message?: string | null; details?: string | null };
const byMessage: [RegExp, string][] = [
  [/^This answer is kept/, 'answer_kept'], [/^This question takes a photo/, 'takes_photo'], [/^This question takes text/, 'takes_text'], [/^Photo unavailable/, 'photo_unavailable'],
  [/^Invalid choice/, 'bad_choice'], [/^Invalid answer/, 'bad_answer'], [/^Start the exam first/, 'start_first'], [/^Invalid (start|submit)/, 'bad_answer'],
];
export function studentReply(error: DatabaseError) {
  const reply = examReply(error);
  const body = reply.body as { kind: string; reason?: string; questions?: number[] };
  if ((body.kind === 'invalid' || body.kind === 'refused') && !body.reason) {
    const reason = byMessage.find(([pattern]) => pattern.test(error.message ?? ''))?.[1];
    if (reason) return { status: reply.status, body: { ...body, reason } };
  }
  if (body.kind === 'refused' && body.reason === 'in_use' && /^Photo unavailable/.test(error.message ?? '')) return { status: reply.status, body: { ...body, reason: 'photo_unavailable' } };
  return reply;
}
/** Every reason a student route can answer with; each has words (se.fail.<reason>). */
export const STUDENT_REASONS = [
  'stale', 'deadline_passed', 'not_open', 'no_window', 'needs_time', 'no_tries_left', 'started', 'answer_kept', 'takes_photo', 'takes_text', 'photo_unavailable', 'bad_choice', 'bad_answer', 'start_first',
  'photos_off', 'uploads_pending', 'file_type', 'shape', 'in_use',
] as const;
