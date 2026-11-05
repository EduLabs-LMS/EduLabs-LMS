'use client';
import { L } from '@/frontend/components/language-provider';
import { Skeleton, SkeletonPage } from '@/frontend/components/skeleton';
import { useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { LearningLoadState } from '@/frontend/features/self-learning/continue-learning';
import { card } from '@/frontend/features/teacher-home/parts';
import { isFirebaseStaging } from '@/shared/auth-config';
import { showTeacherNav } from '@/shared/teacher-home';

/** The teacher Home while it reads: the real heading and the three sections as placeholders. */
export function TeacherHomeSkeleton() {
  return <SkeletonPage name="teacher-home" label={<L id="th.state.loading" />} className="mx-auto w-full max-w-6xl space-y-6">
    <header><h1 className="font-display text-3xl leading-tight lg:text-4xl"><L id="th.home.title" /></h1></header>
    <div aria-hidden="true" className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3 rounded-[24px] border-[2.5px] border-black bg-primary/30 p-5 shadow-hard lg:col-span-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/3" /><Skeleton className="h-12 w-40 rounded-2xl" /></div>
      <div className={`${card} space-y-3`}><Skeleton className="h-6 w-40" />{[0, 1, 2].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
      <div className={`${card} space-y-3`}><Skeleton className="h-6 w-40" />{[0, 1, 2].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
    </div>
  </SkeletonPage>;
}

/**
 * The Home route's loading fallback. The teacher layout is told by the app frame (the same navigation context the sidebar uses); a student keeps
 * the student loading state unchanged.
 */
export function HomeLoading() {
  const navigation = useWebsiteNavigation();
  return showTeacherNav(isFirebaseStaging(), navigation?.staffOrganizationIds) ? <TeacherHomeSkeleton /> : <LearningLoadState loading />;
}
