'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSwr } from '@/frontend/lib/use-swr';
import { Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { ActionMenu, type MenuAction } from '@/frontend/components/design/action-menu';
import { AttendanceBar } from '@/frontend/components/design/attendance-bar';
import { Avatar } from '@/frontend/components/design/avatar';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Countdown } from '@/frontend/components/design/countdown';
import { DateTile } from '@/frontend/components/design/date-tile';
import { Dialog } from '@/frontend/components/design/dialog';
import { Field, SearchField } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { PageHeader, type HeaderAction } from '@/frontend/components/design/page-header';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { Tabs } from '@/frontend/components/design/tabs';
import { sessionTime } from '@/frontend/features/teacher-home/parts';
import { cairoWallTime, sessionDefinition, sessionState, type GroupPage, type GroupRow, type GroupSession, type StudyGroup } from '@/shared/contracts/groups';
import { attendanceHref, canTakeAttendance } from '@/shared/teacher-attendance';
import { ATTENDANCE_PAGES, NEEDS_SHOWN, attendanceSummary, attendanceTotals, cairoFields, currentMembers, groupSessions, inviteHref, studentsByName, type WeeklyTime } from '@/shared/teacher-groups';
import { GroupCallError, groupCall, isAbort, limited } from './api';
import { useCourseTitles } from './course-titles';
import { EditGroup } from './group-form';
import { GroupError, Loading, ModeLabel, ModePill, WeeklyTimes, asError, useCommand } from './parts';
import { GroupBodySkeleton, PanelSkeleton } from './skeletons';

type Detail = { group: StudyGroup; schedules: WeeklyTime[]; serverNow: string };
/** The Group as read, with how far the server clock was from this browser's clock when it was read (kept with the copy, so a revisit still shows the right "now"). */
type Viewed = Detail & { skew: number };
type Tab = 'sessions' | 'students' | 'details';
const tabs: Tab[] = ['sessions', 'students', 'details'];

const Busy = ({ on }: { on: boolean }) => on ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null;

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
  const [archiving, setArchiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const members = usePaged<GroupRow>(groupId, 'members', revision);
  const titles = useCourseTitles();
  const select = useCallback((next: Tab) => { setTab(next); setOpened(o => o.includes(next) ? o : [...o, next]); }, []);
  const reload = useCallback(() => { retry(); setRevision(v => v + 1); }, [retry]);
  const startEditing = useCallback(() => { select('details'); setEditing(true); }, [select]);
  // The Groups list links here to add weekly times. Whether this person may edit is checked where the form is drawn.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('edit') === '1') startEditing(); }, [startEditing]);

  if (viewed.state === 'error') return <Frame><GroupError kind={viewed.error.kind} onRetry={retry} /></Frame>;
  if (viewed.state === 'loading') return <Frame><GroupBodySkeleton /></Frame>;
  const detail = viewed.value;
  const now = Date.now() + detail.skew;
  const { group, schedules } = detail;
  const active = group.status === 'active';
  const course = titles.get(group.offering_id);
  const count = members.data.state === 'ready' ? currentMembers(members.data.rows).length : null;
  const more = members.data.state === 'ready' && members.data.hasMore;
  const canInvite = active && group.instructor;
  const secondary: HeaderAction[] = canInvite ? [{ key: 'invite', href: inviteHref(group.offering_id), label: <L id="tg.invite" />, data: { 'data-invite-group': '' } }] : [];
  const menu: HeaderAction[] = active && group.instructor ? [
    { key: 'edit', onClick: startEditing, label: <L id="tg.edit.button" />, data: { 'data-menu-edit': '' } },
    { key: 'archive', onClick: () => setArchiving(true), destructive: true, label: <L id="tg.archive.button" />, data: { 'data-archive': '' } },
  ] : [];
  const meta = [
    course ? <bdi key="course" dir="auto" data-group-course>{course}</bdi> : null,
    <span key="weekly" data-weekly-times><WeeklyTimes items={schedules} /></span>,
    group.mode === 'center' && group.location ? <bdi key="place" dir="auto">{group.location}</bdi> : <ModeLabel key="place" mode={group.mode} />,
    count === null ? null : <span key="students" data-header-students><L id={more ? 'tg.card.students_more' : 'tg.card.students'} values={{ count }} /></span>,
  ].filter(Boolean);
  return <div data-teacher-group className="d-page">
    <PageHeader back={{ href: '/teacher/groups', label: <L id="tg.back" /> }} title={<bdi dir="auto">{group.name}</bdi>}
      pill={<StatusPill tone={active ? 'success' : 'neutral'} data-status={group.status}><L id={active ? 'tg.status.active' : 'tg.status.archived'} /></StatusPill>}
      meta={<>{meta.map((part, i) => <Fragment key={i}>{i > 0 && ' · '}{part}</Fragment>)}</>}
      secondary={secondary} menu={menu} stickySecondary
      primary={active && group.staff ? { key: 'add', onClick: () => setAdding(true), label: <L id="tg.add.button" />, data: { 'data-add-session': '' } } : undefined} />
    <Dialog open={adding} onOpenChange={setAdding} title={<L id="tg.add.button" />}><AddSession group={group} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} /></Dialog>
    <ArchiveGroup group={group} open={archiving} onOpenChange={setArchiving} onDone={() => { setArchiving(false); reload(); }} />
    <Tabs label={t('tg.tabs.label')} active={tab} onSelect={key => select(key as Tab)} items={tabs.map(key => ({ key, 'data-tab': key, label: key === 'students' && count !== null && !more ? <L id="tg.tab.students_count" values={{ count }} /> : <L id={`tg.tab.${key}`} /> }))} />
    {tabs.map(key => opened.includes(key) && <div key={key} role="tabpanel" aria-label={t(`tg.tab.${key}`)} hidden={tab !== key} data-panel={key} className="d-stack-lg">
      {key === 'sessions' && <SessionsPanel group={group} now={now} revision={revision} onChanged={reload} />}
      {key === 'students' && <StudentsPanel group={group} members={members} revision={revision} onVersion={version => mutate({ ...detail, group: { ...detail.group, version } })} onStale={reload} />}
      {key === 'details' && <Details group={group} schedules={schedules} editing={editing} onEditing={setEditing} onChanged={reload} />}
    </div>)}
  </div>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div data-teacher-group className="d-page">
    <Link href="/teacher/groups" className="d-back d-focus"><Icon name="back" size={16} /><L id="tg.back" /></Link>
    {children}
  </div>;
}

