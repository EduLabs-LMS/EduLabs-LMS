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
	FIRST_LOAD_CAP_MS,
	FIRST_LOAD_FINISH_MS,
	FIRST_LOAD_MIN_MS,
	clearFirstLoad,
	firstLoadPending,
	markFirstLoad,
} from '@/frontend/lib/first-load';

const DEFAULT_MESSAGE = 'Loading page...';
/** A blocking action (a save or an upload) never flashes the overlay for a very quick one. */
const SHOW_DELAY_MS = 120;
/** How long the overlay stays after the action ends, so the word can complete. */
const FINISH_MS = 650;

type FirstLoad = { phase: 'idle' | 'running' | 'finishing'; from: string };

interface LoadingContextValue {
	/** True while a blocking action (startLoading) is in progress. */
	isLoading: boolean;
	message: string;
	/** Blocking overlay for an action in progress (an upload, a save). Page navigation never uses it. */
	startLoading: (customMessage?: string) => void;
	stopLoading: () => void;
	/**
	 * Called by sign-in code when the person has just signed in: the logo overlay plays once, for under a second, over the first page.
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
	const [first, setFirst] = useState<FirstLoad>({ phase: 'idle', from: '' });
	const firstStartedAt = useRef(0);
	const pathRef = useRef(pathname);
	pathRef.current = pathname;

	const startLoading = useCallback((customMessage = 'Saving changes...') => {
		setMessage(customMessage);
		setManual(true);
	}, []);

	const stopLoading = useCallback(() => {
		setManual(false);
	}, []);

	const beginFirstLoad = useCallback(() => {
		markFirstLoad();
		setFirst((prev) => {
			if (prev.phase !== 'idle') return prev;
			firstStartedAt.current = performance.now();
			return { phase: 'running', from: pathRef.current };
		});
	}, []);

	// A full page load in the middle of signing in (the Google redirect) still counts as the first load.
	useEffect(() => {
		if (firstLoadPending()) {
			firstStartedAt.current = performance.now();
			setFirst((prev) => (prev.phase === 'idle' ? { phase: 'running', from: pathRef.current } : prev));
		}
	}, []);

	// Running: finish when the first page has taken over (the address changed) but not before the minimum, and never later than the cap.
	useEffect(() => {
		if (first.phase !== 'running') return;
		const elapsed = performance.now() - firstStartedAt.current;
		const arrived = pathname !== first.from;
		const wait = arrived ? Math.max(0, FIRST_LOAD_MIN_MS - elapsed) : Math.max(0, FIRST_LOAD_CAP_MS - elapsed);
		const timer = window.setTimeout(() => setFirst((prev) => (prev.phase === 'running' ? { ...prev, phase: 'finishing' } : prev)), wait);
		return () => window.clearTimeout(timer);
	}, [first, pathname]);

	useEffect(() => {
		if (first.phase !== 'finishing') return;
		clearFirstLoad();
		const timer = window.setTimeout(() => setFirst({ phase: 'idle', from: '' }), FIRST_LOAD_FINISH_MS);
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
