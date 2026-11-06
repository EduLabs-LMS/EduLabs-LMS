'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HTMLAttributes, ReactNode } from 'react';
import { ActionMenu, type MenuAction } from './action-menu';
import { Button, buttonClass } from './button';
import { Icon } from './icon';
import { StickyActionBar } from './sticky-action-bar';
import { usePhone } from './use-phone';

type DataAttributes = { [name: `data-${string}`]: string | undefined };
export type HeaderAction = { key: string; label: ReactNode; href?: string; onClick?: () => void; destructive?: boolean; disabled?: boolean; data?: DataAttributes };

function Action({ action, variant, block }: { action: HeaderAction; variant: 'primary' | 'secondary' | 'destructive'; block?: boolean }) {
  const size = block ? 'lg' : 'md';
  return action.href
    ? <Link href={action.href} className={buttonClass(variant, { block, size })} {...action.data}>{action.label}</Link>
    : <Button variant={variant} block={block} size={size} disabled={action.disabled} onClick={action.onClick} {...action.data}>{action.label}</Button>;
}

/**
 * The top of a page: back link, title, one pill, one meta line, actions at the top trailing corner.
 * On a phone the primary action moves to a sticky bar at the bottom and the secondary and destructive ones into a ⋯ menu; `stickySecondary` keeps the secondary ones in the bar, beside the primary.
 * `menu` is always behind ⋯, at any width. One arrangement is rendered at a time, so a test id or a tour target exists once.
 */
export function PageHeader({ title, back, pill, meta, primary, secondary = [], menu = [], stickySecondary = false, ...rest }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { title: ReactNode; back?: { href: string; label: ReactNode }; pill?: ReactNode; meta?: ReactNode; primary?: HeaderAction; secondary?: readonly HeaderAction[]; menu?: readonly HeaderAction[]; stickySecondary?: boolean }) {
  const router = useRouter();
  const phone = usePhone();
  const asItem = (a: HeaderAction): MenuAction => ({ key: a.key, label: a.label, destructive: a.destructive, disabled: a.disabled, data: a.data, onSelect: () => { if (a.href) router.push(a.href); else a.onClick?.(); } });
  const behindDots = [...(phone && !stickySecondary ? secondary : []), ...menu].map(asItem);
  const inBar = phone && (primary || (stickySecondary && secondary.length > 0));
  return <header className="d-page-header" {...rest}>
    <div className="d-page-header-main">
      {back && <Link href={back.href} className="d-back d-focus"><Icon name="back" size={16} />{back.label}</Link>}
      <div className="d-page-header-title"><h1 className="d-title">{title}</h1>{pill}</div>
      {meta && <p className="d-meta">{meta}</p>}
    </div>
    {(!phone || behindDots.length > 0) && (primary || secondary.length > 0 || behindDots.length > 0) && <div className="d-page-header-actions">
      {!phone && secondary.map(a => <Action key={a.key} action={a} variant={a.destructive ? 'destructive' : 'secondary'} />)}
      {!phone && primary && <Action action={primary} variant="primary" />}
      {behindDots.length > 0 && <ActionMenu items={behindDots} />}
    </div>}
    {inBar && <StickyActionBar data-sticky-primary>
      {stickySecondary && secondary.map(a => <Action key={a.key} action={a} variant={a.destructive ? 'destructive' : 'secondary'} block />)}
      {primary && <Action action={primary} variant="primary" block />}
    </StickyActionBar>}
  </header>;
}
