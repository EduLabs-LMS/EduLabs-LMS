'use client';

/**
 * Lesson editor: details (title, chapter, description, image) and the reorderable list of segments.
 * Built on the existing authoring actions; the real publish rule applies (a lesson needs a published segment).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, GripVertical, ImageIcon, LayoutDashboard, ListChecks, Pencil, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { ChapterDetailsDialog } from '@/frontend/features/teacher/chapters/chapter-details-dialog';
import { chapterNumberOf } from '@/frontend/features/teacher/chapters/curriculum-panel';
import { useLearningEdit } from '@/frontend/features/teacher/chapters/learning-edit';
import { LessonCoverForm } from '@/frontend/features/teacher/chapters/editor/lesson-cover-form';
import { EditableField } from '@/frontend/features/teacher/ui/editable-field';
import { PublishControl } from '@/frontend/features/teacher/ui/publish-control';
import { EmptyBlock, FOCUS, FieldCard, Notice, ReadinessList, SectionCard, Spinner, StatusPill, TeacherHeader, useLessonCount } from '@/frontend/features/teacher/ui/teacher-ui';
import { formatChapterTitle } from '@/shared/chapter-label';
import type { LearningSegment, LearningTree } from '@/shared/contracts/lessons';
import { cn } from '@/shared/utils';

export function LessonEditor({ courseId, courseBase, tree, lessonId }: { courseId: string; courseBase: string; tree: LearningTree; lessonId: string }) {
	const { t, number } = useLanguage();
	const lessonsText = useLessonCount();
	const { run, error, busy } = useLearningEdit(courseId);
	const lesson = tree.lessons.find((l) => l.id === lessonId)!;
	const moduleIndex = tree.modules.findIndex((m) => m.id === lesson.module_id);
	const chapter = tree.modules[moduleIndex];
	const siblings = tree.lessons.filter((l) => l.module_id === lesson.module_id);
	const segments = tree.segments.filter((s) => s.lesson_id === lesson.id);
	const [chapterOpen, setChapterOpen] = useState(false);
	const published = lesson.status === 'published';
	const publishedSegments = segments.filter((s) => s.status === 'published');
	const chapterLabel = chapter ? formatChapterTitle(chapter.group_type, chapterNumberOf(chapter, moduleIndex), chapter.title) : '';

	const checks = [
		{ done: lesson.title.trim().length > 0, label: t('teach.lesson.ready.title') },
		{ done: Boolean(chapter), label: t('teach.lesson.ready.chapter') },
		{ done: publishedSegments.length > 0, label: t('teach.lesson.ready.segment') },
	];
	const completed = checks.filter((c) => c.done).length;
	const blocked = publishedSegments.length === 0 ? t('teach.lesson.publish_blocked') : undefined;

	const editLesson = (patch: { title?: string; description?: string; status?: 'draft' | 'published' }) =>
		run({
			action: 'edit_lesson',
			id: lesson.id,
			parentId: null,
			updatedAt: lesson.updated_at,
			data: { title: lesson.title, description: lesson.description, status: lesson.status as 'draft' | 'published', ...patch },
		});

	const firstSegment = segments[0];

	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 pb-16 pt-2">
			<Link href={`${courseBase}/${courseId}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-800 hover:text-black">
				<ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
				{t('teach.back_to_course')}
			</Link>

			{!published && <Notice tone="warning">{t('teach.lesson.draft_notice')}</Notice>}
			{error && <Notice tone="danger">{error}</Notice>}

			<TeacherHeader
				pill={t('teach.lesson.pill')}
				title={lesson.title}
				subtitle={t('teach.completion', { done: number(completed), total: number(checks.length) })}
				actions={
					<>
						<StatusPill published={published} />
						{firstSegment && (
							<Button asChild variant="outline" className="min-h-[44px]">
								<Link href={`${courseBase}/${courseId}/chapters/${firstSegment.id}?preview=1`}>
									<Eye className="me-2 h-4 w-4" aria-hidden />
									{t('teach.preview_draft')}
								</Link>
							</Button>
						)}
						<PublishControl kind="lesson" published={published} disabled={busy} blockedReason={blocked} onChange={(next) => editLesson({ status: next ? 'published' : 'draft' })} />
					</>
				}
			>
				<ReadinessList className="mt-4" title={published ? t('teach.lesson.ready.title_published') : t('teach.lesson.ready.title_label')} items={checks} />
			</TeacherHeader>

			<SectionCard icon={<LayoutDashboard className="h-5 w-5" />} title={t('teach.lesson.customize')} subtitle={t('teach.lesson.customize_sub')}>
				<EditableField label={t('teach.lesson.title_field')} required value={lesson.title} base={lesson.updated_at} draftScope={`lesson:${lesson.id}:title`} editLabel="teach.edit_title" placeholder={t('teach.lesson.title_placeholder')} maxLength={200} onSave={(title) => editLesson({ title })} />

				<FieldCard
					label={t('teach.lesson.chapter_field')}
					required
					action={
						chapter && (
							<Button type="button" variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => setChapterOpen(true)}>
								<Pencil className="me-2 h-4 w-4" aria-hidden />
								{t('teach.edit_chapter')}
							</Button>
						)
					}
				>
					{chapter ? (
						<>
							<p dir="auto" className="font-semibold [overflow-wrap:anywhere]">{chapterLabel}</p>
							{!chapter.title.trim() && <p className="mt-1 text-xs font-medium text-amber-900">{t('teach.lesson.chapter_no_name')}</p>}
							<p className="mt-1 text-xs text-slate-700">{t('teach.lesson.chapter_shared', { lessons: lessonsText(siblings.length) })}</p>
						</>
					) : (
						<p className="text-slate-700">{t('teach.lesson.no_chapter')}</p>
					)}
				</FieldCard>

				<EditableField label={t('teach.lesson.description_field')} kind="rich" value={lesson.description} base={lesson.updated_at} draftScope={`lesson:${lesson.id}:description`} editLabel="teach.edit_description" addLabel="teach.add_description" emptyText="teach.lesson.no_description" onSave={(description) => editLesson({ description })} />

				<FieldCard label={t('teach.lesson.image_field')} hint={t('teach.lesson.image_hint')}>
					<LessonCoverForm courseId={courseId} lesson={lesson} />
				</FieldCard>
			</SectionCard>

			<SectionCard icon={<ListChecks className="h-5 w-5" />} title={t('teach.segments.title')} subtitle={t('teach.segments.subtitle')}>
				<SegmentList courseId={courseId} courseBase={courseBase} lessonId={lesson.id} segments={segments} />
			</SectionCard>

			{chapter && (
				<ChapterDetailsDialog
					key={chapter.id + chapter.updated_at}
					open={chapterOpen}
					onOpenChange={setChapterOpen}
					mode="edit"
					initial={{ type: chapter.group_type, number: chapterNumberOf(chapter, moduleIndex), name: chapter.title, summary: chapter.summary ?? '', description: chapter.description ?? '' }}
					lessonCount={siblings.length}
					otherChapters={tree.modules.filter((m) => m.id !== chapter.id).map((m) => ({ type: m.group_type, number: m.chapter_number ?? null }))}
					onSave={async (v) => {
						await run({ action: 'edit_module_details', id: chapter.id, parentId: courseId, updatedAt: chapter.updated_at, data: { title: v.name, group_type: v.type, chapter_number: v.number, summary: v.summary, description: v.description } });
						toast.success(t('teach.chapter.saved'));
					}}
				/>
			)}
		</div>
	);
}

function SegmentList({ courseId, courseBase, lessonId, segments }: { courseId: string; courseBase: string; lessonId: string; segments: LearningSegment[] }) {
	const { t, number } = useLanguage();
	const router = useRouter();
	const { run, error, busy } = useLearningEdit(courseId);
	const [mounted, setMounted] = useState(false);
	const [order, setOrder] = useState(segments);
	const [adding, setAdding] = useState(false);
	const [title, setTitle] = useState('');
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState('');
	const [announce, setAnnounce] = useState('');

	useEffect(() => setMounted(true), []);
	useEffect(() => setOrder(segments), [segments]);

	const save = (next: LearningSegment[], moved: LearningSegment, to: number) => {
		const previous = order;
		setOrder(next);
		setAnnounce(t('teach.segments.moved', { name: moved.title, position: number(to + 1), total: number(next.length) }));
		run({ action: 'reorder_segments', id: null, parentId: lessonId, updatedAt: null, data: { items: next.map((s) => ({ id: s.id, updated_at: s.updated_at })) } }).catch(() => setOrder(previous));
	};
	const move = (index: number, direction: -1 | 1) => {
		const next = [...order];
		[next[index], next[index + direction]] = [next[index + direction], next[index]];
		save(next, order[index], index + direction);
	};
	const onDragEnd = (result: DropResult) => {
		if (!result.destination || result.destination.index === result.source.index) return;
		const next = [...order];
		const [moved] = next.splice(result.source.index, 1);
		next.splice(result.destination.index, 0, moved);
		save(next, moved, result.destination.index);
	};

	async function create() {
		const name = title.trim();
		if (!name || creating) return;
		setCreating(true);
		setCreateError('');
		try {
			const id = await run({ action: 'create_segment', id: null, parentId: lessonId, updatedAt: null, data: { title: name } }, { refresh: false });
			toast.success(t('teach.segment.created'));
			router.push(`${courseBase}/${courseId}/chapters/${id}`);
		} catch (e) {
			setCreateError(e instanceof Error ? e.message : t('teach.save_failed'));
			setCreating(false);
		}
	}

	const row = (s: LearningSegment, index: number, handle?: React.ReactNode) => (
		<div className={cn('flex flex-wrap items-center gap-2 rounded-xl border-2 p-2 sm:flex-nowrap', s.status === 'published' ? 'border-emerald-700 bg-emerald-50' : 'border-slate-400 bg-slate-100')}>
			{handle ?? <span className="w-2" />}
			<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-xs font-bold" aria-hidden>
				{number(index + 1)}
			</span>
			<Link href={`${courseBase}/${courseId}/chapters/${s.id}`} dir="auto" className={cn('min-w-0 flex-1 basis-40 font-semibold text-slate-900 underline-offset-2 hover:underline [overflow-wrap:anywhere]', FOCUS)}>
				{s.title}
			</Link>
			<StatusPill published={s.status === 'published'} />
			<span className="inline-flex gap-1">
				<Button type="button" size="icon" variant="outline" className="h-11 w-11" aria-label={t('teach.move_up', { name: s.title })} disabled={busy || index === 0} onClick={() => move(index, -1)}>
					<ArrowUp className="h-4 w-4" aria-hidden />
				</Button>
				<Button type="button" size="icon" variant="outline" className="h-11 w-11" aria-label={t('teach.move_down', { name: s.title })} disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}>
					<ArrowDown className="h-4 w-4" aria-hidden />
				</Button>
				<Button asChild size="icon" variant="outline" className="h-11 w-11">
					<Link href={`${courseBase}/${courseId}/chapters/${s.id}`} aria-label={t('teach.segment.edit_named', { name: s.title })}>
						<Pencil className="h-4 w-4" aria-hidden />
					</Link>
				</Button>
			</span>
		</div>
	);

	return (
		<div className="space-y-3">
			{error && <Notice tone="danger">{error}</Notice>}
			<p className="sr-only" role="status" aria-live="polite">{announce}</p>

			{!order.length && !adding && (
				<EmptyBlock icon={<ImageIcon className="h-6 w-6" />} title={t('teach.segments.empty_title')} body={t('teach.segments.empty_body')} />
			)}

			{mounted && order.length > 0 && (
				<DragDropContext onDragEnd={onDragEnd}>
					<Droppable droppableId={`segments-${lessonId}`}>
						{(drop) => (
							<ul ref={drop.innerRef} {...drop.droppableProps} className="space-y-2">
								{order.map((s, index) => (
									<Draggable key={s.id} draggableId={s.id} index={index} isDragDisabled={busy}>
										{(drag, snapshot) => (
											<li ref={drag.innerRef} {...drag.draggableProps} className={cn(snapshot.isDragging && 'opacity-90 shadow-hard')}>
												{row(
													s,
													index,
													<span {...drag.dragHandleProps} aria-label={t('teach.segments.drag', { name: s.title })} className={cn('grid h-11 w-9 shrink-0 cursor-grab place-items-center rounded-lg text-slate-700 hover:bg-white', FOCUS)}>
														<GripVertical className="h-5 w-5" aria-hidden />
													</span>
												)}
											</li>
										)}
									</Draggable>
								))}
								{drop.placeholder}
							</ul>
						)}
					</Droppable>
				</DragDropContext>
			)}
			{!mounted && order.length > 0 && <ul className="space-y-2">{order.map((s, i) => <li key={s.id}>{row(s, i)}</li>)}</ul>}
			{order.length > 1 && <p className="text-xs text-slate-700">{t('teach.segments.reorder_help')}</p>}

			{adding ? (
				<form
					className="flex flex-col gap-2 sm:flex-row"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<Input dir="auto" autoFocus required maxLength={200} value={title} disabled={creating} aria-label={t('teach.segment.title_label')} placeholder={t('teach.segment.title_placeholder')} className="min-h-[44px] flex-1" onChange={(event) => setTitle(event.target.value)} />
					<Button type="submit" className="min-h-[44px]" disabled={!title.trim() || creating}>
						{creating ? <Spinner label={t('teach.saving')} /> : t('teach.segment.create_continue')}
					</Button>
					<Button type="button" variant="outline" className="min-h-[44px]" disabled={creating} onClick={() => { setAdding(false); setTitle(''); setCreateError(''); }}>
						{t('teach.cancel')}
					</Button>
					{createError && <p role="alert" className="text-sm font-medium text-red-800 sm:basis-full">{createError}</p>}
				</form>
			) : (
				<Button type="button" className="min-h-[44px]" disabled={busy} onClick={() => setAdding(true)}>
					<PlusCircle className="me-2 h-4 w-4" aria-hidden />
					{t('teach.segment.add')}
				</Button>
			)}
		</div>
	);
}
