'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { installPreviewWriteGuard, previewHiddenRoute, studentPreviewCookie } from '@/shared/student-preview';
import { cn } from '@/shared/utils';

function setPreview(on: boolean) {
	// Display-only cookie: it is ignored by the server unless the user is teacher-side.
	document.cookie = `${studentPreviewCookie}=${on ? '1' : ''}; path=/; SameSite=Lax; max-age=${on ? 60 * 60 * 8 : 0}`;
}

/** Teacher-side users only. Renders nothing for students and every other role. */
export function StudentPreviewToggle({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
	const navigation = useWebsiteNavigation();
	const router = useRouter();
	if (!navigation?.teacherSide) return null;
	const on = !!navigation.studentPreview;
	const Icon = on ? EyeOff : Eye;
	return (
		<button
			type="button"
			onClick={() => {
				setPreview(!on);
				onNavigate?.();
				router.push(on ? '/home' : '/self-learning');
				router.refresh();
			}}
			className={cn(
				'flex w-full items-center gap-3 rounded-2xl border-2 border-black px-4 py-2.5 min-h-[44px] text-sm font-bold shadow-hard-sm transition-all active:translate-x-0.5 active:translate-y-0.5',
				on ? 'bg-primary text-black' : 'bg-white text-black hover:bg-slate-100',
				className
			)}
		>
			<Icon aria-hidden className="h-5 w-5 shrink-0" />
			<span><L id={on ? 'preview.back_to_teacher' : 'preview.view_as_student'} /></span>
		</button>
	);
}

/** Persistent indicator while previewing. Also keeps the preview read-only and inside student pages. */
export function StudentPreviewBar() {
	const navigation = useWebsiteNavigation();
	const router = useRouter();
	const pathname = usePathname();
	const { t } = useLanguage();
	const active = !!navigation?.teacherSide && !!navigation?.studentPreview;

	useEffect(() => {
		if (!active) return;
		return installPreviewWriteGuard(window as never, () => toast(t('preview.not_saved')));
	}, [active, t]);
	useEffect(() => {
		if (active && previewHiddenRoute(pathname)) router.replace('/self-learning');
	}, [active, pathname, router]);

	if (!active) return null;
	return (
		<div className="fixed inset-x-0 bottom-0 z-[70] p-3 md:ps-[19rem]" role="status">
			<div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border-[2.5px] border-black bg-primary px-4 py-3 text-black shadow-hard">
				<div className="flex min-w-0 items-center gap-3">
					<Eye aria-hidden className="h-5 w-5 shrink-0" />
					<p className="text-sm font-semibold"><strong><L id="preview.banner" /></strong>{' · '}<L id="preview.banner_note" /></p>
				</div>
				<button
					type="button"
					onClick={() => { setPreview(false); router.push('/home'); router.refresh(); }}
					className="min-h-[44px] rounded-xl border-2 border-black bg-white px-4 text-sm font-bold shadow-hard-sm active:translate-x-0.5 active:translate-y-0.5"
				>
					<L id="preview.exit" />
				</button>
			</div>
		</div>
	);
}
