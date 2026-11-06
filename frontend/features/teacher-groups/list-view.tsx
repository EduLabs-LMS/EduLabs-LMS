'use client';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useSwr } from '@/frontend/lib/use-swr';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { buttonClass } from '@/frontend/components/design/button';
import { Countdown, useServerMinute } from '@/frontend/components/design/countdown';
import { DateTile } from '@/frontend/components/design/date-tile';
import { SearchField } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { sessionTime } from '@/frontend/features/teacher-home/parts';
import { sessionState, type GroupPage, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';
import { attendanceHref } from '@/shared/teacher-attendance';
import { LIST_PAGES, PAGE_SIZE, filterGroups, groupCounts, lastUnsavedSession, managed, nextOf, studentsCount, type GroupFilter, type WeeklyTime } from '@/shared/teacher-groups';
import { GroupCallError, groupCall, limited } from './api';
import { useCourseTitles } from './course-titles';
import { GroupError, ModePill, WeeklyTimes } from './parts';
import { GroupsListBodySkeleton } from './skeletons';

type Overview = { rows: StudyGroup[]; truncated: boolean };

async function readOverview(signal: AbortSignal): Promise<Overview> {
  const rows: StudyGroup[] = [];
  let more = false;
  for (let page = 0; page < LIST_PAGES; page++) {
    const result = await groupCall<GroupPage<StudyGroup>>('view', null, { section: 'sessions', page, search: '' }, null, signal);
    rows.push(...result.rows);
    more = Boolean(result.hasMore);
    if (!more) break;
  }
  return { rows: managed(rows), truncated: more };
}
const asCallError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);

export function TeacherGroupsList() {
  const { t } = useLanguage();
  // Stale-while-revalidate: a revisit shows the last list at once and refreshes it in the background (frontend/lib/swr-cache.ts).
  const { data: overview, retry } = useSwr<Overview, GroupCallError>('groups:overview', readOverview, asCallError);
  const titles = useCourseTitles();
  const [filter, setFilter] = useState<GroupFilter>('active');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => overview.state === 'ready' ? overview.value.rows : [], [overview]);
  const counts = useMemo(() => groupCounts(rows), [rows]);
  const titleOf = useCallback((g: Pick<StudyGroup, 'offering_id'>) => titles.get(g.offering_id) ?? '', [titles]);
  const shown = useMemo(() => filterGroups(rows, filter, query, titleOf), [rows, filter, query, titleOf]);

  return <div data-teacher-groups className="d-page">
    <PageHeader title={<L id="tg.title" />} meta={<L id="tg.intro" />} primary={{ key: 'create', href: '/teacher/groups/new', label: <L id="tg.create.button" />, data: { 'data-create-group': '', 'data-tour': 'create-group' } }} />
    {overview.state === 'loading' && <GroupsListBodySkeleton />}
    {overview.state === 'error' && <GroupError kind={overview.error.kind} onRetry={retry} />}
    {overview.state === 'ready' && <>
      <div className="d-toolbar">
        <div role="group" aria-label={t('tg.filter.label')} className="d-filters">
          {(['active', 'archived'] as const).map(key => <button key={key} type="button" aria-pressed={filter === key} data-filter={key} onClick={() => setFilter(key)} className="d-filter"><L id={key === 'active' ? 'tg.filter.active' : 'tg.filter.archived'} values={{ count: counts[key] }} /></button>)}
        </div>
        <div className="d-toolbar-search"><SearchField label={t('tg.search')} value={query} onChange={e => setQuery(e.target.value)} maxLength={160} placeholder={t('tg.search_ph')} data-groups-search /></div>
      </div>
      {overview.value.truncated && <p data-truncated className="d-body"><L id="tg.truncated" values={{ count: LIST_PAGES * PAGE_SIZE }} /></p>}
      {shown.length === 0
        ? <div data-state="empty" className="d-card d-card--pad d-stack"><p className="d-body"><L id={query.trim() ? 'tg.empty.search' : filter === 'active' ? 'tg.empty.active' : 'tg.empty.archived'} /></p>
          {!query.trim() && filter === 'active' && <Link href="/teacher/groups/new" data-create-group-empty className={buttonClass('primary')}><L id="tg.create.button" /></Link>}</div>
        : <ul className="d-group-list" data-group-list>{shown.map(g => <li key={g.id}><GroupCard group={g} course={titleOf(g)} /></li>)}</ul>}
    </>}
  </div>;
}

