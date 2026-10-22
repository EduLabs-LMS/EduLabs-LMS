'use client';

/**
 * Homework Approval Queue (legacy runtime) — redesign.
 * Presentation only: the API calls, payloads, statuses and permissions are exactly the ones this screen
 * used before (GET /api/admin/submissions, PATCH /api/admin/submissions with { id, status, note? }).
 * Layout uses logical utilities (ms/me/ps/pe/start/end) so Arabic RTL mirrors by itself.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	ExternalLink,
	Eye,
	Filter,
	Layers,
	Loader2,
	MessageSquare as MessageSquareText,
	Search,
	XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { api } from '@/frontend/lib/api';
import { useLanguage, LocalDate } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Textarea } from '@/frontend/components/ui/textarea';
import { Skeleton } from '@/frontend/components/ui/skeleton';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { cn } from '@/shared/utils';
import { StudentMirrorDrawer } from '@/frontend/features/admin/users/student-mirror-drawer';
import { FOCUS, Initial, PageHeader, Pill } from '@/frontend/features/admin/users/users-ui';

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

const PAGE_SIZE = 25;
const IMAGE_FILE = /\.(jpeg|jpg|gif|png|webp)($|\?)/i;
/** The API currently returns the approver's raw account id. Never show that to a teacher. */
const looksLikeRawId = (value: string) => /^user_/i.test(value) || /^[0-9a-f-]{24,}$/i.test(value) || /^[A-Za-z0-9_-]{24,}$/.test(value);

const FIELD =
	'h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900 transition-colors hover:border-slate-400';

const StatTile = ({
	label,
	value,
	icon,
	iconTone,
	valueTone,
	highlight,
	onClick,
	active,
}: {
	label: ReactNode;
	value: ReactNode;
	icon: ReactNode;
	iconTone: string;
	valueTone?: string;
	highlight?: boolean;
	onClick?: () => void;
	active?: boolean;
}) => {
	const body = (
		<div className="flex items-center justify-between gap-3">
			<div className="min-w-0 text-start">
				<p
					className={cn(
						'text-xs font-semibold uppercase tracking-wider',
						highlight ? 'text-amber-900' : 'text-slate-700'
					)}
				>
					{label}
				</p>
				<p className={cn('mt-1.5 text-2xl font-bold', valueTone ?? 'text-slate-900')}>{value}</p>
			</div>
			<span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', iconTone)} aria-hidden>
				{icon}
			</span>
		</div>
	);
	const shell = cn(
		'block w-full rounded-2xl border p-5',
		highlight ? 'border-amber-300 bg-amber-50' : 'border-slate-300 bg-white',
		active && 'ring-2 ring-black'
	);
	return onClick ? (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(shell, 'transition-colors hover:border-slate-500', FOCUS)}
		>
			{body}
		</button>
	) : (
		<div className={shell}>{body}</div>
	);
};

const SelectField = ({
	label,
	value,
	onChange,
	children,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	children: ReactNode;
}) => (
	<div className="relative">
		<select
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className={cn(FIELD, 'appearance-none truncate ps-3 pe-10', FOCUS)}
		>
			{children}
		</select>
		<ChevronDown
			className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
			aria-hidden
		/>
	</div>
);

