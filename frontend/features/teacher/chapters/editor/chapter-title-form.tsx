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
import { Input } from '@/frontend/components/ui/input';
import { Button } from '@/frontend/components/ui/button';
import { Pencil } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

interface ChapterTitleFormProps {
	initialData: {
		title: string;
	};
	courseId: string;
	chapterId: string;
}

const formSchema = z.object({
	title: z.string().min(1),
});

const ChapterTitleForm = ({
	initialData,
	courseId,
	chapterId,
}: ChapterTitleFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [title, setTitle] = useState(initialData.title);
	const [isRefreshPending, startTransition] = useTransition();

	const toggleEdit = () => setIsEditing((prev) => !prev);

	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: initialData,
	});

	const { isSubmitting, isValid } = form.formState;

	useEffect(() => {
		setTitle(initialData.title);
	}, [initialData.title]);

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		const previousTitle = title;
		setTitle(values.title);
		setIsEditing(false);

		startLoading();

		try {
			await api.patch(
				`/api/courses/${courseId}/chapters/${chapterId}`,
				values
			);

			toast.success('Lesson segment updated');
			startTransition(() => router.refresh());
		} catch (error) {
			setTitle(previousTitle);
			setIsEditing(true);
			toast.error('Something went wrong');
		} finally {
			stopLoading();
		}
	};

	return (
		<div className="rounded-xl border-2 border-black bg-slate-50/70 p-4 transition-colors">
			<div className="font-medium flex items-center justify-between text-slate-900 text-sm">
				<span>
					Segment title <span className="text-red-500 font-bold">*</span>
				</span>
				<Button variant={'ghost'} onClick={toggleEdit}>
					{isEditing ? (
						<>Cancel</>
					) : (
						<>
							<Pencil className="h-4 w-4 mr-2" />
							Edit title
						</>
					)}
				</Button>
			</div>

			{!isEditing && <p className="text-sm mt-2">{title}</p>}

			{isEditing && (
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
									<FormControl>
										<Input
											disabled={isSubmitting || isRefreshPending}
										placeholder={"e.g. 'Practice problems'"}
											{...field}
										/>
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex items-center gap-x-2">
								<Button
									disabled={!isValid || isSubmitting || isRefreshPending}
									type="submit"
								>
									Save
							</Button>
						</div>
					</form>
				</Form>
			)}
		</div>
	);
};

export default ChapterTitleForm;
