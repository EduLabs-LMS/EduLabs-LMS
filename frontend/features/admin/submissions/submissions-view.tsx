'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/frontend/lib/api';
import {
	Check,
	CheckCircle2,
	Clock,
	ExternalLink,
	Eye,
	Filter,
	Layers,
	Loader2,
	MessageSquare as MessageSquareText,
	RefreshCw,
	Search,
	ShieldCheck,
	User,
	Users,
	XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { cn } from '@/shared/utils';
import { StudentMirrorDrawer } from '@/frontend/features/admin/users/student-mirror-drawer';

interface EnrichedSubmission {
	id: string;
	userId: string;
	userName: string | null;
	studentName: string;
	studentEmail: string;
	studentImage?: string;
	groupName: string;
	groupId: string | null;
	chapterId: string;
	fileUrl: string;
	status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
	approvedBy: string | null;
	reviewNote?: string | null;
	reviewerName?: string | null;
	createdAt: string;
	updatedAt: string;
	chapter: {
		id: string;
		title: string;
		position: number;
		course?: {
			id: string;
			title: string;
			chapterNumber: number | null;
		};
	};
}

interface GroupOption {
	id: string;
	name: string;
}

interface ChapterOption {
	id: string;
	title: string;
	contentType?: string | null;
	course?: {
		title: string;
		chapterNumber: number | null;
	};
}

export const SubmissionsView = () => {
	const [submissions, setSubmissions] = useState<EnrichedSubmission[]>([]);
	const [groups, setGroups] = useState<GroupOption[]>([]);
	const [chapters, setChapters] = useState<ChapterOption[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// Action loading states
	const [actionId, setActionId] = useState<string | null>(null);

	// Filters
	const [selectedGroupId, setSelectedGroupId] = useState('ALL');
	const [selectedChapterId, setSelectedChapterId] = useState('ALL');
	const [selectedStatus, setSelectedStatus] = useState('ALL');
	const [searchQuery, setSearchQuery] = useState('');

	// Strictly filter for homework segments only (no pure explanation videos like P1, P2)
	const homeworkChapters = useMemo(() => {
		return chapters.filter(
			(ch) =>
				ch.contentType === 'HOMEWORK_ASSIGNMENT' ||
				/homework|hw|assignment/i.test(ch.title)
		);
	}, [chapters]);

	// File Preview Modal
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewTitle, setPreviewTitle] = useState<string>('');
	const [previewSubmission, setPreviewSubmission] = useState<EnrichedSubmission | null>(null);
	const [noteDraft, setNoteDraft] = useState('');

	const openPreview = (sub: EnrichedSubmission) => {
		setPreviewUrl(sub.fileUrl);
		setPreviewTitle(`${sub.studentName} — ${sub.chapter.title}`);
		setPreviewSubmission(sub);
		setNoteDraft(sub.reviewNote ?? '');
	};

	const closePreview = () => {
		setPreviewUrl(null);
		setPreviewSubmission(null);
		setNoteDraft('');
	};

	// Student Profile Mirror Drawer
	const [mirrorStudentId, setMirrorStudentId] = useState<string | null>(null);
	const [isMirrorOpen, setIsMirrorOpen] = useState(false);

	const loadSubmissions = async (silent = false) => {
		if (!silent) setIsLoading(true);
		else setIsRefreshing(true);

		try {
			const res = await api.get('/api/admin/submissions');
			setSubmissions(res.data.submissions || []);
			setGroups(res.data.groups || []);
			setChapters(res.data.chapters || []);
		} catch (error) {
			console.error(error);
			toast.error('Failed to load homework queue.');
		} finally {
			setIsLoading(false);
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		loadSubmissions();
	}, []);

	// 1-Tap Approve Homework
	const handleApproveHomework = async (submissionId: string, note?: string) => {
		try {
			setActionId(submissionId);
			await api.patch('/api/admin/submissions', {
				id: submissionId,
				status: 'APPROVED',
				...(note !== undefined ? { note } : {}),
			});

			toast.success('Homework marked as approved!');

			// Optimistic local update
			setSubmissions((prev) =>
				prev.map((sub) =>
					sub.id === submissionId
						? {
								...sub,
								status: 'APPROVED',
								...(note !== undefined ? { reviewNote: note.trim() || null } : {}),
							}
						: sub
				)
			);
			loadSubmissions(true);
		} catch (error) {
			console.error(error);
			toast.error('Failed to update submission status.');
		} finally {
			setActionId(null);
		}
	};

	// Save feedback only (does not change approval status)
	const handleSaveNote = async (submissionId: string, note: string) => {
		try {
			setActionId(submissionId);
			await api.patch('/api/admin/submissions', { id: submissionId, note });
			toast.success('Feedback saved');
			setSubmissions((prev) =>
				prev.map((sub) =>
					sub.id === submissionId ? { ...sub, reviewNote: note.trim() || null } : sub
				)
			);
			setPreviewSubmission((prev) =>
				prev && prev.id === submissionId ? { ...prev, reviewNote: note.trim() || null } : prev
			);
		} catch (error) {
			console.error(error);
			toast.error('Failed to save feedback.');
		} finally {
			setActionId(null);
		}
	};

	// Filtered submissions
	const filteredSubmissions = useMemo(() => {
		return submissions.filter((sub) => {
			if (selectedGroupId !== 'ALL') {
				if (sub.groupId !== selectedGroupId) return false;
			}

			if (selectedChapterId !== 'ALL') {
				if (sub.chapterId !== selectedChapterId) return false;
			}

			if (selectedStatus !== 'ALL') {
				if (sub.status !== selectedStatus) return false;
			}

			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const matchName = sub.studentName.toLowerCase().includes(q);
				const matchEmail = sub.studentEmail.toLowerCase().includes(q);
				const matchChapter = sub.chapter?.title.toLowerCase().includes(q);
				if (!matchName && !matchEmail && !matchChapter) return false;
			}

			return true;
		});
	}, [submissions, selectedGroupId, selectedChapterId, selectedStatus, searchQuery]);

	const pendingCount = submissions.filter(
		(s) => s.status === 'PENDING_APPROVAL'
	).length;
	const approvedCount = submissions.filter((s) => s.status === 'APPROVED').length;

	return (
		<div className="mx-auto w-full max-w-7xl space-y-8 pb-16 pt-2 animate-in fade-in-50 duration-200">
			{/* Top Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Assistant Review Board
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						Homework Approval Queue
					</h1>
					<p className="text-sm text-slate-500">
						Verify textbook homework uploads, approve assignments, and monitor student completion.
					</p>
				</div>

				<div className="flex items-center gap-2.5">
					<Button
						variant="outline"
						size="sm"
						onClick={() => loadSubmissions(true)}
						disabled={isRefreshing}
						className="border-slate-200 text-slate-700 hover:bg-slate-100"
					>
						<RefreshCw
							className={cn('h-3.5 w-3.5 mr-1.5', isRefreshing && 'animate-spin')}
						/>
						Refresh
					</Button>
				</div>
			</div>

			{/* Metric Badges */}
			<div className="grid gap-4 sm:grid-cols-3">
				<div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
								Pending Approvals
							</p>
							<p className="mt-1.5 text-2xl font-bold text-amber-950">
								{pendingCount}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-800">
							<Clock className="h-5 w-5" />
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Approved Homework
							</p>
							<p className="mt-1.5 text-2xl font-bold text-emerald-600">
								{approvedCount}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
							<CheckCircle2 className="h-5 w-5" />
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Total Submissions
							</p>
							<p className="mt-1.5 text-2xl font-bold text-slate-900">
								{submissions.length}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
							<Layers className="h-5 w-5" />
						</div>
					</div>
				</div>
			</div>

			{/* Filters Bar */}
			<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
				<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
					<Filter className="h-3.5 w-3.5 text-slate-400" />
					Filter Submissions
				</div>

				<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
					{/* Search by Student */}
					<div className="relative">
						<Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
						<Input
							placeholder="Search student or lesson..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9 h-10 text-xs border-slate-200 bg-slate-50 focus:bg-white"
						/>
					</div>

					{/* Group Filter */}
					<div>
						<select
							value={selectedGroupId}
							onChange={(e) => setSelectedGroupId(e.target.value)}
							className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-1 focus:ring-sky-500"
						>
							<option value="ALL">All Groups</option>
							{groups.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</select>
					</div>

					{/* Lesson Segment Filter */}
					<div>
						<select
							value={selectedChapterId}
							onChange={(e) => setSelectedChapterId(e.target.value)}
							className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-1 focus:ring-sky-500"
						>
							<option value="ALL">All Homework Segments</option>
							{homeworkChapters.map((ch) => (
								<option key={ch.id} value={ch.id}>
									{ch.course?.title ? `${ch.course.title} - ` : ''}
									{ch.title}
								</option>
							))}
						</select>
					</div>

					{/* Status Filter */}
					<div>
						<select
							value={selectedStatus}
							onChange={(e) => setSelectedStatus(e.target.value)}
							className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:ring-1 focus:ring-sky-500"
						>
							<option value="ALL">All Statuses</option>
							<option value="PENDING_APPROVAL">Pending Review ({pendingCount})</option>
							<option value="APPROVED">Approved ({approvedCount})</option>
						</select>
					</div>
				</div>
			</div>

			{/* Submissions Table */}
			<section className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				<div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
					<h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
						Submissions List
						<span className="text-xs font-semibold text-slate-500">
							({filteredSubmissions.length} results)
						</span>
					</h2>
				</div>

				{isLoading ? (
					<div className="flex min-h-[220px] items-center justify-center p-8">
						<Loader2 className="h-8 w-8 animate-spin text-sky-600" />
					</div>
				) : filteredSubmissions.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
						<CheckCircle2 className="h-10 w-10 text-slate-300 mb-2" />
						<p className="text-sm font-semibold text-slate-800">
							No submissions match your filters
						</p>
						<p className="text-xs text-slate-400 mt-0.5">
							Try changing group or status filters to view other homework uploads.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="border-b border-slate-100 bg-slate-50/40 text-[11px] font-bold uppercase tracking-wider text-slate-500">
									<th className="py-3.5 px-6">Student</th>
									<th className="py-3.5 px-6">Group</th>
									<th className="py-3.5 px-6">Lesson Segment</th>
									<th className="py-3.5 px-6">Uploaded File</th>
									<th className="py-3.5 px-6">Date / Time</th>
									<th className="py-3.5 px-6">Status</th>
									<th className="py-3.5 px-6 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 text-sm">
								{filteredSubmissions.map((sub) => {
									const isApproved = sub.status === 'APPROVED';
									const isPending = sub.status === 'PENDING_APPROVAL';
									const dateFormatted = new Date(sub.createdAt).toLocaleString(
										'en-US',
										{
											month: 'short',
											day: 'numeric',
											year: 'numeric',
											hour: 'numeric',
											minute: '2-digit',
										}
									);

									return (
										<tr
											key={sub.id}
											className="hover:bg-slate-50/80 transition-colors"
										>
											{/* Student */}
											<td className="py-3.5 px-6">
												<button
													type="button"
													onClick={() => {
														setMirrorStudentId(sub.userId);
														setIsMirrorOpen(true);
													}}
													className="flex items-center gap-2.5 text-left group cursor-pointer"
												>
													{sub.studentImage ? (
														<img
															src={sub.studentImage}
															alt={sub.studentName}
															className="h-8 w-8 rounded-full border border-slate-200 object-cover"
														/>
													) : (
														<div className="grid h-8 w-8 place-items-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs shrink-0">
															{sub.studentName.charAt(0)}
														</div>
													)}
													<div className="min-w-0">
														<p className="font-semibold text-slate-900 group-hover:text-sky-700 transition">
															{sub.studentName}
														</p>
														<p className="text-[11px] text-slate-400 font-mono">
															{sub.studentEmail}
														</p>
													</div>
												</button>
											</td>

											{/* Group */}
											<td className="py-3.5 px-6">
												<span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
													{sub.groupName}
												</span>
											</td>

											{/* Lesson Segment Title */}
											<td className="py-3.5 px-6">
												<div className="space-y-0.5 max-w-xs">
													<p className="text-[11px] font-bold text-sky-700 uppercase tracking-wider truncate">
														{sub.chapter.course?.title || 'Lesson'}
													</p>
													<p className="text-xs font-semibold text-slate-800 line-clamp-1">
														{sub.chapter.title}
													</p>
												</div>
											</td>

											{/* Uploaded File Link */}
											<td className="py-3.5 px-6">
												<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() => openPreview(sub)}
														className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
													>
														<Eye className="h-3.5 w-3.5 text-slate-500" />
														Preview
													</button>
													<a
														href={sub.fileUrl}
														target="_blank"
														rel="noopener noreferrer"
														className="text-slate-400 hover:text-slate-700"
														title="Open in new tab"
													>
														<ExternalLink className="h-3.5 w-3.5" />
													</a>
												</div>
											</td>

											{/* Date */}
											<td className="py-3.5 px-6 text-xs text-slate-500 whitespace-nowrap">
												{dateFormatted}
											</td>

											{/* Status Badge */}
											<td className="py-3.5 px-6">
												{isApproved ? (
													<div className="space-y-0.5">
														<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
															<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
															Approved
														</span>
														{sub.reviewerName && (
															<p className="text-[10px] text-slate-400">
																by {sub.reviewerName}
															</p>
														)}
													</div>
												) : (
													<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
														<Clock className="h-3.5 w-3.5 text-amber-600" />
														Pending Review
													</span>
												)}
											</td>

											{/* Actions: Strictly 1-Tap Mark as Approved */}
											<td className="py-3.5 px-6 text-right">
												<div className="flex items-center justify-end gap-1.5">
													{!isApproved ? (
														<Button
															size="sm"
															disabled={actionId === sub.id}
															onClick={() =>
																handleApproveHomework(sub.id)
															}
															className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs"
														>
															{actionId === sub.id ? (
																<Loader2 className="h-3.5 w-3.5 animate-spin" />
															) : (
																<>
																	<Check className="h-3.5 w-3.5 mr-1" />
																	Mark as Approved
																</>
															)}
														</Button>
													) : (
														<span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold py-1 px-2.5 rounded-lg bg-emerald-50/70 border border-emerald-100">
															<Check className="h-3.5 w-3.5" />
															Verified
														</span>
													)}
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{/* Inline File Preview Modal */}
			<Dialog open={!!previewUrl} onOpenChange={(open) => !open && closePreview()}>
				<DialogContent className="sm:max-w-3xl border-slate-200 bg-white text-slate-900 shadow-2xl rounded-2xl p-6">
					<DialogHeader>
						<DialogTitle className="text-base font-bold text-slate-900">
							{previewTitle || 'Homework File Preview'}
						</DialogTitle>
					</DialogHeader>

					<div className="mt-2 min-h-[350px] max-h-[70vh] flex items-center justify-center overflow-auto rounded-xl bg-slate-950 p-2">
						{previewUrl && (
							previewUrl.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i) ? (
								<img
									src={previewUrl}
									alt="Homework Preview"
									className="max-h-[65vh] w-auto object-contain rounded-lg"
								/>
							) : (
								<iframe
									src={previewUrl}
									title="Homework Document Preview"
									className="h-[65vh] w-full rounded-lg bg-white"
								/>
							)
						)}
					</div>

					{previewSubmission && (
						<div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
							<label
								htmlFor="review-note"
								className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600"
							>
								<MessageSquareText className="h-3.5 w-3.5" />
								Feedback note <span className="font-normal normal-case text-slate-400">(optional)</span>
							</label>
							<Textarea
								id="review-note"
								value={noteDraft}
								maxLength={4000}
								onChange={(event) => setNoteDraft(event.target.value)}
								placeholder="Guidance or corrections for the student..."
								className="bg-white text-sm"
							/>
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={
										actionId === previewSubmission.id ||
										noteDraft.trim() === (previewSubmission.reviewNote ?? '')
									}
									onClick={() => handleSaveNote(previewSubmission.id, noteDraft)}
								>
									Save note only
								</Button>
								{previewSubmission.status !== 'APPROVED' && (
									<Button
										type="button"
										size="sm"
										disabled={actionId === previewSubmission.id}
										className="bg-emerald-600 text-white hover:bg-emerald-700"
										onClick={async () => {
											await handleApproveHomework(previewSubmission.id, noteDraft);
											closePreview();
										}}
									>
										<Check className="mr-1 h-3.5 w-3.5" />
										{noteDraft.trim() ? 'Approve with note' : 'Mark as Approved'}
									</Button>
								)}
							</div>
						</div>
					)}

					<div className="flex justify-between items-center pt-2">
						<a
							href={previewUrl || '#'}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:underline"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Open in Full New Window
						</a>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={closePreview}
						>
							Close Preview
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Student Profile Mirror Drawer */}
			<StudentMirrorDrawer
				studentId={mirrorStudentId}
				isOpen={isMirrorOpen}
				onClose={() => {
					setIsMirrorOpen(false);
					setMirrorStudentId(null);
				}}
				onSubmissionUpdated={() => loadSubmissions(true)}
			/>
		</div>
	);
};
