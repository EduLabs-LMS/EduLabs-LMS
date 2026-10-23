'use client';
import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { L, Localized, useLanguage } from '@/frontend/components/language-provider';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, LifeBuoy, MessageCircle, PlusCircle, Search, Send } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/frontend/components/ui/dialog';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { SupportAvatar } from '@/frontend/features/support/support-avatar';
import { communicate } from '@/frontend/lib/communications';
import { draftKey, readDraft, requesterName, subtitleKind, waitState, writeDraft, type WaitState } from '@/shared/support-view';
import { cn } from '@/shared/utils';
import type { SupportDetail, SupportTicket } from '@/shared/contracts/communications';

const panel = 'rounded-3xl border-[2.5px] border-black bg-white p-5 shadow-hard-sm';
const pill = 'min-h-[44px] rounded-full border-2 border-black px-4 text-sm font-bold transition-colors';
const select = 'min-h-[44px] rounded-xl border-2 border-black bg-white px-3 text-sm font-semibold';
const STATUS_PILLS = [['ALL', 'support.pill_all'], ['OPEN', 'support.pill_open'], ['IN_PROGRESS', 'support.pill_in_progress'], ['RESOLVED', 'support.pill_resolved']] as const;

function storage() {
	try { return window.localStorage; } catch { return null; }
}

/** At-a-glance "who is this waiting on" chip. Colour is never the only signal: the words say it too. */
function WaitChip({ state, staff, overdue }: { state: WaitState; staff: boolean; overdue: boolean }) {
	if (state === 'resolved') return null;
	const id = state === 'needs_reply' ? 'support.needs_reply' : state === 'waiting' ? 'support.waiting_for_support' : staff ? 'support.replied_staff' : 'support.replied_requester';
	return (
		<span className={cn('inline-flex items-center rounded-full border-2 px-2.5 py-0.5 text-xs font-bold', state === 'needs_reply' ? (overdue ? 'border-red-800 bg-red-50 text-red-900' : 'border-amber-800 bg-amber-50 text-amber-900') : 'border-slate-500 bg-slate-50 text-slate-800')}>
			<L id={id} />{overdue && state !== 'replied' && <L id="support.overdueSuffix" />}
		</span>
	);
}

