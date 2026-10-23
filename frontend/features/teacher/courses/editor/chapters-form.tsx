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
	FormLabel,
	FormMessage,
} from '@/frontend/components/ui/form';
import { Button } from '@/frontend/components/ui/button';
import { Loader2, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { cn } from '@/shared/utils';
import type { Chapter, Course } from '@/shared/contracts/courses';
import { Input } from '@/frontend/components/ui/input';
import { ChaptersList } from '@/frontend/features/teacher/courses/editor/chapters-list';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChaptersFormProps {
	initialData: { chapters: Chapter[] };
	courseId: string;
}

const formSchema = z.object({
	title: z.string().min(1),
});

const ChaptersForm = ({ initialData, courseId }: ChaptersFormProps) => {
	const [isCreating, setIsCreating] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);

	const toggleCreating = () => setIsCreating((prev) => !prev);

	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			title: '',
		},
	});

	const { isSubmitting, isValid } = form.formState;

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		startLoading();

		try {
			await api.post(`/api/courses/${courseId}/chapters`, values);

			toast.success('Lesson segment created');
			toggleCreating();
			router.refresh();
		} catch (error) {
			toast.error('Something went wrong');
		} finally {
			stopLoading();
		}
	};

	const onReorder = async (updateData: { id: string; position: number }[]) => {
		startLoading();

		try {
			setIsUpdating(true);

			await api.put(`/api/courses/${courseId}/chapters/reorder`, {
				list: updateData,
			});

			toast.success('Lesson segments reordered');
			router.refresh();
		} catch {
			toast.error('Something went wrong');
		} finally {
			setIsUpdating(false);
			stopLoading();
		}
	};

	const onEdit = (id: string) => {
		router.push(`/teacher/courses/${courseId}/chapters/${id}`);
	};

	return (
		<div className="relative rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition-colors">
			{isUpdating && (
				<div className="absolute h-full w-full bg-slate-500/20 top-0 right-0 rounded-xl flex items-center justify-center">
					<Loader2 className="animate-spin h-6 w-6 text-sky-700" />
				</div>
			)}

			<div className="font-medium flex items-center justify-between text-slate-900 text-sm">
				Lesson segments
				<Button variant={'ghost'} onClick={toggleCreating}>
					{isCreating ? (
						<>Cancel</>
					) : (
						<>
							<PlusCircle className="h-4 w-4 mr-2" />
							Add a segment
						</>
					)}
				</Button>
			</div>

			{isCreating && (
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-4 mt-4"
					>
						<FormField
							control={form.control}
							name="title"
							render={({ field }) => (
							<FormItem>
								<FormLabel>
									Segment name <span className="text-red-600">*</span>
								</FormLabel>
								<FormControl>
									<Input
										disabled={isSubmitting}
										placeholder={"e.g. 'Ohm’s law practice'"}
											{...field}
										/>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>

						<Button disabled={!isValid || isSubmitting} type="submit">
							Create
						</Button>
					</form>
				</Form>
			)}

			{!isCreating && (
				<>
					<div
						className={cn(
							'text-sm mt-2',
							!initialData.chapters.length && 'text-slate-500 italic'
						)}
					>
						{!initialData.chapters.length && 'No lesson segments yet'}
						<ChaptersList
							onEdit={onEdit}
							onReorder={onReorder}
							items={initialData.chapters || []}
						/>
					</div>

					<p className="text-xs text-muted-foreground mt-4">
						Drag and drop to reorder lesson segments
					</p>
				</>
			)}
		</div>
	);
};

export default ChaptersForm;
