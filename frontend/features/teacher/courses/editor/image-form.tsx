'use client';

import * as z from 'zod';
import { api } from '@/frontend/lib/api';
import { ImageIcon, Pencil, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import type { Course } from '@/shared/contracts/courses';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { isValidImageUrl } from '@/shared/image-url';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ImageFormProps {
	initialData: Pick<Course, 'imageUrl'>;
	courseId: string;
}

const formSchema = z.object({
	imageUrl: z.string().min(1, {
		message: 'Image is required',
	}),
});

const ImageForm = ({ initialData, courseId }: ImageFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [urlInput, setUrlInput] = useState(initialData.imageUrl ?? '');

	const toggleEdit = () => setIsEditing((prev) => !prev);

	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		if (!isValidImageUrl(values.imageUrl)) {
			toast.error('Enter a full http(s) image link.');
			return;
		}
		startLoading();

		try {
			await api.patch(`/api/courses/${courseId}`, values);

			toast.success('Lesson updated');
			toggleEdit();
			router.refresh();
		} catch (error) {
			toast.error('Something went wrong');
		} finally {
			stopLoading();
		}
	};

	return (
		<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 transition-colors">
			<div className="font-medium flex items-center justify-between text-slate-900 text-sm">
				Lesson image
				<Button variant={'ghost'} onClick={toggleEdit}>
					{isEditing && <>Cancel</>}

					{!isEditing && !initialData.imageUrl && (
						<>
							<PlusCircle className="h-4 w-4 mr-2" />
							Add an image
						</>
					)}

					{!isEditing && initialData.imageUrl && (
						<>
							<Pencil className="h-4 w-4 mr-2" />
							Edit image
						</>
					)}
				</Button>
			</div>

			{!isEditing &&
				(!initialData.imageUrl ? (
					<div className="flex items-center justify-center h-60 bg-slate-200 rounded-md">
						<ImageIcon className="h-10 w-10 text-slate-500" />
					</div>
				) : (
					<div className="relative aspect-video mt-2">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							alt="Lesson cover"
							src={initialData.imageUrl}
							referrerPolicy="no-referrer"
							className="absolute inset-0 h-full w-full object-cover rounded-md"
						/>
					</div>
				))}

			{isEditing && (
				<div>
					<div className="mt-2 flex gap-2">
						<Input
							type="url"
							inputMode="url"
							placeholder="https://example.com/cover.jpg"
							value={urlInput}
							onChange={(event) => setUrlInput(event.target.value)}
						/>
						<Button
							type="button"
							disabled={!urlInput.trim()}
							onClick={() => onSubmit({ imageUrl: urlInput.trim() })}
						>
							Save
						</Button>
					</div>

					<div className="text-xs text-muted-foreground mt-4">
						Paste a web link to the image. 16:9 aspect ratio recommended
					</div>
				</div>
			)}
		</div>
	);
};

export default ImageForm;
