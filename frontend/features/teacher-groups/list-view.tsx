'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { card, linkClass, plainButton, sessionTime } from '@/frontend/features/teacher-home/parts';
import type { GroupPage, GroupRow, GroupSession, StudyGroup } from '@/shared/contracts/groups';
import { LIST_PAGES, PAGE_SIZE, filterGroups, groupCounts, lastAttendanceUnsaved, managed, nextOf, studentsCount, type GroupFilter, type WeeklyTime } from '@/shared/teacher-groups';
import { GroupCallError, groupCall, isAbort, limited } from './api';
import { GroupError, Loading, ModeLabel, WeeklyTimes } from './parts';

type Overview = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; rows: StudyGroup[]; truncated: boolean };

async function readOverview(signal: AbortSignal): Promise<Overview> {
  const rows: StudyGroup[] = [];
  let more = false;
  for (let page = 0; page < LIST_PAGES; page++) {
    const result = await groupCall<GroupPage<StudyGroup>>('view', null, { section: 'sessions', page, search: '' }, null, signal);
    rows.push(...result.rows);
    more = Boolean(result.hasMore);
    if (!more) break;
  }
  return { state: 'ready', rows: managed(rows), truncated: more };
}

export function TeacherGroupsList() {
  const { t } = useLanguage();
  const [overview, setOverview] = useState<Overview>({ state: 'loading' });
  const [filter, setFilter] = useState<GroupFilter>('active');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOverview({ state: 'loading' });
    readOverview(controller.signal).then(setOverview, e => { if (!isAbort(e)) setOverview({ state: 'error', error: e instanceof GroupCallError ? e : new GroupCallError(null) }); });
    return () => controller.abort();
  }, [revision]);
  const retry = useCallback(() => setRevision(v => v + 1), []);
  const rows = useMemo(() => overview.state === 'ready' ? overview.rows : [], [overview]);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const shown = useMemo(() => filterGroups(rows, filter, query), [rows, filter, query]);

  return <div data-teacher-groups className="w-full space-y-5">
    <header className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="tg.title" /></h1><p className="text-base text-slate-700"><L id="tg.intro" /></p></header>
    {overview.state === 'loading' && <Loading label="tg.loading" className="h-40" />}
    {overview.state === 'error' && <GroupError kind={overview.error.kind} onRetry={retry} />}
    {overview.state === 'ready' && <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label={t('tg.filter.label')} className="flex gap-2">
          {(['active', 'archived'] as const).map(key => <button key={key} type="button" aria-pressed={filter === key} data-filter={key} onClick={() => setFilter(key)}
            className={`${plainButton} ${filter === key ? '!bg-black !text-white' : ''}`}><L id={key === 'active' ? 'tg.filter.active' : 'tg.filter.archived'} values={{ count: counts[key] }} /></button>)}
        </div>
        <label className="relative block md:w-80"><span className="sr-only"><L id="tg.search" /></span>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} maxLength={160} placeholder={t('tg.search_ph')} data-groups-search
            className="min-h-[44px] w-full rounded-2xl border-2 border-black bg-white ps-10 pe-3 text-base" />
        </label>
      </div>
      {overview.truncated && <p data-truncated className="text-base text-slate-700"><L id="tg.truncated" values={{ count: LIST_PAGES * PAGE_SIZE }} /></p>}
      {shown.length === 0
        ? <div data-state="empty" className={`${card}`}><p className="text-base text-slate-800"><L id={query.trim() ? 'tg.empty.search' : filter === 'active' ? 'tg.empty.active' : 'tg.empty.archived'} /></p></div>
        : <ul className="grid gap-4 lg:grid-cols-2" data-group-list>{shown.map(g => <li key={g.id}><GroupCard group={g} /></li>)}</ul>}
    </>}
  </div>;
}

type Facts = { state: 'loading' } | { state: 'error'; error: GroupCallError }
  | { state: 'ready'; schedules: WeeklyTime[]; sessions: GroupSession[]; serverNow: number; students: ReturnType<typeof studentsCount> };

/** One Group's card. Its details come from three reads that only run for the cards on screen, a few at a time; a failure here only affects this card. */
function GroupCard({ group }: { group: StudyGroup }) {
  const [facts, setFacts] = useState<Facts>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFacts({ state: 'loading' });
    limited(async () => {
      const [detail, sessions, members] = await Promise.all([
        groupCall<{ schedules: WeeklyTime[]; serverNow: string }>('view', group.id, { section: 'detail' }, null, controller.signal),
        groupCall<GroupPage<GroupSession>>('view', group.id, { section: 'sessions', page: 0 }, null, controller.signal),
        groupCall<GroupPage<GroupRow>>('view', group.id, { section: 'members', page: 0, search: '' }, null, controller.signal),
      ]);
      return { state: 'ready', schedules: detail.schedules, sessions: sessions.rows, serverNow: Date.parse(sessions.serverNow ?? detail.serverNow), students: studentsCount(members.rows, members.hasMore, group.capacity) } as const;
    }).then(setFacts, e => { if (!isAbort(e)) setFacts({ state: 'error', error: e instanceof GroupCallError ? e : new GroupCallError(null) }); });
    return () => controller.abort();
  }, [group.id, group.capacity, revision]);

  const next = facts.state === 'ready' ? nextOf(facts.sessions, facts.serverNow) : null;
  const unsaved = facts.state === 'ready' && lastAttendanceUnsaved(facts.sessions, facts.serverNow);
  return <article data-group-card={group.id} className={`${card} flex h-full flex-col gap-3`}>
    <div className="min-w-0">
      <h2 className="font-display text-2xl leading-tight"><Link href={`/teacher/groups/${group.id}`} className="underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">{group.name}</Link></h2>
      <p className="text-base text-slate-700">{group.offering_name}</p>
    </div>
    <p className="text-base font-bold"><ModeLabel mode={group.mode} /></p>
    {facts.state === 'loading' && <Loading className="h-16" />}
    {facts.state === 'error' && <GroupError kind={facts.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {facts.state === 'ready' && <dl className="space-y-2 text-base">
      <div><dt className="font-bold"><L id="tg.card.next" /></dt><dd data-next-session>{next ? <LocalDate value={next.starts_at} options={sessionTime} /> : <L id="tg.card.no_next" />}</dd></div>
      <div><dt className="font-bold"><L id="tg.card.weekly" /></dt><dd><WeeklyTimes items={facts.schedules} /></dd></div>
      <div><dt className="font-bold"><L id="tg.tab.students" /></dt><dd data-students-count><Students value={facts.students} /></dd></div>
    </dl>}
    {unsaved && <p data-attendance-unsaved className="flex gap-2 rounded-xl border-2 border-black bg-amber-100 p-3 text-base"><AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" /><L id="tg.card.unsaved" /></p>}
    <Link href={`/teacher/groups/${group.id}`} className={`${linkClass} mt-auto`}><L id="tg.card.open" /></Link>
  </article>;
}

export function Students({ value }: { value: ReturnType<typeof studentsCount> }) {
  if (value.more) return <L id="tg.card.students_more" values={{ count: value.count }} />;
  return value.capacity ? <L id="tg.card.students_of" values={{ count: value.count, capacity: value.capacity }} /> : <L id="tg.card.students" values={{ count: value.count }} />;
}
