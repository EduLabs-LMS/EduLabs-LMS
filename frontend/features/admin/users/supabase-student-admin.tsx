'use client';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, UserCheck, UserPlus, Users } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { ConfirmDialog } from '@/frontend/features/admin/users/confirm-dialog';
import { administer } from '@/frontend/lib/student-administration';
import { initialOf, safeTab, statusTone, visibleStats, visibleTabs, waitlistVisible, type StatKey, type UsersTab } from '@/shared/users-view';
import { cn } from '@/shared/utils';
import type { MessageKey } from '@/frontend/locales/messages';
import type { AdminMetrics, AdminOffering, StudentRow } from '@/shared/contracts/student-administration';

const panel = 'rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm';
const field = 'min-h-[44px] rounded-xl border-2 border-black bg-white px-3 text-sm';
const pill = 'min-h-[44px] shrink-0 whitespace-nowrap rounded-full border-2 border-black px-4 text-sm font-bold transition-colors';
const STAT_ICON: Record<StatKey, typeof Users> = { total: Users, waitlist: UserPlus };
const STAT_LABEL: Record<StatKey, MessageKey> = { total: 'users.stat_total', waitlist: 'users.stat_waitlist' };
const TAB_LABEL: Record<UsersTab, MessageKey> = { all: 'users.tab_all', students: 'users.tab_students', waitlist: 'users.tab_waitlist' };
const ROSTER_FILTERS = ['all', 'active', 'suspended', 'expired', 'completed', 'cancelled', 'invited'];
const REQUEST_FILTERS = ['pending', 'approved', 'rejected', 'all'];
const HISTORY = '__history';
type Confirm = { title: MessageKey; body: MessageKey; run: () => void };

function StatusChip({ status }: { status: string }) {
	const tone = statusTone(status);
	return <span className={cn('inline-flex items-center rounded-full border-2 px-2.5 py-0.5 text-xs font-bold capitalize', tone === 'good' ? 'border-green-800 bg-green-50 text-green-900' : tone === 'warn' ? 'border-amber-800 bg-amber-50 text-amber-900' : 'border-slate-500 bg-slate-50 text-slate-800')}>{status}</span>;
}
function Pager({ page, count, loading, onPage }: { page: number; count: number; loading: boolean; onPage: (page: number) => void }) {
	return <nav aria-label="Pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!page || loading} onClick={() => onPage(page - 1)}><L id="users.previous" /></Button><span className="p-2"><L id="users.page" /> {page + 1}</span><Button variant="outline" disabled={count < 25 || loading} onClick={() => onPage(page + 1)}><L id="users.next" /></Button></nav>;
}
function Heading({ icon: Icon, title, note }: { icon: typeof Users; title: MessageKey; note: MessageKey }) {
	return <div className="flex items-start gap-3"><Icon aria-hidden className="mt-1 h-6 w-6 shrink-0 text-green-800" /><div><h2 className="font-display text-2xl leading-tight"><L id={title} /></h2><p className="text-sm text-slate-700"><L id={note} /></p></div></div>;
}

