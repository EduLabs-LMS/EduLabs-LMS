'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/frontend/lib/api';
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Check,
	Clock,
	Edit,
	Layers,
	Mail,
	Plus,
	Trash2,
	UserCheck,
	UserPlus,
	Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { cn } from '@/shared/utils';
import { getNextUpcomingSession } from '@/shared/group-schedule';
import { GroupFormModal, type GroupItem } from '@/frontend/features/admin/users/group-form-modal';
import { ReassignModal } from '@/frontend/features/admin/users/reassign-modal';
import { StudentMirrorDrawer } from '@/frontend/features/admin/users/student-mirror-drawer';
import { AddStudentsModal } from '@/frontend/features/admin/users/add-students-modal';
import { MasterUserDirectory, type PlatformUser } from '@/frontend/features/admin/users/master-user-directory';
import {
	ConfirmDialog,
	EmptyBlock,
	FOCUS,
	Initial,
	LoadingBlock,
	PageHeader,
	SectionHeading,
	SectionTabs,
	StatCard,
	useCountText,
} from '@/frontend/features/admin/users/users-ui';

/**
 * Waitlist gate. The waitlist on/off flag does not exist yet (another developer is adding it).
 * When it lands, replace this constant with the flag: the Pending Waitlist card, the Waitlist tab
 * and the Waitlist Approvals section all read this one value. Shown as ON for now.
 */
const WAITLIST_ENABLED = true;

interface WaitlistUser {
	id: string;
	name?: string | null;
	email?: string | null;
	externalId?: string;
	role?: string;
	firstName?: string;
	lastName?: string;
	emailAddresses?: Array<{ emailAddress: string }>;
	createdAt: number | string;
	publicMetadata?: Record<string, unknown>;
}

interface WaitlistInvitation {
	id: string;
	emailAddress: string;
	createdAt: number | string;
}

type TabKey = 'ALL' | 'DIRECTORY' | 'WAITLIST' | 'GROUPS';

