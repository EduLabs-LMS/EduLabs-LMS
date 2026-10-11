'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Layers, LockKeyhole, PlayCircle } from 'lucide-react';
import type { LessonCardStatus } from '@/shared/lesson-card-model';
import { cn } from '@/shared/utils';

/**
 * Adapted from EduLabs-v2/frontend/features/courses/lesson-card.tsx.
 * Preserves its top label / title / optional description / footer / image
 * overlay / hard shadow / status pill composition. Inputs use the NEW LMS
 * model. This component performs no fetches or access decisions.
 */
export interface LessonCardProps {
  /** Supply ONLY when a real, authorized NEW-LMS destination exists. */
  href?: string;
  /** A real course module title, or the display fallback "Module N". */
  moduleLabel: string;
  /** Local lesson number in its parent module; starts from one. */
  lessonNumber: number;
  title: string;
  description?: string | null;
  /** Only pass an authorized, ready-to-display URL (e.g. approved signed URL). */
  imageUrl?: string | null;
  /** Null when lesson block/part count is unavailable. Never invent "0 parts". */
  partsCount?: number | null;
  status: LessonCardStatus;
  className?: string;
}

const statusStyle: Record<LessonCardStatus, string> = {
  Completed: 'bg-emerald-100 text-emerald-800',
  'In Progress': 'bg-sky-100 text-sky-800',
  'Not Started': 'bg-slate-900 text-white',
  Published: 'bg-slate-100 text-slate-700',
  Locked: 'bg-slate-100 text-slate-500',
};

export const LessonCard = ({
  href,
  moduleLabel,
  lessonNumber,
  title,
  description,
  imageUrl,
  partsCount,
  status,
  className,
}: LessonCardProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [imageUrl]);
  const hasImage = Boolean(imageUrl) && !imageFailed;
  const summary = description?.trim();
  const StatusIcon = status === 'Completed'
    ? CheckCircle2
    : status === 'Locked'
      ? LockKeyhole
      : PlayCircle;

  const card = (
    <article
      className={cn(
        'group relative isolate flex h-full min-h-[200px] flex-col overflow-hidden rounded-2xl border-2 border-black p-5',
        '[box-shadow:3px_3px_0_#000] transition-all duration-200 ease-out motion-reduce:transition-none',
        hasImage ? 'bg-slate-900 text-white' : 'bg-white text-slate-950',
        href && 'hover:-translate-x-px hover:-translate-y-px hover:[box-shadow:5px_5px_0_#000] active:translate-x-0.5 active:translate-y-0.5 motion-reduce:transform-none',
        className,
      )}
    >
      {hasImage && (
        <>
          {/* Background is decorative; accessible content remains the visible text. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl as string}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setImageFailed(true)}
            className="absolute inset-0 z-0 h-full w-full object-cover"
          />
          <div aria-hidden="true" className="absolute inset-0 z-[1] bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-slate-950/45" />
        </>
      )}
      <p className={cn(
        'relative z-10 text-xs font-bold uppercase tracking-[0.14em]',
        hasImage ? 'text-sky-200' : 'text-sky-700',
      )}>
        {moduleLabel} • Lesson {lessonNumber}
      </p>
      <h3 className={cn('relative z-10 mt-3 line-clamp-2 text-lg font-bold leading-snug', hasImage && 'drop-shadow-sm')}>
        {title}
      </h3>
      {summary && (
        <p className={cn('relative z-10 mt-1.5 line-clamp-2 text-sm leading-relaxed', hasImage ? 'text-slate-200' : 'text-slate-600')}>
          {summary}
        </p>
      )}
      <div className={cn(
        'relative z-10 mt-auto flex items-center justify-between gap-3 border-t pt-3',
        hasImage ? 'border-white/25' : 'border-slate-200',
      )}>
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', hasImage ? 'text-slate-200' : 'text-slate-500')}>
          {partsCount !== undefined && partsCount !== null && (
            <>
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              {partsCount} {partsCount === 1 ? 'part' : 'parts'}
            </>
          )}
        </span>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 text-xs font-bold', statusStyle[status])}>
          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {status}
        </span>
      </div>
    </article>
  );

  return href ? (
    <Link
      href={href}
      className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
      aria-label={`${moduleLabel}, Lesson ${lessonNumber}: ${title} — ${status}`}
    >
      {card}
    </Link>
  ) : card;
};
