import { isFirebaseStaging } from '@/shared/auth-config';
import { WebsiteCourses, previewFor, type WebsiteSearch } from '../../_components/website-pages';
import { isTeacherSide } from '@/shared/student-preview';
import { LegacyTeacherCourses } from '../../_components/legacy-teacher-courses';
import { getWebsiteContext } from '@/server/services/website';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getSelfLearningChapters } from '@/server/queries/self-learning';
import { getDbUser } from '@/server/services/user';
import { SelfLearningView } from '@/frontend/features/self-learning/self-learning-view';

// Teacher-side users see course management here (it used to be "Teacher courses"); students see Self-learning.
// The teacher-side condition below is the same one ../teacher/layout.tsx enforces for the course routes.
const SelfLearningPage = async ({ searchParams }: { searchParams: Promise<WebsiteSearch> }) => {
	if (isFirebaseStaging()) {
		const search = await searchParams;
		const context = await getWebsiteContext();
		if (!context) redirect('/sign-in');
		const teacherSide = isTeacherSide(context.memberships, context.courseStaff, context.offeringStaff);
		const preview = await previewFor(context);
		return <WebsiteCourses search={search} teacher={teacherSide && !preview} preview={preview} />;
	}
	const { userId } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const dbUser = await getDbUser(userId);
	if (dbUser && dbUser.role !== 'STUDENT' && (dbUser.role as string) !== 'student') return <LegacyTeacherCourses />;

	const chapters = await getSelfLearningChapters(userId);

	return <SelfLearningView chapters={chapters} />;
};

export default SelfLearningPage;