function Details({ group, schedules, editing, onEditing, onChanged }: { group: StudyGroup; schedules: WeeklyTime[]; editing: boolean; onEditing: (on: boolean) => void; onChanged: () => void }) {
  const none = <span className="d-meta"><L id="tg.details.none" /></span>;
  if (editing && group.status === 'active' && group.instructor) return <section className="d-card d-card--pad"><EditGroup group={group} schedules={schedules} onClose={() => onEditing(false)} onDone={() => { onEditing(false); onChanged(); }} /></section>;
  return <section data-group-details className="d-card d-card--pad d-stack">
    <dl className="d-dl">
      <div><dt><L id="tg.details.weekly" /></dt><dd><WeeklyTimes items={schedules} /></dd></div>
      <div><dt><L id="tg.details.place" /></dt><dd className="d-stack-sm"><ModePill mode={group.mode} />{group.mode === 'center' && group.location && <span className="d-wrap"><bdi dir="auto">{group.location}</bdi></span>}</dd></div>
      <div><dt><L id="tg.details.capacity" /></dt><dd>{group.capacity ?? <L id="tg.details.unlimited" />}</dd></div>
      {group.mode === 'online' && <div><dt><L id="tg.details.join" /></dt><dd className="d-wrap-all">{group.join_url ? <a href={group.join_url} target="_blank" rel="noopener noreferrer" className="d-inline-link">{group.join_url}</a> : none}</dd></div>}
      <div><dt><L id="tg.details.instructions" /></dt><dd className="d-wrap d-pre">{group.instructions || none}</dd></div>
    </dl>
    {group.status === 'active' && group.instructor && <Button type="button" data-edit-group data-tour="edit-group" onClick={() => onEditing(true)}><L id="tg.edit.button" /></Button>}
  </section>;
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

function SessionSection({ id, label, children }: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  return <section aria-labelledby={`sessions-${id}`} data-session-group={id} className="d-card d-card--pad">
    <h2 id={`sessions-${id}`} className="d-section-label">{label}</h2>
    <ul className="d-list">{children}</ul>
  </section>;
}

function SessionsPanel({ group, now, revision, onChanged }: { group: StudyGroup; now: number; revision: number; onChanged: () => void }) {
  const { data, retry, more } = usePaged<GroupSession>(group.id, 'sessions', revision);
  // The list stays on screen while it is read again (no skeleton flash), so each row is keyed by the read it belongs to: Reload and every change start the rows afresh (no stale confirm question or failure message).
  const [older, setOlder] = useState(false);
  const [allNeeds, setAllNeeds] = useState(false);
  const parts = useMemo(() => data.state === 'ready' ? groupSessions(data.rows, now) : null, [data, now]);
  if (data.state === 'loading') return <div role="status" data-state="loading" className="d-card d-card--pad"><PanelSkeleton /><span className="sr-only"><L id="tg.loading_sessions" /></span></div>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const { now: live, needs, upcoming, past } = parts!;
  if (!live.length && !needs.length && !upcoming.length && !past.length) return <div data-state="empty" className="d-card d-card--pad"><p className="d-body"><L id={data.catchingUp ? 'tg.sessions.catching_up' : 'tg.sessions.empty'} /></p></div>;
  const canCancel = group.staff && group.status === 'active';
  const shownNeeds = allNeeds ? needs : needs.slice(0, NEEDS_SHOWN);
  const item = (s: GroupSession, strong: boolean) => <SessionItem key={revision + ':' + s.id} s={s} now={now} group={group} strong={strong} canCancel={canCancel} onChanged={onChanged} />;
  return <div data-group-sessions className="d-stack-lg">
    {data.catchingUp && <p role="status" className="d-body"><L id="tg.sessions.catching_up" /></p>}
    {live.length > 0 && <SessionSection id="now" label={<L id="tg.pill.now" />}>{live.map(s => item(s, true))}</SessionSection>}
    {needs.length > 0 && <SessionSection id="needs" label={<L id="tg.sessions.needs" />}>
      {shownNeeds.map(s => item(s, true))}
      {needs.length > shownNeeds.length && <li className="d-row-more"><Button type="button" variant="tertiary" data-more-needs onClick={() => setAllNeeds(true)}><L id="tg.sessions.show_more" values={{ count: needs.length - shownNeeds.length }} /></Button></li>}
    </SessionSection>}
    {upcoming.length > 0
      ? <SessionSection id="upcoming" label={<L id="tg.sessions.upcoming" />}>{upcoming.map(s => item(s, false))}</SessionSection>
      : <p className="d-meta"><L id="tg.sessions.none_upcoming" /></p>}
    {(past.length > 0 || data.hasMore) && <div className="d-stack">
      <Button type="button" variant="tertiary" data-see-older aria-expanded={older} onClick={() => { setOlder(v => !v); if (!older && data.hasMore && !past.length) void more(); }}>
        <Icon name="chevron" size={16} className={older ? 'd-rotate-90' : undefined} /><L id={data.hasMore ? 'tg.sessions.past_more' : 'tg.sessions.past'} values={{ count: past.length }} />
      </Button>
      {older && past.length > 0 && <SessionSection id="past" label={<L id="tg.sessions.earlier" />}>{past.map(s => item(s, false))}</SessionSection>}
      {older && data.hasMore && <Button type="button" data-more-sessions disabled={data.more === 'loading'} onClick={() => void more()}><Busy on={data.more === 'loading'} /><L id="tg.sessions.more" /></Button>}
    </div>}
    {data.more instanceof GroupCallError && <GroupError kind={data.more.kind} onRetry={() => void more()} />}
  </div>;
}

function SessionItem({ s, now, group, strong, canCancel, onChanged }: { s: GroupSession; now: number; group: StudyGroup; strong: boolean; canCancel: boolean; onChanged: () => void }) {
  const state = sessionState(s, now), att = attendanceSummary(s, now);
  const opens = canTakeAttendance(s, now), { t } = useLanguage();
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | null>(null);
  const actions: MenuAction[] = canCancel && state === 'upcoming' ? [
    { key: 'reschedule', label: <L id="tg.reschedule.button" />, onSelect: () => setDialog('reschedule'), data: { 'data-reschedule-session': '' } },
    { key: 'cancel', label: <L id="tg.cancel.button" />, destructive: true, onSelect: () => setDialog('cancel'), data: { 'data-cancel-session': '' } },
  ] : [];
  return <li data-session={s.id} data-state={state} className="d-row d-session">
    <DateTile value={s.starts_at} />
    <div className="d-row-body">
      <p className="d-label d-wrap"><bdi dir="auto">{s.title}</bdi></p>
      <p className="d-meta"><LocalDate value={s.starts_at} options={sessionTime} />{state === 'upcoming' && <> · <Countdown startsAt={s.starts_at} now={now} /></>}</p>
      {att !== 'none' && (att !== 'opens' || state === 'upcoming') && <p data-attendance={att} className="d-meta"><L id={`tg.att.${att}`} /></p>}
    </div>
    <div className="d-row-trailing">
      {state === 'ongoing' && <StatusPill tone="success" dot><L id="tg.state.ongoing" /></StatusPill>}
      {state === 'cancelled' && <StatusPill tone="danger"><L id="tg.state.cancelled" /></StatusPill>}
      {opens && <Link href={attendanceHref(group.id, s.id)} data-attendance-link aria-label={`${s.title}. ${t(strong ? 'tg.session.take' : 'ta.open')}`} className={buttonClass(strong ? 'primary' : 'secondary')}><L id={strong ? 'tg.session.take' : 'ta.open'} /></Link>}
      {actions.length > 0 && <ActionMenu items={actions} label={t('tg.session.menu', { name: s.title })} triggerData={{ 'data-session-menu': '' }} />}
    </div>
    {actions.length > 0 && <>
      <CancelSession s={s} group={group} open={dialog === 'cancel'} onOpenChange={on => setDialog(on ? 'cancel' : null)} onDone={onChanged} />
      <Dialog open={dialog === 'reschedule'} onOpenChange={on => setDialog(on ? 'reschedule' : null)} title={<L id="tg.reschedule.title" />} description={<bdi dir="auto">{s.title}</bdi>}>
        <RescheduleSession s={s} group={group} now={now} onClose={() => setDialog(null)} onDone={onChanged} />
      </Dialog>
    </>}
  </li>;
}

function CancelSession({ s, group, open, onOpenChange, onDone }: { s: GroupSession; group: StudyGroup; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const { busy, error, run, clear } = useCommand(onDone);
  return <Dialog open={open} onOpenChange={on => { if (!on) clear(); onOpenChange(on); }} title={<bdi dir="auto">{s.title}</bdi>} description={<L id="tg.cancel.confirm" />}
    footer={<>
      <Button type="button" disabled={busy} data-keep-session onClick={() => onOpenChange(false)}><L id="tg.cancel.keep" /></Button>
      <Button type="button" variant="destructive" data-confirm-cancel disabled={busy} onClick={() => void run(() => groupCall('session', group.id, { sessionId: s.id, sessionVersion: s.version, operation: 'cancel' }))}><Busy on={busy} /><L id="tg.cancel.yes" /></Button>
    </>}>
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
  </Dialog>;
}

function ArchiveGroup({ group, open, onOpenChange, onDone }: { group: StudyGroup; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const { busy, error, run, clear } = useCommand(onDone);
  return <Dialog open={open} onOpenChange={on => { if (!on) clear(); onOpenChange(on); }} title={<bdi dir="auto">{group.name}</bdi>} description={<L id="tg.archive.confirm" />}
    footer={<>
      <Button type="button" disabled={busy} onClick={() => onOpenChange(false)}><L id="tg.archive.keep" /></Button>
      <Button type="button" variant="destructive" data-confirm-archive disabled={busy} onClick={() => void run(() => groupCall('archive', group.id, {}, group.version))}><Busy on={busy} /><L id="tg.archive.yes" /></Button>
    </>}>
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
  </Dialog>;
}

type TimeProblem = 'title' | 'time' | 'dst' | null;
const timeProblem = (x: unknown): TimeProblem => /daylight/.test((x as Error).message) ? 'dst' : 'time';

/** A date and two times on the Cairo clock, shared by Add a Session and Reschedule. */
function TimeFields({ date, start, end, onDate, onStart, onEnd, problem }: { date: string; start: string; end: string; onDate: (v: string) => void; onStart: (v: string) => void; onEnd: (v: string) => void; problem: TimeProblem }) {
  return <>
    <Field type="date" label={<L id="tg.add.date" />} value={date} onChange={e => onDate(e.target.value)} required />
    <div className="d-field-pair">
      <Field type="time" label={<L id="tg.add.start" />} value={start} onChange={e => onStart(e.target.value)} required />
      <Field type="time" label={<L id="tg.add.end" />} value={end} onChange={e => onEnd(e.target.value)} required />
    </div>
    {problem && problem !== 'title' && <p role="alert" className="d-field-error"><L id={problem === 'dst' ? 'tg.add.dst' : 'tg.add.bad_time'} /></p>}
  </>;
}

/** A one-off Session on a Cairo date and time. The browser's time zone never matters (cairoWallTime), the database checks the rest. */
function AddSession({ group, onClose, onDone }: { group: StudyGroup; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''), [date, setDate] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [problem, setProblem] = useState<TimeProblem>(null);
  const { busy, error, run } = useCommand(onDone);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let startsAt: string, endsAt: string;
    try { startsAt = cairoWallTime(`${date}T${start}`); endsAt = cairoWallTime(`${date}T${end}`); }
    catch (x) { setProblem(timeProblem(x)); return; }
    if (!title.trim()) { setProblem('title'); return; }
    const parsed = sessionDefinition.safeParse({ title: title.trim(), startsAt, endsAt });
    if (!parsed.success) { setProblem('time'); return; }
    setProblem(null);
    void run(() => groupCall('one-off', group.id, parsed.data, group.version));
  }
  return <form data-add-session-form onSubmit={submit} noValidate className="d-stack-form">
    <Field label={<L id="tg.add.title" />} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} required error={problem === 'title' ? <L id="tg.add.title_required" /> : undefined} />
    <TimeFields date={date} start={start} end={end} onDate={setDate} onStart={setStart} onEnd={setEnd} problem={problem} />
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
    <div className="d-dialog-footer">
      <Button type="button" disabled={busy} onClick={onClose}><L id="tg.add.close" /></Button>
      <Button type="submit" variant="primary" disabled={busy}><Busy on={busy} /><L id="tg.add.save" /></Button>
    </div>
  </form>;
}

/** A new Cairo date and time for an upcoming Session, through the same `session` command as Cancel. The database refuses a Session that has started or has a saved roster. */
function RescheduleSession({ s, group, now, onClose, onDone }: { s: GroupSession; group: StudyGroup; now: number; onClose: () => void; onDone: () => void }) {
  const from = cairoFields(s.starts_at), to = cairoFields(s.ends_at);
  const [date, setDate] = useState(from.date), [start, setStart] = useState(from.time), [end, setEnd] = useState(to.time);
  const [problem, setProblem] = useState<TimeProblem>(null);
  const { busy, error, run } = useCommand(onDone);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let startsAt: string, endsAt: string;
    try { startsAt = cairoWallTime(`${date}T${start}`); endsAt = cairoWallTime(`${date}T${end}`); }
    catch (x) { setProblem(timeProblem(x)); return; }
    if (!sessionDefinition.safeParse({ title: s.title, startsAt, endsAt }).success || Date.parse(startsAt) <= now) { setProblem('time'); return; }
    setProblem(null);
    void run(() => groupCall('session', group.id, { sessionId: s.id, sessionVersion: s.version, operation: 'reschedule', startsAt, endsAt }));
  }
  return <form data-reschedule-form onSubmit={submit} noValidate className="d-stack-form">
    <TimeFields date={date} start={start} end={end} onDate={setDate} onStart={setStart} onEnd={setEnd} problem={problem} />
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onDone : undefined} retryLabel="tg.reload" />}
    <div className="d-dialog-footer">
      <Button type="button" disabled={busy} onClick={onClose}><L id="tg.reschedule.keep" /></Button>
      <Button type="submit" variant="primary" data-confirm-reschedule disabled={busy}><Busy on={busy} /><L id="tg.reschedule.save" /></Button>
    </div>
  </form>;
}

