import { L } from '@/frontend/components/language-provider';
import { SkeletonPage } from '@/frontend/components/skeleton';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';

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
    <header aria-hidden="true" className="d-page-header"><div className="d-page-header-main"><DesignSkeleton className="h-9 w-64 max-w-full" /><DesignSkeleton className="h-5 w-80 max-w-full" /></div></header>
    <div aria-hidden="true" className="d-tabs"><DesignSkeleton className="h-8 w-24" /><DesignSkeleton className="h-8 w-24" /><DesignSkeleton className="h-8 w-24" /></div>
    <div className="d-card d-card--pad"><PanelSkeleton /></div>
  </>;
}

export function GroupSkeleton() {
  return <SkeletonPage name="group" label={<L id="tg.loading_group" />} className="d-page">
    <DesignSkeleton className="h-6 w-40" />
    <GroupBodySkeleton />
  </SkeletonPage>;
}

/** The lines of a list panel (Sessions, Students) while it reads. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-hidden="true" className="d-stack-sm">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="d-row"><DesignSkeleton className="h-11 w-11" /><div className="d-row-body d-stack-sm"><DesignSkeleton className="h-5 w-1/2" /><DesignSkeleton className="h-4 w-1/3" /></div></div>)}
  </div>;
}
