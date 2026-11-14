'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/frontend/components/design/button';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader } from '@/frontend/components/design/page-header';
import { StatusPill as Pill } from '@/frontend/components/design/status-pill';
import { L, LocalDate } from '@/frontend/components/language-provider';
import { GroupError, Loading, useCommand } from '@/frontend/features/teacher-groups/parts';
import { StudentBodySkeleton } from './skeletons';
import type { GroupPage } from '@/shared/contracts/groups';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import { MAX_HISTORY_PAGES, MAX_ROSTER_PAGES, ROSTER_PAGE, attendanceCounts, attendanceEntries, courseName, displayStatus, type AttendanceEntry, type HistoryRow, type RosterRow } from '@/shared/teacher-students';
import { adminCall, adminRead, asCallError, groupCall, limited, newRequestId } from './api';
import { useGroupMembers, useGroups, useLoaded, useOfferings, type Loaded } from './data';
import { StatusPill, StudentName, useDate } from './parts';
import { StudentMarks } from '@/frontend/features/teacher-reports/student-marks';

class NotFound extends Error {}

/** The student's row in one course. Rosters are read by name, so the page reads pages until it finds this student. */
async function findRow(offeringId: string, studentId: string): Promise<RosterRow> {
  for (let page = 0; page < MAX_ROSTER_PAGES; page++) {
    const result = await adminRead<{ rows: RosterRow[] }>('roster', { page, search: '', filter: 'all' }, offeringId);
    const row = result.rows.find(r => r.user_id === studentId);
    if (row) return row;
    if (result.rows.length < ROSTER_PAGE) break;
  }
  throw new NotFound();
}

export function StudentDetailView({ studentId, offeringId }: { studentId: string; offeringId: string | null }) {
  const offerings = useOfferings();
  const offering = offerings.data.state === 'ready' && offeringId ? offerings.data.value.find(o => o.id === offeringId) ?? null : null;
  const row = useLoaded<RosterRow | null>(async () => {
    if (!offeringId) return null;
    try { return await findRow(offeringId, studentId); } catch (e) { if (e instanceof NotFound) return null; throw e; }
  });
  const ready = offerings.data.state === 'ready' && row.data.state === 'ready';
  const failed = offerings.data.state === 'error' ? offerings.data : row.data.state === 'error' ? row.data : null;
  const found = ready && offering && row.data.state === 'ready' && row.data.value ? row.data.value : null;
  return <div data-student-page className="d-page">
    {!found && <Link href="/teacher/students" data-back className="d-back d-focus"><Icon name="back" size={16} /><L id="ts.student.back" /></Link>}
    {!ready && !failed && <StudentBodySkeleton />}
    {failed && failed.state === 'error' && <GroupError kind={failed.error.kind} onRetry={() => { if (offerings.data.state === 'error') offerings.retry(); if (row.data.state === 'error') row.retry(); }} />}
    {ready && !found && <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id="ts.student.not_found" /></p></div>}
    {found && offering && <StudentBody key={found.id} studentId={studentId} offering={offering} initial={found} />}
  </div>;
}

function StudentBody({ studentId, offering, initial }: { studentId: string; offering: AdminOffering; initial: RosterRow }) {
  const [row, setRow] = useState(initial);
  const date = useDate();
  const status = displayStatus(row, Date.now());
  return <>
    <PageHeader back={{ href: '/teacher/students', label: <L id="ts.student.back" />, data: { 'data-back': '' } }} title={<StudentName name={row.display_name} />} pill={<StatusPill status={status} />}
      meta={<><span data-student-course><bdi dir="auto">{courseName(offering)}</bdi></span>{row.expires_at && status === 'active' && <> · <L id="ts.student.access_until" values={{ date: date(row.expires_at) }} /></>}</>} />
    {offering.manage && (status === 'active' || status === 'suspended' || status === 'expired') && <AccessChange row={row} offering={offering} status={status} onChanged={next => setRow(r => ({ ...r, ...next }))} />}
    <Groups studentId={studentId} offering={offering} name={row.display_name} />
    <StudentMarks studentId={studentId} offeringId={offering.id} />
  </>;
}

/** Suspend and Reactivate ask first, send the version they read, and say plainly when something else changed meanwhile. */
function AccessChange({ row, offering, status, onChanged }: { row: RosterRow; offering: AdminOffering; status: 'active' | 'suspended' | 'expired'; onChanged: (next: Partial<RosterRow>) => void }) {
  const [asking, setAsking] = useState(false);
  const suspending = status === 'active';
  const { busy, error, run } = useCommand(() => setAsking(false));
  const [attempt] = useState<{ id: string | null }>({ id: null });
  const confirm = () => void run(async () => {
    const requestId = attempt.id ??= newRequestId();
    const result = await adminCall<{ status: string; version: number }>(suspending ? 'suspend' : 'reactivate', suspending ? {} : { expiresAt: null }, { offeringId: offering.id, subjectId: row.user_id, version: row.version, requestId });
    attempt.id = null;
    onChanged({ status: result.status, version: result.version, expires_at: suspending ? row.expires_at : null });
  });
  return <section data-access-change data-tour="student-access" className="d-card d-card--pad d-stack">
    <h2 className="d-section"><L id="ts.student.status" /></h2>
    {!asking && <Button type="button" variant={suspending ? 'secondary' : 'primary'} data-ask-access onClick={() => setAsking(true)}><L id={suspending ? 'ts.student.suspend' : 'ts.student.reactivate'} /></Button>}
    {asking && <div data-access-confirm className="d-stack">
      <p className="d-body"><L id={suspending ? 'ts.student.suspend_confirm' : 'ts.student.reactivate_confirm'} values={{ name: row.display_name?.trim() || '', course: courseName(offering) }} /></p>
      <div className="d-actions">
        <Button type="button" variant={suspending ? 'destructive' : 'primary'} data-confirm-access onClick={confirm} disabled={busy}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={suspending ? 'ts.student.suspend_yes' : 'ts.student.reactivate_yes'} /></Button>
        <Button type="button" data-keep-access onClick={() => setAsking(false)} disabled={busy}><L id="ts.student.keep" /></Button>
      </div>
    </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.kind === 'changed' || error.status === null ? () => window.location.reload() : confirm} retryLabel={error.kind === 'changed' || error.status === null ? 'tg.reload' : 'tg.retry'} pending={busy} />}
  </section>;
}

