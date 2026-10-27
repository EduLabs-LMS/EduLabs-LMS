'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { L } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import type { CourseStatus } from '@/shared/teacher-home';

export const card = 'rounded-[24px] border-[2.5px] border-black bg-white p-5 shadow-hard';
export const button = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-black px-4 py-2 text-base font-bold shadow-hard-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black disabled:opacity-60';
export const primaryButton = cn(button, 'bg-primary text-black');
export const plainButton = cn(button, 'bg-white text-black');
export const inkButton = cn(button, 'bg-black text-white');
export const linkClass = 'inline-flex min-h-[44px] items-center text-base font-bold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black';

/** Re-runs the server reads for the whole page. */
export function useRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, retry: () => start(() => router.refresh()) };
}

export function Section({ id, title, children, className, eyebrow = false }: { id: string; title: React.ReactNode; children: React.ReactNode; className?: string; eyebrow?: boolean }) {
  return <section aria-labelledby={id} data-section={id} className={cn(card, 'space-y-4', className)}>
    <h2 id={id} className={eyebrow ? 'text-base font-bold uppercase tracking-wider' : 'font-display text-2xl leading-tight'}>{title}</h2>
    {children}
  </section>;
}

/** A failed or unknown read is reported as such, never as an empty or "all clear" result. */
export function SectionError({ status, onRetry, pending }: { status: number | null; onRetry: () => void; pending: boolean }) {
  return <div role="alert" data-state="error" className="space-y-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-slate-900">
    <p className="flex gap-2 text-base"><AlertCircle aria-hidden className="mt-1 h-5 w-5 shrink-0" /><span>
      {status === 401 ? <L id="th.state.error_401" /> : status === 403 ? <L id="th.state.error_403" /> : <L id="th.state.error" />}
    </span></p>
    {status === 401
      ? <Link href="/sign-in" className={plainButton}><L id="th.state.signin" /></Link>
      : status === 403 ? null
      : <button type="button" onClick={onRetry} disabled={pending} className={plainButton}>{pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="th.state.retry" /></button>}
  </div>;
}

export function SectionUnavailable({ messageId, action }: { messageId: 'th.hw.unavailable'; action?: React.ReactNode }) {
  return <div role="status" data-state="unavailable" className="space-y-3 rounded-2xl border-2 border-dashed border-black bg-slate-50 p-4">
    <p className="text-base text-slate-800"><L id={messageId} /></p>{action}
  </div>;
}

export function Empty({ id, children }: { id: 'th.next.empty' | 'th.first.next' | 'th.updates.empty' | 'th.coming.empty' | 'th.courses.empty'; children?: React.ReactNode }) {
  return <div data-state="empty" className="space-y-3"><p className="text-base text-slate-800"><L id={id} /></p>{children}</div>;
}

const tone: Record<CourseStatus, string> = { draft: 'bg-amber-100', published: 'bg-primary', archived: 'bg-slate-200' };
export function StatusBadge({ status }: { status: CourseStatus }) {
  return <span data-status={status} className={cn('inline-flex w-fit min-h-[28px] items-center rounded-full border-2 border-black px-3 text-base font-bold text-black', tone[status])}><L id={`th.courses.${status}`} /></span>;
}

export const sessionTime: Intl.DateTimeFormatOptions = { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };

export function CourseCards({ items, compact = false }: { items: { id: string; title: string; status: CourseStatus }[]; compact?: boolean }) {
  if (compact) return <ul>{items.map(c => <li key={c.id} className="border-t-2 border-black/15 first:border-t-0">
    <Link href={`/teacher/courses/${c.id}`} data-course={c.id} className="flex min-h-[48px] items-center justify-between gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
      <span className="min-w-0 break-words text-base font-bold"><bdi dir="auto">{c.title}</bdi></span>
      <StatusBadge status={c.status} />
    </Link>
  </li>)}</ul>;
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(c => <li key={c.id}>
    <Link href={`/teacher/courses/${c.id}`} data-course={c.id} className="flex min-h-[88px] flex-col justify-between gap-3 rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">
      <span className="break-words text-lg font-bold leading-snug"><bdi dir="auto">{c.title}</bdi></span>
      <StatusBadge status={c.status} />
    </Link>
  </li>)}</ul>;
}
