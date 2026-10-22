'use client';

import { useEffect, useState } from 'react';
import {
	ArrowDown,
	ArrowUp,
	ExternalLink,
	FileText,
	ListOrdered,
	Plus,
	Save,
	Settings2,
	Trash2,
	Video,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { FOCUS, Notice, Spinner } from '@/frontend/features/teacher/ui/teacher-ui';
import { homeworkApi } from '@/frontend/lib/homework';
import {
	homeworkAssignmentLabel,
	newHomeworkDefinition,
	newHomeworkQuestion,
	platformQuestions,
	type HomeworkDefinition,
	type HomeworkQuestion,
	type HomeworkView,
} from '@/shared/contracts/homework';
import { lessonPlayback } from '@/shared/contracts/lessons';
import { cn } from '@/shared/utils';

function VideoPreview({ url, title }: { url: string; title: string }) {
	const { t } = useLanguage();
	const playback = lessonPlayback(url);
	if (!playback) return <p className="text-xs font-medium text-amber-900">{t('teach.video.unsupported')}</p>;
	return playback.kind === 'embed' ? (
		<iframe
			title={title}
			src={playback.url}
			loading="lazy"
			allowFullScreen
			referrerPolicy="strict-origin-when-cross-origin"
			className="aspect-video w-full rounded-2xl border-2 border-black bg-black"
		/>
	) : (
		<video
			controls
			preload="metadata"
			src={playback.url}
			className="aspect-video w-full rounded-2xl border-2 border-black bg-black"
		/>
	);
}

export function SegmentHomework({
	courseId,
	lessonId,
	segmentId,
}: {
	courseId: string;
	lessonId: string;
	segmentId: string;
}) {
	const { t, number } = useLanguage();
	const [offerings, setOfferings] = useState<{ id: string; name: string }[]>([]);
	const [selectedOffering, setSelectedOffering] = useState<string>('');
	const [assignment, setAssignment] = useState<HomeworkView | null>(null);
	const [definition, setDefinition] = useState<HomeworkDefinition>(newHomeworkDefinition());
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [editingVideo, setEditingVideo] = useState(false);
	const [videoInput, setVideoInput] = useState('');
	const [targetCount, setTargetCount] = useState<string>('0');

	// Load offerings and existing assignments for this segment
	useEffect(() => {
		let alive = true;
		async function init() {
			try {
				setLoading(true);
				setError('');
				const [offList, assignList] = await Promise.all([
					homeworkApi<{ id: string; name: string }[]>('new', 'offerings', { courseId }).catch(() => []),
					homeworkApi<{ rows: { id: string; title: string; status: string; mode: string; offering_id: string; version: number }[] }>(
						'new',
						'list',
						{ courseId, lessonId, segmentId, offeringId: null, page: 0 }
					).catch(() => ({ rows: [] })),
				]);

				if (!alive) return;
				setOfferings(offList);
				const firstOfferingId = offList[0]?.id ?? '';
				setSelectedOffering(firstOfferingId);

				const firstRow = assignList.rows[0];
				if (firstRow) {
					const view = await homeworkApi<HomeworkView>(firstRow.id, 'get', {});
					if (!alive) return;
					setAssignment(view);
					setDefinition(view.definition);
					setVideoInput(view.definition.solutionVideo || '');
					setTargetCount(String(view.definition.questions.length));
				} else {
					const blank = newHomeworkDefinition();
					blank.title = 'Homework';
					setDefinition(blank);
					setTargetCount('0');
				}
			} catch (e) {
				if (alive) setError(e instanceof Error ? e.message : 'Failed to load homework');
			} finally {
				if (alive) setLoading(false);
			}
		}
		void init();
		return () => {
			alive = false;
		};
	}, [courseId, lessonId, segmentId]);

	const patch = (patchData: Partial<HomeworkDefinition>) =>
		setDefinition((old) => ({ ...old, ...patchData }));

	const updateQuestion = (qid: string, patchData: Partial<HomeworkQuestion>) =>
		patch({
			questions: definition.questions.map((q) => (q.id === qid ? { ...q, ...patchData } : q)),
		});

	function handleSetQuestionCount() {
		const count = parseInt(targetCount, 10);
		if (isNaN(count) || count < 0 || count > 100) return;
		const current = [...definition.questions];
		if (count > current.length) {
			const needed = count - current.length;
			const added: HomeworkQuestion[] = Array.from({ length: needed }, () => newHomeworkQuestion());
			patch({ questions: [...current, ...added] });
		} else if (count < current.length) {
			patch({ questions: current.slice(0, count) });
		}
	}

	async function handleSave(publishState?: boolean) {
		setSaving(true);
		setError('');
		try {
			const targetPublished = publishState !== undefined ? publishState : definition.published;
			const payload = {
				...definition,
				published: targetPublished,
			};

			const assignId = assignment?.id ?? 'new';
			const res = await homeworkApi<{ id: string }>(assignId, 'save', {
				offeringId: assignment?.offeringId || selectedOffering || offerings[0]?.id || null,
				lessonId,
				segmentId,
				revision: assignment?.revision ?? null,
				definition: payload,
				confirmModeChange: true,
			});

			const updated = await homeworkApi<HomeworkView>(res.id, 'get', {});
			setAssignment(updated);
			setDefinition(updated.definition);
			setVideoInput(updated.definition.solutionVideo || '');
			toast.success(t('teach.saved'));
		} catch (e) {
			const msg = e instanceof Error ? e.message : t('teach.save_failed');
			setError(msg);
			toast.error(msg);
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[160px] items-center justify-center p-6">
				<Spinner label={t('common.loading')} />
			</div>
		);
	}

	const isPlatformQuestions = definition.mode === 'PLATFORM_QUESTIONS';

	return (
		<div className="space-y-5">
			{error && <Notice tone="danger">{error}</Notice>}

			{/* Subcard 1: Solution Video Link */}
			<div className="rounded-2xl border border-slate-300 bg-slate-50 p-4 dark:border-border dark:bg-card">
				<div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-900 dark:text-slate-100">
					<span>{t('teach.video.solution_link')}</span>
					{!editingVideo ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="min-h-[44px]"
							onClick={() => {
								setVideoInput(definition.solutionVideo || '');
								setEditingVideo(true);
							}}
						>
							<Plus className="me-1.5 h-4 w-4" aria-hidden />
							{definition.solutionVideo ? t('teach.video.edit_solution') : t('teach.video.add_solution')}
						</Button>
					) : (
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="min-h-[44px]"
								onClick={() => setEditingVideo(false)}
							>
								{t('teach.cancel')}
							</Button>
							<Button
								type="button"
								size="sm"
								className="min-h-[44px] border-2 border-black bg-slate-900 text-white shadow-hard-sm hover:bg-black"
								disabled={saving}
								onClick={async () => {
									patch({ solutionVideo: videoInput });
									setEditingVideo(false);
									await handleSave();
								}}
							>
								{t('teach.save')}
							</Button>
						</div>
					)}
				</div>

				{editingVideo && (
					<div className="mt-3 space-y-2">
						<Input
							type="url"
							placeholder="https://www.youtube.com/watch?v=..."
							value={videoInput}
							onChange={(e) => setVideoInput(e.target.value)}
							className="min-h-[44px] bg-white dark:bg-background"
							aria-label={t('teach.video.solution_link')}
						/>
						<p className="text-xs text-slate-600 dark:text-slate-400">{t('teach.video.help')}</p>
					</div>
				)}

				<div className="mt-3">
					{definition.solutionVideo ? (
						<VideoPreview url={definition.solutionVideo} title={t('teach.video.solution_link')} />
					) : (
						<div className="flex h-44 w-full items-center justify-center rounded-2xl border border-emerald-300 bg-emerald-50/50 text-emerald-700/60 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400/60">
							<Video className="h-14 w-14" strokeWidth={1.5} aria-hidden />
						</div>
					)}
				</div>
			</div>

			{/* Subcard 2: Homework format toggle */}
			<div>
				<p id="homework-format-label" className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">
					{t('teach.homework.format')}
				</p>
				<div role="tablist" aria-labelledby="homework-format-label" className="flex flex-col gap-2 sm:flex-row">
					<button
						type="button"
						role="tab"
						aria-selected={!isPlatformQuestions}
						onClick={() => patch({ mode: 'FILE_UPLOAD', questions: [] })}
						className={cn(
							'flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
							FOCUS,
							!isPlatformQuestions
								? 'border-black bg-slate-900 text-white shadow-hard-sm dark:border-white dark:bg-slate-800'
								: 'border-black bg-white text-slate-900 hover:bg-slate-100 dark:border-border dark:bg-card dark:text-foreground'
						)}
					>
						<FileText className="h-4 w-4" aria-hidden />
						{t('teach.homework.file_upload')}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={isPlatformQuestions}
						onClick={() =>
							patch({
								mode: 'PLATFORM_QUESTIONS',
								questions: platformQuestions(definition.questions),
							})
						}
						className={cn(
							'flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
							FOCUS,
							isPlatformQuestions
								? 'border-black bg-slate-900 text-white shadow-hard-sm dark:border-white dark:bg-slate-800'
								: 'border-black bg-white text-slate-900 hover:bg-slate-100 dark:border-border dark:bg-card dark:text-foreground'
						)}
					>
						<ListOrdered className="h-4 w-4" aria-hidden />
						{t('teach.homework.platform_questions')}
					</button>
				</div>
			</div>

			{/* Subcard 3: Platform question builder (shown if PLATFORM_QUESTIONS) */}
			{isPlatformQuestions && (
				<div className="rounded-2xl border border-slate-300 bg-slate-50 p-4 dark:border-border dark:bg-card">
					<h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
						{t('teach.homework.builder_title')}
					</h3>
					<p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
						{t('teach.homework.builder_sub')}
					</p>

					<div className="mt-4 flex flex-wrap items-center gap-2">
						<label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
							{t('teach.homework.number_of_questions')}
						</label>
						<Input
							type="number"
							min={0}
							max={100}
							value={targetCount}
							onChange={(e) => setTargetCount(e.target.value)}
							className="h-9 w-20 bg-white text-center dark:bg-background"
							aria-label={t('teach.homework.number_of_questions')}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-9 rounded-full border-2 border-black font-bold shadow-hard-sm"
							onClick={handleSetQuestionCount}
						>
							{t('teach.homework.set_count')}
						</Button>
					</div>

					<div className="mt-4 flex flex-wrap items-center gap-3">
						<Button
							type="button"
							variant="outline"
							className="min-h-[44px] rounded-full border-2 border-black bg-white px-5 font-bold shadow-hard-sm hover:bg-slate-100 dark:border-white/20 dark:bg-card"
							onClick={() => patch({ questions: [...definition.questions, newHomeworkQuestion()] })}
						>
							<Plus className="me-1.5 h-4 w-4" aria-hidden />
							{t('teach.homework.add_question')}
						</Button>
						<Button
							type="button"
							className="min-h-[44px] rounded-full border-2 border-black bg-emerald-500 px-5 font-bold text-black shadow-hard-sm hover:bg-emerald-600 dark:bg-emerald-600 dark:text-white"
							disabled={saving}
							onClick={() => handleSave()}
						>
							<Save className="me-1.5 h-4 w-4" aria-hidden />
							{saving ? t('teach.saving') : t('teach.homework.save_questions')}
						</Button>
					</div>

					{/* Questions list */}
					<div className="mt-5 space-y-4">
						{definition.questions.map((q, idx) => (
							<div
								key={q.id}
								className="rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm dark:border-border dark:bg-background"
							>
								<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-border">
									<span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
										Q{number(idx + 1)}
									</span>
									<div className="flex items-center gap-1.5">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={idx === 0}
											aria-label={`Move question ${idx + 1} up`}
											onClick={() => {
												const items = [...definition.questions];
												[items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
												patch({ questions: items });
											}}
										>
											<ArrowUp className="h-3.5 w-3.5" aria-hidden />
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={idx === definition.questions.length - 1}
											aria-label={`Move question ${idx + 1} down`}
											onClick={() => {
												const items = [...definition.questions];
												[items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
												patch({ questions: items });
											}}
										>
											<ArrowDown className="h-3.5 w-3.5" aria-hidden />
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="border-red-600 text-red-700 hover:bg-red-50"
											onClick={() =>
												patch({
													questions: definition.questions.filter((item) => item.id !== q.id),
												})
											}
										>
											<Trash2 className="h-3.5 w-3.5" aria-hidden />
										</Button>
									</div>
								</div>

								<div className="mt-3 space-y-3">
									<div>
										<label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
											Question type
										</label>
										<select
											value={q.type}
											onChange={(e) => {
												const nextType = e.target.value as HomeworkQuestion['type'];
												updateQuestion(q.id, {
													type: nextType,
													options:
														nextType === 'essay'
															? []
															: q.options.length
																? q.options
																: newHomeworkQuestion().options,
													correctIds: nextType === 'essay' ? [] : q.correctIds.slice(0, 1),
												});
											}}
											className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2 text-sm dark:border-border dark:bg-card"
										>
											<option value="single_choice">Single-choice MCQ</option>
											<option value="multiple_choice">Multiple-choice MCQ</option>
											<option value="essay">Written / photo</option>
										</select>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
											Question text (optional — physical book)
										</label>
										<Textarea
											value={q.text}
											onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
											placeholder="Optional reference question text"
											className="mt-1"
											rows={2}
										/>
									</div>

									<div>
										<label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
											Marks
										</label>
										<Input
											type="number"
											min={0}
											max={1000}
											value={q.points}
											onChange={(e) => updateQuestion(q.id, { points: Number(e.target.value) })}
											className="mt-1 w-24"
										/>
									</div>

									{q.type !== 'essay' && (
										<div className="space-y-2 border-t border-slate-200 pt-3 dark:border-border">
											<p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
												Options &amp; Correct Key
											</p>
											{q.options.map((opt, optIdx) => (
												<div key={opt.id} className="flex items-center gap-2">
													<label className="flex items-center gap-1.5 text-xs font-bold">
														<input
															type={q.type === 'single_choice' ? 'radio' : 'checkbox'}
															name={`key-${q.id}`}
															checked={q.correctIds.includes(opt.id)}
															onChange={(e) =>
																updateQuestion(q.id, {
																	correctIds:
																		q.type === 'single_choice'
																			? [opt.id]
																			: e.target.checked
																				? [...q.correctIds, opt.id]
																				: q.correctIds.filter((v) => v !== opt.id),
																})
															}
														/>
														{String.fromCharCode(65 + optIdx)}
													</label>
													<Input
														value={opt.text}
														onChange={(e) =>
															updateQuestion(q.id, {
																options: q.options.map((o) =>
																	o.id === opt.id ? { ...o, text: e.target.value } : o
																),
															})
														}
														placeholder={`Option ${String.fromCharCode(65 + optIdx)} text`}
														className="h-8 flex-1 text-xs"
													/>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														disabled={q.options.length <= 2}
														onClick={() =>
															updateQuestion(q.id, {
																options: q.options.filter((o) => o.id !== opt.id),
																correctIds: q.correctIds.filter((v) => v !== opt.id),
															})
														}
														className="h-8 w-8 p-0"
													>
														×
													</Button>
												</div>
											))}
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={q.options.length >= 8}
												onClick={() =>
													updateQuestion(q.id, {
														options: [...q.options, { id: crypto.randomUUID(), text: '' }],
													})
												}
												className="text-xs"
											>
												<Plus className="me-1 h-3 w-3" /> Add option
											</Button>
										</div>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Subcard 4: Student Submission Portal */}
			<div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
				<h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
					{t('teach.homework.portal_title')}
				</h4>
				<p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
					{t('teach.homework.portal_sub')}
				</p>
			</div>

			{/* Progressive disclosure: Advanced group & version management */}
			<details className="rounded-2xl border border-slate-300 bg-slate-50 p-4 dark:border-border dark:bg-card">
				<summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
					<Settings2 className="h-4 w-4" aria-hidden />
					<span>Assignment settings &amp; offering groups</span>
				</summary>
				<div className="mt-4 space-y-4">
					{offerings.length > 0 && (
						<div>
							<label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
								Course Group / Offering
							</label>
							<select
								value={selectedOffering}
								onChange={(e) => setSelectedOffering(e.target.value)}
								className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2 text-sm dark:border-border dark:bg-background"
							>
								{offerings.map((o) => (
									<option key={o.id} value={o.id}>
										{o.name}
									</option>
								))}
							</select>
						</div>
					)}
					{assignment && (
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs font-medium text-slate-600 dark:text-slate-400">
								{homeworkAssignmentLabel(
									{ title: definition.title, status: assignment.definition.published ? 'published' : 'draft', version: assignment.revision },
									true
								)}
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => handleSave(!definition.published)}
							>
								{definition.published ? 'Unpublish homework' : 'Publish homework'}
							</Button>
						</div>
					)}
				</div>
			</details>
		</div>
	);
}