type Totals = { totals: ReadonlyMap<string, { attended: number; total: number }>; truncated: boolean };

/** How each student has attended, added up from the Group's attendance history (the existing staff read). No read holds these totals, and a Group larger than the cap shows a dash rather than a wrong number. */
function useAttendanceTotals(groupId: string, enabled: boolean, revision: number) {
  const read = useCallback(async (signal: AbortSignal): Promise<Totals> => {
    if (!enabled) return { totals: new Map(), truncated: false };
    const rows: GroupRow[] = [];
    for (let page = 0; page < ATTENDANCE_PAGES; page++) {
      const result = await limited(() => groupCall<GroupPage<GroupRow>>('view', groupId, { section: 'history', page, search: '' }, null, signal));
      rows.push(...result.rows);
      if (!result.hasMore) return { totals: attendanceTotals(rows), truncated: false };
    }
    return { totals: new Map(), truncated: true };
  }, [groupId, enabled]);
  const swr = useSwr<Totals, GroupCallError>(`group:${groupId}:attendance`, read, asError);
  const seen = useRef(revision);
  const { retry } = swr;
  useEffect(() => { if (seen.current !== revision) { seen.current = revision; retry(); } }, [revision, retry]);
  return swr;
}

function StudentsPanel({ group, members, revision, onVersion, onStale }: { group: StudyGroup; members: ReturnType<typeof usePaged<GroupRow>>; revision: number; onVersion: (version: number) => void; onStale: () => void }) {
  const { data, retry, refresh, more } = members;
  const [adding, setAdding] = useState(false);
  const attendance = useAttendanceTotals(group.id, group.staff, revision);
  if (data.state === 'loading') return <div role="status" data-state="loading" className="d-card d-card--pad"><PanelSkeleton /><span className="sr-only"><L id="tg.loading_students" /></span></div>;
  if (data.state === 'error') return <GroupError kind={data.error.kind} onRetry={retry} />;
  const students = studentsByName(currentMembers(data.rows));
  const canChange = group.status === 'active' && group.staff;
  const changed = (version: number) => { onVersion(version); refresh(); };
  const full = group.capacity !== null && !data.hasMore && students.length >= group.capacity;
  const empty = !students.length && !data.hasMore;
  return <div data-group-students className="d-card d-card--pad d-stack">
    {empty
      ? <div data-state="empty" className="d-stack"><p className="d-body"><L id="tg.students.empty" /></p>{group.instructor && group.status === 'active' && <Link href={inviteHref(group.offering_id)} data-invite-from-group data-tour="invite-students" className={buttonClass('primary')}><L id="ts.students.invite" /></Link>}</div>
      : <div className="d-toolbar d-toolbar--full">
        <p className="d-label" data-students-total>{data.hasMore ? <L id="tg.card.students_more" values={{ count: students.length }} /> : group.capacity ? <L id="tg.card.students_of" values={{ count: students.length, capacity: group.capacity }} /> : <L id="tg.card.students" values={{ count: students.length }} />}</p>
        {canChange && <Button type="button" data-add-student data-tour="add-student" onClick={() => setAdding(true)}><L id="tg.students.add" /></Button>}
      </div>}
    {empty && canChange && <Button type="button" data-add-student data-tour="add-student" onClick={() => setAdding(true)}><L id="tg.students.add" /></Button>}
    {canChange && <Dialog open={adding} onOpenChange={setAdding} title={<L id="tg.students.add" />}><AddStudents group={group} present={students.map(r => r.user_id)} full={full} onAdded={changed} onStale={onStale} onClose={() => setAdding(false)} /></Dialog>}
    {attendance.data.state === 'error' && <GroupError kind={attendance.data.error.kind} onRetry={attendance.retry} />}
    {students.length > 0 && <ul data-tour="student-rows" className="d-list d-stretch">{students.map(r => <StudentRow key={r.id ?? r.user_id} row={r} group={group} canChange={canChange} attendance={attendance.data} onRemoved={changed} onStale={onStale} />)}</ul>}
    {data.hasMore && <Button type="button" data-more-students disabled={data.more === 'loading'} onClick={() => void more()}><Busy on={data.more === 'loading'} /><L id="tg.students.more" /></Button>}
    {data.more instanceof GroupCallError && <GroupError kind={data.more.kind} onRetry={() => void more()} />}
  </div>;
}

