'use client';
import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/shared/utils';

/** The look every screen shares: Caprasimo title, strong borders, round chips, hard shadows used with restraint. */
export const card = 'rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6';
export const fieldClass = 'min-h-[44px] w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-sm';
export const buttonClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border-2 border-black bg-white px-4 text-sm font-bold shadow-hard-sm hover:bg-slate-100 disabled:opacity-50';
export const primaryButtonClass = buttonClass + ' !bg-primary';

export function PageHeader({ title, subtitle, actions, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
	return (
		<header className="flex flex-wrap items-end justify-between gap-4">
			<div className="flex min-w-0 items-start gap-4">
				{icon && <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[2.5px] border-black bg-primary">{icon}</div>}
				<div className="min-w-0"><h1 className="font-display text-3xl sm:text-4xl">{title}</h1>{subtitle && <p className="mt-2 max-w-2xl text-sm text-slate-700">{subtitle}</p>}</div>
			</div>
			{actions && <div className="flex flex-wrap gap-2">{actions}</div>}
		</header>
	);
}

export function Card({ className, children, as: Tag = 'section' }: { className?: string; children: React.ReactNode; as?: 'section' | 'div' | 'article' }) {
	return <Tag className={cn(card, className)}>{children}</Tag>;
}

export function Chip({ tone = 'neutral', children, className }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode; className?: string }) {
	return <span className={cn('inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-bold', tone === 'good' ? 'border-green-800 bg-green-50 text-green-900' : tone === 'warn' ? 'border-amber-800 bg-amber-50 text-amber-900' : tone === 'bad' ? 'border-red-800 bg-red-50 text-red-900' : 'border-slate-500 bg-slate-50 text-slate-800', className)}>{children}</span>;
}

export function StatCard({ label, value, icon }: { label: React.ReactNode; value: React.ReactNode; icon?: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-3xl border-2 border-black bg-white p-4 shadow-hard-sm sm:p-5">
			<div><p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>
			{icon && <span aria-hidden className="shrink-0 text-green-800">{icon}</span>}
		</div>
	);
}

export function EmptyState({ icon, title, note, action }: { icon?: React.ReactNode; title: React.ReactNode; note?: React.ReactNode; action?: React.ReactNode }) {
	return (
		<div className="m-pop flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-black bg-white/60 px-6 py-10 text-center">
			{icon && <span aria-hidden className="text-green-800">{icon}</span>}
			<p className="font-display text-xl">{title}</p>
			{note && <p className="max-w-md text-sm text-slate-700">{note}</p>}
			{action}
		</div>
	);
}

export function FilterPills<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (value: T) => void; label: string }) {
	return (
		<div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
			{options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cn('min-h-[44px] shrink-0 whitespace-nowrap rounded-full border-2 border-black px-4 text-sm font-bold', value === o.value ? 'bg-primary shadow-hard-sm' : 'bg-white hover:bg-slate-100')}>{o.label}</button>)}
		</div>
	);
}

export function SearchField({ value, onChange, placeholder, label, className }: { value: string; onChange: (value: string) => void; placeholder?: string; label: string; className?: string }) {
	return (
		<div className={cn('relative min-w-[12rem] flex-1', className)}>
			<Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
			<input aria-label={label} placeholder={placeholder} value={value} maxLength={160} onChange={e => onChange(e.target.value)} className={cn(fieldClass, 'rounded-full ps-9')} />
		</div>
	);
}

export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
	return <div role="status" className={cn('space-y-3', className)}>{Array.from({ length: rows }, (_, i) => <div key={i} className="m-skeleton h-20 rounded-2xl" />)}</div>;
}
