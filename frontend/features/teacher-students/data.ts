'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import type { GroupPage, GroupRow, StudyGroup } from '@/shared/contracts/groups';
import { MAX_MEMBER_PAGES, ROSTER_PAGE, failStream, hasMore, indexMembers, newStream, nextStep, readPage, retryStream, rosterFilter, takeRow, teacherGroups, truncated, type MemberIndex, type RequestRow, type RosterRow, type Stream, type StatusFilter } from '@/shared/teacher-students';
import { swrDrop, swrOwner, swrPeek, swrStore, isRefusal } from '@/frontend/lib/swr-cache';
import { useSwr } from '@/frontend/lib/use-swr';
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

/**
 * A read that shows the last copy for this user at once and reads again in the background (stale-while-revalidate, see frontend/lib/swr-cache.ts).
 * The answer has the same shape as useLoaded's, so the screens do not care which one they got.
 */
function useCached<T>(key: string, read: () => Promise<T>): { data: Loaded<T>; retry: () => void } {
  const { data, retry } = useSwr<T, GroupCallError>(key, read, asCallError);
  return { data: data.state === 'ready' ? { state: 'ready', value: data.value } : data, retry };
}

export const useOfferings = () => useCached<AdminOffering[]>('students:offerings', readOfferings);
export const useGroups = () => useCached<StudyGroup[]>('groups:all', readGroups);

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
      // A copy kept from an earlier visit stands in until this visit has read the members again (stamp -1 is never the current refresh).
      const kept = read[g.id] ? undefined : swrPeek<GroupRow[]>(`group:${g.id}:members:all`);
      if (kept) setRead(m => m[g.id] ? m : { ...m, [g.id]: { rows: kept, stamp: -1 } });
      if ((read[g.id] && read[g.id].stamp === refresh) || failed[g.id] || inflight.current.has(g.id)) continue;
      inflight.current.add(g.id);
      const startedAs = swrOwner();
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
      })().then(r => { inflight.current.delete(g.id); if (!r.more) swrStore(`group:${g.id}:members:all`, r.rows, startedAs); if (!mounted.current) return; setRead(m => ({ ...m, [g.id]: { rows: r.rows, stamp: refresh } })); if (r.more) setCut(c => ({ ...c, [g.id]: true })); },
        () => { inflight.current.delete(g.id); if (mounted.current) setFailed(f => ({ ...f, [g.id]: true })); });
    }
  }, [wanted, read, failed, revision, refresh]);
  const loading = wanted.some(g => !read[g.id] && !failed[g.id]);
  const index: MemberIndex = useMemo(() => indexMembers(wanted, Object.fromEntries(Object.entries(read).map(([id, v]) => [id, v.rows]))), [wanted, read]);
  const failedGroups = wanted.filter(g => failed[g.id]).map(g => g.id);
  return { index, loading, failedOfferings: new Set(wanted.filter(g => failed[g.id] || cut[g.id]).map(g => g.offering_id)), failedGroups, retry: () => { setFailed({}); setRevision(v => v + 1); } };
}

export type Entry = { row: RosterRow; offering: AdminOffering };
type ListState = { phase: 'loading' | 'ready'; shown: Entry[]; more: boolean; loadingMore: boolean; failed: AdminOffering[]; capped: boolean; refreshing: boolean };
type Seed = { shown: Entry[]; capped: boolean };
/** `initial` blanks the list; `more` appends; `seeded` re-reads a list shown from a kept copy; `search` re-reads for a new search while the old rows stay on screen. */
type Mode = 'initial' | 'more' | 'seeded' | 'search';
const rosterKey = (chosen: readonly AdminOffering[], courseId: string, status: StatusFilter) => `students:roster:${courseId}:${status}:${chosen.map(o => o.id).join(',')}`;

/**
 * One list over many courses, in name order. Each course is read a page at a time and the lists are merged, so a page is always the next
 * people in order and a course that fails is named instead of silently missing.
 */
