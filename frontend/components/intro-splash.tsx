'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';

import EduLabsMark from '@/frontend/components/edulabs-mark';
import { cn } from '@/shared/utils';

/** Total time the splash plays before it lifts (measured from when the page started loading). */
const SPLASH_MIN_MS = 3100;
const LEAVE_MS = 1400;

type Phase = 'show' | 'leave' | 'gone';

/**
 * The EduLabs opening animation: the logo grows (middle first, then both branches),
 * the name pops in letter by letter, the tagline fades up, then a green curtain and the
 * page-coloured curtain lift away. It plays when the site is first opened. Tap to skip.
 */
const IntroSplash = () => {
	const pathname = usePathname();
	// The opening curtain is a first-landing experience, not an auth/navigation overlay.
	// Keeping the initial path stable prevents replay on client navigation.
	const initialPath = useRef(pathname);
	const playIntro = initialPath.current === '/' && pathname === '/';
	const [phase, setPhase] = useState<Phase>('show');
	const leaveRef = useRef<() => void>(() => {});

	useEffect(() => {
		if (!playIntro) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			setPhase('gone');
			return;
		}

		const root = document.documentElement;
		root.style.overflow = 'hidden';

		let leaveTimer: number | undefined;
		let goneTimer: number | undefined;
		let left = false;

		const leave = () => {
			if (left) return;
			left = true;
			root.style.overflow = '';
			setPhase('leave');
			goneTimer = window.setTimeout(() => setPhase('gone'), LEAVE_MS);
		};

		leaveRef.current = leave;
		leaveTimer = window.setTimeout(leave, SPLASH_MIN_MS);

		return () => {
			window.clearTimeout(leaveTimer);
			window.clearTimeout(goneTimer);
			root.style.overflow = '';
		};
	}, [playIntro]);

	if (!playIntro || phase === 'gone') return null;
	const leaving = phase === 'leave';

	return (
		<>
			<div
				aria-hidden="true"
				className={cn(
					'pointer-events-none fixed inset-0 z-[120] bg-primary transition-transform delay-[120ms] duration-[850ms] ease-[cubic-bezier(.75,0,.2,1)]',
					leaving && '-translate-y-[101%]'
				)}
			/>
			<div
				role="status"
				aria-label="Loading EduLabs"
				onClick={() => leaveRef.current()}
				className={cn(
					'fixed inset-0 z-[121] flex cursor-pointer select-none flex-col items-center justify-center bg-background transition-transform duration-[850ms] ease-[cubic-bezier(.75,0,.2,1)]',
					leaving && 'pointer-events-none -translate-y-[101%]'
				)}
			>
				<div
					className={cn(
						'flex flex-col items-center px-4 transition-all duration-[450ms]',
						leaving && '-translate-y-7 scale-95 opacity-0'
					)}
				>
					<EduLabsMark grow shadow stagger={55} className="h-48 w-auto sm:h-60" />

					<div
						dir="ltr"
						aria-hidden="true"
						className="mt-8 flex font-display text-6xl leading-none text-black sm:text-7xl"
					>
						{'EduLabs'.split('').map((letter, i) => (
							<span key={i} className="splash-letter" style={{ '--i': i } as CSSProperties}>
								{letter}
							</span>
						))}
					</div>

					<p className="splash-tag mt-4 text-center font-display text-lg text-sky-700">
						Empowering Modern Education.
					</p>
				</div>
			</div>
		</>
	);
};

export default IntroSplash;
