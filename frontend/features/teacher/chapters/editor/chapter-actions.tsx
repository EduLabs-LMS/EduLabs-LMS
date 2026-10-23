'use client';

import ConfirmModal from '@/frontend/components/modals/confirm-modal';
import { Button } from '@/frontend/components/ui/button';
import { api } from '@/frontend/lib/api';
import { Trash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChapterActionsProps {
	disabled: boolean;
	courseId: string;
	chapterId: string;
	isPublished: boolean;
}

const ChapterActions = ({
	disabled,
	courseId,
	chapterId,
	isPublished,
}: ChapterActionsProps) => {
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(false);
	const { startLoading, stopLoading } = useGlobalLoading();

	const onClick = async () => {
		try {
			setIsLoading(true);
			startLoading();

			if (isPublished) {
				await api.patch(
					`/api/courses/${courseId}/chapters/${chapterId}/unpublish`
				);

				toast.success('Lesson segment unpublished');
			} else {
				await api.patch(
					`/api/courses/${courseId}/chapters/${chapterId}/publish`
				);

				toast.success('Lesson segment published');
			}

			router.refresh();
		} catch {
			toast.error('Something went wrong');
		} finally {
			setIsLoading(false);
			stopLoading();
		}
	};

	const onDelete = async () => {
		try {
			setIsLoading(true);
			startLoading();

			await api.delete(`/api/courses/${courseId}/chapters/${chapterId}`);

			toast.success('Lesson segment deleted');

			router.refresh();
			router.push(`/teacher/courses/${courseId}`);
		} catch {
			toast.error('Something went wrong');
		} finally {
			setIsLoading(false);
			stopLoading();
		}
	};

	return (
		<div className="flex items-center gap-x-2">
			<Button
				onClick={onClick}
				disabled={disabled || isLoading}
				variant={'outline'}
				size={'sm'}
			>
				{isPublished ? 'Unpublish' : 'Publish'}
			</Button>

			<ConfirmModal onConfirm={onDelete}>
				<Button size={'sm'} disabled={isLoading}>
					<Trash className="w-4 h-4" />
				</Button>
			</ConfirmModal>
		</div>
	);
};

export default ChapterActions;
