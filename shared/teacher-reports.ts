// Reports, spread into the Groups, Students and Course pages: pure rules for the screens (month choices, reasons, reply mapping).
// The numbers themselves come from the database (migration 20261117120000_reports.sql); nothing here counts.
import type { Reason } from '@/shared/contracts/teacher-reports';

/** Every month, day and boundary is a Cairo calendar month: the zone the app already uses for Group sessions. */
export const REPORT_TIME_ZONE = 'Africa/Cairo';

/** The Cairo month ('YYYY-MM') an instant falls in. */
export function cairoMonth(at: number | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** The month picker: this month first, then every earlier month back to the first one the course has, newest first, and the whole course last. */
export const MAX_MONTHS = 36;
export function monthChoices(firstMonth: string | null | undefined, now: number): string[] {
  const current = cairoMonth(now);
  const out = [current];
  const first = firstMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth) && firstMonth < current ? firstMonth : current;
  let [y, m] = current.split('-').map(Number);
  while (out.length < MAX_MONTHS) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key < first) break;
    out.push(key);
  }
  out.push('all');
  return out;
}
/** A month as a date the language provider can print as "November 2026" (the first day, at noon, so no zone moves it). */
export const monthDate = (month: string) => `${month}-15T12:00:00Z`;

/** The words for one reason. Each key has English and Arabic text in the locale files. */
export function reasonWords(reason: Reason): { id: string; values: Record<string, string | number> } {
  switch (reason.code) {
    case 'missed_sessions': return { id: reason.n === 1 ? 'rp.reason.missed_one' : 'rp.reason.missed', values: { count: reason.n } };
    case 'homework_missing': return { id: reason.n === 1 ? 'rp.reason.homework_one' : 'rp.reason.homework', values: { count: reason.n } };
    case 'exams_low': return { id: 'rp.reason.exams', values: { pct: reason.pct } };
    case 'exam_absent': return { id: 'rp.reason.absent', values: { title: reason.title } };
  }
}

/** What a failed read means for the person (same kinds as the Groups screens). */
export function reportFailure(status: number | null): 'signin' | 'denied' | 'invalid' | 'unavailable' {
  return status === 401 ? 'signin' : status === 403 || status === 404 ? 'denied' : status === 400 || status === 413 || status === 415 ? 'invalid' : 'unavailable';
}

/** Database error to reply: 42501 is no, 23514 a bad month or page, everything else is "try again". Never the database's message. */
export function reportReply(error: { code?: string }): { status: number; body: { kind: string } } {
  const code = error.code ?? '';
  if (code === '42501' || code === 'PGRST116') return { status: 403, body: { kind: 'denied' } };
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return { status: 400, body: { kind: 'invalid' } };
  return { status: 503, body: { kind: 'failed' } };
}

/** A percent for a bar: whole numbers, never past 100, never negative. */
export const barWidth = (pct: number | null) => pct === null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
/** The Needs attention rule, for the words that explain it. Fixed for V1 (DECISIONS.md, "Reports"). */
export const ATTENTION_RULE = { attendanceBelow: 75, homeworkMissing: 2, examsBelow: 50 } as const;
