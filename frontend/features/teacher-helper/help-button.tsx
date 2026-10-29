'use client';
import { useLanguage } from '@/frontend/components/language-provider';

/**
 * The quiet outlined "?" every teacher page carries. The walkthrough it will start is not built yet (docs/ai/V1.md, Helper), so for now it
 * is present, reachable and honestly labelled as not available, and it does nothing when pressed. `data-tour="help"` is its tour target.
 */
export function HelpButton() {
  const { t } = useLanguage();
  return <button type="button" data-tour="help" aria-disabled="true" aria-label={t('helper.button')} title={t('helper.soon')}
    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-black bg-transparent text-lg font-bold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black">
    <span aria-hidden>?</span>
  </button>;
}
