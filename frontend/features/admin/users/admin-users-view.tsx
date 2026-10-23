'use client';

import { useEffect, useState } from 'react';
import { api } from '@/frontend/lib/api';
import {
	AlertCircle,
	Calendar,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Edit,
	Layers,
	Loader2,
	Mail,
	Plus,
	RefreshCw,
	ShieldCheck,
	Trash2,
	UserCheck,
	UserPlus,
	Users,
	UserX,
	X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import { cn } from '@/shared/utils';
import { getNextUpcomingSession } from '@/shared/group-schedule';
import { GroupFormModal, type GroupItem } from '@/frontend/features/admin/users/group-form-modal';
import { ReassignModal } from '@/frontend/features/admin/users/reassign-modal';
import { StudentMirrorDrawer } from '@/frontend/features/admin/users/student-mirror-drawer';
import { AddStudentsModal } from '@/frontend/features/admin/users/add-students-modal';
import { MasterUserDirectory, type PlatformUser } from '@/frontend/features/admin/users/master-user-directory';

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

export const AdminUsersView = () => {
	const [waitlistUsers, setWaitlistUsers] = useState<WaitlistUser[]>([]);
	const [waitlistInvitations, setWaitlistInvitations] = useState<
		WaitlistInvitation[]
	>([]);
	const [groups, setGroups] = useState<GroupItem[]>([]);
	const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
	const [activeTab, setActiveTab] = useState<'ALL' | 'DIRECTORY' | 'WAITLIST' | 'GROUPS'>('ALL');
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// Action loading states
	const [approvingId, setApprovingId] = useState<string | null>(null);
	const [denyingId, setDenyingId] = useState<string | null>(null);

	// Modals
	const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);

	const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
	const [reassignStudent, setReassignStudent] = useState<{
		id: string;
		name: string;
		email?: string;
	} | null>(null);
	const [reassignCurrentGroupId, setReassignCurrentGroupId] = useState<
		string | null
	>(null);

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
	const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>(
		{}
	);

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
			toast.error('Failed to load users and group data.');
		} finally {
			setIsLoading(false);
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		loadData();
	}, []);

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
			toast.success(`Approved ${opts.name}! Account activated.`);
			// Instant local filter
			if (opts.userId) {
				setWaitlistUsers((prev) => prev.filter((u) => u.id !== opts.userId));
			} else if (opts.invitationId) {
				setWaitlistInvitations((prev) =>
					prev.filter((inv) => inv.id !== opts.invitationId)
				);
			}
			loadData(true);
		} catch (error) {
			console.error(error);
			toast.error('Failed to approve student.');
		} finally {
			setApprovingId(null);
		}
	};

	// 1-Tap Waitlist Deny
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
			toast.success(`Removed ${opts.name} from waitlist.`);
			if (opts.userId) {
				setWaitlistUsers((prev) => prev.filter((u) => u.id !== opts.userId));
			} else if (opts.invitationId) {
				setWaitlistInvitations((prev) =>
					prev.filter((inv) => inv.id !== opts.invitationId)
				);
			}
		} catch (error) {
			console.error(error);
			toast.error('Failed to remove waitlist request.');
		} finally {
			setDenyingId(null);
		}
	};

	// Delete Group
	const handleDeleteGroup = async (groupId: string, groupName: string) => {
		if (
			!confirm(
				`Are you sure you want to delete "${groupName}"? Students will be unassigned.`
			)
		) {
			return;
		}

		try {
			await api.delete(`/api/admin/groups?groupId=${groupId}`);
			toast.success(`Group "${groupName}" deleted.`);
			loadData(true);
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete group.');
		}
	};

	const totalWaitlistCount = waitlistUsers.length + waitlistInvitations.length;
	const totalAssignedStudents = groups.reduce(
		(sum, g) => sum + (g.students?.length || 0),
		0
	);

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

	return (
		<div className="mx-auto w-full max-w-7xl space-y-8 pb-16 pt-2 animate-in fade-in-50 duration-200">
			{/* Top Header & Quick Stats */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div className="space-y-1">
					<div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
						<ShieldCheck className="h-3.5 w-3.5" />
						Admin &amp; Teacher Portal
					</div>
					<h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
						Users &amp; Study Groups
					</h1>
					<p className="text-sm text-slate-500">
						Manage student admissions, configure recurring group schedules, and inspect student progress.
					</p>
				</div>

				<div className="flex items-center gap-2.5">
					<Button
						variant="outline"
						size="sm"
						onClick={() => loadData(true)}
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

			{/* Quick Metric Cards with GPU-accelerated hover FX */}
			<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Total Users
							</p>
							<p className="mt-1.5 text-2xl font-bold text-slate-900">
								{platformUsers.length}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-700">
							<Users className="h-5 w-5" />
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Pending Waitlist
							</p>
							<p className="mt-1.5 text-2xl font-bold text-slate-900">
								{totalWaitlistCount}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
							<UserPlus className="h-5 w-5" />
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Study Groups
							</p>
							<p className="mt-1.5 text-2xl font-bold text-slate-900">
								{groups.length}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
							<Layers className="h-5 w-5" />
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md active:translate-y-0 cursor-default">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Assigned Students
							</p>
							<p className="mt-1.5 text-2xl font-bold text-slate-900">
								{totalAssignedStudents}
							</p>
						</div>
						<div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
							<UserCheck className="h-5 w-5" />
						</div>
					</div>
				</div>
			</div>

			{/* Section Tabs Switcher */}
			<div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-2xl w-fit border border-slate-200/80">
				<button
					type="button"
					onClick={() => setActiveTab('ALL')}
					className={cn(
						'px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
						activeTab === 'ALL'
							? 'bg-white text-slate-900 shadow-xs'
							: 'text-slate-600 hover:text-slate-900'
					)}
				>
					All Sections
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('DIRECTORY')}
					className={cn(
						'px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
						activeTab === 'DIRECTORY'
							? 'bg-white text-slate-900 shadow-xs'
							: 'text-slate-600 hover:text-slate-900'
					)}
				>
					Master Directory ({platformUsers.length})
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('WAITLIST')}
					className={cn(
						'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
						activeTab === 'WAITLIST'
							? 'bg-white text-slate-900 shadow-xs'
							: 'text-slate-600 hover:text-slate-900'
					)}
				>
					<span>Waitlist</span>
					{totalWaitlistCount > 0 && (
						<span className="rounded-full bg-amber-100 text-amber-900 px-1.5 py-0.2 text-[10px] font-bold">
							{totalWaitlistCount}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('GROUPS')}
					className={cn(
						'px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer',
						activeTab === 'GROUPS'
							? 'bg-white text-slate-900 shadow-xs'
							: 'text-slate-600 hover:text-slate-900'
					)}
				>
					Study Groups ({groups.length})
				</button>
			</div>

			{/* ============================================================== */}
			{/* SECTION 1 — MASTER USER DIRECTORY                             */}
			{/* ============================================================== */}
			{(activeTab === 'ALL' || activeTab === 'DIRECTORY') && (
				<section className="transition-all duration-200">
					<MasterUserDirectory
						users={platformUsers}
						groups={groups}
						isLoading={isLoading}
						onRefresh={() => loadData(true)}
						onInspectStudent={openStudentMirror}
					/>
				</section>
			)}

			{/* ============================================================== */}
			{/* SECTION 2 — WAITLIST APPROVALS (TOP PRIORITY)                 */}
			{/* ============================================================== */}
			{(activeTab === 'ALL' || activeTab === 'WAITLIST') && (
				<section className="rounded-2xl border border-amber-200/90 bg-white shadow-sm overflow-hidden transition-all duration-200">
				<div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/50 px-6 py-4">
					<div className="flex items-center gap-2.5">
						<div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-800">
							<UserPlus className="h-4 w-4" />
						</div>
						<div>
							<h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
								Waitlist Approvals
								{totalWaitlistCount > 0 && (
									<span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900">
										{totalWaitlistCount} Pending
									</span>
								)}
							</h2>
							<p className="text-xs text-slate-500">
								Approve new student sign-ups to activate their account as an enrolled student.
							</p>
						</div>
					</div>
				</div>

				{isLoading ? (
					<div className="flex min-h-[160px] items-center justify-center p-8">
						<Loader2 className="h-6 w-6 animate-spin text-amber-600" />
					</div>
				) : totalWaitlistCount === 0 ? (
					<div className="flex flex-col items-center justify-center py-10 px-4 text-center">
						<div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 mb-3">
							<CheckCircle2 className="h-6 w-6" />
						</div>
						<p className="text-sm font-semibold text-slate-800">
							No pending waitlist requests
						</p>
						<p className="text-xs text-slate-400 mt-0.5">
							All registered students have been approved and activated.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
									<th className="py-3 px-6">Student</th>
									<th className="py-3 px-6">Email</th>
									<th className="py-3 px-6">Request Date</th>
									<th className="py-3 px-6 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 text-sm">
								{/* Pending Users in Clerk */}
								{waitlistUsers.map((user) => {
									const fullName =
										user.name ||
										`${user.firstName || ''} ${user.lastName || ''}`.trim() ||
										'New Applicant';
									const email = user.email || user.emailAddresses?.[0]?.emailAddress || '';
									const dateStr = user.createdAt
										? new Date(user.createdAt).toLocaleDateString('en-US', {
												month: 'short',
												day: 'numeric',
												year: 'numeric',
										  })
										: 'Recent';

									return (
										<tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
											<td className="py-3.5 px-6 font-semibold text-slate-900">
												<button
													type="button"
													onClick={() => openStudentMirror(user.id)}
													className="text-left font-semibold text-sky-700 hover:underline cursor-pointer flex items-center gap-2"
												>
													<div className="grid h-7 w-7 place-items-center rounded-full bg-sky-100 text-sky-700 text-xs font-bold">
														{fullName.charAt(0)}
													</div>
													<span>{fullName}</span>
												</button>
											</td>
											<td className="py-3.5 px-6 text-xs text-slate-600 font-mono">
												{email}
											</td>
											<td className="py-3.5 px-6 text-xs text-slate-500">
												{dateStr}
											</td>
											<td className="py-3.5 px-6 text-right">
												<div className="flex items-center justify-end gap-2">
													<Button
														size="sm"
														disabled={approvingId === user.id}
														onClick={() =>
															handleApprove({ userId: user.id, name: fullName })
														}
														className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs"
													>
														{approvingId === user.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<>
																<Check className="h-3.5 w-3.5 mr-1" />
																Approve Student
															</>
														)}
													</Button>
													<Button
														size="sm"
														variant="outline"
														disabled={denyingId === user.id}
														onClick={() =>
															handleDeny({ userId: user.id, name: fullName })
														}
														className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 text-xs"
													>
														{denyingId === user.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															'Deny'
														)}
													</Button>
												</div>
											</td>
										</tr>
									);
								})}

								{/* Pending Invitations */}
								{waitlistInvitations.map((inv) => {
									const dateStr = inv.createdAt
										? new Date(inv.createdAt).toLocaleDateString('en-US', {
												month: 'short',
												day: 'numeric',
												year: 'numeric',
										  })
										: 'Recent';

									return (
										<tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
											<td className="py-3.5 px-6 font-semibold text-slate-900">
												<div className="flex items-center gap-2">
													<div className="grid h-7 w-7 place-items-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
														<Mail className="h-3.5 w-3.5" />
													</div>
													<span className="italic text-slate-700">Invited Student</span>
												</div>
											</td>
											<td className="py-3.5 px-6 text-xs text-slate-600 font-mono">
												{inv.emailAddress}
											</td>
											<td className="py-3.5 px-6 text-xs text-slate-500">
												{dateStr}
											</td>
											<td className="py-3.5 px-6 text-right">
												<div className="flex items-center justify-end gap-2">
													<Button
														size="sm"
														disabled={approvingId === inv.id}
														onClick={() =>
															handleApprove({
																invitationId: inv.id,
																name: inv.emailAddress,
															})
														}
														className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs"
													>
														{approvingId === inv.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<>
																<Check className="h-3.5 w-3.5 mr-1" />
																Approve Student
															</>
														)}
													</Button>
													<Button
														size="sm"
														variant="outline"
														disabled={denyingId === inv.id}
														onClick={() =>
															handleDeny({
																invitationId: inv.id,
																name: inv.emailAddress,
															})
														}
														className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 text-xs"
													>
														{denyingId === inv.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															'Deny'
														)}
													</Button>
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
			)}

			{/* ============================================================== */}
			{/* SECTION 3 — GROUP CREATION & CUSTOM SCHEDULING                 */}
			{/* ============================================================== */}
			{(activeTab === 'ALL' || activeTab === 'GROUPS') && (
				<section className="space-y-4 transition-all duration-200">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
								<Users className="h-5 w-5 text-sky-700" />
								Study Groups &amp; Custom Scheduling
							</h2>
						<p className="text-xs text-slate-500">
							Configure recurring weekly meeting times per group and assign enrolled students.
						</p>
					</div>

					<Button
						size="sm"
						onClick={() => {
							setEditingGroup(null);
							setIsGroupModalOpen(true);
						}}
						className="bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-xs text-xs"
					>
						<Plus className="h-3.5 w-3.5 mr-1" />
						New Group
					</Button>
				</div>

				{groups.length === 0 ? (
					<div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
						<Users className="h-8 w-8 text-slate-300 mb-2" />
						<p className="text-sm font-semibold text-slate-800">
							No study groups created yet
						</p>
						<p className="text-xs text-slate-400 mt-1 max-w-sm">
							Create your first group to start scheduling sessions and organizing students.
						</p>
						<Button
							size="sm"
							onClick={() => {
								setEditingGroup(null);
								setIsGroupModalOpen(true);
							}}
							className="mt-4 bg-slate-900 hover:bg-slate-800 text-white text-xs"
						>
							<Plus className="h-3.5 w-3.5 mr-1" />
							Create First Group
						</Button>
					</div>
				) : (
					<div className="space-y-3.5">
						{groups.map((group) => {
							const isExpanded = !!expandedGroupIds[group.id];
							const studentCount = group.students?.length || 0;
							const nextSession = getNextUpcomingSession(
								group.name,
								group.schedule
							);

							return (
								<div
									key={group.id}
									className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden transition"
								>
									{/* Group Header Card */}
									<div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-3 border-b border-slate-100 bg-white">
										<div
											onClick={() => toggleGroupAccordion(group.id)}
											className="flex items-center gap-3.5 cursor-pointer select-none flex-1 min-w-0"
										>
											<div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700 font-bold">
												{group.name.charAt(0)}
											</div>
											<div className="space-y-1 min-w-0">
												<div className="flex items-center gap-2">
													<h3 className="font-bold text-slate-900 text-base truncate">
														{group.name}
													</h3>
													<span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 shrink-0">
														{studentCount} {studentCount === 1 ? 'student' : 'students'}
													</span>
												</div>

												{/* Next Session pill */}
												{nextSession && (
													<p className="text-xs text-sky-700 font-medium">
														Next: {nextSession.fullFormatted}
													</p>
												)}
											</div>
										</div>

										<div className="flex items-center gap-2 shrink-0">
											{/* Schedule Tags */}
											{Array.isArray(group.schedule) && group.schedule.length > 0 ? (
												<div className="hidden md:flex items-center gap-1.5 flex-wrap">
													{group.schedule.map((s: any, idx: number) => (
														<span
															key={idx}
															className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
														>
															<Clock className="h-3 w-3 text-slate-400" />
															{s.day} @ {s.time}
														</span>
													))}
												</div>
											) : null}

											{/* Action Buttons */}
											<Button
												size="sm"
												variant="outline"
												onClick={() => openAddStudentsModal(group)}
												className="h-8 border-sky-200 bg-sky-50/70 text-sky-700 hover:bg-sky-100 hover:text-sky-800 text-xs font-semibold"
											>
												<UserPlus className="h-3.5 w-3.5 mr-1" />
												Add Students
											</Button>

											<Button
												size="sm"
												variant="outline"
												onClick={() => {
													setEditingGroup(group);
													setIsGroupModalOpen(true);
												}}
												className="h-8 border-slate-200 text-slate-700 hover:bg-slate-100 text-xs"
											>
												<Edit className="h-3.5 w-3.5 mr-1" />
												Schedule
											</Button>

											<Button
												size="sm"
												variant="outline"
												onClick={() => handleDeleteGroup(group.id, group.name)}
												className="h-8 border-slate-200 text-rose-600 hover:bg-rose-50 hover:border-rose-200 text-xs"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>

											<button
												type="button"
												onClick={() => toggleGroupAccordion(group.id)}
												className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
											>
												{isExpanded ? (
													<ChevronDown className="h-4 w-4" />
												) : (
													<ChevronRight className="h-4 w-4" />
												)}
											</button>
										</div>
									</div>

									{/* Expanded Student List in Group */}
									{isExpanded && (
										<div className="bg-slate-50/50 p-5 space-y-3">
											<div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
												<div className="flex items-center gap-2">
													<span>Enrolled Group Members</span>
													<span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
														{studentCount} Students
													</span>
												</div>
												<Button
													size="sm"
													variant="outline"
													onClick={() => openAddStudentsModal(group)}
													className="h-7 text-xs font-semibold border-sky-200 bg-white text-sky-700 hover:bg-sky-50 hover:text-sky-800 shadow-2xs"
												>
													<UserPlus className="h-3.5 w-3.5 mr-1" />
													+ Add Students
												</Button>
											</div>

											{studentCount === 0 ? (
												<div className="flex flex-col items-center justify-center p-6 text-center border border-dashed border-slate-200 rounded-xl bg-white">
													<Users className="h-8 w-8 text-slate-300 mb-1.5" />
													<p className="text-xs font-medium text-slate-600">
														No students assigned to this group yet.
													</p>
													<Button
														size="sm"
														onClick={() => openAddStudentsModal(group)}
														className="mt-3 h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-xs"
													>
														<UserPlus className="h-3.5 w-3.5 mr-1.5" />
														+ Add Students to {group.name}
													</Button>
												</div>
											) : (
												<div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
													{group.students?.map((s) => {
														const studentName = s.user?.name || 'Student';
														const studentEmail = s.user?.email || '';

														return (
															<div
																key={s.id}
																className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-2xs hover:border-sky-300 transition"
															>
																<button
																	type="button"
																	onClick={() => openStudentMirror(s.userId)}
																	className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
																>
																	{s.user?.imageUrl ? (
																		<img
																			src={s.user.imageUrl}
																			alt={studentName}
																			className="h-8 w-8 rounded-full border border-slate-200 object-cover"
																		/>
																	) : (
																		<div className="grid h-8 w-8 place-items-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs shrink-0">
																			{studentName.charAt(0)}
																		</div>
																	)}
																	<div className="min-w-0 space-y-0.5">
																		<p className="text-xs font-bold text-slate-900 truncate group-hover:text-sky-700 transition">
																			{studentName}
																		</p>
																		<p className="text-[11px] text-slate-400 truncate font-mono">
																			{studentEmail}
																		</p>
																	</div>
																</button>

																<Button
																	size="sm"
																	variant="ghost"
																	onClick={() =>
																		openReassignModal(
																			{
																				id: s.userId,
																				name: studentName,
																				email: studentEmail,
																			},
																			group.id
																		)
																	}
																	className="h-7 text-[11px] text-slate-500 hover:text-slate-900"
																>
																	Move
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

			{/* ============================================================== */}
			{/* MODALS & DRAWERS                                              */}
			{/* ============================================================== */}
			{/* 1. Group Create/Edit Modal */}
			<GroupFormModal
				isOpen={isGroupModalOpen}
				onClose={() => setIsGroupModalOpen(false)}
				onSuccess={() => loadData(true)}
				initialGroup={editingGroup}
			/>

			{/* 2. Reassign Student Modal */}
			<ReassignModal
				isOpen={isReassignModalOpen}
				onClose={() => setIsReassignModalOpen(false)}
				onSuccess={() => loadData(true)}
				student={reassignStudent}
				groups={groups}
				currentGroupId={reassignCurrentGroupId}
			/>

			{/* 3. Add Students to Group Modal */}
			<AddStudentsModal
				isOpen={isAddStudentsOpen}
				onClose={() => {
					setIsAddStudentsOpen(false);
					setTargetAddStudentsGroup(null);
				}}
				onSuccess={() => loadData(true)}
				group={targetAddStudentsGroup}
				currentMemberIds={
					targetAddStudentsGroup?.students?.map(
						(s: any) => s.userId || s.id
					) || []
				}
			/>

			{/* 4. Section 3: Student Profile Mirror Drawer */}
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
