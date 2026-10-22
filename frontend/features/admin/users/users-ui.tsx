'use client';

/**
 * Presentational pieces for the Users & Study Groups redesign (legacy runtime).
 * No data logic lives here: callers own state, API calls and permissions.
 * Layout uses logical utilities (ms/me/ps/pe/text-start/text-end) so Arabic RTL mirrors by itself.
 */
import type { ReactNode } from 'react';
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { translate, type MessageKey } from '@/frontend/locales/messages';
import { cn } from '@/shared/utils';

export const FOCUS =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Plural-aware count text, e.g. "2 students" / "طالبان". Uses the `counts.<noun>.<category>` keys. */
export const useCountText = () => {
	const { language, number } = useLanguage();
	return (noun: 'students' | 'submissions', count: number) => {
		const category = new Intl.PluralRules(language).select(count);
		return translate(language, `counts.${noun}.${category}` as MessageKey, { count: number(count) });
	};
};

/** Display label for a role. Display only: the internal role value is never changed. */
export const useRoleLabel = () => {
	const { t } = useLanguage();
	return (role: string) => {
		switch (role.toUpperCase()) {
			case 'STUDENT':
				return t('users.role.student');
			case 'TEACHER':
				return t('users.role.teacher');
			case 'ASSISTANT':
				return t('users.role.assistant');
			case 'ADMIN':
				return t('users.role.admin');
			default:
				return role;
		}
	};
};

export const roleTone = (role: string) => {
	switch (role.toUpperCase()) {
		case 'ADMIN':
			return 'border-purple-300 bg-purple-50 text-purple-800';
		case 'TEACHER':
			return 'border-amber-300 bg-amber-50 text-amber-900';
		case 'ASSISTANT':
			return 'border-sky-300 bg-sky-50 text-sky-800';
		default:
			return 'border-slate-300 bg-white text-slate-800';
	}
};

export const Pill = ({
	tone,
	icon,
	children,
	className,
}: {
	tone: string;
	icon?: ReactNode;
	children: ReactNode;
	className?: string;
}) => (
	<span
		className={cn(
			'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
			tone,
			className
		)}
	>
		{icon}
		<span className="truncate">{children}</span>
	</span>
);

/** Round initial badge. `dir="auto"` keeps Arabic and Latin initials correct. */
export const Initial = ({ name, className }: { name: string; className?: string }) => (
	<span
		aria-hidden
		dir="auto"
		className={cn(
			'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-900',
			className
		)}
	>
		{(name || '?').trim().charAt(0).toUpperCase()}
	</span>
);

export const PageHeader = ({
	pill,
	title,
	subtitle,
	refreshLabel,
	refreshing,
	onRefresh,
}: {
	pill: ReactNode;
	title: ReactNode;
	subtitle: ReactNode;
	refreshLabel: ReactNode;
	refreshing: boolean;
	onRefresh: () => void;
}) => (
	<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
		<div className="min-w-0 space-y-1.5">
			<span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
				<ShieldCheck className="h-3.5 w-3.5" aria-hidden />
				{pill}
			</span>
			<h1 className="font-display text-3xl leading-tight sm:text-4xl">{title}</h1>
			<p className="text-sm text-slate-700">{subtitle}</p>
		</div>
		<Button
			type="button"
			variant="outline"
			className="min-h-[44px] self-start"
			onClick={onRefresh}
			disabled={refreshing}
		>
			<RefreshCw className={cn('me-2 h-4 w-4', refreshing && 'animate-spin')} aria-hidden />
			{refreshLabel}
		</Button>
	</div>
);

export const StatCard = ({
	label,
	value,
	icon,
	iconTone,
}: {
	label: ReactNode;
	value: ReactNode;
	icon: ReactNode;
	iconTone: string;
}) => (
	<div className="rounded-2xl border border-slate-300 bg-white p-5">
		<div className="flex items-center justify-between gap-3">
			<div className="min-w-0">
				<p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{label}</p>
				<p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
			</div>
			<span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', iconTone)} aria-hidden>
				{icon}
			</span>
		</div>
	</div>
);

