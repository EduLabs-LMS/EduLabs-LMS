'use client';

/**
 * Presentational pieces shared by both Support runtimes (Supabase and legacy).
 * They hold no data logic: callers pass text as ReactNode so each runtime keeps its own copy and i18n.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, LifeBuoy, Paperclip, PlusCircle, Send } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Avatar } from '@/frontend/features/support/avatar';
import { cn } from '@/shared/utils';

export const useIsRtl = () => useLanguage().direction === 'rtl';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Header card: icon, title, subtitle, then the New Ticket button (stacked, as in the target). */
export const SupportHeaderCard = ({
	title,
	subtitle,
	newTicketLabel,
	onNewTicket,
}: {
	title: ReactNode;
	subtitle: ReactNode;
	newTicketLabel: ReactNode;
	onNewTicket: () => void;
}) => (
	<div className="flex flex-col items-start gap-5 rounded-[28px] border-[2.5px] border-black bg-white p-5 shadow-hard sm:p-6">
		<div className="flex min-w-0 items-center gap-4">
			<div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[2.5px] border-black bg-primary text-primary-foreground shadow-hard-sm">
				<LifeBuoy className="h-7 w-7" aria-hidden />
			</div>
			<div className="min-w-0">
				<h1 className="font-display text-3xl leading-tight sm:text-4xl">{title}</h1>
				<p className="mt-1 text-sm text-slate-700 sm:text-base">{subtitle}</p>
			</div>
		</div>
		<Button type="button" size="lg" className="h-12 px-6 text-base" onClick={onNewTicket}>
			<PlusCircle className="me-2 h-5 w-5" aria-hidden />
			{newTicketLabel}
		</Button>
	</div>
);

export interface FilterOption {
	value: string;
	label: ReactNode;
}

/** Status filter pills. Same state and values as the old select; 44px touch targets. */
export const FilterPills = ({
	options,
	value,
	onChange,
	ariaLabel,
}: {
	options: FilterOption[];
	value: string;
	onChange: (value: string) => void;
	ariaLabel: string;
}) => (
	<div className="flex flex-wrap gap-3" role="group" aria-label={ariaLabel}>
		{options.map((option) => (
			<button
				key={option.value}
				type="button"
				aria-pressed={value === option.value}
				onClick={() => onChange(option.value)}
				className={cn(
					'min-h-[44px] rounded-full border-2 border-black px-5 text-sm font-bold transition-all',
					FOCUS,
					value === option.value
						? 'bg-primary text-primary-foreground shadow-hard-sm'
						: 'bg-white hover:bg-slate-100'
				)}
			>
				{option.label}
			</button>
		))}
	</div>
);

/** Small attention tag next to the status badge ("Awaiting reply", "Overdue"). */
export const AttentionTag = ({ tone, children }: { tone: 'wait' | 'late'; children: ReactNode }) => (
	<span
		className={cn(
			'inline-flex items-center rounded-full border-2 px-2.5 py-1 text-[11px] font-bold leading-none',
			tone === 'late' ? 'border-red-500 bg-red-100 text-red-700' : 'border-amber-500 bg-amber-50 text-amber-800'
		)}
	>
		{children}
	</span>
);

export const TicketCard = ({
	avatar,
	title,
	badges,
	meta,
	preview,
	footer,
	busy,
	onOpen,
}: {
	avatar: ReactNode;
	title: ReactNode;
	badges: ReactNode;
	meta?: ReactNode;
	preview?: ReactNode;
	footer: ReactNode;
	busy?: boolean;
	onOpen: () => void;
}) => {
	const Chevron = useIsRtl() ? ChevronLeft : ChevronRight;
	return (
		<button
			type="button"
			onClick={onOpen}
			disabled={busy}
			className={cn(
				'flex w-full items-center gap-4 rounded-[28px] border-[2.5px] border-black bg-white p-4 text-start shadow-hard transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg disabled:opacity-60 sm:p-5',
				FOCUS
			)}
		>
			{avatar}
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<span className="break-words text-lg font-semibold leading-tight">{title}</span>
					{badges}
				</div>
				{meta && <p className="mt-1 break-words text-sm text-slate-700">{meta}</p>}
				{preview && <p className="mt-1 line-clamp-2 break-words text-sm text-slate-700">{preview}</p>}
				<p className="mt-2 text-xs text-slate-600">{footer}</p>
			</div>
			<Chevron className="h-6 w-6 shrink-0 text-slate-600" aria-hidden />
		</button>
	);
};

