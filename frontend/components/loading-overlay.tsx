'use client';

import { useLocale } from '@/frontend/design/preferences';
import { motion } from 'framer-motion';

interface LoadingOverlayProps {
	message?: string;
}

const LoadingOverlay = ({ message = 'Loading page...' }: LoadingOverlayProps) => {
	const {t} = useLocale();
	return (
		<motion.div
			aria-live="polite"
			aria-label={t(message)}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.2, ease: 'easeOut' }}
			className="edu-loading fixed inset-0 z-50 bg-white/75 backdrop-blur-sm flex flex-col items-center justify-center select-none"
			role="status"
		>
			<motion.div
				initial={{ scale: 0.95, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				exit={{ scale: 0.95, opacity: 0 }}
				transition={{ duration: 0.2 }}
				className="flex flex-col items-center"
			>
				<div className="border-4 border-slate-200 border-t-cyan-500 rounded-full w-10 h-10 animate-spin" />
				<p className="mt-4 text-sm font-semibold text-slate-800 tracking-wide">
					{message}
				</p>
			</motion.div>
		</motion.div>
	);
};

export default LoadingOverlay;
