'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { AttendanceBar } from '@/frontend/components/design/attendance-bar';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Select } from '@/frontend/components/design/controls';
import { SearchField } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { useGroupsAttendance } from '@/frontend/features/teacher-groups/attendance-totals';
import { GroupError } from '@/frontend/features/teacher-groups/parts';
import type { MessageKey } from '@/frontend/locales/messages';
import type { AttendanceTotal } from '@/shared/teacher-groups';
import { MAX_ROSTER_PAGES, ROSTER_PAGE, STATUS_FILTERS, displayStatus, type StatusFilter } from '@/shared/teacher-students';
import { useGroupMembers, useGroups, useOfferings, usePendingRequests, useRosterList, type Entry } from './data';
import { StatusPill, StudentName, courseLabels } from './parts';
import { StudentRowsSkeleton } from './skeletons';
import { RequestsSection, type Notice } from './requests';

const statusLabel: Record<StatusFilter, MessageKey> = {
  all: 'ts.students.status.all', active: 'ts.students.status.active', suspended: 'ts.students.status.suspended', expired: 'ts.students.status.expired',
  completed: 'ts.students.status.completed', cancelled: 'ts.students.status.cancelled', invited: 'ts.students.status.invited', waiting: 'ts.students.status.waiting',
};
const INVITE = '/teacher/students/invite';

/** The teacher's students across their courses, and a join-requests section when someone is waiting. Invite students has its own page. */
export function TeacherStudentsView({ canInvite }: { canInvite: boolean }) {
  const { t } = useLanguage();
  const offerings = useOfferings();
  const groups = useGroups();
  const [course, setCourse] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => { const h = setTimeout(() => setQuery(typed.trim()), 300); return () => clearTimeout(h); }, [typed]);

  const offeringRows = offerings.data.state === 'ready' ? offerings.data.value : null;
  const labels = useMemo(() => courseLabels(offeringRows ?? []), [offeringRows]);
  const roster = useRosterList(offeringRows, course, status, query, revision);
  const requests = usePendingRequests(offeringRows, revision);
  const groupRows = groups.data.state === 'ready' ? groups.data.value : null;
  const shownOfferings = useMemo(() => Array.from(new Set(roster.shown.map(e => e.offering.id))), [roster.shown]);
  const members = useGroupMembers(groupRows, shownOfferings, revision);
  const memberGroupIds = useMemo(() => Array.from(new Set(Array.from(members.index.values()).flat().map(g => g.id))), [members.index]);
  const attendance = useGroupsAttendance(memberGroupIds, revision);

  // The rows on screen narrow as the person types, before the server's answer for that search arrives (the server matches the same way: the typed
  // text anywhere in the name, ignoring case). Once the answer for this search is in, its rows are shown as they are.
  const waitingForSearch = typed.trim() !== query || roster.refreshing;
  const needle = typed.trim().toLowerCase();
  const rows = useMemo(() => waitingForSearch && needle ? roster.shown.filter(e => (e.row.display_name ?? '').toLowerCase().includes(needle)) : roster.shown, [roster.shown, waitingForSearch, needle]);

  const addNotice = (n: Notice) => setNotices(list => [n, ...list.filter(x => x.id !== n.id)].slice(0, 5));
  const noCourses = offerings.data.state === 'ready' && offerings.data.value.length === 0;
  const filtered = Boolean(query) || status !== 'all' || course !== 'all';
  // The header counts only what the screen can vouch for: the whole list, unfiltered and fully read or said to be more.
  const courseCount = offeringRows?.length ?? 0;
  const counted = roster.phase === 'ready' && !filtered && offeringRows !== null && roster.shown.length > 0;
  const meta = counted
    ? <><L id={roster.more || roster.capped ? 'ts.students.count_more' : 'tg.card.students'} values={{ count: new Set(roster.shown.map(e => e.row.user_id)).size }} /> · <L id={courseCount === 1 ? 'ts.students.course_one' : 'ts.students.courses_count'} values={{ count: courseCount }} /></>
    : <L id="ts.students.intro" />;

  return <div data-teacher-students className="d-page">
    <PageHeader title={<L id="ts.students.title" />} meta={meta} primary={canInvite ? { key: 'invite', href: INVITE, label: <L id="ts.students.invite" />, data: { 'data-invite-students': '', 'data-tour': 'invite-students' } } : undefined} />

    {offerings.data.state === 'loading' && <div role="status" data-state="loading" className="d-stack-lg"><div aria-hidden="true" className="d-filters-grid"><DesignSkeleton className="h-11 w-full" /><DesignSkeleton className="h-11 w-full" /><DesignSkeleton className="h-11 w-full" /></div><StudentRowsSkeleton /><span className="sr-only"><L id="ts.students.loading" /></span></div>}
    {offerings.data.state === 'error' && <GroupError kind={offerings.data.error.kind} onRetry={offerings.retry} />}
    {noCourses && <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="ts.students.no_courses" /></p></div>}

    {offeringRows && offeringRows.length > 0 && <>
      <RequestsSection rows={requests.rows} failed={requests.failed.length} more={requests.more.length} labels={labels} groups={groupRows ?? []} groupsError={groups.data.state === 'error'} notices={notices}
        onNotice={addNotice} onCloseNotice={id => setNotices(list => list.filter(n => n.id !== id))} onChanged={id => { requests.drop(id); setRevision(v => v + 1); }} onRetryFailed={() => requests.reload()} />

      <div className="d-filters-grid" data-tour="student-filters">
        <SearchField label={t('ts.students.search')} data-students-search value={typed} onChange={e => setTyped(e.target.value)} maxLength={120} placeholder={t('ts.students.search')} />
        <label className="d-field"><span className="sr-only"><L id="ts.students.course_filter" /></span>
          <Select data-course-filter value={course} onChange={setCourse} options={[{ value: 'all', label: t('ts.students.all_courses') }, ...offeringRows.map(o => ({ value: o.id, label: labels.get(o.id) }))]} /></label>
        <label className="d-field"><span className="sr-only"><L id="ts.students.status_filter" /></span>
          <Select data-status-filter value={status} onChange={v => setStatus(v as StatusFilter)} options={STATUS_FILTERS.map(s => ({ value: s, label: t(statusLabel[s]) }))} /></label>
      </div>

      {(groups.data.state === 'error' || members.failedGroups.length > 0) && <div role="alert" data-state="error" data-groups-failed className="d-alert">
        <p className="d-alert-text"><L id="ts.students.groups_unavailable" /></p>
        <Button type="button" onClick={() => { if (groups.data.state === 'error') groups.retry(); members.retry(); }}><L id="tg.retry" /></Button></div>}

      {roster.phase === 'loading' && <div role="status" data-state="loading"><StudentRowsSkeleton /><span className="sr-only"><L id="ts.students.loading" /></span></div>}
      {roster.phase === 'ready' && <>
        {roster.failed.length > 0 && <div role="alert" data-state="error" data-courses-failed className="d-alert">
          <p className="d-alert-text"><L id="ts.students.course_failed" values={{ courses: roster.failed.map(o => labels.get(o.id)).join(', ') }} /></p>
          <Button type="button" onClick={roster.retryFailed}><L id="tg.retry" /></Button></div>}
        {rows.length === 0 && roster.failed.length === 0 && !waitingForSearch && <div data-state="empty" className="d-card d-card--pad d-stack"><p className="d-body">
          <L id={status === 'waiting' ? (requests.rows.length ? 'ts.students.waiting_above' : 'ts.students.waiting_none') : filtered ? 'ts.students.empty_filter' : 'ts.students.empty'} /></p>
          {!filtered && canInvite && <Link href={INVITE} data-invite-empty className={buttonClass('primary')}><L id="ts.students.invite" /></Link>}</div>}
        {rows.length > 0 && <div className="d-card d-card--pad d-students-list">
          <div aria-hidden="true" className="d-student-head"><span><L id="ts.students.col.name" /></span><span><L id="ts.students.col.group" /></span><span><L id="ts.students.col.attendance" /></span><span><L id="ts.students.col.status" /></span></div>
          <ul data-student-list data-tour="student-rows" className="d-list">{rows.map(e => <StudentItem key={`${e.offering.id}:${e.row.user_id}`} entry={e} label={labels.get(e.offering.id) ?? ''}
            groupNames={members.index.get(e.row.user_id)?.map(g => g.name)} figures={attendance.of(e.row.user_id, members.index.get(e.row.user_id))}
            groupsState={groups.data.state === 'error' || members.failedOfferings.has(e.offering.id) ? 'error' : groups.data.state === 'ready' && !members.loading ? 'ready' : 'loading'} />)}</ul>
        </div>}
        {roster.capped && <p data-truncated className="d-meta"><L id="ts.students.truncated" values={{ count: MAX_ROSTER_PAGES * ROSTER_PAGE }} /></p>}
        {roster.more && !waitingForSearch && <Button type="button" data-more-students onClick={roster.loadMore} disabled={roster.loadingMore}>{roster.loadingMore && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="ts.students.more" /></Button>}
      </>}
    </>}
  </div>;
}

