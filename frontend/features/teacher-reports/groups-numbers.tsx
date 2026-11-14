'use client';
import { useEffect, useState } from 'react';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GROUPS_PER_READ, type GroupNumbers, type GroupsReport } from '@/shared/contracts/teacher-reports';
import { reportGet } from './api';
import { usePct } from './parts';

export type NumbersState = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; byGroup: Map<string, GroupNumbers> };

/** The Groups list's numbers for this month: one read per 100 Groups on the list, not one per card. A failure is its own state (with Retry), never "No numbers yet". */
export function useGroupNumbers(ids: readonly string[]): { numbers: NumbersState; retry: () => void } {
  const key = ids.join(',');
  const [numbers, setNumbers] = useState<NumbersState>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!key) { setNumbers({ state: 'ready', byGroup: new Map() }); return; }
    const controller = new AbortController();
    const all = key.split(',');
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += GROUPS_PER_READ) chunks.push(all.slice(i, i + GROUPS_PER_READ));
    setNumbers({ state: 'loading' });
    Promise.all(chunks.map(c => reportGet<GroupsReport>(`/api/teacher/reports/groups?groups=${c.join(',')}`, controller.signal))).then(
      replies => { if (controller.signal.aborted) return; setNumbers({ state: 'ready', byGroup: new Map(replies.flatMap(r => r.groups).map(g => [g.groupId, g])) }); },
      e => { if (controller.signal.aborted || (e as Error).name === 'AbortError') return; setNumbers({ state: 'error', error: e instanceof GroupCallError ? e : new GroupCallError(null) }); });
    return () => controller.abort();
  }, [key, revision]);
  return { numbers, retry: () => setRevision(v => v + 1) };
}

/** "Attendance 91% · Homework 84% · Exams 72%" and the "N need attention" pill; "No numbers yet" when the Group has nothing this month. */
export function GroupNumbersLine({ numbers }: { numbers: GroupNumbers | undefined }) {
  const { t, number } = useLanguage();
  const pct = usePct();
  if (!numbers || !numbers.hasNumbers) return <p className="d-meta" data-report-line data-empty><L id="rp.none_yet" /></p>;
  const parts = [
    t('rp.line.attendance', { value: pct(numbers.attendance.pct) }),
    t('rp.line.homework', { value: pct(numbers.homework.pct) }),
    t('rp.line.exams', { value: pct(numbers.exams.pct) }),
  ];
  return <p className="d-rp-group-line d-meta" data-report-line>
    <span>{parts.join(' · ')}</span>
    {numbers.attention > 0 && <StatusPill tone="warning" data-attention-pill>{numbers.attention === 1 ? t('rp.attention_pill_one') : t('rp.attention_pill', { count: number(numbers.attention) })}</StatusPill>}
  </p>;
}
