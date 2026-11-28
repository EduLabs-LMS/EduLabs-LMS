// The student homework screen: what get_homework adds for the new workflow, and the refusals a student can meet, in plain words.
// Pure: shared by the server mapping (server/services/homework.ts), the screen and the tests. No React, no I/O.
import type { HomeworkAnswer, HomeworkSubmission, HomeworkView } from '@/shared/contracts/homework';

/** get_homework for a student of a questions homework: the deadline, the tries, and whether a new try can start. */
export type StudentHomeworkView = HomeworkView & {
  workflow?: 'legacy' | 'questions'; deadline?: string | null; deadlinePassed?: boolean; triesUsed?: number; triesLeft?: number | null;
  canStart?: boolean; canRetry?: boolean; triesEnded?: boolean;
  /** The student chose "I'm done, show me the answers" (owner, 2026-11-27): no more tries, the answers are open. */
  stopped?: boolean; canStop?: boolean; solutionsOpen?: boolean;
  /** Only while the caller's draft, started before the deadline, is inside its 30-minute grace (owner, 2026-11-17): hand in by then, on time. */
  graceUntil?: string;
};
export type StudentAnswer = HomeworkAnswer & { kept?: boolean };
/** Before the teacher releases an essay, the student already sees the questions that mark themselves (20261127130000). */
export type SelfMarked = { score: number; max: number; essays: number; marks: { questionId: string; points: number | null }[] };
export type StudentSubmission = HomeworkSubmission & { missedDeadline?: boolean; correction?: HomeworkSubmission['correction'] & { selfMarked?: SelfMarked } };

/** The refusals a student can meet, by the reason the database names (or the message it raises when it names none). */
export type StudentReason = 'deadline_passed' | 'no_tries_left' | 'stale' | 'submitted' | 'unavailable' | 'too_many_uploads';
export const STUDENT_REASONS: readonly StudentReason[] = ['deadline_passed', 'no_tries_left', 'stale', 'submitted', 'unavailable', 'too_many_uploads'];
type DatabaseError = { code?: string | null; message?: string | null; details?: string | null };
export function studentHomeworkReason(error: DatabaseError | null | undefined): StudentReason | null {
  if (!error) return null;
  let detail: unknown = null;
  try { detail = JSON.parse(error.details ?? ''); } catch { detail = null; }
  const named = detail && typeof detail === 'object' ? (detail as { reason?: unknown }).reason : null;
  if (error.code === 'PT409') {
    if (named === 'deadline_passed' || named === 'no_tries_left') return named;
    if (/^Submitted work is immutable/.test(error.message ?? '')) return 'submitted';
    if (/(Homework|Answers) changed; reload/.test(error.message ?? '')) return 'stale';
    return null;
  }
  if (error.code === '23514' && named === 'too_many_uploads') return named;
  if (error.code === '42501' && /^(Homework unavailable|Active enrollment required|Enrollment expired)/.test(error.message ?? '')) return 'unavailable';
  return null;
}
/** The English the route sends with the reason (the screen shows its own language from the reason). */
export const studentReasonText: Record<StudentReason, string> = {
  deadline_passed: 'The deadline has passed', no_tries_left: 'No tries left', stale: 'Homework changed. Reload before saving.',
  submitted: 'This try was already handed in. Reload to see it.', unavailable: 'Homework unavailable or permission denied',
  too_many_uploads: 'Too many photos; remove some first',
};
export const isStudentReason = (value: unknown): value is StudentReason => typeof value === 'string' && (STUDENT_REASONS as readonly string[]).includes(value);

/** What the screen says about the rules of a questions homework. Nothing for an older homework (no deadline, no tries). */
export function studentFacts(view: StudentHomeworkView, submission: StudentSubmission | null) {
  const questions = view.workflow === 'questions';
  return {
    deadline: questions && view.deadline ? view.deadline : null,
    triesLeft: questions && typeof view.triesLeft === 'number' ? view.triesLeft : null,
    missed: Boolean(submission?.status === 'submitted' && submission.missedDeadline),
    canRetry: Boolean(questions && view.canRetry && submission?.status === 'submitted'),
    canStop: Boolean(questions && view.canStop && submission?.status === 'submitted'),
    stopped: Boolean(questions && view.stopped),
    triesEnded: Boolean(questions && view.triesEnded),
  };
}

/** What a handed-in try shows (owner, 2026-11-27): a self-marked mark at once; an essay waits for the teacher; the total after the release.
 *  mark(questionId) is the points shown beside a question (null: not shown, or waiting for the teacher). */
export function studentResult(view: Pick<HomeworkView, 'definition'>, submission: StudentSubmission | null) {
  const questions = view.definition.questions, correction = submission?.status === 'submitted' ? submission.correction : undefined;
  const max = questions.reduce((sum, q) => sum + (q.points ?? 0), 0);
  if (!correction) return { state: 'none' as const, score: null, max, selfScore: null, selfMax: null, essays: 0, mark: (_id: string): number | null => null };
  if (correction.released) {
    const marks = new Map(correction.marks.map(m => [m.questionId, m.points]));
    return { state: 'released' as const, score: correction.score, max, selfScore: null, selfMax: null, essays: 0, mark: (id: string) => marks.get(id) ?? null };
  }
  const self = correction.selfMarked;
  const marks = new Map((self?.marks ?? []).map(m => [m.questionId, m.points]));
  return { state: self && self.essays > 0 ? 'essays_waiting' as const : 'waiting' as const, score: null, max, selfScore: self ? self.score : null, selfMax: self ? self.max : null,
    essays: self?.essays ?? 0, mark: (id: string) => marks.get(id) ?? null };
}

/** When the answers open for this student (owner's rule B): already open; after the hand-in; or after the last try / "I'm done". */
export function solutionsWhen(view: StudentHomeworkView, submission: StudentSubmission | null): 'open' | 'after_hand_in' | 'after_tries' {
  if (view.solutions) return 'open';
  return submission?.status === 'submitted' && view.workflow === 'questions' ? 'after_tries' : 'after_hand_in';
}
/** A kept answer (fix mistakes) is locked: the student cannot change it in the new try. */
export const answerKept = (answer: HomeworkAnswer | undefined) => Boolean((answer as StudentAnswer | undefined)?.kept);
