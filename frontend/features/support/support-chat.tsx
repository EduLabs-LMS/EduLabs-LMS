'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { useV2SupportUpload } from '@/frontend/lib/v2-support-upload';
import { Button } from '@/frontend/components/ui/button';
import { Textarea } from '@/frontend/components/ui/textarea';
import { StatusBadge } from '@/frontend/features/support/status-badge';
import { BackButton, ChatFrame, ChatHeader, MessageBubble, PaperclipIcon, SendIcon, StatusSelect } from '@/frontend/features/support/support-ui';
import { useReplyDraft } from '@/frontend/features/support/use-reply-draft';
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
	// Draft is kept per ticket so leaving the chat or a failed send never loses it.
	const [text, setText] = useReplyDraft(initial.ticket.id);
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
		try {
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
		} catch (error) {
			toast.error(errorMessage(error, (error as Error)?.message || 'Could not upload the file.'));
		}
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
		<ChatFrame>
			<ChatHeader
				back={<BackButton onClick={onBack} label="Back to tickets" />}
				title={<bdi dir="auto">{ticket.subject}</bdi>}
				subtitle={viewerIsAdmin ? <bdi>{ticket.studentName} · {ticket.studentEmail}</bdi> : undefined}
				control={
					viewerIsAdmin ? (
						<StatusSelect
							ariaLabel="Ticket status"
							value={ticket.status}
							onChange={changeStatus}
							options={TICKET_STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
						/>
					) : (
						<StatusBadge status={ticket.status} />
					)
				}
			/>

			{/* Messages */}
			<div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-3 py-5 sm:px-5" tabIndex={0} role="log" aria-label="Ticket messages">
				{messages.length === 0 && (
					<div className="mx-auto max-w-sm rounded-2xl border-2 border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-700">
						Describe the problem below. Attach screenshots or PDFs if they help. An admin will reply here.
					</div>
				)}
				{messages.map((message) => {
					const isAdminSender = message.senderRole === 'ADMIN';
					return (
						<MessageBubble
							key={message.id}
							name={message.senderName}
							avatarUrl={message.senderAvatarUrl}
							staffLabel={isAdminSender ? 'Support' : undefined}
							onEnd={message.isMine || (viewerIsAdmin && isAdminSender)}
							time={<bdi>{formatTime(message.createdAt)}</bdi>}
						>
							{message.body && <p dir="auto" className="whitespace-pre-wrap break-words">{message.body}</p>}
							{message.attachments.map((attachment) => (
								<AttachmentView key={attachment.url} attachment={attachment} />
							))}
						</MessageBubble>
					);
				})}
				<div ref={bottomRef} />
			</div>

			{/* Composer */}
			<div className="space-y-2 border-t-[2.5px] border-black bg-white p-3 sm:p-4">
				{pending.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{pending.map((attachment) => (
							<span
								key={attachment.url}
								className="inline-flex max-w-full items-center gap-1.5 rounded-full border-2 border-black bg-slate-100 py-1 ps-3 pe-1 text-xs font-medium"
							>
								<span className="max-w-[180px] truncate">{attachment.name}</span>
								<button
									type="button"
									aria-label={`Remove ${attachment.name}`}
									onClick={() => setPending((current) => current.filter((item) => item.url !== attachment.url))}
									className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</span>
						))}
					</div>
				)}
				<div className="flex items-end gap-3">
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
						className="h-12 w-12 shrink-0 p-0"
						disabled={isUploading || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
						onClick={() => fileInput.current?.click()}
						aria-label="Attach screenshots or PDFs"
					>
						{isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <PaperclipIcon />}
					</Button>
					<Textarea
						value={text}
						maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
						rows={2}
						placeholder={viewerIsAdmin ? 'Reply to the student…' : 'Describe the problem in detail…'}
						className="max-h-40 min-h-[48px] resize-none"
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								send();
							}
						}}
					/>
					<Button type="button" className="h-12 w-12 shrink-0 p-0" disabled={!canSend} onClick={send} aria-label="Send message">
						{isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendIcon />}
					</Button>
				</div>
				<p className="px-1 text-xs text-slate-600">Enter to send · Shift+Enter for a new line · images and PDFs up to 16 MB</p>
			</div>
		</ChatFrame>
	);
};
