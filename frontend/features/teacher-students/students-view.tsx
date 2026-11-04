'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { usePageLoadingSignal } from '@/frontend/components/providers/use-page-loading-signal';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { plainButton, primaryButton } from '@/frontend/features/teacher-home/parts';
import { GroupError, Loading } from '@/frontend/features/teacher-groups/parts';
import type { MessageKey } from '@/frontend/locales/messages';
import { failureKind, type CourseChoice } from '@/shared/teacher-groups';
import { MAX_ROSTER_PAGES, ROSTER_PAGE, STATUS_FILTERS, displayStatus, type StatusFilter } from '@/shared/teacher-students';
import { InvitePanel } from './invite';
import { useGroupMembers, useGroups, useOfferings, usePendingRequests, useRosterList, type Entry } from './data';
import { StatusPill, StudentName, courseLabels, fieldClass } from './parts';
import { RequestsSection, type Notice } from './requests';

const statusLabel: Record<StatusFilter, MessageKey> = {
  all: 'ts.students.status.all', active: 'ts.students.status.active', suspended: 'ts.students.status.suspended', expired: 'ts.students.status.expired',
  completed: 'ts.students.status.completed', cancelled: 'ts.students.status.cancelled', invited: 'ts.students.status.invited', waiting: 'ts.students.status.waiting',
};
const tall = '!min-h-[48px]';

