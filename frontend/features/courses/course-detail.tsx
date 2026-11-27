'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { Preview } from '@/frontend/components/preview';
import { Button } from '@/frontend/components/ui/button';
import Link from 'next/link';
import { cn } from '@/shared/utils';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import FeedbackItem from '@/frontend/features/courses/feedback/feedback-item';
import FeedbackForm from '@/frontend/features/courses/feedback/feedback-form';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/lib/api';
import type { Feedback } from '@/shared/contracts/courses';
import { useAuth } from '@/frontend/components/providers/v2-identity';
import { isFirebaseStaging } from '@/shared/auth-config';

/**
 * The top of a student's course page: title, description, picture and Continue (to the part Continue Learning would open).
 * Feedback and ratings are not a feature of the new platform yet, so nothing of them is shown in Firebase staging: no rating, no
 * empty list, no placeholder line. The older Clerk build keeps its own feedback list and form.
 */
const CourseDetailPage = ({ initialCourse, continueHref }: { initialCourse?: {id:string;title:string;description:string|null;imageUrl?:string|null}; continueHref?: string }) => {
	const { courseId } = useParams<{ courseId: string }>();

	const { userId } = useAuth();

	const [course, setCourse] = useState<any>(initialCourse ?? null);
	const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
	const [isFeedbacked, setIsFeedbacked] = useState(false);

	useEffect(() => {
		if (isFirebaseStaging()) return;
		(async () => {
			try {
				const res = await api.get(`/api/courses/${courseId}`);

				setCourse(res.data);
			} catch (error) {
				console.log(error);
			}
		})();
	}, [courseId]);

	useEffect(() => {
		if (isFirebaseStaging()) return;
		(async () => {
			try {
				const res = await api.get(`/api/courses/${courseId}/feedbacks`);

				setFeedbacks(res.data);
			} catch (error) {
				console.log(error);
			}
		})();
	}, [courseId]);

	useEffect(() => {
		if (!feedbacks.length || !userId) return;

		feedbacks.forEach((feedback) => {
			if (feedback.userId === userId) {
				setIsFeedbacked(true);
			}
		});
	}, [feedbacks, userId]);

	const afterSentFeedback = (newFeedback: Feedback) => {
		setFeedbacks((prev) => [...prev, newFeedback]);
		setIsFeedbacked(true);
	};

	const staging = isFirebaseStaging();
	const description = typeof course?.description === 'string' ? course.description : '';
	// Text a teacher typed in the course settings is plain; older courses may hold rich text from the retired editor.
	const rich = /^\s*<[a-z][\s\S]*>/i.test(description);
	return (
		<div data-course-detail className="py-2">
			<div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 sm:gap-8">
				<div className="min-w-0">
					<h1 dir="auto" className="text-3xl font-bold text-slate-950 break-words">
						{course?.title}
					</h1>

					<div className={cn('mt-2 text-sm', !description && 'text-slate-500 italic')}>
						{!description && <L id="common.no_description"/>}
						{description && (rich ? <div className="-mx-[15px]"><Preview value={description} /></div> : <p dir="auto" className="whitespace-pre-line break-words text-slate-700">{description}</p>)}
					</div>

					{continueHref && (
						<Button asChild className="mt-4 w-full"><Link data-course-continue href={continueHref}><L id="common.continue_studying"/></Link></Button>
					)}
				</div>

				<div className="min-w-0">
					{course?.imageUrl && (
						<div className="w-full h-[350px] relative">
							<Localized as={Image} labels={{"alt":"common.course_image"}}
								className="rounded-md shadow-md object-cover "
								src={course.imageUrl}
								fill
							/>
						</div>
					)}
				</div>
			</div>

			{!staging && (
				<div className="mt-12">
					<h2 className="text-2xl font-bold mt-8 mb-4"><L id="common.feedbacks"/></h2>

					<div className="grid grid-cols-1 gap-y-3">
						{feedbacks.map((feedback, index) => (
							<FeedbackItem
								key={feedback.id}
								content={feedback.content}
								fullName={feedback.fullName}
								imageUrl={feedback.avatarUrl}
								rating={5}
								duration={index + 1}
							/>
						))}
					</div>

					{course && !isFeedbacked && (
						<FeedbackForm
							courseId={course.id}
							afterSentFeedback={afterSentFeedback}
						/>
					)}
				</div>
			)}
		</div>
	);
};

export default CourseDetailPage;
