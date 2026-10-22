'use client';

/**
 * Chapter details: "[Type] [Number] - [Name]" plus a short summary and a full description.
 * Same fields, limits and save call as before (the caller passes `onSave`); this matches the
 * target design with side-by-side Type and Number, live preview, reason whenever Save is off,
 * and a warning of how many lessons change.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/frontend/components/ui/dialog';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { FOCUS, Notice, Spinner, useLessonCount, useUnsavedWarning } from '@/frontend/features/teacher/ui/teacher-ui';
import { isConflictMessage } from '@/frontend/features/teacher/ui/editable-field';
import {
	CHAPTER_TYPE_PRESETS,
	DEFAULT_CHAPTER_TYPE,
	MAX_CHAPTER_DESCRIPTION_LENGTH,
	MAX_CHAPTER_NAME_LENGTH,
	MAX_CHAPTER_NUMBER,
	MAX_CHAPTER_SUMMARY_LENGTH,
	MAX_CHAPTER_TYPE_LENGTH,
	chapterKey,
	formatChapterTitle,
	parseChapterInfo,
	parseChapterNumber,
	parseChapterType,
} from '@/shared/chapter-label';
import type { MessageKey } from '@/frontend/locales/messages';
import { cn } from '@/shared/utils';

export type ChapterValues = { type: string; number: number; name: string; summary: string; description: string };

const CUSTOM = '__custom__';
const isPreset = (value: string) => (CHAPTER_TYPE_PRESETS as readonly string[]).includes(value);
const TYPE_KEY: Record<string, MessageKey> = {
	Chapter: 'teach.type.chapter',
	Month: 'teach.type.month',
	Unit: 'teach.type.unit',
	Week: 'teach.type.week',
	Module: 'teach.type.module',
	Term: 'teach.type.term',
	Revision: 'teach.type.revision',
};

/** Accessible branded select for chapter type, matching the target mockup. */
function TypeSelect({
	value,
	onChange,
	disabled,
	invalid,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	invalid?: boolean;
}) {
	const { t } = useLanguage();
	const labelId = useId();
	return (
		<div>
			<label htmlFor={labelId} className="block text-sm font-medium text-slate-900">
				{t('teach.chapter.type')}
			</label>
			<div className="relative mt-1">
				<select
					id={labelId}
					aria-label={t('teach.chapter.type')}
					aria-invalid={invalid || undefined}
					value={value}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
					className={cn(
						'block min-h-[48px] w-full appearance-none rounded-xl border-2 border-black bg-white pe-10 ps-3 text-sm font-medium transition-colors',
						FOCUS,
						invalid && 'border-red-600'
					)}
				>
					{CHAPTER_TYPE_PRESETS.map((option) => (
						<option key={option} value={option}>
							{t(TYPE_KEY[option])}
						</option>
					))}
					<option value={CUSTOM}>{t('teach.type.custom')}</option>
				</select>
				<ChevronDown className="pointer-events-none absolute end-3 top-3.5 h-4 w-4 text-slate-700 rtl:start-3 rtl:end-auto" aria-hidden />
			</div>
		</div>
	);
}

