'use client';

import { useEffect, useRef } from 'react';

import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

/** Longest a page's first read may keep the overlay up; after that the page shows its own loading or error state. */
export const PAGE_LOADING_CAP_MS = 10000;

/**
 * Keeps the global loading screen up while a page's first-view read is pending, so the page is filled in when the
 * screen lifts. Pass `pending` true until the read has succeeded or failed (a failure shows the page's own error).
 * Only the first load counts: a later reload or retry of the same component never brings the screen back.
 */
export const usePageLoadingSignal = (pending: boolean, capMs = PAGE_LOADING_CAP_MS) => {
	const { acquireLoading } = useGlobalLoading();
	const started = useRef(false);
	const finished = useRef(false);

	useEffect(() => {
		if (pending && !finished.current) {
			started.current = true;
			return acquireLoading(capMs);
		}
		if (!pending && started.current) finished.current = true;
	}, [pending, acquireLoading, capMs]);
};
