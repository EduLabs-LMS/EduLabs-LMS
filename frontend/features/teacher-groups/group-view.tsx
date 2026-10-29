'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { card, inkButton, linkClass, plainButton, primaryButton, sessionTime } from '@/frontend/features/teacher-home/parts';
import { cairoWallTime, sessionDefinition, sessionState, type GroupPage, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';
import { attendanceHref, canTakeAttendance } from '@/shared/teacher-attendance';
import { RECENT_PAST, attendanceSummary, currentMembers, partitionSessions, type WeeklyTime } from '@/shared/teacher-groups';
import { GroupCallError, groupCall, isAbort } from './api';
import { GroupError, Loading, ModeLabel, WeeklyTimes, stateTone } from './parts';

type Detail = { group: StudyGroup; schedules: WeeklyTime[]; serverNow: string };
type Tab = 'sessions' | 'students' | 'details';
const tabs: Tab[] = ['sessions', 'students', 'details'];
const asError = (e: unknown) => e instanceof GroupCallError ? e : new GroupCallError(null);

export function TeacherGroupView({ groupId }: { groupId: string }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<GroupCallError | null>(null);
  const [tab, setTab] = useState<Tab>('sessions');
  const [revision, setRevision] = useState(0);
  const [sessionsRevision, setSessionsRevision] = useState(0);
  const [skew, setSkew] = useState(0);
  const [adding, setAdding] = useState(false);
  const tabId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    groupCall<Detail>('view', groupId, { section: 'detail' }, null, controller.signal).then(d => {
      setDetail(d);
      setSkew(Date.parse(d.serverNow) - Date.now());
    }, e => { if (!isAbort(e)) setError(asError(e)); });
    return () => controller.abort();
  }, [groupId, revision]);
  const reload = useCallback(() => { setRevision(v => v + 1); setSessionsRevision(v => v + 1); }, []);
  const now = Date.now() + skew;

  if (error && !detail) return <Frame><GroupError kind={error.kind} onRetry={() => setRevision(v => v + 1)} /></Frame>;
  if (!detail) return <Frame><Loading label="tg.loading_group" className="h-40" /></Frame>;
  const { group, schedules } = detail;
  const active = group.status === 'active';
  return <Frame>
    <header className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl">{group.name}</h1><p className="text-base text-slate-700">{group.offering_name}</p></div>
        <span data-status={group.status} className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${active ? 'bg-primary' : 'bg-slate-200'}`}><L id={active ? 'tg.status.active' : 'tg.status.archived'} /></span>
      </div>
      <p className="text-base font-bold"><ModeLabel mode={group.mode} /></p>
      {error && <GroupError kind={error.kind} onRetry={() => setRevision(v => v + 1)} retryLabel="tg.reload" />}
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
          e.preventDefault(); setTab(next); document.getElementById(`${tabId}-${next}`)?.focus();
        }}>
          {tabs.map(key => <button key={key} id={`${tabId}-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`${tabId}-panel`} tabIndex={tab === key ? 0 : -1} data-tab={key} onClick={() => setTab(key)}
            className={`${plainButton} ${tab === key ? '!bg-black !text-white' : ''}`}><L id={`tg.tab.${key}`} /></button>)}
        </div>
        <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} className={`${card} space-y-4`}>
          {tab === 'sessions' && <SessionsPanel key={sessionsRevision} group={group} now={now} onChanged={reload} />}
          {tab === 'students' && <StudentsPanel group={group} />}
          {tab === 'details' && <Details group={group} schedules={schedules} />}
        </div>
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

