'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import type { GroupPage, GroupRow, StudyGroup } from '@/shared/contracts/groups';
import { MAX_MEMBER_PAGES, ROSTER_PAGE, failStream, hasMore, indexMembers, newStream, nextStep, readPage, retryStream, rosterFilter, takeRow, teacherGroups, truncated, type MemberIndex, type RequestRow, type RosterRow, type Stream, type StatusFilter } from '@/shared/teacher-students';
import { GroupCallError, adminCall, adminRead, asCallError, groupCall, limited, readGroups, readOfferings } from './api';

export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; value: T };

/** One read, with a retry. A failure is an error, never an empty result. */
export function useLoaded<T>(read: () => Promise<T>): { data: Loaded<T>; retry: () => void } {
  const [data, setData] = useState<Loaded<T>>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    let alive = true;
    setData(d => d.state === 'ready' ? d : { state: 'loading' });
    readRef.current().then(value => { if (alive) setData({ state: 'ready', value }); }, e => { if (alive) setData({ state: 'error', error: asCallError(e) }); });
    return () => { alive = false; };
  }, [revision]);
  return { data, retry: useCallback(() => setRevision(v => v + 1), []) };
}

export const useOfferings = () => useLoaded<AdminOffering[]>(readOfferings);
export const useGroups = () => useLoaded<StudyGroup[]>(readGroups);

/** Which Groups each student is in: the members of the teacher's Groups, read for the courses on screen only, a few at a time. */
export function useGroupMembers(groups: readonly StudyGroup[] | null, offeringIds: readonly string[], refresh = 0) {
  // Each Group's members are kept with the refresh they were read at: a change (an approval that added someone) reads them again while the old list stays on screen.
  const [read, setRead] = useState<Record<string, { rows: GroupRow[]; stamp: number }>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [cut, setCut] = useState<Record<string, true>>({});
  const [revision, setRevision] = useState(0);
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = offeringIds.join(',');
  const wanted = useMemo(() => groups ? teacherGroups(groups).filter(g => key.split(',').includes(g.offering_id)) : [], [groups, key]);
  useEffect(() => {
    for (const g of wanted) {
      if ((read[g.id] && read[g.id].stamp === refresh) || failed[g.id] || inflight.current.has(g.id)) continue;
      inflight.current.add(g.id);
      (async () => {
        const rows: GroupRow[] = [];
        let more = false;
        for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
          const result = await limited(() => groupCall<GroupPage<GroupRow>>('view', g.id, { section: 'members', page, search: '' }));
          rows.push(...result.rows);
          more = Boolean(result.hasMore);
          if (!more) break;
        }
        return { rows, more };
      })().then(r => { inflight.current.delete(g.id); if (!mounted.current) return; setRead(m => ({ ...m, [g.id]: { rows: r.rows, stamp: refresh } })); if (r.more) setCut(c => ({ ...c, [g.id]: true })); },
        () => { inflight.current.delete(g.id); if (mounted.current) setFailed(f => ({ ...f, [g.id]: true })); });
    }
  }, [wanted, read, failed, revision, refresh]);
  const loading = wanted.some(g => !read[g.id] && !failed[g.id]);
  const index: MemberIndex = useMemo(() => indexMembers(wanted, Object.fromEntries(Object.entries(read).map(([id, v]) => [id, v.rows]))), [wanted, read]);
  const failedGroups = wanted.filter(g => failed[g.id]).map(g => g.id);
  return { index, loading, failedOfferings: new Set(wanted.filter(g => failed[g.id] || cut[g.id]).map(g => g.offering_id)), failedGroups, retry: () => { setFailed({}); setRevision(v => v + 1); } };
}

export type Entry = { row: RosterRow; offering: AdminOffering };
type ListState = { phase: 'loading' | 'ready'; shown: Entry[]; more: boolean; loadingMore: boolean; failed: AdminOffering[]; capped: boolean };

/**
 * One list over many courses, in name order. Each course is read a page at a time and the lists are merged, so a page is always the next
 * people in order and a course that fails is named instead of silently missing.
 */
