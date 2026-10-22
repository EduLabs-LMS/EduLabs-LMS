'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'edulabs-support-draft:';
const MAX_DRAFT = 2000;

/**
 * Keeps a half-written reply per ticket in sessionStorage so it survives navigating away
 * (back button, list, refresh) and a failed send. sessionStorage, not localStorage, so a
 * draft never outlives the tab on a shared device. Every storage call is guarded: when
 * storage is blocked the hook behaves like plain useState.
 */
export function useReplyDraft(ticketId: string | null) {
	const key = ticketId ? PREFIX + ticketId : null;
	const keyRef = useRef<string | null>(key);
	const [text, setTextState] = useState('');

	useEffect(() => {
		keyRef.current = key;
		if (!key) {
			setTextState('');
			return;
		}
		try {
			setTextState(sessionStorage.getItem(key) ?? '');
		} catch {
			setTextState('');
		}
	}, [key]);

	const setText = useCallback((value: string) => {
		const next = value.slice(0, MAX_DRAFT);
		setTextState(next);
		const k = keyRef.current;
		if (!k) return;
		try {
			if (next) sessionStorage.setItem(k, next);
			else sessionStorage.removeItem(k);
		} catch {
			/* storage unavailable: keep the in-memory value only */
		}
	}, []);

	return [text, setText] as const;
}
