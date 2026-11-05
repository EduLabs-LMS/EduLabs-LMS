'use client';

import { useRouter } from 'next/navigation';

/**
 * Kept for the existing callers. In-app navigation no longer plays the logo overlay: the app frame stays and the destination's loading.tsx
 * shows a skeleton of the page in the content area, so this is the plain router.
 */
export const useLoadingRouter = () => useRouter();
