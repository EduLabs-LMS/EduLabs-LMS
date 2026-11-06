import { L } from '@/frontend/components/language-provider';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { SkeletonPage } from '@/frontend/components/skeleton';

export default function Loading() {
  return <SkeletonPage name="group-form" label={<L id="tg.loading" />} className="d-page d-form-page">
    <div aria-hidden="true" className="d-page-header-main"><DesignSkeleton className="h-5 w-24" /><DesignSkeleton className="h-9 w-56" /></div>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-sm">{[0, 1, 2, 3].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div>
  </SkeletonPage>;
}
