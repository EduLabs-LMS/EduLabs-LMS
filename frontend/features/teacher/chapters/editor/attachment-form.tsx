'use client';

import { api } from '@/frontend/lib/api';
import type { Attachment, Chapter } from '@/shared/contracts/courses';
import { File, Loader2, PlusCircle, X } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import FileUpload from '@/frontend/components/file-upload';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface AttachmentFormProps {
	initialData: Chapter & { attachments: Attachment[] };
	courseId: string;
	chapterId: string;
}

const AttachmentForm = ({
	initialData,
	courseId,
	chapterId,
}: AttachmentFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();

	const onUploadComplete = async (
		url?: string,
		metadata?: { size?: number; key?: string; name?: string }
	) => {
		if (!url) return;

		startLoading();

		try {
			await api.post(`/api/courses/${courseId}/attachments`, {
				url,
				chapterId,
				fileSize: metadata?.size,
				fileKey: metadata?.key,
			});
			toast.success('Lesson resource added');
			setIsEditing(false);
			router.refresh();
		} catch {
			toast.error('The resource could not be added. Please try again.');
		} finally {
			stopLoading();
		}
	};

	const onDelete = async (id: string) => {
		setDeletingId(id);
		startLoading();

		try {
			await api.delete(`/api/courses/${courseId}/attachments/${id}`);
			toast.success('Resource deleted');
			router.refresh();
		} catch {
			toast.error('The resource could not be deleted. Please try again.');
		} finally {
			setDeletingId(null);
			stopLoading();
		}
	};

	return (
		<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 transition-colors">
			<div className="flex items-center justify-between font-medium text-slate-900 text-sm">
				Optional Resources / Attachments
				<Button onClick={() => setIsEditing((value) => !value)} variant="ghost">
					{isEditing ? 'Cancel' : <><PlusCircle className="mr-2 h-4 w-4" />Add resource</>}
				</Button>
			</div>

			{!isEditing && (
				<>
					{initialData.attachments.length === 0 ? (
						<p className="mt-2 text-sm italic text-slate-500">
							No lesson resources added
						</p>
					) : (
						<div className="mt-3 space-y-2">
							{initialData.attachments.map((attachment) => (
								<div
									className="flex w-full items-center rounded-md border border-slate-300 bg-green-100 p-3 text-green-900"
									key={attachment.id}
								>
									<File className="mr-2 h-4 w-4 shrink-0" />
									<p className="line-clamp-1 text-xs">{attachment.name}</p>
									{deletingId === attachment.id ? (
										<Loader2 className="ml-auto h-4 w-4 animate-spin" />
									) : (
										<button
											aria-label={`Delete ${attachment.name}`}
											className="ml-auto transition hover:opacity-75"
											onClick={() => onDelete(attachment.id)}
											type="button"
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
				<div className="mt-4">
					<FileUpload endpoint="courseAttachment" onChange={onUploadComplete} />
					<p className="mt-4 text-xs text-muted-foreground">
						Upload optional PDF notes, summary sheets, formula sheets, or other reference documents.
					</p>
				</div>
			)}
		</div>
	);
};

export default AttachmentForm;
