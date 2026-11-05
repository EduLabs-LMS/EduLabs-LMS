import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils';

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** One shape for every status. It never looks like a button. */
export function StatusPill({ tone, dot = false, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone: Tone; dot?: boolean; children: ReactNode }) {
  return <span className={cn('d-pill', `d-pill--${tone}`, className)} {...rest}>{dot && <span aria-hidden className="d-pill-dot" />}{children}</span>;
}
