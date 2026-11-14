import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { homeworkCall, type Outcome } from '@/frontend/features/teacher-homework/homework-words';
import { EXAM_REASONS, type ExamFailure, type ExamTries } from '@/shared/teacher-exams';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;
export type { Outcome };
export const EXAMS_API = '/api/teacher/exams';
/** One request to the teacher Exams routes (the same reading as Homework's: no reply is an unknown outcome, never a plain failure). */
export const examCall = <B,>(url: string, body?: unknown): Promise<Outcome<B>> => homeworkCall<B>(url, body);

const kinds: Record<ExamFailure['kind'], MessageKey> = {
  signin: 'tc.error.signin', denied: 'ex.fail.denied', changed: 'ex.fail.changed', too_large: 'ex.fail.too_large', failed: 'ex.fail.failed', unknown: 'tc.error.unknown', refused: 'ex.fail.denied', invalid: 'ex.fail.invalid',
};
const known = new Set<string>(EXAM_REASONS);
/** A failure in plain words: the reason the database named (every one has words: ex.fail.<reason>), otherwise what kind of failure it was. */
export function examFailureWords(t: T, failure: ExamFailure) {
  const reason = 'reason' in failure && failure.reason && known.has(failure.reason) ? `ex.fail.${failure.reason}` as MessageKey : null;
  if (reason === 'ex.fail.unfinished_questions' && 'questions' in failure && failure.questions) return t(reason, { list: failure.questions.join(', ') });
  return t(reason ?? kinds[failure.kind]);
}
/** "3 students", "1 essay": the four count forms Arabic needs. */
export const examCount = (t: T, noun: 'student' | 'essay' | 'question' | 'mark' | 'minute' | 'group', n: number) => t(`ex.count.${noun}.${countForm(n)}` as MessageKey, { n });
export const triesWords = (t: T, tries: ExamTries | null) => t(tries === 'fix_mistakes' ? 'ex.tries.fix' : tries === 'from_zero' ? 'ex.tries.zero' : 'ex.tries.one');
/** "1 h 05 min" or "25 min". */
export function durationWords(t: T, minutes: number, number: (n: number) => string) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h && m ? t('ex.duration.hm', { h: number(h), m: number(m) }) : h ? t('ex.duration.h', { h: number(h) }) : t('ex.duration.m', { m: number(m) });
}
