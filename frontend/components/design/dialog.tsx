'use client';
import * as Radix from '@radix-ui/react-dialog';
import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from './button';
import { Icon } from './icon';

/** A centred dialog on a desktop and a bottom sheet on a phone: one component, chosen by width. Focus trap, Escape and the overlay click come from Radix. */
export function Dialog({ open, onOpenChange, onClosed, title, description, children, footer, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { open: boolean; onOpenChange: (open: boolean) => void; /** After it has closed and handed the focus back. */ onClosed?: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage();
  // Radix hands focus back only to its own Trigger; these dialogs are opened by plain state, so the opener is remembered here. Without this, closing drops the keyboard user at the top of the page.
  const opener = useRef<HTMLElement | null>(null);
  return <Radix.Root open={open} onOpenChange={onOpenChange}>
    <Radix.Portal>
      <Radix.Overlay className="d-dialog-overlay" />
      <Radix.Content className="d-dialog" onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null; }} onCloseAutoFocus={e => { e.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); onClosed?.(); }} {...(description ? {} : { 'aria-describedby': undefined })} {...rest}>
        <div className="d-dialog-head">
          <Radix.Title className="d-section">{title}</Radix.Title>
          <Radix.Close asChild><Button variant="tertiary" aria-label={t('ds.close')}><Icon name="close" /></Button></Radix.Close>
        </div>
        {description && <Radix.Description className="d-body">{description}</Radix.Description>}
        {children}
        {footer && <div className="d-dialog-footer">{footer}</div>}
      </Radix.Content>
    </Radix.Portal>
  </Radix.Root>;
}
