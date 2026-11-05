'use client';

import { useCallback, useEffect, useState } from 'react';

import { FirstLoadLogo } from '@/frontend/components/loading-overlay';
import { FIRST_OPEN_ATTRIBUTE, FIRST_OPEN_DONE_EVENT, FIRST_OPEN_FADE_MS, firstOpenActive } from '@/frontend/lib/first-load';

/**
 * The opening logo: on a fresh opening of the site, on any route (see frontend/lib/first-load.ts).
 *
 * It sits in the root layout outside the app tree, because that tree is keyed on the user and mounts again when a session is restored, which would start the animation
 * over. CSS shows it only when the head script found a new tab, so it needs no JavaScript of the app to cover the first paint or to go away (app/globals.css).
 * Decorative, so a screen reader goes straight to the page. A browser that does not open it fresh simply drops it from the page.
 */
const FirstOpenCurtain = () => {
	const [gone, setGone] = useState(false);

	useEffect(() => {
		if (!firstOpenActive()) setGone(true);
	}, []);

	const played = useCallback(() => {
		const root = document.documentElement;
		root.setAttribute(FIRST_OPEN_ATTRIBUTE, 'leaving');
		window.dispatchEvent(new Event(FIRST_OPEN_DONE_EVENT));
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.setTimeout(() => { root.removeAttribute(FIRST_OPEN_ATTRIBUTE); setGone(true); }, reduced ? 0 : FIRST_OPEN_FADE_MS);
	}, []);

	if (gone) return null;
	return (
		<div data-first-open-curtain aria-hidden="true" className="bg-background">
			<FirstLoadLogo onPlayed={played} />
		</div>
	);
};

export default FirstOpenCurtain;
