'use client';

import type { StudentLesson } from '@/shared/contracts/dashboard';
export type { StudentLesson } from '@/shared/contracts/dashboard';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@/frontend/components/providers/v2-identity';
import {
	AlertCircle,
	ArrowUpRight,
	Atom,
	BookOpenCheck,
	CalendarClock,
	CheckCircle2,
	ChevronRight,
	CircleDashed,
	Clock,
	Clock3,
	Sparkles,
} from 'lucide-react';

import { cn } from '@/shared/utils';
import { getUpcomingGroupSessions } from '@/shared/group-schedule';
import { useGroupSummary } from '@/frontend/features/groups/use-group-summary';
import { useGroupSessions } from '@/frontend/features/groups/use-group-sessions';
import { TextbookWaveTopRight, TextbookWaveBottomLeft } from '@/frontend/components/textbook-accent';
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

const heroSlides = [
	{
		image: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Welcome to your classroom',
		title: 'EduLabs',
		description: 'Your lessons, homework, and progress, all in one place.',
		badge: 'Your Grade',
	},
	{
		image: 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Chapter by chapter',
		title: 'Course Highlight One',
		description: 'A short description of this course or topic goes here.',
		badge: 'Your Grade',
	},
	{
		image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Core foundations',
		title: 'Course Highlight Two',
		description: 'A short description of this course or topic goes here.',
		badge: 'Your Grade',
	},
	{
		image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Going deeper',
		title: 'Course Highlight Three',
		description: 'A short description of this course or topic goes here.',
		badge: 'Your Grade',
	},
	{
		image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Advanced curriculum',
		title: 'Course Highlight Four',
		description: 'A short description of this course or topic goes here.',
		badge: 'Your Grade',
	},
	{
		image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=80',
		eyebrow: 'Comprehensive practice',
		title: 'Exam Prep & High Scores',
		description: 'Tackle past exams and exercises with structured guidance.',
		badge: 'Your Grade',
	},
] as const;

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
	const { user } = useUser();
	const [activeSlide, setActiveSlide] = useState(0);
	const [isPaused, setIsPaused] = useState(false);
	const [dragOffset, setDragOffset] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const trackRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		axis: 'x' | 'y' | null;
	} | null>(null);

	const SWIPE_LOCK_PX = 8;
	const SWIPE_THRESHOLD_PX = 50;

	const goToSlide = (next: number) =>
		setActiveSlide((next + heroSlides.length) % heroSlides.length);

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		// Only primary button for mouse; any touch/pen contact
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			axis: null,
		};
		setIsPaused(true);
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;

		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;

		if (!drag.axis) {
			if (Math.abs(dx) < SWIPE_LOCK_PX && Math.abs(dy) < SWIPE_LOCK_PX) return;
			drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
			if (drag.axis === 'x') {
				// Capture only once we know it's a horizontal swipe so taps still work
				try {
					e.currentTarget.setPointerCapture(e.pointerId);
				} catch {}
				setIsDragging(true);
			}
		}

		if (drag.axis === 'x') {
			// Add resistance at the first/last edges
			const atStart = activeSlide === 0 && dx > 0;
			const atEnd = activeSlide === heroSlides.length - 1 && dx < 0;
			setDragOffset(atStart || atEnd ? dx * 0.35 : dx);
		}
	};

	const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		dragRef.current = null;

		if (drag.axis === 'x') {
			const dx = e.clientX - drag.startX;
			if (!cancelled && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
				const next = activeSlide + (dx < 0 ? 1 : -1);
				// Don't wrap with a swipe past the ends; clamp instead
				setActiveSlide(Math.min(Math.max(next, 0), heroSlides.length - 1));
			}
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {}
		}

		setIsDragging(false);
		setDragOffset(0);
		setIsPaused(false);
	};

	useEffect(() => {
		if (isPaused) return;

		const interval = window.setInterval(() => {
			setActiveSlide((slide) => (slide + 1) % heroSlides.length);
		}, 4000);

		return () => window.clearInterval(interval);
	}, [isPaused]);

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
			{/* Top Hero Carousel */}
			<section
				className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 shadow-sm"
				onMouseEnter={() => setIsPaused(true)}
				onMouseLeave={() => setIsPaused(false)}
			>
				<div
					ref={trackRef}
					className={cn(
						'flex select-none [touch-action:pan-y]',
						isDragging ? 'cursor-grabbing' : 'cursor-grab transition-transform duration-700 ease-out'
					)}
					style={{
						transform: `translateX(calc(-${activeSlide * 100}% + ${dragOffset}px))`,
					}}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={(e) => endDrag(e)}
					onPointerCancel={(e) => endDrag(e, true)}
				>
					{heroSlides.map((slide, index) => (
						<div
							className="relative min-w-full overflow-hidden px-6 py-10 sm:px-10 md:min-h-[300px] md:py-16 text-white"
							key={slide.title}
						>
							{/* Background Image */}
							<Image
								src={slide.image}
								alt={slide.title}
								fill
								priority={index === 0}
								draggable={false}
								sizes="(max-width: 1200px) 100vw, 1600px"
								className="object-cover"
							/>

							{/* Dark overlay for readability */}
							<div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/70 to-slate-950/30 backdrop-brightness-90" />

							{/* Slide Content */}
							<div className="relative z-10 flex max-w-2xl flex-col gap-3.5">
								<div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
									<Sparkles className="h-4 w-4" />
									{slide.eyebrow}
								</div>
								<h1 className="text-2xl font-bold tracking-tight sm:text-4xl text-white">
									{slide.title}
								</h1>
								<p className="max-w-xl text-sm sm:text-base text-slate-200 leading-relaxed">
									{slide.description}
								</p>
								<span className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-white/15 backdrop-blur-xs px-3.5 py-1.5 text-xs sm:text-sm font-medium ring-1 ring-white/25 text-white">
									{slide.badge} <ArrowUpRight className="h-4 w-4" />
								</span>
							</div>

							<Atom
								aria-hidden="true"
								className="absolute bottom-6 right-6 h-24 w-24 text-white/20 sm:h-36 sm:w-36 pointer-events-none"
								strokeWidth={1}
							/>
						</div>
					))}
				</div>

				{/* Clickable Indicator Dots */}
				<div className="absolute bottom-4 inset-x-0 z-20 flex justify-center items-center gap-2">
					{heroSlides.map((slide, index) => (
						<button
							aria-label={`Go to slide ${index + 1}`}
							aria-pressed={activeSlide === index}
							className={cn(
								'h-2.5 rounded-full transition-all duration-300 cursor-pointer',
								activeSlide === index
									? 'w-8 bg-white shadow-md'
									: 'w-2.5 bg-white/40 hover:bg-white/80'
							)}
							key={slide.title}
							onClick={() => goToSlide(index)}
							type="button"
						/>
					))}
				</div>
			</section>

			{/* LIVE SESSION & HOMEWORK REMINDER BANNER */}
			<section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
				<div className="flex min-w-0 flex-col justify-between gap-6 xl:flex-row xl:items-center">
					{phase1 && liveGroups.error && <p role="alert" className="text-sm text-red-700">{liveGroups.error} <button className="underline" onClick={liveGroups.retry}>Retry schedule</button></p>}
					{phase1 && liveGroups.loading && <p role="status" className="text-sm text-slate-500">Loading your class schedule…</p>}
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
								<div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
									<CheckCircle2 className="h-6 w-6" />
								</div>
								<div className="space-y-0.5">
									<span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
										<CheckCircle2 className="h-3 w-3" />
										Homework Approved
									</span>
									<p className="text-xs text-slate-600">
										{homeworkInfo.chapterTitle} verified! Great job.
									</p>
								</div>
							</>
						) : homeworkInfo?.status === 'PENDING_APPROVAL' ? (
							<>
								<div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-700 shrink-0">
									<Clock3 className="h-6 w-6" />
								</div>
								<div className="space-y-0.5">
									<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
										<Clock className="h-3 w-3" />
										Homework Submitted — Pending Review
									</span>
									<p className="text-xs text-slate-600">
										Under review for {homeworkInfo.chapterTitle}.
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
										{phase1 ? (attendance.loading?"Loading homework…":attendance.error?"Homework unavailable":attendance.data?.pendingHomework?`${attendance.data.pendingHomework} homework awaiting submission`:"No pending homework") : "Homework Pending — Upload before your next session!"}
									</span>
									<p className="text-xs text-slate-600">
										{phase1 ? <>Current authorized assignments only. {attendance.error&&<button className="underline" onClick={attendance.refresh}>Retry</button>}</> : <>Submit textbook photos for {homeworkInfo?.chapterTitle || 'current lesson'}.</>}
									</p>
									{homeworkInfo?.chapterUrl && (
										<Link
											href={homeworkInfo.chapterUrl}
											className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800 hover:underline pt-0.5"
										>
											Upload Homework Now &rarr;
										</Link>
									)}
								</div>
							</>
						)}
					</div>
				</div>
			</section>

			<section className="space-y-5">
				<div>
					<h2 className="text-2xl font-bold tracking-tight text-slate-950">Hey {firstName}!</h2>
					<p className="mt-1 text-sm text-slate-500">Here&apos;s your learning journey</p>
				</div>

				<div className="grid gap-4 md:grid-cols-3">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium text-slate-500">Lessons Done</p>
								<p className="mt-2 text-2xl font-bold text-slate-950">
									{summaryAvailable ? completedLessons : "Unavailable"} / {summaryAvailable ? lessons.length : "Unavailable"}{' '}
									<span className="text-base font-medium text-slate-500">Lessons</span>
								</p>
							</div>
							<span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-50 text-sky-700">
								<BookOpenCheck className="h-5 w-5" />
							</span>
						</div>
					</div>

					{[
						{ label: 'Sessions Attended', value:attendance.data?.own.attended, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' },
						{ label: 'Sessions Absent', value:attendance.data?.own.absent, icon: CalendarClock, tone: 'bg-violet-50 text-violet-600' },
					].map(({ label, value, icon: Icon, tone }) => (
						<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default" key={label}>
							<div className="flex items-start justify-between gap-4">
								<div>
									<p className="text-sm font-medium text-slate-500">{label}</p>
									<p className="mt-2 text-lg font-semibold text-slate-950">{phase1&&attendance.loading?'Loading…':value??'Unavailable'}</p>
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
					<h2 className="text-xl font-bold text-slate-950">Your Journey</h2>
					<span className="text-sm text-slate-500">{summaryAvailable ? discoveryCount : "Unavailable"} lessons available</span>
				</div>

				<div className="flex gap-4 overflow-x-auto py-2 pb-4">
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
							{discoveryLessonIds ? 'No lessons match this discovery filter. Choose All My Courses to view your other lessons.' : 'Your lessons will appear here as soon as they are published.'}
						</div>
					)}
				</div>
			</section>

			<section className="grid gap-6 lg:grid-cols-2">
				<div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0">
					<TextbookWaveBottomLeft opacity={0.2} />
					<div className="relative z-10">
						<h2 className="text-xl font-bold text-slate-950">Progress Overview</h2>
					<div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
						<div
							className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
							style={{
								background: `conic-gradient(var(--progress-accent, #0284c7) ${summaryAvailable ? `${progress}%` : "Unavailable"}, var(--progress-track, #e2e8f0) 0)`,
							}}
						>
							<div className="grid h-[108px] w-[108px] place-items-center rounded-full bg-white text-center">
								<span className="text-2xl font-bold text-slate-950">{progress}%</span>
								<span className="text-xs text-slate-500">complete</span>
							</div>
						</div>
						<div>
							<p className="text-2xl font-bold text-slate-950">
								{summaryAvailable ? completedLessons : "Unavailable"} <span className="text-base font-medium text-slate-500">of {summaryAvailable ? lessons.length : "Unavailable"} lessons</span>
							</p>
							<p className="mt-2 text-sm leading-6 text-slate-500">
								Every completed lesson moves your overall journey forward.
							</p>
						</div>
					</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-xl font-bold text-slate-950">Upcoming Sessions</h2>
						<CalendarClock className="h-5 w-5 text-sky-700" />
					</div>
					<div className="mt-5 max-h-60 space-y-3 overflow-y-auto pr-1">
						{phase1 && (liveGroups.error || liveGroups.loading) ? <p role={liveGroups.error ? 'alert' : 'status'} className="text-sm text-slate-500">{liveGroups.error || 'Loading your class schedule…'}</p> : upcomingSessions.length ? (
							upcomingSessions.map((session) => (
								<div
									className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4"
									key={`${session.dayLabel}-${session.dateLabel}`}
								>
									<span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-sky-700 shadow-sm">
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
								<p className="mt-3 text-sm font-medium text-slate-700">No upcoming sessions yet</p>
								<p className="mt-1 text-xs text-slate-500">
									Your group schedule will appear here when it is available.
								</p>
							</div>
						)}
					</div>
				</div>
			</section>
		</div>
	);
};

export default StudentHome;