export const SectionTabs = ({
	tabs,
	value,
	onChange,
	ariaLabel,
}: {
	tabs: { value: string; label: ReactNode }[];
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
}) => (
	<div
		role="group"
		aria-label={ariaLabel}
		className="flex w-full flex-wrap gap-1 rounded-3xl border border-slate-300 bg-white p-1 sm:w-fit sm:rounded-full"
	>
		{tabs.map((tab) => (
			<button
				key={tab.value}
				type="button"
				aria-pressed={value === tab.value}
				onClick={() => onChange(tab.value)}
				className={cn(
					'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-4 text-xs font-semibold transition-colors',
					FOCUS,
					value === tab.value
						? 'border-black bg-primary text-primary-foreground'
						: 'border-transparent text-slate-800 hover:bg-slate-100'
				)}
			>
				{tab.label}
			</button>
		))}
	</div>
);

export const SectionHeading = ({
	icon,
	title,
	subtitle,
	trailing,
}: {
	icon: ReactNode;
	title: ReactNode;
	subtitle: ReactNode;
	trailing?: ReactNode;
}) => (
	<div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
		<div className="min-w-0">
			<h2 className="flex items-center gap-2 font-display text-xl sm:text-2xl">
				<span className="text-emerald-800" aria-hidden>
					{icon}
				</span>
				{title}
			</h2>
			<p className="mt-0.5 text-xs text-slate-700">{subtitle}</p>
		</div>
		{trailing}
	</div>
);

export const LoadingBlock = ({ label, className }: { label: ReactNode; className?: string }) => (
	<div role="status" className={cn('flex flex-col items-center justify-center gap-3 p-8', className)}>
		<Loader2 className="h-6 w-6 animate-spin text-emerald-700" aria-hidden />
		<span className="text-xs font-medium text-slate-700">{label}</span>
	</div>
);

export const EmptyBlock = ({
	icon,
	title,
	body,
	action,
	className,
}: {
	icon: ReactNode;
	title: ReactNode;
	body?: ReactNode;
	action?: ReactNode;
	className?: string;
}) => (
	<div className={cn('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
		<span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden>
			{icon}
		</span>
		<p className="text-sm font-semibold text-slate-900">{title}</p>
		{body && <p className="mt-0.5 max-w-sm text-xs text-slate-700">{body}</p>}
		{action && <div className="mt-4">{action}</div>}
	</div>
);

/**
 * Confirmation for destructive actions (revoke, delete, deny). Cancel is focused first so a stray
 * Enter press cannot confirm. The confirm button is visibly red and names the action.
 */
export const ConfirmDialog = ({
	open,
	onOpenChange,
	icon,
	title,
	description,
	confirmLabel,
	cancelLabel,
	busy,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	icon: ReactNode;
	title: ReactNode;
	description: ReactNode;
	confirmLabel: ReactNode;
	cancelLabel: ReactNode;
	busy: boolean;
	onConfirm: () => void;
}) => (
	<Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
		<DialogContent className="rounded-2xl border-2 border-black bg-white p-6 sm:max-w-md">
			<DialogHeader>
				<span
					className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl border-2 border-red-300 bg-red-50 text-red-700"
					aria-hidden
				>
					{icon}
				</span>
				<DialogTitle className="text-center text-lg font-bold text-slate-900">{title}</DialogTitle>
				<DialogDescription className="text-center text-sm leading-relaxed text-slate-700">
					{description}
				</DialogDescription>
			</DialogHeader>
			<DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
				<Button
					type="button"
					variant="outline"
					className="min-h-[44px]"
					autoFocus
					disabled={busy}
					onClick={() => onOpenChange(false)}
				>
					{cancelLabel}
				</Button>
				<Button type="button" variant="destructive" className="min-h-[44px]" disabled={busy} onClick={onConfirm}>
					{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : confirmLabel}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
);
