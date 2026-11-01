'use client';

import { useEffect } from 'react';

import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

/**
 * Rendered by loading.tsx fallbacks. It draws nothing itself; it tells the global loading screen
 * that a page is still loading, so there is only ever ONE loading screen on top of the page.
 * Several can be mounted at once (the root fallback and a nested one): each holds its own claim.
 */
const RouteLoadingSignal = () => {
	const { acquireLoading } = useGlobalLoading();

	useEffect(() => acquireLoading(), [acquireLoading]);

	return null;
};

export default RouteLoadingSignal;
