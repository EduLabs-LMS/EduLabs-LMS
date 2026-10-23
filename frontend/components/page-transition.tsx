'use client';
import { usePathname } from 'next/navigation';

/** Fades and lifts each page in when you navigate (CSS only; softer when reduced motion is on). */
export function PageTransition({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	return <div key={pathname} className="m-page">{children}</div>;
}
