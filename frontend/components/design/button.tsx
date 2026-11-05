import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'attention' | 'tertiary' | 'destructive' | 'icon';
type Options = { size?: 'md' | 'lg'; block?: boolean };

/** The look of a button, for a real <button> or a link that acts like one. One primary per view. */
export const buttonClass = (variant: ButtonVariant = 'secondary', { size = 'md', block = false }: Options = {}) =>
  cn('d-btn', `d-btn--${variant}`, size === 'lg' && 'd-btn--lg', block && 'd-btn--block');

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Options & { variant?: ButtonVariant }>(
  function Button({ variant = 'secondary', size, block, className, type = 'button', ...props }, ref) {
    return <button ref={ref} type={type} className={cn(buttonClass(variant, { size, block }), className)} {...props} />;
  },
);