function StudentRow({ row, group, canChange, attendance, onRemoved, onStale }: { row: GroupRow; group: StudyGroup; canChange: boolean; attendance: ReturnType<typeof useAttendanceTotals>['data']; onRemoved: (version: number) => void; onStale: () => void }) {
  const { t } = useLanguage();
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run, clear } = useCommand(() => setConfirm(false));
  const figures = attendance.state === 'ready' ? attendance.value.totals.get(row.user_id) : undefined;
  return <li data-student={row.user_id} className="d-row">
    <Avatar id={row.user_id} name={row.display_name} />
    <div className="d-student-body">
      <span className="d-label d-wrap"><bdi>{row.display_name}</bdi></span>
      {attendance.state === 'loading'
        ? <span aria-hidden="true"><DesignSkeleton className="h-4 w-24" /></span>
        : attendance.state === 'ready' && <AttendanceBar attended={figures?.attended ?? 0} total={figures?.total ?? 0} data-student-attendance={row.user_id} />}
    </div>
    {canChange && <ActionMenu label={t('tg.students.remove_named', { name: row.display_name })} triggerData={{ 'data-student-menu': '', 'data-tour': 'remove-student' }} items={[{ key: 'remove', label: <L id="tg.students.remove" />, destructive: true, onSelect: () => setConfirm(true), data: { 'data-remove-student': '' } }]} />}
    <Dialog open={confirm} onOpenChange={on => { if (!on) clear(); setConfirm(on); }} title={<bdi>{row.display_name}</bdi>} description={<L id="tg.students.remove_confirm" values={{ name: row.display_name }} />}
      footer={<>
        <Button type="button" disabled={busy} onClick={() => setConfirm(false)}><L id="tg.students.remove_keep" /></Button>
        <Button type="button" variant="destructive" data-confirm-remove disabled={busy} onClick={() => void run(async () => onRemoved((await groupCall<{ version: number }>('remove', group.id, { userId: row.user_id }, group.version)).version))}><Busy on={busy} /><L id="tg.students.remove_yes" /></Button>
      </>}>
      {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} onRetry={error.status === null || error.kind === 'changed' ? onStale : undefined} retryLabel="tg.reload" />}
    </Dialog>
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
  return <section data-add-students data-tour="eligible-students" className="d-stack-form">
    <SearchField label={t('tg.students.search')} value={search} maxLength={160} placeholder={t('tg.students.search')} onChange={e => setSearch(e.target.value)} data-student-search />
    {full && <p data-group-full className="d-label"><L id="tg.students.full" /></p>}
    {list.state === 'loading' && <Loading label="tg.students.loading_eligible" className="h-16" />}
    {list.state === 'error' && <GroupError kind={list.error.kind} onRetry={() => setRevision(v => v + 1)} />}
    {list.state === 'ready' && !rows.length && !list.hasMore && <p data-state="empty" className="d-body"><L id={query ? 'tg.students.none_match' : 'tg.students.none_eligible'} /></p>}
    {rows.length > 0 && <ul className="d-list">{rows.map(r => <li key={r.user_id} data-eligible={r.user_id} className="d-row">
      <Avatar id={r.user_id} name={r.display_name} />
      <span className="d-row-body d-label d-wrap"><bdi>{r.display_name}</bdi></span>
      <Button type="button" data-add-one aria-label={t('tg.students.add_named', { name: r.display_name })} disabled={busy || full} onClick={() => { setBusyId(r.user_id); void run(async () => onAdded((await groupCall<{ version: number }>('add', group.id, { userId: r.user_id }, group.version)).version)); }}><Busy on={busyId === r.user_id && busy} /><L id="tg.students.add_one" /></Button>
    </li>)}</ul>}
    {list.state === 'ready' && list.hasMore && <Button type="button" data-more-eligible disabled={list.more === 'loading'} onClick={() => void loadMore()}><Busy on={list.more === 'loading'} /><L id="tg.students.more_eligible" /></Button>}
    {list.state === 'ready' && list.more instanceof GroupCallError && <GroupError kind={list.more.kind} onRetry={() => void loadMore()} />}
    {error && <GroupError kind={error.kind} unknownOutcome={error.status === null} invalidText="tg.students.add_failed" onRetry={error.status === null || error.kind === 'changed' ? onStale : undefined} retryLabel="tg.reload" />}
    <div className="d-dialog-footer"><Button type="button" data-close-add onClick={onClose}><L id="tg.students.close" /></Button></div>
  </section>;
}
