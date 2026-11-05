'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSwr } from '@/frontend/lib/use-swr';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { card, inkButton, linkClass, plainButton, primaryButton, sessionTime } from '@/frontend/features/teacher-home/parts';
import { cairoWallTime, sessionDefinition, sessionState, type GroupPage, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';
import { attendanceHref, canTakeAttendance } from '@/shared/teacher-attendance';
import { RECENT_PAST, attendanceSummary, currentMembers, partitionSessions, studentsByName, type WeeklyTime } from '@/shared/teacher-groups';
import { GroupCallError, groupCall, isAbort } from './api';
import { EditGroup } from './group-form';
import { GroupError, Loading, ModeLabel, WeeklyTimes, asError, stateTone, useCommand } from './parts';
import { GroupBodySkeleton, PanelSkeleton } from './skeletons';

type Detail = { group: StudyGroup; schedules: WeeklyTime[]; serverNow: string };
/** The Group as read, with how far the server clock was from this browser's clock when it was read (kept with the copy, so a revisit still shows the right "now"). */
type Viewed = Detail & { skew: number };
type Tab = 'sessions' | 'students' | 'details';
const tabs: Tab[] = ['sessions', 'students', 'details'];

export function TeacherGroupView({ groupId }: { groupId: string }) {
  const { t } = useLanguage();
  // Stale-while-revalidate: a revisit shows the last copy at once and reads again in the background (frontend/lib/swr-cache.ts).
  const read = useCallback((signal: AbortSignal) => groupCall<Detail>('view', groupId, { section: 'detail' }, null, signal).then((d): Viewed => ({ ...d, skew: Date.parse(d.serverNow) - Date.now() })), [groupId]);
  const { data: viewed, retry, mutate } = useSwr<Viewed, GroupCallError>(`group:${groupId}:detail`, read, asError);
  const [tab, setTab] = useState<Tab>('sessions');
  // A tab is built the first time it is opened and then stays, hidden, so going back to it is instant and keeps what was loaded.
  const [opened, setOpened] = useState<Tab[]>(['sessions']);
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const tabId = useId();
  const select = useCallback((next: Tab) => { setTab(next); setOpened(o => o.includes(next) ? o : [...o, next]); }, []);
  const reload = useCallback(() => { retry(); setRevision(v => v + 1); }, [retry]);

  if (viewed.state === 'error') return <Frame><GroupError kind={viewed.error.kind} onRetry={retry} /></Frame>;
  if (viewed.state === 'loading') return <Frame><GroupBodySkeleton /></Frame>;
  const detail = viewed.value;
  const now = Date.now() + detail.skew;
  const { group, schedules } = detail;
  const active = group.status === 'active';
  return <Frame>
    <header className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl">{group.name}</h1><p className="text-base text-slate-700">{group.offering_name}</p></div>
        <span data-status={group.status} className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${active ? 'bg-primary' : 'bg-slate-200'}`}><L id={active ? 'tg.status.active' : 'tg.status.archived'} /></span>
      </div>
      <p className="text-base font-bold"><ModeLabel mode={group.mode} /></p>
      {active && group.staff && <div className="flex flex-wrap gap-3 pt-1">
        <button type="button" data-add-session onClick={() => setAdding(v => !v)} aria-expanded={adding} className={primaryButton}><L id="tg.add.button" /></button>
        {group.instructor && <ArchiveGroup group={group} onDone={reload} />}
      </div>}
    </header>
    {adding && active && <AddSession group={group} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div role="tablist" aria-label={t('tg.tabs.label')} className="flex gap-2 overflow-x-auto" onKeyDown={e => {
          const i = tabs.indexOf(tab), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!step) return;
          const rtl = document.documentElement.dir === 'rtl', next = tabs[(i + (rtl ? -step : step) + tabs.length) % tabs.length];
          e.preventDefault(); select(next); document.getElementById(`${tabId}-${next}`)?.focus();
        }}>
          {tabs.map(key => <button key={key} id={`${tabId}-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`${tabId}-${key}`} tabIndex={tab === key ? 0 : -1} data-tab={key} onClick={() => select(key)}
            className={`${plainButton} ${tab === key ? '!bg-black !text-white' : ''}`}><L id={`tg.tab.${key}`} /></button>)}
        </div>
        {tabs.map(key => opened.includes(key) && <div key={key} role="tabpanel" id={`${tabId}-${key}`} aria-labelledby={`${tabId}-${key}`} hidden={tab !== key} data-panel={key} className={`${card} space-y-4`}>
          {key === 'sessions' && <SessionsPanel group={group} now={now} revision={revision} onChanged={reload} />}
          {key === 'students' && <StudentsPanel group={group} revision={revision} onVersion={version => mutate({ ...detail, group: { ...detail.group, version } })} onStale={reload} />}
          {key === 'details' && <Details group={group} schedules={schedules} onChanged={reload} />}
        </div>)}
      </div>
      <aside aria-labelledby={`${tabId}-glance`} data-group-panel className={`${card} hidden h-fit space-y-3 lg:block`}>
        <h2 id={`${tabId}-glance`} className="font-display text-xl"><L id="tg.panel.title" /></h2>
        <Facts group={group} schedules={schedules} />
      </aside>
    </div>
  </Frame>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div data-teacher-group className="w-full space-y-5">
    <Link href="/teacher/groups" className={linkClass}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /><span className="ms-2"><L id="tg.back" /></span></Link>
    {children}
  </div>;
}