export function useRosterList(offerings: readonly AdminOffering[] | null, courseId: string, status: StatusFilter, query: string, revision: number) {
  const [state, setState] = useState<ListState>({ phase: 'loading', shown: [], more: false, loadingMore: false, failed: [], capped: false, refreshing: false });
  const run = useRef({ id: 0, streams: [] as Stream[], shown: [] as Entry[], key: '' });
  const last = useRef<{ offerings: unknown; courseId: string; status: string; revision: number; ready: boolean } | null>(null);
  const params = useRef({ status, query });
  params.current = { status, query };

  const fill = useCallback(async (id: number, want: number, mode: Mode) => {
    const current = run.current;
    let refused = false;
    const startedAs = swrOwner();
    if (mode === 'initial') setState(s => ({ ...s, phase: 'loading', shown: [], more: false, failed: [], capped: false, refreshing: false }));
    else if (mode === 'more') setState(s => ({ ...s, loadingMore: true }));
    else setState(s => ({ ...s, refreshing: true }));
    let streams = current.streams;
    const shown = [...current.shown];
    const { status: filter, query: search } = params.current;
    while (shown.length < want) {
      const needs = streams.flatMap((s, i) => !s.failed && !s.done && s.rows.length === 0 ? [i] : []);
      if (needs.length) {
        const results = await Promise.all(needs.map(async i => {
          const s = streams[i];
          try { return readPage(s, (await adminRead<{ rows: RosterRow[] }>('roster', { page: s.page, search, filter: rosterFilter(filter) }, s.offering.id)).rows); } catch (e) { if (isRefusal((e as { status?: unknown }).status)) refused = true; return failStream(s); }
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
    const failed = streams.filter(s => s.failed);
    if (refused) swrDrop(current.key);
    // A kept copy is not replaced by an answer that is only failures (unless the failure is a refusal): it was valid moments ago.
    if (mode === 'seeded' && streams.length > 0 && failed.length === streams.length && !refused) { setState(s => ({ ...s, refreshing: false })); return; }
    // Only a complete first page with no failure is kept, and only for the unfiltered list.
    if ((mode === 'initial' || mode === 'seeded') && failed.length === 0 && !params.current.query && current.key) swrStore<Seed>(current.key, { shown, capped: truncated(streams) }, startedAs);
    setState({ phase: 'ready', shown, more: hasMore(streams), loadingMore: false, failed: failed.map(s => s.offering), capped: truncated(streams), refreshing: false });
  }, []);

  useEffect(() => {
    if (!offerings) return;
    const chosen = offerings.filter(o => courseId === 'all' || o.id === courseId);
    const id = run.current.id + 1;
    const key = status === 'waiting' ? '' : rosterKey(chosen, courseId, status);
    run.current = { id, streams: status === 'waiting' ? [] : chosen.map(newStream), shown: [], key };
    const hit = key && !query ? swrPeek<Seed>(key) : undefined;
    const before = last.current;
    // Only the search text changed: the rows on screen stay (the screen narrows them by what was typed) until the answer for the new search is in.
    const searchOnly = before !== null && before.ready && before.offerings === offerings && before.courseId === courseId && before.status === status && before.revision === revision;
    last.current = { offerings, courseId, status, revision, ready: true };
    if (hit) { setState({ phase: 'ready', shown: hit.shown, more: false, loadingMore: false, failed: [], capped: hit.capped, refreshing: true }); void fill(id, ROSTER_PAGE, 'seeded'); }
    else void fill(id, ROSTER_PAGE, searchOnly ? 'search' : 'initial');
    // the course filter, the status, the search and a reload each start the list again
  }, [offerings, courseId, status, query, revision, fill]);

  const loadMore = useCallback(() => { const id = run.current.id; void fill(id, run.current.shown.length + ROSTER_PAGE, 'more'); }, [fill]);
  const retryFailed = useCallback(() => {
    run.current.streams = run.current.streams.map(retryStream);
    const id = run.current.id; void fill(id, run.current.shown.length + ROSTER_PAGE, 'more');
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
    const startedAs = swrOwner();
    const key = `students:requests:${offerings.map(o => o.id).join(',')}`;
    const kept = swrPeek<{ rows: PendingRequest[]; more: AdminOffering[] }>(key);
    // A copy kept from an earlier visit shows until this visit has read the requests again.
    if (kept) setState(s => s.phase === 'ready' ? s : { phase: 'ready', rows: kept.rows, failed: [], more: kept.more });
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
      if (failed.length === 0) swrStore(key, { rows, more }, startedAs);
      if (alive) setState({ phase: 'ready', rows, failed, more });
    })();
    return () => { alive = false; };
  }, [offerings, revision, local]);
  return { ...state, reload: () => setLocal(v => v + 1), drop: (id: string) => setState(s => ({ ...s, rows: s.rows.filter(r => r.request.id !== id) })) };
}

export { adminCall };
