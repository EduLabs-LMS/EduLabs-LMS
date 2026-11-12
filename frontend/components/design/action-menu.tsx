'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Fragment, useId, useRef, type ReactNode } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { cn } from '@/shared/utils';
import { Button } from './button';
import { Icon } from './icon';

type DataAttributes = { [name: `data-${string}`]: string | undefined };
/**
 * `unavailable` is off (aria-disabled): unlike `disabled` the keyboard still reaches it, so a screen reader hears why. A short `reason` shows as
 * small muted text inside the same item ("Move up (already first)"); a longer `note` shows under it.
 */
export type MenuAction = { key: string; label: ReactNode; onSelect: () => void; destructive?: boolean; disabled?: boolean; unavailable?: boolean; reason?: ReactNode; note?: ReactNode; data?: DataAttributes };

/**
 * The ⋯ menu. The action runs once the menu has closed and given the focus back to its button: a dialog opened from here then remembers that button and returns to it.
 * `label` names what the menu is about ("More actions for Forces"), so a list of rows does not read as many identical buttons.
 */
export function ActionMenu({ items, label, triggerData }: { items: readonly MenuAction[]; label?: string; triggerData?: DataAttributes }) {
  const { t, direction } = useLanguage();
  const chosen = useRef<(() => void) | null>(null);
  const auto = useId();
  return <Menu.Root dir={direction === 'rtl' ? 'rtl' : 'ltr'}>
    <Menu.Trigger asChild><Button variant="icon" aria-label={label ?? t('ds.more_actions')} {...triggerData}><Icon name="more" size={20} /></Button></Menu.Trigger>
    <Menu.Portal><Menu.Content align="end" sideOffset={6} collisionPadding={12} className="d-menu" onCloseAutoFocus={() => { const action = chosen.current; chosen.current = null; if (action) requestAnimationFrame(action); }}>
      {items.map(item => <Fragment key={item.key}>
        <Menu.Item disabled={item.disabled} aria-disabled={item.unavailable || undefined} aria-describedby={item.note ? `${auto}-${item.key}` : undefined} className={cn('d-menu-item', item.destructive && 'd-menu-item--danger')} onSelect={event => { if (item.unavailable) event.preventDefault(); else chosen.current = item.onSelect; }} {...item.data}>{item.label}{item.reason && <>{' '}<span data-menu-note={item.key} className="d-menu-reason">({item.reason})</span></>}</Menu.Item>
        {item.note && <div id={`${auto}-${item.key}`} data-menu-note={item.key} className="d-menu-meta">{item.note}</div>}
      </Fragment>)}
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
