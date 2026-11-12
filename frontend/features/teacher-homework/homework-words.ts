import type { MessageKey } from '@/frontend/locales/messages';
import { countForm } from '@/frontend/features/teacher-course/content-words';
import { homeworkFailure, type HomeworkFailure, type Tries } from '@/shared/teacher-homework';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;
export type Outcome<B> = { ok: true; body: B } | { ok: false; failure: HomeworkFailure };

/** One request to the teacher Homework routes. No reply is an unknown outcome, never a plain failure. */
export async function homeworkCall<B>(url: string, body?: unknown): Promise<Outcome<B>> {
  let response: Response;
  try { response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { return { ok: false, failure: { kind: 'unknown' } }; }
  const parsed = await response.json().catch(() => null) as unknown;
  return response.ok && parsed !== null ? { ok: true, body: parsed as B } : { ok: false, failure: homeworkFailure(response.ok ? null : response.status, parsed) };
}

const reasons: Record<string, MessageKey> = {
  started: 'hw.fail.started', still_open: 'hw.fail.still_open', no_deadline: 'hw.fail.no_deadline', deadline_past: 'hw.fail.deadline_past', keys: 'hw.fail.keys',
  versioned: 'hw.fail.versioned', other_space: 'hw.fail.other_space', model_image: 'hw.fail.model_image', photos_off: 'hw.fail.photos_off', tries: 'hw.fail.tries', media: 'hw.fail.media', legacy: 'hw.fail.legacy',
};
const kinds: Record<HomeworkFailure['kind'], MessageKey> = {
  signin: 'tc.error.signin', denied: 'hw.fail.denied', changed: 'hw.fail.changed', too_large: 'hw.fail.too_large', failed: 'hw.fail.failed', unknown: 'tc.error.unknown', refused: 'hw.fail.denied', invalid: 'hw.fail.invalid',
};
/** A failure in plain words: the reason the database named when there is one, otherwise what kind of failure it was. */
export function failureWords(t: T, failure: HomeworkFailure) {
  const reason = 'reason' in failure && failure.reason ? reasons[failure.reason] : undefined;
  return t(reason ?? kinds[failure.kind]);
}
/** "3 questions", "1 mark", in the four count forms Arabic needs. */
export const countText = (t: T, noun: 'question' | 'mark' | 'essay' | 'choice', n: number) => t(`hw.count.${noun}.${countForm(n)}` as MessageKey, { n });
export function triesText(t: T, tries: Tries, maxTries: number) {
  return tries === 'one_time' ? t('hw.tries.one_time') : t(tries === 'fix_mistakes' ? 'hw.tries.fix' : 'hw.tries.zero', { n: maxTries });
}
