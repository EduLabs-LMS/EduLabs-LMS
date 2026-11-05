'use client';

import Link from 'next/link';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';

/**
 * The EduLabs logo.
 * Without `href` it is the student shell's plain markup: mark, wordmark and the "learning platform" line.
 * With `href` it is the teacher frame's one link to Home: mark and wordmark. The same markup in both looks; the design tokens paint it (a lime square behind the tree in New).
 */
export function BrandLogo({ href, onNavigate, size = 'desktop' }: { href?: string; onNavigate?: () => void; size?: 'desktop' | 'phone' }) {
  const { t } = useLanguage();
  const phone = size === 'phone';
  if (href) return <Link href={href} onClick={() => onNavigate?.()} aria-label={t('navigation.logo_home')} data-brand-logo className={cn('d-logo', phone && 'd-logo--phone')}>
    <span className="d-logo-mark"><EduLabsMark /></span>
    <span className="d-logo-word">EduLabs</span>
  </Link>;
  return <div className={cn('flex min-w-0 items-center', phone ? 'gap-2.5' : 'gap-3')}>
    <EduLabsMark className={cn('shrink-0', phone ? 'h-9 w-9' : 'h-10 w-10')} />
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-display text-2xl font-normal leading-none text-black">EduLabs</span>
      <span className={cn('text-[10px] font-bold uppercase tracking-wider text-slate-600', phone ? 'mt-0.5' : 'mt-1')}><L id="navigation.learning_platform" /></span>
    </span>
  </div>;
}
