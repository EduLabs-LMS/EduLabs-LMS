'use client';
import Link from 'next/link';
import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { useSlidingIndicator } from './use-sliding-indicator';

type DataAttributes = { [name: `data-${string}`]: string | undefined };
export type TabItem = { key: string; label: ReactNode; href?: string } & DataAttributes;

/** Underline tabs. With `href` each tab is a link to its own page (aria-current); without, they are buttons and `onSelect` shows the panel (role tab). */
export function Tabs({ items, active, label, onSelect, ...rest }: Omit<HTMLAttributes<HTMLElement>, 'onSelect'> & { items: readonly TabItem[]; active: string; label: string; onSelect?: (key: string) => void }) {
  const slide = useSlidingIndicator<HTMLElement>('.d-tab[aria-current="page"], .d-tab[aria-selected="true"]', active, { line: true });
  const line = <span ref={slide.slider} aria-hidden="true" className="d-slider d-slider--line" />;
  if (items.every(i => i.href)) return <nav ref={slide.container} aria-label={label} className="d-tabs" {...rest}>{items.map(({ key, label: text, href, ...data }) => <Link key={key} href={href as string} aria-current={key === active ? 'page' : undefined} className="d-tab" {...data}>{text}</Link>)}{line}</nav>;
  return <div ref={slide.container as React.RefObject<HTMLDivElement>} role="tablist" aria-label={label} className="d-tabs" {...rest}>{items.map(({ key, label: text, href: _href, ...data }) => <button key={key} type="button" role="tab" aria-selected={key === active} tabIndex={key === active ? 0 : -1} onClick={() => onSelect?.(key)} onKeyDown={e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl', forward = (e.key === 'ArrowRight') !== rtl, at = items.findIndex(i => i.key === key);
    const next = (at + (forward ? 1 : items.length - 1)) % items.length;
    onSelect?.(items[next].key); (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }} className="d-tab" {...data}>{text}</button>)}{line}</div>;
}

/** Pick one of a few. Real radio buttons underneath: arrow keys, focus and screen readers work without any extra code. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, name, ...rest }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & { label: string; options: readonly ({ value: T; label: ReactNode } & DataAttributes)[]; value: T; onChange: (value: T) => void; name?: string }) {
  const auto = useId();
  return <div role="radiogroup" aria-label={label} className="d-seg" {...rest}>{options.map(({ value: option, label: text, ...data }) => <label key={option} className="d-seg-option" {...data}>
    <input type="radio" name={name ?? auto} value={option} checked={option === value} onChange={() => onChange(option)} />{text}
  </label>)}</div>;
}
