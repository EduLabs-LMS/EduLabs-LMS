'use client';

import { useMemo, useState } from 'react';
import { api } from '@/frontend/lib/api';
import {
	Check,
	CheckCircle2,
	Clock,
	Filter,
	Loader2,
	Search,
	Shield,
	ShieldCheck,
	Trash2,
	UserCheck,
	UserMinus,
	Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { useLanguage } from '@/frontend/components/language-provider';
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
import {
	ConfirmDialog,
	EmptyBlock,
	FOCUS,
	Initial,
	LoadingBlock,
	Pill,
	SectionHeading,
	roleTone,
	useCountText,
	useRoleLabel,
} from '@/frontend/features/admin/users/users-ui';

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

/** Rows rendered at once. "Show more" adds another page, so very large directories stay fast. */
const PAGE_SIZE = 50;

const selectClass = cn(
	'h-11 w-full cursor-pointer rounded-xl border-2 border-slate-300 bg-white px-3 text-sm text-slate-900',
	FOCUS
);

export const MasterUserDirectory = ({
	users,
	groups,
	isLoading,
	onRefresh,
	onInspectStudent,
}: MasterUserDirectoryProps) => {
	const { t, language, number } = useLanguage();
	const roleLabel = useRoleLabel();
	const countText = useCountText();

	const [searchQuery, setSearchQuery] = useState('');
	const [statusFilter, setStatusFilter] = useState<'ALL' | 'APPROVED' | 'PENDING'>('ALL');
	const [roleFilter, setRoleFilter] = useState<string>('ALL');
	const [visible, setVisible] = useState(PAGE_SIZE);

	// Group Assignment Modal State
	const [groupModalUser, setGroupModalUser] = useState<PlatformUser | null>(null);
	const [selectedGroupId, setSelectedGroupId] = useState<string>('NONE');
	const [isSavingGroup, setIsSavingGroup] = useState(false);

	// Delete Confirmation State
	const [userToDelete, setUserToDelete] = useState<PlatformUser | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Revoke Confirmation State (new: revoking used to happen on a single tap)
	const [userToRevoke, setUserToRevoke] = useState<PlatformUser | null>(null);

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

	const shownUsers = filteredUsers.slice(0, visible);
	const filtersActive = searchQuery !== '' || statusFilter !== 'ALL' || roleFilter !== 'ALL';

	const clearFilters = () => {
		setSearchQuery('');
		setStatusFilter('ALL');
		setRoleFilter('ALL');
		setVisible(PAGE_SIZE);
	};

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
					? t('users.toast.approved', { name: user.name })
					: t('users.toast.revoked', { name: user.name })
			);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.approvalFail'));
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

			toast.success(t('users.toast.groupSaved', { name: groupModalUser.name }));
			setGroupModalUser(null);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.groupFail'));
		} finally {
			setIsSavingGroup(false);
		}
	};

	// Delete User from Database
	const handleConfirmDelete = async () => {
		if (!userToDelete) return;
		try {
			setIsDeleting(true);
			await api.delete(`/api/admin/users?userId=${userToDelete.id}`);
			toast.success(t('users.toast.deleted', { name: userToDelete.name }));
			setUserToDelete(null);
			onRefresh();
		} catch (error) {
			console.error(error);
			toast.error(t('users.toast.deleteFail'));
		} finally {
			setIsDeleting(false);
		}
	};

	const confirmRevoke = async () => {
		const user = userToRevoke;
		if (!user) return;
		await handleToggleApproval(user);
		setUserToRevoke(null);
	};

	const formatDate = (value: string | number) =>
		value
			? new Date(value).toLocaleDateString(language, {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
			  })
			: '—';

	const roleIcon = (role: string) =>
		role.toUpperCase() === 'ADMIN' ? (
			<ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
		) : role.toUpperCase() === 'TEACHER' ? (
			<Shield className="h-3 w-3 shrink-0" aria-hidden />
		) : null;

	const approvalPill = (user: PlatformUser) =>
		user.isApproved ? (
			<Pill
				tone="border-emerald-300 bg-emerald-50 text-emerald-800"
				icon={<CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
			>
				{t('users.status.approved')}
			</Pill>
		) : (
			<Pill
				tone="border-amber-300 bg-amber-50 text-amber-900"
				icon={<Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />}
			>
				{t('users.status.pending')}
			</Pill>
		);

	const groupCell = (user: PlatformUser) =>
		user.currentGroupName ? (
			<Pill
				tone="border-emerald-300 bg-emerald-50 text-emerald-800"
				icon={<Users className="h-3 w-3 shrink-0" aria-hidden />}
			>
				<bdi>{user.currentGroupName}</bdi>
			</Pill>
		) : (
			<span className="text-xs italic text-slate-600">{t('users.group.none')}</span>
		);

	/** Row actions. Same set as before: approve/revoke, Group (students only), delete. */
	const actions = (user: PlatformUser) => {
		const busy = togglingUserId === user.id;
		return (
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => (user.isApproved ? setUserToRevoke(user) : handleToggleApproval(user))}
					className={cn(
						'min-h-[44px] px-3 text-xs font-semibold md:min-h-9',
						user.isApproved
							? 'border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100'
							: 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
					)}
				>
					{busy ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
					) : user.isApproved ? (
						<>
							<UserMinus className="me-1 h-3.5 w-3.5" aria-hidden />
							{t('users.action.revoke')}
						</>
					) : (
						<>
							<Check className="me-1 h-3.5 w-3.5" aria-hidden />
							{t('users.action.approve')}
						</>
					)}
				</Button>
				{user.role.toUpperCase() === 'STUDENT' && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => openGroupModal(user)}
						className="min-h-[44px] px-3 text-xs font-semibold md:min-h-9"
					>
						<Users className="me-1 h-3.5 w-3.5" aria-hidden />
						{t('users.action.group')}
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="outline"
					aria-label={t('users.action.delete')}
					title={t('users.action.delete')}
					onClick={() => setUserToDelete(user)}
					className="min-h-[44px] min-w-[44px] border-red-300 px-3 text-red-700 hover:bg-red-50 md:min-h-9 md:min-w-9"
				>
					<Trash2 className="h-3.5 w-3.5" aria-hidden />
				</Button>
			</div>
		);
	};

	const nameButton = (user: PlatformUser) => (
		<button
			type="button"
			onClick={() => onInspectStudent?.(user.id)}
			aria-label={t('users.action.profile', { name: user.name })}
			className={cn('flex min-w-0 items-center gap-2.5 rounded-lg text-start hover:text-emerald-800', FOCUS)}
		>
			<Initial name={user.name} />
			<span className="min-w-0">
				<bdi className="block truncate text-sm font-bold text-slate-900">{user.name}</bdi>
				{user.submissionsCount ? (
					<span className="block text-[11px] font-normal text-slate-700">
						{countText('submissions', user.submissionsCount)}
					</span>
				) : null}
			</span>
		</button>
	);

	return (
		<div className="space-y-4">
			<SectionHeading
				icon={<Users className="h-5 w-5" />}
				title={t('users.dir.title')}
				subtitle={t('users.dir.subtitle')}
				trailing={
					<span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800">
						<UserCheck className="h-4 w-4 text-emerald-700" aria-hidden />
						{t('users.dir.total', { count: number(users.length) })}
					</span>
				}
			/>

			{/* Search & Filter Toolbar */}
			<div className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
						<Filter className="h-3.5 w-3.5" aria-hidden />
						{t('users.dir.filters')}
					</div>
					{filtersActive && (
						<button
							type="button"
							onClick={clearFilters}
							className={cn('min-h-[44px] rounded-lg px-2 text-xs font-semibold text-emerald-800 underline', FOCUS)}
						>
							{t('users.dir.clear')}
						</button>
					)}
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div className="relative">
						<Search
							className="pointer-events-none absolute start-3 top-3.5 h-4 w-4 text-slate-600"
							aria-hidden
						/>
						<Input
							type="search"
							aria-label={t('users.dir.searchLabel')}
							placeholder={t('users.dir.search')}
							value={searchQuery}
							onChange={(e) => {
								setSearchQuery(e.target.value);
								setVisible(PAGE_SIZE);
							}}
							className="h-11 ps-9 text-sm"
						/>
					</div>

					<select
						value={statusFilter}
						onChange={(e) => {
							setStatusFilter(e.target.value as 'ALL' | 'APPROVED' | 'PENDING');
							setVisible(PAGE_SIZE);
						}}
						aria-label={t('users.dir.filterStatus')}
						className={selectClass}
					>
						<option value="ALL">{t('users.dir.statusAll')}</option>
						<option value="APPROVED">{t('users.dir.statusApproved')}</option>
						<option value="PENDING">{t('users.dir.statusPending')}</option>
					</select>

					<select
						value={roleFilter}
						onChange={(e) => {
							setRoleFilter(e.target.value);
							setVisible(PAGE_SIZE);
						}}
						aria-label={t('users.dir.filterRole')}
						className={selectClass}
					>
						<option value="ALL">{t('users.dir.roleAll')}</option>
						<option value="STUDENT">{t('users.dir.roleStudents')}</option>
						<option value="TEACHER">{t('users.dir.roleTeachers')}</option>
						<option value="ADMIN">{t('users.dir.roleAdmins')}</option>
					</select>
				</div>
			</div>

			{/* Directory */}
			<div className="overflow-hidden rounded-2xl border border-slate-300 bg-white">
				{isLoading ? (
					<LoadingBlock label={t('users.dir.loading')} className="h-48" />
				) : filteredUsers.length === 0 ? (
					<EmptyBlock
						icon={<Users className="h-6 w-6" />}
						title={t('users.dir.emptyTitle')}
						body={t('users.dir.emptyBody')}
						className="min-h-[220px]"
						action={
							filtersActive ? (
								<Button type="button" variant="outline" className="min-h-[44px]" onClick={clearFilters}>
									{t('users.dir.clear')}
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						{/* Desktop / tablet: table */}
						<div className="hidden md:block">
							<table className="w-full text-start text-sm">
								<thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-700">
									<tr>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.name')}</th>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.email')}</th>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.role')}</th>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.status')}</th>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.group')}</th>
										<th scope="col" className="px-4 py-3 text-start">{t('users.col.date')}</th>
										<th scope="col" className="px-4 py-3 text-end">{t('users.col.actions')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200">
									{shownUsers.map((user) => (
										<tr key={user.id} className="align-middle hover:bg-slate-50">
											<td className="max-w-[14rem] px-4 py-3">{nameButton(user)}</td>
											<td className="px-4 py-3 font-mono text-xs text-slate-800 [overflow-wrap:anywhere]">
												<bdi>{user.email}</bdi>
											</td>
											<td className="px-4 py-3">
												<Pill tone={roleTone(user.role)} icon={roleIcon(user.role)}>
													{roleLabel(user.role)}
												</Pill>
											</td>
											<td className="px-4 py-3">{approvalPill(user)}</td>
											<td className="px-4 py-3">{groupCell(user)}</td>
											<td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
												{formatDate(user.createdAt)}
											</td>
											<td className="px-4 py-3">
												<div className="flex justify-end">{actions(user)}</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* Mobile: one card per user, every column and every action kept */}
						<ul className="divide-y divide-slate-200 md:hidden">
							{shownUsers.map((user) => (
								<li key={user.id} className="space-y-3 p-4">
									<div className="flex items-start justify-between gap-3">
										{nameButton(user)}
										<Pill tone={roleTone(user.role)} icon={roleIcon(user.role)} className="shrink-0">
											{roleLabel(user.role)}
										</Pill>
									</div>
									<dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
										<div className="col-span-2">
											<dt className="font-semibold uppercase tracking-wider text-slate-700">{t('users.col.email')}</dt>
											<dd className="mt-0.5 font-mono text-slate-900 [overflow-wrap:anywhere]">
												<bdi>{user.email}</bdi>
											</dd>
										</div>
										<div>
											<dt className="font-semibold uppercase tracking-wider text-slate-700">{t('users.col.status')}</dt>
											<dd className="mt-1">{approvalPill(user)}</dd>
										</div>
										<div>
											<dt className="font-semibold uppercase tracking-wider text-slate-700">{t('users.col.group')}</dt>
											<dd className="mt-1">{groupCell(user)}</dd>
										</div>
										<div className="col-span-2">
											<dt className="font-semibold uppercase tracking-wider text-slate-700">{t('users.col.date')}</dt>
											<dd className="mt-0.5 text-slate-900">{formatDate(user.createdAt)}</dd>
										</div>
									</dl>
									{actions(user)}
								</li>
							))}
						</ul>

						{filteredUsers.length > PAGE_SIZE && (
							<div className="flex flex-col items-center gap-2 border-t border-slate-200 p-4">
								<p role="status" className="text-xs text-slate-700">
									{t('users.dir.showing', {
										shown: number(Math.min(visible, filteredUsers.length)),
										total: number(filteredUsers.length),
									})}
								</p>
								{visible < filteredUsers.length && (
									<Button
										type="button"
										variant="outline"
										className="min-h-[44px]"
										onClick={() => setVisible((v) => v + PAGE_SIZE)}
									>
										{t('users.dir.showMore')}
									</Button>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{/* MODAL 1: MANAGE GROUP ASSIGNMENT (behavior unchanged) */}
			<Dialog open={!!groupModalUser} onOpenChange={(open) => !open && setGroupModalUser(null)}>
				<DialogContent className="rounded-2xl border-2 border-black bg-white p-6 sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
							<Users className="h-5 w-5 text-emerald-800" aria-hidden />
							{t('users.groupModal.title')}
						</DialogTitle>
						<DialogDescription className="text-sm text-slate-700">
							{t('users.groupModal.desc', {
								name: groupModalUser?.name ?? '',
								email: groupModalUser?.email ?? '',
							})}
						</DialogDescription>
					</DialogHeader>

					<div className="my-2 space-y-4">
						<div className="space-y-1.5">
							<label
								htmlFor="users-group-select"
								className="text-xs font-semibold uppercase tracking-wider text-slate-800"
							>
								{t('users.groupModal.select')}
							</label>
							<select
								id="users-group-select"
								value={selectedGroupId}
								onChange={(e) => setSelectedGroupId(e.target.value)}
								className={selectClass}
							>
								<option value="NONE">{t('users.groupModal.none')}</option>
								{groups.map((g) => (
									<option key={g.id} value={g.id}>
										{g.name}
									</option>
								))}
							</select>
						</div>

						{selectedGroupId !== 'NONE' && (
							<div className="space-y-1 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
								<p className="font-semibold">
									{t('users.groupModal.assignedTo', {
										group: groups.find((g) => g.id === selectedGroupId)?.name ?? '',
									})}
								</p>
								<p className="text-[11px]">{t('users.groupModal.hint')}</p>
							</div>
						)}
					</div>

					<DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
						<Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setGroupModalUser(null)}>
							{t('users.cancel')}
						</Button>
						<Button
							type="button"
							className="min-h-[44px]"
							disabled={isSavingGroup}
							onClick={handleSaveGroupAssignment}
						>
							{isSavingGroup ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t('users.groupModal.save')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* CONFIRM: REVOKE ACCESS */}
			<ConfirmDialog
				open={!!userToRevoke}
				onOpenChange={(open) => !open && setUserToRevoke(null)}
				icon={<UserMinus className="h-6 w-6" />}
				title={t('users.revoke.title')}
				description={t('users.revoke.body', { name: userToRevoke?.name ?? '' })}
				confirmLabel={t('users.revoke.confirm')}
				cancelLabel={t('users.cancel')}
				busy={togglingUserId !== null && togglingUserId === userToRevoke?.id}
				onConfirm={confirmRevoke}
			/>

			{/* CONFIRM: DELETE USER */}
			<ConfirmDialog
				open={!!userToDelete}
				onOpenChange={(open) => !open && setUserToDelete(null)}
				icon={<Trash2 className="h-6 w-6" />}
				title={t('users.delete.title')}
				description={t('users.delete.body', {
					name: userToDelete?.name ?? '',
					email: userToDelete?.email ?? '',
				})}
				confirmLabel={t('users.delete.confirm')}
				cancelLabel={t('users.cancel')}
				busy={isDeleting}
				onConfirm={handleConfirmDelete}
			/>
		</div>
	);
};

export default MasterUserDirectory;
