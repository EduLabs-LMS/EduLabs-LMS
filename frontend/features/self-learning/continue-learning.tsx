'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { ResumeLearning } from '@/shared/continue-learning';
import { learningOverviewIsDirty, learningOverviewMatches, learningOverviewServerSnapshot, subscribeLearningOverview, clearLearningOverviewDirty, markLearningOverviewDirty } from './learning-overview-freshness';

export function LearningLoadState({ loading = false, retry }: { loading?: boolean; retry?: () => void }) {
  return <section aria-busy={loading} className="rounded-3xl border-2 border-black bg-card p-5 sm:p-7 shadow-hard space-y-3">
    <h2 className="font-display text-2xl"><L id="resume.heading" /></h2>
    <p role={loading ? 'status' : 'alert'}><L id={loading ? 'resume.loading' : 'resume.error'} /></p>
    {retry && <Button onClick={retry}><L id="resume.retry" /></Button>}
  </section>;
}

export function ContinueLearning({ data, path }: { data: ResumeLearning; path: '/home' | '/self-learning' }) {
  const { t, number, direction } = useLanguage(), router = useRouter(), pathname = usePathname();
  const dirty = useSyncExternalStore(subscribeLearningOverview, learningOverviewIsDirty, learningOverviewServerSnapshot);
  const [invalidatedData, setInvalidatedData] = useState<string | ResumeLearning | null>(null);
  useEffect(() => {
    if (!dirty || pathname !== path || data.unavailable) return;
    if (learningOverviewMatches(data.proofs ?? [])) { clearLearningOverviewDirty(); return; }
    // Retain the server read ID until a new RSC response acknowledges a read.
    // If refresh fails, expose retry instead of showing known-stale results.
    setInvalidatedData(data.readId ?? data);
    clearLearningOverviewDirty();
    // Defer one frame so a restoring/streaming navigation can commit first.
    // This is a single invalidation, not polling or a repeating timer.
    requestAnimationFrame(() => {
      if (window.location.pathname === path) router.refresh();
      else markLearningOverviewDirty();
    });
  }, [dirty, data, router, pathname, path]);
  // router.refresh() has no completion promise. A new RSC payload, rather than
  // an overlapping navigation's transition flag, confirms this read finished.
  const retry = () => { setInvalidatedData(data.readId ?? data); router.refresh(); };
  if (data.unavailable) return <LearningLoadState retry={retry} />;
  if ((dirty && pathname === path) || invalidatedData === (data.readId ?? data)) return <LearningLoadState loading retry={retry} />;
  return <section aria-label={t('resume.heading')} className="rounded-3xl border-2 border-black bg-card p-5 sm:p-7 shadow-hard space-y-4">
    <h2 className="font-display text-2xl flex gap-3 items-center"><BookOpen aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" /><L id="resume.heading" /></h2>
    {!data.items.length ? <p role="status" className="text-muted-foreground"><L id="resume.empty" /></p> : <>
      <p className="text-sm text-muted-foreground"><L id="resume.order" /></p>
      <ul className="divide-y divide-border">{data.items.map(item => <li key={`${item.offeringId}:${item.lessonId}`} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0 space-y-1 break-words">
          <p className="text-sm text-muted-foreground"><bdi>{item.courseTitle}</bdi>{' · '}<bdi>{item.offeringName}</bdi></p>
          <h3 className="font-semibold text-lg"><bdi>{item.lessonTitle}</bdi></h3>
          <p className="text-sm"><bdi>{item.partTitle}</bdi></p>
          <p className="text-sm text-muted-foreground"><L id="resume.parts" values={{ done: number(item.completedParts), total: number(item.totalParts) }} /></p>
        </div>
        <Button asChild className="shrink-0 self-start sm:self-center h-auto min-h-[44px] py-3 whitespace-normal text-center">
          <Link href={item.href} aria-label={t('resume.actionLabel', { lesson: item.lessonTitle, offering: item.offeringName })}>
            <L id="resume.action" /><ArrowRight aria-hidden="true" className="ms-2 h-4 w-4 shrink-0" style={{ scale: direction === 'rtl' ? '-1 1' : '1 1' }} />
          </Link>
        </Button>
      </li>)}</ul>
      <p className="text-xs text-muted-foreground"><L id="resume.positionHint" /></p>
    </>}
  </section>;
}
