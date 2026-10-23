'use client';

import { api } from '@/frontend/lib/api';
import { Pencil, PlusCircle, Video } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import type { Chapter } from '@/shared/contracts/courses';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { getEmbeddableVideoUrl } from '@/shared/video-embed';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChapterVideoFormProps {
	initialData: Chapter;
	courseId: string;
	chapterId: string;
}

const ChapterVideoForm = ({
	initialData,
	courseId,
	chapterId,
}: ChapterVideoFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [videoUrl, setVideoUrl] = useState(initialData.videoUrl ?? '');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const toggleEdit = () => setIsEditing((prev) => !prev);

	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const embedUrl = getEmbeddableVideoUrl(initialData.videoUrl);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (!getEmbeddableVideoUrl(videoUrl)) {
			toast.error('Enter a valid YouTube or Google Drive video link.');
			return;
		}

		startLoading();

		try {
			setIsSubmitting(true);
			await api.patch(
				`/api/courses/${courseId}/chapters/${chapterId}`,
				{ videoUrl }
			);

			toast.success('Video explanation updated');
			toggleEdit();
			router.refresh();
		} catch {
			toast.error('Something went wrong');
		} finally {
			setIsSubmitting(false);
			stopLoading();
		}
	};

	return (
		<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 transition-colors">
			<div className="font-medium flex items-center justify-between text-slate-900 text-sm">
				Video Explanation Link
				<Button variant={'ghost'} onClick={toggleEdit}>
					{isEditing && <>Cancel</>}

					{!isEditing && !initialData.videoUrl && (
						<>
							<PlusCircle className="h-4 w-4 mr-2" />
							Add video link
						</>
					)}

					{!isEditing && initialData.videoUrl && (
						<>
							<Pencil className="h-4 w-4 mr-2" />
							Edit video link
						</>
					)}
				</Button>
			</div>

			{!isEditing &&
				(!initialData.videoUrl ? (
					<div className="flex items-center justify-center h-60 bg-slate-200 rounded-md">
						<Video className="h-10 w-10 text-slate-500" />
					</div>
				) : embedUrl ? (
					<iframe
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowFullScreen
						className="mt-2 aspect-video w-full rounded-md border"
						src={embedUrl}
						title="Video explanation"
					/>
				) : (
					<div className="mt-2 flex h-60 items-center justify-center rounded-md bg-slate-200 text-sm text-slate-500">
						The saved video link cannot be previewed.
					</div>
				))}

			{isEditing && (
				<form className="mt-4 space-y-3" onSubmit={onSubmit}>
					<Input
						disabled={isSubmitting}
						onChange={(event) => setVideoUrl(event.target.value)}
						placeholder="Paste a YouTube embed/watch or Google Drive preview link"
						type="url"
						value={videoUrl}
					/>
					<Button disabled={isSubmitting || !videoUrl.trim()} type="submit">
						Save video link
					</Button>
					<p className="text-xs text-muted-foreground">
						Use a YouTube embed/watch link or a Google Drive preview link for this video explanation.
					</p>
				</form>
			)}
		</div>
	);
};

export default ChapterVideoForm;
