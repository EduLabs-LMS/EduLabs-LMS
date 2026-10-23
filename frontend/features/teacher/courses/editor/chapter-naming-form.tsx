'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { Button } from '@/frontend/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { Input } from '@/frontend/components/ui/input';
import { Label } from '@/frontend/components/ui/label';
import { Textarea } from '@/frontend/components/ui/textarea';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import type { Course } from '@/shared/contracts/courses';
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
	parseChapterNumber,
	parseChapterType,
} from '@/shared/chapter-label';

interface ChapterInfoRow {
	type: string;
	number: number;
	name: string;
	summary: string;
	description: string | null;
}

interface ChapterNamingFormProps {
	initialData: Pick<Course, 'chapterType' | 'chapterNumber'>;
	courseId: string;
	initialInfo: ChapterInfoRow | null;
}

const CUSTOM = '__custom__';
const isPreset = (value: string) => (CHAPTER_TYPE_PRESETS as readonly string[]).includes(value);

const errorMessage = (error: unknown, fallback: string) => {
	const data = (error as { response?: { data?: unknown } })?.response?.data;
	return typeof data === 'string' && data ? data : fallback;
};

/**
 * Names this lesson's chapter group as "[Type] [Number] - [Name]" (e.g. "Month 2 - Advanced Review")
 * and edits the group's short summary and optional full description. Admins and teachers only.
 * Every lesson with the same type + number shares the same name, summary and description.
 */
