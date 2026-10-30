'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import { cn } from '@/shared/utils';

const WORD = 'EduLabs'.split('');
const RAMP_MS = 2800;
const FINISH_STAGGER_MS = 55;

interface LoadingOverlayProps {
	message?: string;
	/** True once the real work has finished: the word completes quickly, then the overlay fades. */
	done?: boolean;
	/** Block taps on the page underneath (forms and uploads). Page navigations leave the page tappable. */
	blocking?: boolean;
}

/**
 * The EduLabs word fills in while the real load is running. It follows a curve that slows
 * down (never "finished" on its own), so a 5 second load and a 30 second load both feel right.
 * The last letter always waits for the real finish, then everything completes in a quick burst.
 */
const useWordProgress = (done: boolean) => {
	const startedAt = useRef(0);
	const lastRevealed = useRef(0);
	const [revealed, setRevealed] = useState(0);

	useEffect(() => {
		startedAt.current = performance.now();
	}, []);

	useEffect(() => {
		if (done) {
			setRevealed(WORD.length);
			return;
		}
		const id = window.setInterval(() => {
			const elapsed = performance.now() - startedAt.current;
			const progress = 1 - Math.exp(-elapsed / RAMP_MS);
			const next = Math.min(WORD.length - 1, Math.floor(progress * (WORD.length - 0.1)));
			lastRevealed.current = next;
			setRevealed(next);
		}, 100);
		return () => window.clearInterval(id);
	}, [done]);

	return { revealed, revealedBeforeDone: lastRevealed.current };
};

const LoadingOverlay = ({
	message = 'Loading page...',
	done = false,
	blocking = false,
}: LoadingOverlayProps) => {
	const { revealed, revealedBeforeDone } = useWordProgress(done);
	const label = message.replace(/\.+$/, '') || 'Loading';

	return (
		<motion.div
			aria-live="polite"
			aria-label={message}
			role="status"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.25, ease: 'easeOut' }}
			className={cn(
				'fixed inset-0 z-[100] flex select-none flex-col items-center justify-center bg-background/45 backdrop-blur-xl',
				blocking ? 'pointer-events-auto' : 'pointer-events-none'
			)}
		>
			<div className="flex flex-col items-center px-4">
				<EduLabsMark grow shadow stagger={30} className="h-44 w-auto sm:h-56" />

				<div
					dir="ltr"
					aria-hidden="true"
					className="mt-7 flex font-display text-5xl leading-none text-black sm:text-6xl"
				>
					{WORD.map((letter, i) => {
						const on = i < revealed;
						const delay = done && i >= revealedBeforeDone ? (i - revealedBeforeDone) * FINISH_STAGGER_MS : 0;
						return (
							<span key={i} className="relative inline-block">
								<span className="opacity-[0.14]">{letter}</span>
								<span
									className={cn(
										'absolute inset-0 transition-all duration-500 ease-[cubic-bezier(.3,1.6,.5,1)] motion-reduce:transition-none',
										on
											? 'translate-y-0 rotate-0 scale-100 opacity-100'
											: 'translate-y-[45%] -rotate-[8deg] scale-[.4] opacity-0'
									)}
									style={{ transitionDelay: `${delay}ms` }}
								>
									{letter}
								</span>
							</span>
						);
					})}
				</div>

				<p className="mt-3 flex items-baseline text-base font-semibold tracking-wide text-slate-800">
					<span>{label}</span>
					<span aria-hidden="true" className="flex">
						<span className="loading-dot">.</span>
						<span className="loading-dot">.</span>
						<span className="loading-dot">.</span>
					</span>
				</p>
			</div>
		</motion.div>
	);
};

export default LoadingOverlay;
