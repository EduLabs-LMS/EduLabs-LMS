'use client';

import * as z from 'zod';
import { api } from '@/frontend/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from '@/frontend/components/ui/form';
import { Button } from '@/frontend/components/ui/button';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { cn } from '@/shared/utils';
import type { Chapter } from '@/shared/contracts/courses';
import { Editor } from '@/frontend/components/editor';
import { Preview } from '@/frontend/components/preview';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChapterDescriptionFormProps {
	initialData: Chapter;
	courseId: string;
	chapterId: string;
}

const formSchema = z.object({
	description: z.string().min(1),
});

const ChapterDescriptionForm = ({
	initialData,
	courseId,
	chapterId,
}: ChapterDescriptionFormProps) => {
	const [isEditing, setIsEditing] = useState(false);

	const toggleEdit = () => setIsEditing((prev) => !prev);

	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			description: initialData.description || '',
		},
	});

	const { isSubmitting, isValid } = form.formState;

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		startLoading();

		try {
			await api.patch(
				`/api/courses/${courseId}/chapters/${chapterId}`,
				values
			);

			toast.success('Lesson segment updated');
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
				Segment description
				<Button variant={'ghost'} onClick={toggleEdit}>
					{isEditing ? (
						<>Cancel</>
					) : (
						<>
							<Pencil className="h-4 w-4 mr-2" />
							Edit description
						</>
					)}
				</Button>
			</div>

			{!isEditing && (
				<div
					className={cn(
						'text-sm mt-2',
						!initialData.description && 'text-slate-500 italic'
					)}
				>
					{!initialData.description && 'No description'}

					{initialData.description && (
						<Preview value={initialData.description} />
					)}
				</div>
			)}

			{isEditing && (
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-4 mt-4"
					>
						<FormField
							control={form.control}
							name="description"
							render={({ field }) => (
								<FormItem>
									<FormControl>
										<Editor {...field} />
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex items-center gap-x-2">
							<Button disabled={!isValid || isSubmitting} type="submit">
								Save
							</Button>
						</div>
					</form>
				</Form>
			)}
		</div>
	);
};

export default ChapterDescriptionForm;
