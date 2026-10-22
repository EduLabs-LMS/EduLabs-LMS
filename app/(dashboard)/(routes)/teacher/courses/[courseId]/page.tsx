import { isFirebaseStaging } from '@/shared/auth-config';
import { getCourseManagementPath } from '@/server/services/teacher-side';
import { TeacherEditor } from '../../../../_components/teacher-editor';
import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, LayoutDashboard, ListChecks, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getTeacherCourse } from '@/server/queries/catalog';
import { getDbUser } from '@/server/services/user';
import { IconBadge } from '@/frontend/components/icon-badge';
import Banner from '@/frontend/components/banner';
import TitleForm from '@/frontend/features/teacher/courses/editor/title-form';
import DescriptionForm from '@/frontend/features/teacher/courses/editor/description-form';
import ImageForm from '@/frontend/features/teacher/courses/editor/image-form';
import ChapterNumberForm from '@/frontend/features/teacher/courses/editor/chapter-number-form';
import ChaptersForm from '@/frontend/features/teacher/courses/editor/chapters-form';
import Actions from '@/frontend/features/teacher/courses/editor/actions';

const CourseIdPage = async ({ params: paramsPromise }: { params: Promise<{ courseId: string }> }) => {
	const params = await paramsPromise; if (isFirebaseStaging()) return <TeacherEditor courseId={params.courseId} />;
	const courseBase = await getCourseManagementPath();
	const { userId } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const dbUser = await getDbUser(userId);
	if (!dbUser || dbUser.role === 'STUDENT' || (dbUser.role as string) === 'student') {
		return redirect('/');
	}

	const course = await getTeacherCourse(params.courseId);

	if (!course) {
		return redirect('/');
	}

	const hasValidChapterNumber =
		typeof course.chapterNumber === 'number' &&
		course.chapterNumber >= 1 &&
		course.chapterNumber <= 8;

	const requiredFields = [
		course.title,
		hasValidChapterNumber,
		course.chapters.some((chapter) => chapter.isPublished),
	];

	const totalFields = requiredFields.length;
	const completedFields = requiredFields.filter(Boolean).length;
	const completionText = `${completedFields} of ${totalFields} fields completed`;
	const isComplete = requiredFields.every(Boolean);

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pt-2 pb-16">
			{/* Back Link */}
			<Link
				href={courseBase}
				className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
			>
				<ArrowLeft className="h-4 w-4 mr-1.5" />
				Back to All Lessons
			</Link>

			{/* Unpublished Warning Banner */}
			{!course.isPublished && (
				<Banner
					variant="warning"
					label="This lesson is unpublished. It will not be visible to students in the curriculum."
				/>
			)}

			{/* Top Header Card */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Lesson Editor
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						{course.title || 'Lesson Setup'}
					</h1>
					<p className="text-xs sm:text-sm text-slate-500">
						{completionText} · Required: Lesson Title, Chapter Number, and at least one published segment.
					</p>
				</div>

				<Actions
					disabled={!isComplete}
					courseId={params.courseId}
					isPublished={course.isPublished}
				/>
			</div>

			{/* 2-Column Light Theme Cards */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left Card: Customize Lesson */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={LayoutDashboard} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Customize your lesson
							</h2>
							<p className="text-xs text-slate-500">
								Configure basic metadata and chapter grouping
							</p>
						</div>
					</div>

					<div className="space-y-4">
						<TitleForm initialData={course} courseId={course.id} />
						<ChapterNumberForm initialData={course} courseId={course.id} />
						<DescriptionForm initialData={course} courseId={course.id} />
						<ImageForm initialData={course} courseId={course.id} />
					</div>
				</div>

				{/* Right Card: Lesson Segments */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={ListChecks} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Lesson segments
							</h2>
							<p className="text-xs text-slate-500">
								Add video explanations, notes, and homework assignments
							</p>
						</div>
					</div>

					<ChaptersForm initialData={course} courseId={course.id} />
				</div>
			</div>
		</div>
	);
};

export default CourseIdPage;