function Facts({ group, schedules }: { group: StudyGroup; schedules: WeeklyTime[] }) {
  return <dl className="space-y-3 text-base">
    <div><dt className="font-bold"><L id="tg.details.weekly" /></dt><dd><WeeklyTimes items={schedules} /></dd></div>
    <div><dt className="font-bold"><L id="tg.details.place" /></dt><dd><ModeLabel mode={group.mode} />{group.mode === 'center' && group.location && <span className="block break-words">{group.location}</span>}</dd></div>
    <div><dt className="font-bold"><L id="tg.details.capacity" /></dt><dd>{group.capacity ?? <L id="tg.details.unlimited" />}</dd></div>
  </dl>;
}

function Details({ group, schedules, onChanged }: { group: StudyGroup; schedules: WeeklyTime[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const none = <span className="text-slate-600"><L id="tg.details.none" /></span>;
  if (editing) return <EditGroup group={group} schedules={schedules} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }} />;
  return <div data-group-details className="space-y-4">
    {group.status === 'active' && group.instructor && <button type="button" data-edit-group data-tour="edit-group" onClick={() => setEditing(true)} className={`${plainButton} !min-h-[48px]`}><L id="tg.edit.button" /></button>}
    <Facts group={group} schedules={schedules} />
    {group.mode === 'online' && <dl className="text-base"><dt className="font-bold"><L id="tg.details.join" /></dt><dd className="break-all">{group.join_url ? <a href={group.join_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{group.join_url}</a> : none}</dd></dl>}
    <dl className="text-base"><dt className="font-bold"><L id="tg.details.instructions" /></dt><dd className="whitespace-pre-line break-words">{group.instructions || none}</dd></dl>
  </div>;
}

type Rows<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; rows: T[]; hasMore: boolean; page: number; catchingUp: boolean; more: 'idle' | 'loading' | GroupCallError };
type More<T> = { base: GroupPage<T>; rows: T[]; hasMore: boolean; page: number; state: 'idle' | 'loading' | GroupCallError };

/**
 * Reads a paged list from the Group, appending further pages on request. The first page is a stale-while-revalidate read (a revisit shows the last
 * copy at once); further pages are only ever read on request. `revision` changes when something on the screen changed: the list is read again
 * without being blanked. Each panel has its own loading, error and retry.
 */
