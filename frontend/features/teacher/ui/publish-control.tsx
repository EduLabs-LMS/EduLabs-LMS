'use client';

/**
 * Publish / Unpublish for a course, lesson or segment. Publishing is one click; unpublishing hides
 * content from students, so it names the consequence and asks first. When the real rules are not met
 * the button is off and the reason is shown, never hidden.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/frontend/components/ui/alert-dialog';
import { Button } from '@/frontend/components/ui/button';
import { Spinner } from '@/frontend/features/teacher/ui/teacher-ui';

export type PublishKind = 'course' | 'lesson' | 'segment';

export function PublishControl({
	kind,
	published,
	blockedReason,
	disabled,
	onChange,
}: {
	kind: PublishKind;
	published: boolean;
	/** Why Publish is unavailable right now (from the real rules). Unpublishing is always allowed. */
	blockedReason?: string;
	disabled?: boolean;
	onChange: (published: boolean) => Promise<unknown>;
}) {
	const { t } = useLanguage();
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function apply(next: boolean) {
		setBusy(true);
		setError('');
		try {
			await onChange(next);
			toast.success(t(next ? `teach.${kind}.published_toast` : (`teach.${kind}.unpublished_toast` as const)));
			router.refresh();
		} catch (e) {
			const message = e instanceof Error ? e.message : t('teach.save_failed');
			setError(message);
			toast.error(message);
		} finally {
			setBusy(false);
		}
	}

	const off = disabled || busy;
	return (
		<div className="flex flex-col items-start gap-1 sm:items-end">
			{published ? (
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button type="button" variant="outline" className="min-h-[44px]" disabled={off}>
							<EyeOff className="me-2 h-4 w-4" aria-hidden />
							{t('teach.unpublish')}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent className="rounded-2xl border-2 border-black bg-white sm:max-w-md">
						<AlertDialogHeader>
							<AlertDialogTitle className="text-lg font-bold text-slate-900">{t(`teach.${kind}.unpublish_title`)}</AlertDialogTitle>
							<AlertDialogDescription className="text-sm leading-relaxed text-slate-700">{t(`teach.${kind}.unpublish_body`)}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row">
							<AlertDialogCancel autoFocus className="min-h-[44px]">
								{t('teach.cancel')}
							</AlertDialogCancel>
							<AlertDialogAction className="min-h-[44px]" onClick={() => void apply(false)}>
								{t('teach.unpublish')}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			) : (
				<Button type="button" className="min-h-[44px]" disabled={off || Boolean(blockedReason)} aria-describedby={blockedReason ? `publish-reason-${kind}` : undefined} onClick={() => void apply(true)}>
					<Eye className="me-2 h-4 w-4" aria-hidden />
					{t('teach.publish')}
				</Button>
			)}
			{busy && <Spinner label={t('teach.saving')} />}
			{!published && blockedReason && (
				<p id={`publish-reason-${kind}`} className="max-w-xs text-xs font-medium text-slate-800 sm:text-end">
					{blockedReason}
				</p>
			)}
			{error && (
				<p role="alert" className="max-w-xs text-xs font-medium text-red-800 sm:text-end">
					{error}
				</p>
			)}
		</div>
	);
}
