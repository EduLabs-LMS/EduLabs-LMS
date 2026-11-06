import { L } from '@/frontend/components/language-provider';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { SkeletonPage } from '@/frontend/components/skeleton';

/** The attendance sheet while it reads. The sheet itself is never served from a copy: it always shows what the database holds. */
export function AttendanceSheetSkeleton() {
  return <div aria-hidden="true" className="d-stack-lg">
    <DesignSkeleton className="h-8 w-56 max-w-full" />
    <div className="d-card d-card--pad">{Array.from({ length: 8 }, (_, i) => <div key={i} className="d-row"><div className="d-row-body"><DesignSkeleton className="h-5 w-48 max-w-full" /></div><DesignSkeleton className="h-11 w-44" /></div>)}</div>
  </div>;
}

export function AttendanceSkeleton() {
  return <SkeletonPage name="attendance" label={<L id="ta.loading" />} className="d-page">
    <DesignSkeleton className="h-6 w-48" />
    <div aria-hidden="true" className="d-stack-sm"><DesignSkeleton className="h-10 w-72 max-w-full" /><DesignSkeleton className="h-5 w-64 max-w-full" /></div>
    <AttendanceSheetSkeleton />
  </SkeletonPage>;
}
