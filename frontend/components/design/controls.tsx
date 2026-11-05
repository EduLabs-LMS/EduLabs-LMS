'use client';
import * as Popover from '@radix-ui/react-popover';
import { useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { Icon } from './icon';

type DataAttributes = { [name: `data-${string}`]: string | undefined };

/**
 * On or off. A real button with role="switch", so Space and Enter work by themselves and it stays in the tab order.
 * Disabled is aria-disabled and not the attribute: a control that turns busy keeps the keyboard's place, and a person can still reach it and hear why it is off.
 * `reason` shows the explanation under it; `reasonId` points at one already on the page, when several switches share it.
 */
export function Switch({ checked, onChange, label, disabled = false, reason, reasonId, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'disabled' | 'children'> & { checked: boolean; onChange: (next: boolean) => void; label?: ReactNode; disabled?: boolean; reason?: ReactNode; reasonId?: string }) {
  const auto = useId(), shown = disabled && reason ? `${auto}-reason` : undefined;
  const button = <button type="button" role="switch" aria-checked={checked} aria-disabled={disabled || undefined} aria-describedby={[shown, disabled ? reasonId : undefined].filter(Boolean).join(' ') || undefined} onClick={() => { if (!disabled) onChange(!checked); }} className={cn('d-switch', className)} {...rest}>
    <span aria-hidden="true" className="d-switch-track"><span className="d-switch-thumb" /></span>
    {label && <span className="d-switch-label">{label}</span>}
  </button>;
  if (!shown) return button;
  return <span className="d-control-block">{button}<span id={shown} className="d-control-reason">{reason}</span></span>;
}

/** Arrow keys move and choose inside a set of radios: the keyboard behaviour a radio group promises. Left and right swap in a right-to-left page. */
function useRadioKeys(count: number, enabled: boolean, choose: (index: number) => void) {
  return (event: KeyboardEvent<HTMLElement>, at: number) => {
    if (!enabled || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const rtl = group ? getComputedStyle(group).direction === 'rtl' : false;
    const forward = event.key === 'ArrowDown' || (event.key === 'ArrowRight') !== rtl && event.key !== 'ArrowUp';
    const next = (at + (forward ? 1 : count - 1)) % count;
    choose(next);
    (group?.querySelectorAll<HTMLElement>('[role="radio"]')[next])?.focus();
  };
}

export type ChoiceOption<T extends string> = { value: T; label: ReactNode; description?: ReactNode; icon?: ReactNode; name?: string; lang?: string; dir?: 'ltr' | 'rtl' } & DataAttributes;

/** Pick one of a few, each with room for a line of explanation. Buttons with role="radio": Space or Enter chooses, the arrow keys move and choose, one tab stop for the group. */
export function ChoiceGroup<T extends string>({ label, labelledBy, describedBy, options, value, onChange, disabled = false, reason, columns, className, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & { label?: string; labelledBy?: string; describedBy?: string; options: readonly ChoiceOption<T>[]; value: T | null; onChange: (value: T) => void; disabled?: boolean; reason?: ReactNode; columns?: 2 | 3 }) {
  const auto = useId(), active = Math.max(0, options.findIndex(o => o.value === value));
  const keys = useRadioKeys(options.length, !disabled, i => onChange(options[i].value));
  const reasonId = disabled && reason ? `${auto}-reason` : undefined;
  return <div className="d-control-block d-control-block--wide">
    <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} aria-describedby={[describedBy, reasonId].filter(Boolean).join(' ') || undefined} aria-disabled={disabled || undefined} data-columns={columns} className={cn('d-choices', className)} {...rest}>
      {options.map(({ value: option, label: text, description, icon, name, lang, dir, ...data }, i) => <button key={option} type="button" role="radio" aria-checked={option === value} aria-disabled={disabled || undefined} aria-label={name} aria-describedby={description ? `${auto}-${i}` : undefined} tabIndex={i === active ? 0 : -1} lang={lang} dir={dir} onClick={() => { if (!disabled) onChange(option); }} onKeyDown={e => keys(e, i)} className="d-choice" {...data}>
        <span aria-hidden="true" className="d-choice-mark" />
        <span className="d-choice-text">
          <span className="d-choice-label">{icon}{text}</span>
          {description && <span id={`${auto}-${i}`} className="d-choice-description">{description}</span>}
        </span>
      </button>)}
    </div>
    {reasonId && <span id={reasonId} className="d-control-reason">{reason}</span>}
  </div>;
}

/** Pick one of two or three short words, as one pill. The same keyboard as ChoiceGroup. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & { label: string; options: readonly ({ value: T; label: ReactNode } & DataAttributes)[]; value: T; onChange: (value: T) => void }) {
  const active = Math.max(0, options.findIndex(o => o.value === value));
  const keys = useRadioKeys(options.length, true, i => onChange(options[i].value));
  return <div role="radiogroup" aria-label={label} className="d-seg" {...rest}>{options.map(({ value: option, label: text, ...data }, i) => <button key={option} type="button" role="radio" aria-checked={option === value} tabIndex={i === active ? 0 : -1} onClick={() => onChange(option)} onKeyDown={e => keys(e, i)} className="d-seg-option" {...data}>{text}</button>)}</div>;
}

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

/**
 * Pick one of a list that can be long or come from data. The select-only combobox of the ARIA authoring practices: the button is the combobox and its text is the value,
 * the list keeps the focus and names the current row with aria-activedescendant. Up, Down, Home, End and typing move; Enter or Space chooses; Escape or Tab closes.
 * A wrapping <label> names it. `data-value` on the button holds the current value, for tests and for nothing else.
 */
export function Select({ value, onChange, options, placeholder, disabled = false, className, id, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'disabled' | 'children'> & { value: string; onChange: (value: string) => void; options: readonly SelectOption[]; placeholder?: ReactNode; disabled?: boolean }) {
  const auto = useId(), listId = `${auto}-list`, rowId = (i: number) => `${auto}-row-${i}`;
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const chosen = options.find(o => o.value === value);
  const selectable = (i: number) => Boolean(options[i]) && !options[i].disabled;
  const firstFrom = (start: number, step: 1 | -1) => { for (let i = start; i >= 0 && i < options.length; i += step) if (selectable(i)) return i; return -1; };
  const show = (i: number) => { setRow(i); list.current?.querySelector(`[id="${rowId(i)}"]`)?.scrollIntoView({ block: 'nearest' }); };
  const start = () => { const at = options.findIndex(o => o.value === value); setRow(at >= 0 && selectable(at) ? at : Math.max(0, firstFrom(0, 1))); };
  const pick = (i: number) => { if (!selectable(i)) return; onChange(options[i].value); setOpen(false); };
  function search(key: string) {
    const now = Date.now(), text = (now - typed.current.at > 700 ? '' : typed.current.text) + key.toLowerCase();
    typed.current = { text, at: now };
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const found = rows.findIndex((r, i) => selectable(i) && (r.textContent ?? '').trim().toLowerCase().startsWith(text));
    if (found >= 0) show(found);
  }
  function listKeys(event: KeyboardEvent<HTMLElement>) {
    const moves: Record<string, () => number> = { ArrowDown: () => firstFrom(row + 1, 1), ArrowUp: () => firstFrom(row - 1, -1), Home: () => firstFrom(0, 1), End: () => firstFrom(options.length - 1, -1) };
    if (moves[event.key]) { event.preventDefault(); const next = moves[event.key](); if (next >= 0) show(next); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(row); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) search(event.key);
  }
  return <Popover.Root open={open} onOpenChange={next => { if (disabled) return; if (next) start(); setOpen(next); }}>
    <Popover.Trigger asChild>
      <button type="button" id={id} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-disabled={disabled || undefined} data-value={value} onKeyDown={e => { if (!open && !disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); start(); setOpen(true); } }} className={cn('d-select', className)} {...rest}>
        <span className="d-select-value">{chosen ? chosen.label : placeholder}</span>
        <span aria-hidden="true" className="d-select-chevron"><Icon name="chevron" size={16} /></span>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content ref={list} id={listId} role="listbox" tabIndex={-1} align="start" sideOffset={4} collisionPadding={12} aria-activedescendant={rowId(row)} className="d-select-list" onOpenAutoFocus={e => { e.preventDefault(); list.current?.focus(); list.current?.querySelector(`[id="${rowId(row)}"]`)?.scrollIntoView({ block: 'nearest' }); }} onKeyDown={listKeys}>
        {options.map((option, i) => <div key={option.value} id={rowId(i)} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-value={option.value} data-current={i === row ? 'true' : undefined} onPointerEnter={() => { if (selectable(i)) setRow(i); }} onClick={() => pick(i)} className="d-select-option">{option.label}</div>)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
