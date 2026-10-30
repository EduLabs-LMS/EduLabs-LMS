'use client';

import Link from 'next/link';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';

/**
 * The EduLabs logo: mark, wordmark (brand font) and the "learning platform" line.
 * With `href` the whole logo is ONE link (teacher shell: the teacher Home); without it, it is plain markup (student shell).
 */
export function BrandLogo({ href, onNavigate, size = 'desktop' }: { href?: string; onNavigate?: () => void; size?: 'desktop' | 'phone' }) {
  const { t } = useLanguage();
  const phone = size === 'phone';
  const body = <>
    <EduLabsMark className={cn('shrink-0', phone ? 'h-9 w-9' : 'h-10 w-10')} />
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-display text-2xl font-normal leading-none text-black">EduLabs</span>
      <span className={cn('text-[10px] font-bold uppercase tracking-wider text-slate-600', phone ? 'mt-0.5' : 'mt-1')}><L id="navigation.learning_platform" /></span>
    </span>
  </>;
  const layout = cn('flex min-w-0 items-center', phone ? 'gap-2.5' : 'gap-3');
  if (!href) return <div className={layout}>{body}</div>;
  return <Link href={href} onClick={() => onNavigate?.()} aria-label={t('navigation.logo_home')} data-brand-logo className={cn(layout, 'min-h-[44px] rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black')}>{body}</Link>;
}
