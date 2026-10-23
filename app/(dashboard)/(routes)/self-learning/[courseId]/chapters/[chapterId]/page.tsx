import { LearningPartPage } from '../../../../../_components/learning-part-page';
import { isFirebaseStaging } from '@/shared/auth-config';
import { auth } from '@clerk/nextjs/server';
import { ArrowLeft, FileText, LayoutDashboard, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getTeacherChapter } from '@/server/queries/catalog';
import { getDbUser } from '@/server/services/user';
import { IconBadge } from '@/frontend/components/icon-badge';
import Banner from '@/frontend/components/banner';
import ChapterTitleForm from '@/frontend/features/teacher/chapters/editor/chapter-title-form';
import ChapterDescriptionForm from '@/frontend/features/teacher/chapters/editor/chapter-description-form';
import ChapterActions from '@/frontend/features/teacher/chapters/editor/chapter-actions';
import ChapterContentTypeForm from '@/frontend/features/teacher/chapters/editor/chapter-content-type-form';

const ChapterIdPage = async ({
	params: paramsPromise,
 searchParams,
}: {
	params: Promise<{ courseId: string; chapterId: string }>;
 searchParams: Promise<{preview?:string}>;
}) => {
	const params = await paramsPromise;
	if (isFirebaseStaging()) return <LearningPartPage courseId={params.courseId} segmentId={params.chapterId} preview={(await searchParams).preview==='1'}/>;
	const { userId } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const dbUser = await getDbUser(userId);
	if (!dbUser || dbUser.role === 'STUDENT' || (dbUser.role as string) === 'student') {
		return redirect('/');
	}

	const chapter = await getTeacherChapter(params.courseId, params.chapterId);

	if (!chapter) {
		return redirect('/');
	}

	const requiredFields = [chapter.title, chapter.contentType];
	const totalFields = requiredFields.length;
	const completedFields = requiredFields.filter(Boolean).length;
	const completionText = `${completedFields} of ${totalFields} fields completed`;
	const isComplete = requiredFields.every(Boolean);

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pt-2 pb-16">
			{/* Back Link */}
			<Link
				href={`/self-learning/${params.courseId}`}
				className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
			>
				<ArrowLeft className="h-4 w-4 mr-1.5" />
				Back to Lesson Setup
			</Link>

			{/* Unpublished Warning Banner */}
			{!chapter.isPublished && (
				<Banner
					variant="warning"
					label="This lesson segment is unpublished. It will not be visible in the student lesson player."
				/>
			)}

			{/* Top Header Card */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Segment Editor
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						{chapter.title || 'Lesson Segment Setup'}
					</h1>
					<p className="text-xs sm:text-sm text-slate-500">
						{completionText} · Required: Segment Title and Content Type.
					</p>
				</div>

				<ChapterActions
					disabled={!isComplete}
					courseId={params.courseId}
					chapterId={params.chapterId}
					isPublished={chapter.isPublished}
				/>
			</div>

			{/* 2-Column Light Theme Cards */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left Card: Customize Segment */}
				<div className="rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={LayoutDashboard} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Customize this segment
							</h2>
							<p className="text-xs text-slate-500">
								Edit segment title and descriptive details
							</p>
						</div>
					</div>

					<div className="space-y-4">
						<ChapterTitleForm
							initialData={chapter}
							chapterId={chapter.id}
							courseId={chapter.courseId}
						/>

						<ChapterDescriptionForm
							initialData={chapter}
							chapterId={chapter.id}
							courseId={chapter.courseId}
						/>
					</div>
				</div>

				{/* Right Card: Segment Content & Type */}
				<div className="rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm space-y-6">
					<div className="flex items-center gap-x-2.5 pb-4 border-b border-slate-100">
						<IconBadge icon={FileText} />
						<div>
							<h2 className="text-lg font-bold text-slate-900">
								Segment content &amp; media
							</h2>
							<p className="text-xs text-slate-500">
								Configure video streams, notes, or homework dropzones
							</p>
						</div>
					</div>

					<div className="space-y-4">
						<ChapterContentTypeForm
							initialData={chapter}
							chapterId={chapter.id}
							courseId={chapter.courseId}
						/>
					</div>
				</div>
			</div>
		</div>
	);
};

export default ChapterIdPage;
