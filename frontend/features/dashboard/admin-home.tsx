'use client';

import { L } from '@/frontend/components/language-provider';
import Link from 'next/link';
import { useGroupSummary } from '@/frontend/features/groups/use-group-summary';
import { GroupSummaryPanel } from '@/frontend/features/groups/group-summary-panel';
import {
	ArrowRight,
	BookOpen,
	Calendar,
	CheckCircle2,
	Clock,
	Layers,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	UserCheck,
	UserPlus,
	Users,
} from 'lucide-react';
import { cn } from '@/shared/utils';
import { Button } from '@/frontend/components/ui/button';

interface AdminHomeProps {
	phase1?: boolean;
	/** Teachers and their assistants get the simplified dashboard; platform roles keep the full one. */
	teacherSide?: boolean;
	adminName?: string | null;
	metrics: {
		totalStudents: number | null;
		pendingWaitlistCount: number | null;
		pendingHomeworkCount: number | null;
		activeGroupsCount: number;
	};
	recentSignups: Array<{
		id: string;
		name: string | null;
		email: string;
		role: string;
		isApproved: boolean;
		createdAt: string | Date;
	}>;
	recentSubmissions: Array<{
		id: string;
		userName: string | null;
		status: string;
		createdAt: string | Date;
		chapterTitle: string;
		courseTitle?: string;
	}>;
}

