'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { GroupCallError } from '@/frontend/features/teacher-groups/api';
import { GROUPS_PER_READ, type GroupNumbers, type GroupsReport } from '@/shared/contracts/teacher-reports';
import { reportGet } from './api';
import { usePct } from './parts';

export type NumbersState = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; byGroup: Map<string, GroupNumbers> };
export type GroupNumbersReads = {
  /** The numbers state of the page the Group is on. */
  stateOf: (groupId: string) => NumbersState;
  /** The Group's card is near the screen: read its page if not read yet. */
  want: (groupId: string) => void;
  /** Read the Group's page again (after an error). */
  retry: (groupId: string) => void;
};
const LOADING: NumbersState = { state: 'loading' };

/**
 * The Groups list's numbers for the last 4 weeks: one read per page of the list (GROUPS_PER_READ = 25 Groups, the list's page size), never one per card.
 * The first page is read at once; each next page when one of its cards comes near the screen (GroupCard calls want). The cards look the same as
 * before: a skeleton line until their page is read. A failed page is its own state (with Retry), never "No numbers yet".
 */
export function useGroupNumbers(ids: readonly string[]): GroupNumbersReads {
  const key = ids.join(',');
  const pages = useMemo(() => {
    const all = key ? key.split(',') : [], out: string[][] = [];
    for (let i = 0; i < all.length; i += GROUPS_PER_READ) out.push(all.slice(i, i + GROUPS_PER_READ));
    return out;
  }, [key]);
  const pageOf = useMemo(() => new Map(pages.flatMap((page, i) => page.map(id => [id, i] as const))), [pages]);
  const [states, setStates] = useState<{ key: string; byPage: ReadonlyMap<number, NumbersState> }>({ key, byPage: new Map() });
  const requested = useRef(new Set<number>());
  const controllers = useRef(new Map<number, AbortController>());
  const load = useCallback((page: number) => {
    controllers.current.get(page)?.abort();
    const controller = new AbortController();
    controllers.current.set(page, controller);
    const put = (state: NumbersState) => setStates(s => s.key === key ? { key, byPage: new Map(s.byPage).set(page, state) } : s);
    put(LOADING);
    reportGet<GroupsReport>(`/api/teacher/reports/groups?groups=${pages[page].join(',')}`, controller.signal).then(
      reply => { if (!controller.signal.aborted) put({ state: 'ready', byGroup: new Map(reply.groups.map(g => [g.groupId, g])) }); },
      e => { if (controller.signal.aborted || (e as Error).name === 'AbortError') return; put({ state: 'error', error: e instanceof GroupCallError ? e : new GroupCallError(null) }); });
  }, [key, pages]);
  const want = useCallback((groupId: string) => {
    const page = pageOf.get(groupId);
    if (page === undefined || requested.current.has(page)) return;
    requested.current.add(page);
    load(page);
  }, [pageOf, load]);
  // A new list (filter, search, refresh): forget the pages read, stop the reads in flight, read the first page.
  useEffect(() => {
    const running = controllers.current;
    requested.current = new Set();
    setStates({ key, byPage: new Map() });
    if (pages.length) want(pages[0][0]);
    return () => { running.forEach(c => c.abort()); running.clear(); };
  }, [key, pages, want]);
  const retry = useCallback((groupId: string) => { const page = pageOf.get(groupId); if (page !== undefined) { requested.current.add(page); load(page); } }, [pageOf, load]);
  const stateOf = useCallback((groupId: string): NumbersState => {
    const page = pageOf.get(groupId);
    return states.key !== key || page === undefined ? LOADING : states.byPage.get(page) ?? LOADING;
  }, [states, key, pageOf]);
  return { stateOf, want, retry };
}

/** Calls onNear once when the element comes within 600 px of the screen (at once where IntersectionObserver is missing). */
export function useNearScreen(ref: { readonly current: Element | null }, onNear: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { onNear(); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { observer.disconnect(); onNear(); } }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, onNear]);
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
