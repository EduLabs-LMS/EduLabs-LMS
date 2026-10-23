'use client';

import { useState, useMemo } from 'react';
import { api } from '@/frontend/lib/api';
import {
	Check,
	CheckCircle2,
	Clock,
	Filter,
	Loader2,
	MoreVertical,
	Search,
	Shield,
	ShieldAlert,
	ShieldCheck,
	Trash2,
	UserCheck,
	UserMinus,
	UserPlus,
	Users,
	X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/frontend/components/ui/dialog';
import { cn } from '@/shared/utils';
import type { GroupItem } from '@/frontend/features/admin/users/group-form-modal';

export interface PlatformUser {
	id: string;
	externalId: string;
	name: string;
	email: string;
	role: string;
	isApproved: boolean;
	approvedAt?: string | null;
	approvedBy?: string | null;
	createdAt: string | number;
	assignedGroups?: { id: string; name: string }[];
	currentGroupId?: string | null;
	currentGroupName?: string | null;
	submissionsCount?: number;
}

interface MasterUserDirectoryProps {
	users: PlatformUser[];
	groups: GroupItem[];
	isLoading: boolean;
	onRefresh: () => void;
	onInspectStudent?: (studentId: string) => void;
}

export const MasterUserDirectory = ({
	users,
	groups,
	isLoading,
	onRefresh,
	onInspectStudent,
}: MasterUserDirectoryProps) => {
	const [searchQuery, setSearchQuery] = useState('');
	const [statusFilter, setStatusFilter] = useState<'ALL' | 'APPROVED' | 'PENDING'>('ALL');
	const [roleFilter, setRoleFilter] = useState<string>('ALL');

	// Group Assignment Modal State
	const [groupModalUser, setGroupModalUser] = useState<PlatformUser | null>(null);
	const [selectedGroupId, setSelectedGroupId] = useState<string>('NONE');
	const [isSavingGroup, setIsSavingGroup] = useState(false);

	// Delete Confirmation State
	const [userToDelete, setUserToDelete] = useState<PlatformUser | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// 1-Tap Toggle Loading State
	const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

	// Filtered users list
	const filteredUsers = useMemo(() => {
		return users.filter((user) => {
			const matchesSearch =
				user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				user.email.toLowerCase().includes(searchQuery.toLowerCase());

			const matchesStatus =
				statusFilter === 'ALL'
					? true
					: statusFilter === 'APPROVED'
					? user.isApproved
					: !user.isApproved;

			const matchesRole =
				roleFilter === 'ALL'
					? true
					: user.role.toUpperCase() === roleFilter.toUpperCase();

			return matchesSearch && matchesStatus && matchesRole;
		});
	}, [users, searchQuery, statusFilter, roleFilter]);

	// 1-Tap Toggle Approval Status
	const handleToggleApproval = async (user: PlatformUser) => {
		try {
			setTogglingUserId(user.id);
			const newStatus = !user.isApproved;
			await api.patch('/api/admin/users', {
				userId: user.id,
				isApproved: newStatus,
			});

			toast.success(
				newStatus
					? `Approved ${user.name} for platform access.`
					: `Revoked access for ${user.name} (account moved to waitlist).`
			);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error('Failed to update approval status.');
		} finally {
			setTogglingUserId(null);
		}
	};

	// Open Group Assignment Modal
	const openGroupModal = (user: PlatformUser) => {
		setGroupModalUser(user);
		setSelectedGroupId(user.currentGroupId || 'NONE');
	};

	// Save Group Assignment
	const handleSaveGroupAssignment = async () => {
		if (!groupModalUser) return;
		try {
			setIsSavingGroup(true);
			await api.patch('/api/admin/users', {
				userId: groupModalUser.id,
				groupId: selectedGroupId === 'NONE' ? null : selectedGroupId,
			});

			toast.success(`Group assignment updated for ${groupModalUser.name}.`);
			setGroupModalUser(null);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error('Failed to update group assignment.');
		} finally {
			setIsSavingGroup(false);
		}
	};

	// 1-Tap Delete User from Database
	const handleConfirmDelete = async () => {
		if (!userToDelete) return;
		try {
			setIsDeleting(true);
			await api.delete(`/api/admin/users?userId=${userToDelete.id}`);
			toast.success(`Deleted user record for ${userToDelete.name}.`);
			setUserToDelete(null);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error('Failed to delete user.');
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<div className="space-y-4">
			{/* Section Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
						<Users className="h-5 w-5 text-sky-700" />
						Master User Directory
					</h2>
					<p className="text-xs text-slate-500">
						Comprehensive database of all registered students, teachers, and admins on the platform.
					</p>
				</div>

				<div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs">
					<UserCheck className="h-4 w-4 text-emerald-600" />
					<span>Total Registered: {users.length}</span>
				</div>
			</div>

			{/* Search & Filter Toolbar */}
			<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
				<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
					<Filter className="h-3.5 w-3.5 text-slate-400" />
					Directory Search &amp; Filters
				</div>

				<div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
					{/* Search by Name or Email */}
					<div className="relative">
						<Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
						<Input
							placeholder="Search by student name or email..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9 h-10 text-xs border-slate-200 bg-slate-50 focus:bg-white"
						/>
					</div>

					{/* Approval Status Filter */}
					<div>
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value as any)}
							aria-label="Filter by approval status"
							className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
						>
							<option value="ALL">All Approval Statuses</option>
							<option value="APPROVED">Approved Only</option>
							<option value="PENDING">Pending Approval (Waitlist)</option>
						</select>
					</div>

					{/* Role Filter */}
					<div>
						<select
							value={roleFilter}
							onChange={(e) => setRoleFilter(e.target.value)}
							aria-label="Filter by role"
							className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
						>
							<option value="ALL">All Roles</option>
							<option value="STUDENT">Students</option>
							<option value="TEACHER">Teachers</option>
							<option value="ADMIN">Admins</option>
						</select>
					</div>
				</div>
			</div>

			{/* Master Table */}
			<div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
				{isLoading ? (
					<div className="flex h-48 flex-col items-center justify-center gap-3">
						<Loader2 className="h-6 w-6 animate-spin text-sky-600" />
						<span className="text-xs text-slate-500 font-medium">
							Loading platform user directory...
						</span>
					</div>
				) : filteredUsers.length === 0 ? (
					<div className="flex min-h-[220px] flex-col items-center justify-center p-8 text-center">
						<Users className="h-8 w-8 text-slate-300 mb-2" />
						<p className="text-sm font-semibold text-slate-800">
							No users match the selected criteria
						</p>
						<p className="text-xs text-slate-400 mt-1 max-w-sm">
							Try adjusting your search query or reset the approval and role filters.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
								<tr>
									<th className="py-3 px-6">Student Name</th>
									<th className="py-3 px-6">Email Address</th>
									<th className="py-3 px-6">Role</th>
									<th className="py-3 px-6">Approval Status</th>
									<th className="py-3 px-6">Assigned Group</th>
									<th className="py-3 px-6">Sign-Up Date</th>
									<th className="py-3 px-6 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{filteredUsers.map((user) => {
									const isStudent = user.role.toUpperCase() === 'STUDENT';
									const dateStr = user.createdAt
										? new Date(user.createdAt).toLocaleDateString('en-US', {
												month: 'short',
												day: 'numeric',
												year: 'numeric',
										  })
										: '—';

									return (
										<tr
											key={user.id}
											className="hover:bg-slate-50/80 transition-colors"
										>
											{/* Name */}
											<td className="py-3.5 px-6 font-semibold text-slate-900">
												<button
													type="button"
													onClick={() => onInspectStudent?.(user.id)}
													className="flex items-center gap-2.5 text-left hover:text-sky-700 transition cursor-pointer"
												>
													<div className="grid h-8 w-8 place-items-center rounded-full bg-sky-100 text-sky-700 font-bold text-xs shrink-0">
														{user.name.charAt(0)}
													</div>
													<div className="min-w-0">
														<span className="block font-bold text-slate-900 text-xs sm:text-sm truncate">
															{user.name}
														</span>
														{user.submissionsCount ? (
															<span className="text-[10px] text-slate-400 font-normal">
																{user.submissionsCount} submissions
															</span>
														) : null}
													</div>
												</button>
											</td>

											{/* Email */}
											<td className="py-3.5 px-6 text-xs text-slate-600 font-mono">
												{user.email}
											</td>

											{/* Role */}
											<td className="py-3.5 px-6">
												<span
													className={cn(
														'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
														user.role.toUpperCase() === 'ADMIN'
															? 'bg-purple-50 text-purple-700 border border-purple-200'
															: user.role.toUpperCase() === 'TEACHER'
															? 'bg-amber-50 text-amber-700 border border-amber-200'
															: 'bg-slate-100 text-slate-700 border border-slate-200'
													)}
												>
													{user.role.toUpperCase() === 'ADMIN' ? (
														<ShieldCheck className="h-3 w-3" />
													) : user.role.toUpperCase() === 'TEACHER' ? (
														<Shield className="h-3 w-3" />
													) : null}
													{user.role}
												</span>
											</td>

											{/* Approval Status */}
											<td className="py-3.5 px-6">
												{user.isApproved ? (
													<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
														<CheckCircle2 className="h-3.5 w-3.5" />
														Approved
													</span>
												) : (
													<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
														<Clock className="h-3.5 w-3.5" />
														Pending
													</span>
												)}
											</td>

											{/* Assigned Group */}
											<td className="py-3.5 px-6">
												{user.currentGroupName ? (
													<span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 border border-sky-200">
														<Users className="h-3 w-3" />
														{user.currentGroupName}
													</span>
												) : (
													<span className="text-xs text-slate-400 italic">
														No Group Assigned
													</span>
												)}
											</td>

											{/* Sign-up date */}
											<td className="py-3.5 px-6 text-xs text-slate-500">
												{dateStr}
											</td>

											{/* Actions */}
											<td className="py-3.5 px-6 text-right">
												<div className="flex items-center justify-end gap-1.5">
													{/* 1-Tap Toggle Approval */}
													<Button
														size="sm"
														variant="outline"
														disabled={togglingUserId === user.id}
														onClick={() => handleToggleApproval(user)}
														className={cn(
															'h-8 text-xs font-semibold',
															user.isApproved
																? 'border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-100 hover:text-amber-900'
																: 'border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
														)}
													>
														{togglingUserId === user.id ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : user.isApproved ? (
															<>
																<UserMinus className="h-3.5 w-3.5 mr-1" />
																Revoke
															</>
														) : (
															<>
																<Check className="h-3.5 w-3.5 mr-1" />
																Approve
															</>
														)}
													</Button>

													{/* Manage Group Assignment */}
													{isStudent && (
														<Button
															size="sm"
															variant="outline"
															onClick={() => openGroupModal(user)}
															className="h-8 border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
														>
															<Users className="h-3.5 w-3.5 mr-1 text-slate-500" />
															Group
														</Button>
													)}

													{/* 1-Tap Delete User */}
													<Button
														size="sm"
														variant="outline"
														onClick={() => setUserToDelete(user)}
														className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 text-xs"
													>
														<Trash2 className="h-3.5 w-3.5" />
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
			</div>

			{/* ============================================================== */}
			{/* MODAL 1: MANAGE GROUP ASSIGNMENT                              */}
			{/* ============================================================== */}
			<Dialog
				open={!!groupModalUser}
				onOpenChange={(open) => !open && setGroupModalUser(null)}
			>
				<DialogContent className="sm:max-w-md rounded-2xl bg-white border border-slate-200 p-6">
					<DialogHeader>
						<DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
							<Users className="h-5 w-5 text-sky-600" />
							Manage Group Assignment
						</DialogTitle>
						<DialogDescription className="text-xs text-slate-500">
							Assign {groupModalUser?.name} ({groupModalUser?.email}) to a study group.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 my-2">
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
								Select Study Group
							</label>
							<select
								value={selectedGroupId}
								onChange={(e) => setSelectedGroupId(e.target.value)}
								aria-label="Select study group"
								className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
							>
								<option value="NONE">— None (Unassigned) —</option>
								{groups.map((g) => (
									<option key={g.id} value={g.id}>
										{g.name}
									</option>
								))}
							</select>
						</div>

						{selectedGroupId !== 'NONE' && (
							<div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-xs text-sky-800 space-y-1">
								<p className="font-semibold">
									Assigned to:{' '}
									{groups.find((g) => g.id === selectedGroupId)?.name}
								</p>
								<p className="text-[11px] text-sky-700">
									Student will receive meeting schedules and countdown reminders for this group.
								</p>
							</div>
						)}
					</div>

					<DialogFooter className="mt-4 flex gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setGroupModalUser(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={isSavingGroup}
							onClick={handleSaveGroupAssignment}
							className="bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-xs"
						>
							{isSavingGroup ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								'Save Assignment'
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* ============================================================== */}
			{/* MODAL 2: CONFIRM DELETE USER                                   */}
			{/* ============================================================== */}
			<Dialog
				open={!!userToDelete}
				onOpenChange={(open) => !open && setUserToDelete(null)}
			>
				<DialogContent className="sm:max-w-md rounded-2xl bg-white border border-slate-200 p-6">
					<DialogHeader>
						<div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 mb-2">
							<Trash2 className="h-6 w-6" />
						</div>
						<DialogTitle className="text-lg font-bold text-slate-900 text-center">
							Delete User Record?
						</DialogTitle>
						<DialogDescription className="text-xs text-slate-500 text-center leading-relaxed">
							Are you sure you want to delete <span className="font-bold text-slate-800">{userToDelete?.name}</span> ({userToDelete?.email}) from the platform database? All group memberships and homework records will be purged.
						</DialogDescription>
					</DialogHeader>

					<DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isDeleting}
							onClick={() => setUserToDelete(null)}
							className="border-slate-200"
						>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							disabled={isDeleting}
							onClick={handleConfirmDelete}
							className="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs"
						>
							{isDeleting ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								'Delete Permanently'
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};

export default MasterUserDirectory;
