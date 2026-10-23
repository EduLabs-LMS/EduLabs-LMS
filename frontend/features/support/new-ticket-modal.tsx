'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { Input } from '@/frontend/components/ui/input';
import { Label } from '@/frontend/components/ui/label';
import type { SupportTicketDetail } from '@/shared/contracts/support';
import { MAX_SUBJECT_LENGTH, OTHER_SUBJECT, SUBJECT_PRESETS } from '@/shared/support';

interface NewTicketModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called with the freshly created ticket so the page can jump straight into its chat. */
	onCreated: (detail: SupportTicketDetail) => void;
}

/** Asks for the subject only. Name, email and avatar come from the signed-in session on the server. */
export const NewTicketModal = ({ open, onOpenChange, onCreated }: NewTicketModalProps) => {
	const [subject, setSubject] = useState<string>(SUBJECT_PRESETS[0]);
	const [customSubject, setCustomSubject] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isOther = subject === OTHER_SUBJECT;
	const canSubmit = !isSubmitting && (!isOther || customSubject.trim().length > 0);

	const reset = () => {
		setSubject(SUBJECT_PRESETS[0]);
		setCustomSubject('');
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!canSubmit) return;
		setIsSubmitting(true);
		try {
			const res = await api.post<SupportTicketDetail>('/api/support', {
				subject,
				customSubject: isOther ? customSubject : undefined,
			});
			reset();
			onOpenChange(false);
			onCreated(res.data);
		} catch (error) {
			const message =
				(error as { response?: { data?: unknown } })?.response?.data;
			toast.error(typeof message === 'string' && message ? message : 'Could not create the ticket.');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (isSubmitting) return;
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-md">
				<form onSubmit={submit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle className="font-display text-2xl">New ticket</DialogTitle>
						<DialogDescription>
							What do you need help with? You&apos;ll describe it in the chat next. Lesson or
							curriculum questions go to your teacher on WhatsApp instead.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-2">
						<Label htmlFor="support-subject">Subject</Label>
						<Dropdown
							id="support-subject"
							value={subject}
							onChange={(event) => setSubject(event.target.value)}
							className="h-10 w-full rounded-xl border-2 border-black bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						>
							{SUBJECT_PRESETS.map((preset) => (
								<option key={preset} value={preset}>
									{preset}
								</option>
							))}
						</Dropdown>
					</div>

					{isOther && (
						<div className="grid gap-2">
							<Label htmlFor="support-custom-subject">Please specify</Label>
							<Input
								id="support-custom-subject"
								autoFocus
								maxLength={MAX_SUBJECT_LENGTH}
								placeholder="Describe the topic in a few words"
								value={customSubject}
								onChange={(event) => setCustomSubject(event.target.value)}
							/>
						</div>
					)}

					<DialogFooter className="gap-2 sm:gap-0">
						<Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSubmit}>
							{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Create Ticket
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