function Groups({ studentId, offering, name }: { studentId: string; offering: AdminOffering; name: string | null }) {
  const groups = useGroups();
  const groupRows = groups.data.state === 'ready' ? groups.data.value : null;
  const members = useGroupMembers(groupRows, [offering.id]);
  const mine = members.index.get(studentId) ?? [];
  const mineKey = mine.map(g => g.id).join(',');
  const loading = groups.data.state === 'loading' || members.loading;
  const failed = groups.data.state === 'error' || members.failedGroups.length > 0 || members.failedOfferings.has(offering.id);
  return <>
    <section aria-labelledby="ts-student-groups" data-student-groups-section data-tour="student-groups" className="d-card d-card--pad d-stack">
      <h2 id="ts-student-groups" className="d-section"><L id="ts.student.groups" /></h2>
      {loading && <Loading label="tg.loading" className="h-12" />}
      {!loading && failed && <GroupError kind={groups.data.state === 'error' ? groups.data.error.kind : 'unavailable'} onRetry={() => { if (groups.data.state === 'error') groups.retry(); members.retry(); }} />}
      {!loading && !failed && (mine.length === 0
        ? <p data-state="empty" className="d-body"><L id="ts.student.no_groups" /></p>
        : <ul className="d-list">{mine.map(g => <li key={g.id} className="d-row"><Link href={`/teacher/groups/${g.id}`} data-group-link={g.id} className="d-row-link d-focus"><span className="d-row-body d-label d-wrap"><span><bdi dir="auto">{g.name}</bdi></span></span><Icon name="chevron" className="d-chevron" /></Link></li>)}</ul>)}
    </section>
    {!loading && !failed && <Attendance studentId={studentId} groups={mine} key={mineKey} name={name} />}
  </>;
}

/** Date, Group and Present or Absent, newest first, from the existing attendance history of each of the student's Groups. */
function Attendance({ studentId, groups }: { studentId: string; groups: { id: string; name: string }[]; name: string | null }) {
  const [state, setState] = useState<Loaded<{ entries: AttendanceEntry[]; cut: boolean }>>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  const groupsKey = groups.map(g => g.id).join(',');
  useEffect(() => {
    let alive = true;
    setState({ state: 'loading' });
    (async () => {
      const byGroup: Record<string, { name: string; rows: HistoryRow[] }> = {};
      let cut = false;
      await Promise.all(groups.map(async g => {
        const rows: HistoryRow[] = [];
        for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
          const result = await limited(() => groupCall<GroupPage<HistoryRow & { id?: string }>>('view', g.id, { section: 'history', page, search: studentId }));
          rows.push(...result.rows);
          if (result.rows.length < ROSTER_PAGE) break;
          if (page === MAX_HISTORY_PAGES - 1) cut = true;
        }
        byGroup[g.id] = { name: g.name, rows };
      }));
      return { entries: attendanceEntries(byGroup, studentId), cut };
    })().then(value => { if (alive) setState({ state: 'ready', value }); }, e => { if (alive) setState({ state: 'error', error: asCallError(e) }); });
    return () => { alive = false; };
    // the Groups are read by id: a new array with the same Groups must not read everything again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, groupsKey, revision]);
  const counts = useMemo(() => state.state === 'ready' ? attendanceCounts(state.value.entries) : null, [state]);
  return <section aria-labelledby="ts-student-attendance" data-student-attendance data-tour="student-attendance" className="d-card d-card--pad d-stack">
    <h2 id="ts-student-attendance" className="d-section"><L id="ts.student.attendance" /></h2>
    {state.state === 'loading' && <Loading label="tg.loading" className="h-16" />}
    {state.state === 'error' && <GroupError kind={state.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {state.state === 'ready' && (state.value.entries.length === 0
      ? <p data-state="empty" className="d-body"><L id="ts.student.no_attendance" /></p>
      : <>
        {counts && <p data-attendance-counts className="d-label"><L id="ts.student.attendance_summary" values={counts} /></p>}
        <ul className="d-list">{state.value.entries.map(e => <li key={e.sessionId} data-attendance-row className="d-row">
          <span className="d-row-body"><span className="d-label"><LocalDate value={e.startsAt} options={{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }} /></span><span className="d-meta d-wrap"><bdi dir="auto">{e.groupName}</bdi></span></span>
          <Pill tone={e.status === 'attended' ? 'success' : 'danger'} data-attendance-status={e.status}><L id={e.status === 'attended' ? 'ts.student.present' : 'ts.student.absent'} /></Pill>
        </li>)}</ul>
        {state.value.cut && <p data-attendance-cut className="d-meta"><L id="ts.student.attendance_cut" /></p>}</>)}
  </section>;
}
