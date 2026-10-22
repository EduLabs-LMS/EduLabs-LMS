'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, Layers, LayoutDashboard, Settings2 } from 'lucide-react';

import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { useLanguage } from '@/frontend/components/language-provider';
import { CapabilityGate } from '@/frontend/components/capability-gate';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { CourseStages } from '@/frontend/features/teacher/academics/course-stages';
import { CurriculumPanel } from '@/frontend/features/teacher/chapters/curriculum-panel';
import ImageForm from './editor/image-form';
import { EditableField } from '@/frontend/features/teacher/ui/editable-field';
import { PublishControl } from '@/frontend/features/teacher/ui/publish-control';
import { Notice, ReadinessList, SectionCard, StatusPill, TeacherHeader } from '@/frontend/features/teacher/ui/teacher-ui';
import { previewCourseHref } from '@/shared/student-preview';
import type { LearningTree } from '@/shared/contracts/lessons';

type Record = { id: string; organization_id: string; title: string; description: string | null; slug: string; status: string; visibility: string; updated_at: string };

export function V2TeacherCourseEditor({ record, tree }: { record: Record; tree: LearningTree }) {
	const courseBase = useCourseManagementPath();
	const { t } = useLanguage();
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const published = record.status === 'published';

	async function save(fields: { title?: string; description?: string; status?: string; slug?: string; visibility?: string }) {
		if (busy) throw new Error(t('teach.wait_for_save'));
		setBusy(true);
		try {
			const response = await fetch('/api/teacher/courses/' + record.id, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...fields, updated_at: record.updated_at }),
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(result.error || t('teach.course.save_failed'));
			router.refresh();
		} finally {
			setBusy(false);
		}
	}

	const hasTitle = record.title.trim().length > 0;
	const publishedLessons = tree.lessons.filter((l) => l.status === 'published').length;
	const readiness = [
		{ done: hasTitle, label: t('teach.course.ready.title') },
		{ done: tree.modules.length > 0, label: t('teach.course.ready.chapter') },
		{ done: publishedLessons > 0, label: t('teach.course.ready.lesson') },
	];

	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 pb-16 pt-2">
			<Link href={courseBase} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-800 hover:text-black">
				<ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
				{t('teach.back_to_courses')}
			</Link>

			{!published && <Notice tone="warning">{t('teach.course.draft_notice')}</Notice>}

			<TeacherHeader
				pill={t('teach.course.pill')}
				title={record.title || t('teach.course.untitled')}
				subtitle={t('teach.course.subtitle')}
				actions={
					<>
						<StatusPill published={published} />
						<Button asChild variant="outline" className="min-h-[44px]">
							<Link href={previewCourseHref(record.id)}>
								<Eye className="me-2 h-4 w-4" aria-hidden />
								{t('teach.preview_as_student')}
							</Link>
						</Button>
						<PublishControl kind="course" published={published} disabled={busy || !hasTitle} onChange={(next) => save({ status: next ? 'published' : 'draft' })} />
					</>
				}
			>
				<ReadinessList className="mt-4" title={t('teach.course.ready.title_label')} items={readiness} />
				<p className="mt-2 text-xs text-slate-700">{t('teach.course.ready.note')}</p>
			</TeacherHeader>

			<SectionCard icon={<LayoutDashboard className="h-5 w-5" />} title={t('teach.course.details')} subtitle={t('teach.course.details_sub')}>
				<EditableField label={t('teach.course.title_label')} required value={record.title} base={record.updated_at} draftScope={`course:${record.id}:title`} editLabel="teach.edit_title" placeholder={t('teach.course.title_placeholder')} maxLength={200} onSave={(title) => save({ title })} />
				<EditableField label={t('teach.course.description_label')} kind="rich" value={record.description ?? ''} base={record.updated_at} draftScope={`course:${record.id}:description`} editLabel="teach.edit_description" addLabel="teach.add_description" emptyText="teach.course.no_description" onSave={(description) => save({ description })} />
				<CapabilityGate reason="Course cover uploads require a Storage/media adapter.">
					<ImageForm initialData={{ imageUrl: null }} courseId={record.id} />
				</CapabilityGate>
				<details className="group rounded-2xl border border-slate-300 bg-slate-50 p-4">
					<summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-900">
						<Settings2 className="h-4 w-4" aria-hidden />
						{t('teach.course.advanced')}
						<span className="text-xs font-normal text-slate-700">{t('teach.course.advanced_sub')}</span>
					</summary>
					<div className="mt-4 space-y-4">
						<CourseStages courseId={record.id} organizationId={record.organization_id} />
						<CourseMetadata course={record} save={save} busy={busy} />
					</div>
				</details>
			</SectionCard>

			<SectionCard icon={<Layers className="h-5 w-5" />} title={t('teach.curriculum.title')} subtitle={t('teach.curriculum.subtitle')}>
				<CurriculumPanel courseId={record.id} tree={tree} courseBase={courseBase} />
			</SectionCard>
		</div>
	);
}

function CourseMetadata({ course, save, busy }: { course: Record; save: (fields: { slug: string; visibility: string; status: string }) => Promise<void>; busy: boolean }) {
	const { t } = useLanguage();
	const [slug, setSlug] = useState(course.slug);
	const [visibility, setVisibility] = useState(course.visibility);
	const [status, setStatus] = useState(course.status);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
	const dirty = slug !== course.slug || visibility !== course.visibility || status !== course.status;
	const select = 'mt-1 block min-h-[44px] w-full rounded-xl border-2 border-black bg-white px-3 text-sm font-medium';
	return (
		<form
			className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setError('');
				setSaved(false);
				try {
					await save({ slug, visibility, status });
					setSaved(true);
				} catch (e) {
					setError(e instanceof Error ? e.message : t('teach.course.save_failed'));
				}
			}}
		>
			<p className="text-xs text-slate-700">{t('teach.course.metadata_help')}</p>
			<label className="block text-sm font-medium">
				{t('teach.course.slug')}
				<Input required dir="ltr" value={slug} maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={busy} className="mt-1 min-h-[44px]" onChange={(event) => setSlug(event.target.value)} />
			</label>
			<label className="block text-sm font-medium">
				{t('teach.course.visibility')}
				<select aria-label="Course visibility" className={select} disabled={busy} value={visibility} onChange={(event) => setVisibility(event.target.value)}>
					{['private', 'unlisted', 'public'].map((v) => (
						<option key={v} value={v}>
							{t(`teach.visibility.${v}` as 'teach.visibility.private')}
						</option>
					))}
				</select>
			</label>
			<label className="block text-sm font-medium">
				{t('teach.course.status')}
				<select aria-label="Course status" className={select} disabled={busy} value={status} onChange={(event) => setStatus(event.target.value)}>
					{['draft', 'published', 'archived'].map((v) => (
						<option key={v} value={v}>
							{t(`teach.course_status.${v}` as 'teach.course_status.draft')}
						</option>
					))}
				</select>
			</label>
			{error && <Notice tone="danger">{error}</Notice>}
			{saved && !dirty && <Notice tone="success">{t('teach.saved')}</Notice>}
			<Button type="submit" className="min-h-[44px]" disabled={busy || !dirty}>
				{t('teach.course.save_metadata')}
			</Button>
		</form>
	);
}
