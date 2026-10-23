'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, LifeBuoy, Loader2, MessageCircle, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import { Avatar } from '@/frontend/features/support/avatar';
import { NewTicketModal } from '@/frontend/features/support/new-ticket-modal';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { SupportChat } from '@/frontend/features/support/support-chat';
import type {
	SupportListPayload,
	SupportTicketDetail,
	SupportTicketSummary,
} from '@/shared/contracts/support';
import { STATUS_LABEL, TICKET_STATUSES, type TicketStatus } from '@/shared/support';
import { TEACHER_CONTACT } from '@/shared/constants/contact';
import { cn } from '@/shared/utils';

const formatDate = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

export const SupportView = () => {
	const [payload, setPayload] = useState<SupportListPayload | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [filter, setFilter] = useState<TicketStatus | 'ALL'>('ALL');
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [active, setActive] = useState<SupportTicketDetail | null>(null);
	const [isOpening, setIsOpening] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await api.get<SupportListPayload>('/api/support');
			setPayload(res.data);
		} catch {
			toast.error('Failed to load your tickets.');
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const openTicket = async (ticket: SupportTicketSummary) => {
		setIsOpening(ticket.id);
		try {
			const res = await api.get<SupportTicketDetail>(`/api/support/${ticket.id}`);
			setActive(res.data);
		} catch {
			toast.error('Could not open this ticket.');
		} finally {
			setIsOpening(null);
		}
	};

	if (active) {
		return (
			<SupportChat
				key={active.ticket.id}
				initial={active}
				onBack={() => {
					setActive(null);
					load();
				}}
			/>
		);
	}

	const isAdmin = payload?.viewerIsAdmin ?? false;
	const tickets = (payload?.tickets ?? []).filter((ticket) => filter === 'ALL' || ticket.status === filter);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-5 shadow-hard">
				<div className="flex items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-black bg-primary">
						<LifeBuoy className="h-6 w-6" />
					</div>
					<div>
						<h1 className="font-display text-3xl leading-none">Support</h1>
						<p className="mt-1 text-sm text-slate-600">
							{isAdmin
								? 'Website tickets from students. Open one to reply or change its status.'
								: 'Problems with login, videos, uploads or exams? Open a ticket and our admins will reply here.'}
						</p>
					</div>
				</div>
				<Button onClick={() => setIsModalOpen(true)}>
					<PlusCircle className="mr-2 h-4 w-4" /> New Ticket
				</Button>
			</div>

			{!isAdmin && (
				<p className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-600">
					Support tickets are for website problems. For lesson or curriculum questions, contact{' '}
					{TEACHER_CONTACT.name} on{' '}
					<a
						href={TEACHER_CONTACT.whatsappUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="font-semibold text-green-900 underline"
					>
						WhatsApp
					</a>
					.
				</p>
			)}

			<div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter tickets by status">
				{(['ALL', ...TICKET_STATUSES] as const).map((value) => (
					<button
						key={value}
						type="button"
						role="tab"
						aria-selected={filter === value}
						onClick={() => setFilter(value)}
						className={cn(
							'rounded-full border-2 border-black px-3.5 py-1 text-xs font-bold transition-colors',
							filter === value ? 'bg-primary shadow-hard-sm' : 'bg-white hover:bg-slate-100'
						)}
					>
						{value === 'ALL' ? 'All' : STATUS_LABEL[value]}
					</button>
				))}
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-slate-500" />
				</div>
			) : tickets.length === 0 ? (
				<div className="rounded-2xl border-2 border-black bg-white p-8 text-center shadow-hard-sm">
					<MessageCircle className="mx-auto mb-2 h-8 w-8 text-slate-400" />
					<p className="text-sm text-slate-600">
						{filter === 'ALL'
							? isAdmin
								? 'No tickets yet.'
								: 'You have no support history yet. Use New Ticket when you need help.'
							: `No ${STATUS_LABEL[filter].toLowerCase()} tickets.`}
					</p>
				</div>
			) : (
				<ul className="space-y-3">
					{tickets.map((ticket) => (
						<li key={ticket.id}>
							<button
								type="button"
								onClick={() => openTicket(ticket)}
								disabled={isOpening === ticket.id}
								className="flex w-full items-center gap-3 rounded-2xl border-2 border-black bg-white p-4 text-left shadow-hard-sm transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-hard disabled:opacity-60"
							>
								{isAdmin && <Avatar name={ticket.studentName} url={ticket.studentAvatarUrl} />}
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="truncate font-semibold">{ticket.subject}</span>
										<StatusBadge status={ticket.status} />
									</div>
									{isAdmin && (
										<p className="truncate text-xs text-slate-600">
											{ticket.studentName} · {ticket.studentEmail}
										</p>
									)}
									<p className="mt-0.5 truncate text-xs text-slate-500">
										{ticket.lastMessagePreview ?? 'No messages yet'}
									</p>
									<p className="mt-1 text-[11px] text-slate-400">
										Opened {formatDate(ticket.createdAt)} · {ticket.messageCount}{' '}
										{ticket.messageCount === 1 ? 'message' : 'messages'}
									</p>
								</div>
								{isOpening === ticket.id ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
								)}
							</button>
						</li>
					))}
				</ul>
			)}

			<NewTicketModal
				open={isModalOpen}
				onOpenChange={setIsModalOpen}
				onCreated={(detail) => setActive(detail)}
			/>
		</div>
	);
};
