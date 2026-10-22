'use client';

/**
 * One value the teacher edits in place: shows it with an "Edit ..." button, opens a small editor,
 * saves through the caller's existing save call, and protects the typing on the client:
 * edits are kept in this browser until a save succeeds, closing the tab while editing warns first,
 * and a failed or conflicting save keeps everything the teacher typed.
 */
import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, RefreshCw, X } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Editor } from '@/frontend/components/editor';
import { Preview } from '@/frontend/components/preview';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { FieldCard, Notice, Spinner, useUnsavedWarning } from '@/frontend/features/teacher/ui/teacher-ui';
import { RecoveryNotice, clearDraft, useLocalDraft } from '@/frontend/features/teacher/ui/use-local-draft';
import type { MessageKey } from '@/frontend/locales/messages';

/** True when the server said somebody else saved first (existing "changed / reload" responses). */
export const isConflictMessage = (message: string) => /changed|reload|stale|conflict/i.test(message);

export function EditableField({
	label,
	required,
	kind = 'text',
	value,
	base,
	draftScope,
	editLabel,
	addLabel,
	placeholder,
	emptyText,
	maxLength,
	hint,
	validate,
	display,
	onSave,
}: {
	label: ReactNode;
	required?: boolean;
	kind?: 'text' | 'rich';
	value: string;
	/** Identifies the saved version (its `updated_at`), so a draft made on an older one can be flagged. */
	base: string;
	/** Unique per thing edited, e.g. `lesson:<id>:title`. */
	draftScope: string;
	editLabel: MessageKey;
	addLabel?: MessageKey;
	placeholder?: string;
	emptyText?: MessageKey;
	maxLength?: number;
	hint?: ReactNode;
	/** Extra check run on the typed text. Return a short message to block saving, or null when fine. */
	validate?: (value: string) => string | null;
	/** Replaces the plain value view (for example a video preview) while not editing. */
	display?: ReactNode;
	onSave: (value: string) => Promise<unknown>;
}) {
	const { t } = useLanguage();
	const router = useRouter();
	const reasonId = useId();
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState(value);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [confirmDiscard, setConfirmDiscard] = useState(false);

	const clean = (input: string) => (kind === 'rich' ? input.replace(/<p><br><\/p>/g, '').trim() : input.trim());
	const dirty = editing && clean(text) !== clean(value);
	const missing = required && !clean(text);
	const tooLong = maxLength !== undefined && text.length > maxLength;
	const invalid = text.trim() ? validate?.(text.trim()) ?? null : null;
	const reason = invalid ? invalid : missing ? t('teach.field.required_reason') : tooLong ? t('teach.field.too_long', { max: maxLength ?? 0 }) : !dirty ? t('teach.field.nothing_changed') : '';
	const canSave = !saving && !reason;

	useUnsavedWarning(dirty);
	const draft = useLocalDraft<string>(draftScope, text, base, dirty);
	const showRecovery = !editing && draft.recovered && clean(draft.recovered.value) !== clean(value);

	const open = (start = value) => {
		setText(start);
		setError('');
		setConfirmDiscard(false);
		setEditing(true);
	};
	const close = () => {
		clearDraft(draftScope);
		setEditing(false);
		setConfirmDiscard(false);
		setError('');
	};

	async function save() {
		if (!canSave) return;
		setSaving(true);
		setError('');
		try {
			await onSave(clean(text));
			clearDraft(draftScope);
			setEditing(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('teach.save_failed'));
		} finally {
			setSaving(false);
		}
	}

	const button = editing ? null : (
		<Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => open()}>
			<Pencil className="me-2 h-4 w-4" aria-hidden />
			{value.trim() && !addLabel ? t(editLabel) : t(addLabel ?? editLabel)}
		</Button>
	);

	return (
		<FieldCard label={label} required={required} action={button} hint={editing ? hint : undefined}>
			{showRecovery && draft.recovered && (
				<RecoveryNotice
					savedAt={draft.recovered.savedAt}
					changedSince={draft.recovered.base !== base}
					onRestore={() => {
						const taken = draft.take();
						if (taken) open(taken.value);
					}}
					onDiscard={draft.discard}
				/>
			)}
			{!editing && (
				<div className={showRecovery ? 'mt-3' : undefined}>
					{display ? (
						display
					) : value.trim() ? (
						kind === 'rich' ? <Preview value={value} /> : <p dir="auto" className="[overflow-wrap:anywhere]">{value}</p>
					) : (
						<p className="italic text-slate-700">{t(emptyText ?? 'teach.field.empty')}</p>
					)}
				</div>
			)}
			{editing && (
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					{kind === 'rich' ? (
						<fieldset disabled={saving}>
							<Editor value={text} onChange={setText} />
						</fieldset>
					) : (
						<Input
							dir="auto"
							autoFocus
							value={text}
							disabled={saving}
							placeholder={placeholder}
							aria-invalid={Boolean(missing || tooLong || invalid)}
							aria-describedby={reasonId}
							maxLength={maxLength ? maxLength + 50 : undefined}
							onChange={(event) => setText(event.target.value)}
						/>
					)}
					<p id={reasonId} className="text-xs text-slate-700" aria-live="polite">
						{reason}
					</p>
					{error && (
						<Notice
							tone="danger"
							action={
								isConflictMessage(error) ? (
									<Button type="button" size="sm" variant="outline" className="min-h-[44px]" onClick={() => router.refresh()}>
										<RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
										{t('teach.conflict.reload')}
									</Button>
								) : undefined
							}
						>
							{error}
							{isConflictMessage(error) && <span className="mt-1 block font-normal">{t('teach.conflict.kept')}</span>}
						</Notice>
					)}
					{confirmDiscard && (
						<Notice tone="warning">
							<span className="block">{t('teach.field.discard_ask')}</span>
							<span className="mt-2 flex gap-2">
								<Button type="button" size="sm" className="min-h-[44px]" onClick={() => setConfirmDiscard(false)}>
									{t('teach.field.keep_editing')}
								</Button>
								<Button type="button" size="sm" variant="outline" className="min-h-[44px]" onClick={close}>
									{t('teach.field.discard')}
								</Button>
							</span>
						</Notice>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" className="min-h-[44px]" disabled={!canSave}>
							<Check className="me-1.5 h-4 w-4" aria-hidden />
							{t('teach.save')}
						</Button>
						<Button type="button" variant="outline" className="min-h-[44px]" disabled={saving} onClick={() => (dirty ? setConfirmDiscard(true) : close())}>
							<X className="me-1.5 h-4 w-4" aria-hidden />
							{t('teach.cancel')}
						</Button>
						{saving && <Spinner label={t('teach.saving')} />}
						{dirty && !saving && <span className="text-xs text-slate-700">{t('teach.field.unsaved')}</span>}
					</div>
				</form>
			)}
		</FieldCard>
	);
}
