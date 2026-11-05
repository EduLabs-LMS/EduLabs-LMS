import { L } from '@/frontend/components/language-provider';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';

export function StudentRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return <ul aria-hidden="true" className="divide-y-2 divide-black/15 border-y-2 border-black/15">
    {Array.from({ length: rows }, (_, i) => <li key={i} className="flex min-h-[64px] flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
      <div className="min-w-0 space-y-2 md:flex-1"><Skeleton className="h-5 w-48 max-w-full" /><Skeleton className="h-5 w-64 max-w-full" /></div>
      <Skeleton className="h-5 w-40 md:flex-1" /><Skeleton className="h-7 w-20 rounded-full" />
    </li>)}
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
  return <div role="status" data-state="loading" className="space-y-5">
    <div aria-hidden="true" className="space-y-3"><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-5 w-64 max-w-full" /><Skeleton className="h-5 w-48" /></div>
    <div aria-hidden="true" className="space-y-3 rounded-[24px] border-[2.5px] border-black bg-white p-5 shadow-hard"><Skeleton className="h-6 w-40" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-3/4" /></div>
    <span className="sr-only"><L id="ts.student.loading" /></span>
  </div>;
}

export function StudentSkeleton() {
  return <SkeletonPage name="student" label={<L id="ts.student.loading" />} className="w-full max-w-3xl space-y-5">
    <Skeleton className="h-6 w-40" />
    <div aria-hidden="true" className="space-y-3"><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-5 w-64 max-w-full" /><Skeleton className="h-5 w-48" /></div>
    <div aria-hidden="true" className="space-y-3 rounded-[24px] border-[2.5px] border-black bg-white p-5 shadow-hard"><Skeleton className="h-6 w-40" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-3/4" /></div>
  </SkeletonPage>;
}
