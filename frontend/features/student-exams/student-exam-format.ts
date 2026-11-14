import type { StudentExamView, StudentRow } from '@/shared/exams-student';

/** A moment in Cairo time, in the page's language: "Sat 14 Nov, 6:00 pm". Digits follow the language. */
export function whenText(iso: string | null, language: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
export function dayText(day: string | null, language: string) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T00:00:00Z`));
}
/** The score as "7 / 12" (digits follow the language). */
export const scoreText = (score: number | null, max: number | null, number: (n: number) => string) => score === null || max === null ? '' : `${number(score)} / ${number(max)}`;
export type Titled = Pick<StudentRow | StudentExamView, 'title' | 'courseTitle'>;
