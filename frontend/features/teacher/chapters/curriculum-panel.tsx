'use client';

/**
 * The course curriculum: chapters (type + number + name), the lessons inside each, and their status.
 * Uses only the existing authoring actions (create/edit/reorder module and lesson).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, BookOpen, ChevronRight, Layers, ListChecks, Pencil, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { ChapterDetailsDialog, type ChapterValues } from '@/frontend/features/teacher/chapters/chapter-details-dialog';
import { useLearningEdit } from '@/frontend/features/teacher/chapters/learning-edit';
import { EmptyBlock, FOCUS, Notice, Spinner, StatusPill, useLessonCount } from '@/frontend/features/teacher/ui/teacher-ui';
import { formatChapterTitle } from '@/shared/chapter-label';
import type { LearningLesson, LearningModule, LearningTree } from '@/shared/contracts/lessons';
import type { MessageKey } from '@/frontend/locales/messages';
import { cn } from '@/shared/utils';

type Item = { id: string; updated_at: string };

export const chapterNumberOf = (m: LearningModule, index: number) => m.chapter_number ?? index + 1;

/** Next free number for a new chapter of the same type (so "Add a chapter" suggests 3 after 1 and 2). */
export const suggestChapterNumber = (modules: LearningModule[]) => Math.min(99, Math.max(0, ...modules.map((m, i) => chapterNumberOf(m, i))) + 1);

function useSegmentCount() {
	const { language, number, t } = useLanguage();
	return (count: number) => t(`counts.segments.${new Intl.PluralRules(language).select(count)}` as MessageKey, { count: number(count) });
}

