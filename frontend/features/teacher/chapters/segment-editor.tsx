'use client';

/**
 * Segment editor: title, description, a video (link, or an uploaded private MP4), a thumbnail, optional
 * resources, lesson-wide notes, and homework. Every save goes through the existing authoring actions.
 * The real publish rule applies: a segment needs a description, a video, a resource or lesson notes.
 */
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Eye, FileText, LayoutDashboard, Paperclip, PlayCircle, Settings2, Trash2, Video } from 'lucide-react';

import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { HomeworkAssignments } from '@/frontend/features/courses/lesson/homework-assignments';
import { useLearningEdit } from '@/frontend/features/teacher/chapters/learning-edit';
import { EditableField } from '@/frontend/features/teacher/ui/editable-field';
import { PublishControl } from '@/frontend/features/teacher/ui/publish-control';
import { FOCUS, FieldCard, Notice, ReadinessList, SectionCard, StatusPill, TeacherHeader } from '@/frontend/features/teacher/ui/teacher-ui';
import { uploadLessonFile } from '@/frontend/lib/lesson-upload';
import { lessonPlayback, lessonVideo, type LearningSegment, type LearningTree } from '@/shared/contracts/lessons';
import { previewPartHref } from '@/shared/student-preview';
import { cn } from '@/shared/utils';

type Tab = 'video' | 'homework';

function VideoPreview({ url, title }: { url: string; title: string }) {
	const { t } = useLanguage();
	const playback = lessonPlayback(url);
	if (!playback) return <p className="text-xs font-medium text-amber-900">{t('teach.video.unsupported')}</p>;
	return playback.kind === 'embed' ? (
		<iframe title={title} src={playback.url} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full rounded-xl border-2 border-black bg-black" />
	) : (
		<video controls preload="metadata" src={playback.url} className="aspect-video w-full rounded-xl border-2 border-black bg-black" />
	);
}

