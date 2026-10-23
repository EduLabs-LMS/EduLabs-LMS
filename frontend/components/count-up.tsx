'use client';
import { useEffect, useRef, useState } from 'react';

/** Counts a number up once when it first appears. Skips the effect for reduced motion and for large lists of numbers. */
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
	const [shown, setShown] = useState(value);
	const played = useRef(false);
	useEffect(() => {
		if (played.current || !Number.isFinite(value) || value <= 0) { setShown(value); return; }
		if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(value); played.current = true; return; }
		played.current = true;
		let frame = 0; const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
			setShown(Math.round(value * eased));
			if (t < 1) frame = requestAnimationFrame(tick);
		};
		setShown(0); frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [value, duration]);
	return <span className="tabular-nums">{shown}</span>;
}