const waitFor = async <T,>(read: () => T | undefined, ms = 8000): Promise<T | undefined> => {
	const end = Date.now() + ms;
	for (;;) {
		const value = read();
		if (value !== undefined || Date.now() > end) return value;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
};

export function CurriculumPanel({ courseId, tree, courseBase }: { courseId: string; tree: LearningTree; courseBase: string }) {
	const { t } = useLanguage();
	const router = useRouter();
	const lessonsText = useLessonCount();
	const segmentsText = useSegmentCount();
	const { run, error, busy } = useLearningEdit(courseId);
	const treeRef = useRef(tree);
	useEffect(() => {
		treeRef.current = tree;
	}, [tree]);
	const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
	const [newLessonIn, setNewLessonIn] = useState<string | null>(null);
	const [newLessonTitle, setNewLessonTitle] = useState('');
	const [creatingLesson, setCreatingLesson] = useState(false);
	const [lessonError, setLessonError] = useState('');

	const reorder = (kind: 'modules' | 'lessons', parent: string, items: Item[], index: number, direction: -1 | 1) => {
		const next = [...items];
		[next[index], next[index + direction]] = [next[index + direction], next[index]];
		void run({ action: `reorder_${kind}`, id: null, parentId: parent, updatedAt: null, data: { items: next.map((x) => ({ id: x.id, updated_at: x.updated_at })) } }).catch(() => {});
	};
	const arrows = (kind: 'modules' | 'lessons', parent: string, items: Item[], index: number, name: string) => (
		<span className="inline-flex gap-1">
			<Button type="button" size="icon" variant="outline" className="h-11 w-11" aria-label={t('teach.move_up', { name })} disabled={busy || index === 0} onClick={() => reorder(kind, parent, items, index, -1)}>
				<ArrowUp className="h-4 w-4" aria-hidden />
			</Button>
			<Button type="button" size="icon" variant="outline" className="h-11 w-11" aria-label={t('teach.move_down', { name })} disabled={busy || index === items.length - 1} onClick={() => reorder(kind, parent, items, index, 1)}>
				<ArrowDown className="h-4 w-4" aria-hidden />
			</Button>
		</span>
	);

	const toDetails = (v: ChapterValues) => ({ title: v.name, group_type: v.type, chapter_number: v.number, summary: v.summary, description: v.description });

	async function createChapter(v: ChapterValues) {
		const id = await run({ action: 'create_module', id: null, parentId: courseId, updatedAt: null, data: { title: v.name } });
		const created = await waitFor(() => treeRef.current.modules.find((m) => m.id === id));
		if (!created) throw new Error(t('teach.chapter.created_finish'));
		await run({ action: 'edit_module_details', id, parentId: courseId, updatedAt: created.updated_at, data: toDetails(v) });
		toast.success(t('teach.chapter.added'));
	}

	async function createLesson(moduleId: string) {
		const title = newLessonTitle.trim();
		if (!title || creatingLesson) return;
		setCreatingLesson(true);
		setLessonError('');
		try {
			const id = await run({ action: 'create_lesson', id: null, parentId: moduleId, updatedAt: null, data: { title } }, { refresh: false });
			toast.success(t('teach.lesson.created'));
			router.push(`${courseBase}/${courseId}?lesson=${id}`);
		} catch (e) {
			setLessonError(e instanceof Error ? e.message : t('teach.save_failed'));
			setCreatingLesson(false);
		}
	}

	const editing = dialog?.mode === 'edit' ? tree.modules.find((m) => m.id === dialog.id) : undefined;
	const editingIndex = editing ? tree.modules.indexOf(editing) : -1;
	const editingLessons = editing ? tree.lessons.filter((l) => l.module_id === editing.id).length : 0;

	return (
		<div className="space-y-4">
			{error && <Notice tone="danger">{error}</Notice>}

			{!tree.modules.length ? (
				<EmptyBlock
					icon={<Layers className="h-6 w-6" />}
					title={t('teach.curriculum.empty_title')}
					body={t('teach.curriculum.empty_body')}
					action={
						<Button type="button" className="min-h-[44px]" onClick={() => setDialog({ mode: 'create' })}>
							<PlusCircle className="me-2 h-4 w-4" aria-hidden />
							{t('teach.chapter.add')}
						</Button>
					}
				/>
			) : (
				tree.modules.map((m, mi) => {
					const lessons = tree.lessons.filter((l) => l.module_id === m.id);
					const title = formatChapterTitle(m.group_type, chapterNumberOf(m, mi), m.title);
					return (
						<article key={m.id} className="rounded-2xl border-2 border-black bg-slate-50 p-4 sm:p-5" aria-labelledby={`chapter-${m.id}`}>
							<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0">
									<h3 id={`chapter-${m.id}`} dir="auto" className="font-display text-xl leading-snug [overflow-wrap:anywhere]">
										{title}
									</h3>
									{m.summary && <p dir="auto" className="mt-0.5 text-sm text-slate-800 [overflow-wrap:anywhere]">{m.summary}</p>}
									<p className="mt-1 text-xs font-medium text-slate-700">{lessonsText(lessons.length)}</p>
								</div>
								<div className="flex shrink-0 flex-wrap items-center gap-2">
									<Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => setDialog({ mode: 'edit', id: m.id })}>
										<Pencil className="me-2 h-4 w-4" aria-hidden />
										{t('teach.chapter.edit')}
									</Button>
									{arrows('modules', courseId, tree.modules, mi, title)}
								</div>
							</header>

							<ul className="mt-4 space-y-2">
								{lessons.map((l, li) => (
									<LessonRow
										key={l.id}
										lesson={l}
										index={li}
										href={`${courseBase}/${courseId}?lesson=${l.id}`}
										segmentCount={tree.segments.filter((s) => s.lesson_id === l.id).length}
										segmentsText={segmentsText}
										actions={arrows('lessons', m.id, lessons, li, l.title)}
									/>
								))}
								{!lessons.length && <li className="rounded-xl border border-dashed border-slate-500 bg-white p-4 text-sm text-slate-800">{t('teach.curriculum.no_lessons')}</li>}
							</ul>

							{newLessonIn === m.id ? (
								<form
									className="mt-3 flex flex-col gap-2 sm:flex-row"
									onSubmit={(event) => {
										event.preventDefault();
										void createLesson(m.id);
									}}
								>
									<Input
										dir="auto"
										autoFocus
										required
										maxLength={200}
										value={newLessonTitle}
										disabled={creatingLesson}
										aria-label={t('teach.lesson.title_label')}
										placeholder={t('teach.lesson.title_placeholder')}
										className="min-h-[44px] flex-1"
										onChange={(event) => setNewLessonTitle(event.target.value)}
									/>
									<Button type="submit" className="min-h-[44px]" disabled={!newLessonTitle.trim() || creatingLesson}>
										{creatingLesson ? <Spinner label={t('teach.saving')} /> : t('teach.lesson.create_continue')}
									</Button>
									<Button type="button" variant="outline" className="min-h-[44px]" disabled={creatingLesson} onClick={() => { setNewLessonIn(null); setNewLessonTitle(''); setLessonError(''); }}>
										{t('teach.cancel')}
									</Button>
									{lessonError && <p role="alert" className="text-sm font-medium text-red-800 sm:basis-full">{lessonError}</p>}
								</form>
							) : (
								<Button type="button" variant="outline" className="mt-3 min-h-[44px]" disabled={busy} onClick={() => { setNewLessonIn(m.id); setNewLessonTitle(''); setLessonError(''); }}>
									<PlusCircle className="me-2 h-4 w-4" aria-hidden />
									{t('teach.lesson.create')}
								</Button>
							)}
						</article>
					);
				})
			)}

			{tree.modules.length > 0 && (
				<Button type="button" className="min-h-[44px]" disabled={busy} onClick={() => setDialog({ mode: 'create' })}>
					<PlusCircle className="me-2 h-4 w-4" aria-hidden />
					{t('teach.chapter.add')}
				</Button>
			)}

			<ChapterDetailsDialog
				open={dialog?.mode === 'create'}
				onOpenChange={(open) => !open && setDialog(null)}
				mode="create"
				initial={{ number: suggestChapterNumber(tree.modules) }}
				lessonCount={0}
				otherChapters={tree.modules.map((m, i) => ({ type: m.group_type, number: chapterNumberOf(m, i) }))}
				onSave={createChapter}
			/>
			{editing && (
				<ChapterDetailsDialog
					key={editing.id + editing.updated_at}
					open
					onOpenChange={(open) => !open && setDialog(null)}
					mode="edit"
					initial={{ type: editing.group_type, number: chapterNumberOf(editing, editingIndex), name: editing.title, summary: editing.summary ?? '', description: editing.description ?? '' }}
					lessonCount={editingLessons}
					otherChapters={tree.modules.filter((m) => m.id !== editing.id).map((m) => ({ type: m.group_type, number: m.chapter_number ?? null }))}
					onSave={async (v) => {
						await run({ action: 'edit_module_details', id: editing.id, parentId: courseId, updatedAt: editing.updated_at, data: toDetails(v) });
						toast.success(t('teach.chapter.saved'));
					}}
				/>
			)}
		</div>
	);
}