export function SegmentEditor({ courseId, segment, tree, thumbnailUrl }: { courseId: string; segment: LearningSegment; tree: LearningTree; thumbnailUrl?: string | null }) {
	const courseBase = useCourseManagementPath();
	const { t } = useLanguage();
	const router = useRouter();
	const { run, error, busy } = useLearningEdit(courseId);
	const [tab, setTab] = useState<Tab>('video');
	const [fileError, setFileError] = useState('');
	const [uploading, setUploading] = useState(false);

	const published = segment.status === 'published';
	const resources = tree.resources.filter((r) => r.segment_id === segment.id);
	const notes = tree.blocks.filter((b) => b.lesson_id === segment.lesson_id && ['text', 'heading', 'callout'].includes(b.block_type));
	const hasContent = Boolean(segment.description.replace(/<[^>]*>/g, '').trim()) || Boolean(segment.video_url) || Boolean(segment.video_asset_id) || resources.length > 0 || tree.blocks.some((b) => b.lesson_id === segment.lesson_id);
	const checks = [
		{ done: segment.title.trim().length > 0, label: t('teach.segment.ready.title') },
		{ done: hasContent, label: t('teach.segment.ready.content') },
	];
	const values = { title: segment.title, description: segment.description, status: segment.status as 'draft' | 'published', video_url: segment.video_url ?? '', video_asset_id: segment.video_asset_id, thumbnail_asset_id: segment.thumbnail_asset_id };
	const save = (patch: Partial<typeof values>) => run({ action: 'edit_segment', id: segment.id, parentId: null, updatedAt: segment.updated_at, data: { ...values, ...patch } }).then(() => undefined);

	async function upload(file: File, kind: 'video' | 'thumbnail' | 'resource') {
		setUploading(true);
		setFileError('');
		let uploadedId: string | null = null;
		try {
			const asset = await uploadLessonFile(courseId, file);
			uploadedId = asset.id;
			if (kind === 'thumbnail') await save({ thumbnail_asset_id: asset.id });
			else if (kind === 'video') await save({ video_url: '', video_asset_id: asset.id });
			else await run({ action: 'attach_resource', id: segment.id, parentId: null, updatedAt: segment.updated_at, data: { name: file.name, asset_id: asset.id } });
			router.refresh();
		} catch (e) {
			let note = '';
			if (uploadedId) {
				const cleaned = await fetch(`/api/learning/${courseId}/cleanup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uploadedId }) });
				note = cleaned.ok ? ` ${t('teach.upload.cleaned')}` : ` ${t('teach.upload.retained', { id: uploadedId })}`;
			}
			setFileError((e instanceof Error ? e.message : t('teach.upload.failed')) + note);
		} finally {
			setUploading(false);
		}
	}

	const toggle = (value: Tab, icon: React.ReactNode, label: string) => (
		<button
			type="button"
			role="tab"
			aria-selected={tab === value}
			onClick={() => setTab(value)}
			className={cn(
				'flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border-2 px-4 text-sm font-semibold transition-colors',
				FOCUS,
				tab === value ? 'border-black bg-slate-900 text-white shadow-hard-sm' : 'border-black bg-white text-slate-900 hover:bg-slate-100'
			)}
		>
			{icon}
			{label}
		</button>
	);

	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 pb-16 pt-2">
			<Link href={`${courseBase}/${courseId}?lesson=${segment.lesson_id}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-800 hover:text-black">
				<ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
				{t('teach.back_to_lesson')}
			</Link>

			{!published && <Notice tone="warning">{t('teach.segment.draft_notice')}</Notice>}
			{error && <Notice tone="danger">{error}</Notice>}

			<TeacherHeader
				pill={t('teach.segment.pill')}
				title={segment.title}
				subtitle={t('teach.completion', { done: checks.filter((c) => c.done).length, total: checks.length })}
				actions={
					<>
						<StatusPill published={published} />
						<Button asChild variant="outline" className="min-h-[44px]">
							<Link href={`${courseBase}/${courseId}/chapters/${segment.id}?preview=1`}>
								<Eye className="me-2 h-4 w-4" aria-hidden />
								{t('teach.preview_draft')}
							</Link>
						</Button>
						{published && (
							<Button asChild variant="outline" className="min-h-[44px]">
								<Link href={previewPartHref(courseId, segment.id)}>
									<PlayCircle className="me-2 h-4 w-4" aria-hidden />
									{t('teach.preview_as_student')}
								</Link>
							</Button>
						)}
						<PublishControl kind="segment" published={published} disabled={busy || uploading} blockedReason={hasContent ? undefined : t('teach.segment.publish_blocked')} onChange={(next) => save({ status: next ? 'published' : 'draft' })} />
					</>
				}
			>
				<ReadinessList className="mt-4" title={published ? t('teach.segment.ready.title_published') : t('teach.segment.ready.title_label')} items={checks} />
				<p className="mt-2 text-xs text-slate-700">{t('teach.preview_explain')}</p>
			</TeacherHeader>

			<SectionCard icon={<LayoutDashboard className="h-5 w-5" />} title={t('teach.segment.customize')} subtitle={t('teach.segment.customize_sub')}>
				<EditableField label={t('teach.segment.title_field')} required value={segment.title} base={segment.updated_at} draftScope={`segment:${segment.id}:title`} editLabel="teach.edit_title" placeholder={t('teach.segment.title_placeholder')} maxLength={200} onSave={(title) => save({ title })} />
				<EditableField label={t('teach.segment.description_field')} kind="rich" value={segment.description} base={segment.updated_at} draftScope={`segment:${segment.id}:description`} editLabel="teach.edit_description" addLabel="teach.add_description" emptyText="teach.segment.no_description" onSave={(description) => save({ description })} />
			</SectionCard>

			<SectionCard icon={<FileText className="h-5 w-5" />} title={t('teach.segment.content')} subtitle={t('teach.segment.content_sub')}>
				<div>
					<p id="content-type-label" className="mb-2 text-sm font-medium text-slate-900">
						{t('teach.segment.content_type')} <span className="font-bold text-red-700" aria-hidden>*</span>
					</p>
					<div role="tablist" aria-labelledby="content-type-label" className="flex flex-col gap-2 sm:flex-row">
						{toggle('video', <Video className="h-4 w-4" aria-hidden />, t('teach.segment.type_video'))}
						{toggle('homework', <ClipboardList className="h-4 w-4" aria-hidden />, t('teach.segment.type_homework'))}
					</div>
					<p className="mt-2 text-xs text-slate-700">{t('teach.segment.type_help')}</p>
				</div>

				{tab === 'video' && (
					<div className="space-y-4" role="tabpanel">
						<EditableField
							label={t('teach.video.field')}
							kind="text"
							value={segment.video_url ?? ''}
							base={segment.updated_at}
							draftScope={`segment:${segment.id}:video`}
							editLabel="teach.video.edit"
							addLabel="teach.video.add"
							emptyText="teach.video.none"
							placeholder="https://…"
							hint={t('teach.video.help')}
							validate={(value) => (lessonVideo.safeParse(value).success ? null : t('teach.video.invalid'))}
							display={
								segment.video_url ? (
									<VideoPreview url={segment.video_url} title={segment.title} />
								) : segment.video_asset_id ? (
									<p className="font-medium text-emerald-900">{t('teach.video.uploaded')}</p>
								) : (
									<p className="italic text-slate-700">{t('teach.video.none')}</p>
								)
							}
							onSave={(url) => save({ video_url: url, video_asset_id: null })}
						/>

						<FieldCard
							label={t('teach.resources.field')}
							action={
								<label className={cn('inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 border-black bg-white px-4 text-sm font-semibold shadow-hard-sm hover:bg-slate-100', FOCUS, (busy || uploading) && 'pointer-events-none opacity-50')}>
									<Paperclip className="me-2 h-4 w-4" aria-hidden />
									{t('teach.resources.add')}
									<input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy || uploading} aria-label={t('teach.resources.add')} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f, 'resource'); }} />
								</label>
							}
							hint={t('teach.resources.help')}
						>
							{resources.length === 0 && <p className="italic text-slate-700">{t('teach.resources.none')}</p>}
							<ul className="space-y-2">
								{resources.map((r) => (
									<li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-400 bg-white p-3">
										<a target="_blank" rel="noreferrer" href={`/api/learning/${courseId}/resources/${r.id}`} dir="auto" className={cn('min-w-0 truncate text-sm font-semibold underline-offset-2 hover:underline', FOCUS)}>
											{r.name}
										</a>
										<Button type="button" variant="outline" size="sm" className="min-h-[44px] border-red-700 text-red-800" disabled={busy || uploading} onClick={() => void run({ action: 'remove_resource', id: segment.id, parentId: null, updatedAt: segment.updated_at, data: { resource_id: r.id } }).catch(() => {})}>
											<Trash2 className="me-1.5 h-4 w-4" aria-hidden />
											{t('teach.resources.detach')}
										</Button>
									</li>
								))}
							</ul>
						</FieldCard>

						<details className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
							<summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-900">
								<Settings2 className="h-4 w-4" aria-hidden />
								{t('teach.upload.advanced')}
								<span className="text-xs font-normal text-slate-700">{t('teach.upload.advanced_sub')}</span>
							</summary>
							<div className="mt-4 space-y-4">
								<label className="block text-sm font-semibold">
									{t('teach.upload.mp4')}
									<Input type="file" accept="video/mp4" disabled={busy || uploading} className="mt-1 min-h-[44px]" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f, 'video'); }} />
								</label>
								{segment.video_asset_id && <p className="text-xs font-medium text-emerald-900">{t('teach.video.uploaded')}</p>}
								<label className="block text-sm font-semibold">
									{t('teach.upload.thumbnail')}
									<Input aria-label={t('teach.upload.thumbnail')} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || uploading} className="mt-1 min-h-[44px]" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f, 'thumbnail'); }} />
								</label>
								{thumbnailUrl && <Image unoptimized width={640} height={360} src={thumbnailUrl} alt={t('teach.upload.thumbnail_alt', { title: segment.title })} className="aspect-video w-full max-w-md rounded-xl border-2 border-black object-cover" />}
								{segment.thumbnail_asset_id && (
									<Button type="button" variant="outline" className="min-h-[44px]" disabled={busy || uploading} onClick={() => void save({ thumbnail_asset_id: null }).catch(() => {})}>
										{t('teach.upload.remove_thumbnail')}
									</Button>
								)}
								{uploading && <p role="status" className="text-sm font-medium">{t('teach.upload.uploading')}</p>}
								{fileError && <Notice tone="danger">{fileError}</Notice>}
							</div>
						</details>
					</div>
				)}

				{tab === 'homework' && (
					<div role="tabpanel" className="space-y-3">
						<Notice tone="info">{t('teach.homework.note')}</Notice>
						<HomeworkAssignments courseId={courseId} lessonId={segment.lesson_id} segmentId={segment.id} teacher />
					</div>
				)}
			</SectionCard>

			{notes.map((b) => {
				const content = b.content && typeof b.content === 'object' && !Array.isArray(b.content) ? b.content : {};
				const text = typeof content.text === 'string' ? content.text : typeof content.html === 'string' ? content.html : '';
				return (
					<SectionCard key={b.id + b.updated_at} icon={<FileText className="h-5 w-5" />} title={t('teach.notes.title')} subtitle={t('teach.notes.sub')}>
						<EditableField label={t('teach.notes.field')} kind="rich" value={text} base={b.updated_at} draftScope={`block:${b.id}`} editLabel="teach.edit_description" addLabel="teach.add_description" onSave={(value) => run({ action: 'edit_block', id: b.id, parentId: null, updatedAt: b.updated_at, data: { text: value } })} />
					</SectionCard>
				);
			})}
		</div>
	);
}
