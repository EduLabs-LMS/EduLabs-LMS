import { L } from '@/frontend/components/language-provider';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';

export function StudentRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return <ul aria-hidden="true" className="d-list d-card d-card--pad">
    {Array.from({ length: rows }, (_, i) => <li key={i} className="d-row"><DesignSkeleton className="h-9 w-9" /><div className="d-row-body d-stack-sm"><DesignSkeleton className="h-5 w-48 max-w-full" /><DesignSkeleton className="h-4 w-64 max-w-full" /></div><DesignSkeleton className="h-7 w-20" /></li>)}
  </ul>;
}

/** The Students route: the real heading, the filters and a list of placeholders. */
export function StudentsSkeleton() {
  return <SkeletonPage name="students" label={<L id="ts.students.loading" />} className="w-full space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="ts.students.title" /></h1><p className="text-base text-slate-700"><L id="ts.students.intro" /></p></div>
      <Skeleton className="h-12 w-44 rounded-2xl" />
    </header>
    <div aria-hidden="true" className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]"><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-12 rounded-2xl" /></div>
    <StudentRowsSkeleton />
  </SkeletonPage>;
}

/** The student's name, course and status card, drawn with placeholders (the back link is the page's own). */
export function StudentBodySkeleton() {
  return <div aria-hidden="true" className="d-stack-lg">
    <div className="d-page-header-main"><DesignSkeleton className="h-9 w-64 max-w-full" /><DesignSkeleton className="h-5 w-48 max-w-full" /></div>
    <div className="d-card d-card--pad d-stack-sm"><DesignSkeleton className="h-5 w-32" /><DesignSkeleton className="h-11 w-full" /></div>
    <div className="d-card d-card--pad d-stack-sm"><DesignSkeleton className="h-5 w-32" />{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-11 w-full" />)}</div>
  </div>;
}

export function StudentSkeleton() {
  return <SkeletonPage name="student" label={<L id="ts.student.loading" />} className="d-page">
    <DesignSkeleton className="h-5 w-24" />
    <StudentBodySkeleton />
  </SkeletonPage>;
}

/** Invite students while its page is prepared: the heading, the choices and the button. */
export function InviteSkeleton() {
  return <SkeletonPage name="invite" label={<L id="tg.loading" />} className="d-page">
    <header className="d-page-header"><div className="d-page-header-main"><DesignSkeleton className="h-5 w-24" /><h1 className="d-title"><L id="ts.invite.title" /></h1><DesignSkeleton className="h-5 w-72 max-w-full" /></div></header>
    <div aria-hidden="true" className="d-card d-card--pad d-stack-lg"><div className="d-field-pair d-field-pair--wide"><DesignSkeleton className="h-11 w-full" /><DesignSkeleton className="h-11 w-full" /></div><DesignSkeleton className="h-11 w-40" /></div>
  </SkeletonPage>;
}
