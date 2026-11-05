import type { ReactNode } from 'react';
import { cn } from '@/shared/utils';

/** A pulsing placeholder block. It is decoration only: the surrounding SkeletonPage announces "loading" once. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none', className)} />;
}

/**
 * The content area of a page while its data is on the way: the real page's layout drawn with placeholders. The app frame (sidebar and header)
 * is never part of it; it stays on screen while pages change. `label` is the one announcement for screen readers.
 */
export function SkeletonPage({ name, label, className, children }: { name: string; label: ReactNode; className?: string; children: ReactNode }) {
  return <div role="status" aria-busy="true" data-state="loading" data-skeleton={name} className={className}>
    {children}
    <span className="sr-only">{label}</span>
  </div>;
}

/** A neutral page: a heading bar and a card. For routes that have no layout of their own to copy (settings pages, forms) and for the root fallback. */
export function PageSkeleton({ name = 'page', label }: { name?: string; label: ReactNode }) {
  return <SkeletonPage name={name} label={label} className="mx-auto w-full max-w-3xl space-y-5">
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-10 w-64 max-w-full" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <div className="space-y-3 rounded-[24px] border-[2.5px] border-black bg-white p-5 shadow-hard"><Skeleton className="h-6 w-40" /><Skeleton className="h-12 w-full rounded-2xl" /><Skeleton className="h-12 w-full rounded-2xl" /><Skeleton className="h-5 w-1/2" /></div>
    </div>
  </SkeletonPage>;
}
