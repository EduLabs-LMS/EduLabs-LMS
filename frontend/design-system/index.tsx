import { Children, cloneElement, isValidElement, type ButtonHTMLAttributes, type KeyboardEvent, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import EduLabsMark from '@/frontend/components/edulabs-mark';

/** Reusable, token-driven building blocks (styles: components.css, tokens: tokens.css).
 *  Import `./tokens.css` and `./components.css` once in the layout that renders `.eds-root`. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm' | 'icon';
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
 return <button type="button" {...props} className={join('eds-btn', className)} data-variant={variant} data-size={size} />;
}
export function ButtonLink({ href, variant = 'secondary', size = 'md', className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
 return <Link href={href} className={join('eds-btn', className)} data-variant={variant} data-size={size}>{children}</Link>;
}
export const LinkButton = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} className={join('eds-link-btn', className)} />;

/** Wires label, hint and error to the single control it wraps (ids, aria-describedby, aria-invalid). */
export function Field({ id, label, optional, hint, error, children }: { id: string; label: ReactNode; optional?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactElement }) {
 const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
 const control = Children.only(children);
 return <div className="eds-field">
  <label className="eds-label" htmlFor={id}>{label}{optional ? <> <small>{optional}</small></> : null}</label>
  {isValidElement(control) ? cloneElement(control as ReactElement<Record<string, unknown>>, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }) : control}
  {hint ? <p className="eds-hint" id={`${id}-hint`}>{hint}</p> : null}
  {error ? <p className="eds-error" role="alert" id={`${id}-error`}>{error}</p> : null}
 </div>;
}
export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={join('eds-input', className)} />;
export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={join('eds-input', className)} />;