type Facts = { schedules: WeeklyTime[]; sessions: GroupSession[]; skew: number; students: ReturnType<typeof studentsCount> };

/** One Group: a card on a desktop, a calm row on a phone. Its details come from three reads that only run for the cards on screen, a few at a time; a failure here only affects this card. A card seen before shows its last facts at once. */
function GroupCard({ group, course }: { group: StudyGroup; course: string }) {
  const { data: facts, retry } = useSwr<Facts, GroupCallError>(`group:${group.id}:facts:${group.capacity ?? ''}`, signal => limited(async () => {
    const [detail, sessions, members] = await Promise.all([
      groupCall<{ schedules: WeeklyTime[]; serverNow: string }>('view', group.id, { section: 'detail' }, null, signal),
      groupCall<GroupPage<GroupSession>>('view', group.id, { section: 'sessions', page: 0 }, null, signal),
      groupCall<GroupPage<GroupRow>>('view', group.id, { section: 'members', page: 0, search: '' }, null, signal),
    ]);
    return { schedules: detail.schedules, sessions: sessions.rows, skew: Date.parse(sessions.serverNow ?? detail.serverNow) - Date.now(), students: studentsCount(members.rows, members.hasMore, group.capacity) };
  }), asCallError);
  const ready = facts.state === 'ready' ? facts.value : null;
  const now = useServerMinute(ready?.skew ?? 0);
  const next = ready ? nextOf(ready.sessions, now) : null;
  const unsaved = ready ? lastUnsavedSession(ready.sessions, now) : null;
  const live = ready ? ready.sessions.some(s => sessionState(s, now) === 'ongoing') : false;
  const href = `/teacher/groups/${group.id}`;
  return <article data-group-card={group.id} className="d-group-card">
    <div className="d-group-card-head">
      <div className="d-row-body">
        <h2 className="d-label"><Link href={href} className="d-group-link">{group.name}</Link></h2>
        {course && <p data-group-course className="d-meta"><bdi dir="auto">{course}</bdi></p>}
      </div>
      <span className="d-group-pills">
        {group.status === 'archived' && <StatusPill tone="neutral" data-group-status="archived"><L id="tg.status.archived" /></StatusPill>}
        {group.status === 'active' && live && <StatusPill tone="success" dot data-group-status="now"><L id="tg.pill.now" /></StatusPill>}
        {unsaved && <Link href={attendanceHref(group.id, unsaved.id)} data-attendance-unsaved className="d-pill-link"><StatusPill tone="warning"><L id="tg.card.unsaved" /></StatusPill></Link>}
      </span>
      <Icon name="chevron" className="d-chevron d-group-phone" />
    </div>
    <span className="d-group-wide"><ModePill mode={group.mode} /></span>
    {facts.state === 'loading' && <div aria-hidden="true" data-state="loading" className="d-stack-sm"><DesignSkeleton className="h-5 w-3/4" /><DesignSkeleton className="h-5 w-1/3" /></div>}
    {facts.state === 'error' && <GroupError kind={facts.error.kind} onRetry={retry} />}
    {ready && <>
      <div className="d-group-next">
        {next && <span className="d-group-wide"><DateTile value={next.starts_at} /></span>}
        <span className="d-row-body d-meta" data-next-session>
          {next ? <span><span className="d-group-phone-inline"><L id="tg.card.next_short" /> </span><LocalDate value={next.starts_at} options={sessionTime} /></span> : <L id="tg.card.no_next" />}
          {next && <span className="d-group-wide"><Countdown startsAt={next.starts_at} now={now} /></span>}
        </span>
      </div>
      <p className="d-meta d-group-wide" data-weekly-times>{ready.schedules.length
        ? <WeeklyTimes items={ready.schedules} />
        : <><L id="tg.card.no_weekly" />{group.status === 'active' && group.instructor && <> <Link href={`${href}?edit=1`} data-add-weekly className="d-inline-link"><L id="tg.card.add_times" /></Link></>}</>}</p>
      <p className="d-meta" data-students-count><Students value={ready.students} /></p>
    </>}
  </article>;
}

export function Students({ value }: { value: ReturnType<typeof studentsCount> }) {
  if (value.more) return <L id="tg.card.students_more" values={{ count: value.count }} />;
  return value.capacity ? <L id="tg.card.students_of" values={{ count: value.count, capacity: value.capacity }} /> : <L id="tg.card.students" values={{ count: value.count }} />;
}
