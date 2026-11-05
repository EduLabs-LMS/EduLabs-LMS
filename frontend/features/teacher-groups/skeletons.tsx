import { L } from '@/frontend/components/language-provider';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';
import { card } from '@/frontend/features/teacher-home/parts';

/** The toolbar and the cards of the Groups list, drawn with placeholders. Used by the route's loading.tsx and by the list while it reads. */
export function GroupsListBodySkeleton() {
  return <>
    <div aria-hidden="true" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex gap-2"><Skeleton className="h-11 w-28 rounded-2xl" /><Skeleton className="h-11 w-28 rounded-2xl" /></div>
      <Skeleton className="h-11 w-full rounded-2xl md:w-80" />
    </div>
    <ul aria-hidden="true" className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map(i => <li key={i}><div className={`${card} flex h-full flex-col gap-3`}>
        <Skeleton className="h-7 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-24" />
        <div className="space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/3" /></div>
        <Skeleton className="mt-auto h-6 w-28" />
      </div></li>)}
    </ul>
  </>;
}

/** The whole Groups list route: the real heading, then the placeholders. */
export function GroupsListSkeleton() {
  return <SkeletonPage name="groups" label={<L id="tg.loading" />} className="w-full space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="tg.title" /></h1><Skeleton className="mt-2 h-5 w-72 max-w-full" /></div>
      <Skeleton className="h-12 w-44 rounded-2xl" />
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
