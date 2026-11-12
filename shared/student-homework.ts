// The student homework screen: what get_homework adds for the new workflow, and the refusals a student can meet, in plain words.
// Pure: shared by the server mapping (server/services/homework.ts), the screen and the tests. No React, no I/O.
import type { HomeworkAnswer, HomeworkSubmission, HomeworkView } from '@/shared/contracts/homework';

/** get_homework for a student of a questions homework: the deadline, the tries, and whether a new try can start. */
export type StudentHomeworkView = HomeworkView & {
  workflow?: 'legacy' | 'questions'; deadline?: string | null; deadlinePassed?: boolean; triesUsed?: number; triesLeft?: number | null;
  canStart?: boolean; canRetry?: boolean; triesEnded?: boolean;
};
export type StudentAnswer = HomeworkAnswer & { kept?: boolean };
export type StudentSubmission = HomeworkSubmission & { missedDeadline?: boolean };

/** The refusals a student can meet, by the reason the database names (or the message it raises when it names none). */
export type StudentReason = 'deadline_passed' | 'no_tries_left' | 'stale' | 'submitted' | 'unavailable';
export const STUDENT_REASONS: readonly StudentReason[] = ['deadline_passed', 'no_tries_left', 'stale', 'submitted', 'unavailable'];
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
  if (error.code === '42501' && /^(Homework unavailable|Active enrollment required|Enrollment expired)/.test(error.message ?? '')) return 'unavailable';
  return null;
}
/** The English the route sends with the reason (the screen shows its own language from the reason). */
export const studentReasonText: Record<StudentReason, string> = {
  deadline_passed: 'The deadline has passed', no_tries_left: 'No tries left', stale: 'Homework changed. Reload before saving.',
  submitted: 'This try was already handed in. Reload to see it.', unavailable: 'Homework unavailable or permission denied',
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
    triesEnded: Boolean(questions && view.triesEnded),
  };
}
/** A kept answer (fix mistakes) is locked: the student cannot change it in the new try. */
export const answerKept = (answer: HomeworkAnswer | undefined) => Boolean((answer as StudentAnswer | undefined)?.kept);
