import { notFound } from 'next/navigation';
import { isTeacherSide } from '@/server/services/teacher-side';

// Course management sub-pages exist only for teacher-side roles. Students have no pages here.
const SelfLearningCourseLayout = async ({ children }: { children: React.ReactNode }) => {
	if (!(await isTeacherSide())) notFound();
	return <>{children}</>;
};

export default SelfLearningCourseLayout;
