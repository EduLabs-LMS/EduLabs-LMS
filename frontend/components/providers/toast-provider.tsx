'use client';

import { Toaster } from 'react-hot-toast';

export const ToastProvider = () => {
	return <Toaster toastOptions={{ style: { background: 'var(--edu-surface)', color: 'var(--edu-text)', border: '2.5px solid var(--edu-ink)', borderRadius: 16, boxShadow: '4px 4px 0 var(--edu-ink)', fontFamily: 'var(--edu-body)' } }} />;
};
