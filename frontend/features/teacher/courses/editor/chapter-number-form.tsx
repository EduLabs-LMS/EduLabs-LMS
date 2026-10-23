'use client';

import { Dropdown } from '@/frontend/components/ui/dropdown-select';
import * as z from 'zod';
import { api } from '@/frontend/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import type { Course } from '@/shared/contracts/courses';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

import { Button } from '@/frontend/components/ui/button';
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from '@/frontend/components/ui/form';

const chapterNumbers = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const formSchema = z.object({
	chapterNumber: z.coerce.number().int().min(1).max(8),
});

interface ChapterNumberFormProps {
	initialData: Course;
	courseId: string;
}

const ChapterNumberForm = ({
	initialData,
	courseId,
}: ChapterNumberFormProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [chapterNumber, setChapterNumber] = useState(initialData.chapterNumber);
	const [isRefreshPending, startTransition] = useTransition();
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			chapterNumber: initialData.chapterNumber ?? undefined,
		},
	});
	const { isSubmitting, isValid } = form.formState;

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		const previousChapterNumber = chapterNumber;

		setChapterNumber(values.chapterNumber);
		setIsEditing(false);

		startLoading();

		try {
			await api.patch(`/api/courses/${courseId}`, values);
			toast.success('Lesson chapter updated');
			startTransition(() => router.refresh());
		} catch {
			setChapterNumber(previousChapterNumber);
			setIsEditing(true);
			toast.error('Something went wrong');
		} finally {
			stopLoading();
		}
	};

	const selectedUnit = chapterNumber
		? `Chapter ${chapterNumber}`
		: 'No chapter selected';

	return (
		<div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition-colors">
			<div className="flex items-center justify-between font-medium text-slate-900 text-sm">
				<span>
					Chapter number <span className="text-red-500 font-bold">*</span>
				</span>
				<Button
					onClick={() => setIsEditing((value) => !value)}
					variant="ghost"
				>
					{isEditing ? (
						'Cancel'
					) : (
						<>
							<Pencil className="mr-2 h-4 w-4" />
							Select chapter
						</>
					)}
				</Button>
			</div>

			{!isEditing && <p className="mt-2 text-sm">{selectedUnit}</p>}

			{isEditing && (
				<Form {...form}>
					<form
						className="mt-4 space-y-4"
						onSubmit={form.handleSubmit(onSubmit)}
					>
						<FormField
							control={form.control}
							name="chapterNumber"
							render={({ field }) => (
								<FormItem>
									<FormControl>
									<Dropdown
										className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
										disabled={isSubmitting || isRefreshPending}
										value={field.value?.toString() ?? ''}
										onChange={(event) =>
											field.onChange(
												event.target.value
													? Number(event.target.value)
													: undefined
											)
										}
									>
										<option disabled value="">
											Select a chapter
										</option>
										{chapterNumbers.map((number) => (
											<option key={number} value={number}>
												Chapter {number}
											</option>
											))}
										</Dropdown>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button
							disabled={!isValid || isSubmitting || isRefreshPending}
							type="submit"
						>
							Save
						</Button>
					</form>
				</Form>
			)}
		</div>
	);
};

export default ChapterNumberForm;