export const SubmissionsView = () => {
	const { t, number } = useLanguage();

	const [submissions, setSubmissions] = useState<EnrichedSubmission[]>([]);
	const [groups, setGroups] = useState<GroupOption[]>([]);
	const [chapters, setChapters] = useState<ChapterOption[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);

	// Action loading state
	const [actionId, setActionId] = useState<string | null>(null);

	// Filters
	const [selectedGroupId, setSelectedGroupId] = useState('ALL');
	const [selectedChapterId, setSelectedChapterId] = useState('ALL');
	const [selectedStatus, setSelectedStatus] = useState('ALL');
	const [searchQuery, setSearchQuery] = useState('');
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

	// Strictly filter for homework segments only (no pure explanation videos like P1, P2)
	const homeworkChapters = useMemo(() => {
		return chapters.filter(
			(ch) =>
				ch.contentType === 'HOMEWORK_ASSIGNMENT' || /homework|hw|assignment/i.test(ch.title)
		);
	}, [chapters]);

	// File preview panel. Drafts are kept per submission so nothing is lost when moving between files.
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
	const [confirmClose, setConfirmClose] = useState(false);
	const [fileState, setFileState] = useState<'loading' | 'ready' | 'failed'>('loading');

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
			setLoadFailed(false);
		} catch (error) {
			console.error(error);
			setLoadFailed(true);
			toast.error(t('hq.toast.load_failed'));
		} finally {
			setIsLoading(false);
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		loadSubmissions();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 1-Tap Approve Homework (same request as before). Returns true when the server accepted it.
	const handleApproveHomework = async (submissionId: string, note?: string): Promise<boolean> => {
		try {
			setActionId(submissionId);
			await api.patch('/api/admin/submissions', {
				id: submissionId,
				status: 'APPROVED',
				...(note !== undefined ? { note } : {}),
			});

			toast.success(t('hq.toast.approved'));

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
			return true;
		} catch (error) {
			console.error(error);
			toast.error(t('hq.toast.approve_failed'));
			return false;
		} finally {
			setActionId(null);
		}
	};

	// Save feedback only (does not change approval status)
	const handleSaveNote = async (submissionId: string, note: string) => {
		try {
			setActionId(submissionId);
			await api.patch('/api/admin/submissions', { id: submissionId, note });
			toast.success(t('hq.toast.note_saved'));
			setSubmissions((prev) =>
				prev.map((sub) =>
					sub.id === submissionId ? { ...sub, reviewNote: note.trim() || null } : sub
				)
			);
			setNoteDrafts((prev) => ({ ...prev, [submissionId]: note.trim() }));
		} catch (error) {
			console.error(error);
			toast.error(t('hq.toast.note_failed'));
		} finally {
			setActionId(null);
		}
	};

	// Filtered submissions
	const filteredSubmissions = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		return submissions.filter((sub) => {
			if (selectedGroupId !== 'ALL' && sub.groupId !== selectedGroupId) return false;
			if (selectedChapterId !== 'ALL' && sub.chapterId !== selectedChapterId) return false;
			if (selectedStatus !== 'ALL' && sub.status !== selectedStatus) return false;

			if (q) {
				const matches =
					sub.studentName.toLowerCase().includes(q) ||
					sub.studentEmail.toLowerCase().includes(q) ||
					(sub.chapter?.title ?? '').toLowerCase().includes(q) ||
					(sub.groupName ?? '').toLowerCase().includes(q);
				if (!matches) return false;
			}
			return true;
		});
	}, [submissions, selectedGroupId, selectedChapterId, selectedStatus, searchQuery]);

	useEffect(() => {
		setVisibleCount(PAGE_SIZE);
	}, [selectedGroupId, selectedChapterId, selectedStatus, searchQuery]);

	const visibleSubmissions = filteredSubmissions.slice(0, visibleCount);

	const pendingCount = submissions.filter((s) => s.status === 'PENDING_APPROVAL').length;
	const approvedCount = submissions.filter((s) => s.status === 'APPROVED').length;
	const rejectedCount = submissions.filter((s) => s.status === 'REJECTED').length;
	const filtersActive =
		selectedGroupId !== 'ALL' ||
		selectedChapterId !== 'ALL' ||
		selectedStatus !== 'ALL' ||
		searchQuery.trim() !== '';

	// ---- Preview navigation (works over the currently filtered list, so filters are never lost) ----
	const previewIndex = previewId ? filteredSubmissions.findIndex((s) => s.id === previewId) : -1;
	const previewSub = previewIndex >= 0 ? filteredSubmissions[previewIndex] : null;
	const savedNote = previewSub?.reviewNote ?? '';
	const draft = previewSub ? (noteDrafts[previewSub.id] ?? savedNote) : '';
	const draftDirty = (id: string, value: string) => {
		const sub = submissions.find((s) => s.id === id);
		return value.trim() !== (sub?.reviewNote ?? '').trim();
	};
	const hasUnsavedNotes = Object.entries(noteDrafts).some(([id, value]) => draftDirty(id, value));

	const openPreview = (sub: EnrichedSubmission) => {
		setFileState('loading');
		setConfirmClose(false);
		setPreviewId(sub.id);
	};
	const goTo = useCallback(
		(index: number) => {
			const target = filteredSubmissions[index];
			if (!target) return;
			setFileState('loading');
			setConfirmClose(false);
			setPreviewId(target.id);
		},
		[filteredSubmissions]
	);
	const closePreview = () => {
		setPreviewId(null);
		setConfirmClose(false);
	};
	const requestClose = () => {
		if (hasUnsavedNotes) setConfirmClose(true);
		else closePreview();
	};
	const discardAndClose = () => {
		setNoteDrafts({});
		closePreview();
	};

	const approveFromPreview = async (andNext: boolean) => {
		if (!previewSub) return;
		const current = previewSub;
		const ok = await handleApproveHomework(current.id, draft);
		if (!ok) return;
		setNoteDrafts((prev) => {
			const next = { ...prev };
			delete next[current.id];
			return next;
		});
		if (!andNext) {
			closePreview();
			return;
		}
		// Next waiting submission after this one, otherwise the next one in the list.
		const after = filteredSubmissions.slice(previewIndex + 1);
		const target =
			after.find((s) => s.status === 'PENDING_APPROVAL') ?? after[0] ?? null;
		if (target) {
			setFileState('loading');
			setPreviewId(target.id);
		} else {
			closePreview();
		}
	};

	const statusBadge = (sub: EnrichedSubmission) => {
		if (sub.status === 'APPROVED') {
			const approver =
				sub.reviewerName && !looksLikeRawId(sub.reviewerName) ? sub.reviewerName : null;
			return (
				<div className="space-y-1">
					<Pill
						tone="border-emerald-300 bg-emerald-50 text-emerald-900"
						icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
					>
						{t('hq.status.approved')}
					</Pill>
					{approver && (
						<p className="text-xs text-slate-700">
							{t('hq.by', { name: approver })}
						</p>
					)}
				</div>
			);
		}
		if (sub.status === 'REJECTED') {
			return (
				<Pill
					tone="border-rose-300 bg-rose-50 text-rose-900"
					icon={<XCircle className="h-3.5 w-3.5" aria-hidden />}
				>
					{t('hq.status.rejected')}
				</Pill>
			);
		}
		return (
			<Pill
				tone="border-amber-300 bg-amber-50 text-amber-900"
				icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
			>
				{t('hq.status.pending')}
			</Pill>
		);
	};

	const actionCell = (sub: EnrichedSubmission) =>
		sub.status !== 'APPROVED' ? (
			<Button
				size="sm"
				disabled={actionId === sub.id}
				onClick={() => handleApproveHomework(sub.id)}
				className="min-h-[44px] bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800 md:min-h-[36px]"
			>
				{actionId === sub.id ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('hq.loading')} />
				) : (
					<>
						<Check className="me-1 h-3.5 w-3.5" aria-hidden />
						{t('hq.action.approve')}
					</>
				)}
			</Button>
		) : (
			<Pill
				tone="border-emerald-300 bg-emerald-50 text-emerald-900"
				icon={<Check className="h-3.5 w-3.5" aria-hidden />}
			>
				{t('hq.action.verified')}
			</Pill>
		);

	const studentCell = (sub: EnrichedSubmission) => (
		<button
			type="button"
			onClick={() => {
				setMirrorStudentId(sub.userId);
				setIsMirrorOpen(true);
			}}
			className={cn('group flex min-w-0 items-center gap-2.5 rounded-lg text-start', FOCUS)}
		>
			{sub.studentImage ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={sub.studentImage}
					alt=""
					className="h-8 w-8 shrink-0 rounded-full border border-slate-300 object-cover"
				/>
			) : (
				<Initial name={sub.studentName} />
			)}
			<span className="min-w-0">
				<span className="block truncate font-semibold text-slate-900 group-hover:underline">
					{sub.studentName}
				</span>
				<bdi className="block truncate font-mono text-xs text-slate-700">{sub.studentEmail}</bdi>
			</span>
		</button>
	);

	const fileCell = (sub: EnrichedSubmission) => (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={() => openPreview(sub)}
				className={cn(
					'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 transition-colors hover:bg-slate-100 md:min-h-[36px]',
					FOCUS
				)}
			>
				<Eye className="h-3.5 w-3.5" aria-hidden />
				{t('hq.preview')}
			</button>
			<a
				href={sub.fileUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={t('hq.open_new_tab')}
				title={t('hq.open_new_tab')}
				className={cn(
					'grid h-11 w-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 hover:text-slate-900 md:h-9 md:w-9',
					FOCUS
				)}
			>
				<ExternalLink className="h-4 w-4" aria-hidden />
			</a>
		</div>
	);

	const dateOptions: Intl.DateTimeFormatOptions = {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	};

	const groupLabel = (sub: EnrichedSubmission) => (sub.groupId ? sub.groupName : t('hq.unassigned'));

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pb-16 pt-2 animate-in fade-in-50 duration-200">
			<PageHeader
				pill={t('hq.pill')}
				title={t('hq.title')}
				subtitle={t('hq.subtitle')}
				refreshLabel={t('hq.refresh')}
				refreshing={isRefreshing}
				onRefresh={() => loadSubmissions(true)}
			/>

			{/* Stat cards */}
			<div className="grid gap-4 sm:grid-cols-3">
				<StatTile
					highlight
					label={t('hq.stat.pending')}
					value={number(pendingCount)}
					valueTone="text-amber-950"
					icon={<Clock className="h-5 w-5" />}
					iconTone="bg-amber-100 text-amber-900"
					active={selectedStatus === 'PENDING_APPROVAL'}
					onClick={() =>
						setSelectedStatus((s) => (s === 'PENDING_APPROVAL' ? 'ALL' : 'PENDING_APPROVAL'))
					}
				/>
				<StatTile
					label={t('hq.stat.approved')}
					value={number(approvedCount)}
					valueTone="text-emerald-800"
					icon={<CheckCircle2 className="h-5 w-5" />}
					iconTone="bg-emerald-50 text-emerald-900"
					active={selectedStatus === 'APPROVED'}
					onClick={() => setSelectedStatus((s) => (s === 'APPROVED' ? 'ALL' : 'APPROVED'))}
				/>
				<StatTile
					label={t('hq.stat.total')}
					value={number(submissions.length)}
					icon={<Layers className="h-5 w-5" />}
					iconTone="bg-sky-50 text-sky-900"
				/>
			</div>

			{/* Filters */}
			<section
				aria-label={t('hq.filter.title')}
				className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4"
			>
				<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
					<Filter className="h-3.5 w-3.5" aria-hidden />
					{t('hq.filter.title')}
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div className="relative">
						<Search
							className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
							aria-hidden
						/>
						<Input
							type="search"
							aria-label={t('hq.search.placeholder')}
							placeholder={t('hq.search.placeholder')}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className={cn(FIELD, 'ps-9 text-sm')}
						/>
					</div>

					<SelectField label={t('hq.filter.group')} value={selectedGroupId} onChange={setSelectedGroupId}>
						<option value="ALL">{t('hq.filter.all_groups')}</option>
						{groups.map((g) => (
							<option key={g.id} value={g.id}>
								{g.name}
							</option>
						))}
					</SelectField>

					<SelectField
						label={t('hq.filter.segment')}
						value={selectedChapterId}
						onChange={setSelectedChapterId}
					>
						<option value="ALL">{t('hq.filter.all_segments')}</option>
						{homeworkChapters.map((ch) => (
							<option key={ch.id} value={ch.id}>
								{ch.course?.title ? `${ch.course.title} - ` : ''}
								{ch.title}
							</option>
						))}
					</SelectField>

					<SelectField label={t('hq.filter.status')} value={selectedStatus} onChange={setSelectedStatus}>
						<option value="ALL">{t('hq.filter.all_statuses')}</option>
						<option value="PENDING_APPROVAL">
							{t('hq.filter.pending', { count: number(pendingCount) })}
						</option>
						<option value="APPROVED">{t('hq.filter.approved', { count: number(approvedCount) })}</option>
						<option value="REJECTED">{t('hq.filter.rejected', { count: number(rejectedCount) })}</option>
					</SelectField>
				</div>
			</section>

			{/* Submissions list */}
			<section className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
				<div className="flex items-center justify-between border-b border-slate-300 bg-slate-50 px-4 py-4 sm:px-6">
					<h2 className="flex flex-wrap items-baseline gap-2 font-display text-lg text-slate-900">
						{t('hq.list.title')}
						<span aria-live="polite" className="text-xs font-semibold text-slate-700">
							({t('hq.list.results', { count: number(filteredSubmissions.length) })})
						</span>
					</h2>
				</div>

				{isLoading ? (
					<div role="status" aria-label={t('hq.loading')} className="space-y-3 p-4 sm:p-6">
						{[0, 1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-14 w-full rounded-xl" />
						))}
					</div>
				) : loadFailed && submissions.length === 0 ? (
					<div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
						<AlertTriangle className="h-10 w-10 text-rose-700" aria-hidden />
						<p className="text-sm font-semibold text-slate-900">{t('hq.error.title')}</p>
						<p className="max-w-sm text-xs text-slate-700">{t('hq.error.hint')}</p>
						<Button variant="outline" className="min-h-[44px]" onClick={() => loadSubmissions()}>
							{t('hq.retry')}
						</Button>
					</div>
				) : filteredSubmissions.length === 0 ? (
					<div className="flex flex-col items-center justify-center px-4 py-12 text-center">
						<CheckCircle2 className="mb-2 h-10 w-10 text-slate-500" aria-hidden />
						<p className="text-sm font-semibold text-slate-900">
							{filtersActive ? t('hq.empty.filtered') : t('hq.empty.none')}
						</p>
						<p className="mt-0.5 max-w-sm text-xs text-slate-700">
							{filtersActive ? t('hq.empty.filtered_hint') : t('hq.empty.none_hint')}
						</p>
						{filtersActive && (
							<Button
								variant="outline"
								className="mt-4 min-h-[44px]"
								onClick={() => {
									setSelectedGroupId('ALL');
									setSelectedChapterId('ALL');
									setSelectedStatus('ALL');
									setSearchQuery('');
								}}
							>
								{t('hq.clear_filters')}
							</Button>
						)}
					</div>
				) : (
					<>
						{/* Desktop / tablet table */}
						<div className="hidden overflow-x-auto md:block">
							<table className="w-full border-collapse text-start">
								<caption className="sr-only">{t('hq.list.title')}</caption>
								<thead>
									<tr className="border-b border-slate-300 text-xs font-bold uppercase tracking-wider text-slate-700">
										<th scope="col" className="px-6 py-3.5 text-start">{t('hq.col.student')}</th>
										<th scope="col" className="px-4 py-3.5 text-start">{t('hq.col.group')}</th>
										<th scope="col" className="px-4 py-3.5 text-start">{t('hq.col.segment')}</th>
										<th scope="col" className="px-4 py-3.5 text-start">{t('hq.col.file')}</th>
										<th scope="col" className="px-4 py-3.5 text-start">{t('hq.col.date')}</th>
										<th scope="col" className="px-4 py-3.5 text-start">{t('hq.col.status')}</th>
										<th scope="col" className="px-6 py-3.5 text-end">{t('hq.col.actions')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200 text-sm">
									{visibleSubmissions.map((sub) => (
										<tr key={sub.id} className="transition-colors hover:bg-slate-50">
											<td className="max-w-[16rem] px-6 py-3.5">{studentCell(sub)}</td>
											<td className="px-4 py-3.5">
												<Pill tone="border-slate-300 bg-slate-100 text-slate-900">
													{groupLabel(sub)}
												</Pill>
											</td>
											<td className="max-w-[14rem] px-4 py-3.5">
												<p className="truncate text-xs font-bold uppercase tracking-wider text-emerald-900">
													{sub.chapter.course?.title || t('hq.lesson')}
												</p>
												<p className="truncate text-sm font-semibold text-slate-900">
													{sub.chapter.title}
												</p>
											</td>
											<td className="px-4 py-3.5">{fileCell(sub)}</td>
											<td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-700">
												<LocalDate value={sub.createdAt} options={dateOptions} />
											</td>
											<td className="px-4 py-3.5">{statusBadge(sub)}</td>
											<td className="px-6 py-3.5">
												<div className="flex justify-end">{actionCell(sub)}</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* Mobile: one card per submission, every column and action kept */}
						<ul className="divide-y divide-slate-200 md:hidden">
							{visibleSubmissions.map((sub) => (
								<li key={sub.id} className="space-y-3 p-4">
									<div className="flex items-start justify-between gap-3">
										{studentCell(sub)}
										<div className="shrink-0">{statusBadge(sub)}</div>
									</div>
									<div className="min-w-0">
										<p className="truncate text-xs font-bold uppercase tracking-wider text-emerald-900">
											{sub.chapter.course?.title || t('hq.lesson')}
										</p>
										<p className="text-sm font-semibold text-slate-900">{sub.chapter.title}</p>
									</div>
									<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
										<Pill tone="border-slate-300 bg-slate-100 text-slate-900">{groupLabel(sub)}</Pill>
										<LocalDate value={sub.createdAt} options={dateOptions} />
									</div>
									<div className="flex flex-wrap items-center justify-between gap-2">
										{fileCell(sub)}
										{actionCell(sub)}
									</div>
								</li>
							))}
						</ul>

						{filteredSubmissions.length > visibleCount && (
							<div className="flex justify-center border-t border-slate-200 p-4">
								<Button
									variant="outline"
									className="min-h-[44px]"
									onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
								>
									{t('hq.show_more', {
										count: number(Math.min(PAGE_SIZE, filteredSubmissions.length - visibleCount)),
									})}
								</Button>
							</div>
						)}
					</>
				)}
			</section>

			{/* File preview + review panel */}
			<Dialog open={!!previewSub} onOpenChange={(open) => !open && requestClose()}>
				<DialogContent className="max-h-[95vh] overflow-y-auto rounded-2xl border-slate-300 bg-white p-4 text-slate-900 sm:max-w-3xl sm:p-6">
					{previewSub && (
						<>
							<DialogHeader className="text-start">
								<DialogTitle className="font-display text-lg">
									{previewSub.studentName} — {previewSub.chapter.title}
								</DialogTitle>
								<DialogDescription className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
									{statusBadge(previewSub)}
									<span>
										{t('hq.position', {
											index: number(previewIndex + 1),
											total: number(filteredSubmissions.length),
										})}
									</span>
								</DialogDescription>
							</DialogHeader>

							<div
								data-appearance-island
								className="relative flex min-h-[260px] max-h-[60vh] items-center justify-center overflow-auto rounded-xl bg-slate-950 p-2"
							>
								{fileState === 'loading' && (
									<div
										role="status"
										aria-label={t('hq.loading')}
										className="absolute inset-0 grid place-items-center"
									>
										<Loader2 className="h-8 w-8 animate-spin text-slate-300" />
									</div>
								)}
								{fileState === 'failed' ? (
									<div className="space-y-2 p-6 text-center text-sm text-slate-100">
										<p>{t('hq.file.failed')}</p>
										<a
											href={previewSub.fileUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="font-semibold underline"
										>
											{t('hq.open_new_tab')}
										</a>
									</div>
								) : IMAGE_FILE.test(previewSub.fileUrl) ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img
										key={previewSub.id}
										src={previewSub.fileUrl}
										alt={t('hq.file.alt')}
										decoding="async"
										onLoad={() => setFileState('ready')}
										onError={() => setFileState('failed')}
										className="max-h-[56vh] w-auto rounded-lg object-contain"
									/>
								) : (
									<iframe
										key={previewSub.id}
										src={previewSub.fileUrl}
										title={t('hq.file.title')}
										loading="lazy"
										onLoad={() => setFileState('ready')}
										className="h-[56vh] w-full rounded-lg bg-white"
									/>
								)}
							</div>

							<div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
								<label
									htmlFor="review-note"
									className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700"
								>
									<MessageSquareText className="h-3.5 w-3.5" aria-hidden />
									{t('hq.note.label')}{' '}
									<span className="font-normal normal-case">({t('hq.note.optional')})</span>
								</label>
								<Textarea
									id="review-note"
									value={draft}
									maxLength={4000}
									onChange={(event) =>
										setNoteDrafts((prev) => ({ ...prev, [previewSub.id]: event.target.value }))
									}
									placeholder={t('hq.note.placeholder')}
									className="bg-white text-sm"
								/>
								{draftDirty(previewSub.id, draft) && (
									<p className="text-xs font-medium text-amber-900">{t('hq.note.unsaved')}</p>
								)}
								<div className="flex flex-wrap justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										className="min-h-[44px]"
										disabled={actionId === previewSub.id || !draftDirty(previewSub.id, draft)}
										onClick={() => handleSaveNote(previewSub.id, draft)}
									>
										{t('hq.note.save')}
									</Button>
									{previewSub.status !== 'APPROVED' && (
										<>
											<Button
												type="button"
												variant="outline"
												className="min-h-[44px]"
												disabled={actionId === previewSub.id}
												onClick={() => approveFromPreview(false)}
											>
												<Check className="me-1 h-3.5 w-3.5" aria-hidden />
												{draft.trim() ? t('hq.note.approve_with') : t('hq.action.approve')}
											</Button>
											<Button
												type="button"
												className="min-h-[44px] bg-emerald-700 text-white hover:bg-emerald-800"
												disabled={actionId === previewSub.id}
												onClick={() => approveFromPreview(true)}
											>
												{actionId === previewSub.id ? (
													<Loader2 className="me-1 h-3.5 w-3.5 animate-spin" aria-hidden />
												) : (
													<Check className="me-1 h-3.5 w-3.5" aria-hidden />
												)}
												{t('hq.action.approve_next')}
											</Button>
										</>
									)}
								</div>
							</div>

							{confirmClose && (
								<div
									role="alertdialog"
									aria-label={t('hq.close.title')}
									className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div>
										<p className="text-sm font-semibold text-amber-950">{t('hq.close.title')}</p>
										<p className="text-xs text-amber-950">{t('hq.close.body')}</p>
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											className="min-h-[44px]"
											onClick={() => setConfirmClose(false)}
										>
											{t('hq.close.keep')}
										</Button>
										<Button
											variant="outline"
											className="min-h-[44px]"
											onClick={discardAndClose}
										>
											{t('hq.close.discard')}
										</Button>
									</div>
								</div>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
								<a
									href={previewSub.fileUrl}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-slate-900 underline',
										FOCUS
									)}
								>
									<ExternalLink className="h-3.5 w-3.5" aria-hidden />
									{t('hq.open_full')}
								</a>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										variant="outline"
										className="min-h-[44px]"
										disabled={previewIndex <= 0}
										onClick={() => goTo(previewIndex - 1)}
									>
										<ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden />
										{t('hq.prev')}
									</Button>
									<Button
										type="button"
										variant="outline"
										className="min-h-[44px]"
										disabled={previewIndex >= filteredSubmissions.length - 1}
										onClick={() => goTo(previewIndex + 1)}
									>
										{t('hq.next')}
										<ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden />
									</Button>
									<Button
										type="button"
										variant="outline"
										className="min-h-[44px]"
										onClick={requestClose}
									>
										{t('hq.close.button')}
									</Button>
								</div>
							</div>
						</>
					)}
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
