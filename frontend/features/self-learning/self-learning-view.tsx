'use client';

import { L, LocalCount, useLanguage } from '@/frontend/components/language-provider';
import type { SelfLearningLesson, SelfLearningChapter } from '@/shared/contracts/dashboard';
export type { SelfLearningLesson, SelfLearningChapter } from '@/shared/contracts/dashboard';

import { ChapterDescription } from '@/frontend/components/chapter-description';
import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Layers } from 'lucide-react';
import { cn } from '@/shared/utils';
import { chapterKey, formatChapterLabel, formatChapterTitle } from '@/shared/chapter-label';
import { LessonCard, getLessonCardStatus } from '@/frontend/features/courses/lesson-card';
import { chapterProgress, filterChapters, type LessonFilter } from '@/shared/learning-filter';
import { Card, Chip, EmptyState, FilterPills, PageHeader, SearchField, buttonClass } from '@/frontend/components/page-kit';

interface SelfLearningViewProps {
	chapters: SelfLearningChapter[];
}

export const SelfLearningView = ({ chapters }: SelfLearningViewProps) => {
	const { t } = useLanguage();
	// Default open the first active chapter
	const [expandedChapter, setExpandedChapter] = useState<string | null>(
		chapters.length > 0 ? (chapters[0].id ?? chapterKey(chapters[0].type, chapters[0].number)) : null
	);
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState<LessonFilter>('all');
	const hasProgress = chapters.some((c) => c.progressAvailable !== false);
	const effectiveFilter = hasProgress ? filter : 'all';
	const searching = query.trim() !== '' || effectiveFilter !== 'all';
	const visible = useMemo(() => filterChapters(chapters, query, effectiveFilter), [chapters, query, effectiveFilter]);

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 pb-12 pt-2">
			<PageHeader
				icon={<BookOpen aria-hidden className="h-7 w-7" />}
				title={<L id="learning.self_learning_curriculum" />}
				subtitle={<L id="learning.explore_your_lessons_organized_by" />}
			/>

			{chapters.length > 0 && (
				<div className="flex flex-wrap items-center gap-3">
					<SearchField value={query} onChange={setQuery} label={t('lf.search_label')} placeholder={t('lf.search_ph')} />
					{hasProgress && (
						<FilterPills<LessonFilter>
							label={t('lf.filter_label')}
							value={filter}
							onChange={setFilter}
							options={[
								{ value: 'all', label: <L id="lf.all" /> },
								{ value: 'progress', label: <L id="lf.progress" /> },
								{ value: 'done', label: <L id="lf.done" /> },
								{ value: 'new', label: <L id="lf.new" /> },
							]}
						/>
					)}
				</div>
			)}

			{chapters.length === 0 ? (
				<EmptyState
					icon={<BookOpen className="h-10 w-10" />}
					title={<L id="learning.no_published_lessons_available_yet" />}
					note={<L id="learning.your_teacher_hasn_t_published" />}
				/>
			) : visible.length === 0 ? (
				<EmptyState
					title={<L id="lf.no_results" />}
					action={<button type="button" className={buttonClass} onClick={() => { setQuery(''); setFilter('all'); }}><L id="lf.clear" /></button>}
				/>
			) : (
				<div className="m-list space-y-4">
					{visible.map((chapter) => {
						const key = chapter.id ?? chapterKey(chapter.type, chapter.number);
						const isExpanded = searching || expandedChapter === key;
						const totalLessons = chapter.lessons.length;
						const completedLessons = chapter.lessons.filter((l) => l.chapters.length > 0 && l.chapters.every((c) => c.isCompleted)).length;
						const share = chapterProgress(chapter);

						return (
							<Card key={key} className="overflow-hidden !p-0">
								<button
									type="button"
									aria-expanded={isExpanded}
									onClick={() => setExpandedChapter((prev) => (prev === key ? null : key))}
									className="flex w-full items-center justify-between gap-3 p-5 text-start sm:p-6"
								>
									<div className="flex min-w-0 items-start gap-4 sm:items-center">
										<span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-black bg-primary text-lg font-bold">{chapter.number}</span>
										<div className="min-w-0 space-y-1">
											<span className="text-xs font-bold uppercase tracking-wider text-green-900">{formatChapterLabel(chapter.type, chapter.number)}</span>
											<h2 dir="auto" className="font-display text-xl leading-snug">{formatChapterTitle(chapter.type, chapter.number, chapter.title)}</h2>
											{chapter.subtitle && <p dir="auto" className="line-clamp-2 text-sm text-slate-700">{chapter.subtitle}</p>}
											{chapter.progressAvailable !== false && (
												<div className="flex items-center gap-2 pt-1" aria-hidden>
													<div className="h-2 w-28 overflow-hidden rounded-full border border-black bg-slate-100"><div className="m-bar h-full w-full bg-green-600" style={{ ['--p' as string]: share, transform: `scaleX(${share})` }} /></div>
													<span className="text-xs font-semibold text-slate-700">{completedLessons}/{totalLessons}</span>
												</div>
											)}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-3">
										<Chip className="hidden sm:inline-flex"><Layers className="h-3.5 w-3.5" aria-hidden /><LocalCount count={totalLessons} noun="lessons" /></Chip>
										<ChevronDown aria-hidden className={cn('h-5 w-5 transition-transform duration-200', !isExpanded && '-rotate-90 rtl:rotate-90')} />
									</div>
								</button>

								{isExpanded && (
									<div className="m-pop space-y-4 border-t-2 border-black bg-slate-50 p-5 sm:p-6">
										{chapter.description && <ChapterDescription value={chapter.description} />}
										<div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-700">
											<span><L id="learning.published_lessons" />{totalLessons})</span>
											<span>{chapter.progressUnavailable ? <L id="resume.progressUnavailable" /> : chapter.progressAvailable === false ? <L id="lesson.selectOffering" /> : <L id="learning.progress" values={{ completed: completedLessons, total: totalLessons }} />}</span>
										</div>
										<div className="m-list grid grid-cols-1 gap-4 sm:grid-cols-2">
											{chapter.lessons.map((lesson, idx) => {
												const firstSegment = lesson.chapters[0];
												return (
													<LessonCard
														key={lesson.id}
														href={lesson.href === null ? undefined : lesson.href ?? (firstSegment ? `/courses/${lesson.id}/chapters/${firstSegment.id}` : undefined)}
														chapterType={lesson.chapterType ?? 'Chapter'}
														chapterNumber={lesson.chapterNumber}
														lessonNumber={(chapters.find(c => (c.id ?? chapterKey(c.type,c.number)) === key)?.lessons.findIndex(l => l === lesson) ?? idx) + 1}
														title={lesson.title}
														description={lesson.description}
														imageUrl={lesson.imageUrl}
														partsCount={lesson.partsCount === undefined ? lesson.chapters.length : lesson.partsCount}
														status={lesson.status ?? getLessonCardStatus(lesson.chapters)}
													/>
												);
											})}
										</div>
									</div>
								)}
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
};
