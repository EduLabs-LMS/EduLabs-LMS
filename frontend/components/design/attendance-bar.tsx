'use client';
import { useLanguage } from '@/frontend/components/language-provider';

/** How many marked Sessions a student came to, as a bar and as numbers. The sentence is for screen readers. With nothing marked there is no bar to show: a dash, never a 0%. */
export function AttendanceBar({ attended, total, ...rest }: { attended: number; total: number } & { [name: `data-${string}`]: string | undefined }) {
  const { t, number } = useLanguage();
  if (!total) return <span className="d-bar-empty" {...rest}><span aria-hidden>—</span><span className="sr-only">{t('ts.students.attendance_none')}</span></span>;
  return <span role="img" aria-label={t('ts.students.attendance_of', { attended: number(attended), total: number(total) })} className="d-bar-wrap" {...rest}>
    <span aria-hidden className="d-bar"><span className="d-bar-fill" style={{ width: `${Math.round(Math.min(attended / total, 1) * 100)}%` }} /></span>
    <span aria-hidden className="d-bar-text"><bdi dir="ltr">{number(attended)}/{number(total)}</bdi></span>
  </span>;
}
