'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { Button } from './button';
import { Icon } from './icon';

type DataAttributes = { [name: `data-${string}`]: string | undefined };
export type MenuAction = { key: string; label: ReactNode; onSelect: () => void; destructive?: boolean; disabled?: boolean; data?: DataAttributes };

/**
 * The ⋯ menu. The action runs on the next frame, after the menu has closed and given the focus back to its button: a dialog opened from here then remembers that button and returns to it.
 * `label` names what the menu is about ("More actions for Forces"), so a list of rows does not read as many identical buttons.
 */
export function ActionMenu({ items, label, triggerData }: { items: readonly MenuAction[]; label?: string; triggerData?: DataAttributes }) {
  const { t } = useLanguage();
  return <Menu.Root>
    <Menu.Trigger asChild><Button variant="icon" aria-label={label ?? t('ds.more_actions')} {...triggerData}><Icon name="more" size={20} /></Button></Menu.Trigger>
    <Menu.Portal><Menu.Content align="end" sideOffset={6} collisionPadding={12} className="d-menu">
      {items.map(item => <Menu.Item key={item.key} disabled={item.disabled} className={cn('d-menu-item', item.destructive && 'd-menu-item--danger')} onSelect={() => { requestAnimationFrame(item.onSelect); }} {...item.data}>{item.label}</Menu.Item>)}
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
