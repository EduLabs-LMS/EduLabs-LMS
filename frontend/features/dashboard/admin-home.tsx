'use client';

import { L } from '@/frontend/components/language-provider';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, Layers, UserCheck, UserPlus, Users } from 'lucide-react';
import { cn } from '@/shared/utils';
import { Button } from '@/frontend/components/ui/button';
import { Card, Chip, StatCard } from '@/frontend/components/page-kit';
import { CountUp } from '@/frontend/components/count-up';

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

const shortDate = (value: string | Date) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const count = (value: number | null) => (value === null ? <span className="text-base font-semibold"><L id="common.unavailable" /></span> : <CountUp value={value} />);

export const AdminHome = ({ adminName = 'Teacher', phase1 = false, metrics, recentSignups, recentSubmissions }: AdminHomeProps) => {
	// Waitlist card is hidden while nobody is waiting (null = count unavailable, still shown).
	const showWaitlist = metrics.pendingWaitlistCount !== 0;
	const tile = (href: string, label: React.ReactNode, value: React.ReactNode, icon: React.ReactNode, hint: React.ReactNode) => (
		<Link href={href} className="group block rounded-3xl focus-visible:outline-offset-4">
			<div className="flex h-full flex-col justify-between gap-4 rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm transition-transform duration-200 group-hover:-translate-y-0.5 group-active:translate-y-0">
				<div className="flex items-start justify-between gap-3">
					<div><p className="text-xs font-semibold uppercase tracking-wider text-slate-700">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>
					<span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border-2 border-black bg-primary">{icon}</span>
				</div>
				<div className="flex items-center justify-between border-t-2 border-slate-200 pt-3 text-xs font-semibold text-slate-700">
					<span>{hint}</span><ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
				</div>
			</div>
		</Link>
	);
	const feed = (title: React.ReactNode, linkHref: string, linkLabel: React.ReactNode, icon: React.ReactNode, body: React.ReactNode) => (
		<Card className="space-y-4">
			<div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-display text-xl">{icon}{title}</h2><Link href={linkHref} className="text-sm font-bold underline">{linkLabel}</Link></div>
			{body}
		</Card>
	);
	return (
		<div className="mx-auto w-full max-w-[1600px] space-y-8 pt-2">
			<section className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
				<h1 className="text-2xl font-bold tracking-tight sm:text-3xl"><L id="teacher.welcome_back" />{' '}{adminName}!</h1>
				<div className="flex shrink-0 flex-wrap items-center gap-3">
					<Link href="/admin/users"><Button className="min-h-[44px] rounded-full border-2 border-black bg-primary text-xs font-bold text-black shadow-hard-sm hover:bg-primary/90"><Users className="me-1.5 h-4 w-4" /><L id="teacher.manage_users_groups" /></Button></Link>
					<Link href="/admin/submissions"><Button variant="outline" className="min-h-[44px] rounded-full border-2 border-black text-xs font-bold shadow-hard-sm"><CheckCircle2 className="me-1.5 h-4 w-4 text-green-800" /><L id="teacher.review_homework" />{metrics.pendingHomeworkCount ?? <L id="common.unavailable" />})</Button></Link>
				</div>
			</section>

			<section className={cn('m-list grid grid-cols-1 gap-4 sm:grid-cols-2', showWaitlist ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
				{tile('/admin/users', <L id="teacher.enrolled_students" />, count(metrics.totalStudents), <UserCheck className="h-6 w-6" />, <L id="teacher.active_approved" />)}
				{showWaitlist && tile('/admin/users', <L id="teacher.pending_waitlist" />, count(metrics.pendingWaitlistCount), <UserPlus className="h-6 w-6" />, <L id="teacher.needs_approval" />)}
				{tile('/admin/submissions', <L id="teacher.homework_to_grade" />, count(metrics.pendingHomeworkCount), <Clock className="h-6 w-6" />, <L id="teacher.pending_in_queue" />)}
				{tile(phase1 ? '/sessions-groups' : '/admin/users', <L id="teacher.active_groups" />, <CountUp value={metrics.activeGroupsCount} />, <Layers className="h-6 w-6" />, <L id="teacher.recurring_schedules" />)}
			</section>

			<section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{feed(<L id="teacher.latest_student_sign_ups" />, '/admin/users', <L id="teacher.view_all" />, <UserPlus aria-hidden className="h-5 w-5" />,
					phase1 ? <p role="status" className="text-sm text-slate-700"><L id="teacher.review_actual_pending_requests_in" />{' '}<Link href="/admin/users" className="font-bold underline"><L id="teacher.students_access" /></Link>.</p>
					: recentSignups.length === 0 ? <div className="py-8 text-center text-sm text-slate-700"><L id="teacher.no_recent_sign_ups_found" /></div>
					: <div className="m-list space-y-3">{recentSignups.map(s => (
						<div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3">
							<div className="flex min-w-0 items-center gap-3"><span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-black bg-primary text-sm font-bold">{(s.name || 'S').charAt(0)}</span>
								<div className="min-w-0"><p className="truncate text-sm font-bold">{s.name || <L id="common.applicant" />}</p><p className="truncate text-xs text-slate-700">{s.email}</p></div></div>
							<div className="flex shrink-0 items-center gap-2"><Chip tone={s.isApproved ? 'good' : 'warn'}><L id={s.isApproved ? 'teacher.approved' : 'teacher.pending'} /></Chip><span className="text-xs text-slate-700">{shortDate(s.createdAt)}</span></div>
						</div>))}</div>)}

				{feed(<L id="teacher.latest_homework_submissions" />, '/admin/submissions', <L id="teacher.view_queue" />, <Clock aria-hidden className="h-5 w-5" />,
					phase1 ? <p role="status" className="text-sm text-slate-700"><L id="teacher.open_the" />{' '}<Link href="/admin/submissions" className="font-bold underline"><L id="navigation.homework_queue" /></Link>{' '}<L id="teacher.for_submissions_requiring_correction" /></p>
					: recentSubmissions.length === 0 ? <div className="py-8 text-center text-sm text-slate-700"><L id="teacher.no_recent_homework_submissions_found" /></div>
					: <div className="m-list space-y-3">{recentSubmissions.map(sub => (
						<div key={sub.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3">
							<div className="min-w-0"><p className="truncate text-sm font-bold">{sub.userName || <L id="common.student" />}</p><p className="truncate text-xs text-slate-700">{sub.chapterTitle}</p></div>
							<div className="flex shrink-0 items-center gap-2"><Chip tone={sub.status === 'APPROVED' ? 'good' : 'warn'}><L id={sub.status === 'APPROVED' ? 'teacher.approved' : 'teacher.pending'} /></Chip><span className="text-xs text-slate-700">{shortDate(sub.createdAt)}</span></div>
						</div>))}</div>)}
			</section>
		</div>
	);
};

export default AdminHome;
