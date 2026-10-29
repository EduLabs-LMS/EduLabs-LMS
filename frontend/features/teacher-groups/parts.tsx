'use client';
import { AlertCircle, Loader2, MapPin, Video } from 'lucide-react';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { plainButton } from '@/frontend/features/teacher-home/parts';
import { sortedSchedules, weeklyReference, type FailureKind, type WeeklyTime } from '@/shared/teacher-groups';
import type { GroupSession } from '@/shared/contracts/groups';

const failureText: Record<FailureKind, MessageKey> = { signin: 'tg.error.signin', denied: 'tg.error.denied', changed: 'tg.error.changed', invalid: 'tg.error.invalid', unavailable: 'tg.error.unavailable' };

/** An honest failure: never shown as "nothing found". A 403 has no retry; a lost reply of a change says the outcome is unknown. */
export function GroupError({ kind, unknownOutcome = false, onRetry, retryLabel = 'tg.retry', pending = false }: { kind: FailureKind; unknownOutcome?: boolean; onRetry?: () => void; retryLabel?: 'tg.retry' | 'tg.reload'; pending?: boolean }) {
  return <div role="alert" data-state="error" className="space-y-3 rounded-2xl border-2 border-black bg-rose-50 p-4 text-slate-900">
    <p className="flex gap-2 text-base"><AlertCircle aria-hidden className="mt-1 h-5 w-5 shrink-0" /><span><L id={unknownOutcome ? 'tg.error.unknown_outcome' : failureText[kind]} /></span></p>
    {kind !== 'denied' && onRetry && <button type="button" onClick={onRetry} disabled={pending} className={plainButton}>{pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id={retryLabel} /></button>}
  </div>;
}

export function Loading({ label = 'tg.loading', className = 'h-24' }: { label?: MessageKey; className?: string }) {
  return <div role="status" data-state="loading"><div className={`animate-pulse rounded-2xl border-2 border-black bg-slate-200 ${className}`} /><span className="sr-only"><L id={label} /></span></div>;
}

export function ModeLabel({ mode }: { mode: 'center' | 'online' }) {
  const Icon = mode === 'online' ? Video : MapPin;
  return <span className="inline-flex items-center gap-1.5"><Icon aria-hidden className="h-4 w-4" /><L id={mode === 'online' ? 'tg.mode.online' : 'tg.mode.center'} /></span>;
}

/** "Sun 5:00 PM · Wed 5:00 PM", read in the Cairo wall-clock times the Group was set up with. */
export function WeeklyTimes({ items }: { items: readonly WeeklyTime[] }) {
  const { language } = useLanguage();
  const format = new Intl.DateTimeFormat(language, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  if (!items.length) return <L id="tg.card.no_weekly" />;
  return <>{sortedSchedules(items).map((s, i) => <span key={s.weekday + s.time}>{i > 0 && ' · '}<bdi>{format.format(new Date(weeklyReference(s.weekday, s.time)))}</bdi></span>)}</>;
}

export const stateTone: Record<GroupSession['state'], string> = { upcoming: 'bg-primary', ongoing: 'bg-amber-100', completed: 'bg-slate-200', cancelled: 'bg-rose-100' };
