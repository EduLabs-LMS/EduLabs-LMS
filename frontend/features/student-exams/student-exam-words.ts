import type { MessageKey } from '@/frontend/locales/messages';
import { homeworkCall, type Outcome } from '@/frontend/features/teacher-homework/homework-words';
import { STUDENT_REASONS } from '@/shared/exams-student';
import type { HomeworkFailure } from '@/shared/teacher-homework';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;
export type { Outcome };
export type Failure = HomeworkFailure;
export const STUDENT_EXAMS_API = '/api/exams';
/** One request to the student Exams routes: no reply is an unknown outcome (it may have been saved), never a plain failure. */
export const studentCall = <B,>(url: string, body?: unknown): Promise<Outcome<B>> => homeworkCall<B>(url, body);

const kinds: Record<HomeworkFailure['kind'], MessageKey> = {
  signin: 'tc.error.signin', denied: 'se.fail.denied', changed: 'se.fail.stale', too_large: 'se.fail.too_large', failed: 'se.fail.failed', unknown: 'se.fail.unknown', refused: 'se.fail.denied', invalid: 'se.fail.invalid',
};
const known = new Set<string>(STUDENT_REASONS);
/** A refusal in plain words: the reason the database named (every one has words: se.fail.<reason>), otherwise what kind of failure it was. */
export function studentFailureWords(t: T, failure: Failure) {
  const reason = 'reason' in failure && failure.reason && known.has(failure.reason) ? `se.fail.${failure.reason}` as MessageKey : null;
  return t(reason ?? kinds[failure.kind]);
}
/** True when the outcome says nothing was reached (no connection, or the server could not answer): the answer stays on screen and is tried again. */
export const isOffline = (failure: Failure) => failure.kind === 'unknown' || failure.kind === 'failed';