export function useRosterList(offerings: readonly AdminOffering[] | null, courseId: string, status: StatusFilter, query: string, revision: number) {
  const [state, setState] = useState<ListState>({ phase: 'loading', shown: [], more: false, loadingMore: false, failed: [], capped: false });
  const run = useRef({ id: 0, streams: [] as Stream[], shown: [] as Entry[] });
  const params = useRef({ status, query });
  params.current = { status, query };

  const fill = useCallback(async (id: number, want: number, initial: boolean) => {
    const current = run.current;
    if (initial) setState(s => ({ ...s, phase: 'loading', shown: [], more: false, failed: [], capped: false }));
    else setState(s => ({ ...s, loadingMore: true }));
    let streams = current.streams;
    const shown = [...current.shown];
    const { status: filter, query: search } = params.current;
    while (shown.length < want) {
      const needs = streams.flatMap((s, i) => !s.failed && !s.done && s.rows.length === 0 ? [i] : []);
      if (needs.length) {
        const results = await Promise.all(needs.map(async i => {
          const s = streams[i];
          try { return readPage(s, (await adminRead<{ rows: RosterRow[] }>('roster', { page: s.page, search, filter: rosterFilter(filter) }, s.offering.id)).rows); } catch { return failStream(s); }
        }));
        if (run.current.id !== id) return;
        streams = streams.map((s, i) => { const k = needs.indexOf(i); return k >= 0 ? results[k] : s; });
        continue;
      }
      const step = nextStep(streams);
      if (step.kind !== 'row') break;
      const taken = takeRow(streams, step.index);
      shown.push({ row: taken.row, offering: streams[step.index].offering });
      streams = taken.streams;
    }
    if (run.current.id !== id) return;
    run.current.streams = streams; run.current.shown = shown;
    setState({ phase: 'ready', shown, more: hasMore(streams), loadingMore: false, failed: streams.filter(s => s.failed).map(s => s.offering), capped: truncated(streams) });
  }, []);

  useEffect(() => {
    if (!offerings) return;
    const chosen = offerings.filter(o => courseId === 'all' || o.id === courseId);
    const id = run.current.id + 1;
    run.current = { id, streams: status === 'waiting' ? [] : chosen.map(newStream), shown: [] };
    void fill(id, ROSTER_PAGE, true);
    // the course filter, the status, the search and a reload each start the list again
  }, [offerings, courseId, status, query, revision, fill]);

  const loadMore = useCallback(() => { const id = run.current.id; void fill(id, run.current.shown.length + ROSTER_PAGE, false); }, [fill]);
  const retryFailed = useCallback(() => {
    run.current.streams = run.current.streams.map(retryStream);
    const id = run.current.id; void fill(id, run.current.shown.length + ROSTER_PAGE, false);
  }, [fill]);
  return { ...state, loadMore, retryFailed };
}

export type PendingRequest = { request: RequestRow; offering: AdminOffering };
/** Waiting join requests from every course, oldest first. A course that cannot be read is named, never skipped quietly. */
export function usePendingRequests(offerings: readonly AdminOffering[] | null, revision: number) {
  const [state, setState] = useState<{ phase: 'loading' | 'ready'; rows: PendingRequest[]; failed: AdminOffering[]; more: AdminOffering[] }>({ phase: 'loading', rows: [], failed: [], more: [] });
  const [local, setLocal] = useState(0);
  useEffect(() => {
    if (!offerings) return;
    let alive = true;
    (async () => {
      const failed: AdminOffering[] = [], more: AdminOffering[] = [], rows: PendingRequest[] = [];
      await Promise.all(offerings.map(async offering => {
        try {
          const r = await adminRead<{ rows: RequestRow[] }>('requests', { page: 0, search: '', filter: 'pending' }, offering.id);
          for (const request of r.rows) rows.push({ request, offering });
          if (r.rows.length >= ROSTER_PAGE) more.push(offering);
        } catch { failed.push(offering); }
      }));
      rows.sort((a, b) => a.request.created_at.localeCompare(b.request.created_at) || a.request.id.localeCompare(b.request.id));
      if (alive) setState({ phase: 'ready', rows, failed, more });
    })();
    return () => { alive = false; };
  }, [offerings, revision, local]);
  return { ...state, reload: () => setLocal(v => v + 1), drop: (id: string) => setState(s => ({ ...s, rows: s.rows.filter(r => r.request.id !== id) })) };
}

export { adminCall };
