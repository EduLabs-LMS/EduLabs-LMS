import Link from 'next/link';
import { PlusCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { DataTable } from '@/frontend/features/teacher/courses/list/data-table';
import { columns, type CourseListRow } from '@/frontend/features/teacher/courses/list/columns';
export const V2TeacherCourseList = ({ courses }: {courses:CourseListRow[]}) => {
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
						Organize, edit, and publish your curriculum lessons and chapters.
					</p>
				</div>

				<div className="flex flex-wrap gap-3"><Link className="rounded-xl border-2 border-black bg-primary px-4 py-2 text-sm font-bold shadow-hard-sm" href="/teacher/programs">Academic programs</Link><Link href="/teacher/create">
					<Button className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs">
						<PlusCircle className="h-4 w-4 mr-1.5" />
						New Lesson
					</Button>
				</Link></div>
			</div>

			{/* White Card Container */}
			<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<DataTable columns={columns} data={courses} />
			</div>
		</div>
	);
};