export const AdminUsersView = () => {
	const { t, language, number } = useLanguage();
	const countText = useCountText();

	const [waitlistUsers, setWaitlistUsers] = useState<WaitlistUser[]>([]);
	const [waitlistInvitations, setWaitlistInvitations] = useState<WaitlistInvitation[]>([]);
	const [groups, setGroups] = useState<GroupItem[]>([]);
	const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
	const [activeTab, setActiveTab] = useState<TabKey>('ALL');
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// Action loading states
	const [approvingId, setApprovingId] = useState<string | null>(null);
	const [denyingId, setDenyingId] = useState<string | null>(null);

	// Confirmations for destructive actions (waitlist deny and group delete used to be one tap / a browser confirm)
	const [denyTarget, setDenyTarget] = useState<{ userId?: string; invitationId?: string; name: string } | null>(null);
	const [groupToDelete, setGroupToDelete] = useState<{ id: string; name: string } | null>(null);
	const [isDeletingGroup, setIsDeletingGroup] = useState(false);

	// Modals
	const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);

	const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
	const [reassignStudent, setReassignStudent] = useState<{
		id: string;
		name: string;
		email?: string;
	} | null>(null);
	const [reassignCurrentGroupId, setReassignCurrentGroupId] = useState<string | null>(null);

	// Student Profile Mirror Drawer
	const [mirrorStudentId, setMirrorStudentId] = useState<string | null>(null);
	const [isMirrorOpen, setIsMirrorOpen] = useState(false);

	// Add Students Modal
	const [isAddStudentsOpen, setIsAddStudentsOpen] = useState(false);
	const [targetAddStudentsGroup, setTargetAddStudentsGroup] = useState<GroupItem | null>(null);

	const openAddStudentsModal = (group: GroupItem) => {
		setTargetAddStudentsGroup(group);
		setIsAddStudentsOpen(true);
	};

	// Accordion open groups
	const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

	const loadData = async (silent = false) => {
		if (!silent) setIsLoading(true);
		else setIsRefreshing(true);

		try {
			const [waitlistRes, groupsRes, usersRes] = await Promise.all([
				api.get('/api/admin/waitlist'),
				api.get('/api/admin/groups'),
				api.get('/api/admin/users'),
			]);

			setWaitlistUsers(waitlistRes.data?.users || []);
			setWaitlistInvitations(waitlistRes.data?.invitations || []);
			setGroups(groupsRes.data || []);
			setPlatformUsers(usersRes.data || []);

			// Open first group by default if not set
			if (groupsRes.data && groupsRes.data.length > 0 && Object.keys(expandedGroupIds).length === 0) {
				setExpandedGroupIds({ [groupsRes.data[0].id]: true });
			}
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.loadFail'));
		} finally {
			setIsLoading(false);
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// If the waitlist is switched off while its tab is selected, fall back to All Sections.
	useEffect(() => {
		if (!WAITLIST_ENABLED && activeTab === 'WAITLIST') setActiveTab('ALL');
	}, [activeTab]);

	const toggleGroupAccordion = (groupId: string) => {
		setExpandedGroupIds((prev) => ({
			...prev,
			[groupId]: !prev[groupId],
		}));
	};

	// 1-Tap Waitlist Approvals
	const handleApprove = async (opts: { userId?: string; invitationId?: string; name: string }) => {
		const actionKey = opts.userId || opts.invitationId || '';
		try {
			setApprovingId(actionKey);
			await api.post('/api/admin/waitlist', {
				userId: opts.userId,
				invitationId: opts.invitationId,
			});
			toast.success(t('users.toast.waitApproved', { name: opts.name }));
			// Instant local filter
			if (opts.userId) {
				setWaitlistUsers((prev) => prev.filter((u) => u.id !== opts.userId));
			} else if (opts.invitationId) {
				setWaitlistInvitations((prev) => prev.filter((inv) => inv.id !== opts.invitationId));
			}
			loadData(true);
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.waitApproveFail'));
		} finally {
			setApprovingId(null);
		}
	};

	// Waitlist Deny (runs after the person confirms)
	const handleDeny = async (opts: { userId?: string; invitationId?: string; name: string }) => {
		const actionKey = opts.userId || opts.invitationId || '';
		try {
			setDenyingId(actionKey);
			await api.delete('/api/admin/waitlist', {
				data: {
					userId: opts.userId,
					invitationId: opts.invitationId,
				},
			});
			toast.success(t('users.toast.waitRemoved', { name: opts.name }));
			if (opts.userId) {
				setWaitlistUsers((prev) => prev.filter((u) => u.id !== opts.userId));
			} else if (opts.invitationId) {
				setWaitlistInvitations((prev) => prev.filter((inv) => inv.id !== opts.invitationId));
			}
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.waitRemoveFail'));
		} finally {
			setDenyingId(null);
		}
	};

	// Delete Group (runs after the person confirms)
	const handleDeleteGroup = async (groupId: string, groupName: string) => {
		try {
			setIsDeletingGroup(true);
			await api.delete(`/api/admin/groups?groupId=${groupId}`);
			toast.success(t('users.toast.groupDeleted', { name: groupName }));
			loadData(true);
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.groupDeleteFail'));
		} finally {
			setIsDeletingGroup(false);
			setGroupToDelete(null);
		}
	};

	const totalWaitlistCount = waitlistUsers.length + waitlistInvitations.length;
	const totalAssignedStudents = groups.reduce((sum, g) => sum + (g.students?.length || 0), 0);

	const openStudentMirror = (studentId: string) => {
		setMirrorStudentId(studentId);
		setIsMirrorOpen(true);
	};

	const openReassignModal = (
		student: { id: string; name: string; email?: string },
		currentGroupId?: string
	) => {
		setReassignStudent(student);
		setReassignCurrentGroupId(currentGroupId || null);
		setIsReassignModalOpen(true);
	};

	const formatDate = (value: number | string | undefined) =>
		value
			? new Date(value).toLocaleDateString(language, { month: 'short', day: 'numeric', year: 'numeric' })
			: t('users.wait.recent');

	// Localized "Friday, Oct 23 @ 9:00 AM" built from the helper's Date (the helper's own text is English only).
	const formatNext = (date: Date, fallback: string) => {
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return fallback;
		const day = date.toLocaleDateString(language, { weekday: 'long', month: 'short', day: 'numeric' });
		const time = date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
		return `${day} @ ${time}`;
	};

	const tabs: { value: TabKey; label: ReactNode }[] = [
		{ value: 'ALL', label: t('users.tab.all') },
		{ value: 'DIRECTORY', label: t('users.tab.directory', { count: number(platformUsers.length) }) },
		...(WAITLIST_ENABLED
			? [
					{
						value: 'WAITLIST' as TabKey,
						label: (
							<>
								<span>{t('users.tab.waitlist')}</span>
								{totalWaitlistCount > 0 && (
									<span className="rounded-full bg-amber-200 px-1.5 text-[10px] font-bold text-amber-900">
										{number(totalWaitlistCount)}
									</span>
								)}
							</>
						),
					},
			  ]
			: []),
		{ value: 'GROUPS', label: t('users.tab.groups', { count: number(groups.length) }) },
	];

	const approveButtons = (opts: { userId?: string; invitationId?: string; name: string; key: string }) => (
		<div className="flex flex-wrap items-center gap-2 md:justify-end">
			<Button
				type="button"
				size="sm"
				disabled={approvingId === opts.key}
				onClick={() => handleApprove({ userId: opts.userId, invitationId: opts.invitationId, name: opts.name })}
				className="min-h-[44px] px-3 text-xs font-semibold md:min-h-9"
			>
				{approvingId === opts.key ? (
					<span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
				) : (
					<>
						<Check className="me-1 h-3.5 w-3.5" aria-hidden />
						{t('users.wait.approve')}
					</>
				)}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={denyingId === opts.key}
				onClick={() => setDenyTarget({ userId: opts.userId, invitationId: opts.invitationId, name: opts.name })}
				className="min-h-[44px] border-red-300 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 md:min-h-9"
			>
				{t('users.wait.deny')}
			</Button>
		</div>
	);

	return (
		<div className="mx-auto w-full max-w-7xl space-y-8 pb-16 pt-2">
			{/* Header */}
			<PageHeader
				pill={t('users.pill')}
				title={t('users.title')}
				subtitle={t('users.subtitle')}
				refreshLabel={t('users.refresh')}
				refreshing={isRefreshing}
				onRefresh={() => loadData(true)}
			/>

			{/* Stat cards */}
			<div
				className={cn(
					'grid grid-cols-1 gap-4 sm:grid-cols-2',
					WAITLIST_ENABLED ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
				)}
			>
				<StatCard
					label={t('users.stat.total')}
					value={number(platformUsers.length)}
					icon={<Users className="h-5 w-5" />}
					iconTone="bg-purple-50 text-purple-700"
				/>
				{WAITLIST_ENABLED && (
					<StatCard
						label={t('users.stat.waitlist')}
						value={number(totalWaitlistCount)}
						icon={<UserPlus className="h-5 w-5" />}
						iconTone="bg-amber-50 text-amber-800"
					/>
				)}
				<StatCard
					label={t('users.stat.groups')}
					value={number(groups.length)}
					icon={<Layers className="h-5 w-5" />}
					iconTone="bg-emerald-50 text-emerald-800"
				/>
				<StatCard
					label={t('users.stat.assigned')}
					value={number(totalAssignedStudents)}
					icon={<UserCheck className="h-5 w-5" />}
					iconTone="bg-teal-50 text-teal-800"
				/>
			</div>

			{/* Section tabs */}
			<SectionTabs
				ariaLabel={t('users.tabs.label')}
				tabs={tabs}
				value={activeTab}
				onChange={(value) => setActiveTab(value as TabKey)}
			/>

			{/* SECTION 1: MASTER USER DIRECTORY */}
			{(activeTab === 'ALL' || activeTab === 'DIRECTORY') && (
				<section>
					<MasterUserDirectory
						users={platformUsers}
						groups={groups}
						isLoading={isLoading}
						onRefresh={() => loadData(true)}
						onInspectStudent={openStudentMirror}
					/>
				</section>
			)}

			{/* SECTION 2: WAITLIST APPROVALS (gated by WAITLIST_ENABLED) */}
			{WAITLIST_ENABLED && (activeTab === 'ALL' || activeTab === 'WAITLIST') && (
				<section className="overflow-hidden rounded-2xl border border-amber-300 bg-white">
					<div className="flex items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-5 py-4">
						<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-900" aria-hidden>
							<UserPlus className="h-4 w-4" />
						</span>
						<div className="min-w-0">
							<h2 className="flex flex-wrap items-center gap-2 font-display text-lg">
								{t('users.wait.title')}
								{totalWaitlistCount > 0 && (
									<span className="rounded-full bg-amber-200 px-2 py-0.5 font-sans text-xs font-bold text-amber-900">
										{t('users.wait.pending', { count: number(totalWaitlistCount) })}
									</span>
								)}
							</h2>
							<p className="text-xs text-slate-700">{t('users.wait.subtitle')}</p>
						</div>
					</div>

					{isLoading ? (
						<LoadingBlock label={t('users.dir.loading')} className="min-h-[160px]" />
					) : totalWaitlistCount === 0 ? (
						<EmptyBlock
							icon={<CheckCircle2 className="h-6 w-6" />}
							title={t('users.wait.emptyTitle')}
							body={t('users.wait.emptyBody')}
						/>
					) : (
						<>
							{/* Desktop / tablet: table */}
							<div className="hidden md:block">
								<table className="w-full text-start text-sm">
									<thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-700">
										<tr>
											<th scope="col" className="px-5 py-3 text-start">{t('users.wait.colStudent')}</th>
											<th scope="col" className="px-5 py-3 text-start">{t('users.wait.colEmail')}</th>
											<th scope="col" className="px-5 py-3 text-start">{t('users.wait.colDate')}</th>
											<th scope="col" className="px-5 py-3 text-end">{t('users.col.actions')}</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200">
										{waitlistUsers.map((user) => {
											const fullName =
												user.name ||
												`${user.firstName || ''} ${user.lastName || ''}`.trim() ||
												t('users.wait.applicant');
											const email = user.email || user.emailAddresses?.[0]?.emailAddress || '';
											return (
												<tr key={user.id} className="hover:bg-slate-50">
													<td className="px-5 py-3">
														<button
															type="button"
															onClick={() => openStudentMirror(user.id)}
															className={cn('flex items-center gap-2 rounded-lg text-start font-semibold hover:text-emerald-800', FOCUS)}
														>
															<Initial name={fullName} />
															<bdi>{fullName}</bdi>
														</button>
													</td>
													<td className="px-5 py-3 font-mono text-xs text-slate-800 [overflow-wrap:anywhere]">
														<bdi>{email}</bdi>
													</td>
													<td className="whitespace-nowrap px-5 py-3 text-xs text-slate-700">{formatDate(user.createdAt)}</td>
													<td className="px-5 py-3">
														{approveButtons({ userId: user.id, name: fullName, key: user.id })}
													</td>
												</tr>
											);
										})}
										{waitlistInvitations.map((inv) => (
											<tr key={inv.id} className="hover:bg-slate-50">
												<td className="px-5 py-3">
													<div className="flex items-center gap-2">
														<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800" aria-hidden>
															<Mail className="h-3.5 w-3.5" />
														</span>
														<span className="italic text-slate-800">{t('users.wait.invited')}</span>
													</div>
												</td>
												<td className="px-5 py-3 font-mono text-xs text-slate-800 [overflow-wrap:anywhere]">
													<bdi>{inv.emailAddress}</bdi>
												</td>
												<td className="whitespace-nowrap px-5 py-3 text-xs text-slate-700">{formatDate(inv.createdAt)}</td>
												<td className="px-5 py-3">
													{approveButtons({ invitationId: inv.id, name: inv.emailAddress, key: inv.id })}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Mobile: one card per request */}
							<ul className="divide-y divide-slate-200 md:hidden">
								{waitlistUsers.map((user) => {
									const fullName =
										user.name ||
										`${user.firstName || ''} ${user.lastName || ''}`.trim() ||
										t('users.wait.applicant');
									const email = user.email || user.emailAddresses?.[0]?.emailAddress || '';
									return (
										<li key={user.id} className="space-y-2 p-4">
											<button
												type="button"
												onClick={() => openStudentMirror(user.id)}
												className={cn('flex items-center gap-2 rounded-lg text-start font-semibold', FOCUS)}
											>
												<Initial name={fullName} />
												<bdi>{fullName}</bdi>
											</button>
											<p className="font-mono text-xs text-slate-800 [overflow-wrap:anywhere]"><bdi>{email}</bdi></p>
											<p className="text-xs text-slate-700">
												{t('users.wait.colDate')}: {formatDate(user.createdAt)}
											</p>
											{approveButtons({ userId: user.id, name: fullName, key: user.id })}
										</li>
									);
								})}
								{waitlistInvitations.map((inv) => (
									<li key={inv.id} className="space-y-2 p-4">
										<div className="flex items-center gap-2">
											<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800" aria-hidden>
												<Mail className="h-3.5 w-3.5" />
											</span>
											<span className="italic text-slate-800">{t('users.wait.invited')}</span>
										</div>
										<p className="font-mono text-xs text-slate-800 [overflow-wrap:anywhere]"><bdi>{inv.emailAddress}</bdi></p>
										<p className="text-xs text-slate-700">
											{t('users.wait.colDate')}: {formatDate(inv.createdAt)}
										</p>
										{approveButtons({ invitationId: inv.id, name: inv.emailAddress, key: inv.id })}
									</li>
								))}
							</ul>
						</>
					)}
				</section>
			)}

			{/* SECTION 3: STUDY GROUPS & CUSTOM SCHEDULING */}
			{(activeTab === 'ALL' || activeTab === 'GROUPS') && (
				<section className="space-y-4">
					<SectionHeading
						icon={<Users className="h-5 w-5" />}
						title={t('users.groups.title')}
						subtitle={t('users.groups.subtitle')}
						trailing={
							<Button
								type="button"
								variant="outline"
								className="min-h-[44px] self-start"
								onClick={() => {
									setEditingGroup(null);
									setIsGroupModalOpen(true);
								}}
							>
								<Plus className="me-1 h-4 w-4" aria-hidden />
								{t('users.groups.new')}
							</Button>
						}
					/>

					{groups.length === 0 ? (
						isLoading ? (
							<div className="rounded-2xl border border-slate-300 bg-white">
								<LoadingBlock label={t('users.dir.loading')} />
							</div>
						) : (
							<div className="rounded-2xl border border-dashed border-slate-400 bg-white">
								<EmptyBlock
									icon={<Users className="h-6 w-6" />}
									title={t('users.groups.emptyTitle')}
									body={t('users.groups.emptyBody')}
									action={
										<Button
											type="button"
											className="min-h-[44px]"
											onClick={() => {
												setEditingGroup(null);
												setIsGroupModalOpen(true);
											}}
										>
											<Plus className="me-1 h-4 w-4" aria-hidden />
											{t('users.groups.createFirst')}
										</Button>
									}
								/>
							</div>
						)
					) : (
						<div className="space-y-3.5">
							{groups.map((group) => {
								const isExpanded = !!expandedGroupIds[group.id];
								const studentCount = group.students?.length || 0;
								const nextSession = getNextUpcomingSession(group.name, group.schedule);
								const panelId = `group-members-${group.id}`;

								return (
									<div key={group.id} className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
										{/* Group header card */}
										<div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
											<button
												type="button"
												onClick={() => toggleGroupAccordion(group.id)}
												aria-expanded={isExpanded}
												aria-controls={panelId}
												aria-label={t(isExpanded ? 'users.groups.collapse' : 'users.groups.expand', { name: group.name })}
												className={cn('flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-start', FOCUS)}
											>
												<Initial name={group.name} className="h-10 w-10 rounded-xl text-base" />
												<span className="min-w-0 space-y-1">
													<span className="flex flex-wrap items-center gap-2">
														<bdi className="truncate font-display text-lg">{group.name}</bdi>
														<span className="text-xs font-medium text-slate-700">
															{countText('students', studentCount)}
														</span>
													</span>
													{nextSession && (
														<span className="block text-xs font-medium text-emerald-800">
															{t('users.groups.next', { when: formatNext(nextSession.date, nextSession.fullFormatted) })}
														</span>
													)}
												</span>
											</button>

											<div className="flex flex-wrap items-center gap-2">
												{Array.isArray(group.schedule) && group.schedule.length > 0
													? group.schedule.map((s: { day: string; time: string }, idx: number) => (
															<span
																key={idx}
																className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800"
															>
																<Clock className="h-3 w-3 text-slate-600" aria-hidden />
																<bdi>{s.day} @ {s.time}</bdi>
															</span>
													  ))
													: null}
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => openAddStudentsModal(group)}
													className="min-h-[44px] border-emerald-500 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 lg:min-h-9"
												>
													<UserPlus className="me-1 h-3.5 w-3.5" aria-hidden />
													{t('users.groups.addStudents')}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => {
														setEditingGroup(group);
														setIsGroupModalOpen(true);
													}}
													className="min-h-[44px] px-3 text-xs font-semibold lg:min-h-9"
												>
													<Edit className="me-1 h-3.5 w-3.5" aria-hidden />
													{t('users.groups.schedule')}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													aria-label={t('users.groups.delete', { name: group.name })}
													title={t('users.groups.delete', { name: group.name })}
													onClick={() => setGroupToDelete({ id: group.id, name: group.name })}
													className="min-h-[44px] min-w-[44px] border-red-300 px-3 text-red-700 hover:bg-red-50 lg:min-h-9 lg:min-w-9"
												>
													<Trash2 className="h-3.5 w-3.5" aria-hidden />
												</Button>
												<button
													type="button"
													onClick={() => toggleGroupAccordion(group.id)}
													aria-expanded={isExpanded}
													aria-controls={panelId}
													aria-label={t(isExpanded ? 'users.groups.collapse' : 'users.groups.expand', { name: group.name })}
													className={cn(
														'grid h-11 w-11 place-items-center rounded-lg text-slate-800 hover:bg-slate-100 lg:h-9 lg:w-9',
														FOCUS
													)}
												>
													{isExpanded ? (
														<ChevronDown className="h-4 w-4" aria-hidden />
													) : (
														<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
													)}
												</button>
											</div>
										</div>

										{/* Expanded member list */}
										{isExpanded && (
											<div id={panelId} className="space-y-3 border-t border-slate-200 bg-slate-50 p-4 sm:p-5">
												<div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
													<div className="flex items-center gap-2">
														<span>{t('users.groups.members')}</span>
														<span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-800">
															{countText('students', studentCount)}
														</span>
													</div>
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() => openAddStudentsModal(group)}
														className="min-h-[44px] border-emerald-500 bg-white px-3 text-xs font-semibold normal-case tracking-normal text-emerald-900 hover:bg-emerald-50 lg:min-h-9"
													>
														<UserPlus className="me-1 h-3.5 w-3.5" aria-hidden />
														{t('users.groups.addPlus')}
													</Button>
												</div>

												{studentCount === 0 ? (
													<EmptyBlock
														icon={<Users className="h-6 w-6" />}
														title={t('users.groups.noMembers')}
														className="rounded-xl border border-dashed border-slate-300 bg-white py-6"
														action={
															<Button
																type="button"
																size="sm"
																className="min-h-[44px]"
																onClick={() => openAddStudentsModal(group)}
															>
																<UserPlus className="me-1.5 h-3.5 w-3.5" aria-hidden />
																{t('users.groups.addTo', { group: group.name })}
															</Button>
														}
													/>
												) : (
													<div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
														{group.students?.map((s) => {
															const studentName = s.user?.name || '—';
															const studentEmail = s.user?.email || '';
															return (
																<div
																	key={s.id}
																	className="flex items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white p-3"
																>
																	<button
																		type="button"
																		onClick={() => openStudentMirror(s.userId)}
																		className={cn('flex min-w-0 items-center gap-2.5 rounded-lg text-start', FOCUS)}
																	>
																		{s.user?.imageUrl ? (
																			// eslint-disable-next-line @next/next/no-img-element
																			<img
																				src={s.user.imageUrl}
																				alt=""
																				className="h-8 w-8 shrink-0 rounded-full border border-slate-300 object-cover"
																			/>
																		) : (
																			<Initial name={studentName} />
																		)}
																		<span className="min-w-0 space-y-0.5">
																			<bdi className="block truncate text-xs font-bold text-slate-900">{studentName}</bdi>
																			<bdi className="block truncate font-mono text-[11px] text-slate-700">{studentEmail}</bdi>
																		</span>
																	</button>
																	<Button
																		type="button"
																		size="sm"
																		variant="ghost"
																		aria-label={t('users.groups.moveAria', { name: studentName })}
																		onClick={() =>
																			openReassignModal(
																				{ id: s.userId, name: studentName, email: studentEmail },
																				group.id
																			)
																		}
																		className="min-h-[44px] shrink-0 px-3 text-xs text-slate-800 hover:text-slate-900"
																	>
																		{t('users.groups.move')}
																	</Button>
																</div>
															);
														})}
													</div>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</section>
			)}

			{/* Confirm: remove a waitlist request */}
			<ConfirmDialog
				open={!!denyTarget}
				onOpenChange={(open) => !open && setDenyTarget(null)}
				icon={<UserPlus className="h-6 w-6" />}
				title={t('users.wait.denyTitle')}
				description={t('users.wait.denyBody', { name: denyTarget?.name ?? '' })}
				confirmLabel={t('users.wait.denyConfirm')}
				cancelLabel={t('users.cancel')}
				busy={denyingId !== null}
				onConfirm={async () => {
					const target = denyTarget;
					if (!target) return;
					await handleDeny(target);
					setDenyTarget(null);
				}}
			/>

			{/* Confirm: delete a group */}
			<ConfirmDialog
				open={!!groupToDelete}
				onOpenChange={(open) => !open && setGroupToDelete(null)}
				icon={<Trash2 className="h-6 w-6" />}
				title={t('users.groups.deleteTitle')}
				description={t('users.groups.deleteBody', { name: groupToDelete?.name ?? '' })}
				confirmLabel={t('users.groups.deleteConfirm')}
				cancelLabel={t('users.cancel')}
				busy={isDeletingGroup}
				onConfirm={() => groupToDelete && handleDeleteGroup(groupToDelete.id, groupToDelete.name)}
			/>

			{/* MODALS & DRAWERS (unchanged behavior) */}
			<GroupFormModal
				isOpen={isGroupModalOpen}
				onClose={() => setIsGroupModalOpen(false)}
				onSuccess={() => loadData(true)}
				initialGroup={editingGroup}
			/>

			<ReassignModal
				isOpen={isReassignModalOpen}
				onClose={() => setIsReassignModalOpen(false)}
				onSuccess={() => loadData(true)}
				student={reassignStudent}
				groups={groups}
				currentGroupId={reassignCurrentGroupId}
			/>

			<AddStudentsModal
				isOpen={isAddStudentsOpen}
				onClose={() => {
					setIsAddStudentsOpen(false);
					setTargetAddStudentsGroup(null);
				}}
				onSuccess={() => loadData(true)}
				group={targetAddStudentsGroup}
				currentMemberIds={
					targetAddStudentsGroup?.students?.map((s: { userId?: string; id: string }) => s.userId || s.id) || []
				}
			/>

			<StudentMirrorDrawer
				studentId={mirrorStudentId}
				isOpen={isMirrorOpen}
				onClose={() => {
					setIsMirrorOpen(false);
					setMirrorStudentId(null);
				}}
				onSubmissionUpdated={() => loadData(true)}
			/>
		</div>
	);
};