export function SupabaseStudentAdmin() {
	const { language } = useLanguage();
	const when = (v: string) => new Date(v).toLocaleString(language);
	const [offers, setOffers] = useState<AdminOffering[]>([]), [offer, setOffer] = useState(''), [offerPage, setOfferPage] = useState(0), [linkPage, setLinkPage] = useState(0);
	const [tab, setTab] = useState<UsersTab>('all'), [forceWaitlist, setForceWaitlist] = useState(false), [metrics, setMetrics] = useState<AdminMetrics | null>(null);
	const [search, setSearch] = useState(''), [rosterFilter, setRosterFilter] = useState('all'), [rosterPage, setRosterPage] = useState(0), [requestFilter, setRequestFilter] = useState('pending'), [requestPage, setRequestPage] = useState(0);
	const [roster, setRoster] = useState<StudentRow[]>([]), [requests, setRequests] = useState<StudentRow[]>([]);
	const [loadingOffers, setLoadingOffers] = useState(true), [loadingRoster, setLoadingRoster] = useState(false), [loadingRequests, setLoadingRequests] = useState(false);
	const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<Confirm | null>(null);
	const [expiry, setExpiry] = useState(''), [share, setShare] = useState(''), [kind, setKind] = useState<'request' | 'invite'>('request'), [recipient, setRecipient] = useState(''), [reason, setReason] = useState(''), [eligibleId, setEligibleId] = useState('');
	const [links, setLinks] = useState<{ id: string; kind: string; expires_at: string; claimed_at: string | null; revoked_at: string | null }[]>([]);
	const linkDraft = useRef<{ key: string; token: string; expiresAt: string } | null>(null);
	const pending = useRef<{ fingerprint: string; requestId: string } | null>(null), selected = offers.find(o => o.id === offer);

	const waitlistOn = waitlistVisible(metrics?.pendingWaitlistCount ?? null, forceWaitlist), current = safeTab(tab, waitlistOn);
	const showStudents = current === 'all' || current === 'students', showWaitlist = waitlistOn && (current === 'all' || current === 'waitlist');

	useEffect(() => { let alive = true; setLoadingOffers(true); void administer<{ rows: AdminOffering[] }>('offerings', { page: offerPage }).then(v => { if (alive) { setOffers(v.rows); setOffer(v.rows[0]?.id ?? ''); } }).catch(e => setError(e.message)).finally(() => setLoadingOffers(false)); return () => { alive = false; }; }, [offerPage]);
	const loadMetrics = useCallback(async () => { try { setMetrics(await administer<AdminMetrics>('metrics', {})); } catch { setMetrics(null); } }, []);
	useEffect(() => { void loadMetrics(); }, [loadMetrics]);
	const loadRoster = useCallback(async () => { if (!offer || !showStudents) return; setLoadingRoster(true); setError(''); try { setRoster((await administer<{ rows: StudentRow[] }>('roster', { page: rosterPage, search, filter: rosterFilter }, { offeringId: offer })).rows); } catch (e) { setRoster([]); setError((e as Error).message); } finally { setLoadingRoster(false); } }, [offer, showStudents, rosterPage, search, rosterFilter]);
	const loadRequests = useCallback(async () => { if (!offer || !showWaitlist) return; setLoadingRequests(true); setError(''); try { setRequests((await administer<{ rows: StudentRow[] }>('requests', { page: requestPage, search, filter: requestFilter }, { offeringId: offer })).rows); } catch (e) { setRequests([]); setError((e as Error).message); } finally { setLoadingRequests(false); } }, [offer, showWaitlist, requestPage, search, requestFilter]);
	const loadLinks = useCallback(async () => { if (!offer || !selected?.manage) { setLinks([]); return; } try { setLinks(await administer('links', { page: linkPage }, { offeringId: offer })); } catch (e) { setError((e as Error).message); } }, [offer, selected?.manage, linkPage]);
	useEffect(() => { void loadRoster(); }, [loadRoster]);
	useEffect(() => { void loadRequests(); }, [loadRequests]);
	useEffect(() => { void loadLinks(); }, [loadLinks]);
	const reloadAll = () => { void loadMetrics(); void loadRoster(); void loadRequests(); void loadLinks(); };

	const expiresAt = () => expiry ? new Date(expiry).toISOString() : null;
	async function command(action: string, data: unknown, subjectId: string | null = null, version: number | null = null) {
		const fingerprint = JSON.stringify({ action, data, offer, subjectId, version }); if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
		setBusy(true); setError(''); try { const result = await administer(action, data, { offeringId: offer, subjectId, version, requestId: pending.current.requestId }); pending.current = null; reloadAll(); return result; } catch (e) { if ((e as { status?: number }).status === 409) pending.current = null; setError((e as Error).message); return null; } finally { setBusy(false); }
	}
	async function createLink() {
		const key = JSON.stringify({ offer, kind, recipient, expiry }); if (linkDraft.current?.key !== key) { const bytes = crypto.getRandomValues(new Uint8Array(32)); linkDraft.current = { key, token: btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() }; }
		const draft = linkDraft.current; if (await command('link', { token: draft.token, kind, recipientId: kind === 'invite' ? recipient : null, expiresAt: draft.expiresAt, enrollmentExpiresAt: expiresAt() })) { setShare(window.location.origin + '/join/' + draft.token); linkDraft.current = null; }
	}
	const ask = (title: MessageKey, body: MessageKey, run: () => void) => setConfirm({ title, body, run });
	function pickRosterFilter(value: string) { setRosterPage(0); if (value === HISTORY) { setForceWaitlist(true); setRequestFilter('all'); setRequestPage(0); setTab('waitlist'); } else setRosterFilter(value); }

	function Actions({ row, requestRow }: { row: StudentRow; requestRow: boolean }) {
		if (!selected?.manage) return null;
		return <div className="flex flex-wrap justify-end gap-2">{requestRow
			? row.status === 'pending' && <><Button className="min-h-[44px]" disabled={busy} onClick={() => void command('approve', { expiresAt: expiresAt() }, row.user_id, row.version)}><L id="users.approve" /></Button>
				<Button className="min-h-[44px]" variant="outline" disabled={busy || !reason.trim()} onClick={() => ask('users.confirm_reject_title', 'users.confirm_reject_body', () => void command('reject', { reason }, row.user_id, row.version))}><L id="users.reject" /></Button></>
			: <><Button className="min-h-[44px]" variant="outline" disabled={busy || row.status === 'suspended'} onClick={() => ask('users.confirm_suspend_title', 'users.confirm_suspend_body', () => void command('suspend', {}, row.user_id, row.version))}><L id="users.suspend" /></Button>
				<Button className="min-h-[44px]" disabled={busy || !!row.eligible} onClick={() => void command('reactivate', { expiresAt: expiresAt() }, row.user_id, row.version)}><L id="users.reactivate" /></Button></>}</div>;
	}
	const Who = ({ row }: { row: StudentRow }): React.ReactNode => <div className="flex min-w-0 items-start gap-3"><span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-black bg-primary font-bold">{initialOf(row.display_name)}</span>
		<div className="min-w-0"><p className="font-semibold break-words"><bdi dir="auto">{row.display_name || 'Student'}</bdi> <span className="text-xs font-normal text-slate-600">{row.user_id.slice(-8)}</span></p>{row.reason && <p className="text-sm break-words">{row.reason}</p>}
			<details className="mt-1 text-xs"><summary className="cursor-pointer py-1"><L id="users.profile_id" /></summary><p className="break-all">{row.user_id}</p></details></div></div>;
	const Meta = ({ row }: { row: StudentRow }): React.ReactNode => <>{row.eligible === false && <span className="text-xs text-slate-700"><L id="users.access_unavailable" /></span>}{row.expires_at && <span className="text-xs text-slate-700"><L id="users.expires" /> {when(row.expires_at)}</span>}</>;
	function People({ rows, loading, requestRow, empty }: { rows: StudentRow[]; loading: boolean; requestRow: boolean; empty: MessageKey }) {
		if (loading) return <div role="status" className="space-y-3"><span className="sr-only"><L id="users.loading" /></span>{[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
		if (!rows.length) return error ? null : <p className="py-6 text-center text-sm text-slate-700"><L id={empty} /></p>;
		return <>
			<div className="hidden overflow-x-auto rounded-2xl border-2 border-black md:block"><table className="w-full text-sm"><thead className="bg-slate-50 text-start text-xs uppercase tracking-wide text-slate-700"><tr><th className="p-3 text-start"><L id="users.col_student" /></th><th className="p-3 text-start"><L id="users.col_status" /></th><th className="p-3 text-start"><L id="users.col_expires" /></th>{selected?.manage && <th className="p-3 text-end"><L id="users.col_actions" /></th>}</tr></thead>
				<tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-300 align-middle"><td className="p-3">{Who({ row })}</td><td className="p-3"><StatusChip status={row.status} /></td><td className="p-3 text-slate-700">{row.expires_at ? when(row.expires_at) : '—'}{row.eligible === false && <div className="text-xs"><L id="users.access_unavailable" /></div>}</td>{selected?.manage && <td className="p-3">{Actions({ row, requestRow })}</td>}</tr>)}</tbody></table></div>
			<ul className="space-y-3 md:hidden">{rows.map(row => <li key={row.id} className="space-y-3 rounded-2xl border-2 border-black p-4"><div className="flex flex-wrap items-start justify-between gap-2">{Who({ row })}<StatusChip status={row.status} /></div><div className="flex flex-wrap gap-x-4 gap-y-1">{Meta({ row })}</div>{Actions({ row, requestRow })}</li>)}</ul></>;
	}
	const tabs = visibleTabs(waitlistOn), stats = visibleStats(waitlistOn);
	const statValue = (key: StatKey) => { if (!metrics) return null; return key === 'total' ? metrics.totalStudents : metrics.pendingWaitlistCount; };

	return <div className="mx-auto max-w-6xl space-y-6 pb-12">
		<header className="flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0"><h1 className="font-display text-3xl sm:text-4xl"><L id="users.title" /></h1><p className="mt-2 max-w-2xl text-sm text-slate-700"><L id="users.subtitle" /></p></div>
			<div className="flex flex-wrap gap-2"><Link href="/sessions-groups"><Button variant="outline" className="min-h-[44px] rounded-full"><L id="users.groups_attendance" /></Button></Link><Button variant="outline" className="min-h-[44px] rounded-full" onClick={reloadAll}><RefreshCw aria-hidden className="me-2 h-4 w-4" /><L id="users.refresh" /></Button></div>
		</header>
		{error && <div role="alert" className={cn(panel, 'space-y-3')}><p>{error}</p><Button variant="outline" onClick={reloadAll}><RefreshCw aria-hidden className="me-2 h-4 w-4" /><L id="users.refresh" /></Button></div>}
		<section className={cn('grid gap-4 grid-cols-1', stats.length === 2 && 'sm:grid-cols-2')}>{stats.map(key => { const Icon = STAT_ICON[key], value = statValue(key); return <div key={key} className="flex items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-4 shadow-hard-sm sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-700"><L id={STAT_LABEL[key]} /></p><p className="mt-2 text-3xl font-bold">{value ?? <span className="text-base font-semibold"><L id="users.unavailable" /></span>}</p></div><Icon aria-hidden className="h-6 w-6 shrink-0 text-green-800" /></div>; })}</section>
		<section className={panel}><label className="flex flex-wrap items-center gap-2 text-sm font-semibold"><L id="users.course_offering" /><select aria-label="Course offering" className={cn(field, 'max-w-full flex-1')} value={offer} onChange={e => { setOffer(e.target.value); setRosterPage(0); setRequestPage(0); setLinkPage(0); setShare(''); }}>{offers.map(o => <option key={o.id} value={o.id}>{o.organization_name} · {o.course_title} · {o.name}</option>)}</select></label>
			<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!offerPage} onClick={() => setOfferPage(offerPage - 1)}><L id="users.previous_offerings" /></Button><Button variant="outline" disabled={offers.length < 25} onClick={() => setOfferPage(offerPage + 1)}><L id="users.more_offerings" /></Button></div>
			{!loadingOffers && !offers.length && !error && <p className="mt-3">No assigned offerings. EduLabs staff provision teacher organizations; students use their teacher&apos;s access link.</p>}</section>
		{offer && <>
			<div role="group" aria-label="Sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">{tabs.map(value => <button key={value} type="button" aria-pressed={current === value} className={cn(pill, current === value ? 'bg-primary shadow-hard-sm' : 'bg-white hover:bg-slate-100')} onClick={() => setTab(value)}><L id={TAB_LABEL[value]} />{value === 'students' && roster.length > 0 && ` (${roster.length})`}</button>)}</div>
			{selected?.manage && <div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex flex-wrap items-center gap-2 font-semibold"><L id="users.access_expiry" /><Input className="w-auto" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></div>}
			{showStudents && <section className={cn(panel, 'space-y-4')}>
				<Heading icon={Users} title="users.students_title" note="users.students_note" />
				<div className="flex flex-wrap gap-3"><div className="relative min-w-[12rem] flex-1"><Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" /><Input aria-label="Search students" placeholder="Search student names" className="min-h-[44px] rounded-full ps-9" value={search} maxLength={120} onChange={e => { setSearch(e.target.value); setRosterPage(0); setRequestPage(0); }} /></div>
					<select aria-label="Student status" className={field} value={rosterFilter} onChange={e => pickRosterFilter(e.target.value)}>{ROSTER_FILTERS.map(v => <option key={v} value={v}>{v}</option>)}<option value={HISTORY}>Past access requests</option></select></div>
				{People({ rows: roster, loading: loadingRoster, requestRow: false, empty: 'users.no_students' })}
				<Pager page={rosterPage} count={roster.length} loading={loadingRoster} onPage={setRosterPage} />
			</section>}
			{showWaitlist && <section className={cn(panel, 'space-y-4 border-amber-800')}>
				<Heading icon={UserCheck} title="users.waitlist_title" note="users.waitlist_note" />
				<div className="flex flex-wrap items-center gap-3"><select aria-label="Request status" className={field} value={requestFilter} onChange={e => { setRequestFilter(e.target.value); setRequestPage(0); }}>{REQUEST_FILTERS.map(v => <option key={v} value={v}>{v}</option>)}</select>
					{selected?.manage && <label className="flex flex-1 flex-wrap items-center gap-2 text-sm font-semibold"><L id="users.reject_reason" /><Input className="min-w-[12rem] flex-1" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>}</div>
				{!loadingRequests && !requests.length && !error ? <div className="py-8 text-center"><UserCheck aria-hidden className="mx-auto h-8 w-8 text-green-700" /><p className="mt-2 font-semibold"><L id="users.waitlist_empty" /></p><p className="text-sm text-slate-700"><L id="users.waitlist_empty_note" /></p></div> : People({ rows: requests, loading: loadingRequests, requestRow: true, empty: 'users.no_requests' })}
				<Pager page={requestPage} count={requests.length} loading={loadingRequests} onPage={setRequestPage} />
			</section>}
			{selected?.manage && <details className={cn(panel, 'space-y-4')}><summary className="min-h-[44px] cursor-pointer font-display text-2xl"><UserPlus aria-hidden className="me-2 inline h-6 w-6" /><L id="users.manage_access" /></summary>
				<div className="mt-4 space-y-4"><p className="text-sm">Request links require your approval. A private invitation is bound to one verified student profile. Ask the student to copy their profile ID from My requests. Share invitations only with the intended student. Links expire in seven days.</p>
					<select aria-label="Access link type" className={field} value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="request">Request approval</option><option value="invite">Single-use authorized invitation</option></select>
					{kind === 'invite' && <Input aria-label="Invitation recipient profile ID" value={recipient} onChange={e => setRecipient(e.target.value)} />}
					<Button disabled={busy || (kind === 'invite' && !/^[a-f0-9-]{36}$/i.test(recipient))} onClick={() => void createLink()}>Create access link</Button>
					{share && <label className="block text-sm">Copy this private link now<Input readOnly value={share} onFocus={e => e.target.select()} /></label>}
					<ul>{links.map(link => <li className="flex flex-wrap items-center gap-3 border-t py-2 text-sm" key={link.id}><span>{link.kind} · {link.revoked_at ? 'Revoked' : link.claimed_at ? 'Accepted' : 'Expires ' + new Date(link.expires_at).toLocaleDateString()}</span><Button variant="outline" disabled={busy || !!link.revoked_at} onClick={() => ask('users.confirm_revoke_title', 'users.confirm_revoke_body', () => void command('revoke-link', { linkId: link.id }))}>Revoke link</Button></li>)}</ul>
					<div className="flex gap-2"><Button variant="outline" disabled={!linkPage || busy} onClick={() => setLinkPage(linkPage - 1)}>Newer links</Button><Button variant="outline" disabled={links.length < 25 || busy} onClick={() => setLinkPage(linkPage + 1)}>Older links</Button></div>
					<p className="text-xs text-slate-700">To enroll a student already known to this organization in this offering, use their profile ID from the roster. This does not search or link accounts by email.</p>
					<Input aria-label="Existing student profile ID" value={eligibleId} onChange={e => setEligibleId(e.target.value)} /><Button disabled={busy || !/^[a-f0-9-]{36}$/i.test(eligibleId)} onClick={() => void command('enroll', { expiresAt: expiresAt() }, eligibleId)}>Enroll existing student</Button></div></details>}
			{!selected?.manage && <p className="text-sm text-slate-700">Assigned assistant view. Approval, invitations and access changes require an authorized offering instructor.</p>}
		</>}
		<ConfirmDialog open={!!confirm} title={confirm?.title ?? 'users.confirm_reject_title'} body={confirm?.body ?? 'users.confirm_reject_body'} onCancel={() => setConfirm(null)} onConfirm={() => { const run = confirm?.run; setConfirm(null); run?.(); }} />
	</div>;
}
