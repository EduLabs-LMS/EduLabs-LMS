import { isFirebaseStaging } from '@/shared/auth-config';
import { WebsiteHome, type WebsiteSearch } from '../../_components/website-pages';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';

import StudentHome from '@/frontend/features/dashboard/student-home';
import AdminHome from '@/frontend/features/dashboard/admin-home';
import { getAdminHomeData, getStudentHomeData } from '@/server/queries/home';
import { isTeacher } from '@/server/services/teacher';
import { getDbUser } from '@/server/services/user';
import { isTeacherSide } from '@/server/services/teacher-side';

const HomePage = async ({ searchParams }: { searchParams: Promise<WebsiteSearch> }) => {
	if (isFirebaseStaging()) return <WebsiteHome search={await searchParams} />;
	const { userId, sessionClaims } = await auth();

	if (!userId) {
		return redirect('/');
	}

	const dbUser = await getDbUser(userId);
	const targetUserId = dbUser ? dbUser.id : userId;

	const isStaff =
		dbUser?.role === 'ADMIN' ||
		dbUser?.role === 'TEACHER' ||
		(await isTeacher(userId, sessionClaims));

	// If authenticated user is ADMIN or TEACHER, render the dedicated Admin Command Center!
	if (isStaff) {
		const { totalStudents, pendingWaitlistCount, pendingHomeworkCount, activeGroupsCount, recentSignups, recentSubmissions } = await getAdminHomeData();

		return (
			<AdminHome
				adminName={dbUser?.name || 'Mrs. Ghada'}
				teacherSide={await isTeacherSide()}
				metrics={{
					totalStudents,
					pendingWaitlistCount,
					pendingHomeworkCount,
					activeGroupsCount,
				}}
				recentSignups={recentSignups}
				recentSubmissions={recentSubmissions.map((s) => ({
					id: s.id,
					userName: s.userName,
					status: s.status,
					createdAt: s.createdAt,
					chapterTitle: s.chapter.title,
					courseTitle: s.chapter.course?.title,
				}))}
			/>
		);
	}

	// Check if student account is approved in Prisma
	const isPending = dbUser ? !dbUser.isApproved : false;

	if (isPending) {
		return (
			<div className="mx-auto flex max-w-xl flex-col items-center justify-center pt-16 pb-20 text-center">
				<div className="w-full rounded-3xl border border-amber-200 bg-white p-8 shadow-sm space-y-4">
					<div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700">
						<Clock className="h-7 w-7" />
					</div>
					<div className="space-y-1">
						<span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 uppercase tracking-wider">
							Admission Pending Review
						</span>
						<h2 className="text-xl font-bold text-slate-900 pt-2">
							Welcome to The Life of Physics
						</h2>
						<p className="text-sm text-slate-500 leading-relaxed max-w-md mx-auto">
							Your student sign-up has been registered in our portal. An assistant or teacher will review and approve your account shortly.
						</p>
					</div>
					<div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-400">
						<span>Questions? Contact:</span>
						<a
							href="mailto:support.lop.physics@gmail.com"
							className="font-semibold text-sky-700 hover:underline"
						>
							support.lop.physics@gmail.com
						</a>
					</div>
				</div>
			</div>
		);
	}

	const { lessons, membership, homeworkInfo } = await getStudentHomeData(userId, targetUserId);

	return (
		<div className="space-y-6">
			<StudentHome
				lessons={lessons}
				groupName={membership?.group?.name ?? null}
				groupSchedule={membership?.group?.schedule ?? null}
				homeworkInfo={homeworkInfo}
			/>
		</div>
	);
};

export default HomePage;
