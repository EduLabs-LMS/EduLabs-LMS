'use client';

import { Toaster } from 'react-hot-toast';

export const ToastProvider = () => {
	return (
		<Toaster
			toastOptions={{
				style: {
					background: 'hsl(var(--popover))',
					color: 'hsl(var(--popover-foreground))',
					border: '2.5px solid hsl(var(--lms-outline, 0 0% 0%))',
					borderRadius: '999px',
					boxShadow: '3px 3px 0 #000',
					fontWeight: 600,
				},
				success: { iconTheme: { primary: '#7ed957', secondary: '#000' } },
			}}
		/>
	);
};
