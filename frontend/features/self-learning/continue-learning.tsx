'use client';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { L, useLanguage } from '@/frontend/components/language-provider';
import type { ResumeLearning } from '@/shared/continue-learning';
import { learningOverviewGeneration, learningOverviewMatches, learningOverviewServerGeneration, subscribeLearningOverview } from './learning-overview-freshness';

export function LearningLoadState({ loading = false, retry }: { loading?: boolean; retry?: () => void }) {
  return <section aria-busy={loading} className="rounded-3xl border-2 border-black bg-card p-5 sm:p-7 shadow-hard space-y-3">
    <h2 className="font-display text-2xl"><L id="resume.heading" /></h2>
    <p role={loading ? 'status' : 'alert'}><L id={loading ? 'resume.loading' : 'resume.error'} /></p>
    {retry && <Button onClick={retry}><L id="resume.retry" /></Button>}
  </section>;
}

export function ContinueLearning({ data: serverData, path, organizationId, offeringId }: { data: ResumeLearning; path: '/home' | '/self-learning'; organizationId?: string; offeringId?: string }) {
  const { t, number, direction } = useLanguage(), pathname = usePathname();
  const generation = useSyncExternalStore(subscribeLearningOverview, learningOverviewGeneration, learningOverviewServerGeneration);
  const [retryCount, setRetryCount] = useState(0);
  const [read, setRead] = useState<{ source: ResumeLearning; generation: number; organizationId?: string; offeringId?: string; result?: ResumeLearning; failed?: boolean } | null>(null);
  const needsRead = retryCount > 0 || (generation > 0 && !learningOverviewMatches(serverData.proofs ?? []));
  useEffect(() => {
    if (pathname !== path || !needsRead) return;
    let current = true;
    const controller = new AbortController();
    const selection = { source: serverData, generation, organizationId, offeringId };
    setRead(selection);
    // A scoped, awaitable read is independent of App Router's navigation queue.
    // Both the effect lifetime and generation must still match when it finishes.
    void (async () => {
      try {
        const response = await fetch('/api/learning-overview', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, offeringId }) });
        const result: ResumeLearning = await response.json();
        if (!response.ok || typeof result.unavailable !== 'boolean' || !Array.isArray(result.items)) throw new Error('Learning unavailable');
        if (current && learningOverviewGeneration() === generation) setRead({ ...selection, result });
      } catch {
        if (current && learningOverviewGeneration() === generation) setRead({ ...selection, failed: true });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [generation, needsRead, serverData, pathname, path, organizationId, offeringId, retryCount]);
  const matches = read?.source === serverData && read.generation === generation && read.organizationId === organizationId && read.offeringId === offeringId;
  const retry = () => setRetryCount(count => count + 1);
  if (needsRead && (!matches || (!read.result && !read.failed))) return <LearningLoadState loading retry={retry} />;
  if (needsRead && matches && read.failed) return <LearningLoadState retry={retry} />;
  const data = needsRead && matches && read.result ? read.result : serverData;
  if (data.unavailable) return <LearningLoadState retry={retry} />;
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
