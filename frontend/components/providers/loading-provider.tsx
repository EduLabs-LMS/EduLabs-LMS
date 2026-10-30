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
import { usePathname, useSearchParams } from 'next/navigation';

import { AnimatePresence } from 'framer-motion';
import LoadingOverlay from '@/frontend/components/loading-overlay';

const DEFAULT_MESSAGE = 'Loading page...';
/** Very quick navigations never flash the overlay. */
const SHOW_DELAY_MS = 120;
/** How long the overlay stays after the work ends, so the word can complete. */
const FINISH_MS = 650;
/** Only a safety net: never leave the overlay up forever if a navigation is cancelled. */
const NAV_SAFETY_MS = 20000;

type Sources = { manual: boolean; nav: boolean; route: boolean };

interface LoadingContextValue {
	isLoading: boolean;
	message: string;
	startLoading: (customMessage?: string) => void;
	stopLoading: () => void;
	/** Used by app/loading.tsx so the page-level fallback uses this same overlay. */
	setRouteLoading: (active: boolean) => void;
	/** For router.push / router.replace, which the link-click listener cannot see. Use useLoadingRouter. */
	startNavigation: (href: string) => void;
}

const LoadingContext = createContext<LoadingContextValue | null>(null);

export const LoadingProvider = ({ children }: { children: ReactNode }) => {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const [active, setActive] = useState<Sources>({ manual: false, nav: false, route: false });
	const [message, setMessage] = useState(DEFAULT_MESSAGE);
	const [overlay, setOverlay] = useState({ visible: false, done: false });

	const navTarget = useRef<string | null>(null);
	const showTimer = useRef<number | null>(null);
	const hideTimer = useRef<number | null>(null);
	const visibleRef = useRef(false);

	const isLoading = active.manual || active.nav || active.route;

	useEffect(() => {
		visibleRef.current = overlay.visible;
	}, [overlay.visible]);

	const startLoading = useCallback((customMessage = 'Saving changes...') => {
		setMessage(customMessage);
		setActive((prev) => ({ ...prev, manual: true }));
	}, []);

	const stopLoading = useCallback(() => {
		setActive((prev) => ({ ...prev, manual: false }));
	}, []);

	const setRouteLoading = useCallback((isActive: boolean) => {
		if (isActive) setMessage(DEFAULT_MESSAGE);
		setActive((prev) => ({ ...prev, route: isActive }));
	}, []);

	const startNavigation = useCallback((href: string) => {
		let target: URL;
		try {
			target = new URL(href, window.location.href);
		} catch {
			return;
		}
		if (target.origin !== window.location.origin) return;
		const targetKey = target.pathname + target.search;
		if (targetKey === window.location.pathname + window.location.search) return;
		navTarget.current = targetKey;
		setMessage(DEFAULT_MESSAGE);
		setActive((prev) => ({ ...prev, nav: true }));
	}, []);

	// The navigation finished: the URL changed.
	useEffect(() => {
		setActive((prev) => (prev.nav ? { ...prev, nav: false } : prev));
	}, [pathname, searchParams]);

	// Detect link navigations.
	// We wait until Next.js has finished handling the click (it calls preventDefault() when it takes over
	// a navigation) before showing anything, so the overlay can never get in the way of the click itself.
	// A link whose own handler cancels the click and never navigates carries data-loading-ignore.
	useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			const anchor = (event.target as Element | null)?.closest?.('a');
			if (!anchor) return;

			const href = anchor.getAttribute('href');
			if (
				!href ||
				anchor.hasAttribute('data-loading-ignore') ||
				href.startsWith('#') ||
				/^(mailto:|tel:|javascript:)/i.test(href) ||
				(anchor.target && anchor.target !== '_self') ||
				anchor.hasAttribute('download') ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}

			let target: URL;
			try {
				target = new URL(href, window.location.href);
			} catch {
				return;
			}
			if (target.origin !== window.location.origin) return;

			const targetKey = target.pathname + target.search;

			window.setTimeout(() => {
				if (!event.defaultPrevented) return;
				const currentKey = window.location.pathname + window.location.search;
				if (currentKey === targetKey) return;

				navTarget.current = targetKey;
				setMessage(DEFAULT_MESSAGE);
				setActive((prev) => ({ ...prev, nav: true }));
			}, 0);
		};

		document.addEventListener('click', handleClick, true);
		return () => document.removeEventListener('click', handleClick, true);
	}, []);

	// While a navigation is pending: notice the URL change even if a re-render was missed, and keep a safety net.
	useEffect(() => {
		if (!active.nav) return;

		const poll = window.setInterval(() => {
			const key = window.location.pathname + window.location.search;
			if (navTarget.current && key === navTarget.current) {
				setActive((prev) => ({ ...prev, nav: false }));
			}
		}, 150);
		const safety = window.setTimeout(() => {
			setActive((prev) => ({ ...prev, nav: false }));
		}, NAV_SAFETY_MS);

		return () => {
			window.clearInterval(poll);
			window.clearTimeout(safety);
		};
	}, [active.nav]);

	// Overlay lifecycle: short delay before showing, then a quick "finish" before hiding.
	useEffect(() => {
		if (isLoading) {
			if (hideTimer.current !== null) {
				window.clearTimeout(hideTimer.current);
				hideTimer.current = null;
			}
			if (visibleRef.current) {
				setOverlay({ visible: true, done: false });
			} else if (showTimer.current === null) {
				showTimer.current = window.setTimeout(() => {
					showTimer.current = null;
					setOverlay({ visible: true, done: false });
				}, SHOW_DELAY_MS);
			}
			return;
		}

		if (showTimer.current !== null) {
			window.clearTimeout(showTimer.current);
			showTimer.current = null;
		}
		if (visibleRef.current && hideTimer.current === null) {
			setOverlay({ visible: true, done: true });
			hideTimer.current = window.setTimeout(() => {
				hideTimer.current = null;
				setOverlay({ visible: false, done: false });
			}, FINISH_MS);
		}
	}, [isLoading]);

	useEffect(
		() => () => {
			if (showTimer.current !== null) window.clearTimeout(showTimer.current);
			if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
		},
		[]
	);

	const value = useMemo(
		() => ({ isLoading, message, startLoading, stopLoading, setRouteLoading, startNavigation }),
		[isLoading, message, startLoading, stopLoading, setRouteLoading, startNavigation]
	);

	return (
		<LoadingContext.Provider value={value}>
			{children}
			<AnimatePresence>
				{overlay.visible && (
					<LoadingOverlay
						key="global-loading-overlay"
						message={message}
						done={overlay.done}
						blocking={active.manual}
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
