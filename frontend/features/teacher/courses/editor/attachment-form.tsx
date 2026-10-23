'use client';

import * as z from 'zod';
import { api } from '@/frontend/lib/api';
import { File, Loader2, PlusCircle, X } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import type { Attachment, Course } from '@/shared/contracts/courses';

import { Button } from '@/frontend/components/ui/button';
import FileUpload from '@/frontend/components/file-upload';

interface AttachmentFormProps {
	initialData: Course & { attachments: Attachment[] };
	courseId: string;
}

const formSchema = z.object({
	url: z.string().min(1),
	fileSize: z.number().optional(),
	fileKey: z.string().optional(),
});

const AttachmentForm = ({ initialData, courseId }: AttachmentFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const toggleEdit = () => setIsEditing((prev) => !prev);

	const router = useRouter();

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		try {
			await api.post(`/api/courses/${courseId}/attachments`, values);

			toast.success('Course updated');
			toggleEdit();
			router.refresh();
		} catch (error) {
			toast.error('Something went wrong');
		}
	};

	const onDelete = async (id: string) => {
		setDeletingId(id);

		try {
			await api.delete(`/api/courses/${courseId}/attachments/${id}`);

			toast.success('Attachment deleted');
			router.refresh();
		} catch (error) {
			toast.error('Something went wrong');
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<div className="mt-6 border bg-slate-100 rounded-md p-4">
			<div className="font-medium flex items-center justify-between">
				Course attachments
				<Button variant={'ghost'} onClick={toggleEdit}>
					{isEditing && <>Cancel</>}

					{!isEditing && (
						<>
							<PlusCircle className="h-4 w-4 mr-2" />
							Add an file
						</>
					)}
				</Button>
			</div>

			{!isEditing && (
				<>
					{initialData.attachments.length === 0 && (
						<p className="text-sm text-slate-500 mt-2 italic">
							No attachments added
						</p>
					)}

					{initialData.attachments.length > 0 && (
						<div className="space-y-2">
							{initialData.attachments.map((attachment) => (
								<div
									key={attachment.id}
									className="flex items-center p-3 w-full bg-green-100 border-slate-300 border text-green-900 rounded-md"
								>
									<File className="h-4 w-4 mr-2 flex-shrink-0" />

									<p className="text-xs line-clamp-1">{attachment.name}</p>

									{deletingId === attachment.id && (
										<div className="ml-auto">
											<Loader2 className="h-4 w-4 animate-spin" />
										</div>
									)}

									{deletingId !== attachment.id && (
										<button
											onClick={() => onDelete(attachment.id)}
											className="ml-auto hover:opacity-75 transition"
										>
											<X className="h-4 w-4" />
										</button>
									)}
								</div>
							))}
						</div>
					)}
				</>
			)}

			{isEditing && (
				<div>
					<FileUpload
						endpoint="courseAttachment"
						onChange={(url?: string, metadata?: { size?: number; key?: string; name?: string }) => {
							if (url) {
								onSubmit({ url, fileSize: metadata?.size, fileKey: metadata?.key });
							}
						}}
					/>

					<div className="text-xs text-muted-foreground mt-4">
						Add anything that will help your students learn better.
					</div>
				</div>
			)}
		</div>
	);
};

export default AttachmentForm;
