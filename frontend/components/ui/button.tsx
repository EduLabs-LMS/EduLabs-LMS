import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/utils';

const buttonVariants = cva(
	'inline-flex items-center justify-center rounded-full border-2 border-black text-sm font-semibold shadow-hard-sm ring-offset-background transition-all duration-150 hover:-translate-x-px hover:-translate-y-px hover:shadow-hard active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_#000] cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground',
				destructive:
					'bg-destructive text-destructive-foreground hover:bg-destructive/90',
				outline:
					'bg-card hover:bg-accent hover:text-accent-foreground',
				secondary:
					'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				ghost:
					'border-transparent shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none hover:bg-accent hover:text-accent-foreground active:shadow-none',
				link: 'border-transparent shadow-none text-[hsl(var(--link))] underline-offset-4 hover:translate-x-0 hover:translate-y-0 hover:shadow-none hover:underline active:shadow-none',
				success: 'bg-physics-cyan text-black hover:bg-physics-cyan-bright',
			},
			size: {
				default: 'h-10 px-5 py-2',
				sm: 'h-9 px-4',
				lg: 'h-11 px-8',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	}
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';

		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	}
);
Button.displayName = 'Button';

export { Button, buttonVariants };
