import { notFound } from 'next/navigation';
import { isTeacherSide } from '@/server/services/teacher-side';

// Teacher-side roles manage courses under /self-learning; this location no longer exists for them.
const TeacherCoursesLayout = async ({ children }: { children: React.ReactNode }) => {
	if (await isTeacherSide()) notFound();
	return <>{children}</>;
};

export default TeacherCoursesLayout;