export function ChapterDetailsDialog({
	open,
	onOpenChange,
	mode,
	initial,
	lessonCount,
	otherChapters,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: 'create' | 'edit';
	initial?: Partial<ChapterValues>;
	/** Lessons that share these details (edit mode). Shown as "This will update N lessons". */
	lessonCount: number;
	/** type+number of the OTHER chapters in this course, to warn when a pair is reused. */
	otherChapters: { type: string; number: number | null }[];
	onSave: (values: ChapterValues) => Promise<void>;
}) {
	const { t } = useLanguage();
	const lessons = useLessonCount();
	const [choice, setChoice] = useState(DEFAULT_CHAPTER_TYPE);
	const [custom, setCustom] = useState('');
	const [number, setNumber] = useState('');
	const [name, setName] = useState('');
	const [summary, setSummary] = useState('');
	const [description, setDescription] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [touched, setTouched] = useState(false);
	const reasonId = useId();

	const startType = initial?.type ?? DEFAULT_CHAPTER_TYPE;
	const startValues = useMemo(
		() => ({
			choice: isPreset(startType) ? startType : CUSTOM,
			custom: isPreset(startType) ? '' : startType,
			number: initial?.number ? String(initial.number) : '',
			name: initial?.name ?? '',
			summary: initial?.summary ?? '',
			description: initial?.description ?? '',
		}),
		// Values are read once each time the dialog opens.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[open]
	);
	useEffect(() => {
		if (!open) return;
		setChoice(startValues.choice);
		setCustom(startValues.custom);
		setNumber(startValues.number);
		setName(startValues.name);
		setSummary(startValues.summary);
		setDescription(startValues.description);
		setSaving(false);
		setError('');
		setTouched(false);
	}, [open, startValues]);

	const type = choice === CUSTOM ? custom : choice;
	const parsedType = parseChapterType(type);
	const parsedNumber = parseChapterNumber(number);
	const dirty =
		open &&
		(choice !== startValues.choice || custom !== startValues.custom || number !== startValues.number || name !== startValues.name || summary !== startValues.summary || description !== startValues.description);
	useUnsavedWarning(dirty);

	const problem = !parsedType
		? ('type' as const)
		: parsedNumber === null
			? ('number' as const)
			: !name.trim()
				? ('name' as const)
				: name.trim().length > MAX_CHAPTER_NAME_LENGTH
					? ('name_long' as const)
					: summary.trim().length > MAX_CHAPTER_SUMMARY_LENGTH
						? ('summary_long' as const)
						: description.trim().length > MAX_CHAPTER_DESCRIPTION_LENGTH
							? ('description_long' as const)
							: null;
	const REASON: Record<NonNullable<typeof problem>, MessageKey> = {
		type: 'teach.chapter.reason.type',
		number: 'teach.chapter.reason.number',
		name: 'teach.chapter.reason.name',
		name_long: 'teach.chapter.reason.name_long',
		summary_long: 'teach.chapter.reason.summary_long',
		description_long: 'teach.chapter.reason.description_long',
	};
	const reason = problem ? t(REASON[problem], { max: problem === 'name_long' ? MAX_CHAPTER_NAME_LENGTH : problem === 'summary_long' ? MAX_CHAPTER_SUMMARY_LENGTH : MAX_CHAPTER_DESCRIPTION_LENGTH }) : '';
	const duplicate =
		parsedType && parsedNumber !== null && otherChapters.some((other) => other.number !== null && chapterKey(other.type, other.number) === chapterKey(parsedType, parsedNumber));
	const preview = formatChapterTitle(parsedType ?? type, parsedNumber, name);

	async function submit() {
		setTouched(true);
		if (problem || saving) return;
		const parsed = parseChapterInfo({ type, number: parsedNumber, name, summary, description });
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		setSaving(true);
		setError('');
		try {
			await onSave({ type: parsed.value.type, number: parsed.value.number, name: parsed.value.name, summary: parsed.value.summary, description: parsed.value.description ?? '' });
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('teach.save_failed'));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
			<DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-2 border-black bg-white p-5 shadow-hard sm:max-w-xl sm:p-6">
				<DialogHeader>
					<DialogTitle className="font-display text-2xl">{mode === 'create' ? t('teach.chapter.add_title') : t('teach.chapter.edit_title')}</DialogTitle>
					<DialogDescription className="text-sm text-slate-700">{t('teach.chapter.format_help')}</DialogDescription>
				</DialogHeader>

				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className="rounded-xl border-2 border-black bg-emerald-100 px-4 py-2.5 text-center sm:text-start" aria-live="polite">
						<p className="sr-only">{t('teach.chapter.preview_label')}</p>
						<p dir="auto" className="font-semibold text-emerald-950 [overflow-wrap:anywhere]">
							{preview || '—'}
						</p>
					</div>

					<div className="flex gap-3">
						<div className="flex-1">
							<TypeSelect value={choice} onChange={setChoice} disabled={saving} invalid={touched && !parsedType} />
						</div>
						<div className="w-28 sm:w-32">
							<label className="block text-sm font-medium text-slate-900">
								{t('teach.chapter.number')}
								<Input
									type="number"
									inputMode="numeric"
									min={1}
									max={MAX_CHAPTER_NUMBER}
									step={1}
									value={number}
									disabled={saving}
									aria-invalid={touched && parsedNumber === null}
									aria-describedby={reasonId}
									className="mt-1 min-h-[48px]"
									onChange={(event) => setNumber(event.target.value)}
								/>
							</label>
						</div>
					</div>

					{choice === CUSTOM && (
						<label className="block text-sm font-medium text-slate-900">
							{t('teach.chapter.custom_type')}
							<Input
								dir="auto"
								value={custom}
								maxLength={MAX_CHAPTER_TYPE_LENGTH}
								disabled={saving}
								placeholder={t('teach.chapter.custom_placeholder')}
								aria-invalid={touched && !parsedType}
								className="mt-1 min-h-[48px]"
								onChange={(event) => setCustom(event.target.value)}
							/>
						</label>
					)}

					<label className="block text-sm font-medium text-slate-900">
						{t('teach.chapter.name')}
						<Input
							dir="auto"
							value={name}
							maxLength={MAX_CHAPTER_NAME_LENGTH + 20}
							disabled={saving}
							placeholder={t('teach.chapter.name_placeholder')}
							aria-invalid={touched && !name.trim()}
							aria-describedby={reasonId}
							className="mt-1 min-h-[48px]"
							onChange={(event) => setName(event.target.value)}
						/>
					</label>

					<label className="block text-sm font-medium text-slate-900">
						{t('teach.chapter.summary')}
						<Input
							dir="auto"
							value={summary}
							maxLength={MAX_CHAPTER_SUMMARY_LENGTH + 20}
							disabled={saving}
							placeholder={t('teach.chapter.summary_placeholder')}
							className="mt-1 min-h-[48px]"
							onChange={(event) => setSummary(event.target.value)}
						/>
					</label>

					<div>
						<span className="text-sm font-medium text-slate-900">
							{t('teach.chapter.description')}
						</span>
						<Textarea
							dir="auto"
							value={description}
							rows={3}
							maxLength={MAX_CHAPTER_DESCRIPTION_LENGTH}
							disabled={saving}
							placeholder={t('teach.chapter.description_placeholder')}
							className="mt-1 min-h-[80px]"
							onChange={(event) => setDescription(event.target.value)}
						/>
					</div>

					{mode === 'edit' && lessonCount > 0 && (
						<Notice tone="warning">
							<strong>{t('teach.chapter.update_warning', { lessons: lessons(lessonCount) })}</strong>
							<span className="mt-0.5 block font-normal">{t('teach.chapter.update_warning_detail')}</span>
						</Notice>
					)}
					{duplicate && <Notice tone="info">{t('teach.chapter.duplicate', { label: formatChapterTitle(parsedType, parsedNumber) })}</Notice>}
					{error && (
						<Notice tone="danger">
							{error}
							{isConflictMessage(error) && <span className="mt-1 block font-normal">{t('teach.conflict.kept')}</span>}
						</Notice>
					)}

					<p id={reasonId} className="min-h-[1.25rem] text-xs font-medium text-slate-800" aria-live="polite">
						{reason && <>{t('teach.chapter.save_off')} {reason}</>}
					</p>

					<DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
						<Button type="button" variant="outline" className="min-h-[44px] rounded-full border-2 border-black bg-white px-6 font-semibold hover:bg-slate-100" disabled={saving} onClick={() => onOpenChange(false)}>
							{t('teach.cancel')}
						</Button>
						<Button type="submit" className="min-h-[44px] rounded-full border-2 border-black bg-emerald-200 text-emerald-950 px-7 font-semibold shadow-hard-sm hover:bg-emerald-300 disabled:opacity-50" disabled={Boolean(problem) || saving}>
							{saving ? <Spinner label={t('teach.saving')} /> : t('teach.chapter.save')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
