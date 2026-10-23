'use client';

import * as z from 'zod';
import { api } from '@/frontend/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormLabel,
	FormItem,
	FormMessage,
} from '@/frontend/components/ui/form';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

const formSchema = z.object({
	title: z.string().min(1, {
		message: 'Title is required',
	}),
});

const CreateNewCoursePage = () => {
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
			const response = await api.post('/api/courses', values);
			router.push(`/teacher/courses/${response.data.id}`);
			toast.success('Lesson created successfully');
		} catch (error) {
			toast.error('Something went wrong');
		} finally {
			stopLoading();
		}
	};

	return (
		<div className="mx-auto flex max-w-2xl items-center justify-center pt-8 pb-16">
			<div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-6">
				<div className="space-y-1">
					<span className="text-xs font-bold uppercase tracking-wider text-amber-700">
						New Lesson
					</span>
					<h1 className="text-2xl font-bold tracking-tight text-slate-900">
						Name your lesson
					</h1>
					<p className="text-xs text-slate-500">
						What would you like to call this lesson? You can change this title anytime.
					</p>
				</div>

				<Form {...form}>
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="space-y-6"
					>
						<FormField
							control={form.control}
							name="title"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="text-xs font-semibold uppercase tracking-wider text-slate-700">
										Lesson title <span className="text-red-500 font-bold">*</span>
									</FormLabel>

									<FormControl>
										<Input
											disabled={isSubmitting}
											placeholder={`e.g. "Electric Current & Resistance"`}
											className="border-slate-200 bg-slate-50 focus:bg-white text-sm"
											{...field}
										/>
									</FormControl>

									<FormDescription className="text-xs text-slate-400">
										What physics topic will you teach in this lesson?
									</FormDescription>

									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex items-center gap-x-2 pt-2 border-t border-slate-100">
							<Link href={'/teacher/courses'}>
								<Button type="button" variant={'outline'} className="border-slate-200 text-slate-700">
									Cancel
								</Button>
							</Link>

							<Button
								type="submit"
								disabled={!isValid || isSubmitting}
								className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs"
							>
								Continue
							</Button>
						</div>
					</form>
				</Form>
			</div>
		</div>
	);
};

export default CreateNewCoursePage;
