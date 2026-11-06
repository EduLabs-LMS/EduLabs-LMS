import { L } from '@/frontend/components/language-provider';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { card } from '@/frontend/features/teacher-home/parts';

/** The toolbar and the cards of the Groups list, drawn with placeholders. Used by the route's loading.tsx and by the list while it reads. */
export function GroupsListBodySkeleton() {
  return <>
    <div aria-hidden="true" className="d-toolbar">
      <div className="d-filters"><DesignSkeleton className="h-11 w-28" /><DesignSkeleton className="h-11 w-28" /></div>
      <div className="d-toolbar-search"><DesignSkeleton className="h-11 w-full" /></div>
    </div>
    <ul aria-hidden="true" className="d-group-list">
      {[0, 1, 2, 3].map(i => <li key={i}><div className="d-group-card">
        <DesignSkeleton className="h-6 w-2/3" /><DesignSkeleton className="h-5 w-1/2" /><DesignSkeleton className="h-5 w-3/4" /><DesignSkeleton className="h-5 w-1/3" />
      </div></li>)}
    </ul>
  </>;
}

/** The whole Groups list route: the real heading, then the placeholders. */
export function GroupsListSkeleton() {
  return <SkeletonPage name="groups" label={<L id="tg.loading" />} className="d-page">
    <header className="d-page-header">
      <div className="d-page-header-main"><h1 className="d-title"><L id="tg.title" /></h1><DesignSkeleton className="h-5 w-72 max-w-full" /></div>
      <DesignSkeleton className="hidden h-11 w-44 md:block" />
    </header>
    <GroupsListBodySkeleton />
  </SkeletonPage>;
}

/** The title block, the tabs and the Sessions card of one Group. */
export function GroupBodySkeleton() {
  return <>
    <header aria-hidden="true" className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-2"><Skeleton className="h-10 w-64 max-w-full" /><Skeleton className="h-5 w-40" /></div><Skeleton className="h-8 w-24 rounded-full" /></div>
      <Skeleton className="h-5 w-32" />
    </header>
    <div aria-hidden="true" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-2"><Skeleton className="h-11 w-28 rounded-2xl" /><Skeleton className="h-11 w-28 rounded-2xl" /><Skeleton className="h-11 w-28 rounded-2xl" /></div>
        <div className={`${card} space-y-4`}>
          <Skeleton className="h-6 w-40" />
          {[0, 1, 2].map(i => <div key={i} className="space-y-2 rounded-2xl border-2 border-black/15 p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-1/3" /></div>)}
        </div>
      </div>
      <div className={`${card} hidden h-fit space-y-3 lg:block`}><Skeleton className="h-6 w-32" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" /></div>
    </div>
  </>;
}

export function GroupSkeleton() {
  return <SkeletonPage name="group" label={<L id="tg.loading_group" />} className="w-full space-y-5">
    <Skeleton className="h-6 w-40" />
    <GroupBodySkeleton />
  </SkeletonPage>;
}

/** The lines of a list panel (Sessions, Students) while it reads. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden="true" className="space-y-3">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="space-y-2 rounded-2xl border-2 border-black/15 p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-1/3" /></div>)}
  </div>;
}
