'use client';
import { useMemo } from 'react';
import { Select } from '@/frontend/components/design/controls';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { Pct, Reason } from '@/shared/contracts/teacher-reports';
import { barWidth, monthChoices, monthDate, reasonWords } from '@/shared/teacher-reports';

/** A percent as the person reads it ("91%", "٩١٪"), or a dash when there is nothing to count. */
export function usePct() {
  const { t, number } = useLanguage();
  return (pct: Pct) => pct === null ? t('rp.dash') : t('rp.pct', { count: number(Math.round(pct)) });
}

/** One bar, never colour alone: the percent is printed next to it by the caller. Under 50% it takes the warning tone. */
export function ReportBar({ pct }: { pct: Pct }) {
  return <span className="d-rp-bar" aria-hidden="true" data-low={pct !== null && pct < 50 ? 'true' : undefined}><span style={{ width: `${barWidth(pct)}%` }} /></span>;
}

/** Plain-word reasons, worst first as the database ordered them. */
export function Reasons({ reasons }: { reasons: Reason[] }) {
  const { t } = useLanguage();
  return <span className="d-rp-reasons" data-reasons>{reasons.map((r, i) => {
    const w = reasonWords(r);
    return <StatusPill key={i} tone="warning"><bdi>{t(w.id as Parameters<typeof t>[0], w.values)}</bdi></StatusPill>;
  })}</span>;
}

/** This month (the default, null), any earlier month, or the whole course. Months follow Cairo time, and the picker says so. */
export function MonthPicker({ value, firstMonth, onChange }: { value: string | null; firstMonth: string | null | undefined; onChange: (month: string | null) => void }) {
  const { t, language } = useLanguage();
  const now = useMemo(() => Date.now(), []);
  const choices = useMemo(() => monthChoices(firstMonth, now), [firstMonth, now]);
  const options = choices.map(m => ({ value: m, label: m === 'all' ? t('rp.month.whole') : <bdi>{new Date(monthDate(m)).toLocaleDateString(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</bdi> }));
  return <div className="d-rp-head" data-month-picker>
    <label className="d-field-label"><span className="d-meta"><L id="rp.month.label" /></span>
      <Select aria-label={t('rp.month.label')} value={value ?? choices[0]} onChange={v => onChange(v === choices[0] ? null : v)} options={options} />
    </label>
    <p className="d-meta"><L id="rp.zone_note" /></p>
  </div>;
}

export function Stat({ label, value, sub, ...rest }: { label: string; value: string; sub: string } & { [k: `data-${string}`]: string | undefined }) {
  return <div className="d-card d-rp-stat" {...rest}><p className="d-rp-stat-label">{label}</p><p className="d-rp-stat-value">{value}</p><p className="d-rp-stat-sub">{sub}</p></div>;
}
