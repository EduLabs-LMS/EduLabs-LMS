'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

/** Same as useRouter for push and replace, but the global loading screen also plays for them. */
export const useLoadingRouter = () => {
	const router = useRouter();
	const { startNavigation } = useGlobalLoading();

	return useMemo(
		() => ({
			...router,
			push: (href: string, options?: Parameters<typeof router.push>[1]) => {
				startNavigation(href);
				router.push(href, options);
			},
			replace: (href: string, options?: Parameters<typeof router.replace>[1]) => {
				startNavigation(href);
				router.replace(href, options);
			},
		}),
		[router, startNavigation]
	);
};