function Details({ group, schedules }: { group: StudyGroup; schedules: WeeklyTime[] }) {
  const none = <span className="text-slate-600"><L id="tg.details.none" /></span>;
  return <div data-group-details className="space-y-4">
    <Facts group={group} schedules={schedules} />
    {group.mode === 'online' && <dl className="text-base"><dt className="font-bold"><L id="tg.details.join" /></dt><dd className="break-all">{group.join_url ? <a href={group.join_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{group.join_url}</a> : none}</dd></dl>}
    <dl className="text-base"><dt className="font-bold"><L id="tg.details.instructions" /></dt><dd className="whitespace-pre-line break-words">{group.instructions || none}</dd></dl>
  </div>;
}

type Rows<T> = { state: 'loading' } | { state: 'error'; error: GroupCallError } | { state: 'ready'; rows: T[]; hasMore: boolean; page: number; catchingUp: boolean; more: 'idle' | 'loading' | GroupCallError };

/** Reads a paged list from the Group, appending further pages on request. Each panel has its own loading, error and retry. */
function usePaged<T extends { id?: string; user_id?: string }>(groupId: string, section: 'sessions' | 'members') {
  const [data, setData] = useState<Rows<T>>({ state: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData({ state: 'loading' });
    groupCall<GroupPage<T>>('view', groupId, { section, page: 0, search: '' }, null, controller.signal)
      .then(r => setData({ state: 'ready', rows: r.rows, hasMore: Boolean(r.hasMore), page: 0, catchingUp: Boolean(r.catchingUp), more: 'idle' }), e => { if (!isAbort(e)) setData({ state: 'error', error: asError(e) }); });
    return () => controller.abort();
  }, [groupId, section, revision]);
  const more = useCallback(async () => {
    if (data.state !== 'ready' || data.more === 'loading') return;
    setData({ ...data, more: 'loading' });
    try {
      const r = await groupCall<GroupPage<T>>('view', groupId, { section, page: data.page + 1, search: '' });
      const key = (x: T) => x.id ?? x.user_id;
      const seen = new Set(data.rows.map(key));
      setData({ state: 'ready', rows: [...data.rows, ...r.rows.filter(x => !seen.has(key(x)))], hasMore: Boolean(r.hasMore), page: data.page + 1, catchingUp: data.catchingUp, more: 'idle' });
    } catch (e) { setData({ ...data, more: asError(e) }); }
  }, [data, groupId, section]);
  return { data, retry: () => setRevision(v => v + 1), more };
}

function SessionsPanel({ group, now, onChanged }: { group: StudyGroup; now: number; onChanged: () => void }) {
  const { data, retry, more } = usePaged<GroupSession>(group.id, 'sessions');
  const [older, setOlder] = useState(false);
  const parts = useMemo(() => data.state === 'ready' ? partitionSessions(data.rows, now) : null, [data, now]);
  if (data.state === 'loading') return <Loading label="tg.loading_sessions" className="h-32" />;
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
  return <li data-session={s.id} data-state={state} className="space-y-2 rounded-2xl border-2 border-black bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-base font-bold break-words">{s.title}</p><p className="text-base text-slate-700"><LocalDate value={s.starts_at} options={sessionTime} /></p></div>
      <span className={`inline-flex min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold ${stateTone[state]}`}><L id={`tg.state.${state}`} /></span>
    </div>
    {att !== 'none' && <p data-attendance={att} className="text-base text-slate-700"><L id={`tg.att.${att}`} /></p>}
    {canTakeAttendance(s, now) && <Link href={attendanceHref(group.id, s.id)} data-attendance-link className={linkClass}><L id="ta.open" /></Link>}
    {canCancel && state === 'upcoming' && <CancelSession s={s} group={group} onDone={onChanged} />}
  </li>;
}

/** Everything that changes data asks first, sends the version it read, and says plainly when the reply never came. */
function useCommand(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GroupCallError | null>(null);
  const run = async (job: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await job(); onDone(); } catch (e) { setError(asError(e)); } finally { setBusy(false); }
  };
  return { busy, error, run, clear: () => setError(null) };
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

function StudentsPanel({ group }: { group: StudyGroup }) {
  const { data, retry, more } = usePaged<GroupRow>(group.id, 'members');
  if (data.state === 'loading') return <Loading label="tg.loading_students" className="h-32" />;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const students = currentMembers(data.rows);
  if (!students.length && !data.hasMore) return <div data-state="empty"><p className="text-base text-slate-800"><L id="tg.students.empty" /></p></div>;
  return <div data-group-students className="space-y-3">
    <p className="text-base font-bold" data-students-total>{data.hasMore ? <L id="tg.card.students_more" values={{ count: students.length }} /> : group.capacity ? <L id="tg.card.students_of" values={{ count: students.length, capacity: group.capacity }} /> : <L id="tg.card.students" values={{ count: students.length }} />}</p>
    <ul className="divide-y-2 divide-black/15">{students.map(r => <li key={r.id ?? r.user_id} className="min-h-[44px] py-3 text-base break-words">{r.display_name}</li>)}</ul>
    {data.hasMore && <button type="button" data-more-students className={plainButton} disabled={data.more === 'loading'} onClick={() => void more()}>{data.more === 'loading' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tg.students.more" /></button>}
    {data.more instanceof GroupCallError && <GroupError kind={data.more.kind} onRetry={() => void more()} />}
  </div>;
}
