import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, ShieldCheck } from 'lucide-react';

import { getTeacherCourses } from '@/server/queries/catalog';
import { getDbUser } from '@/server/services/user';
import { Button } from '@/frontend/components/ui/button';
import { DataTable } from '@/frontend/features/teacher/courses/list/data-table';
import { columns } from '@/frontend/features/teacher/courses/list/columns';

/** Legacy (Clerk/Prisma) teacher course list, moved unchanged from the old Teacher courses page. */
export const LegacyTeacherCourses = async () => {
	const { userId } = await auth();

	if (!userId) return redirect('/');

	const dbUser = await getDbUser(userId);
	if (!dbUser || dbUser.role === 'STUDENT' || (dbUser.role as string) === 'student') {
		return redirect('/');
	}

	// Authorized admin or teacher: fetch ALL platform courses/lessons from Prisma
	const courses = await getTeacherCourses();

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pt-2 pb-16">
			{/* Top Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Teacher Portal
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						Lesson Management
					</h1>
					<p className="text-sm text-slate-500">
						Organize, edit, and publish your physics curriculum lessons and chapters.
					</p>
				</div>

				<Link href="/teacher/create">
					<Button className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs">
						<PlusCircle className="h-4 w-4 mr-1.5" />
						New Lesson
					</Button>
				</Link>
			</div>

			{/* White Card Container */}
			<div className="rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm">
				<DataTable columns={columns} data={courses} />
			</div>
		</div>
	);
};
