'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { usePageLoadingSignal } from '@/frontend/components/providers/use-page-loading-signal';
import { L, LocalDate } from '@/frontend/components/language-provider';
import { inkButton, linkClass, plainButton } from '@/frontend/features/teacher-home/parts';
import { GroupError, Loading, useCommand } from '@/frontend/features/teacher-groups/parts';
import type { GroupPage } from '@/shared/contracts/groups';
import type { AdminOffering } from '@/shared/contracts/student-administration';
import { MAX_HISTORY_PAGES, MAX_ROSTER_PAGES, ROSTER_PAGE, attendanceCounts, attendanceEntries, courseName, displayStatus, type AttendanceEntry, type HistoryRow, type RosterRow } from '@/shared/teacher-students';
import { adminCall, adminRead, asCallError, groupCall, limited, newRequestId } from './api';
import { useGroupMembers, useGroups, useLoaded, useOfferings, type Loaded } from './data';
import { StatusPill, StudentName, useDate } from './parts';

const tall = '!min-h-[48px]';
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
  // The first view is the student, their course and status; the Groups and attendance below fill in after and say so while they do.
  usePageLoadingSignal(offerings.data.state === 'loading' || row.data.state === 'loading');
  const back = <Link href="/teacher/students" data-back className={linkClass}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><span className="ms-2"><L id="ts.student.back" /></span></Link>;
  const failed = offerings.data.state === 'error' ? offerings.data : row.data.state === 'error' ? row.data : null;
  return <div data-student-page className="w-full max-w-3xl space-y-5">
    {back}
    {!ready && !failed && <Loading label="ts.student.loading" className="h-40" />}
    {failed && failed.state === 'error' && <GroupError kind={failed.error.kind} onRetry={() => { if (offerings.data.state === 'error') offerings.retry(); if (row.data.state === 'error') row.retry(); }} />}
    {ready && (!offering || row.data.state !== 'ready' || !row.data.value)
      ? <div data-state="empty" className="space-y-3"><p className="text-base text-slate-800"><L id="ts.student.not_found" /></p></div>
      : ready && offering && row.data.state === 'ready' && row.data.value && <StudentBody key={row.data.value.id} studentId={studentId} offering={offering} initial={row.data.value} />}
  </div>;
}

function StudentBody({ studentId, offering, initial }: { studentId: string; offering: AdminOffering; initial: RosterRow }) {
  const [row, setRow] = useState(initial);
  const date = useDate();
  const status = displayStatus(row, Date.now());
  return <>
    <header className="space-y-2">
      <h1 className="font-display text-3xl leading-tight lg:text-4xl"><StudentName name={row.display_name} /></h1>
      <dl className="grid gap-x-6 gap-y-1 text-base sm:grid-cols-[auto_1fr]">
        <dt className="font-bold"><L id="ts.student.course" /></dt><dd data-student-course><bdi dir="auto">{courseName(offering)}</bdi></dd>
        <dt className="font-bold"><L id="ts.student.status" /></dt><dd><StatusPill status={status} />{row.expires_at && status === 'active' && <span className="ms-2 text-slate-700"><L id="ts.student.access_until" values={{ date: date(row.expires_at) }} /></span>}</dd>
      </dl>
    </header>
    {offering.manage && (status === 'active' || status === 'suspended' || status === 'expired') && <AccessChange row={row} offering={offering} status={status} onChanged={next => setRow(r => ({ ...r, ...next }))} />}
    <Groups studentId={studentId} offering={offering} name={row.display_name} />
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
  return <section data-access-change data-tour="student-access" className="space-y-3 border-y-2 border-black/15 py-4">
    {!asking && <button type="button" data-ask-access onClick={() => setAsking(true)} className={`${suspending ? plainButton : inkButton} ${tall}`}><L id={suspending ? 'ts.student.suspend' : 'ts.student.reactivate'} /></button>}
    {asking && <div data-access-confirm className="space-y-3">
      <p className="text-base"><L id={suspending ? 'ts.student.suspend_confirm' : 'ts.student.reactivate_confirm'} values={{ name: row.display_name?.trim() || '', course: courseName(offering) }} /></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-confirm-access onClick={confirm} disabled={busy} className={`${inkButton} ${tall}`}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={suspending ? 'ts.student.suspend_yes' : 'ts.student.reactivate_yes'} /></button>
        <button type="button" data-keep-access onClick={() => setAsking(false)} disabled={busy} className={`${plainButton} ${tall}`}><L id="ts.student.keep" /></button>
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
    <section aria-labelledby="ts-student-groups" data-student-groups-section data-tour="student-groups" className="space-y-2">
      <h2 id="ts-student-groups" className="font-display text-2xl leading-tight"><L id="ts.student.groups" /></h2>
      {loading && <Loading label="tg.loading" className="h-12" />}
      {!loading && failed && <GroupError kind={groups.data.state === 'error' ? groups.data.error.kind : 'unavailable'} onRetry={() => { if (groups.data.state === 'error') groups.retry(); members.retry(); }} />}
      {!loading && !failed && (mine.length === 0
        ? <p data-state="empty" className="text-base text-slate-800"><L id="ts.student.no_groups" /></p>
        : <ul className="divide-y-2 divide-black/15 border-y-2 border-black/15">{mine.map(g => <li key={g.id}><Link href={`/teacher/groups/${g.id}`} data-group-link={g.id} className="flex min-h-[48px] items-center py-2 text-base font-bold underline-offset-4 hover:underline"><bdi dir="auto">{g.name}</bdi></Link></li>)}</ul>)}
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
  return <section aria-labelledby="ts-student-attendance" data-student-attendance data-tour="student-attendance" className="space-y-2">
    <h2 id="ts-student-attendance" className="font-display text-2xl leading-tight"><L id="ts.student.attendance" /></h2>
    {state.state === 'loading' && <Loading label="tg.loading" className="h-16" />}
    {state.state === 'error' && <GroupError kind={state.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {state.state === 'ready' && (state.value.entries.length === 0
      ? <p data-state="empty" className="text-base text-slate-800"><L id="ts.student.no_attendance" /></p>
      : <>
        {counts && <p data-attendance-counts className="text-base font-bold"><L id="ts.student.attendance_summary" values={counts} /></p>}
        <ul className="divide-y-2 divide-black/15 border-y-2 border-black/15">{state.value.entries.map(e => <li key={e.sessionId} data-attendance-row className="flex min-h-[56px] items-center justify-between gap-3 py-2">
          <span className="min-w-0"><span className="block text-base font-bold"><LocalDate value={e.startsAt} options={{ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }} /></span><span className="block break-words text-base text-slate-700"><bdi dir="auto">{e.groupName}</bdi></span></span>
          <span data-attendance-status={e.status} className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${e.status === 'attended' ? 'bg-primary' : 'bg-rose-100'}`}><L id={e.status === 'attended' ? 'ts.student.present' : 'ts.student.absent'} /></span>
        </li>)}</ul>
        {state.value.cut && <p data-attendance-cut className="text-base text-slate-700"><L id="ts.student.attendance_cut" /></p>}</>)}
  </section>;
}
