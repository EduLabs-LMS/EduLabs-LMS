'use client';
import { useCallback, useEffect, useState } from 'react';
import { Users, MapPin, Video } from 'lucide-react';
import { useGroupSummary } from './use-group-summary';
import { GroupSummaryPanel } from './group-summary-panel';
import GroupRosterView from '@/frontend/features/groups/group-roster-view';
import { nextSession, sessionState } from '@/shared/contracts/groups';
import type { GroupDefinition, StudyGroup, GroupSession, GroupRow, GroupPage } from '@/shared/contracts/groups';
import Link from 'next/link';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useLiveClassOn } from '@/frontend/features/live-class/use-live-class';
import { classHref, isLiveClass, liveClassAhead } from '@/shared/live-class';
const panel = 'relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm';
const field = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900';
const button = 'rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-50';
type Offering = {
    id: string;
    name: string;
};
async function request<T>(action: string, groupId: string | null, data: object = {}, version: number | null = null): Promise<T> {
    const r = await fetch('/api/study-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, groupId, version, data }) });
    const result = await r.json();
    if (!r.ok)
        throw Object.assign(Error(result.error || 'Group operation failed'), { status: r.status });
    return result;
}
export function GroupWorkspace({ initial, initialOfferings }: {
    initial: GroupPage<StudyGroup>;
    initialOfferings: GroupPage<Offering>;
}) {
    const [list, setList] = useState(initial), [selected, setSelected] = useState<StudyGroup | null>(null), [sessions, setSessions] = useState<GroupPage<GroupSession>>({ rows: [], page: 0 }), [records, setRecords] = useState<GroupPage<GroupRow>>({ rows: [], page: 0 }), [section, setSection] = useState('history');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [search, setSearch] = useState(''), [memberSearch, setMemberSearch] = useState(''), [now, setNow] = useState<number | null>(null), [clock, setClock] = useState({ server: 0, client: 0 }), [ownHistory, setOwnHistory] = useState<GroupPage<GroupRow> | null>(null);
    const [filter, setFilter] = useState('');
    // The student's language for every word and date on this page; dates in Cairo time.
    const { t, language } = useLanguage();
    const sessionLabel = (iso: string) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
    const attendanceText = (status: string) => t(status === 'attended' ? 'gw.att.attended' : status === 'absent' ? 'gw.att.absent' : 'gw.att.pending');
    const sessionText = (state: string) => t(state === 'cancelled' ? 'gw.session.cancelled' : state === 'completed' ? 'gw.session.completed' : state === 'ongoing' ? 'gw.session.ongoing' : 'gw.session.upcoming');
    const markingText = (state: string) => t(state === 'finalized' ? 'gw.marking.finalized' : state === 'reopened' ? 'gw.marking.reopened' : 'gw.marking.draft');
    const summary = useGroupSummary(true, selected?.id ?? null);
    const listSection = filter ? 'offering:' + filter : 'sessions';
    const effectiveSection = section;
    const loadDetail = useCallback(async (groupId: string) => {
        const detail = await request<{
            group: StudyGroup;
            schedules: GroupDefinition['schedules'];
            serverNow: string;
        }>('view', groupId, { section: 'detail' });
        setSelected(detail.group);
        setClock({ server: Date.parse(detail.serverNow), client: Date.now() });

    }, []);
    const loadSessions = useCallback(async (groupId: string, page = 0) => {
        const v = await request<GroupPage<GroupSession>>('view', groupId, { section: 'sessions', page });
        setSessions(v);
        if (v.serverNow)
            setClock({ server: Date.parse(v.serverNow), client: Date.now() });
    }, []);
    const loadRows = useCallback(async (groupId: string, view: string, page = 0, q = '') => { const v = await request<GroupPage<GroupRow>>('view', groupId, { section: view, page, search: q }); setRecords(v);  }, []);
    useEffect(() => { const tick = () => setNow(clock.server ? clock.server + Date.now() - clock.client : Date.now()); tick(); const t = setInterval(tick, 1000); return () => clearInterval(t); }, [clock]);
    useEffect(() => {
        if (!selected)
            return;
        let active = true;
        const refresh = async () => {
            try {
                await loadSessions(selected.id, sessions.page);
            }
            catch (e) {
                if (active) {
                    setError((e as Error).message);
                    if ((e as {
                        status?: number;
                    }).status === 403) {
                        setSelected(null);
                        setSessions({ rows: [], page: 0 });
                        setRecords({ rows: [], page: 0 });
                    }
                }
            }
        };
        const t = setInterval(refresh, sessions.catchingUp ? 1000 : 30000);
        return () => { active = false; clearInterval(t); };
    }, [selected, loadSessions, sessions.catchingUp, sessions.page]);
    useEffect(() => {
        if (!selected || !sessions.nextSession)
            return;
        const estimated = clock.server ? clock.server + Date.now() - clock.client : Date.now();
        const delay = Math.min(2147483647, Math.max(0, Date.parse(sessions.nextSession.ends_at) - estimated + 50));
        const timer = setTimeout(() => loadSessions(selected.id, sessions.page).catch(e => setError((e as Error).message)), delay);
        return () => clearTimeout(timer);
    }, [selected, clock, loadSessions, sessions.nextSession, sessions.page]);
    async function run(fn: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await fn();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const choose = useCallback(async (g: StudyGroup) => {
        setLoading(true);
        setError('');
        setSelected(null);
        setSection('history');
        try {
            await loadDetail(g.id);
            await Promise.all([loadSessions(g.id), loadRows(g.id, 'history')]);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }, [loadDetail, loadSessions, loadRows]);
    async function view(v: string) {
        if (!selected)
            return;

        setSection(v);
        setLoading(true);
        setError('');
        try {
            await loadRows(selected.id, v, 0, memberSearch);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        if (initial.rows.length === 1)
            void choose(initial.rows[0]);
    }, [initial.rows, choose]);
    const next = nextSession([...(sessions.nextSession ? [sessions.nextSession] : []), ...sessions.rows], now ?? 0), state = next && now !== null ? sessionState(next, now) : null;
    // The EduLabs class (online, no link): Join opens the class page, which waits for the teacher and opens by itself.
    const liveOn = useLiveClassOn();
    const liveNext = liveOn && next && now !== null && isLiveClass(next) && liveClassAhead(next, now) ? next : null;
    return <div className="mx-auto max-w-5xl space-y-8 pb-16 pt-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-200" aria-busy={busy || loading}>
  <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-950"><Users className="text-cyan-600"/><L id="gw.title"/></h1></div>


   <form className="my-4 flex gap-2" onSubmit={e => { e.preventDefault(); run(async () => setList(await request('view', null, { section: listSection, search, page: 0 }))); }}><input aria-label={t('gw.search_label')} className={field} value={search} onChange={e => setSearch(e.target.value)} maxLength={160}/><button className={button} disabled={busy}><L id="gw.search"/></button></form>
   {!list.rows.length && <p role="status" className="text-sm text-slate-500"><L id="gw.no_groups"/></p>}
   <div className="divide-y divide-slate-100">{list.rows.map(g => <button key={g.id} className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm" disabled={busy || loading} onClick={() => choose(g)}><span className="font-bold text-slate-900">{g.name}<span className="ml-2 text-xs font-normal text-slate-500">{g.offering_name} · {t(g.status === 'archived' ? 'gw.status.archived' : 'gw.status.active')}</span></span><span className="text-cyan-700">{t(g.mode === 'online' ? 'gw.mode.online' : 'gw.mode.center')}</span></button>)}</div>
   <nav aria-label={t('gw.group_pages')} className="flex flex-wrap gap-3">{list.page > 0 && <button className={button} onClick={() => run(async () => setList(await request('view', null, { section: listSection, search, page: list.page - 1 })))}><L id="gw.previous"/></button>}{list.hasMore && <button className={button} onClick={() => run(async () => setList(await request('view', null, { section: listSection, search, page: list.page + 1 })))}><L id="gw.next"/></button>}<button className={button} onClick={() => run(async () => setOwnHistory(await request('view', null, { section: 'history' })))}><L id="gw.my_history"/></button></nav>
  </section>
  {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-group-error={error}><L id="gw.failed"/><button className="ml-3 underline" onClick={() => selected ? void choose(selected) : void run(async () => setList(await request('view', null, { section: listSection, search, page: 0 })))}><L id="gw.reload"/></button></div>}
  {loading && <p role="status"><L id="gw.loading"/></p>}
  {ownHistory && <section className={panel}><h2 className="text-xl font-bold"><L id="gw.my_history"/></h2>{ownHistory.rows.map(r => <p className="border-b py-3 text-sm" key={r.session_id}>{r.title} · {r.starts_at && sessionLabel(r.starts_at)} · {r.status && attendanceText(r.status)}</p>)}{!ownHistory.rows.length && <p className="mt-3 text-sm text-slate-500"><L id="gw.no_history"/></p>}<nav className="mt-4 flex gap-3">{ownHistory.page > 0 && <button className={button} onClick={() => run(async () => setOwnHistory(await request('view', null, { section: 'history', page: ownHistory.page - 1 })))}><L id="gw.previous"/></button>}{ownHistory.rows.length === 25 && <button className={button} onClick={() => run(async () => setOwnHistory(await request('view', null, { section: 'history', page: ownHistory.page + 1 })))}><L id="gw.next"/></button>}</nav></section>}

  {selected && <>
   <GroupRosterView phase1 privacySafe streamLabel={selected.stream_label} streamIcon={selected.stream_icon} groupName={selected.name} serverNow={sessions.serverNow} nextSession={next ? { date: next.starts_at, dayLabel: '', timeLabel: '', fullFormatted: sessionLabel(next.starts_at), endDate: next.ends_at } : null} peers={[]} mode={selected.mode} location={selected.location}/>
   <GroupSummaryPanel summary={summary} staff={false}/>
   <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{selected.name} · {selected.offering_name}</h2><p className="mt-2 text-sm text-slate-500">{selected.description}</p></div></div>
    {sessions.catchingUp && <p role="status" className="mt-3 text-sm text-slate-500"><L id="gw.catching_up"/></p>}{next ? <div className="mt-5 space-y-3"><h3 className="font-bold">{t(state === 'ongoing' ? 'gw.in_progress' : 'gw.next_class')} · {sessionLabel(next.starts_at)}</h3><p className="text-sm">{next.mode === 'online' ? <Video className="mr-1 inline h-4 w-4"/> : <MapPin className="mr-1 inline h-4 w-4"/>}{next.mode === 'online' ? t('gw.mode.online') : next.location}</p>{next.mode === 'online' && next.join_url && <a className="text-cyan-700 underline" href={next.join_url} target="_blank" rel="noopener noreferrer"><L id="gw.join"/></a>}{liveNext && <Link href={classHref(liveNext.id)} data-live-class-join className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-700 px-4 text-sm font-bold text-white hover:bg-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700"><Video className="h-4 w-4" aria-hidden/><L id="lc.join"/></Link>}<p className="text-sm text-slate-500">{next.instructions}</p></div> : <p className="mt-4 text-sm text-slate-500"><L id={sessions.catchingUp ? 'gw.catch_up' : 'gw.no_upcoming'}/></p>}
    <p className="mt-3 text-xs text-slate-500"><L id="gw.external_note"/></p>
   </section>


   <section className={panel}><h2 className="mb-4 text-xl font-bold"><L id="gw.sessions"/></h2><div className="divide-y divide-slate-100">{sessions.rows.map(s => <div key={s.id} className="space-y-2 py-4"><p className="font-semibold">{s.title} · {sessionLabel(s.starts_at)}</p><p className="text-sm text-slate-500">{sessionText(now === null ? s.state : sessionState(s, now))} · {t('gw.attendance', { state: markingText(s.attendance_state) })}</p></div>)}</div>{!sessions.rows.length && <p className="text-sm text-slate-500"><L id="gw.no_sessions"/></p>}<nav aria-label={t('gw.session_pages')} className="flex gap-3">{sessions.page > 0 && <button className={button} onClick={() => run(() => loadSessions(selected.id, sessions.page - 1))}><L id="gw.previous"/></button>}{sessions.hasMore && <button className={button} onClick={() => run(() => loadSessions(selected.id, sessions.page + 1))}><L id="gw.next"/></button>}</nav></section>
   {<section className={panel}><nav aria-label={t('gw.group_records')} className="mb-5 flex flex-wrap gap-2">{(['history']).map(v => <button key={v} className={button} disabled={busy || loading} onClick={() => view(v)}><L id="gw.history"/></button>)}</nav>


    <div className="divide-y divide-slate-100">{records.rows.map((r, i) => <div key={r.id ?? `${r.user_id}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><div><strong>{r.display_name ?? r.action}</strong><p className="text-slate-500">{r.title ? `${r.title} · ` : ''}{r.starts_at ? sessionLabel(r.starts_at) : ''}{r.reason ? ` · ${r.reason}` : ''}{r.status ? ` · ${attendanceText(r.status)}` : ''}</p></div></div>)}</div>
    {!records.rows.length && !loading && <p role="status" className="text-sm text-slate-500"><L id="gw.no_records"/></p>}
    <nav aria-label={t('gw.record_pages')} className="mt-4 flex gap-3">{records.page > 0 && <button className={button} disabled={busy} onClick={() => run(() => loadRows(selected.id, effectiveSection, records.page - 1, memberSearch))}><L id="gw.previous"/></button>}{(records.hasMore ?? records.rows.length === 25) && <button className={button} disabled={busy} onClick={() => run(() => loadRows(selected.id, effectiveSection, records.page + 1, memberSearch))}><L id="gw.next"/></button>}</nav>
   </section>}
  </>}
 </div>;
}
