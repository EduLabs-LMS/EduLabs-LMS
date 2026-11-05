import { L } from '@/frontend/components/language-provider';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';

/** The attendance sheet while it reads. The sheet itself is never served from a copy: it always shows what the database holds. */
export function AttendanceSheetSkeleton() {
  return <div aria-hidden="true" className="space-y-3">
    <Skeleton className="h-8 w-56 max-w-full" />
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex min-h-[64px] items-center justify-between gap-3 rounded-2xl border-2 border-black/15 p-3"><Skeleton className="h-5 w-48 max-w-full" /><div className="flex gap-2"><Skeleton className="h-11 w-24 rounded-xl" /><Skeleton className="h-11 w-24 rounded-xl" /></div></div>)}
  </div>;
}

export function AttendanceSkeleton() {
  return <SkeletonPage name="attendance" label={<L id="ta.loading" />} className="w-full space-y-4">
    <Skeleton className="h-6 w-48" />
    <div aria-hidden="true" className="space-y-2"><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-5 w-64 max-w-full" /></div>
    <AttendanceSheetSkeleton />
  </SkeletonPage>;
}
