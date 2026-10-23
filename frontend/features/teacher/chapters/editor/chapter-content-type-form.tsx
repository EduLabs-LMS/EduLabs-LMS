'use client';

import type { Attachment, Chapter, HomeworkQuestion, MuxData } from '@/shared/contracts/courses';
import { ClipboardCheck, FileUp, ListChecks, Video } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/frontend/lib/api';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import AttachmentForm from '@/frontend/features/teacher/chapters/editor/attachment-form';
import ChapterVideoForm from '@/frontend/features/teacher/chapters/editor/chapter-video-form';
import HomeworkQuestionsForm from '@/frontend/features/teacher/chapters/editor/homework-questions-form';
import ChapterSolutionVideoForm from '@/frontend/features/teacher/chapters/editor/chapter-solution-video-form';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';

type ContentType = 'explanation' | 'homework';
type HomeworkMode = 'FILE_UPLOAD' | 'PLATFORM_QUESTIONS';

interface ChapterContentTypeFormProps {
	initialData: Chapter & {
		attachments: Attachment[];
		muxData?: MuxData | null;
		homeworkQuestions?: HomeworkQuestion[];
	};
	courseId: string;
	chapterId: string;
}

const ChapterContentTypeForm = ({
	initialData,
	courseId,
	chapterId,
}: ChapterContentTypeFormProps) => {
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const [contentType, setContentType] = useState<ContentType>(
		initialData.contentType === 'HOMEWORK_ASSIGNMENT' ||
			(initialData.solutionVideoUrl && !initialData.videoUrl)
			? 'homework'
			: 'explanation'
	);

	const [homeworkMode, setHomeworkMode] = useState<HomeworkMode>(
		initialData.homeworkMode === 'PLATFORM_QUESTIONS' ? 'PLATFORM_QUESTIONS' : 'FILE_UPLOAD'
	);

	const onSelectMode = async (mode: HomeworkMode) => {
		const previous = homeworkMode;
		setHomeworkMode(mode);

		try {
			startLoading('Saving changes...');
			await api.patch(`/api/courses/${courseId}/chapters/${chapterId}`, {
				homeworkMode: mode,
			});
			toast.success('Homework format updated');
			router.refresh();
		} catch {
			setHomeworkMode(previous);
			toast.error('Failed to update homework format');
		} finally {
			stopLoading();
		}
	};

	const onSelectType = async (type: ContentType) => {
		setContentType(type);

		try {
			startLoading('Saving changes...');
			await api.patch(`/api/courses/${courseId}/chapters/${chapterId}`, {
				contentType:
					type === 'explanation' ? 'VIDEO_EXPLANATION' : 'HOMEWORK_ASSIGNMENT',
			});
			toast.success('Segment type updated');
			router.refresh();
		} catch {
			toast.error('Failed to update segment type');
		} finally {
			stopLoading();
		}
	};

	return (
		<div className="mt-2">
			<p className="mb-3 text-sm font-semibold text-slate-900">
				Content type <span className="text-red-500 font-bold">*</span>
			</p>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="tablist">
				<Button
					aria-selected={contentType === 'explanation'}
					className={
						contentType === 'explanation'
							? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
							: 'border-slate-200 text-slate-700 hover:bg-slate-100'
					}
					onClick={() => onSelectType('explanation')}
					type="button"
					variant={contentType === 'explanation' ? 'default' : 'outline'}
				>
					<Video className="mr-2 h-4 w-4 text-green-900" />
					Video Explanation
				</Button>
				<Button
					aria-selected={contentType === 'homework'}
					className={
						contentType === 'homework'
							? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
							: 'border-slate-200 text-slate-700 hover:bg-slate-100'
					}
					onClick={() => onSelectType('homework')}
					type="button"
					variant={contentType === 'homework' ? 'default' : 'outline'}
				>
					<ClipboardCheck className="mr-2 h-4 w-4 text-amber-600" />
					Homework / Assignment
				</Button>
			</div>

			{contentType === 'explanation' ? (
				<>
					<ChapterVideoForm
						chapterId={chapterId}
						courseId={courseId}
						initialData={initialData}
					/>
					<AttachmentForm
						chapterId={chapterId}
						courseId={courseId}
						initialData={initialData}
					/>
				</>
			) : (
				<>
					<ChapterSolutionVideoForm
						chapterId={chapterId}
						courseId={courseId}
						initialData={initialData}
					/>
					<div className="mt-6">
						<p className="mb-3 text-sm font-semibold text-slate-900">Homework format</p>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="tablist">
							<Button
								aria-selected={homeworkMode === 'FILE_UPLOAD'}
								className={
									homeworkMode === 'FILE_UPLOAD'
										? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
										: 'border-slate-200 text-slate-700 hover:bg-slate-100'
								}
								onClick={() => onSelectMode('FILE_UPLOAD')}
								type="button"
								variant={homeworkMode === 'FILE_UPLOAD' ? 'default' : 'outline'}
							>
								<FileUp className="mr-2 h-4 w-4 text-green-900" />
								File upload
							</Button>
							<Button
								aria-selected={homeworkMode === 'PLATFORM_QUESTIONS'}
								className={
									homeworkMode === 'PLATFORM_QUESTIONS'
										? 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
										: 'border-slate-200 text-slate-700 hover:bg-slate-100'
								}
								onClick={() => onSelectMode('PLATFORM_QUESTIONS')}
								type="button"
								variant={homeworkMode === 'PLATFORM_QUESTIONS' ? 'default' : 'outline'}
							>
								<ListChecks className="mr-2 h-4 w-4 text-amber-600" />
								Platform questions
							</Button>
						</div>
					</div>

					{homeworkMode === 'PLATFORM_QUESTIONS' && (
						<HomeworkQuestionsForm
							chapterId={chapterId}
							courseId={courseId}
							initialQuestions={initialData.homeworkQuestions ?? []}
						/>
					)}

					<div className="mt-6 rounded-xl border border-slate-300 bg-green-50 p-4 text-sm text-slate-700">
						<p className="font-semibold text-slate-900">Student Submission Portal</p>
						<p className="mt-1 text-slate-600 leading-relaxed">
							Students will upload photos or PDFs of their completed textbook homework. Submitting unlocks the solution walkthrough video.
						</p>
					</div>
				</>
			)}
		</div>
	);
};

export default ChapterContentTypeForm;
