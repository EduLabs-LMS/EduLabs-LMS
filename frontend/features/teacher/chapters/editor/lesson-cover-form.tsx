'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ImageIcon, PlusCircle, Trash2, Upload } from 'lucide-react';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { FOCUS, Spinner } from '@/frontend/features/teacher/ui/teacher-ui';
import { uploadLessonFile } from '@/frontend/lib/lesson-upload';
import type { LearningLesson } from '@/shared/contracts/lessons';
import { cn } from '@/shared/utils';

export function LessonCoverForm({ courseId, lesson }: { courseId: string; lesson: LearningLesson }) {
	const { t } = useLanguage();
	const router = useRouter();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [url, setUrl] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [previewLoading, setPreviewLoading] = useState(Boolean(lesson.cover_asset_id));

	useEffect(() => {
		let alive = true;
		setUrl(null);
		setPreviewLoading(Boolean(lesson.cover_asset_id));
		if (lesson.cover_asset_id) {
			void fetch(`/api/learning/${courseId}/media`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: lesson.cover_asset_id }),
			})
				.then(async (r) => {
					const v = await r.json();
					if (!r.ok) throw new Error(v.error || 'Cover unavailable');
					if (alive) setUrl(v.url);
				})
				.catch((e) => {
					if (alive) setError(e.message);
				})
				.finally(() => {
					if (alive) setPreviewLoading(false);
				});
		}
		return () => {
			alive = false;
		};
	}, [courseId, lesson.cover_asset_id]);

	async function cleanup(id: string) {
		const r = await fetch(`/api/learning/${courseId}/cleanup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		});
		return r.ok;
	}

	async function save(file: File | null) {
		setBusy(true);
		setError('');
		let uploaded: string | null = null;
		let attached = false;
		try {
			if (file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
				throw new Error('Choose a PNG, JPEG or WebP image.');
			}
			if (file) {
				const asset = await uploadLessonFile(courseId, file);
				uploaded = asset.id;
			}
			const response = await fetch(`/api/learning/${courseId}/edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'set_lesson_cover',
					id: lesson.id,
					parentId: null,
					updatedAt: lesson.updated_at,
					data: { cover_asset_id: uploaded },
				}),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Cover could not be saved');
			attached = true;
			if (lesson.cover_asset_id && lesson.cover_asset_id !== uploaded && !(await cleanup(lesson.cover_asset_id))) {
				setError('Cover saved. The previous asset is shared or owned by another uploader and remains protected for trusted maintenance.');
			}
			router.refresh();
		} catch (e) {
			let note = '';
			if (uploaded && !attached && !(await cleanup(uploaded))) {
				note = ` Unattached asset ${uploaded} retained for trusted cleanup.`;
			}
			setError((e instanceof Error ? e.message : 'Cover could not be saved') + note);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-3">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="sr-only"
				disabled={busy}
				aria-label={t(url ? 'teach.lesson.image_action_edit' : 'teach.lesson.image_action_add')}
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = '';
					if (file) void save(file);
				}}
			/>

			{previewLoading ? (
				<div className="flex aspect-video w-full items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-100">
					<Spinner label="Loading cover preview…" />
				</div>
			) : url ? (
				<div className="space-y-2">
					<Image
						unoptimized
						width={640}
						height={360}
						src={url}
						alt={`${lesson.title} lesson cover`}
						className="aspect-video w-full rounded-2xl border-2 border-black object-cover"
						onError={() => {
							setUrl(null);
							setError('Cover preview unavailable. Refresh to renew access.');
						}}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							className="min-h-[44px]"
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload className="me-2 h-4 w-4" aria-hidden />
							{t('teach.lesson.image_action_edit')}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							className="min-h-[44px] border-red-700 text-red-800"
							onClick={() => void save(null)}
						>
							<Trash2 className="me-2 h-4 w-4" aria-hidden />
							Remove image
						</Button>
					</div>
				</div>
			) : (
				<button
					type="button"
					disabled={busy}
					onClick={() => fileInputRef.current?.click()}
					className={cn(
						'flex aspect-video w-full cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-400 bg-[#edf3ec] transition-colors hover:bg-[#e4ece3] dark:border-slate-600 dark:bg-slate-800',
						FOCUS
					)}
					aria-label={t('teach.lesson.image_action_add')}
				>
					<ImageIcon className="h-12 w-12 text-slate-500" aria-hidden />
				</button>
			)}

			{busy && <Spinner label="Saving lesson cover…" />}
			{error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
		</div>
	);
}