function StudentItem({ entry, label, groupNames, figures, groupsState }: { entry: Entry; label: string; groupNames: string[] | undefined; figures: AttendanceTotal | null; groupsState: 'loading' | 'ready' | 'error' }) {
  const { row, offering } = entry;
  const status = displayStatus(row, Date.now());
  return <li data-student={row.user_id}>
    <Link href={`/teacher/students/${row.user_id}?course=${offering.id}`} className="d-student-link d-focus">
      <Avatar id={row.user_id} name={row.display_name} />
      <span className="d-student-name"><span className="d-label d-wrap"><StudentName name={row.display_name} /></span><span className="d-meta d-wrap" style={{ display: 'block' }}><bdi dir="auto">{label}</bdi></span></span>
      <span className="d-student-groups d-meta d-wrap" data-student-groups>{groupsState === 'error' ? <L id="ts.students.groups_unknown" /> : groupsState === 'loading' ? <L id="ts.students.groups_loading" /> : groupNames?.length ? <bdi dir="auto">{groupNames.join(', ')}</bdi> : <L id="ts.students.no_group" />}</span>
      <span className="d-student-attendance"><AttendanceBar attended={figures?.attended ?? 0} total={figures?.total ?? 0} data-student-attendance={row.user_id} /></span>
      <span className="d-student-status"><StatusPill status={status} /><Icon name="chevron" className="d-chevron" /></span>
    </Link>
  </li>;
}
