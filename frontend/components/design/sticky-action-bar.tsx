import type { HTMLAttributes, ReactNode } from 'react';

/** The phone's one main action, always in reach, above the bottom tabs. Hidden on a desktop, where the action sits in the page header. The spacer keeps the end of the page from sliding under it. */
export function StickyActionBar({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <><div aria-hidden className="d-sticky-spacer" /><div className="d-sticky-bar" {...rest}>{children}</div></>;
}
