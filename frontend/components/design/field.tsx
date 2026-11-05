'use client';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { Icon } from './icon';

/** A labelled text input. The label, hint and error are tied to the input for screen readers. */
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }>(
  function Field({ label, hint, error, id, className, ...props }, ref) {
    const auto = useId(), inputId = id ?? auto, hintId = `${inputId}-hint`, errorId = `${inputId}-error`;
    return <div className="d-field">
      <label htmlFor={inputId} className="d-field-label">{label}</label>
      <input ref={ref} id={inputId} aria-invalid={error ? true : undefined} aria-describedby={[hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined} className={cn('d-field-input', className)} {...props} />
      {hint && <p id={hintId} className="d-field-hint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="d-field-error">{error}</p>}
    </div>;
  },
);

/** A search box. `label` is its accessible name; the magnifier is decoration. */
export const SearchField = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }>(
  function SearchField({ label, className, ...props }, ref) {
    return <span className="d-search"><Icon name="search" size={16} /><input ref={ref} type="search" aria-label={label} className={cn('d-field-input', className)} {...props} /></span>;
  },
);