/** The teacher's students across their courses, a join-requests section when someone is waiting, and Invite students. */
export function TeacherStudentsView({ courses, inviteOffering }: { courses: { ok: true; value: CourseChoice[] } | { ok: false; status: number | null }; inviteOffering: string | null }) {
  const { t } = useLanguage();
  const offerings = useOfferings();
  const groups = useGroups();
  const [course, setCourse] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [inviting, setInviting] = useState(inviteOffering !== null);
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => { const h = setTimeout(() => setQuery(typed.trim()), 300); return () => clearTimeout(h); }, [typed]);

  const offeringRows = offerings.data.state === 'ready' ? offerings.data.value : null;
  const labels = useMemo(() => courseLabels(offeringRows ?? []), [offeringRows]);
  const roster = useRosterList(offeringRows, course, status, query, revision);
  const requests = usePendingRequests(offeringRows, revision);
  const groupRows = groups.data.state === 'ready' ? groups.data.value : null;
  const shownOfferings = useMemo(() => Array.from(new Set(roster.shown.map(e => e.offering.id))), [roster.shown]);
  const members = useGroupMembers(groupRows, shownOfferings, revision);

  // The first view is complete when the list, the Groups beside each student and the waiting requests are all in (or each has failed and says so).
  const settled = offerings.data.state === 'error' || (offerings.data.state === 'ready' && groups.data.state !== 'loading' && roster.phase === 'ready' && !members.loading && requests.phase === 'ready');
  usePageLoadingSignal(!settled);

  const addNotice = (n: Notice) => setNotices(list => [n, ...list.filter(x => x.id !== n.id)].slice(0, 5));
  const canInvite = courses.ok && courses.value.length > 0;
  const noCourses = offerings.data.state === 'ready' && offerings.data.value.length === 0;

  return <div data-teacher-students className="w-full space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="ts.students.title" /></h1><p className="text-base text-slate-700"><L id="ts.students.intro" /></p></div>
      {canInvite && !inviting && <button type="button" data-invite-students data-tour="invite-students" onClick={() => setInviting(true)} className={`${primaryButton} ${tall}`}><L id="ts.students.invite" /></button>}
    </header>
    {inviting && courses.ok && <InvitePanel courses={courses.value} initialOffering={inviteOffering} onClose={() => setInviting(false)} />}
    {inviting && !courses.ok && <GroupError kind={failureKind(courses.status)} />}

    {offerings.data.state === 'loading' && <Loading label="ts.students.loading" className="h-40" />}
    {offerings.data.state === 'error' && <GroupError kind={offerings.data.error.kind} onRetry={offerings.retry} />}
    {noCourses && <div data-state="empty" className="space-y-3"><p className="text-base text-slate-800"><L id="ts.students.no_courses" /></p></div>}

    {offeringRows && offeringRows.length > 0 && <>
      <RequestsSection rows={requests.rows} failed={requests.failed.length} more={requests.more.length} labels={labels} groups={groupRows ?? []} groupsError={groups.data.state === 'error'} notices={notices}
        onNotice={addNotice} onCloseNotice={id => setNotices(list => list.filter(n => n.id !== id))} onChanged={id => { requests.drop(id); setRevision(v => v + 1); }} onRetryFailed={() => requests.reload()} />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" data-tour="student-filters">
        <label className="relative block"><span className="sr-only"><L id="ts.students.search" /></span>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2" />
          <input type="search" data-students-search value={typed} onChange={e => setTyped(e.target.value)} maxLength={120} placeholder={t('ts.students.search')} className={`${fieldClass} ps-10 pe-3`} /></label>
        <label className="block"><span className="sr-only"><L id="ts.students.course_filter" /></span>
          <select data-course-filter className={fieldClass} value={course} onChange={e => setCourse(e.target.value)}>
            <option value="all">{t('ts.students.all_courses')}</option>
            {offeringRows.map(o => <option key={o.id} value={o.id}>{labels.get(o.id)}</option>)}</select></label>
        <label className="block"><span className="sr-only"><L id="ts.students.status_filter" /></span>
          <select data-status-filter className={fieldClass} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
            {STATUS_FILTERS.map(s => <option key={s} value={s}>{t(statusLabel[s])}</option>)}</select></label>
      </div>

      {(groups.data.state === 'error' || members.failedGroups.length > 0) && <div role="alert" data-state="error" data-groups-failed className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-base">
        <p className="min-w-0 flex-1"><L id="ts.students.groups_unavailable" /></p>
        <button type="button" onClick={() => { if (groups.data.state === 'error') groups.retry(); members.retry(); }} className={plainButton}><L id="tg.retry" /></button></div>}

      {roster.phase === 'loading' && <Loading label="ts.students.loading" className="h-40" />}
      {roster.phase === 'ready' && <>
        {roster.failed.length > 0 && <div role="alert" data-state="error" data-courses-failed className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-base">
          <p className="min-w-0 flex-1"><L id="ts.students.course_failed" values={{ courses: roster.failed.map(o => labels.get(o.id)).join(', ') }} /></p>
          <button type="button" onClick={roster.retryFailed} className={plainButton}><L id="tg.retry" /></button></div>}
        {roster.shown.length === 0 && roster.failed.length === 0 && <div data-state="empty" className="space-y-3"><p className="text-base text-slate-800">
          <L id={status === 'waiting' ? (requests.rows.length ? 'ts.students.waiting_above' : 'ts.students.waiting_none') : query || status !== 'all' || course !== 'all' ? 'ts.students.empty_filter' : 'ts.students.empty'} /></p>
          {!query && status === 'all' && course === 'all' && canInvite && !inviting && <button type="button" data-invite-empty onClick={() => setInviting(true)} className={`${primaryButton} ${tall}`}><L id="ts.students.invite" /></button>}</div>}
        {roster.shown.length > 0 && <ul data-student-list data-tour="student-rows" className="divide-y-2 divide-black/15 border-y-2 border-black/15">{roster.shown.map(e => <StudentItem key={`${e.offering.id}:${e.row.user_id}`} entry={e} label={labels.get(e.offering.id) ?? e.offering.name}
          groupNames={members.index.get(e.row.user_id)?.map(g => g.name)} groupsState={groups.data.state === 'error' || members.failedOfferings.has(e.offering.id) ? 'error' : groups.data.state === 'ready' && !members.loading ? 'ready' : 'loading'} />)}</ul>}
        {roster.capped && <p data-truncated className="text-base text-slate-700"><L id="ts.students.truncated" values={{ count: MAX_ROSTER_PAGES * ROSTER_PAGE }} /></p>}
        {roster.more && <button type="button" data-more-students onClick={roster.loadMore} disabled={roster.loadingMore} className={`${plainButton} ${tall}`}>{roster.loadingMore && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.students.more" /></button>}
      </>}
    </>}
  </div>;
}

function StudentItem({ entry, label, groupNames, groupsState }: { entry: Entry; label: string; groupNames: string[] | undefined; groupsState: 'loading' | 'ready' | 'error' }) {
  const { row, offering } = entry;
  const status = displayStatus(row, Date.now());
  return <li data-student={row.user_id} className="border-black/15">
    <Link href={`/teacher/students/${row.user_id}?course=${offering.id}`} className="flex min-h-[64px] flex-col gap-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black md:flex-row md:items-center md:justify-between md:gap-4">
      <span className="min-w-0 md:flex-1"><span className="block break-words text-base font-bold"><StudentName name={row.display_name} /></span><span className="block break-words text-base text-slate-700"><bdi dir="auto">{label}</bdi></span></span>
      <span className="min-w-0 text-base md:flex-1" data-student-groups>{groupsState === 'error' ? <span className="text-slate-700"><L id="ts.students.groups_unknown" /></span> : groupsState === 'loading' ? <span className="text-slate-700"><L id="ts.students.groups_loading" /></span> : groupNames?.length ? <bdi dir="auto">{groupNames.join(', ')}</bdi> : <span className="text-slate-700"><L id="ts.students.no_group" /></span>}</span>
      <StatusPill status={status} />
    </Link>
  </li>;
}