const ChapterNamingForm = ({ initialData, courseId, initialInfo }: ChapterNamingFormProps) => {
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const [isRefreshPending, startTransition] = useTransition();

	const [open, setOpen] = useState(false);
	const [saved, setSaved] = useState({
		type: initialData.chapterType || DEFAULT_CHAPTER_TYPE,
		number: initialData.chapterNumber,
		info: initialInfo,
	});

	const [typeChoice, setTypeChoice] = useState(CUSTOM);
	const [customType, setCustomType] = useState('');
	const [number, setNumber] = useState('');
	const [name, setName] = useState('');
	const [summary, setSummary] = useState('');
	const [description, setDescription] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [allInfo, setAllInfo] = useState<ChapterInfoRow[] | null>(null);

	const type = typeChoice === CUSTOM ? customType : typeChoice;
	const parsedType = parseChapterType(type);
	const parsedNumber = parseChapterNumber(number);

	const resetFromSaved = () => {
		const savedType = saved.type || DEFAULT_CHAPTER_TYPE;
		setTypeChoice(isPreset(savedType) ? savedType : CUSTOM);
		setCustomType(isPreset(savedType) ? '' : savedType);
		setNumber(saved.number ? String(saved.number) : '');
		setName(saved.info?.name ?? '');
		setSummary(saved.info?.summary ?? '');
		setDescription(saved.info?.description ?? '');
	};

	const openEditor = () => {
		resetFromSaved();
		setOpen(true);
	};

	// Load every named group once so picking an existing type + number pre-fills its details.
	useEffect(() => {
		if (!open || allInfo) return;
		api
			.get<ChapterInfoRow[]>('/api/chapter-info')
			.then((res) => setAllInfo(res.data))
			.catch(() => setAllInfo([]));
	}, [open, allInfo]);

	const match = useMemo(() => {
		if (!allInfo || !parsedType || parsedNumber === null) return null;
		const key = chapterKey(parsedType, parsedNumber);
		return allInfo.find((row) => chapterKey(row.type, row.number) === key) ?? null;
	}, [allInfo, parsedType, parsedNumber]);

	// Switching to a group that already has details shows them; a brand-new group keeps what was typed.
	const matchKey = match ? `${match.type}:${match.number}` : null;
	useEffect(() => {
		if (!match) return;
		setName(match.name);
		setSummary(match.summary);
		setDescription(match.description ?? '');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [matchKey]);

	const canSave = !!parsedType && parsedNumber !== null && !isSaving && !isRefreshPending;

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!parsedType || parsedNumber === null) return;
		setIsSaving(true);
		startLoading();
		try {
			await api.patch(`/api/courses/${courseId}`, {
				chapterType: parsedType,
				chapterNumber: parsedNumber,
			});

			let info: ChapterInfoRow | null = match;
			if (name.trim()) {
				const res = await api.put<ChapterInfoRow>('/api/chapter-info', {
					type: parsedType,
					number: parsedNumber,
					name,
					summary,
					description,
				});
				info = res.data;
				setAllInfo((rows) =>
					rows
						? [
								...rows.filter((row) => chapterKey(row.type, row.number) !== chapterKey(info!.type, info!.number)),
								info!,
							]
						: rows
				);
			}

			setSaved({ type: parsedType, number: parsedNumber, info });
			setOpen(false);
			toast.success('Chapter details saved');
			startTransition(() => router.refresh());
		} catch (error) {
			toast.error(errorMessage(error, 'Could not save the chapter details.'));
		} finally {
			setIsSaving(false);
			stopLoading();
		}
	};

	const savedTitle = saved.number ? formatChapterTitle(saved.type, saved.number, saved.info?.name) : null;
	const previewTitle = parsedType && parsedNumber !== null ? formatChapterTitle(parsedType, parsedNumber, name) : '—';

	return (
		<div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition-colors">
			<div className="flex items-center justify-between font-medium text-slate-900 text-sm">
				<span>
					Chapter <span className="text-red-500 font-bold">*</span>
				</span>
				<Button onClick={openEditor} variant="ghost" type="button">
					<Pencil className="mr-2 h-4 w-4" />
					{savedTitle ? 'Edit chapter' : 'Set chapter'}
				</Button>
			</div>

			{savedTitle ? (
				<div className="mt-2 space-y-1">
					<p className="text-sm font-semibold text-slate-900">{savedTitle}</p>
					{saved.info?.summary && <p className="text-sm text-slate-600">{saved.info.summary}</p>}
					{saved.info?.description && (
						<p className="whitespace-pre-wrap text-xs text-slate-500">{saved.info.description}</p>
					)}
					{!saved.info && (
						<p className="text-xs text-amber-700">
							No chapter name yet. Use Edit chapter to add a name, summary and description.
						</p>
					)}
				</div>
			) : (
				<p className="mt-2 text-sm text-slate-500">No chapter selected</p>
			)}

			<Dialog open={open} onOpenChange={(next) => !isSaving && setOpen(next)}>
				<DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
					<form onSubmit={save} className="grid gap-4">
						<DialogHeader>
							<DialogTitle className="font-display text-2xl">Chapter details</DialogTitle>
							<DialogDescription>
								Format: [Type] [Number] - [Name]. Every lesson with the same type and number shares these details.
							</DialogDescription>
						</DialogHeader>

						<div className="rounded-xl border-2 border-black bg-primary/30 px-3 py-2 text-sm font-semibold">
							{previewTitle}
						</div>

						<div className="grid grid-cols-[1fr_96px] gap-3">
							<div className="grid gap-2">
								<Label htmlFor="chapter-type">Type</Label>
								<Dropdown
									id="chapter-type"
									value={typeChoice}
									onChange={(event) => setTypeChoice(event.target.value)}
									className="h-10 w-full rounded-xl border-2 border-black bg-card px-3 text-sm"
								>
									{CHAPTER_TYPE_PRESETS.map((preset) => (
										<option key={preset} value={preset}>
											{preset}
										</option>
									))}
									<option value={CUSTOM}>Custom…</option>
								</Dropdown>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="chapter-number">Number</Label>
								<Input
									id="chapter-number"
									type="number"
									inputMode="numeric"
									min={1}
									max={MAX_CHAPTER_NUMBER}
									value={number}
									onChange={(event) => setNumber(event.target.value)}
								/>
							</div>
						</div>

						{typeChoice === CUSTOM && (
							<div className="grid gap-2">
								<Label htmlFor="chapter-custom-type">Custom type</Label>
								<Input
									id="chapter-custom-type"
									maxLength={MAX_CHAPTER_TYPE_LENGTH}
									placeholder="e.g. Semester, Part, Revision"
									value={customType}
									onChange={(event) => setCustomType(event.target.value)}
								/>
							</div>
						)}

						<div className="grid gap-2">
							<Label htmlFor="chapter-name">Chapter name</Label>
							<Input
								id="chapter-name"
								maxLength={MAX_CHAPTER_NAME_LENGTH}
								placeholder="e.g. Ohm's Law"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="chapter-summary">Short summary</Label>
							<Input
								id="chapter-summary"
								maxLength={MAX_CHAPTER_SUMMARY_LENGTH}
								placeholder="One line shown under the chapter name"
								value={summary}
								onChange={(event) => setSummary(event.target.value)}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="chapter-description">
								Full description <span className="font-normal text-slate-500">(optional)</span>
							</Label>
							<Textarea
								id="chapter-description"
								rows={4}
								maxLength={MAX_CHAPTER_DESCRIPTION_LENGTH}
								placeholder="Longer explanation students see when they open the chapter"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
							/>
						</div>

						{match && (
							<p className="text-xs text-slate-500">
								This chapter already exists. Saving updates it for every lesson in it.
							</p>
						)}

						<DialogFooter className="gap-2 sm:gap-0">
							<Button type="button" variant="outline" disabled={isSaving} onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={!canSave}>
								{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
};

export default ChapterNamingForm;
