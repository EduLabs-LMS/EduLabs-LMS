import { L } from '@/frontend/components/language-provider';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { SkeletonPage } from '@/frontend/components/skeleton';

/** Settings pages keep the settings frame; only the content area shows this while a page is on its way. */
export default function Loading() {
  return <SkeletonPage name="settings" label={<L id="th.state.loading" />} className="d-stack-lg">
    {[0, 1].map(i => <div key={i} aria-hidden="true" className="d-card d-card--pad d-stack-sm"><DesignSkeleton className="h-6 w-40" /><DesignSkeleton className="h-11 w-full" /><DesignSkeleton className="h-11 w-48" /></div>)}
  </SkeletonPage>;
}
