'use client';
import { T, useLocale } from '@/frontend/design/preferences';

import { type ReactNode, useEffect, useState } from 'react';
import { useApplicationAuth } from '@/frontend/components/providers/application-auth-provider';
import { isFirebaseStaging } from '@/shared/auth-config';
import { api } from '@/frontend/lib/api';
import { HelpCircle, Send, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/frontend/components/ui/dialog';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { useSupportModal } from '@/frontend/hooks/use-support-modal';

interface SupportModalProps {
	trigger?: ReactNode;
}

const SupportModal = ({ trigger }: SupportModalProps) => {
	const { user } = useApplicationAuth();
  const {t}=useLocale();
	const supportModal = useSupportModal();

	const [studentName, setStudentName] = useState('');
	const [studentEmail, setStudentEmail] = useState('');
	const [subject, setSubject] = useState('');
	const [message, setMessage] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const clerkEmail = user?.email ?? '';
	const clerkName =
		user?.fullName ||

		user?.username ||
		'';

	useEffect(() => {
		if (clerkEmail) {
			setStudentEmail((prev) => prev || clerkEmail);
		}
		if (clerkName) {
			setStudentName((prev) => prev || clerkName);
		}
	}, [clerkEmail, clerkName]);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!studentEmail.trim() || !message.trim()) {
			toast.error('Please provide an email and message.');
			return;
		}

		if (isFirebaseStaging()) {
			window.location.assign('mailto:support.lop.physics@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(message));
			return;
		}
		setIsSubmitting(true);

		try {
			await api.post('/api/support', {
				name: studentName.trim() || 'Student',
				email: studentEmail.trim(),
				subject: subject.trim() || 'Website Help Request',
				message: message.trim(),
			});

			toast.success('Your help request has been sent to our team.');
			setMessage('');
			setSubject('');
			supportModal.onClose();
		} catch (error) {
			console.error(error);
			toast.error('We could not send your request. Please try again.');
		} finally {
			setIsSubmitting(false);
		}
	};

	const onOpenChange = (open: boolean) => {
		if (open) {
			supportModal.onOpen();
		} else {
			supportModal.onClose();
		}
	};

	return (
		<Dialog open={supportModal.isOpen} onOpenChange={onOpenChange}>
			{trigger && (
				<DialogTrigger asChild onClick={() => supportModal.onOpen()}>
					{trigger}
				</DialogTrigger>
			)}

			<DialogContent className="border border-slate-200 bg-white text-slate-900 shadow-2xl sm:max-w-lg rounded-2xl p-6">
				<DialogHeader>
					<div className="flex items-center gap-2 text-sky-700 font-semibold mb-1 text-sm">
						<HelpCircle className="h-5 w-5" />
						<T>{"Website Help"}</T></div>
					<DialogTitle className="text-xl font-bold text-slate-900">
						<T>{"Report a website problem"}</T></DialogTitle>
					<DialogDescription className="leading-relaxed text-slate-500 text-sm">
						{isFirebaseStaging() ? <T arabic="اشرح مشكلة الموقع. يفتح هذا النموذج رسالة في تطبيق البريد لديك؛ أرسلها من هناك. للأسئلة الدراسية استخدم أزرار التواصل أسفل الصفحة.">Describe the website problem. This form opens a draft in your email app; send it from there. For lesson questions, use the contact links in the footer.</T> : <T>Trouble logging in, watching a video, or uploading homework? Tell us what happened and our team will help. For lesson questions, use the WhatsApp or call buttons in the footer.</T>}</DialogDescription>
				</DialogHeader>

				<form className="mt-4 space-y-3.5" onSubmit={onSubmit}>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="text-xs font-semibold uppercase tracking-wider text-slate-700" htmlFor="support-name">
								<T>{"Your Name"}</T></label>
							<Input
								id="support-name"
								type="text"
								value={studentName}
								onChange={(event) => setStudentName(event.target.value)}
								placeholder={t('Full Name')}
								className="border-slate-200 bg-slate-50 text-slate-900 focus:bg-white text-xs h-9 transition-colors"
							/>
						</div>
						<div className="space-y-1">
							<label className="text-xs font-semibold uppercase tracking-wider text-slate-700" htmlFor="support-email">
								<T>{"Email Address"}</T><span className="text-red-500">*</span>
							</label>
							<Input
								id="support-email"
								type="email"
								value={studentEmail}
								onChange={(event) => setStudentEmail(event.target.value)}
								placeholder="student@example.com"
								required
								className="border-slate-200 bg-slate-50 text-slate-900 focus:bg-white text-xs h-9 transition-colors"
							/>
						</div>
					</div>

					<div className="space-y-1">
						<label className="text-xs font-semibold uppercase tracking-wider text-slate-700" htmlFor="support-subject">
							<T>{"Subject"}</T><span className="text-red-500">*</span>
						</label>
						<Input
							id="support-subject"
							type="text"
							value={subject}
							onChange={(event) => setSubject(event.target.value)}
							placeholder={t('e.g. Video playback buffering in Chapter 1')}
							required
							className="border-slate-200 bg-slate-50 text-slate-900 focus:bg-white text-xs h-9 transition-colors"
						/>
					</div>

					<div className="space-y-1">
						<label className="text-xs font-semibold uppercase tracking-wider text-slate-700" htmlFor="support-message">
							<T>{"Message"}</T><span className="text-red-500">*</span>
						</label>
						<Textarea
							id="support-message"
							value={message}
							onChange={(event) => setMessage(event.target.value)}
							placeholder={t('Describe what happened or where you encountered the issue...')}
							required
							rows={4}
							maxLength={2000}
							className="border-slate-200 bg-slate-50 text-slate-900 focus:bg-white text-xs transition-colors"
						/>
					</div>

					<DialogFooter className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => supportModal.onClose()}
							className="border-slate-200 text-slate-700 hover:bg-slate-100"
						>
							<T>{"Cancel"}</T></Button>
						<Button
							type="submit"
							size="sm"
							disabled={isSubmitting}
							className="bg-slate-900 text-white hover:bg-slate-800 shadow-sm gap-1.5"
						>
							{isSubmitting ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									<span><T>{"Sending..."}</T></span>
								</>
							) : (
								<>
									<Send className="h-3.5 w-3.5" />
									<span>{isFirebaseStaging() ? <T arabic="فتح تطبيق البريد">Open email app</T> : <T>Send help request</T>}</span>
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default SupportModal;