/** Round back button that flips its arrow in RTL. */
export const BackButton = ({ onClick, label }: { onClick: () => void; label: string }) => {
	const Arrow = useIsRtl() ? ArrowRight : ArrowLeft;
	return (
		<Button type="button" variant="outline" className="h-12 w-12 shrink-0 p-0" onClick={onClick} aria-label={label}>
			<Arrow className="h-5 w-5" aria-hidden />
		</Button>
	);
};

export const ChatFrame = ({ children }: { children: ReactNode }) => (
	<div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[480px] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border-[2.5px] border-black bg-white shadow-hard">
		{children}
	</div>
);

export const ChatHeader = ({
	back,
	title,
	subtitle,
	control,
}: {
	back: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	control: ReactNode;
}) => (
	<div className="flex flex-wrap items-center gap-3 border-b-[2.5px] border-black bg-slate-50 px-4 py-3">
		{back}
		<div className="min-w-0 flex-1 basis-40">
			<h1 className="break-words font-display text-xl leading-tight sm:text-2xl">{title}</h1>
			{subtitle && <p className="break-words text-xs text-slate-700 sm:text-sm">{subtitle}</p>}
		</div>
		{control}
	</div>
);

/** Status select styled as the target's dropdown pill. */
export const StatusSelect = ({
	value,
	onChange,
	disabled,
	options,
	ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	options: { value: string; label: ReactNode; disabled?: boolean }[];
	ariaLabel: string;
}) => (
	<select
		aria-label={ariaLabel}
		value={value}
		disabled={disabled}
		onChange={(event) => onChange(event.target.value)}
		className={cn(
			'h-11 min-w-[9rem] cursor-pointer rounded-full border-2 border-black bg-white px-4 text-sm font-bold text-foreground shadow-hard-sm disabled:opacity-60',
			FOCUS
		)}
	>
		{options.map((option) => (
			<option key={option.value} value={option.value} disabled={option.disabled}>
				{option.label}
			</option>
		))}
	</select>
);

export const MessageBubble = ({
	name,
	avatarUrl,
	staffLabel,
	onEnd,
	time,
	children,
}: {
	name: string;
	avatarUrl: string | null;
	/** Display label for staff authors ("Support"). Absent for non-staff. */
	staffLabel?: ReactNode;
	/** True puts the message on the end side (right in LTR, left in RTL) in green. */
	onEnd: boolean;
	time: ReactNode;
	children: ReactNode;
}) => (
	<div className={cn('flex items-end gap-3', onEnd ? 'flex-row-reverse' : 'flex-row')}>
		<Avatar name={name} url={avatarUrl} isAdmin={Boolean(staffLabel)} />
		<div className={cn('flex min-w-0 max-w-[80%] flex-col gap-1.5', onEnd ? 'items-end' : 'items-start')}>
			<span className="flex flex-wrap items-center gap-2 px-1 text-xs font-semibold text-slate-700">
				<bdi dir="auto">{name}</bdi>
				{staffLabel && (
					<span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
						{staffLabel}
					</span>
				)}
			</span>
			<div
				className={cn(
					'max-w-full space-y-2 rounded-2xl border-2 border-black px-4 py-2.5 text-sm shadow-hard-sm',
					onEnd ? 'rounded-ee-md bg-primary text-primary-foreground' : 'rounded-es-md bg-white'
				)}
			>
				{children}
			</div>
			<span className="px-1 text-xs text-slate-600">{time}</span>
		</div>
	</div>
);

/** Composer row: attach button, textarea, send button. Callers pass the real handlers. */
export const SendIcon = () => <Send className={cn('h-5 w-5', useIsRtl() && '-scale-x-100')} aria-hidden />;
export const PaperclipIcon = () => <Paperclip className="h-5 w-5" aria-hidden />;
