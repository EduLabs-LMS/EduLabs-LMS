'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { useV2SupportUpload } from '@/frontend/lib/v2-support-upload';
import { Button } from '@/frontend/components/ui/button';
import { Textarea } from '@/frontend/components/ui/textarea';
import { Avatar } from '@/frontend/features/support/avatar';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import type { SupportMessageView, SupportTicketDetail } from '@/shared/contracts/support';
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_SUPPORT_MESSAGE_LENGTH,
	TICKET_STATUSES,
	STATUS_LABEL,
	isImageAttachment,
	isTicketStatus,
	type SupportAttachment,
} from '@/shared/support';
import { cn } from '@/shared/utils';

interface SupportChatProps {
	initial: SupportTicketDetail;
	onBack: () => void;
}

const POLL_MS = 8000;

const formatTime = (iso: string) =>
	new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const errorMessage = (error: unknown, fallback: string) => {
	const data = (error as { response?: { data?: unknown } })?.response?.data;
	return typeof data === 'string' && data ? data : fallback;
};

const AttachmentView = ({ attachment }: { attachment: SupportAttachment }) =>
	isImageAttachment(attachment) ? (
		<a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				src={attachment.url}
				alt={attachment.name}
				referrerPolicy="no-referrer"
				className="max-h-56 rounded-xl border-2 border-black object-cover"
			/>
		</a>
	) : (
		<a
			href={attachment.url}
			target="_blank"
			rel="noopener noreferrer"
			className="flex items-center gap-2 rounded-xl border-2 border-black bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-slate-100"
		>
			<FileText className="h-4 w-4 shrink-0" />
			<span className="truncate">{attachment.name}</span>
		</a>
	);

