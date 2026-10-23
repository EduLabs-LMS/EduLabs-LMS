'use client';
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils';

type Option = { value: string; label: React.ReactNode; text: string; disabled: boolean };

const textOf = (node: React.ReactNode): string => React.Children.toArray(node).map(n => (typeof n === 'string' || typeof n === 'number' ? String(n) : '')).join('');

/** Reads <option> children (also inside fragments and arrays) so the dropdown is a drop-in for a native <select>. */
export function collectOptions(children: React.ReactNode, out: Option[] = []): Option[] {
	React.Children.forEach(children, child => {
		if (!React.isValidElement(child)) return;
		const el = child as React.ReactElement<{ value?: string | number; disabled?: boolean; children?: React.ReactNode }>;
		if (el.type === React.Fragment) { collectOptions(el.props.children, out); return; }
		if (el.type === 'option') {
			const text = textOf(el.props.children);
			out.push({ value: el.props.value !== undefined ? String(el.props.value) : text, label: el.props.children, text, disabled: !!el.props.disabled });
		}
	});
	return out;
}
/** Index of the next enabled option in a direction, wrapping at the ends; -1 when nothing can be chosen. */
export function stepIndex(options: Pick<Option, 'disabled'>[], from: number, direction: 1 | -1): number {
	if (!options.some(o => !o.disabled)) return -1;
	let i = from;
	for (let n = 0; n < options.length; n++) { i = (i + direction + options.length) % options.length; if (!options[i].disabled) return i; }
	return -1;
}

export type DropdownChange = { target: { value: string }; currentTarget: { value: string } };
export interface DropdownProps {
	value?: string | number;
	defaultValue?: string | number;
	onChange?: (event: DropdownChange) => void;
	disabled?: boolean;
	required?: boolean;
	name?: string;
	id?: string;
	className?: string;
	'aria-label'?: string;
	children?: React.ReactNode;
}

/** Our own animated dropdown. Same props as the browser's <select>, so every screen looks and behaves the same. */
export function Dropdown({ value, defaultValue, onChange, disabled, required, name, id, className, children, 'aria-label': ariaLabel }: DropdownProps) {
	const options = collectOptions(children);
	const [inner, setInner] = React.useState(defaultValue !== undefined ? String(defaultValue) : '');
	const current = value !== undefined ? String(value) : inner;
	const [open, setOpen] = React.useState(false);
	const selectedIndex = options.findIndex(o => o.value === current);
	const shown = selectedIndex >= 0 ? options[selectedIndex] : options.find(o => o.value === '' && current === '') ?? (current === '' ? options[0] : undefined);
	const [active, setActive] = React.useState(0);
	const listId = React.useId();
	const list = React.useRef<HTMLUListElement>(null);
	const typed = React.useRef({ text: '', at: 0 });

	function choose(index: number) {
		const option = options[index];
		if (!option || option.disabled) return;
		if (value === undefined) setInner(option.value);
		onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } });
		setOpen(false);
	}
	function onListKey(e: React.KeyboardEvent) {
		if (e.key === 'ArrowDown') { e.preventDefault(); setActive(stepIndex(options, active, 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(stepIndex(options, active, -1)); }
		else if (e.key === 'Home') { e.preventDefault(); setActive(stepIndex(options, -1, 1)); }
		else if (e.key === 'End') { e.preventDefault(); setActive(stepIndex(options, options.length, -1)); }
		else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
		else if (e.key === 'Tab') setOpen(false);
		else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const now = Date.now();
			typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
			const hit = options.findIndex(o => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text));
			if (hit >= 0) setActive(hit);
		}
	}
	React.useEffect(() => {
		if (open) setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, stepIndex(options, -1, 1)));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);
	React.useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, listId]);

	return (
		<>
			<PopoverPrimitive.Root open={open} onOpenChange={next => { if (!disabled) setOpen(next); }}>
				<PopoverPrimitive.Trigger asChild>
					<button
						type="button" id={id} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel} disabled={disabled}
						className={cn('flex items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60', className)}
						onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
					>
						<span className="min-w-0 flex-1 truncate">{shown?.label ?? ''}</span>
						<ChevronDown aria-hidden className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
					</button>
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal>
					<PopoverPrimitive.Content
						align="start" sideOffset={6} collisionPadding={12}
						onOpenAutoFocus={e => { e.preventDefault(); list.current?.focus(); }}
						className="z-[90] max-h-72 w-[var(--radix-popover-trigger-width)] min-w-[10rem] overflow-y-auto rounded-2xl border-2 border-black bg-popover p-1.5 text-popover-foreground shadow-hard-sm outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
					>
						<ul ref={list} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel} aria-activedescendant={`${listId}-${active}`} onKeyDown={onListKey} className="outline-none">
							{options.map((o, i) => (
								<li
									key={`${o.value}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === selectedIndex} aria-disabled={o.disabled || undefined}
									onMouseEnter={() => !o.disabled && setActive(i)} onClick={() => choose(i)}
									className={cn('flex min-h-[40px] cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm', i === active && 'bg-primary/40', i === selectedIndex && 'font-bold', o.disabled && 'cursor-not-allowed opacity-50')}
								>
									<span className="min-w-0 flex-1 break-words">{o.label}</span>
									{i === selectedIndex && <Check aria-hidden className="h-4 w-4 shrink-0" />}
								</li>
							))}
						</ul>
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
			{name && <input type="hidden" name={name} value={current} />}
			{required && <input tabIndex={-1} aria-hidden required value={current} onChange={() => {}} className="sr-only" />}
		</>
	);
}
