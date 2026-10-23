'use client';

import { L, useLanguage } from '@/frontend/components/language-provider';
import type { StudentLesson } from '@/shared/contracts/dashboard';
export type { StudentLesson } from '@/shared/contracts/dashboard';

import Link from 'next/link';
import { useMemo } from 'react';
import { useUser } from '@/frontend/components/providers/v2-identity';
import { AlertCircle, BookOpenCheck, CalendarClock, CheckCircle2, CircleDashed, Clock, Clock3 } from 'lucide-react';

import { cn } from '@/shared/utils';
import { PageHeader } from '@/frontend/components/page-kit';
import { getUpcomingGroupSessions } from '@/shared/group-schedule';
import { useGroupSummary } from '@/frontend/features/groups/use-group-summary';
import { useGroupSessions } from '@/frontend/features/groups/use-group-sessions';
import { TextbookWaveBottomLeft } from '@/frontend/components/textbook-accent';
import UpcomingSession from '@/frontend/components/upcoming-session';
import { LessonCard, getLessonCardStatus } from '@/frontend/features/courses/lesson-card';
import { chapterKey } from '@/shared/chapter-label';


interface StudentHomeProps {
	phase1?: boolean;
	summaryAvailable?: boolean;
	lessons: StudentLesson[];
	discoveryLessonIds?: string[];
	groupName: string | null;
	groupSchedule?: any;
	homeworkInfo?: {
		status: 'APPROVED' | 'PENDING_APPROVAL' | 'PENDING' | 'REJECTED';
		chapterTitle: string;
		chapterUrl?: string;
	} | null;
}



const getLessonStatus = (lesson: StudentLesson) => {
	if (lesson.chapters.length === 0) return 'Locked' as const;
	if (lesson.chapters.every((chapter) => chapter.isCompleted)) {
		return 'Completed' as const;
	}
	if (lesson.chapters.some((chapter) => chapter.isCompleted)) {
		return 'In Progress' as const;
	}
	return 'In Progress' as const;
};

