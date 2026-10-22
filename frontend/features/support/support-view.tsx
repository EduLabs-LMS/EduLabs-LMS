'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Avatar } from '@/frontend/features/support/avatar';
import { NewTicketModal } from '@/frontend/features/support/new-ticket-modal';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { SupportChat } from '@/frontend/features/support/support-chat';
import { FilterPills, SupportHeaderCard, TicketCard } from '@/frontend/features/support/support-ui';
import type {
	SupportListPayload,
	SupportTicketDetail,
	SupportTicketSummary,
} from '@/shared/contracts/support';
import { STATUS_LABEL, TICKET_STATUSES, type TicketStatus } from '@/shared/support';
import { TEACHER_CONTACT } from '@/shared/constants/contact';

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
			<SupportHeaderCard
				title="Support"
				subtitle={
					isAdmin
						? 'Website tickets from students. Open one to reply or change its status.'
						: 'Problems with login, videos, uploads or exams? Open a ticket and our admins will reply here.'
				}
				newTicketLabel="New Ticket"
				onNewTicket={() => setIsModalOpen(true)}
			/>

			{!isAdmin && (
				<p className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-700">
					Support tickets are for website problems. For lesson or curriculum questions, contact{' '}
					{TEACHER_CONTACT.name} on{' '}
					<a
						href={TEACHER_CONTACT.whatsappUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="font-semibold text-emerald-700 underline"
					>
						WhatsApp
					</a>
					.
				</p>
			)}

			<FilterPills
				ariaLabel="Filter tickets by status"
				value={filter}
				onChange={(value) => setFilter(value as TicketStatus | 'ALL')}
				options={(['ALL', ...TICKET_STATUSES] as const).map((value) => ({
					value,
					label: value === 'ALL' ? 'All' : STATUS_LABEL[value],
				}))}
			/>

			{isLoading ? (
				<div role="status" aria-label="Loading tickets" className="flex justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-slate-600" />
				</div>
			) : tickets.length === 0 ? (
				<div className="rounded-[28px] border-[2.5px] border-black bg-white p-8 text-center shadow-hard-sm">
					<MessageCircle className="mx-auto mb-2 h-8 w-8 text-slate-600" />
					<p className="text-sm text-slate-700">
						{filter === 'ALL'
							? isAdmin
								? 'No tickets yet.'
								: 'You have no support history yet. Use New Ticket when you need help.'
							: `No ${STATUS_LABEL[filter].toLowerCase()} tickets.`}
					</p>
				</div>
			) : (
				<ul className="space-y-4">
					{tickets.map((ticket) => (
						<li key={ticket.id}>
							<TicketCard
								busy={isOpening === ticket.id}
								onOpen={() => openTicket(ticket)}
								avatar={
									isAdmin ? (
										<Avatar name={ticket.studentName} url={ticket.studentAvatarUrl} />
									) : (
										<span
											aria-hidden
											className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-black bg-primary text-primary-foreground"
										>
											<MessageCircle className="h-5 w-5" />
										</span>
									)
								}
								title={<bdi dir="auto">{ticket.subject}</bdi>}
								badges={<StatusBadge status={ticket.status} />}
								meta={isAdmin ? <bdi>{ticket.studentName} · {ticket.studentEmail}</bdi> : undefined}
								preview={<bdi dir="auto">{ticket.lastMessagePreview ?? 'No messages yet'}</bdi>}
								footer={
									<>
										Opened {formatDate(ticket.createdAt)} · {ticket.messageCount}{' '}
										{ticket.messageCount === 1 ? 'message' : 'messages'}
									</>
								}
							/>
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