export function SupabaseSupportView() {
	const { language, t: tr } = useLanguage();
	const { user } = useApplicationAuth();
	const date = (v: string) => new Date(v).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
	const params = useSearchParams();
	const [rows, setRows] = useState<SupportTicket[]>([]), [detail, setDetail] = useState<SupportDetail | null>(null), [page, setPage] = useState(0), [messagePage, setMessagePage] = useState(0);
	const [filter, setFilter] = useState('ALL'), [search, setSearch] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
	const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]), [org, setOrg] = useState(''), [category, setCategory] = useState('website'), [subject, setSubject] = useState(''), [body, setBody] = useState(''), [reply, setReply] = useState('');
	const replyBox = useRef<HTMLTextAreaElement>(null);
	// Reuse the same request after a network failure; a new payload gets a new ID.
	const pending = useRef<{ fingerprint: string; id: string; version?: number } | null>(null);
	// Drafts stay in this browser only and are cleared when the text is sent.
	const replyKey = user && detail ? draftKey(user.id, 'reply:' + detail.ticket.id) : null, newKey = user ? draftKey(user.id, 'new') : null;

	const load = useCallback(async () => { setError(''); setLoading(true); try { const r = await communicate<{ rows: SupportTicket[] }>('support', 'list', { page, filter, search }); setRows(r.rows); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }, [page, filter, search]);
	const openTicket = useCallback(async (id: string, p = 0) => { setError(''); try { setDetail(await communicate<SupportDetail>('support', 'get', { page: p }, { id })); setMessagePage(p); } catch (e) { if ([401, 403].includes((e as { status?: number }).status ?? 0)) { setDetail(null); setRows([]); } setError((e as Error).message); } }, []);
	useEffect(() => { void load(); }, [load]);
	useEffect(() => { void communicate<{ id: string; name: string }[]>('support', 'organizations').then(setOrgs).catch(e => setError(e.message)); }, []);
	useEffect(() => { const id = params.get('ticket'); if (id && /^[a-f0-9-]{36}$/i.test(id)) void openTicket(id); }, [params, openTicket]);
	const activeTicketId = detail?.ticket.id;
	useEffect(() => { if (!activeTicketId) return; const timer = setInterval(() => { if (document.visibilityState === 'visible') void openTicket(activeTicketId, messagePage); }, 15000); return () => clearInterval(timer); }, [activeTicketId, messagePage, openTicket]);
	// Restore this ticket's unsent reply when it is opened.
	useEffect(() => { setReply(replyKey ? readDraft(storage(), replyKey) : ''); }, [replyKey]);
	useEffect(() => { const box = replyBox.current; if (box) { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 176) + 'px'; } }, [reply, detail?.ticket.id]);

	function openNewTicket() {
		let saved: { org?: string; category?: string; subject?: string; body?: string } = {};
		try { saved = JSON.parse(readDraft(storage(), newKey ?? '') || '{}'); } catch { /* ignore a damaged draft */ }
		setOrg(saved.org ?? ''); setCategory(saved.category ?? 'website'); setSubject(saved.subject ?? ''); setBody(saved.body ?? ''); setOpen(true);
	}
	function saveNewDraft(next: { org: string; category: string; subject: string; body: string }) {
		if (newKey) writeDraft(storage(), newKey, next.subject.trim() || next.body.trim() ? JSON.stringify(next) : '');
	}
	async function command(action: string, data: unknown, sent?: { clear: () => void }) {
		const fingerprint = JSON.stringify({ action, data, id: detail?.ticket.id });
		if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID(), version: detail?.ticket.version };
		setBusy(true); setError(''); try {
			const r = await communicate<{ id: string }>('support', action, data, { id: action === 'create' ? null : detail?.ticket.id, version: pending.current.version, requestId: pending.current.id });
			pending.current = null; sent?.clear(); setOpen(false); await openTicket(r.id); await load();
		} catch (e) { if ((e as { status?: number }).status === 409) pending.current = null; setError((e as Error).message); } finally { setBusy(false); }
	}
	const sendReply = () => { if (!busy && reply.trim()) void command('reply', { body: reply }, { clear: () => { setReply(''); if (replyKey) writeDraft(storage(), replyKey, ''); } }); };
	const kind = subtitleKind(rows);
	const ownName = user?.fullName ?? user?.firstName ?? null;

	return <div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
		<div className="rounded-[28px] border-[2.5px] border-black bg-white p-5 shadow-hard sm:p-6">
			<div className="flex items-start gap-4">
				<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[2.5px] border-black bg-primary"><LifeBuoy aria-hidden className="h-7 w-7" /></div>
				<div className="min-w-0"><h1 className="font-display text-3xl leading-none sm:text-4xl"><L id="navigation.support" /></h1><p className="mt-2 text-sm text-slate-700"><L id={kind === 'staff' ? 'support.subtitle_staff' : kind === 'both' ? 'support.subtitle_both' : 'support.subtitle_requester'} /></p></div>
			</div>
			<Button className="mt-4 min-h-[48px] rounded-full border-[2.5px] border-black px-6 text-base font-bold shadow-hard-sm" onClick={openNewTicket}><PlusCircle aria-hidden className="me-2 h-5 w-5" /><L id="support.new_ticket" /></Button>
		</div>
		<p className="text-xs text-slate-700"><L id="support.we_aim_to_respond_within" /></p>
		{error && <div role="alert" className={cn(panel, 'space-y-3')}><p><L text={error} /></p><Button variant="outline" onClick={() => detail ? void openTicket(detail.ticket.id, messagePage) : void load()}><L id="support.retry_refresh" /></Button></div>}
		{detail ? (() => {
			const t = detail.ticket, due = !!t.response_due_at && t.status !== 'RESOLVED', overdue = due && Date.parse(t.response_due_at!) < Date.now();
			const from = detail.staff ? requesterName(detail.messages) : null;
			return <section aria-label={t.subject} className="overflow-hidden rounded-[28px] border-[2.5px] border-black bg-white shadow-hard">
				<header className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-black bg-slate-50 p-4 sm:p-5">
					<Localized as="button" labels={{ 'aria-label': 'support.back_to_tickets' }} type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-black bg-white shadow-hard-sm" onClick={() => { setDetail(null); setReply(''); }}><ArrowLeft aria-hidden className="h-5 w-5 rtl:rotate-180" /></Localized>
					<div className="min-w-0 flex-1"><h2 className="font-display text-2xl leading-tight break-words"><bdi dir="auto">{t.subject}</bdi></h2>
						<p className="mt-0.5 text-sm text-slate-700">{from && <><L id="support.from" />{' '}<bdi dir="auto">{from}</bdi>{' · '}</>}<span className="capitalize"><L text={t.category} /></span>{' · '}<L id="support.opened" />{' '}{date(t.created_at)}</p></div>
					{detail.staff
						? <Dropdown aria-label={tr('support.ticket_status')} className={select} value={t.status} disabled={busy} onChange={e => void command('status', { status: e.target.value })}>{STATUS_PILLS.slice(1).map(([value, id]) => <option key={value} value={value}>{tr(id)}</option>)}</Dropdown>
						: <div className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} />{(['OPEN', 'RESOLVED'] as const).filter(s => s !== t.status).map(status => <Button key={status} variant="outline" disabled={busy} onClick={() => void command('status', { status })}><L text={status === 'OPEN' ? 'Reopen' : 'Close ticket'} /></Button>)}</div>}
					<div className="flex w-full flex-wrap items-center gap-2"><WaitChip state={waitState(t, detail.staff)} staff={detail.staff} overdue={overdue} />
						{due && <span className="text-xs font-semibold text-amber-900"><L id="support.response_due" />{' '}{date(t.response_due_at!)}</span>}</div>
					{detail.staff && <details className="w-full text-sm"><summary className="min-h-[44px] cursor-pointer py-2 font-bold"><L id="support.details" /></summary>
						<label className="block pb-2"><L id="support.assigned_to" /><Dropdown className={cn(select, 'ms-2 max-w-full')} value={t.assigned_to ?? ''} disabled={busy} onChange={e => void command('assign', { userId: e.target.value || null })}><option value="">{/* label from locale */}{language === 'ar' ? 'غير معيّن' : 'Unassigned'}</option>{detail.assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Dropdown></label></details>}
				</header>
				<Localized as="div" labels={{ 'aria-label': 'support.ticket_messages' }} role="log" aria-live="polite" className="space-y-5 bg-slate-50/60 p-4 sm:p-6">
					{detail.messages.length === 0 ? <p><L id="support.no_messages_on_this_page" /></p> : [...detail.messages].reverse().map(m => <div key={m.id} className={cn('flex items-end gap-3', m.staff && 'flex-row-reverse')}>
						<SupportAvatar name={m.sender_name} url={m.mine ? user?.imageUrl : null} staff={m.staff} />
						<div className={cn('min-w-0 max-w-[85%] sm:max-w-[75%]', m.staff && 'text-end')}>
							<p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800" style={m.staff ? { justifyContent: 'flex-end' } : undefined}><bdi dir="auto">{m.sender_name}</bdi>{m.mine && <span className="font-normal">(<L id="support.you" />)</span>}{m.staff && <span className="rounded-full border-2 border-black bg-white px-2 py-0.5 text-xs font-bold"><L id="support.team_label" /></span>}</p>
							<div className={cn('rounded-3xl border-[2.5px] border-black px-4 py-3 text-start shadow-hard-sm', m.staff ? 'bg-primary' : 'bg-white')}><p dir="auto" className="whitespace-pre-wrap break-words text-base">{m.body}</p></div>
							<p className="mt-1 text-xs text-slate-700">{date(m.created_at)}</p>
						</div></div>)}
					<div className="flex gap-2"><Button variant="outline" disabled={messagePage === 0} onClick={() => void openTicket(t.id, messagePage - 1)}><L id="support.newer_messages" /></Button><Button variant="outline" disabled={detail.messages.length < 25} onClick={() => void openTicket(t.id, messagePage + 1)}><L id="support.older_messages" /></Button></div>
				</Localized>
				<form className="border-t-[2.5px] border-black bg-white p-4 sm:p-5" onSubmit={e => { e.preventDefault(); sendReply(); }}>
					<label htmlFor="support-reply" className="sr-only"><L id="support.reply" /></label>
					<div className="flex items-end gap-3">
						<textarea placeholder={tr(detail.staff ? 'support.reply_placeholder_staff' : 'support.reply_placeholder')} id="support-reply" ref={replyBox} rows={2} maxLength={2000} value={reply} required className="max-h-44 min-h-[56px] w-full min-w-0 flex-1 resize-none rounded-3xl border-[2.5px] border-black bg-white px-4 py-3 text-base"
							onChange={e => { setReply(e.target.value); if (replyKey) writeDraft(storage(), replyKey, e.target.value); }}
							onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendReply(); } }} />
						<Localized as="button" labels={{ 'aria-label': 'support.send_reply' }} type="submit" disabled={busy || !reply.trim()} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-black bg-primary shadow-hard-sm disabled:opacity-50"><Send aria-hidden className="h-6 w-6 rtl:-scale-x-100" /></Localized>
					</div>
					<p className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-700"><span><L id="support.key_hint" /></span>{reply.length > 1500 && <span>{reply.length}/2000</span>}</p>
					{reply.trim() && <p className="text-xs text-slate-700"><L id="support.draft_kept" /></p>}
				</form>
			</section>;
		})() : <>
			<div className="flex flex-wrap items-center gap-2"><div role="group" aria-label="Status" className="flex flex-wrap gap-2">{STATUS_PILLS.map(([value, id]) => <button key={value} type="button" aria-pressed={filter === value} className={cn(pill, filter === value ? 'bg-primary shadow-hard-sm' : 'bg-white hover:bg-slate-100')} onClick={() => { setFilter(value); setPage(0); }}><L id={id} /></button>)}</div>
				<div className="relative min-w-[12rem] flex-1"><Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" /><Localized as={Input} labels={{ 'aria-label': 'support.search_tickets', placeholder: 'support.search_ticket_subjects' }} className="min-h-[44px] rounded-full border-2 ps-9" value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(0); }} /></div></div>
			{loading ? <div role="status" className="space-y-3"><span className="sr-only"><L id="support.loading_tickets" /></span>{[0, 1, 2].map(i => <div key={i} className={cn(panel, 'h-28 animate-pulse bg-slate-100')} />)}</div>
				: !error && rows.length === 0 ? <div className={cn(panel, 'text-center')}><MessageCircle aria-hidden className="mx-auto h-8 w-8 text-slate-500" /><p className="mt-2"><L id="support.no_matching_tickets_use_new" /></p></div>
				: <ul className="space-y-3">{rows.map(t => {
					const due = !!t.response_due_at && t.status !== 'RESOLVED', overdue = due && Date.parse(t.response_due_at!) < Date.now(), mine = !t.staff;
					return <li key={t.id}><button type="button" className={cn(panel, 'flex w-full items-center gap-4 p-4 text-start transition-all hover:-translate-y-px hover:shadow-hard')} onClick={() => void openTicket(t.id)}>
						<SupportAvatar name={mine ? ownName : null} url={mine ? user?.imageUrl : null} />
						<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold break-words"><bdi dir="auto">{t.subject}</bdi></span><StatusBadge status={t.status} /><WaitChip state={waitState(t, !!t.staff)} staff={!!t.staff} overdue={overdue} /></div>
							<p className="mt-1 text-sm text-slate-700"><span className="capitalize"><L text={t.category} /></span>{' · '}<L id="support.opened" />{' '}{date(t.created_at)}{' '}<L id="support.last_message" />{' '}{date(t.last_message_at)}</p></div>
						<ChevronRight aria-hidden className="h-5 w-5 shrink-0 rtl:rotate-180" /></button></li>;
				})}</ul>}
			<div className="flex items-center gap-2"><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}><L id="notifications.previous" /></Button><span className="p-2"><L id="notifications.page" />{' '}{page + 1}</span><Button variant="outline" disabled={rows.length < 25 || loading} onClick={() => setPage(page + 1)}><L id="notifications.next" /></Button></div>
		</>}
		<Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-display text-2xl"><L id="support.new_ticket_" /></DialogTitle></DialogHeader>
			<form className="grid gap-4" onSubmit={e => { e.preventDefault(); void command('create', { organizationId: org || null, category, subject, body }, { clear: () => { setSubject(''); setBody(''); if (newKey) writeDraft(storage(), newKey, ''); } }); }}>
				<label className="grid gap-1 text-sm"><L id="support.support_team" /><Dropdown className={select} value={org} onChange={e => { setOrg(e.target.value); saveNewDraft({ org: e.target.value, category, subject, body }); }}><option value="">{language === 'ar' ? 'الدعم الفني لمنصة EduLabs' : 'EduLabs platform technical support'}</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Dropdown></label>
				<label className="grid gap-1 text-sm"><L id="support.issue_category" /><Dropdown className={select} value={category} onChange={e => { setCategory(e.target.value); saveNewDraft({ org, category: e.target.value, subject, body }); }}>{['account', 'video', 'upload', 'exam', 'website', 'other'].map(c => <option key={c} value={c}><L text={c} /></option>)}</Dropdown></label>
				<label className="grid gap-1 text-sm"><L id="support.subject" /><Input maxLength={120} required value={subject} onChange={e => { setSubject(e.target.value); saveNewDraft({ org, category, subject: e.target.value, body }); }} /></label>
				<label className="grid gap-1 text-sm"><L id="support.describe_your_problem" /><textarea className="min-h-[96px] w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-sm" maxLength={2000} required value={body} onChange={e => { setBody(e.target.value); saveNewDraft({ org, category, subject, body: e.target.value }); }} /></label>
				<Button disabled={busy || !body.trim() || !subject.trim()}><L id="support.create_ticket" /></Button>
			</form></DialogContent></Dialog>
	</div>;
}
