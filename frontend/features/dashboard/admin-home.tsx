'use client';

import Link from 'next/link';
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
	metrics,
	recentSignups,
	recentSubmissions,
}: AdminHomeProps) => {
	return (
		<div className="mx-auto w-full max-w-[1600px] space-y-8 pt-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
			{/* Top Welcome Hero Banner */}
			<section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
					<div className="space-y-2">
						<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
							<ShieldCheck className="h-3.5 w-3.5" />
							<span>Teacher &amp; Administrator Command Center</span>
						</div>
						<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
							Welcome back, {adminName}!
						</h1>
						<p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
							Here is an overview of admissions, student progress, homework submissions, and scheduled study sessions for EduLabs.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-3 shrink-0">
						<Link href="/admin/users">
							<Button className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs">
								<Users className="h-4 w-4 mr-1.5" />
								Manage Users &amp; Groups
							</Button>
						</Link>
						<Link href="/admin/submissions">
							<Button
								variant="outline"
								className="border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
							>
								<CheckCircle2 className="h-4 w-4 mr-1.5 text-emerald-600" />
								Review Homework ({metrics.pendingHomeworkCount ?? "Unavailable"})
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
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									Enrolled Students
								</p>
								<p className="mt-1.5 text-3xl font-bold text-slate-900">
									{metrics.totalStudents ?? "Unavailable"}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100 transition-colors">
								<UserCheck className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
							<span>Active &amp; Approved</span>
							<ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 2. Pending Waitlist Count */}
				<Link href="/admin/users" className="block group">
					<div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
									Pending Waitlist
								</p>
								<p className="mt-1.5 text-3xl font-bold text-amber-950">
									{metrics.pendingWaitlistCount ?? "Unavailable"}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-800 group-hover:bg-amber-200 transition-colors">
								<UserPlus className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-amber-200/60 flex items-center justify-between text-xs text-amber-800 font-semibold">
							<span>Needs Approval</span>
							<ArrowRight className="h-3.5 w-3.5 text-amber-700 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 3. Homework Submissions Needing Review */}
				<Link href="/admin/submissions" className="block group">
					<div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-sky-800">
									Homework to Grade
								</p>
								<p className="mt-1.5 text-3xl font-bold text-sky-950">
									{metrics.pendingHomeworkCount ?? "Unavailable"}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-100 text-sky-800 group-hover:bg-sky-200 transition-colors">
								<Clock className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-sky-200/60 flex items-center justify-between text-xs text-sky-800 font-semibold">
							<span>Pending in Queue</span>
							<ArrowRight className="h-3.5 w-3.5 text-sky-700 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>

				{/* 4. Active Study Groups */}
				<Link href={phase1?'/groups':'/admin/users'} className="block group">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-pointer h-full flex flex-col justify-between">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
									Active Groups
								</p>
								<p className="mt-1.5 text-3xl font-bold text-slate-900">
									{metrics.activeGroupsCount}
								</p>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-700 group-hover:bg-violet-100 transition-colors">
								<Layers className="h-6 w-6" />
							</div>
						</div>
						<div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
							<span>Recurring Schedules</span>
							<ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
						</div>
					</div>
				</Link>
			</section>

			{/* ============================================================== */}
			{/* 2. QUICK ACTION CARDS                                          */}
			{/* ============================================================== */}
			<section className="space-y-3">
				<h2 className="text-lg font-bold text-slate-900">Quick Administrative Actions</h2>
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
							<h3 className="font-bold text-slate-900 text-sm">Review Waitlist Approvals</h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
								Approve newly registered students and grant access.
							</p>
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
							<h3 className="font-bold text-slate-900 text-sm">Grade Homework Submissions</h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
								Inspect textbook uploads and mark assignments as verified.
							</p>
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
							<h3 className="font-bold text-slate-900 text-sm">Manage Curriculum &amp; Videos</h3>
							<p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
								Upload lessons, configure videos, and publish chapters.
							</p>
						</div>
					</Link>
				</div>
			</section>

			{/* ============================================================== */}
			{/* 3. RECENT ACTIVITY FEED                                       */}
			{/* ============================================================== */}
			<section className="grid gap-6 grid-cols-1 lg:grid-cols-2">
				{/* Latest Student Sign-ups */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<UserPlus className="h-5 w-5 text-sky-600" />
							<h3 className="font-bold text-slate-900 text-base">Latest Student Sign-Ups</h3>
						</div>
						<Link
							href="/admin/users"
							className="text-xs font-semibold text-sky-700 hover:underline"
						>
							View All &rarr;
						</Link>
					</div>

					{phase1 ? <p role="status" className="text-sm text-slate-500">Review actual pending requests in <Link href="/admin/users" className="underline">Students &amp; Access</Link>.</p> : recentSignups.length === 0 ? (
						<div className="py-8 text-center text-xs text-slate-400">
							No recent sign-ups found.
						</div>
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
													{s.name || 'Student Applicant'}
												</p>
												<p className="text-[11px] text-slate-400 font-mono truncate">
													{s.email}
												</p>
											</div>
										</div>

										<div className="flex items-center gap-2 shrink-0 ml-2">
											{s.isApproved ? (
												<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
													Approved
												</span>
											) : (
												<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
													Pending
												</span>
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
							<h3 className="font-bold text-slate-900 text-base">Latest Homework Submissions</h3>
						</div>
						<Link
							href="/admin/submissions"
							className="text-xs font-semibold text-sky-700 hover:underline"
						>
							View Queue &rarr;
						</Link>
					</div>

					{phase1 ? <p role="status" className="text-sm text-slate-500">Open the <Link href="/admin/submissions" className="underline">Homework Queue</Link> for submissions requiring correction.</p> : recentSubmissions.length === 0 ? (
						<div className="py-8 text-center text-xs text-slate-400">
							No recent homework submissions found.
						</div>
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
												{sub.userName || 'Student'}
											</p>
											<p className="text-[11px] text-slate-500 truncate">
												{sub.chapterTitle}
											</p>
										</div>

										<div className="flex items-center gap-2 shrink-0 ml-2">
											{sub.status === 'APPROVED' ? (
												<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
													Approved
												</span>
											) : (
												<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
													Pending
												</span>
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