const StudentHome = ({
	lessons,
	discoveryLessonIds,
	summaryAvailable = true,
	phase1 = false,
	groupName,
	groupSchedule,
	homeworkInfo,
}: StudentHomeProps) => {
 const { ui, t, direction } = useLanguage();
	const { user } = useUser();


	const completedLessons = lessons.filter(
		(lesson) => getLessonStatus(lesson) === 'Completed'
	).length;
	const discoveryCount = discoveryLessonIds ? lessons.filter(l=>discoveryLessonIds.includes(l.id)).length : lessons.length;
	const progress = lessons.length
		? Math.round((completedLessons / lessons.length) * 100)
		: 0;
	const firstName = user?.firstName || user?.username?.split(' ')[0] || 'there';
	const liveGroups = useGroupSessions(phase1);
 const attendance=useGroupSummary(phase1);
	const legacySessions = useMemo(
		() => getUpcomingGroupSessions(groupName, groupSchedule),
		[groupName, groupSchedule]
	);
	const upcomingSessions = phase1 ? liveGroups.sessions : legacySessions;
	const nextSession = upcomingSessions[0] || null;

	// Lesson numbers restart at 1 inside each chapter (scoped by chapter type + number),
	// instead of using the course-wide array index.
	const lessonNumbers = useMemo(() => {
		const counters = new Map<string, number>();
		return lessons.map((lesson) => {
			const key = lesson.groupKey ?? chapterKey(lesson.chapterType, lesson.chapterNumber);
			const next = (counters.get(key) ?? 0) + 1;
			counters.set(key, next);
			return next;
		});
	}, [lessons]);

	return (
		<div className="mx-auto w-full max-w-[1600px] space-y-8 pt-2">
			<PageHeader icon={<BookOpenCheck aria-hidden className="h-7 w-7" />} title={<><L id="home.hey"/>{" "}<bdi dir="auto">{firstName}</bdi>!</>} subtitle={<L id="home.here_s_your_learning_journey"/>} />

			{/* LIVE SESSION & HOMEWORK REMINDER BANNER */}
			<section className="rounded-3xl border-2 border-black bg-white p-5 shadow-hard-sm sm:p-6">
				<div className="flex min-w-0 flex-col justify-between gap-6 xl:flex-row xl:items-center">
					{phase1 && liveGroups.error && <p role="alert" className="text-sm text-red-700">{liveGroups.error} <button className="underline" onClick={liveGroups.retry}><L id="home.retry_schedule"/></button></p>}
					{phase1 && liveGroups.loading && <p role="status" className="text-sm text-slate-500"><L id="home.loading_your_class_schedule"/></p>}
					{(!phase1 || (!liveGroups.error && !liveGroups.loading)) && <UpcomingSession
						serverNow={phase1 ? liveGroups.serverNow : undefined}
						session={nextSession}
						groupName={phase1 ? liveGroups.sessions[0]?.group_name ?? null : groupName}
						className="flex-1"
					/>}

					{/* Right: Homework Status Badge */}
					<div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-3.5 p-4 rounded-2xl border bg-slate-50/80">
						{homeworkInfo?.status === 'APPROVED' ? (
							<>
								<div className="grid h-11 w-11 place-items-center rounded-xl bg-green-100 text-green-900 shrink-0">
									<CheckCircle2 className="h-6 w-6" />
								</div>
								<div className="space-y-0.5">
									<span className="inline-flex items-center gap-1 rounded-full bg-green-100/90 px-2.5 py-0.5 text-xs font-bold text-green-900">
										<CheckCircle2 className="h-3 w-3" /><L id="home.homework_approved"/></span>
									<p className="text-xs text-slate-600">
										{homeworkInfo.chapterTitle}{" "}<L id="home.verified_great_job"/></p>
								</div>
							</>
						) : homeworkInfo?.status === 'PENDING_APPROVAL' ? (
							<>
								<div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700 shrink-0">
									<Clock3 className="h-6 w-6" />
								</div>
								<div className="space-y-0.5">
									<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
										<Clock className="h-3 w-3" /><L id="home.homework_submitted_pending_review"/></span>
									<p className="text-xs text-slate-600"><L id="home.under_review_for"/>{" "}{homeworkInfo.chapterTitle}.
									</p>
								</div>
							</>
						) : (
							<>
								<div className="grid h-11 w-11 place-items-center rounded-xl bg-rose-100 text-rose-700 shrink-0">
									<AlertCircle className="h-6 w-6" />
								</div>
								<div className="space-y-1">
									<span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
										<AlertCircle className="h-3 w-3" />
										{phase1 ? (attendance.loading?<L id="home.loadingHomework"/>:attendance.error?<L id="home.homeworkUnavailable"/>:attendance.data?.pendingHomework?<L id="home.pendingCount" values={{count:attendance.data.pendingHomework}}/>:<L id="home.noneHomework"/>) : <L id="home.pendingHomework"/>}
									</span>
									<p className="text-xs text-slate-600">
										{phase1 ? <><L id="home.current_authorized_assignments_only"/>{" "}{attendance.error&&<button className="underline" onClick={attendance.refresh}><L id="home.retry"/></button>}</> : <><L id="home.submit_textbook_photos_for"/>{" "}{homeworkInfo?.chapterTitle || <L id="home.currentLesson"/>}.</>}
									</p>
									{homeworkInfo?.chapterUrl && (
										<Link
											href={homeworkInfo.chapterUrl}
											className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800 hover:underline pt-0.5"
										><L id="home.upload_homework_now"/></Link>
									)}
								</div>
							</>
						)}
					</div>
				</div>
			</section>

			<section className="space-y-5">
				<div className="m-list grid gap-4 md:grid-cols-3">
					<div className="rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium text-slate-500"><L id="home.lessons_done"/></p>
								<p className="mt-2 text-2xl font-bold text-slate-950">
									{summaryAvailable ? completedLessons : <L id="common.unavailable"/>} / {summaryAvailable ? lessons.length : <L id="common.unavailable"/>}{' '}
									<span className="text-base font-medium text-slate-500"><L id="home.lessons"/></span>
								</p>
							</div>
							<span className="grid h-11 w-11 place-items-center rounded-xl bg-green-50 text-green-900">
								<BookOpenCheck className="h-5 w-5" />
							</span>
						</div>
					</div>

					{[
						{ label: 'Sessions Attended', value:attendance.data?.own.attended, icon: CheckCircle2, tone: 'bg-green-50 text-green-900' },
						{ label: 'Sessions Absent', value:attendance.data?.own.absent, icon: CalendarClock, tone: 'bg-violet-50 text-violet-600' },
					].map(({ label, value, icon: Icon, tone }) => (
						<div className="rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm" key={label}>
							<div className="flex items-start justify-between gap-4">
								<div>
									<p className="text-sm font-medium text-slate-500"><L text={label}/></p>
									<p className="mt-2 text-lg font-semibold text-slate-950">{phase1&&attendance.loading?<L id="common.loading"/>:value??<L id="common.unavailable"/>}</p>
								</div>
								<span className={cn('grid h-11 w-11 place-items-center rounded-xl', tone)}>
									<Icon className="h-5 w-5" />
								</span>
							</div>
						</div>
					))}
				</div>
			</section>

			<section>
				<div className="mb-4 flex items-center justify-between gap-4">
					<h2 className="text-xl font-bold text-slate-950"><L id="home.your_journey"/></h2>
					<span className="text-sm text-slate-500">{summaryAvailable ? discoveryCount : <L id="common.unavailable"/>}{" "}<L id="home.lessons_available"/></span>
				</div>

				<div className="m-list flex gap-4 overflow-x-auto py-2 pb-4">
					{discoveryCount ? (
						lessons.map((lesson, index) => {
							if (discoveryLessonIds && !discoveryLessonIds.includes(lesson.id)) return null;
							const firstChapter = lesson.chapters[0];
							return (
								<div className="w-72 shrink-0" key={lesson.id}>
									<LessonCard
										href={lesson.href === null ? undefined : lesson.href ?? (firstChapter ? `/courses/${lesson.id}/chapters/${firstChapter.id}` : undefined)}
										chapterType={lesson.chapterType ?? 'Chapter'}
										chapterNumber={lesson.chapterNumber}
										lessonNumber={lessonNumbers[index]}
										title={lesson.title}
										description={lesson.description}
										imageUrl={lesson.imageUrl}
										partsCount={lesson.partsCount === undefined ? lesson.chapters.length : lesson.partsCount}
										status={lesson.status ?? getLessonCardStatus(lesson.chapters)}
									/>
								</div>
							);
						})
					) : (
						<div className="flex min-h-[174px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
							{discoveryLessonIds ? <L id="learning.noFilter"/> : <L id="learning.noPublished"/>}
						</div>
					)}
				</div>
			</section>

			<section className="grid gap-6 lg:grid-cols-2">
				<div className="relative overflow-hidden rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm">
					<TextbookWaveBottomLeft opacity={0.2} />
					<div className="relative z-10">
						<h2 className="text-xl font-bold text-slate-950"><L id="home.progress_overview"/></h2>
					<div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
						<div
							className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
							style={{
								background: `conic-gradient(var(--progress-accent, #16a34a) ${summaryAvailable ? `${progress}%` : "Unavailable"}, var(--progress-track, #e2e8f0) 0)`,
							}}
						>
							<div className="grid h-[108px] w-[108px] place-items-center rounded-full bg-white text-center">
								<span className="text-2xl font-bold text-slate-950">{progress}%</span>
								<span className="text-xs text-slate-500"><L id="home.complete"/></span>
							</div>
						</div>
						<div>
							<p className="text-2xl font-bold text-slate-950">
								{summaryAvailable ? completedLessons : <L id="common.unavailable"/>} <span className="text-base font-medium text-slate-500"><L id="home.of"/>{" "}{summaryAvailable ? lessons.length : <L id="common.unavailable"/>}{" "}<L id="home.lessons_"/></span>
							</p>
							<p className="mt-2 text-sm leading-6 text-slate-500"><L id="home.every_completed_lesson_moves_your"/></p>
						</div>
					</div>
					</div>
				</div>

				<div className="rounded-2xl border-2 border-black bg-white p-6 shadow-hard-sm">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-xl font-bold text-slate-950"><L id="home.upcoming_sessions"/></h2>
						<CalendarClock className="h-5 w-5 text-green-900" />
					</div>
					<div className="mt-5 max-h-60 space-y-3 overflow-y-auto pr-1">
						{phase1 && (liveGroups.error || liveGroups.loading) ? <p role={liveGroups.error ? 'alert' : 'status'} className="text-sm text-slate-500">{liveGroups.error || <L id="home.loading_your_class_schedule"/>}</p> : upcomingSessions.length ? (
							upcomingSessions.map((session) => (
								<div
									className="flex items-center gap-3 rounded-xl border-2 border-black bg-slate-50 p-4"
									key={`${session.dayLabel}-${session.dateLabel}`}
								>
									<span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-green-900 shadow-sm">
										<Clock3 className="h-5 w-5" />
									</span>
									<div>
										<p className="font-semibold text-slate-900">{session.dayLabel} @ {session.timeLabel}</p>
										<p className="text-sm text-slate-500">{session.dateLabel}{groupName ? ` · ${groupName}` : ''}</p>
									</div>
								</div>
							))
						) : (
							<div className="flex min-h-[142px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 text-center">
								<CircleDashed className="h-8 w-8 text-slate-400" />
								<p className="mt-3 text-sm font-medium text-slate-700"><L id="home.no_upcoming_sessions_yet"/></p>
								<p className="mt-1 text-xs text-slate-500"><L id="home.your_group_schedule_will_appear"/></p>
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	);
};

export default StudentHome;
