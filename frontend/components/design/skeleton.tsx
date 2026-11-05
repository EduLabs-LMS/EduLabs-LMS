import { cn } from '@/shared/utils';

/** A placeholder block in the look's own colour. Decoration only: the page announces "loading" once (SkeletonPage). */
export function DesignSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('d-skeleton', className)} />;
}
