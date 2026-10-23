'use client';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { api } from '@/frontend/lib/api';
import { Pencil, PlusCircle, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { getEmbeddableVideoUrl } from '@/shared/video-embed';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChapterSolutionVideoFormProps {
	initialData: { solutionVideoUrl: string | null };
	courseId: string;
	chapterId: string;
}

const ChapterSolutionVideoForm = ({
	initialData,
	courseId,
	chapterId,
}: ChapterSolutionVideoFormProps) => {
	const router = useRouter();
	const [isEditing, setIsEditing] = useState(false);
	const [solutionVideoUrl, setSolutionVideoUrl] = useState(
		initialData.solutionVideoUrl ?? ''
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const { startLoading, stopLoading } = useGlobalLoading();
	const embedUrl = getEmbeddableVideoUrl(initialData.solutionVideoUrl);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (!getEmbeddableVideoUrl(solutionVideoUrl)) {
			toast.error('Enter a valid YouTube or Google Drive video link.');
			return;
		}

		startLoading();

		try {
			setIsSubmitting(true);
			await api.patch(`/api/courses/${courseId}/chapters/${chapterId}`, {
				solutionVideoUrl,
			});
			toast.success('Homework solution link updated');
			setIsEditing(false);
			router.refresh();
		} catch {
			toast.error('The solution video link could not be saved. Please try again.');
		} finally {
			setIsSubmitting(false);
			stopLoading();
		}
	};

	return (
		<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 transition-colors">
			<div className="flex items-center justify-between font-medium text-slate-900 text-sm">
				Solution Video Link
				<Button onClick={() => setIsEditing((value) => !value)} variant="ghost">
					{isEditing ? (
						'Cancel'
					) : initialData.solutionVideoUrl ? (
						<>
							<Pencil className="mr-2 h-4 w-4" />
							Edit solution link
						</>
					) : (
						<>
							<PlusCircle className="mr-2 h-4 w-4" />
							Add solution link
						</>
					)}
				</Button>
			</div>

			{!isEditing &&
				(initialData.solutionVideoUrl && embedUrl ? (
					<iframe
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowFullScreen
						className="mt-3 aspect-video w-full rounded-md border"
						src={embedUrl}
						title="Homework solution video"
					/>
				) : (
					<div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-physics-cyan/20 bg-physics-panel">
						<Video className="h-10 w-10 text-physics-muted" />
					</div>
				))}

			{isEditing && (
				<form className="mt-4 space-y-3" onSubmit={onSubmit}>
					<Input
						disabled={isSubmitting}
						onChange={(event) => setSolutionVideoUrl(event.target.value)}
						placeholder="Paste a YouTube embed/watch or Google Drive preview link"
						type="url"
						value={solutionVideoUrl}
					/>
					<Button disabled={isSubmitting || !solutionVideoUrl.trim()} type="submit">
						Save solution link
					</Button>
					<p className="text-xs text-muted-foreground">
						Students can view this video only after submitting their homework.
					</p>
				</form>
			)}
		</div>
	);
};

export default ChapterSolutionVideoForm;
