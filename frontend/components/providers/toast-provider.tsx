'use client';

import { useLanguage } from '@/frontend/components/language-provider';
import { Toaster, ToastBar } from 'react-hot-toast';

export const ToastProvider = () => {
	const { ui }=useLanguage();
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
		>{toast=><ToastBar toast={{...toast,message:typeof toast.message==='string'?ui(toast.message):toast.message}}/>}</Toaster>
	);
};
