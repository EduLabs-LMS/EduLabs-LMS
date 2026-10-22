'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { LearningEdit } from '@/shared/contracts/lessons';

/** The existing authoring call. Throws with the server's own message (for example "Content changed. Reload."). */
export async function postLearningEdit(courseId: string, value: LearningEdit): Promise<string> {
	const response = await fetch(`/api/learning/${courseId}/edit`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(value),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(body.error || 'Content could not be saved');
	return body.id as string;
}

/**
 * Runs authoring edits one at a time and refreshes the page data afterwards.
 * `run` returns the id the server answered with and rethrows failures so callers can keep the teacher's input.
 */
export function useLearningEdit(courseId: string) {
	const router = useRouter();
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [refreshing, startTransition] = useTransition();
	const inFlight = useRef(false);

	const run = useCallback(
		async (value: LearningEdit, options: { refresh?: boolean } = {}) => {
			if (inFlight.current) throw new Error('Wait for the current save to finish.');
			inFlight.current = true;
			setBusy(true);
			setError('');
			try {
				const id = await postLearningEdit(courseId, value);
				if (options.refresh !== false) startTransition(() => router.refresh());
				return id;
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Save failed');
				throw e;
			} finally {
				inFlight.current = false;
				setBusy(false);
			}
		},
		[courseId, router]
	);

	return { run, error, busy: busy || refreshing, clearError: () => setError('') };
}
