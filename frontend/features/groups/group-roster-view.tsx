'use client';

import type { GroupRosterViewProps } from '@/shared/contracts/dashboard';
export type { PeerMember, GroupRosterViewProps } from '@/shared/contracts/dashboard';

import Link from 'next/link';
import { StreamBubble } from './stream-bubble';
import {
	Users,
	CheckCircle2,
	Clock,
	AlertCircle,
	MapPin,
	Video,
} from 'lucide-react';
import { cn } from '@/shared/utils';
import { TextbookWaveTopRight, TextbookWaveBottomLeft } from '@/frontend/components/textbook-accent';
import UpcomingSession from '@/frontend/components/upcoming-session';



export const GroupRosterView = ({
 streamLabel,streamIcon,
 serverNow,
 privacySafe = false,
 mode,
 location,
	phase1 = false,
	groupName,
	nextSession,
	peers,
}: GroupRosterViewProps) => {

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 pb-16 pt-2 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
			{/* 1. UPCOMING SESSION & LOCATION HEADER (Textbook Frame Banner) */}
			<div className="relative overflow-hidden rounded-3xl bg-slate-900 border-2 border-cyan-500/40 text-white p-6 sm:p-8 shadow-xl">
				<TextbookWaveTopRight opacity={0.4} />

				<div className="relative z-10 space-y-6">
					{/* Group Badge & Title */}
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div className="space-y-1">
							<div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-300 border border-cyan-500/30">
								<Users className="h-3.5 w-3.5" />
								<span>Study Group Cohort</span>
							</div>
							<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
								{groupName}
							</h1>
						</div>

						{/* Classroom Location / Link Badges */}
						<div className="flex flex-wrap items-center gap-2.5">
							<div className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 px-3.5 py-2 text-xs font-medium text-slate-200">
								<MapPin className="h-4 w-4 text-cyan-400 shrink-0" />
								<span>{privacySafe ? (mode === 'center' ? location || 'Center / In-Person' : 'Online') : phase1 ? 'Course offering' : 'Class Location'}</span>
							</div>
							<div className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 px-3.5 py-2 text-xs font-medium text-slate-200">
								<StreamBubble label={streamLabel??'Live interactive stream'} icon={streamIcon??'video'}/>
							</div>
						</div>
					</div>

					{(!phase1 || nextSession) && <UpcomingSession
      serverNow={serverNow}
						session={nextSession}
						groupName={groupName}
						description="Finish your homework and have your notes ready before class."
						className="p-4 sm:p-5"
					/>}
				</div>
			</div>

			{/* 2. ENROLLED GROUP ROSTER & HOMEWORK SUBMISSION TRACKER */}
			{!privacySafe && <div className="relative overflow-hidden rounded-3xl border-2 border-black bg-white p-6 sm:p-8 shadow-hard-sm">
				<TextbookWaveBottomLeft opacity={0.2} />

				<div className="relative z-10 space-y-6">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-5">
						<div>
							<h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
								<Users className="h-5 w-5 text-green-800" />
								<span>{phase1 ? 'Offering Enrollment' : 'Enrolled Peer Roster'}</span>
							</h2>
							<p className="mt-1 text-xs sm:text-sm text-slate-500">
								{phase1 ? 'Authorized enrollment records for this offering.' : 'Live study group members and their latest homework submission status.'}
							</p>
						</div>

						<div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 w-fit">
							<span>{peers.length} Enrolled Students</span>
						</div>
					</div>

					{/* Peer List Table / Cards */}
					<div className="divide-y divide-slate-100">
						{peers.map((peer, idx) => {
							const initials = peer.name
								.split(' ')
								.map((n) => n[0])
								.filter(Boolean)
								.slice(0, 2)
								.join('')
								.toUpperCase() || 'ST';

							return (
								<div
									key={peer.id}
									className={cn(
										'py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors rounded-xl px-3 -mx-3',
										peer.isCurrentUser
											? 'bg-green-50/50 border border-cyan-200/60'
											: 'hover:bg-slate-50/70'
									)}
								>
									{/* Left: Student Identity */}
									<div className="flex items-center gap-3.5 min-w-0">
										<div className="flex items-center justify-center h-11 w-11 rounded-full bg-slate-900 text-cyan-300 font-bold text-sm shrink-0 border border-cyan-500/30 shadow-2xs">
											{initials}
										</div>

										<div className="min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="font-bold text-slate-900 text-sm truncate">
													{peer.name}
												</span>
												{peer.isCurrentUser && (
													<span className="inline-flex items-center px-2 py-0.2 rounded-md bg-cyan-100 text-cyan-800 text-[10px] font-extrabold uppercase">
														You
													</span>
												)}
											</div>
											<span className="text-xs text-slate-400 font-mono truncate block">
												{peer.email}
											</span>
										</div>
									</div>

									{/* Right: Latest Homework Submission Status */}
									<div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
										{phase1 ? <span className="text-xs text-slate-500">Enrollment: {peer.enrollmentStatus ?? "Unavailable"}</span> : peer.latestSubmission ? (
											<div className="flex items-center gap-2.5">
												<div className="text-right hidden sm:block">
													<p className="text-xs font-semibold text-slate-800 line-clamp-1 max-w-[200px]">
														{peer.latestSubmission.chapterTitle}
													</p>
													<p className="text-[11px] text-slate-400">
														Submitted {peer.latestSubmission.timeAgo}
													</p>
												</div>

												{peer.latestSubmission.status === 'APPROVED' ? (
													<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-50 text-green-900 border border-green-300 text-xs font-semibold shadow-2xs">
														<CheckCircle2 className="h-4 w-4 text-green-900 shrink-0" />
														<span>Approved</span>
													</span>
												) : peer.latestSubmission.status === 'PENDING_APPROVAL' ? (
													<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold shadow-2xs">
														<Clock className="h-4 w-4 text-amber-600 shrink-0" />
														<span>Under Review</span>
													</span>
												) : (
													<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold shadow-2xs">
														<AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
														<span>Resubmit</span>
													</span>
												)}
											</div>
										) : (
											<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 border-2 border-black/80 text-xs font-medium">
												<span>No submission yet</span>
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>}
		</div>
	);
};

export default GroupRosterView;
