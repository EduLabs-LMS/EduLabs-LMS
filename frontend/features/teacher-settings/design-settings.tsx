'use client';
import { useEffect, useState } from 'react';
import { SegmentedControl } from '@/frontend/components/design';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { defaultDesign, designCookie, isDesign, type Design } from '@/shared/design';

/**
 * The Classic / New switch, a lasting personal preference (owner decision, DECISIONS.md). It changes only the visual layer. The choice goes in a plain cookie, per browser, with no user data in it,
 * so the server paints the right look from the first byte.
 */
export function DesignSettings({ initial = defaultDesign }: { initial?: Design }) {
  const { t } = useLanguage();
  const [design, setDesign] = useState<Design>(initial);
  // A cached page may carry an older answer than the page itself: <html> is the truth.
  useEffect(() => { const now = document.documentElement.dataset.design; if (isDesign(now)) setDesign(now); }, []);
  function choose(next: Design) {
    document.cookie = designCookie(next, window.location.protocol === 'https:');
    document.documentElement.dataset.design = next;
    setDesign(next);
  }
  return <section aria-labelledby="design-title" data-design-switch className="rounded-3xl border-2 border-black bg-card p-5 shadow-hard-sm sm:p-6">
    <h2 id="design-title" className="font-display text-2xl"><L id="ds.design.title" /></h2>
    <p className="mt-3 text-sm text-muted-foreground"><L id="ds.design.help" /></p>
    <div className="mt-5">
      <SegmentedControl label={t('ds.design.title')} value={design} onChange={choose} options={[
        { value: 'classic', label: <L id="ds.design.classic" />, 'data-design-option': 'classic' },
        { value: 'new', label: <L id="ds.design.new" />, 'data-design-option': 'new' },
      ]} />
    </div>
  </section>;
}