function LessonRow({
	lesson,
	href,
	index,
	segmentCount,
	segmentsText,
	actions,
}: {
	lesson: LearningLesson;
	href: string;
	index: number;
	segmentCount: number;
	segmentsText: (count: number) => string;
	actions: React.ReactNode;
}) {
	const { t, number } = useLanguage();
	return (
		<li className="flex flex-col gap-2 rounded-xl border border-slate-400 bg-white p-3 sm:flex-row sm:items-center">
			<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-950" aria-hidden>
				{number(index + 1)}
			</span>
			<div className="min-w-0 flex-1">
				<Link href={href} dir="auto" className={cn('block font-semibold text-slate-900 underline-offset-2 hover:underline [overflow-wrap:anywhere]', FOCUS)}>
					{lesson.title}
				</Link>
				<p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-700">
					<StatusPill published={lesson.status === 'published'} />
					<span className="inline-flex items-center gap-1">
						<ListChecks className="h-3.5 w-3.5" aria-hidden />
						{segmentsText(segmentCount)}
					</span>
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Button asChild variant="outline" className="min-h-[44px]">
					<Link href={href}>
						<BookOpen className="me-2 h-4 w-4" aria-hidden />
						{t('teach.lesson.open')}
						<ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
					</Link>
				</Button>
				{actions}
			</div>
		</li>
	);
}
