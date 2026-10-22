'use client';

/**
 * Presentational pieces for the teacher course area (courses, lessons, segments).
 * No data logic lives here: callers own state, API calls and permissions.
 * Layout uses logical utilities (ms/me/ps/pe/text-start/text-end) so Arabic RTL mirrors by itself.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, FileEdit, Info, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react';

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
import { FOCUS, Pill } from '@/frontend/features/admin/users/users-ui';
import type { MessageKey } from '@/frontend/locales/messages';
import { cn } from '@/shared/utils';

export { FOCUS, Pill };
export { EmptyBlock, LoadingBlock } from '@/frontend/features/admin/users/users-ui';

/** Page title block: role pill, display heading, one plain sentence, and the page's main actions. */
export const TeacherHeader = ({
	pill,
	title,
	subtitle,
	actions,
	children,
}: {
	pill: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) => (
	<div className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6">
		<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
			<div className="min-w-0 space-y-1.5">
				<span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
					<ShieldCheck className="h-3.5 w-3.5" aria-hidden />
					{pill}
				</span>
				<h1 dir="auto" className="font-display text-3xl leading-tight [overflow-wrap:anywhere] sm:text-4xl">
					{title}
				</h1>
				{subtitle && <p className="text-sm text-slate-700">{subtitle}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
		</div>
		{children}
	</div>
);

export const StatusPill = ({ published, className }: { published: boolean; className?: string }) => {
	const { t } = useLanguage();
	return published ? (
		<Pill
			tone="border-emerald-700 bg-emerald-100 text-emerald-950"
			icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
			className={className}
		>
			{t('teach.status.published')}
		</Pill>
	) : (
		<Pill tone="border-slate-500 bg-slate-100 text-slate-900" icon={<FileEdit className="h-3.5 w-3.5" aria-hidden />} className={className}>
			{t('teach.status.draft')}
		</Pill>
	);
};

/** A titled card used for the big sections of an editor ("Customize your lesson", "Lesson segments"). */
export const SectionCard = ({
	icon,
	title,
	subtitle,
	trailing,
	children,
	className,
}: {
	icon: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	trailing?: ReactNode;
	children: ReactNode;
	className?: string;
}) => (
	<section className={cn('rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6', className)}>
		<div className="flex items-center justify-between gap-3 border-b border-slate-300 pb-4">
			<div className="flex min-w-0 items-center gap-3">
				<span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-900" aria-hidden>
					{icon}
				</span>
				<div className="min-w-0">
					<h2 className="font-display text-xl leading-tight">{title}</h2>
					{subtitle && <p className="text-xs text-slate-700">{subtitle}</p>}
				</div>
			</div>
			{trailing}
		</div>
		<div className="mt-5 space-y-4">{children}</div>
	</section>
);

/**
 * One editable value: label, an "Edit ..." button, then the value or its editor.
 * Keeps the "Edit title" / "Edit description" pattern teachers already know.
 */
export const FieldCard = ({
	label,
	required,
	action,
	hint,
	children,
	className,
}: {
	label: ReactNode;
	required?: boolean;
	action?: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
	className?: string;
}) => (
	<div className={cn('rounded-2xl border border-slate-300 bg-slate-50 p-4', className)}>
		<div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-900">
			<span>
				{label}
				{required && (
					<span className="ms-1 font-bold text-red-700" aria-hidden>
						*
					</span>
				)}
				{required && <span className="sr-only"> (required)</span>}
			</span>
			{action}
		</div>
		{hint && <p className="mt-1 text-xs text-slate-700">{hint}</p>}
		<div className="mt-2 text-sm">{children}</div>
	</div>
);

type NoticeTone = 'warning' | 'info' | 'danger' | 'success';
const NOTICE: Record<NoticeTone, { box: string; Icon: typeof Info }> = {
	warning: { box: 'border-amber-600 bg-amber-100 text-amber-950', Icon: AlertTriangle },
	info: { box: 'border-sky-600 bg-sky-50 text-sky-950', Icon: Info },
	danger: { box: 'border-red-600 bg-red-50 text-red-950', Icon: XCircle },
	success: { box: 'border-emerald-700 bg-emerald-50 text-emerald-950', Icon: CheckCircle2 },
};

/** Inline message with a real contrast pair (the shared yellow banner used green text on yellow). */
export const Notice = ({
	tone = 'info',
	children,
	action,
	className,
}: {
	tone?: NoticeTone;
	children: ReactNode;
	action?: ReactNode;
	className?: string;
}) => {
	const { box, Icon } = NOTICE[tone];
	return (
		<div
			role={tone === 'danger' ? 'alert' : 'status'}
			className={cn('flex items-start gap-2.5 rounded-2xl border-2 px-4 py-3 text-sm font-medium', box, className)}
		>
			<Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
			<div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</div>
			{action}
		</div>
	);
};

/** "What is left before you can publish": each line is a real rule, shown as done or still to do. */
export const ReadinessList = ({
	title,
	items,
	className,
}: {
	title: ReactNode;
	items: { done: boolean; label: ReactNode }[];
	className?: string;
}) => (
	<div className={cn('rounded-2xl border border-slate-300 bg-slate-50 p-4', className)}>
		<p className="text-sm font-semibold text-slate-900">{title}</p>
		<ul className="mt-2 space-y-1.5">
			{items.map((item, index) => (
				<li key={index} className="flex items-start gap-2 text-sm text-slate-900">
					{item.done ? (
						<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
					) : (
						<Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden />
					)}
					<span className={cn(item.done && 'text-slate-700')}>
						{item.label}
						<span className="sr-only">{item.done ? ' (done)' : ' (still to do)'}</span>
					</span>
				</li>
			))}
		</ul>
	</div>
);

/**
 * Delete button that reads as destructive and always asks first. The confirm button names the action
 * and is red; Cancel is the default focus so a stray Enter cannot delete.
 */
export const DeleteButton = ({
	label,
	title,
	description,
	confirmLabel,
	onConfirm,
	disabled,
	iconOnly = true,
}: {
	label: string;
	title: ReactNode;
	description: ReactNode;
	confirmLabel: ReactNode;
	onConfirm: () => void;
	disabled?: boolean;
	iconOnly?: boolean;
}) => {
	const { t } = useLanguage();
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					aria-label={label}
					title={label}
					className={cn(
						'min-h-[44px] border-red-700 bg-red-50 text-red-800 hover:bg-red-100 hover:text-red-900',
						iconOnly ? 'min-w-[44px] px-3' : 'px-4'
					)}
				>
					<Trash2 className="h-4 w-4" aria-hidden />
					{!iconOnly && <span className="ms-2">{label}</span>}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="rounded-2xl border-2 border-black bg-white sm:max-w-md">
				<AlertDialogHeader>
					<span
						className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl border-2 border-red-300 bg-red-50 text-red-700"
						aria-hidden
					>
						<Trash2 className="h-5 w-5" />
					</span>
					<AlertDialogTitle className="text-center text-lg font-bold text-slate-900">{title}</AlertDialogTitle>
					<AlertDialogDescription className="text-center text-sm leading-relaxed text-slate-700">{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
					<AlertDialogCancel autoFocus className="min-h-[44px]">
						{t('teach.cancel')}
					</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} className="min-h-[44px] border-red-800 bg-red-700 text-white hover:bg-red-800">
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export const Spinner = ({ label }: { label: ReactNode }) => (
	<span role="status" className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
		<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
		{label}
	</span>
);

/** Warns before the tab closes or reloads while there are unsaved edits. */
export function useUnsavedWarning(dirty: boolean) {
	useEffect(() => {
		if (!dirty) return;
		const handler = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, [dirty]);
}

/** Plural-aware lesson count text: "1 lesson" / "3 lessons" / Arabic dual and plural forms. */
export function useLessonCount() {
	const { language, number, t } = useLanguage();
	return (count: number) => t(`counts.lessons.${new Intl.PluralRules(language).select(count)}` as MessageKey, { count: number(count) });
}

/** Focus a heading or field after a view change so keyboard and screen-reader users land in the right place. */
export function useFocusOnMount<T extends HTMLElement>(enabled = true) {
	const ref = useRef<T>(null);
	useEffect(() => {
		if (enabled) ref.current?.focus();
	}, [enabled]);
	return ref;
}
