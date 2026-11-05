'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HTMLAttributes, ReactNode } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { Button, buttonClass } from './button';
import { Icon } from './icon';
import { StickyActionBar } from './sticky-action-bar';

export type HeaderAction = { key: string; label: ReactNode; href?: string; onClick?: () => void; destructive?: boolean; disabled?: boolean };

function Action({ action, variant, block }: { action: HeaderAction; variant: 'primary' | 'secondary' | 'destructive'; block?: boolean }) {
  const size = block ? 'lg' : 'md';
  return action.href
    ? <Link href={action.href} className={buttonClass(variant, { block, size })}>{action.label}</Link>
    : <Button variant={variant} block={block} size={size} disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>;
}

/**
 * The top of a page: back link, title, one pill, one meta line, actions at the top trailing corner.
 * On a phone the primary action moves to a sticky bar at the bottom and the secondary and destructive ones into a ⋯ menu.
 */
export function PageHeader({ title, back, pill, meta, primary, secondary = [], ...rest }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { title: ReactNode; back?: { href: string; label: ReactNode }; pill?: ReactNode; meta?: ReactNode; primary?: HeaderAction; secondary?: readonly HeaderAction[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  return <header className="d-page-header" {...rest}>
    <div className="d-page-header-main">
      {back && <Link href={back.href} className="d-back d-focus"><Icon name="back" size={16} />{back.label}</Link>}
      <div className="d-page-header-title"><h1 className="d-title">{title}</h1>{pill}</div>
      {meta && <p className="d-meta">{meta}</p>}
    </div>
    {(primary || secondary.length > 0) && <div className="d-page-header-actions">
      <span className="hidden items-center gap-2 md:flex">
        {secondary.map(a => <Action key={a.key} action={a} variant={a.destructive ? 'destructive' : 'secondary'} />)}
        {primary && <Action action={primary} variant="primary" />}
      </span>
      {secondary.length > 0 && <span className="md:hidden">
        <Menu.Root>
          <Menu.Trigger asChild><Button variant="icon" aria-label={t('ds.more_actions')}><Icon name="more" size={20} /></Button></Menu.Trigger>
          <Menu.Portal><Menu.Content align="end" sideOffset={6} collisionPadding={12} className="d-menu">
            {secondary.map(a => <Menu.Item key={a.key} disabled={a.disabled} className={cn('d-menu-item', a.destructive && 'd-menu-item--danger')} onSelect={() => { if (a.href) router.push(a.href); else a.onClick?.(); }}>{a.label}</Menu.Item>)}
          </Menu.Content></Menu.Portal>
        </Menu.Root>
      </span>}
    </div>}
    {primary && <StickyActionBar data-sticky-primary><Action action={primary} variant="primary" block /></StickyActionBar>}
  </header>;
}
