'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { Preview } from '@/frontend/components/preview';
import { Button } from '@/frontend/components/ui/button';
import { cn } from '@/shared/utils';
import { Star } from 'lucide-react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import FeedbackItem from '@/frontend/features/courses/feedback/feedback-item';
import FeedbackForm from '@/frontend/features/courses/feedback/feedback-form';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/lib/api';
import type { Feedback } from '@/shared/contracts/courses';
import { useAuth } from '@/frontend/components/providers/v2-identity';
import { isFirebaseStaging } from '@/shared/auth-config';

const CourseDetailPage = ({ initialCourse }: { initialCourse?: {id:string;title:string;description:string|null;imageUrl?:string|null} }) => {
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

	return (
		<div className="p-8">
 {isFirebaseStaging() && <p role="status" className="mb-4 text-xs text-slate-500"><L id="common.feedback_is_awaiting_integration_the"/></p>}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-8 center-content">
				<div>
					<div className="px-[15px] py-[12px] text-3xl font-bold">
						{course?.title}
					</div>

					<div
						className={cn(
							'text-sm mt-2',
							!course?.description && 'text-slate-500 italic'
						)}
					>
						{!course?.description && 'No description'}

						{course?.description && <Preview value={course?.description} />}
					</div>

					<div className="px-4">
						<Button className="mt-4 w-full"><L id="common.continue_studying"/></Button>
					</div>
				</div>

				<div>
					{course?.imageUrl && (
						<div className="w-full h-[350px] relative">
							<Localized as={Image} labels={{"alt":"common.course_image"}}
								className="rounded-md shadow-md object-cover "
								src={course.imageUrl}
								fill
							/>
						</div>
					)}

					<div className="flex mt-6 items-center">
						<div className="flex items-center text-orange-400 font-bold text-xl">
							{`4/5`}
							<Star className="w-4 h-4 ml-1 fill-current" />
						</div>

						<div className="ml-3 text-sm text-slate-500">{`(${feedbacks.length} đánh giá)`}</div>
					</div>
				</div>
			</div>

			<div className="mt-12 pl-4">
				<div className="text-2xl font-bold mt-8 mb-4"><L id="common.feedbacks"/></div>

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

				{course && !isFirebaseStaging() && !isFeedbacked && (
					<FeedbackForm
						courseId={course.id}
						afterSentFeedback={afterSentFeedback}
					/>
				)}
			</div>
		</div>
	);
};

export default CourseDetailPage;