export function Card({ emphasis, labelledBy, children, ...rest }: { emphasis?: boolean; labelledBy?: string; children: ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
 return <section {...rest} className="eds-card" data-emphasis={emphasis ? 'true' : undefined} aria-labelledby={labelledBy}>{children}</section>;
}
export function CardHead({ id, step, title, aside }: { id?: string; step?: number; title: ReactNode; aside?: ReactNode }) {
 return <div className="eds-card-head"><h2 id={id}>{step ? <span className="eds-step" aria-hidden="true">{step}</span> : null}{title}</h2>{aside ? <small>{aside}</small> : null}</div>;
}
export const CardBody = ({ divided, children }: { divided?: boolean; children: ReactNode }) => <div className={join('eds-card-body', divided && 'eds-divided')}>{children}</div>;

export function PageHeader({ title, intro, actions }: { title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
 return <div className="eds-page-head"><div><h1>{title}</h1>{intro ? <p>{intro}</p> : null}</div>{actions ? <div className="eds-actions">{actions}</div> : null}</div>;
}
export const Banner = ({ tone = 'info', role, children }: { tone?: 'info' | 'ok' | 'warn' | 'error'; role?: 'alert' | 'status' | 'note' | 'group'; children: ReactNode }) =>
 <div className="eds-banner" data-tone={tone} role={role}>{children}</div>;
export const Badge = ({ tone = 'neutral', children, ...rest }: { tone?: 'neutral' | 'pending' | 'ok' | 'off'; children: ReactNode } & Record<`data-${string}`, string | undefined>) => <span {...rest} className="eds-badge" data-tone={tone}>{children}</span>;
export const ChipList = ({ label, children }: { label: string; children: ReactNode }) => <ul className="eds-chip-list" aria-label={label}>{children}</ul>;
export const Chip = ({ children, onRemove, removeLabel, error }: { children: ReactNode; onRemove?: () => void; removeLabel?: string; error?: ReactNode }) =>
 <li className="eds-chip" data-removable={onRemove ? 'true' : undefined}>{children}
  {onRemove ? <button type="button" className="eds-chip-remove" aria-label={removeLabel} onClick={onRemove}><span aria-hidden="true">×</span></button> : null}{error}</li>;

/** Controlled so the owner of the state can force it open (e.g. when a hidden field has an error). */
export function Disclosure({ id, open, onToggle, label, children }: { id: string; open: boolean; onToggle: () => void; label: ReactNode; children: ReactNode }) {
 return <div className="eds-disclosure">
  <button type="button" className="eds-link-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}><ChevronRight size={16} aria-hidden="true" />{label}</button>
  <div className="eds-disclosure-body" id={id} hidden={!open}>{children}</div>
 </div>;
}
export const DefinitionList = ({ items }: { items: { term: ReactNode; detail: ReactNode; key: string }[] }) =>
 <dl className="eds-dl">{items.map((item) => <div key={item.key}><dt>{item.term}</dt><dd>{item.detail}</dd></div>)}</dl>;

/** The real EduLabs tree mark with the display-face wordmark (same pairing as components/logo.tsx). */
export const Brand = ({ className }: { className?: string }) => <span className={join('eds-brand', className)}><EduLabsMark className="eds-brand-mark" shadow={false} /><span className="eds-display eds-wordmark">EduLabs</span></span>;

/** The one place a screen picks its width and alignment. focused: centered workflows (wizards, confirmations);
 *  regular: settings and ordinary forms; wide: management tables and detail pages; fluid: dashboards that fill the area. */
export type PageLayout = 'focused' | 'regular' | 'wide' | 'fluid';
export const Page = ({ layout = 'regular', children }: { layout?: PageLayout; children: ReactNode }) => <div className="eds-page" data-layout={layout}>{children}</div>;

/** A single-choice control. Behaves as a radio group: one tab stop, arrow keys move and select, RTL-aware. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: ReactNode; lang?: string }[]; onChange: (value: T) => void }) {
 const index = Math.max(0, options.findIndex((o) => o.value === value));
 const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const next = (from + step + options.length) % options.length;
  onChange(options[next].value);
  (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
 };
 return <div className="eds-segmented" role="radiogroup" aria-label={label}>
  {options.map((option, i) => <button key={option.value} type="button" role="radio" lang={option.lang} aria-checked={option.value === value} tabIndex={i === index ? 0 : -1}
   onClick={() => onChange(option.value)} onKeyDown={(event) => move(event, i)}>{option.label}</button>)}
 </div>;
}

export type StepperItem = { id: string; label: string };
/** One connected line, one circular point per step. Points hold no text; state is shape + color + accessible text.
 *  Pass `current = null` when no step is being edited (e.g. a final review). Upcoming steps use aria-disabled, not
 *  `disabled`, so keyboard and screen-reader users can still reach them and be told why they cannot open yet. */
export function Stepper({ label, steps, current, completed, canVisit, onSelect, stateLabels }: {
 label: string; steps: StepperItem[]; current: number | null; completed: boolean[]; canVisit: (index: number) => boolean; onSelect: (index: number) => void;
 stateLabels: { completed: string; current: string; upcoming: string };
}) {
 return <nav className="eds-stepper" aria-label={label}>
  <ol>
   {steps.map((step, index) => {
    const state = index === current ? 'current' : completed[index] ? 'completed' : 'upcoming';
    const allowed = canVisit(index);
    return <li key={step.id} data-state={state} data-linked={index > 0 && (completed[index - 1] || current === index) ? 'true' : undefined}>
     <button type="button" className="eds-stepper-step" aria-current={state === 'current' ? 'step' : undefined} aria-disabled={allowed ? undefined : true} onClick={() => onSelect(index)}>
      <span className="eds-stepper-point" aria-hidden="true" />
      <span className="eds-stepper-label">{step.label}<span className="eds-sr">, {stateLabels[state]}</span></span>
     </button>
    </li>;
   })}
  </ol>
 </nav>;
}
/** Wraps the active step's content. Re-key it per step so the subtle entrance replays; direction follows reading order. */
export const StepPanel = ({ direction, children }: { direction: 'forward' | 'back'; children: ReactNode }) => <div className="eds-step-panel" data-direction={direction}>{children}</div>;