export const SupportChat = ({ initial, onBack }: SupportChatProps) => {
	const [detail, setDetail] = useState(initial);
	const [text, setText] = useState('');
	const [pending, setPending] = useState<SupportAttachment[]>([]);
	const [isSending, setIsSending] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const ticketId = initial.ticket.id;

	const { startUpload, isUploading } = useV2SupportUpload();

	const refresh = useCallback(async () => {
		try {
			const res = await api.get<SupportTicketDetail>(`/api/support/${ticketId}`);
			setDetail(res.data);
		} catch {
			/* keep what we have; the next poll retries */
		}
	}, [ticketId]);

	// Messenger feel: pick up replies without a manual refresh while the tab is visible.
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, POLL_MS);
		return () => window.clearInterval(timer);
	}, [refresh]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	}, [detail.messages.length]);

	const onFilesPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = '';
		if (!files.length) return;
		if (pending.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
			toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
			return;
		}
		const uploaded = await startUpload(files);
		if (!uploaded) return;
		setPending((current) => [
			...current,
			...uploaded.map((file) => ({
				url: file.ufsUrl ?? file.url,
				name: file.name,
				size: file.size,
				type: file.type,
			})),
		]);
	};

	const canSend = !isSending && !isUploading && (text.trim().length > 0 || pending.length > 0);

	const send = async () => {
		if (!canSend) return;
		setIsSending(true);
		try {
			const res = await api.post<SupportMessageView>(`/api/support/${ticketId}/messages`, {
				body: text,
				attachments: pending,
			});
			setText('');
			setPending([]);
			setDetail((current) => ({ ...current, messages: [...current.messages, res.data] }));
			refresh(); // status may have changed (e.g. reopened)
		} catch (error) {
			toast.error(errorMessage(error, 'Could not send your message.'));
		} finally {
			setIsSending(false);
		}
	};

	const changeStatus = async (value: string) => {
		if (!isTicketStatus(value)) return;
		try {
			await api.patch(`/api/support/${ticketId}`, { status: value });
			setDetail((current) => ({ ...current, ticket: { ...current.ticket, status: value } }));
			toast.success(`Marked ${STATUS_LABEL[value]}.`);
		} catch (error) {
			toast.error(errorMessage(error, 'Could not update the status.'));
		}
	};

	const { ticket, messages, viewerIsAdmin } = detail;

	return (
		<div className="mx-auto flex h-[calc(100vh-9rem)] min-h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border-[2.5px] border-black bg-white shadow-hard">
			{/* Header */}
			<div className="flex items-center gap-3 border-b-[2.5px] border-black bg-slate-50 px-4 py-3">
				<Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to tickets">
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<div className="min-w-0 flex-1">
					<h1 className="truncate font-display text-xl leading-tight">{ticket.subject}</h1>
					{viewerIsAdmin && (
						<p className="truncate text-xs text-slate-600">
							{ticket.studentName} · {ticket.studentEmail}
						</p>
					)}
				</div>
				{viewerIsAdmin ? (
					<Dropdown
						aria-label="Ticket status"
						value={ticket.status}
						onChange={(event) => changeStatus(event.target.value)}
						className="h-9 rounded-full border-2 border-black bg-white px-3 text-xs font-bold"
					>
						{TICKET_STATUSES.map((status) => (
							<option key={status} value={status}>
								{STATUS_LABEL[status]}
							</option>
						))}
					</Dropdown>
				) : (
					<StatusBadge status={ticket.status} />
				)}
			</div>

			{/* Messages */}
			<div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-5">
				{messages.length === 0 && (
					<div className="mx-auto max-w-sm rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">
						Describe the problem below. Attach screenshots or PDFs if they help. An admin will reply here.
					</div>
				)}
				{messages.map((message) => {
					const isAdminSender = message.senderRole === 'ADMIN';
					return (
						<div
							key={message.id}
							className={cn('flex items-end gap-2', message.isMine ? 'flex-row-reverse' : 'flex-row')}
						>
							<Avatar name={message.senderName} url={message.senderAvatarUrl} isAdmin={isAdminSender} />
							<div className={cn('flex max-w-[80%] flex-col gap-1', message.isMine ? 'items-end' : 'items-start')}>
								<span className="px-1 text-[11px] font-semibold text-slate-600">
									{message.senderName}
									{isAdminSender && (
										<span className="ml-1.5 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-px text-[9px] font-bold uppercase text-rose-700">
											Admin
										</span>
									)}
								</span>
								<div
									className={cn(
										'space-y-2 rounded-2xl border-2 border-black px-3.5 py-2.5 text-sm shadow-hard-sm',
										message.isMine ? 'rounded-br-md bg-primary' : 'rounded-bl-md bg-white'
									)}
								>
									{message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
									{message.attachments.map((attachment) => (
										<AttachmentView key={attachment.url} attachment={attachment} />
									))}
								</div>
								<span className="px-1 text-[10px] text-slate-500">{formatTime(message.createdAt)}</span>
							</div>
						</div>
					);
				})}
				<div ref={bottomRef} />
			</div>

			{/* Composer */}
			<div className="space-y-2 border-t-[2.5px] border-black bg-white p-3">
				{pending.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{pending.map((attachment) => (
							<span
								key={attachment.url}
								className="inline-flex max-w-full items-center gap-1.5 rounded-full border-2 border-black bg-slate-100 py-1 pl-3 pr-1.5 text-xs font-medium"
							>
								<span className="max-w-[180px] truncate">{attachment.name}</span>
								<button
									type="button"
									aria-label={`Remove ${attachment.name}`}
									onClick={() => setPending((current) => current.filter((item) => item.url !== attachment.url))}
									className="rounded-full p-0.5 hover:bg-slate-300"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</span>
						))}
					</div>
				)}
				<div className="flex items-end gap-2">
					<input
						ref={fileInput}
						type="file"
						multiple
						accept="image/*,application/pdf"
						className="hidden"
						onChange={onFilesPicked}
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						className="shrink-0"
						disabled={isUploading || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
						onClick={() => fileInput.current?.click()}
						aria-label="Attach screenshots or PDFs"
					>
						{isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
					</Button>
					<Textarea
						value={text}
						maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
						rows={2}
						placeholder={viewerIsAdmin ? 'Reply to the student…' : 'Describe the problem in detail…'}
						className="max-h-40 min-h-[44px] resize-none"
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								send();
							}
						}}
					/>
					<Button type="button" size="icon" className="shrink-0" disabled={!canSend} onClick={send} aria-label="Send message">
						{isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
					</Button>
				</div>
				<p className="px-1 text-[11px] text-slate-500">Enter to send · Shift+Enter for a new line · images and PDFs up to 16 MB</p>
			</div>
		</div>
	);
};
