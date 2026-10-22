'use client';

/**
 * Keeps a teacher's unsaved edits in this browser so a closed tab, a crash or a failed save never loses work.
 * This is not server autosave: nothing is sent anywhere until the teacher saves with the normal button.
 * Storage can be blocked or full, so every access is guarded and the editor works without it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Notice } from '@/frontend/features/teacher/ui/teacher-ui';

const PREFIX = 'edulabs.teacher.draft.v1:';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

type Stored<T> = { savedAt: number; base: string; value: T };

export const draftStorageKey = (scope: string) => `${PREFIX}${scope}`;

export function readDraft<T>(scope: string): Stored<T> | null {
	try {
		const raw = window.localStorage.getItem(draftStorageKey(scope));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Stored<T>;
		if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) {
			window.localStorage.removeItem(draftStorageKey(scope));
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function clearDraft(scope: string) {
	try {
		window.localStorage.removeItem(draftStorageKey(scope));
	} catch {
		/* storage unavailable: nothing to clear */
	}
}

/**
 * @param scope  unique per thing being edited, e.g. `segment:<id>`
 * @param value  the current editable values
 * @param base   a stable string describing the SAVED version (e.g. its updated_at). A draft made against an
 *               older base is still offered, but the notice says the saved version changed since.
 * @param dirty  true while `value` differs from what is saved
 */
export function useLocalDraft<T>(scope: string, value: T, base: string, dirty: boolean) {
	const [recovered, setRecovered] = useState<Stored<T> | null>(null);
	const checked = useRef(false);

	useEffect(() => {
		if (checked.current) return;
		checked.current = true;
		setRecovered(readDraft<T>(scope));
	}, [scope]);

	useEffect(() => {
		if (!checked.current || recovered) return;
		const timer = window.setTimeout(() => {
			try {
				if (dirty) window.localStorage.setItem(draftStorageKey(scope), JSON.stringify({ savedAt: Date.now(), base, value } satisfies Stored<T>));
				else window.localStorage.removeItem(draftStorageKey(scope));
			} catch {
				/* storage full or blocked */
			}
		}, 600);
		return () => window.clearTimeout(timer);
	}, [scope, value, base, dirty, recovered]);

	const discard = useCallback(() => {
		clearDraft(scope);
		setRecovered(null);
	}, [scope]);

	const take = useCallback(() => {
		const draft = recovered;
		setRecovered(null);
		return draft;
	}, [recovered]);

	return { recovered, discard, take, clear: () => clearDraft(scope) };
}

/** Shown above an editor when unsaved edits from an earlier visit were found. */
export function RecoveryNotice({
	savedAt,
	changedSince,
	onRestore,
	onDiscard,
}: {
	savedAt: number;
	changedSince: boolean;
	onRestore: () => void;
	onDiscard: () => void;
}) {
	const { t } = useLanguage();
	return (
		<Notice
			tone="warning"
			action={
				<span className="flex shrink-0 flex-wrap gap-2">
					<Button type="button" size="sm" className="min-h-[44px]" onClick={onRestore}>
						<History className="me-1.5 h-4 w-4" aria-hidden />
						{t('teach.draft.restore')}
					</Button>
					<Button type="button" size="sm" variant="outline" className="min-h-[44px]" onClick={onDiscard}>
						{t('teach.draft.discard')}
					</Button>
				</span>
			}
		>
			<strong className="block">{t('teach.draft.found_title')}</strong>
			{t('teach.draft.found_body', { time: new Date(savedAt).toLocaleString() })}
			{changedSince && <span className="mt-1 block">{t('teach.draft.changed_since')}</span>}
		</Notice>
	);
}
