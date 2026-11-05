'use client';

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

import { AnimatePresence } from 'framer-motion';
import LoadingOverlay from '@/frontend/components/loading-overlay';
import {
	FIRST_LOAD_ARRIVAL_CAP_MS,
	FIRST_LOAD_EVENT,
	FIRST_LOAD_FINISH_MS,
	clearFirstLoad,
	firstLoadPending,
	firstLoadWaitsForAddress,
	markFirstLoad,
} from '@/frontend/lib/first-load';

const DEFAULT_MESSAGE = 'Loading page...';
/** A blocking action (a save or an upload) never flashes the overlay for a very quick one. */
const SHOW_DELAY_MS = 120;
/** How long the overlay stays after the action ends, so the word can complete. */
const FINISH_MS = 650;

type FirstLoad = { phase: 'idle' | 'running' | 'finishing'; from: string; played: boolean };

interface LoadingContextValue {
	/** True while a blocking action (startLoading) is in progress. */
	isLoading: boolean;
	message: string;
	/** Blocking overlay for an action in progress (an upload, a save). Page navigation never uses it. */
	startLoading: (customMessage?: string) => void;
	stopLoading: () => void;
	/**
	 * Called by sign-in code when the person has just signed in: the logo animation plays once, to its full end, and then the first page shows.
	 * Safe to call twice. In-app navigation afterwards keeps the app frame and shows a skeleton of the page instead.
	 */
	beginFirstLoad: () => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
	const pathname = usePathname();

	const [manual, setManual] = useState(false);
	const [message, setMessage] = useState(DEFAULT_MESSAGE);
	const [overlay, setOverlay] = useState({ visible: false, done: false });
	const [first, setFirst] = useState<FirstLoad>({ phase: 'idle', from: '', played: false });
	const pathRef = useRef(pathname);
	pathRef.current = pathname;

	const startLoading = useCallback((customMessage = 'Saving changes...') => {
		setMessage(customMessage);
		setManual(true);
	}, []);

	const stopLoading = useCallback(() => {
		setManual(false);
	}, []);

	const startFirst = useCallback(() => {
		setFirst((prev) => {
			if (prev.phase !== 'idle') return prev;
			return { phase: 'running', from: pathRef.current, played: false };
		});
	}, []);

	// markFirstLoad announces itself on window, so the provider that is mounted now starts the overlay even when the caller holds an older one
	// (signing in mounts the whole app tree again, see first-load.ts).
	const beginFirstLoad = useCallback(() => markFirstLoad(), []);
	useEffect(() => {
		window.addEventListener(FIRST_LOAD_EVENT, startFirst);
		return () => window.removeEventListener(FIRST_LOAD_EVENT, startFirst);
	}, [startFirst]);

	// A full page load in the middle of signing in (the Google redirect) still counts as the first load.
	useEffect(() => {
		if (firstLoadPending()) {
			setFirst((prev) => (prev.phase === 'idle' ? { phase: 'running', from: pathRef.current, played: false } : prev));
		}
	}, []);

	const firstPlayed = useCallback(() => setFirst((prev) => (prev.phase === 'running' ? { ...prev, played: true } : prev)), []);

	// Running: the animation always plays to its end. Then the page shows as soon as the first page's address is there, and a slow page never holds the logo past the cap.
	useEffect(() => {
		if (first.phase !== 'running' || !first.played) return;
		const arrived = pathname !== first.from || !firstLoadWaitsForAddress(first.from);
		const timer = window.setTimeout(() => setFirst((prev) => (prev.phase === 'running' ? { ...prev, phase: 'finishing' } : prev)), arrived ? 0 : FIRST_LOAD_ARRIVAL_CAP_MS);
		return () => window.clearTimeout(timer);
	}, [first, pathname]);

	useEffect(() => {
		if (first.phase !== 'finishing') return;
		clearFirstLoad();
		const timer = window.setTimeout(() => setFirst({ phase: 'idle', from: '', played: false }), FIRST_LOAD_FINISH_MS);
		return () => window.clearTimeout(timer);
	}, [first.phase]);

	// Blocking-action overlay lifecycle, one way only: hidden -> shown -> finishing -> hidden.
	useEffect(() => {
		if (manual) {
			if (overlay.visible) return;
			const show = window.setTimeout(() => setOverlay({ visible: true, done: false }), SHOW_DELAY_MS);
			return () => window.clearTimeout(show);
		}
		if (overlay.visible && !overlay.done) {
			const finish = window.setTimeout(() => setOverlay({ visible: true, done: true }), 60);
			return () => window.clearTimeout(finish);
		}
	}, [manual, overlay]);

	useEffect(() => {
		if (!overlay.done) return;
		const hide = window.setTimeout(() => setOverlay({ visible: false, done: false }), FINISH_MS);
		return () => window.clearTimeout(hide);
	}, [overlay.done]);

	const value = useMemo(
		() => ({ isLoading: manual, message, startLoading, stopLoading, beginFirstLoad }),
		[manual, message, startLoading, stopLoading, beginFirstLoad]
	);

	const showFirst = first.phase !== 'idle';
	// While the first load is finishing, its overlay stays and only fades: it must not change into the action overlay's look.
	const firstLoadOverlay = showFirst && !overlay.visible;
	const visible = overlay.visible || showFirst;

	return (
		<LoadingContext.Provider value={value}>
			{children}
			<AnimatePresence>
				{visible && (
					<LoadingOverlay
						key="global-loading-overlay"
						message={overlay.visible ? message : DEFAULT_MESSAGE}
						done={overlay.visible ? overlay.done : first.phase === 'finishing'}
						blocking={manual}
						firstLoad={firstLoadOverlay}
						onPlayed={firstPlayed}
					/>
				)}
			</AnimatePresence>
		</LoadingContext.Provider>
	);
};

export const useGlobalLoading = () => {
	const context = useContext(LoadingContext);

	if (!context) {
		throw new Error('useGlobalLoading must be used inside LoadingProvider.');
	}

	return context;
};
