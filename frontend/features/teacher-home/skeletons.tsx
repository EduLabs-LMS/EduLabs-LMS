'use client';
import { DesignSkeleton } from '@/frontend/components/design';
import { L } from '@/frontend/components/language-provider';
import { SkeletonPage } from '@/frontend/components/skeleton';
import { useWebsiteNavigation } from '@/frontend/components/providers/application-auth-provider';
import { LearningLoadState } from '@/frontend/features/self-learning/continue-learning';
import { isFirebaseStaging } from '@/shared/auth-config';
import { showTeacherNav } from '@/shared/teacher-home';

/** The teacher Home while it reads: the same order as the page itself. */
export function TeacherHomeSkeleton() {
  const row = <><DesignSkeleton className="h-6 w-40" />{[0, 1, 2].map(i => <DesignSkeleton key={i} className="h-5 w-full" />)}</>;
  return <SkeletonPage name="teacher-home" label={<L id="th.state.loading" />} className="d-page">
    <h1 className="sr-only"><L id="th.home.title" /></h1>
    <div aria-hidden="true" className="flex flex-col gap-2"><DesignSkeleton className="h-8 w-64 max-w-full" /><DesignSkeleton className="h-4 w-48" /></div>
    <div aria-hidden="true" className="d-tiles" style={{ '--d-tile-count': 2 } as React.CSSProperties}>{[0, 1].map(i => <div key={i} className="d-card d-kpi"><DesignSkeleton className="h-9 w-9" /><DesignSkeleton className="h-9 w-16" /></div>)}</div>
    <div aria-hidden="true" className="d-hero"><div className="flex w-full flex-col gap-3"><DesignSkeleton className="h-6 w-32" /><DesignSkeleton className="h-6 w-2/3" /><DesignSkeleton className="h-5 w-1/3" /><DesignSkeleton className="h-12 w-40" /></div></div>
    <div aria-hidden="true" className="d-home-grid">
      <div className="d-card d-card--pad flex flex-col gap-3">{row}</div>
      <div className="d-card d-card--pad flex flex-col gap-3">{row}</div>
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
