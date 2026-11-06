import type { MessageKey } from '@/frontend/locales/messages';
import type { Refusal } from '@/shared/course-content';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;
export type CountNoun = 'chapter' | 'lesson' | 'part' | 'item' | 'cover' | 'homework';

/** Arabic has four forms for a count (1, 2, 3 to 10, 11 and up). English needs two, and the same four keys. */
export const countForm = (n: number) => n === 1 ? 'one' : n === 2 ? 'two' : n >= 3 && n <= 10 ? 'few' : 'many';
export const countWord = (t: T, noun: CountNoun, n: number) => t(`tc.content.count.${noun}.${countForm(n)}` as MessageKey, { n });

/** "A, B and C", or in Arabic "A وB وC". */
export function joinWords(t: T, words: string[]) {
  if (words.length < 2) return words.join('');
  return words.slice(0, -1).join(t('tc.content.comma')) + t('tc.content.and') + words[words.length - 1];
}

/** The sentences that say why something stays, from the reasons and the counts. The same words before the teacher tries and after a refusal. */
export function refusalSentences(t: T, refusal: Refusal, scope: 'lesson' | 'chapter'): string[] {
  const has = (reason: string) => refusal.reasons.includes(reason);
  const inside: string[] = [];
  if (has('homework')) inside.push(refusal.homework ? countWord(t, 'homework', refusal.homework) : t('tc.content.some_homework'));
  if (has('parts')) inside.push(refusal.parts ? countWord(t, 'part', refusal.parts) : t('tc.content.some_parts'));
  if (has('content')) {
    if (refusal.contentBlocks) inside.push(countWord(t, 'item', refusal.contentBlocks));
    if (refusal.covers) inside.push(countWord(t, 'cover', refusal.covers));
    if (!refusal.contentBlocks && !refusal.covers) inside.push(t('tc.content.some_content'));
  }
  const sentences: string[] = [];
  if (has('student_work')) sentences.push(t(`tc.content.reason.student_work.${scope}`));
  if (has('student_progress')) sentences.push(t(`tc.content.reason.student_progress.${scope}`));
  if (inside.length) sentences.push(t(`tc.content.reason.inside.${scope}`, { inside: joinWords(t, inside) }));
  if (has('in_use') || !sentences.length) sentences.push(t(`tc.content.reason.in_use.${scope}`));
  sentences.push(t('tc.content.reason.keep'));
  return sentences;
}