function usePaged<T extends { id?: string; user_id?: string }>(groupId: string, section: 'sessions' | 'members', revision: number) {
  const read = useCallback((signal: AbortSignal) => groupCall<GroupPage<T>>('view', groupId, { section, page: 0, search: '' }, null, signal), [groupId, section]);
  const first = useSwr<GroupPage<T>, GroupCallError>(`group:${groupId}:${section}:first`, read, asError);
  const [extra, setExtra] = useState<More<T> | null>(null);
  const seen = useRef(revision);
  const { retry } = first;
  useEffect(() => { if (seen.current !== revision) { seen.current = revision; retry(); } }, [revision, retry]);
  const key = (x: T) => x.id ?? x.user_id;
  const base = first.data.state === 'ready' ? first.data.value : null;
  // Pages appended to a first page that has since been read again are dropped with it: the list starts over from the fresh first page.
  const live = extra && extra.base === base ? extra : null;
  const data = useMemo<Rows<T>>(() => {
    if (first.data.state !== 'ready') return first.data.state === 'error' ? { state: 'error', error: first.data.error } : { state: 'loading' };
    const page = first.data.value;
    return { state: 'ready', rows: live ? [...page.rows, ...live.rows] : page.rows, hasMore: live ? live.hasMore : Boolean(page.hasMore), page: live ? live.page : 0, catchingUp: Boolean(page.catchingUp), more: live ? live.state : 'idle' };
  }, [first.data, live]);
  const more = useCallback(async () => {
    if (!base || data.state !== 'ready' || data.more === 'loading') return;
    const prior: More<T> = live ?? { base, rows: [], hasMore: Boolean(base.hasMore), page: 0, state: 'idle' };
    setExtra({ ...prior, state: 'loading' });
    try {
      const r = await groupCall<GroupPage<T>>('view', groupId, { section, page: prior.page + 1, search: '' });
      const known = new Set([...base.rows, ...prior.rows].map(key));
      setExtra({ base, rows: [...prior.rows, ...r.rows.filter(x => !known.has(key(x)))], hasMore: Boolean(r.hasMore), page: prior.page + 1, state: 'idle' });
    } catch (e) { setExtra({ ...prior, state: asError(e) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, data, groupId, section, live]);
  return { data, retry, refresh: retry, more };
}

function SessionsPanel({ group, now, revision, onChanged }: { group: StudyGroup; now: number; revision: number; onChanged: () => void }) {
  const { data, retry, more } = usePaged<GroupSession>(group.id, 'sessions', revision);
  const [older, setOlder] = useState(false);
  const parts = useMemo(() => data.state === 'ready' ? partitionSessions(data.rows, now) : null, [data, now]);
  if (data.state === 'loading') return <div role="status" data-state="loading"><PanelSkeleton /><span className="sr-only"><L id="tg.loading_sessions" /></span></div>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const { upcoming, earlier } = parts!;
  const visibleEarlier = older ? earlier : earlier.slice(0, RECENT_PAST);
  const canOlder = !older && (earlier.length > RECENT_PAST || data.hasMore);
  if (!upcoming.length && !earlier.length) return <div data-state="empty" className="space-y-2">
    <p className="text-base text-slate-800"><L id={data.catchingUp ? 'tg.sessions.catching_up' : 'tg.sessions.empty'} /></p>
  </div>;
  const canCancel = group.staff && group.status === 'active';
  return <div data-group-sessions className="space-y-5">
    {data.catchingUp && <p role="status" className="text-base text-slate-700"><L id="tg.sessions.catching_up" /></p>}
    <section aria-labelledby={`up-${group.id}`} className="space-y-3"><h2 id={`up-${group.id}`} className="font-display text-xl"><L id="tg.sessions.upcoming" /></h2>
      {upcoming.length ? <ul className="space-y-3">{upcoming.map(s => <SessionItem key={s.id} s={s} now={now} group={group} canCancel={canCancel} onChanged={onChanged} />)}</ul> : <p className="text-base text-slate-700"><L id="tg.sessions.none_upcoming" /></p>}
    </section>
    {visibleEarlier.length > 0 && <section aria-labelledby={`past-${group.id}`} className="space-y-3"><h2 id={`past-${group.id}`} className="font-display text-xl"><L id="tg.sessions.earlier" /></h2>
      <ul className="space-y-3">{visibleEarlier.map(s => <SessionItem key={s.id} s={s} now={now} group={group} canCancel={false} onChanged={onChanged} />)}</ul></section>}
    {canOlder && <button type="button" data-see-older className={plainButton} onClick={() => { setOlder(true); if (data.hasMore && earlier.length <= RECENT_PAST) void more(); }}><L id="tg.sessions.see_older" /></button>}
    {older && data.hasMore && <button type="button" data-more-sessions className={plainButton} disabled={data.more === 'loading'} onClick={() => void more()}>{data.more === 'loading' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.sessions.more" /></button>}
    {data.more instanceof GroupCallError && <GroupError kind={data.more.kind} onRetry={() => void more()} />}
  </div>;
}

function SessionItem({ s, now, group, canCancel, onChanged }: { s: GroupSession; now: number; group: StudyGroup; canCancel: boolean; onChanged: () => void }) {
  const state = sessionState(s, now), att = attendanceSummary(s, now);
  const opens = canTakeAttendance(s, now), { t } = useLanguage();
  return <li data-session={s.id} data-state={state} className="space-y-2 rounded-2xl border-2 border-black bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      {opens
        ? <Link href={attendanceHref(group.id, s.id)} data-attendance-link aria-label={`${s.title}. ${t('ta.open')}`} className="min-h-[48px] min-w-0 flex-1 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"><p className="text-base font-bold break-words">{s.title}</p><p className="text-base text-slate-700"><LocalDate value={s.starts_at} options={sessionTime} /></p></Link>
        : <div className="min-w-0"><p className="text-base font-bold break-words">{s.title}</p><p className="text-base text-slate-700"><LocalDate value={s.starts_at} options={sessionTime} /></p></div>}
      <span className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${stateTone[state]}`}><L id={`tg.state.${state}`} /></span>
    </div>
    {att !== 'none' && <p data-attendance={att} className="text-base text-slate-700"><L id={`tg.att.${att}`} /></p>}
    {canCancel && state === 'upcoming' && <CancelSession s={s} group={group} onDone={onChanged} />}
  </li>;
}

function CancelSession({ s, group, onDone }: { s: GroupSession; group: StudyGroup; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useCommand(onDone);
  return <div className="space-y-2">
    {!confirm ? <button type="button" data-cancel-session onClick={() => setConfirm(true)} className={plainButton}><L id="tg.cancel.button" /></button>
      : <div role="group" aria-label={s.title} className="space-y-2 rounded-xl border-2 border-black bg-amber-50 p-3">
        <p className="text-base"><L id="tg.cancel.confirm" /></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-confirm-cancel disabled={busy} className={inkButton} onClick={() => run(() => groupCall('session', group.id, { sessionId: s.id, sessionVersion: s.version, operation: 'cancel' }))}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.cancel.yes" /></button>
          <button type="button" disabled={busy} className={plainButton} onClick={() => setConfirm(false)}><L id="tg.cancel.keep" /></button>
        </div>
      </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
  </div>;
}

function ArchiveGroup({ group, onDone }: { group: StudyGroup; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useCommand(() => { setConfirm(false); onDone(); });
  return <div className="space-y-2">
    {!confirm ? <button type="button" data-archive onClick={() => setConfirm(true)} className={plainButton}><L id="tg.archive.button" /></button>
      : <div role="group" aria-label={group.name} className="space-y-2 rounded-xl border-2 border-black bg-amber-50 p-3">
        <p className="text-base"><L id="tg.archive.confirm" /></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-confirm-archive disabled={busy} className={inkButton} onClick={() => run(() => groupCall('archive', group.id, {}, group.version))}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.archive.yes" /></button>
          <button type="button" disabled={busy} className={plainButton} onClick={() => setConfirm(false)}><L id="tg.archive.keep" /></button>
        </div>
      </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
  </div>;
}

const input = 'min-h-[44px] w-full rounded-xl border-2 border-black bg-white px-3 text-base';

/** A one-off Session on a Cairo date and time. The browser's time zone never matters (cairoWallTime), the database checks the rest. */
function AddSession({ group, onClose, onDone }: { group: StudyGroup; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const id = useId();
  const [title, setTitle] = useState(''), [date, setDate] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [problem, setProblem] = useState<'title' | 'time' | 'dst' | null>(null);
  const { busy, error, run } = useCommand(onDone);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let startsAt: string, endsAt: string;
    try { startsAt = cairoWallTime(`${date}T${start}`); endsAt = cairoWallTime(`${date}T${end}`); }
    catch (x) { setProblem(/daylight/.test((x as Error).message) ? 'dst' : 'time'); return; }
    if (!title.trim()) { setProblem('title'); return; }
    const parsed = sessionDefinition.safeParse({ title: title.trim(), startsAt, endsAt });
    if (!parsed.success) { setProblem('time'); return; }
    setProblem(null);
    void run(() => groupCall('one-off', group.id, parsed.data, group.version));
  }
  return <form data-add-session-form onSubmit={submit} noValidate className={`${card} space-y-4`}>
    <h2 className="font-display text-xl"><L id="tg.add.button" /></h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block space-y-1 sm:col-span-2" htmlFor={`${id}-t`}><span className="font-bold"><L id="tg.add.title" /></span><input id={`${id}-t`} className={input} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} aria-invalid={problem === 'title'} aria-describedby={problem ? `${id}-p` : undefined} required /></label>
      <label className="block space-y-1 sm:col-span-2" htmlFor={`${id}-d`}><span className="font-bold"><L id="tg.add.date" /></span><input id={`${id}-d`} type="date" className={input} value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className="block space-y-1" htmlFor={`${id}-s`}><span className="font-bold"><L id="tg.add.start" /></span><input id={`${id}-s`} type="time" className={input} value={start} onChange={e => setStart(e.target.value)} required /></label>
      <label className="block space-y-1" htmlFor={`${id}-e`}><span className="font-bold"><L id="tg.add.end" /></span><input id={`${id}-e`} type="time" className={input} value={end} onChange={e => setEnd(e.target.value)} required /></label>
    </div>
    {problem && <p id={`${id}-p`} role="alert" className="text-base font-bold text-rose-800"><L id={problem === 'title' ? 'tg.add.title_required' : problem === 'dst' ? 'tg.add.dst' : 'tg.add.bad_time'} /></p>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={busy} className={primaryButton}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.add.save" /></button>
      <button type="button" disabled={busy} className={plainButton} onClick={onClose} aria-label={t('tg.add.close')}><L id="tg.add.close" /></button>
    </div>
  </form>;
}

function StudentsPanel({ group, revision, onVersion, onStale }: { group: StudyGroup; revision: number; onVersion: (version: number) => void; onStale: () => void }) {
  const { data, retry, refresh, more } = usePaged<GroupRow>(group.id, 'members', revision);
  const [adding, setAdding] = useState(false);
  if (data.state === 'loading') return <div role="status" data-state="loading"><PanelSkeleton /><span className="sr-only"><L id="tg.loading_students" /></span></div>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const students = studentsByName(currentMembers(data.rows));
  const canChange = group.status === 'active' && group.staff;
  const changed = (version: number) => { onVersion(version); refresh(); };
  const full = group.capacity !== null && !data.hasMore && students.length >= group.capacity;
  return <div data-group-students className="space-y-3">
    {!students.length && !data.hasMore
      ? <div data-state="empty" className="space-y-3"><p className="text-base text-slate-800"><L id="tg.students.empty" /></p>{group.instructor && group.status === 'active' && <Link href={`/teacher/students?invite=${group.offering_id}`} data-invite-from-group data-tour="invite-students" className={`${primaryButton} !min-h-[48px]`}><L id="ts.students.invite" /></Link>}</div>
      : <p className="text-base font-bold" data-students-total>{data.hasMore ? <L id="tg.card.students_more" values={{ count: students.length }} /> : group.capacity ? <L id="tg.card.students_of" values={{ count: students.length, capacity: group.capacity }} /> : <L id="tg.card.students" values={{ count: students.length }} />}</p>}
    {canChange && !adding && <button type="button" data-add-student data-tour="add-student" onClick={() => setAdding(true)} className={`${primaryButton} !min-h-[48px]`}><L id="tg.students.add" /></button>}
    {canChange && adding && <AddStudents group={group} present={students.map(r => r.user_id)} full={full} onAdded={changed} onStale={onStale} onClose={() => setAdding(false)} />}
    {students.length > 0 && <ul data-tour="student-rows" className="divide-y-2 divide-black/15">{students.map(r => <StudentRow key={r.id ?? r.user_id} row={r} group={group} canChange={canChange} onRemoved={changed} onStale={onStale} />)}</ul>}
    {data.hasMore && <button type="button" data-more-students className={plainButton} disabled={data.more === 'loading'} onClick={() => void more()}>{data.more === 'loading' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.students.more" /></button>}
    {data.more instanceof GroupCallError && <GroupError kind={data.more.kind} onRetry={() => void more()} />}
  </div>;
}

function StudentRow({ row, group, canChange, onRemoved, onStale }: { row: GroupRow; group: StudyGroup; canChange: boolean; onRemoved: (version: number) => void; onStale: () => void }) {
  const { t } = useLanguage();
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useCommand(() => setConfirm(false));
  return <li data-student={row.user_id} className="space-y-2 py-3">
    <div className="flex min-h-[48px] items-center justify-between gap-3">
      <span className="min-w-0 text-base break-words"><bdi>{row.display_name}</bdi></span>
      {canChange && !confirm && <button type="button" data-remove-student data-tour="remove-student" aria-label={t('tg.students.remove_named', { name: row.display_name })} onClick={() => setConfirm(true)} className={`${plainButton} !min-h-[48px] shrink-0`}><L id="tg.students.remove" /></button>}
    </div>
    {confirm && <div role="group" aria-label={row.display_name} className="space-y-2">
      <p className="text-base"><L id="tg.students.remove_confirm" values={{ name: row.display_name }} /></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-confirm-remove disabled={busy} className={`${inkButton} !min-h-[48px]`} onClick={() => run(async () => onRemoved((await groupCall<{ version: number }>('remove', group.id, { userId: row.user_id }, group.version)).version))}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.students.remove_yes" /></button>
        <button type="button" disabled={busy} className={`${plainButton} !min-h-[48px]`} onClick={() => setConfirm(false)}><L id="tg.students.remove_keep" /></button>
      </div>
    </div>}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onStale : undefined} retryLabel="tg.reload" />}
  </li>;
}

type Eligible = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; rows: GroupRow[]; hasMore: boolean; page: number; more: 'idle' | 'loading' | GroupCallError };

/** Students who already have access to this course (the existing `eligible` read); the database re-checks access and capacity on every Add. */
function AddStudents({ group, present, full, onAdded, onStale, onClose }: { group: StudyGroup; present: string[]; full: boolean; onAdded: (version: number) => void; onStale: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [list, setList] = useState<Eligible>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { busy, error, run } = useCommand(() => setBusyId(null));
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setList({ state: 'loading' });
    groupCall<GroupPage<GroupRow>>('view', group.id, { section: 'eligible', page: 0, search: query }, null, controller.signal)
      .then(r => setList({ state: 'ready', rows: r.rows, hasMore: Boolean(r.hasMore), page: 0, more: 'idle' }), e => { if (!isAbort(e)) setList({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [group.id, query, revision]);
  async function loadMore() {
    if (list.state !== 'ready' || list.more === 'loading') return;
    setList({ ...list, more: 'loading' });
    try {
      const r = await groupCall<GroupPage<GroupRow>>('view', group.id, { section: 'eligible', page: list.page + 1, search: query });
      const seen = new Set(list.rows.map(x => x.user_id));
      setList({ state: 'ready', rows: [...list.rows, ...r.rows.filter(x => !seen.has(x.user_id))], hasMore: Boolean(r.hasMore), page: list.page + 1, more: 'idle' });
    } catch (e) { setList({ ...list, more: asError(e) }); }
  }
  const rows = list.state === 'ready' ? list.rows.filter(r => !present.includes(r.user_id)) : [];
  return <section data-add-students data-tour="eligible-students" className="space-y-3 border-y-2 border-black/15 py-3">
    <label className="relative block"><span className="sr-only"><L id="tg.students.search" /></span>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2" />
      <input type="search" data-student-search value={search} maxLength={160} placeholder={t('tg.students.search')} onChange={e => setSearch(e.target.value)} className="min-h-[48px] w-full rounded-2xl border-2 border-black bg-white ps-10 pe-3 text-base" /></label>
    {full && <p data-group-full className="text-base font-bold"><L id="tg.students.full" /></p>}
    {list.state === 'loading' && <Loading label="tg.students.loading_eligible" className="h-16" />}
    {list.state === 'error' && <GroupError kind={list.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {list.state === 'ready' && !rows.length && !list.hasMore && <p data-state="empty" className="text-base text-slate-800"><L id={query ? 'tg.students.none_match' : 'tg.students.none_eligible'} /></p>}
    {rows.length > 0 && <ul className="divide-y-2 divide-black/15">{rows.map(r => <li key={r.user_id} data-eligible={r.user_id} className="flex min-h-[48px] items-center justify-between gap-3 py-2">
      <span className="min-w-0 text-base break-words"><bdi>{r.display_name}</bdi></span>
      <button type="button" data-add-one aria-label={t('tg.students.add_named', { name: r.display_name })} disabled={busy || full} onClick={() => { setBusyId(r.user_id); void run(async () => onAdded((await groupCall<{ version: number }>('add', group.id, { userId: r.user_id }, group.version)).version)); }} className={`${plainButton} !min-h-[48px] shrink-0`}>{busyId === r.user_id && busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.students.add_one" /></button>
    </li>)}</ul>}
    {list.state === 'ready' && list.hasMore && <button type="button" data-more-eligible disabled={list.more === 'loading'} onClick={() => void loadMore()} className={`${plainButton} !min-h-[48px]`}>{list.more === 'loading' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.students.more_eligible" /></button>}
    {list.state === 'ready' && list.more instanceof GroupCallError && <GroupError kind={list.more.kind} onRetry={() => void loadMore()} />}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="tg.students.add_failed" onRetry={error.status === null || error.kind === 'changed' ? onStale : undefined} retryLabel="tg.reload" />}
    <button type="button" data-close-add onClick={onClose} className={`${plainButton} !min-h-[48px]`}><L id="tg.students.close" /></button>
  </section>;
}