export const AdminHome = ({
	adminName = 'Teacher',
	phase1 = false,
	teacherSide = false,
	metrics,
	recentSignups,
	recentSubmissions,
}: AdminHomeProps) => {
 const attendance=useGroupSummary(phase1&&!teacherSide);
	return (
		<div className="mx-auto w-full max-w-[1600px] space-y-8 pt-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
			{phase1&&!teacherSide&&<GroupSummaryPanel summary={attendance} staff homework={false}/>}
			{/* Top Welcome Hero Banner */}
			<section className={teacherSide ? "w-full" : "relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm"}>
				<div className={cn("flex flex-col md:flex-row md:items-center justify-between", teacherSide ? "gap-4" : "gap-6")}>
					<div className="space-y-2">
						{!teacherSide && <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
							<ShieldCheck className="h-3.5 w-3.5" />
							<span><L id="teacher.teacher_administrator_command_center"/></span>
						</div>}
						<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"><L id="teacher.welcome_back"/>{" "}{adminName}!
						</h1>
						{!teacherSide && <p className="text-sm text-slate-500 max-w-2xl leading-relaxed"><L id="teacher.here_is_an_overview_of"/></p>}
					</div>

					<div className="flex flex-wrap items-center gap-3 shrink-0">
						<Link href="/admin/users">
							<Button className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs">
								<Users className="h-4 w-4 mr-1.5" /><L id="teacher.manage_users_groups"/></Button>
						</Link>
						<Link href="/admin/submissions">
							<Button
								variant="outline"
								className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
							>
								<CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-600" /><L id="teacher.review_homework"/>{metrics.pendingHomeworkCount ?? <L id="common.unavailable"/>})
							</Button>
						</Link>
					</div>
				</div>
			</section>

			{/* ============================================================== */}
			{/* 1. QUICK METRICS CARDS                                         */}
			{/* ============================================================== */}
			<section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
				{/* 1. Total Enrolled Students */}
				<Link href="/admin/users" className="block group">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500"><L id="teacher.enrolled_students"/></p>
								<p className="mt-1.5 text-3xl font-bold text-slate-900">
									{metrics.totalStudents ?? <L id="common.unavailable"/>}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100 transition-colors">
								<UserCheck className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
							<span><L id="teacher.active_approved"/></span>
							<ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 2. Pending Waitlist Count */}
				<Link href="/admin/users" className="block group">
					<div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-amber-800"><L id="teacher.pending_waitlist"/></p>
								<p className="mt-1.5 text-3xl font-bold text-amber-950">
									{metrics.pendingWaitlistCount ?? <L id="common.unavailable"/>}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-800 group-hover:bg-amber-200 transition-colors">
								<UserPlus className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-amber-200/60 flex items-center justify-between text-xs text-amber-800 font-semibold">
							<span><L id="teacher.needs_approval"/></span>
							<ArrowRight className="h-3.5 w-3.5 text-amber-700 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 3. Homework Submissions Needing Review */}
				<Link href="/admin/submissions" className="block group">
					<div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-sky-800"><L id="teacher.homework_to_grade"/></p>
								<p className="mt-1.5 text-3xl font-bold text-sky-950">
									{metrics.pendingHomeworkCount ?? <L id="common.unavailable"/>}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-100 text-sky-800 group-hover:bg-sky-200 transition-colors">
								<Clock className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-sky-200/60 flex items-center justify-between text-xs text-sky-800 font-semibold">
							<span><L id="teacher.pending_in_queue"/></span>
							<ArrowRight className="h-3.5 w-3.5 text-sky-700 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 4. Active Study Groups */}
				<Link href={phase1?'/groups':'/admin/users'} className="block group">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500"><L id="teacher.active_groups"/></p>
								<p className="mt-1.5 text-3xl font-bold text-slate-900">
									{metrics.activeGroupsCount}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-700 group-hover:bg-violet-100 transition-colors">
								<Layers className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
							<span><L id="teacher.recurring_schedules"/></span>
							<ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>
			</section>

			{!teacherSide && (
			<>
			{/* ============================================================== */}
			{/* 2. QUICK ACTION CARDS                                          */}
			{/* ============================================================== */}
			<section className="space-y-3">
				<h2 className="text-lg font-bold text-slate-900"><L id="teacher.quick_administrative_actions"/></h2>
				<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{/* Action 1 */}
					<Link
						href="/admin/users"
						className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:border-amber-300 hover:shadow-md active:translate-y-0"
					>
						<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700">
							<ShieldAlert className="h-6 w-6" />
						</div>
						<div className="min-w-0">
							<h3 className="font-bold text-slate-900 text-sm"><L id="teacher.review_waitlist_approvals"/></h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1"><L id="teacher.approve_newly_registered_students_and"/></p>
						</div>
					</Link>

					{/* Action 2 */}
					<Link
						href="/admin/submissions"
						className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:border-sky-300 hover:shadow-md active:translate-y-0"
					>
						<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700">
							<CheckCircle2 className="h-6 w-6" />
						</div>
						<div className="min-w-0">
							<h3 className="font-bold text-slate-900 text-sm"><L id="teacher.grade_homework_submissions"/></h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1"><L id="teacher.inspect_textbook_uploads_and_mark"/></p>
						</div>
					</Link>

					{/* Action 3 */}
					<Link
						href="/teacher/courses"
						className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:border-violet-300 hover:shadow-md active:translate-y-0"
					>
						<div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700">
							<BookOpen className="h-6 w-6" />
						</div>
						<div className="min-w-0">
							<h3 className="font-bold text-slate-900 text-sm"><L id="teacher.manage_curriculum_videos"/></h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1"><L id="teacher.upload_lessons_configure_videos_and"/></p>
						</div>
					</Link>
				</div>
			</section>
			</>
			)}

			{/* ============================================================== */}
			{/* 3. RECENT ACTIVITY FEED                                       */}
			{/* ============================================================== */}
			<section className="grid gap-6 grid-cols-1 lg:grid-cols-2">
				{/* Latest Student Sign-ups */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<UserPlus className="h-5 w-5 text-sky-600" />
							<h3 className="font-bold text-slate-900 text-base"><L id="teacher.latest_student_sign_ups"/></h3>
						</div>
						<Link
							href="/admin/users"
							className="text-xs font-semibold text-sky-700 hover:underline"
						><L id="teacher.view_all"/></Link>
					</div>

					{phase1 ? <p role="status" className="text-sm text-slate-500"><L id="teacher.review_actual_pending_requests_in"/>{" "}<Link href="/admin/users" className="underline"><L id="teacher.students_access"/></Link>.</p> : recentSignups.length === 0 ? (
						<div className="py-8 text-center text-xs text-slate-400"><L id="teacher.no_recent_sign_ups_found"/></div>
					) : (
						<div className="space-y-3">
							{recentSignups.map((s) => {
								const dateStr = s.createdAt
									? new Date(s.createdAt).toLocaleDateString('en-US', {
											month: 'short',
											day: 'numeric',
									  })
									: '—';

								return (
									<div
										key={s.id}
										className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-slate-50 transition"
									>
										<div className="flex items-center gap-3 min-w-0">
											<div className="grid h-9 w-9 place-items-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs shrink-0">
												{(s.name || 'S').charAt(0)}
											</div>
											<div className="min-w-0">
												<p className="text-xs font-bold text-slate-900 truncate">
													{s.name || <L id="common.applicant"/>}
												</p>
												<p className="text-[11px] text-slate-400 font-mono truncate">
													{s.email}
												</p>
											</div>
										</div>

										<div className="flex items-center gap-2 shrink-0 ml-2">
											{s.isApproved ? (
												<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200"><L id="teacher.approved"/></span>
											) : (
												<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200"><L id="teacher.pending"/></span>
											)}
											<span className="text-[10px] text-slate-400">{dateStr}</span>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Latest Homework Submissions */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Clock className="h-5 w-5 text-amber-600" />
							<h3 className="font-bold text-slate-900 text-base"><L id="teacher.latest_homework_submissions"/></h3>
						</div>
						<Link
							href="/admin/submissions"
							className="text-xs font-semibold text-sky-700 hover:underline"
						><L id="teacher.view_queue"/></Link>
					</div>

					{phase1 ? <p role="status" className="text-sm text-slate-500"><L id="teacher.open_the"/>{" "}<Link href="/admin/submissions" className="underline"><L id="navigation.homework_queue"/></Link>{" "}<L id="teacher.for_submissions_requiring_correction"/></p> : recentSubmissions.length === 0 ? (
						<div className="py-8 text-center text-xs text-slate-400"><L id="teacher.no_recent_homework_submissions_found"/></div>
					) : (
						<div className="space-y-3">
							{recentSubmissions.map((sub) => {
								const dateStr = sub.createdAt
									? new Date(sub.createdAt).toLocaleDateString('en-US', {
											month: 'short',
											day: 'numeric',
									  })
									: '—';

								return (
									<div
										key={sub.id}
										className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-slate-50 transition"
									>
										<div className="min-w-0 space-y-0.5">
											<p className="text-xs font-bold text-slate-900 truncate">
												{sub.userName || <L id="common.student"/>}
											</p>
											<p className="text-[11px] text-slate-500 truncate">
												{sub.chapterTitle}
											</p>
										</div>

										<div className="flex items-center gap-2 shrink-0 ml-2">
											{sub.status === 'APPROVED' ? (
												<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200"><L id="teacher.approved"/></span>
											) : (
												<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200"><L id="teacher.pending"/></span>
											)}
											<span className="text-[10px] text-slate-400">{dateStr}</span>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</section>
		</div>
	);
};

export default AdminHome;
