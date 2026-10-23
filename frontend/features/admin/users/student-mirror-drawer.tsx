'use client';

import { useEffect, useState } from 'react';
import { api } from '@/frontend/lib/api';
import {
	BookOpen,
	Calendar,
	CheckCircle2,
	Clock,
	ExternalLink,
	FileText,
	Layers,
	Loader2,
	Mail,
	User,
	XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/frontend/components/ui/sheet';
import { Button } from '@/frontend/components/ui/button';
import { getNextUpcomingSession, type UpcomingGroupSession } from '@/shared/group-schedule';

interface StudentProfileData {
	student: {
		id: string;
		name: string;
		email: string;
		imageUrl: string;
		role: string;
		createdAt?: string;
	};
	group: {
		id: string;
		name: string;
		schedule: any;
	} | null;
	homeworkSubmissions: Array<{
		id: string;
		fileUrl: string;
		status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
		approvedBy: string | null;
		createdAt: string;
		chapter: {
			id: string;
			title: string;
			position: number;
			course: {
				id: string;
				title: string;
				chapterNumber: number | null;
			};
		};
	}>;
	progress: {
		totalLessons: number;
		completedLessons: number;
		totalChapters: number;
		completedChapters: number;
		completionPercentage: number;
	};
}

interface StudentMirrorDrawerProps {
	studentId: string | null;
	isOpen: boolean;
	onClose: () => void;
	onSubmissionUpdated?: () => void;
}

export const StudentMirrorDrawer = ({
	studentId,
	isOpen,
	onClose,
	onSubmissionUpdated,
}: StudentMirrorDrawerProps) => {
	const [data, setData] = useState<StudentProfileData | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen && studentId) {
			setIsLoading(true);
			api
				.get(`/api/admin/students/${studentId}`)
				.then((res) => {
					setData(res.data);
				})
				.catch((err) => {
					console.error(err);
					toast.error('Failed to load student profile summary.');
				})
				.finally(() => {
					setIsLoading(false);
				});
		} else {
			setData(null);
		}
	}, [isOpen, studentId]);

	const onApproveSubmission = async (submissionId: string) => {
		try {
			setActionLoadingId(submissionId);
			await api.patch('/api/admin/submissions', {
				id: submissionId,
				status: 'APPROVED',
			});
			toast.success('Homework approved!');
			if (data) {
				setData({
					...data,
					homeworkSubmissions: data.homeworkSubmissions.map((s) =>
						s.id === submissionId ? { ...s, status: 'APPROVED' } : s
					),
				});
			}
			onSubmissionUpdated?.();
		} catch {
			toast.error('Failed to approve homework.');
		} finally {
			setActionLoadingId(null);
		}
	};

	const nextSession: UpcomingGroupSession | null = data?.group
		? getNextUpcomingSession(data.group.name, data.group.schedule)
		: null;

	return (
		<Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side="right"
				className="w-full sm:max-w-xl overflow-y-auto bg-slate-50 p-0 text-slate-900 border-l border-slate-200"
			>
				<SheetHeader className="p-6 bg-white border-b border-slate-200 sticky top-0 z-10">
					<div className="flex items-center gap-2 text-green-900 font-semibold text-xs uppercase tracking-wider">
						<User className="h-4 w-4" />
						Student Dashboard Mirror
					</div>
					<SheetTitle className="text-xl font-bold text-slate-900">
						{isLoading ? 'Loading profile...' : data?.student.name || 'Student Profile'}
					</SheetTitle>
					<SheetDescription className="text-xs text-slate-500">
						Real-time mirrored overview of schedule, homework status, and curriculum progress.
					</SheetDescription>
				</SheetHeader>

				{isLoading ? (
					<div className="flex min-h-[350px] items-center justify-center p-8">
						<Loader2 className="h-8 w-8 animate-spin text-green-900" />
					</div>
				) : !data ? (
					<div className="p-6 text-center text-slate-500">
						No student profile data found.
					</div>
				) : (
					<div className="p-6 space-y-6">
						{/* Basic Info Pill Card */}
						<div className="flex items-center gap-4 rounded-2xl border-2 border-black bg-white p-4 shadow-hard-sm">
							{data.student.imageUrl ? (
								<img
									src={data.student.imageUrl}
									alt={data.student.name}
									className="h-14 w-14 rounded-full border-2 border-black object-cover shadow-2xs"
								/>
							) : (
								<div className="grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-900 font-bold text-xl">
									{data.student.name.charAt(0) || 'S'}
								</div>
							)}
							<div className="space-y-1 min-w-0">
								<h3 className="font-bold text-slate-900 text-base truncate">
									{data.student.name}
								</h3>
								<div className="flex items-center gap-1.5 text-xs text-slate-500">
									<Mail className="h-3.5 w-3.5 text-slate-400" />
									<span className="truncate">{data.student.email || 'No email registered'}</span>
								</div>
								<div className="flex items-center gap-2 pt-0.5">
									<span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-900 border border-green-300">
										Role: {data.student.role}
									</span>
								</div>
							</div>
						</div>

						{/* Mirror Section 1: Assigned Group & Session Schedule */}
						<div className="rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm space-y-4">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Calendar className="h-4 w-4 text-green-900" />
									<h4 className="font-bold text-slate-900 text-sm">
										Assigned Group &amp; Schedule
									</h4>
								</div>
								{data.group ? (
									<span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-900 border border-slate-300">
										{data.group.name}
									</span>
								) : (
									<span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
										Unassigned
									</span>
								)}
							</div>

							{data.group ? (
								<div className="space-y-3">
									{nextSession && (
										<div className="rounded-xl border border-slate-300 bg-green-50/70 p-3">
											<span className="text-[10px] font-bold uppercase tracking-wider text-green-900">
												Upcoming Session
											</span>
											<p className="text-sm font-semibold text-slate-900 mt-0.5">
												Next Session: {nextSession.fullFormatted}
											</p>
										</div>
									)}

									{/* List configured schedule times */}
									{Array.isArray(data.group.schedule) && data.group.schedule.length > 0 ? (
										<div className="space-y-1.5">
											<span className="text-xs font-semibold text-slate-600">
												Weekly Meeting Pattern:
											</span>
											<div className="flex flex-wrap gap-2">
												{data.group.schedule.map((item: any, idx: number) => (
													<span
														key={idx}
														className="inline-flex items-center gap-1.5 rounded-lg border-2 border-black bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
													>
														<Clock className="h-3 w-3 text-slate-400" />
														{item.day} @ {item.time}
													</span>
												))}
											</div>
										</div>
									) : (
										<p className="text-xs text-slate-500 italic">
											Standard meeting schedule: {data.group.name}
										</p>
									)}
								</div>
							) : (
								<p className="text-xs text-slate-500">
									Student has not been assigned to a study group yet.
								</p>
							)}
						</div>

						{/* Mirror Section 2: Overall Lesson Completion Percentage */}
						<div className="rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm space-y-4">
							<div className="flex items-center gap-2">
								<BookOpen className="h-4 w-4 text-green-900" />
								<h4 className="font-bold text-slate-900 text-sm">
									Curriculum Progress Overview
								</h4>
							</div>

							<div className="flex items-center gap-5">
								<div
									className="grid h-24 w-24 shrink-0 place-items-center rounded-full shadow-2xs"
									style={{
										background: `conic-gradient(#0284c7 ${data.progress.completionPercentage}%, #e2e8f0 0)`,
									}}
								>
									<div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white text-center shadow-inner">
										<span className="text-lg font-bold text-slate-900 leading-tight">
											{data.progress.completionPercentage}%
										</span>
										<span className="text-[10px] text-slate-400 -mt-1">Done</span>
									</div>
								</div>

								<div className="space-y-1">
									<p className="text-sm font-bold text-slate-900">
										{data.progress.completedLessons} of {data.progress.totalLessons} Lessons Finished
									</p>
									<p className="text-xs text-slate-500">
										{data.progress.completedChapters} of {data.progress.totalChapters} Total Chapters / Segments completed
									</p>
								</div>
							</div>
						</div>

						{/* Mirror Section 3: Homework Submissions Logs & Approval States */}
						<div className="rounded-2xl border-2 border-black bg-white p-5 shadow-hard-sm space-y-4">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<FileText className="h-4 w-4 text-green-900" />
									<h4 className="font-bold text-slate-900 text-sm">
										Homework Submissions ({data.homeworkSubmissions.length})
									</h4>
								</div>
							</div>

							{data.homeworkSubmissions.length === 0 ? (
								<p className="text-xs text-slate-500 italic py-2">
									No homework submissions uploaded yet.
								</p>
							) : (
								<div className="space-y-3">
									{data.homeworkSubmissions.map((sub) => {
										const isApproved = sub.status === 'APPROVED';
										const isPending = sub.status === 'PENDING_APPROVAL';

										return (
											<div
												key={sub.id}
												className="rounded-xl border-2 border-black bg-slate-50/60 p-3.5 space-y-2.5 transition hover:bg-slate-50"
											>
												<div className="flex items-start justify-between gap-2">
													<div className="space-y-0.5">
														<span className="text-[10px] font-bold uppercase tracking-wider text-green-900">
															{sub.chapter.course?.title || 'Lesson'}
														</span>
														<p className="text-xs font-semibold text-slate-900 line-clamp-1">
															{sub.chapter.title}
														</p>
													</div>

													{isApproved ? (
														<span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-900 border border-green-300 shrink-0">
															<CheckCircle2 className="h-3.5 w-3.5 text-green-900" />
															Approved
														</span>
													) : isPending ? (
														<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200 shrink-0">
															<Clock className="h-3.5 w-3.5 text-amber-600" />
															Pending Review
														</span>
													) : (
														<span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200 shrink-0">
															<XCircle className="h-3.5 w-3.5 text-rose-600" />
															Rejected
														</span>
													)}
												</div>

												<div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
													<span className="text-[11px] text-slate-400">
														{new Date(sub.createdAt).toLocaleDateString('en-US', {
															month: 'short',
															day: 'numeric',
															hour: 'numeric',
															minute: '2-digit',
														})}
													</span>

													<div className="flex items-center gap-2">
														<a
															href={sub.fileUrl}
															target="_blank"
															rel="noopener noreferrer"
															className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-900 hover:text-green-900 hover:underline"
														>
															<ExternalLink className="h-3 w-3" />
															View File
														</a>

														{isPending && (
															<Button
																size="sm"
																disabled={actionLoadingId === sub.id}
																onClick={() => onApproveSubmission(sub.id)}
																className="h-7 text-xs bg-primary hover:bg-primary/90 text-black border-2 border-black font-semibold shadow-hard-sm"
															>
																{actionLoadingId === sub.id ? (
																	<Loader2 className="h-3 w-3 animate-spin" />
																) : (
																	'Approve'
																)}
															</Button>
														)}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
};
